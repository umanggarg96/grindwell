'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { jobOutcome, jobPayout } = require('./public/job-math.js');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_FILE = process.env.DATA_FILE
  ? path.resolve(process.env.DATA_FILE)
  : path.join(__dirname, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY_BYTES = 16 * 1024;
const MAX_HABITS = 200;
const MAX_NAME_LENGTH = 60;
const MIN_DIFFICULTY = 1;
const MAX_DIFFICULTY = 10;
const DEFAULT_DIFFICULTY = 5;
const DEFAULT_THEME = 'ember';
const THEME_IDS = ['ember', 'blue', 'teal', 'violet'];
const MAX_PROFILES = 20;
const MAX_SHOP_ITEMS = 100;
const MAX_ITEM_COST = 1000000;
const MAX_URL_LENGTH = 500;

// Jobs are shared like the shop. Each profile can only hold a few at a time,
// and only the newest finished jobs are shown on the board.
const MAX_JOBS = 500;
const MAX_JOB_TITLE_LENGTH = 160;
const MIN_JOB_REWARD = 1;
const MAX_JOB_REWARD = 1000;
const MIN_JOB_ETA_MINUTES = 1;
const MAX_JOB_ETA_MINUTES = 10080;
const MAX_JOBS_IN_PROGRESS = 3;
const TERMINAL_JOBS_SHOWN = 10;
const JOB_STATUSES = ['inbox', 'inProgress', 'completed', 'failed'];
const FAILURE_MULTIPLIER = -0.5;
// Ether is a linear reward: max(1, round(difficulty * factor)). One global
// factor keeps tuning simple; earned ether is stored per completion date.
const DEFAULT_ETHER_FACTOR = 1;
const MIN_ETHER_FACTOR = 0.1;
const MAX_ETHER_FACTOR = 10;
// Missing a scheduled habit costs max(1, round(urgency * urgencyFactor)).
// Urgency is separate from difficulty: a simple task can still be costly to miss.
const DEFAULT_URGENCY = 1;
const MIN_URGENCY = 0;
const MAX_URGENCY = 10;
const DEFAULT_URGENCY_FACTOR = 1;
const MIN_URGENCY_FACTOR = 0.1;
const MAX_URGENCY_FACTOR = 10;
const SETTLE_GUARD_DAYS = 40000;
// JavaScript weekday numbers: 0 = Sunday ... 6 = Saturday.
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
// Built-in sounds are synthesised in the browser; custom ones point at audio URLs.
const SOUND_IDS = ['chime', 'sparkle', 'pop', 'bell', 'off'];
const DEFAULT_SOUNDS = { habit: 'chime', purchase: 'pop', custom: [] };
const MAX_CUSTOM_SOUNDS = 20;
// Built-in icons are inline SVG paths; custom ones point at image URLs.
const ICON_IDS = ['flame', 'spark', 'bolt', 'moon', 'gem', 'heart'];
const DEFAULT_ICON = 'flame';
const MAX_CUSTOM_ICONS = 20;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

let state = {
  settings: defaultSettings(),
  profiles: [],
  shop: { items: [] },
  jobs: [],
  activeProfileId: null,
};
let saveChain = Promise.resolve();

/* ---------- helpers ---------- */

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

// Local calendar date, e.g. "2026-11-17".
function dayKey(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

// Accept only real YYYY-MM-DD keys so bad data cannot create phantom days.
function dateKeyFromValue(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, date] = value.split('-').map(Number);
  const parsed = new Date(year, month - 1, date);
  return parsed.getFullYear() === year &&
    parsed.getMonth() === month - 1 &&
    parsed.getDate() === date
    ? dayKey(parsed)
    : null;
}

function dateKeyFromTimestamp(value) {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : dayKey(parsed);
}

function normalizePenaltyFrom(value, createdAt) {
  const parsed = dateKeyFromValue(value);
  const fallback = dateKeyFromTimestamp(createdAt) || dayKey();
  const key = parsed || fallback;
  // A future start date would silently postpone penalties; clamp it to today.
  return key > dayKey() ? dayKey() : key;
}

// The first day a habit can count as missed in the trends. penaltyFrom can be
// backdated and resets on edits, while createdAt stops a habit appearing missed
// before it existed. Use whichever is earlier.
function habitStartKey(habit) {
  const created = dateKeyFromTimestamp(habit.createdAt);
  const penaltyFrom = normalizePenaltyFrom(habit.penaltyFrom, habit.createdAt);
  return created && created < penaltyFrom ? created : penaltyFrom;
}

function startOfDayKey(key) {
  const [year, month, date] = key.split('-').map(Number);
  return new Date(year, month - 1, date);
}

function currentStreak(completions, days = ALL_DAYS) {
  const done = new Set(completions);
  const scheduled = new Set(days);
  const cursor = new Date();

  // Today does not break the streak until it ends, so start from yesterday
  // when today is scheduled but not done yet.
  if (scheduled.has(cursor.getDay()) && !done.has(dayKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
  }

  let streak = 0;
  let guard = 0;

  while (guard < 40000) {
    guard += 1;
    // Days the habit is not scheduled for are skipped, not counted as misses.
    if (!scheduled.has(cursor.getDay())) {
      cursor.setDate(cursor.getDate() - 1);
      continue;
    }
    if (!done.has(dayKey(cursor))) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return streak;
}

function daysOf(habit) {
  if (!Array.isArray(habit.days)) return [...ALL_DAYS];
  const days = [...new Set(habit.days)].filter(
    (day) => Number.isInteger(day) && day >= 0 && day <= 6,
  );
  return days.length > 0 ? days.sort((a, b) => a - b) : [...ALL_DAYS];
}

function parseDays(value) {
  if (value === undefined) return [...ALL_DAYS];
  if (!Array.isArray(value) || value.length === 0) {
    throw httpError(400, 'Pick at least one day for this habit.');
  }

  const days = new Set();
  for (const day of value) {
    if (!Number.isInteger(day) || day < 0 || day > 6) {
      throw httpError(400, 'Days must be whole numbers from 0 (Sunday) to 6 (Saturday).');
    }
    days.add(day);
  }
  return [...days].sort((a, b) => a - b);
}

function parseName(value) {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (!name) throw httpError(400, 'Give the habit a name.');
  if (name.length > MAX_NAME_LENGTH) {
    throw httpError(400, `Keep names under ${MAX_NAME_LENGTH} characters.`);
  }
  return name;
}

function parseDifficulty(value) {
  if (!Number.isInteger(value)) {
    throw httpError(400, 'Difficulty must be a whole number from 1 to 10.');
  }
  if (value < MIN_DIFFICULTY || value > MAX_DIFFICULTY) {
    throw httpError(400, `Difficulty must be between ${MIN_DIFFICULTY} and ${MAX_DIFFICULTY}.`);
  }
  return value;
}

function difficultyOf(habit) {
  const value = habit.difficulty;
  // Habits created before difficulty existed fall back to a middle value.
  return Number.isInteger(value) && value >= MIN_DIFFICULTY && value <= MAX_DIFFICULTY
    ? value
    : DEFAULT_DIFFICULTY;
}

function rewardFor(difficulty, factor = DEFAULT_ETHER_FACTOR) {
  return Math.max(1, Math.round(difficulty * factor));
}

function parseUrgency(value) {
  if (!Number.isInteger(value)) {
    throw httpError(400, 'Urgency must be a whole number from 0 to 10.');
  }
  if (value < MIN_URGENCY || value > MAX_URGENCY) {
    throw httpError(400, `Urgency must be between ${MIN_URGENCY} and ${MAX_URGENCY}.`);
  }
  return value;
}

function urgencyOf(habit) {
  const value = habit.urgency;
  // Habits created before urgency existed opt out of penalties until edited.
  return Number.isInteger(value) && value >= MIN_URGENCY && value <= MAX_URGENCY ? value : 0;
}

function penaltyFor(urgency, factor = DEFAULT_URGENCY_FACTOR) {
  if (!Number.isInteger(urgency) || urgency <= 0) return 0;
  return Math.max(1, Math.round(urgency * factor));
}

function etherFactorOf(value) {
  return Number.isFinite(value) && value >= MIN_ETHER_FACTOR && value <= MAX_ETHER_FACTOR
    ? Math.round(value * 100) / 100
    : DEFAULT_ETHER_FACTOR;
}

function parseEtherFactor(value) {
  const factor = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(factor)) {
    throw httpError(400, 'Ether factor must be a number.');
  }
  if (factor < MIN_ETHER_FACTOR || factor > MAX_ETHER_FACTOR) {
    throw httpError(
      400,
      `Ether factor must be between ${MIN_ETHER_FACTOR} and ${MAX_ETHER_FACTOR}.`,
    );
  }
  return Math.round(factor * 100) / 100;
}

function urgencyFactorOf(value) {
  return Number.isFinite(value) && value >= MIN_URGENCY_FACTOR && value <= MAX_URGENCY_FACTOR
    ? Math.round(value * 100) / 100
    : DEFAULT_URGENCY_FACTOR;
}

function parseUrgencyFactor(value) {
  const factor = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(factor)) {
    throw httpError(400, 'Urgency factor must be a number.');
  }
  if (factor < MIN_URGENCY_FACTOR || factor > MAX_URGENCY_FACTOR) {
    throw httpError(
      400,
      `Urgency factor must be between ${MIN_URGENCY_FACTOR} and ${MAX_URGENCY_FACTOR}.`,
    );
  }
  return Math.round(factor * 100) / 100;
}

function defaultSounds() {
  return { habit: DEFAULT_SOUNDS.habit, purchase: DEFAULT_SOUNDS.purchase, custom: [] };
}

function defaultIcon() {
  return { id: DEFAULT_ICON, custom: [] };
}

function defaultSettings() {
  return {
    etherFactor: DEFAULT_ETHER_FACTOR,
    urgencyFactor: DEFAULT_URGENCY_FACTOR,
    sounds: defaultSounds(),
    icon: defaultIcon(),
  };
}

function normalizeCustomSounds(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const sounds = [];

  for (const sound of value) {
    if (!sound || typeof sound.id !== 'string' || !sound.id || seen.has(sound.id)) continue;
    const name = typeof sound.name === 'string' ? sound.name.trim().replace(/\s+/g, ' ') : '';
    const url = typeof sound.url === 'string' ? sound.url.trim() : '';
    if (!name || name.length > MAX_NAME_LENGTH) continue;
    if (!url || url.length > MAX_URL_LENGTH || !isHttpUrl(url)) continue;
    seen.add(sound.id);
    sounds.push({ id: sound.id, name, url });
    if (sounds.length >= MAX_CUSTOM_SOUNDS) break;
  }

  return sounds;
}

function soundChoiceExists(id, custom) {
  return SOUND_IDS.includes(id) || custom.some((sound) => sound.id === id);
}

function normalizeSounds(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const custom = normalizeCustomSounds(source.custom);
  return {
    habit: soundChoiceExists(source.habit, custom) ? source.habit : DEFAULT_SOUNDS.habit,
    purchase: soundChoiceExists(source.purchase, custom)
      ? source.purchase
      : DEFAULT_SOUNDS.purchase,
    custom,
  };
}

function soundsOf() {
  state.settings.sounds = normalizeSounds(state.settings.sounds);
  return state.settings.sounds;
}

function parseSoundChoice(value) {
  if (typeof value !== 'string' || !soundChoiceExists(value, soundsOf().custom)) {
    throw httpError(400, 'Choose a known sound.');
  }
  return value;
}

function parseSoundsUpdate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw httpError(400, 'Sounds must be an object.');
  }

  const current = soundsOf();
  return {
    habit: value.habit === undefined ? current.habit : parseSoundChoice(value.habit),
    purchase: value.purchase === undefined ? current.purchase : parseSoundChoice(value.purchase),
    custom: current.custom,
  };
}

function parseSoundName(value) {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (!name) throw httpError(400, 'Give the sound a name.');
  if (name.length > MAX_NAME_LENGTH) {
    throw httpError(400, `Keep names under ${MAX_NAME_LENGTH} characters.`);
  }
  return name;
}

function normalizeCustomIcons(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const icons = [];

  for (const icon of value) {
    if (!icon || typeof icon.id !== 'string' || !icon.id || seen.has(icon.id)) continue;
    const name = typeof icon.name === 'string' ? icon.name.trim().replace(/\s+/g, ' ') : '';
    const url = typeof icon.url === 'string' ? icon.url.trim() : '';
    if (!name || name.length > MAX_NAME_LENGTH) continue;
    if (!url || url.length > MAX_URL_LENGTH || !isHttpUrl(url)) continue;
    seen.add(icon.id);
    icons.push({ id: icon.id, name, url });
    if (icons.length >= MAX_CUSTOM_ICONS) break;
  }

  return icons;
}

function iconChoiceExists(id, custom) {
  return ICON_IDS.includes(id) || custom.some((icon) => icon.id === id);
}

function normalizeIcon(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const custom = normalizeCustomIcons(source.custom);
  return {
    id: iconChoiceExists(source.id, custom) ? source.id : DEFAULT_ICON,
    custom,
  };
}

function iconOf() {
  state.settings.icon = normalizeIcon(state.settings.icon);
  return state.settings.icon;
}

function parseIconChoice(value) {
  if (typeof value !== 'string' || !iconChoiceExists(value, iconOf().custom)) {
    throw httpError(400, 'Choose a known icon.');
  }
  return value;
}

function parseIconUpdate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw httpError(400, 'Icon must be an object.');
  }

  const current = iconOf();
  return {
    id: value.id === undefined ? current.id : parseIconChoice(value.id),
    custom: current.custom,
  };
}

function parseIconName(value) {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (!name) throw httpError(400, 'Give the icon a name.');
  if (name.length > MAX_NAME_LENGTH) {
    throw httpError(400, `Keep names under ${MAX_NAME_LENGTH} characters.`);
  }
  return name;
}

function earningsOf(habit) {
  return habit.earnings && typeof habit.earnings === 'object' && !Array.isArray(habit.earnings)
    ? habit.earnings
    : {};
}

// Ether earned by deleted habits lives here so removing a habit never claws
// back ether the profile already earned.
function retiredEarningsOf(profile) {
  return profile.retiredEarnings &&
    typeof profile.retiredEarnings === 'object' &&
    !Array.isArray(profile.retiredEarnings)
    ? profile.retiredEarnings
    : {};
}

function normalizeRetiredEarnings(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const earnings = {};
  for (const [date, amount] of Object.entries(source)) {
    if (Number.isInteger(amount) && amount > 0) earnings[date] = amount;
  }
  return earnings;
}

function addEarnings(byDate, earnings) {
  for (const [date, value] of Object.entries(earnings)) {
    if (!Number.isInteger(value) || value < 1) continue;
    byDate.set(date, (byDate.get(date) || 0) + value);
  }
}

function penaltiesOf(habit) {
  return habit.penalties && typeof habit.penalties === 'object' && !Array.isArray(habit.penalties)
    ? habit.penalties
    : {};
}

// Penalties from deleted habits stay here so deleting never refunds a loss.
function retiredPenaltiesOf(profile) {
  return profile.retiredPenalties &&
    typeof profile.retiredPenalties === 'object' &&
    !Array.isArray(profile.retiredPenalties)
    ? profile.retiredPenalties
    : {};
}

function normalizePenalties(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const penalties = {};
  for (const [date, amount] of Object.entries(source)) {
    const key = dateKeyFromValue(date);
    if (key && Number.isInteger(amount) && amount > 0) penalties[key] = amount;
  }
  return penalties;
}

function addPenalties(byDate, penalties) {
  for (const [date, value] of Object.entries(penalties)) {
    if (!Number.isInteger(value) || value < 1) continue;
    byDate.set(date, (byDate.get(date) || 0) + value);
  }
}

// Job ether lives on the profile so it feeds the same balance, dashboard, and
// Shop as habit ether. A job records its payout on the day it finished.
function jobEarningsOf(profile) {
  return profile.jobEarnings &&
    typeof profile.jobEarnings === 'object' &&
    !Array.isArray(profile.jobEarnings)
    ? profile.jobEarnings
    : {};
}

function jobPenaltiesOf(profile) {
  return profile.jobPenalties &&
    typeof profile.jobPenalties === 'object' &&
    !Array.isArray(profile.jobPenalties)
    ? profile.jobPenalties
    : {};
}

function penaltyEther(profile) {
  let total = 0;
  for (const penalties of [
    retiredPenaltiesOf(profile),
    jobPenaltiesOf(profile),
    ...(profile.habits || []).map(penaltiesOf),
  ]) {
    for (const value of Object.values(penalties)) {
      if (Number.isInteger(value) && value > 0) total += value;
    }
  }
  return total;
}

function earnedEther(profile) {
  let total = 0;
  for (const earnings of [
    retiredEarningsOf(profile),
    jobEarningsOf(profile),
    ...(profile.habits || []).map(earningsOf),
  ]) {
    for (const value of Object.values(earnings)) {
      if (Number.isInteger(value) && value > 0) total += value;
    }
  }
  return total;
}

function spentEtherOf(profile) {
  return Number.isInteger(profile.spentEther) && profile.spentEther > 0 ? profile.spentEther : 0;
}

function etherBalance(profile) {
  return earnedEther(profile) - penaltyEther(profile) - spentEtherOf(profile);
}

function etherSummary(profile) {
  const earningsByDate = new Map();
  const penaltiesByDate = new Map();
  const completionsByDate = new Map();
  addEarnings(earningsByDate, retiredEarningsOf(profile));
  addPenalties(penaltiesByDate, retiredPenaltiesOf(profile));
  addEarnings(earningsByDate, jobEarningsOf(profile));
  addPenalties(penaltiesByDate, jobPenaltiesOf(profile));
  for (const habit of profile.habits || []) {
    addEarnings(earningsByDate, earningsOf(habit));
    addPenalties(penaltiesByDate, penaltiesOf(habit));
    const completions = Array.isArray(habit.completions) ? habit.completions : [];
    for (const date of completions) {
      if (typeof date !== 'string') continue;
      completionsByDate.set(date, (completionsByDate.get(date) || 0) + 1);
    }
  }

  const now = new Date();
  const todayKey = dayKey(now);
  const dayKeys = [];
  for (let offset = 29; offset >= 0; offset -= 1) {
    dayKeys.push(dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset)));
  }

  // A missed day is a scheduled day before today with no completion. Today is
  // still open, so it never counts as missed yet (matching streaks/penalties).
  const missedByDate = new Map();
  for (const habit of profile.habits || []) {
    const days = daysOf(habit);
    const completions = new Set(Array.isArray(habit.completions) ? habit.completions : []);
    const startKey = habitStartKey(habit);
    for (const key of dayKeys) {
      if (key >= todayKey || key < startKey) continue;
      if (!days.includes(startOfDayKey(key).getDay())) continue;
      if (completions.has(key)) continue;
      missedByDate.set(key, (missedByDate.get(key) || 0) + 1);
    }
  }

  const days = dayKeys.map((key) => {
    const ether = earningsByDate.get(key) || 0;
    const penalty = penaltiesByDate.get(key) || 0;
    return {
      date: key,
      ether,
      penalty,
      net: ether - penalty,
      completed: completionsByDate.get(key) || 0,
      missed: missedByDate.get(key) || 0,
    };
  });

  const today = earningsByDate.get(todayKey) || 0;
  const penaltyToday = penaltiesByDate.get(todayKey) || 0;
  const last7 = days.slice(-7).reduce((sum, day) => sum + day.ether, 0);
  const last30 = days.reduce((sum, day) => sum + day.ether, 0);
  const penaltyLast7 = days.slice(-7).reduce((sum, day) => sum + day.penalty, 0);
  const penaltyLast30 = days.reduce((sum, day) => sum + day.penalty, 0);

  return {
    factor: state.settings.etherFactor,
    urgencyFactor: state.settings.urgencyFactor,
    total: etherBalance(profile),
    earned: earnedEther(profile),
    penalties: penaltyEther(profile),
    spent: spentEtherOf(profile),
    today,
    last7,
    last30,
    penaltyToday,
    penaltyLast7,
    penaltyLast30,
    netToday: today - penaltyToday,
    netLast7: last7 - penaltyLast7,
    netLast30: last30 - penaltyLast30,
    completedToday: completionsByDate.get(todayKey) || 0,
    completedLast7: days.slice(-7).reduce((sum, day) => sum + day.completed, 0),
    completedLast30: days.reduce((sum, day) => sum + day.completed, 0),
    missedLast7: days.slice(-7).reduce((sum, day) => sum + day.missed, 0),
    missedLast30: days.reduce((sum, day) => sum + day.missed, 0),
    days,
  };
}

function toPublic(habit) {
  const completions = Array.isArray(habit.completions) ? habit.completions : [];
  const days = daysOf(habit);
  const today = new Date();
  const todayKey = dayKey(today);
  const difficulty = difficultyOf(habit);
  const urgency = urgencyOf(habit);
  const earned = earningsOf(habit)[todayKey];
  return {
    id: habit.id,
    name: habit.name,
    createdAt: habit.createdAt,
    difficulty,
    urgency,
    days,
    dueToday: days.includes(today.getDay()),
    doneToday: completions.includes(todayKey),
    streak: currentStreak(completions, days),
    reward: rewardFor(difficulty, state.settings.etherFactor),
    penalty: penaltyFor(urgency, state.settings.urgencyFactor),
    earnedToday: Number.isInteger(earned) && earned > 0 ? earned : 0,
  };
}

function parseProfileName(value) {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (!name) throw httpError(400, 'Give the profile a name.');
  if (name.length > MAX_NAME_LENGTH) {
    throw httpError(400, `Keep names under ${MAX_NAME_LENGTH} characters.`);
  }
  return name;
}

function parseTheme(value) {
  if (value === undefined) return DEFAULT_THEME;
  if (!THEME_IDS.includes(value)) throw httpError(400, 'Unknown theme.');
  return value;
}

function makeProfile(name, theme = DEFAULT_THEME) {
  return {
    id: crypto.randomUUID(),
    name: parseProfileName(name),
    theme: parseTheme(theme),
    createdAt: new Date().toISOString(),
    habits: [],
    retiredEarnings: {},
    retiredPenalties: {},
    jobEarnings: {},
    jobPenalties: {},
    spentEther: 0,
  };
}

function findProfile(id) {
  return state.profiles.find((profile) => profile.id === id) || null;
}

function activeProfile() {
  return findProfile(state.activeProfileId) || state.profiles[0];
}

function toPublicProfile(profile) {
  return {
    id: profile.id,
    name: profile.name,
    theme: profile.theme,
    habitCount: (profile.habits || []).length,
    ether: etherBalance(profile),
    earned: earnedEther(profile),
    penalties: penaltyEther(profile),
    spent: spentEtherOf(profile),
  };
}

// The habits pages show every profile at once, so habit routes accept
// ?profile=<id>. Without it they keep operating on the active profile.
function profileForRequest(url) {
  const id = url.searchParams.get('profile');
  if (!id) return activeProfile();
  const profile = findProfile(id);
  if (!profile) throw httpError(404, 'Profile not found.');
  return profile;
}

function overviewProfile(profile) {
  return {
    ...toPublicProfile(profile),
    summary: etherSummary(profile),
    habits: profile.habits.map(toPublic),
  };
}

function normalizeHabit(habit, factor = DEFAULT_ETHER_FACTOR) {
  const days = daysOf(habit);
  const completions = Array.isArray(habit.completions)
    ? [...new Set(habit.completions.filter((date) => typeof date === 'string'))].sort()
    : [];

  // Backfill earnings for completions that predate the reward system. Once a
  // date has an amount it is kept, so later factor/difficulty changes only
  // affect future completions.
  const existing = earningsOf(habit);
  const earnings = {};
  for (const date of completions) {
    const value = existing[date];
    earnings[date] =
      Number.isInteger(value) && value > 0
        ? value
        : rewardFor(difficultyOf(habit), factor);
  }

  // Habits created before urgency existed default to 0, so they never collect
  // retroactive penalties. New habits set urgency explicitly on creation.
  const urgency =
    Number.isInteger(habit.urgency) &&
    habit.urgency >= MIN_URGENCY &&
    habit.urgency <= MAX_URGENCY
      ? habit.urgency
      : 0;
  const penaltyFrom = normalizePenaltyFrom(habit.penaltyFrom, habit.createdAt);
  const penalties = normalizePenalties(habit.penalties);

  const earningsChanged =
    Object.keys(existing).length !== Object.keys(earnings).length ||
    Object.entries(earnings).some(([date, value]) => existing[date] !== value);
  const penaltiesChanged =
    JSON.stringify(penalties) !== JSON.stringify(habit.penalties || {});

  const changed =
    !Array.isArray(habit.days) ||
    habit.days.length !== days.length ||
    habit.days.some((day, index) => day !== days[index]) ||
    !Array.isArray(habit.completions) ||
    habit.completions.length !== completions.length ||
    habit.completions.some((date, index) => date !== completions[index]) ||
    habit.urgency !== urgency ||
    habit.penaltyFrom !== penaltyFrom ||
    penaltiesChanged ||
    earningsChanged;

  return {
    habit: { ...habit, days, completions, earnings, urgency, penaltyFrom, penalties },
    changed,
  };
}

/* ---------- shop ---------- */

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function parseShopUrl(value, label) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) throw httpError(400, `${label} is required.`);
  if (raw.length > MAX_URL_LENGTH) {
    throw httpError(400, `Keep the ${label.toLowerCase()} under ${MAX_URL_LENGTH} characters.`);
  }
  if (!isHttpUrl(raw)) {
    throw httpError(400, `${label} must start with http:// or https://.`);
  }
  return raw;
}

function parseOptionalImage(value) {
  if (value === undefined || value === null || value === '') return '';
  return parseShopUrl(value, 'Image URL');
}

function parseItemName(value) {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (!name) throw httpError(400, 'Give the item a name.');
  if (name.length > MAX_NAME_LENGTH) {
    throw httpError(400, `Keep names under ${MAX_NAME_LENGTH} characters.`);
  }
  return name;
}

function parseItemCost(value) {
  const cost = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(cost) || cost < 1 || cost > MAX_ITEM_COST) {
    throw httpError(400, `Cost must be a whole number from 1 to ${MAX_ITEM_COST}.`);
  }
  return cost;
}

function parseConsumable(value) {
  if (value === undefined) return false;
  if (typeof value !== 'boolean') {
    throw httpError(400, 'Consumable must be true or false.');
  }
  return value;
}

function parseExcludedProfiles(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw httpError(400, 'Contributors must be a list of profiles.');
  const ids = new Set();
  for (const id of value) {
    if (typeof id !== 'string' || !findProfile(id)) {
      throw httpError(400, 'Unknown profile in contributors.');
    }
    ids.add(id);
  }
  return [...ids];
}

function shopItemsOf() {
  if (!state.shop || !Array.isArray(state.shop.items)) state.shop = { items: [] };
  return state.shop.items;
}

function toPublicShopItem(item) {
  return {
    id: item.id,
    name: item.name,
    link: item.link,
    cost: item.cost,
    image: item.image || '',
    createdAt: item.createdAt,
    consumable: item.consumable === true,
    purchasedAt: item.purchasedAt || null,
    excludedProfiles: [...(Array.isArray(item.excludedProfiles) ? item.excludedProfiles : [])],
  };
}

function publicShop() {
  return { items: shopItemsOf().map(toPublicShopItem) };
}

function findShopItem(id) {
  return shopItemsOf().find((item) => item.id === id) || null;
}

function normalizeShopItem(item, profileIds) {
  if (!item || typeof item.id !== 'string' || !item.id) return null;

  const name = typeof item.name === 'string' ? item.name.trim().replace(/\s+/g, ' ') : '';
  const link = typeof item.link === 'string' ? item.link.trim() : '';
  const cost = typeof item.cost === 'number' ? item.cost : Number(item.cost);
  if (
    !name ||
    name.length > MAX_NAME_LENGTH ||
    !link ||
    link.length > MAX_URL_LENGTH ||
    !isHttpUrl(link) ||
    !Number.isInteger(cost) ||
    cost < 1 ||
    cost > MAX_ITEM_COST
  ) {
    return null;
  }

  let image = typeof item.image === 'string' ? item.image.trim() : '';
  if (image && (image.length > MAX_URL_LENGTH || !isHttpUrl(image))) image = '';

  const createdAt = typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString();
  const consumable = item.consumable === true;
  const purchasedAt =
    typeof item.purchasedAt === 'string' &&
    item.purchasedAt &&
    !Number.isNaN(Date.parse(item.purchasedAt))
      ? item.purchasedAt
      : null;
  const excludedProfiles = Array.isArray(item.excludedProfiles)
    ? [...new Set(item.excludedProfiles.filter((id) => typeof id === 'string' && profileIds.has(id)))]
    : [];

  const changed =
    name !== item.name ||
    link !== item.link ||
    cost !== item.cost ||
    image !== item.image ||
    createdAt !== item.createdAt ||
    consumable !== item.consumable ||
    purchasedAt !== (item.purchasedAt || null) ||
    !Array.isArray(item.excludedProfiles) ||
    excludedProfiles.length !== item.excludedProfiles.length ||
    excludedProfiles.some((id, index) => id !== item.excludedProfiles[index]);

  return {
    item: {
      id: item.id,
      name,
      link,
      cost,
      image,
      createdAt,
      consumable,
      purchasedAt,
      excludedProfiles,
    },
    changed,
  };
}

function normalizeShop(value, profileIds) {
  const source = value && Array.isArray(value.items) ? value.items : [];
  let changed = !value || !Array.isArray(value.items);
  const items = [];
  for (const raw of source) {
    const normalized = normalizeShopItem(raw, profileIds);
    if (!normalized) {
      changed = true;
      continue;
    }
    if (normalized.changed) changed = true;
    items.push(normalized.item);
  }
  if (items.length > MAX_SHOP_ITEMS) {
    items.length = MAX_SHOP_ITEMS;
    changed = true;
  }
  return { shop: { items }, changed };
}

function includedShopProfiles(item) {
  const excluded = new Set(
    Array.isArray(item.excludedProfiles) ? item.excludedProfiles : [],
  );
  return state.profiles.filter(
    (profile) => !excluded.has(profile.id) && etherBalance(profile) > 0,
  );
}

// Split the cost proportionally to each contributor's balance, then use the
// largest remainders to keep every charge a whole number. This means someone
// with more ether always pays more.
function purchaseShopItem(item) {
  if (!item.consumable && item.purchasedAt) {
    throw httpError(400, 'This item has already been bought.');
  }

  const contributors = includedShopProfiles(item);
  const total = contributors.reduce((sum, profile) => sum + etherBalance(profile), 0);
  if (total < item.cost) {
    throw httpError(400, `Not enough ether: ${total} of ${item.cost} available.`);
  }

  const shares = contributors.map((profile) => ({
    profile,
    balance: etherBalance(profile),
  }));
  const exact = shares.map((share) => (item.cost * share.balance) / total);
  const amounts = exact.map((value) => Math.floor(value));
  const remainder = item.cost - amounts.reduce((sum, value) => sum + value, 0);
  const order = exact
    .map((value, index) => ({
      index,
      fraction: value - amounts[index],
      balance: shares[index].balance,
      id: shares[index].profile.id,
    }))
    .sort(
      (a, b) =>
        b.fraction - a.fraction || b.balance - a.balance || a.id.localeCompare(b.id),
    );

  for (let index = 0; index < remainder; index += 1) {
    amounts[order[index % order.length].index] += 1;
  }

  const contributions = [];
  shares.forEach((share, index) => {
    const amount = amounts[index];
    if (amount < 1) return;
    share.profile.spentEther = spentEtherOf(share.profile) + amount;
    contributions.push({
      profileId: share.profile.id,
      name: share.profile.name,
      amount,
    });
  });
  if (!item.consumable) item.purchasedAt = new Date().toISOString();
  return contributions;
}

/* ---------- jobs ---------- */

function jobsOf() {
  if (!Array.isArray(state.jobs)) state.jobs = [];
  return state.jobs;
}

function findJob(id) {
  return jobsOf().find((job) => job.id === id) || null;
}

function wholeNumber(value) {
  const number =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(number) ? number : NaN;
}

function parseJobTitle(value) {
  const title = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (!title) throw httpError(400, 'Give the job a title.');
  if (title.length > MAX_JOB_TITLE_LENGTH) {
    throw httpError(400, `Keep job text under ${MAX_JOB_TITLE_LENGTH} characters.`);
  }
  return title;
}

function parseJobReward(value) {
  const reward = wholeNumber(value);
  if (!Number.isInteger(reward) || reward < MIN_JOB_REWARD || reward > MAX_JOB_REWARD) {
    throw httpError(
      400,
      `Reward must be a whole number from ${MIN_JOB_REWARD} to ${MAX_JOB_REWARD}.`,
    );
  }
  return reward;
}

function parseJobEta(value) {
  const eta = wholeNumber(value);
  if (
    !Number.isInteger(eta) ||
    eta < MIN_JOB_ETA_MINUTES ||
    eta > MAX_JOB_ETA_MINUTES
  ) {
    throw httpError(
      400,
      `ETA must be a whole number of minutes from ${MIN_JOB_ETA_MINUTES} to ${MAX_JOB_ETA_MINUTES}.`,
    );
  }
  return eta;
}

function jobTimestamp(value) {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function dueAtFrom(startedAt, etaMinutes) {
  return new Date(Date.parse(startedAt) + etaMinutes * 60000).toISOString();
}

// Repairs a job loaded from disk. In-progress jobs with no valid owner fall
// back to the inbox so they cannot get stuck in a deleted profile's box.
function normalizeJob(raw, profileIds) {
  if (!raw || typeof raw.id !== 'string' || !raw.id) return null;

  const title = typeof raw.title === 'string' ? raw.title.trim().replace(/\s+/g, ' ') : '';
  if (!title || title.length > MAX_JOB_TITLE_LENGTH) return null;

  const reward = wholeNumber(raw.reward);
  if (!Number.isInteger(reward) || reward < MIN_JOB_REWARD || reward > MAX_JOB_REWARD) {
    return null;
  }
  const etaMinutes = wholeNumber(raw.etaMinutes);
  if (
    !Number.isInteger(etaMinutes) ||
    etaMinutes < MIN_JOB_ETA_MINUTES ||
    etaMinutes > MAX_JOB_ETA_MINUTES
  ) {
    return null;
  }

  const createdBy = typeof raw.createdBy === 'string' ? raw.createdBy : null;
  let assignedTo = typeof raw.assignedTo === 'string' ? raw.assignedTo : null;
  const createdAt = jobTimestamp(raw.createdAt) || new Date().toISOString();

  let status = JOB_STATUSES.includes(raw.status) ? raw.status : 'inbox';
  let startedAt = jobTimestamp(raw.startedAt);
  let dueAt = jobTimestamp(raw.dueAt);
  let completedAt = jobTimestamp(raw.completedAt);
  let failedAt = jobTimestamp(raw.failedAt);
  let multiplier = typeof raw.multiplier === 'number' ? raw.multiplier : null;
  let payout = Number.isInteger(raw.payout) ? raw.payout : null;

  if (status === 'inProgress') {
    if (!startedAt || !assignedTo || !profileIds.has(assignedTo)) {
      status = 'inbox';
    } else if (!dueAt) {
      dueAt = dueAtFrom(startedAt, etaMinutes);
    }
  }

  if (status === 'inbox') {
    assignedTo = null;
    startedAt = null;
    dueAt = null;
    completedAt = null;
    failedAt = null;
    multiplier = null;
    payout = null;
  } else if (status === 'completed') {
    completedAt = completedAt || startedAt || createdAt;
    if (![0.5, 1, 1.5, 2].includes(multiplier)) multiplier = 1;
    if (!Number.isInteger(payout) || payout < 1) payout = jobPayout(reward, multiplier);
    if (!dueAt && startedAt) dueAt = dueAtFrom(startedAt, etaMinutes);
    failedAt = null;
  } else if (status === 'failed') {
    failedAt = failedAt || new Date().toISOString();
    multiplier = FAILURE_MULTIPLIER;
    if (!Number.isInteger(payout) || payout > -1) {
      payout = jobPayout(reward, FAILURE_MULTIPLIER);
    }
    if (!dueAt && startedAt) dueAt = dueAtFrom(startedAt, etaMinutes);
    completedAt = null;
  }

  return {
    id: raw.id,
    title,
    reward,
    etaMinutes,
    status,
    createdBy,
    assignedTo,
    createdAt,
    startedAt,
    dueAt,
    completedAt,
    failedAt,
    multiplier,
    payout,
  };
}

function toPublicJob(job) {
  return {
    id: job.id,
    title: job.title,
    reward: job.reward,
    etaMinutes: job.etaMinutes,
    status: job.status,
    createdBy: job.createdBy,
    assignedTo: job.assignedTo,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    dueAt: job.dueAt,
    completedAt: job.completedAt,
    failedAt: job.failedAt,
    multiplier: job.multiplier,
    payout: job.payout,
  };
}

function newestFirst(a, b, field) {
  return (Date.parse(b[field]) || 0) - (Date.parse(a[field]) || 0);
}

// The board only needs open work plus the newest finished jobs. Older terminal
// jobs stay in data.json as history but are not sent to the client.
function publicJobs() {
  const jobs = jobsOf();
  const completed = jobs
    .filter((job) => job.status === 'completed')
    .sort((a, b) => newestFirst(a, b, 'completedAt'))
    .slice(0, TERMINAL_JOBS_SHOWN);
  const failed = jobs
    .filter((job) => job.status === 'failed')
    .sort((a, b) => newestFirst(a, b, 'failedAt'))
    .slice(0, TERMINAL_JOBS_SHOWN);

  return {
    inbox: jobs
      .filter((job) => job.status === 'inbox')
      .sort((a, b) => newestFirst(a, b, 'createdAt'))
      .map(toPublicJob),
    inProgress: jobs
      .filter((job) => job.status === 'inProgress')
      .sort((a, b) => newestFirst(a, b, 'startedAt'))
      .map(toPublicJob),
    completed: completed.map(toPublicJob),
    failed: failed.map(toPublicJob),
  };
}

function jobBoardPayload() {
  return {
    today: dayKey(),
    now: new Date().toISOString(),
    activeProfileId: activeProfile().id,
    profiles: state.profiles.map(toPublicProfile),
    jobs: publicJobs(),
    limits: {
      maxInProgress: MAX_JOBS_IN_PROGRESS,
      terminalShown: TERMINAL_JOBS_SHOWN,
    },
  };
}

function jobsInProgressFor(profile) {
  return jobsOf().filter(
    (job) => job.status === 'inProgress' && job.assignedTo === profile.id,
  ).length;
}

function jobElapsedOutcome(job, now = Date.now()) {
  const started = job.startedAt ? Date.parse(job.startedAt) : NaN;
  if (!Number.isFinite(started)) return { multiplier: null, failed: false };
  return jobOutcome(now - started, job.etaMinutes);
}

function failJob(job, now = Date.now()) {
  const penalty = Math.abs(jobPayout(job.reward, FAILURE_MULTIPLIER));
  job.status = 'failed';
  job.failedAt = new Date(now).toISOString();
  job.multiplier = FAILURE_MULTIPLIER;
  job.payout = -penalty;

  const profile = findProfile(job.assignedTo);
  if (profile) {
    const ledger = { ...jobPenaltiesOf(profile) };
    const key = dayKey(new Date(now));
    ledger[key] = (ledger[key] || 0) + penalty;
    profile.jobPenalties = ledger;
  }
}

// Like habit penalties, job failures are settled lazily: at startup and before
// every non-health API request. A job past twice its ETA becomes a failure.
function settleJobs(now = Date.now()) {
  let changed = false;
  for (const job of jobsOf()) {
    if (job.status !== 'inProgress') continue;
    if (!jobElapsedOutcome(job, now).failed) continue;
    failJob(job, now);
    changed = true;
  }
  return changed;
}

/* ---------- penalties ---------- */

// Walk every scheduled day since penaltyFrom up to yesterday. Recorded days are
// never recalculated, so changing the urgency factor or a habit's urgency only
// affects future misses. Settlement runs before every non-health API request.
function settleHabit(habit, todayKey = dayKey()) {
  if (urgencyOf(habit) <= 0) return false;

  const days = daysOf(habit);
  const completions = new Set(Array.isArray(habit.completions) ? habit.completions : []);
  const existing = normalizePenalties(habit.penalties);
  const penalties = { ...existing };
  const amount = penaltyFor(urgencyOf(habit), state.settings.urgencyFactor);
  const end = startOfDayKey(todayKey);
  let cursor = startOfDayKey(normalizePenaltyFrom(habit.penaltyFrom, habit.createdAt));
  let changed = false;
  let guard = 0;

  while (cursor < end && guard < SETTLE_GUARD_DAYS) {
    const key = dayKey(cursor);
    if (days.includes(cursor.getDay()) && !completions.has(key) && !penalties[key]) {
      penalties[key] = amount;
      changed = true;
    }
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
    guard += 1;
  }

  if (changed) habit.penalties = penalties;
  return changed;
}

function settleAll() {
  let changed = false;
  for (const profile of state.profiles) {
    for (const habit of profile.habits || []) {
      if (settleHabit(habit)) changed = true;
    }
  }
  return changed;
}

/* ---------- persistence ---------- */

async function loadState() {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);

    if (parsed && Array.isArray(parsed.profiles) && parsed.profiles.length > 0) {
      let changed = false;
      const profiles = [];
      const etherFactor = etherFactorOf(parsed.settings && parsed.settings.etherFactor);
      if (etherFactor !== (parsed.settings && parsed.settings.etherFactor)) changed = true;
      const urgencyFactor = urgencyFactorOf(
        parsed.settings && parsed.settings.urgencyFactor,
      );
      if (urgencyFactor !== (parsed.settings && parsed.settings.urgencyFactor)) changed = true;
      const sounds = normalizeSounds(parsed.settings && parsed.settings.sounds);
      if (JSON.stringify(sounds) !== JSON.stringify(parsed.settings && parsed.settings.sounds)) {
        changed = true;
      }
      const icon = normalizeIcon(parsed.settings && parsed.settings.icon);
      if (JSON.stringify(icon) !== JSON.stringify(parsed.settings && parsed.settings.icon)) {
        changed = true;
      }

      for (const profile of parsed.profiles) {
        if (!profile || typeof profile.id !== 'string') {
          changed = true;
          continue;
        }

        const habits = (Array.isArray(profile.habits) ? profile.habits : []).map((habit) => {
          const normalized = normalizeHabit(habit, etherFactor);
          if (normalized.changed) changed = true;
          return normalized.habit;
        });
        const retiredEarnings = normalizeRetiredEarnings(profile.retiredEarnings);
        const retiredChanged =
          !profile.retiredEarnings ||
          typeof profile.retiredEarnings !== 'object' ||
          Array.isArray(profile.retiredEarnings) ||
          Object.keys(retiredEarnings).length !== Object.keys(profile.retiredEarnings).length ||
          Object.entries(retiredEarnings).some(
            ([date, amount]) => profile.retiredEarnings[date] !== amount,
          );
        if (retiredChanged) changed = true;
        const retiredPenalties = normalizePenalties(profile.retiredPenalties);
        if (JSON.stringify(retiredPenalties) !== JSON.stringify(profile.retiredPenalties)) {
          changed = true;
        }
        const jobEarnings = normalizeRetiredEarnings(profile.jobEarnings);
        if (JSON.stringify(jobEarnings) !== JSON.stringify(profile.jobEarnings)) {
          changed = true;
        }
        const jobPenalties = normalizePenalties(profile.jobPenalties);
        if (JSON.stringify(jobPenalties) !== JSON.stringify(profile.jobPenalties)) {
          changed = true;
        }
        const spentEther =
          Number.isInteger(profile.spentEther) && profile.spentEther > 0
            ? profile.spentEther
            : 0;
        if (spentEther !== profile.spentEther) changed = true;
        const theme = THEME_IDS.includes(profile.theme) ? profile.theme : DEFAULT_THEME;
        const name =
          typeof profile.name === 'string' && profile.name.trim() ? profile.name : 'Profile';

        if (theme !== profile.theme || name !== profile.name || !Array.isArray(profile.habits)) {
          changed = true;
        }
        profiles.push({
          ...profile,
          name,
          theme,
          habits,
          retiredEarnings,
          retiredPenalties,
          jobEarnings,
          jobPenalties,
          spentEther,
        });
      }

      if (profiles.length === 0) {
        profiles.push(makeProfile('Mine'));
        changed = true;
      }

      const activeProfileId = profiles.some((profile) => profile.id === parsed.activeProfileId)
        ? parsed.activeProfileId
        : profiles[0].id;
      if (activeProfileId !== parsed.activeProfileId) changed = true;

      const profileIds = new Set(profiles.map((profile) => profile.id));
      const shop = normalizeShop(parsed.shop, profileIds);
      if (shop.changed) changed = true;

      const rawJobs = Array.isArray(parsed.jobs) ? parsed.jobs : [];
      const jobs = rawJobs
        .map((job) => normalizeJob(job, profileIds))
        .filter(Boolean);
      if (jobs.length !== rawJobs.length) changed = true;

      state = {
        settings: { etherFactor, urgencyFactor, sounds, icon },
        profiles,
        shop: shop.shop,
        jobs,
        activeProfileId,
      };
      if (changed) await saveState();
      return;
    }

    // Old single-profile file: keep its habits inside the first profile.
    const profile = makeProfile('Mine');
    if (parsed && Array.isArray(parsed.habits)) {
      profile.habits = parsed.habits.map(
        (habit) => normalizeHabit(habit, DEFAULT_ETHER_FACTOR).habit,
      );
    }
    const profileIds = new Set([profile.id]);
    const jobs = (parsed && Array.isArray(parsed.jobs) ? parsed.jobs : [])
      .map((raw) => {
        const migrated = { ...raw, createdBy: profile.id };
        if (migrated.status === 'inProgress' && !migrated.assignedTo) {
          migrated.assignedTo = profile.id;
        }
        return normalizeJob(migrated, profileIds);
      })
      .filter(Boolean);
    state = {
      settings: defaultSettings(),
      profiles: [profile],
      shop: { items: [] },
      jobs,
      activeProfileId: profile.id,
    };
    await saveState();
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error(`Could not read ${DATA_FILE}: ${error.message}`);
    }
    if (state.profiles.length === 0) {
      const profile = makeProfile('Mine');
      state = {
        settings: defaultSettings(),
        profiles: [profile],
        shop: state.shop && Array.isArray(state.shop.items) ? state.shop : { items: [] },
        jobs: state.jobs && Array.isArray(state.jobs) ? state.jobs : [],
        activeProfileId: profile.id,
      };
      await saveState();
    }
  }
}

// Serialize writes and write atomically so a crash cannot leave half a file.
function saveState() {
  saveChain = saveChain.then(async () => {
    const tmpFile = `${DATA_FILE}.tmp`;
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    await fs.writeFile(tmpFile, JSON.stringify(state, null, 2));
    await fs.rename(tmpFile, DATA_FILE);
  });
  saveChain = saveChain.catch((error) => {
    console.error(`Could not write ${DATA_FILE}: ${error.message}`);
  });
  return saveChain;
}

/* ---------- HTTP plumbing ---------- */

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': MIME_TYPES['.json'],
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(httpError(413, 'Request body too large.'));
        req.removeAllListeners('data');
        req.resume();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(httpError(400, 'Invalid JSON body.'));
      }
    });

    req.on('error', reject);
  });
}

// Client-side pages share one document; these clean URLs all serve index.html.
const APP_ROUTES = new Set(['/dashboard', '/settings', '/shop', '/jobs']);

function resolvePublicPath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const route = decoded.replace(/\/+$/, '') || '/';
  const relative = route === '/' || APP_ROUTES.has(route) ? 'index.html' : decoded;
  const resolved = path.resolve(PUBLIC_DIR, `.${path.sep}${relative}`);

  if (resolved !== PUBLIC_DIR && !resolved.startsWith(PUBLIC_DIR + path.sep)) {
    return null;
  }
  return resolved;
}

async function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end('Method not allowed');
  }

  const filePath = resolvePublicPath(pathname);
  if (!filePath) {
    res.writeHead(400);
    return res.end('Bad request');
  }

  try {
    const body = await fs.readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EISDIR') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    throw error;
  }
}

/* ---------- API ---------- */

async function handleApi(req, res, pathname, url) {
  if (pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, today: dayKey() });
  }

  // Missed scheduled days and overdue jobs are settled lazily, before any
  // read or write.
  const habitsChanged = settleAll();
  const jobsChanged = settleJobs();
  if (habitsChanged || jobsChanged) await saveState();

  if (pathname === '/api/overview') {
    if (req.method !== 'GET') throw httpError(405, 'Method not allowed.');
    return sendJson(res, 200, {
      today: dayKey(),
      settings: state.settings,
      activeProfileId: state.activeProfileId,
      profiles: state.profiles.map(overviewProfile),
      shop: publicShop(),
    });
  }

  if (pathname === '/api/settings') {
    if (req.method === 'GET') {
      return sendJson(res, 200, state.settings);
    }

    if (req.method === 'PATCH') {
      const body = await readJson(req);
      const updates = {};
      if (body.etherFactor !== undefined) {
        updates.etherFactor = parseEtherFactor(body.etherFactor);
      }
      if (body.urgencyFactor !== undefined) {
        updates.urgencyFactor = parseUrgencyFactor(body.urgencyFactor);
      }
      if (body.sounds !== undefined) {
        updates.sounds = parseSoundsUpdate(body.sounds);
      }
      if (body.icon !== undefined) {
        updates.icon = parseIconUpdate(body.icon);
      }
      if (Object.keys(updates).length === 0) throw httpError(400, 'Nothing to update.');
      Object.assign(state.settings, updates);
      await saveState();
      return sendJson(res, 200, state.settings);
    }

    throw httpError(405, 'Method not allowed.');
  }

  if (pathname === '/api/settings/sounds') {
    if (req.method !== 'POST') throw httpError(405, 'Method not allowed.');
    const body = await readJson(req);
    const sounds = soundsOf();
    if (sounds.custom.length >= MAX_CUSTOM_SOUNDS) {
      throw httpError(400, 'You already have enough custom sounds.');
    }
    const sound = {
      id: crypto.randomUUID(),
      name: parseSoundName(body.name),
      url: parseShopUrl(body.url, 'Sound URL'),
    };
    sounds.custom.push(sound);
    await saveState();
    return sendJson(res, 201, { sound, sounds });
  }

  const soundMatch = pathname.match(/^\/api\/settings\/sounds\/([\w-]+)$/);
  if (soundMatch) {
    if (req.method !== 'DELETE') throw httpError(405, 'Method not allowed.');
    const sounds = soundsOf();
    const index = sounds.custom.findIndex((sound) => sound.id === soundMatch[1]);
    if (index === -1) throw httpError(404, 'Sound not found.');
    sounds.custom.splice(index, 1);
    // A removed sound must not stay selected.
    if (!soundChoiceExists(sounds.habit, sounds.custom)) sounds.habit = DEFAULT_SOUNDS.habit;
    if (!soundChoiceExists(sounds.purchase, sounds.custom)) {
      sounds.purchase = DEFAULT_SOUNDS.purchase;
    }
    await saveState();
    return sendJson(res, 200, state.settings);
  }

  if (pathname === '/api/settings/icons') {
    if (req.method !== 'POST') throw httpError(405, 'Method not allowed.');
    const body = await readJson(req);
    const icons = iconOf();
    if (icons.custom.length >= MAX_CUSTOM_ICONS) {
      throw httpError(400, 'You already have enough custom icons.');
    }
    const icon = {
      id: crypto.randomUUID(),
      name: parseIconName(body.name),
      url: parseShopUrl(body.url, 'Icon URL'),
    };
    icons.custom.push(icon);
    icons.id = icon.id;
    await saveState();
    return sendJson(res, 201, { icon, settings: state.settings });
  }

  const iconMatch = pathname.match(/^\/api\/settings\/icons\/([\w-]+)$/);
  if (iconMatch) {
    if (req.method !== 'DELETE') throw httpError(405, 'Method not allowed.');
    const icons = iconOf();
    const index = icons.custom.findIndex((icon) => icon.id === iconMatch[1]);
    if (index === -1) throw httpError(404, 'Icon not found.');
    icons.custom.splice(index, 1);
    if (!iconChoiceExists(icons.id, icons.custom)) icons.id = DEFAULT_ICON;
    await saveState();
    return sendJson(res, 200, state.settings);
  }

  if (pathname === '/api/profiles') {
    if (req.method === 'GET') {
      return sendJson(res, 200, {
        profiles: state.profiles.map(toPublicProfile),
        activeProfileId: activeProfile().id,
      });
    }

    if (req.method === 'POST') {
      const body = await readJson(req);
      if (state.profiles.length >= MAX_PROFILES) {
        throw httpError(400, 'You already have enough profiles.');
      }
      const profile = makeProfile(body.name, body.theme);
      state.profiles.push(profile);
      state.activeProfileId = profile.id;
      await saveState();
      return sendJson(res, 201, { ...toPublicProfile(profile), habits: [] });
    }

    throw httpError(405, 'Method not allowed.');
  }

  const activateMatch = pathname.match(/^\/api\/profiles\/([\w-]+)\/activate$/);
  if (activateMatch) {
    if (req.method !== 'POST') throw httpError(405, 'Method not allowed.');
    const profile = findProfile(activateMatch[1]);
    if (!profile) throw httpError(404, 'Profile not found.');
    state.activeProfileId = profile.id;
    await saveState();
    return sendJson(res, 200, toPublicProfile(profile));
  }

  const profileMatch = pathname.match(/^\/api\/profiles\/([\w-]+)$/);
  if (profileMatch) {
    const profile = findProfile(profileMatch[1]);
    if (!profile) throw httpError(404, 'Profile not found.');

    if (req.method === 'PATCH') {
      const body = await readJson(req);
      const updates = {};
      if (body.name !== undefined) updates.name = parseProfileName(body.name);
      if (body.theme !== undefined) updates.theme = parseTheme(body.theme);
      if (Object.keys(updates).length === 0) throw httpError(400, 'Nothing to update.');
      Object.assign(profile, updates);
      await saveState();
      return sendJson(res, 200, toPublicProfile(profile));
    }

    if (req.method === 'DELETE') {
      if (state.profiles.length === 1) {
        throw httpError(400, 'Keep at least one profile.');
      }
      state.profiles = state.profiles.filter((item) => item.id !== profile.id);
      for (const item of shopItemsOf()) {
        item.excludedProfiles = (item.excludedProfiles || []).filter((id) => id !== profile.id);
      }
      // Work a deleted profile had claimed goes back to the inbox so someone
      // else can take it. Finished jobs stay in history.
      for (const job of jobsOf()) {
        if (job.status !== 'inProgress' || job.assignedTo !== profile.id) continue;
        job.status = 'inbox';
        job.assignedTo = null;
        job.startedAt = null;
        job.dueAt = null;
      }
      if (state.activeProfileId === profile.id) {
        state.activeProfileId = state.profiles[0].id;
      }
      await saveState();
      res.writeHead(204, { 'Cache-Control': 'no-store' });
      return res.end();
    }

    throw httpError(405, 'Method not allowed.');
  }

  if (pathname === '/api/shop') {
    if (req.method !== 'GET') throw httpError(405, 'Method not allowed.');
    return sendJson(res, 200, {
      ...publicShop(),
      profiles: state.profiles.map(toPublicProfile),
    });
  }

  if (pathname === '/api/shop/items') {
    if (req.method !== 'POST') throw httpError(405, 'Method not allowed.');
    const body = await readJson(req);
    if (shopItemsOf().length >= MAX_SHOP_ITEMS) {
      throw httpError(400, 'The shop is full. Remove an item before adding another.');
    }
    const item = {
      id: crypto.randomUUID(),
      name: parseItemName(body.name),
      link: parseShopUrl(body.link, 'Link'),
      cost: parseItemCost(body.cost),
      image: parseOptionalImage(body.image),
      createdAt: new Date().toISOString(),
      consumable: parseConsumable(body.consumable),
      purchasedAt: null,
      excludedProfiles: parseExcludedProfiles(body.excludedProfiles),
    };
    shopItemsOf().push(item);
    await saveState();
    return sendJson(res, 201, toPublicShopItem(item));
  }

  const buyMatch = pathname.match(/^\/api\/shop\/items\/([\w-]+)\/buy$/);
  if (buyMatch) {
    if (req.method !== 'POST') throw httpError(405, 'Method not allowed.');
    const item = findShopItem(buyMatch[1]);
    if (!item) throw httpError(404, 'Shop item not found.');
    const contributions = purchaseShopItem(item);
    await saveState();
    return sendJson(res, 200, {
      item: toPublicShopItem(item),
      contributions,
      profiles: state.profiles.map(toPublicProfile),
    });
  }

  const shopItemMatch = pathname.match(/^\/api\/shop\/items\/([\w-]+)$/);
  if (shopItemMatch) {
    const item = findShopItem(shopItemMatch[1]);
    if (!item) throw httpError(404, 'Shop item not found.');

    if (req.method === 'PATCH') {
      const body = await readJson(req);
      const updates = {};
      if (body.name !== undefined) updates.name = parseItemName(body.name);
      if (body.link !== undefined) updates.link = parseShopUrl(body.link, 'Link');
      if (body.cost !== undefined) updates.cost = parseItemCost(body.cost);
      if (body.image !== undefined) updates.image = parseOptionalImage(body.image);
      if (body.consumable !== undefined) updates.consumable = parseConsumable(body.consumable);
      if (body.excludedProfiles !== undefined) {
        updates.excludedProfiles = parseExcludedProfiles(body.excludedProfiles);
      }
      if (Object.keys(updates).length === 0) throw httpError(400, 'Nothing to update.');
      Object.assign(item, updates);
      await saveState();
      return sendJson(res, 200, toPublicShopItem(item));
    }

    if (req.method === 'DELETE') {
      state.shop.items = shopItemsOf().filter((entry) => entry.id !== item.id);
      await saveState();
      res.writeHead(204, { 'Cache-Control': 'no-store' });
      return res.end();
    }

    throw httpError(405, 'Method not allowed.');
  }

  if (pathname === '/api/jobs') {
    if (req.method === 'GET') return sendJson(res, 200, jobBoardPayload());

    if (req.method === 'POST') {
      const body = await readJson(req);
      if (jobsOf().length >= MAX_JOBS) {
        throw httpError(400, 'The job board is full. Finish or remove a job first.');
      }
      const job = {
        id: crypto.randomUUID(),
        title: parseJobTitle(body.title),
        reward: parseJobReward(body.reward),
        etaMinutes: parseJobEta(body.etaMinutes),
        status: 'inbox',
        createdBy: activeProfile().id,
        assignedTo: null,
        createdAt: new Date().toISOString(),
        startedAt: null,
        dueAt: null,
        completedAt: null,
        failedAt: null,
        multiplier: null,
        payout: null,
      };
      jobsOf().push(job);
      await saveState();
      return sendJson(res, 201, { job: toPublicJob(job), jobs: publicJobs() });
    }

    throw httpError(405, 'Method not allowed.');
  }

  const takeJobMatch = pathname.match(/^\/api\/jobs\/([\w-]+)\/take$/);
  if (takeJobMatch) {
    if (req.method !== 'POST') throw httpError(405, 'Method not allowed.');
    const job = findJob(takeJobMatch[1]);
    if (!job) throw httpError(404, 'Job not found.');
    const profile = profileForRequest(url);
    if (job.status === 'inProgress') throw httpError(409, 'Someone already took this job.');
    if (job.status !== 'inbox') throw httpError(409, 'This job is already finished.');
    if (jobsInProgressFor(profile) >= MAX_JOBS_IN_PROGRESS) {
      throw httpError(
        400,
        `${profile.name} already has ${MAX_JOBS_IN_PROGRESS} jobs in progress.`,
      );
    }
    const now = new Date();
    job.status = 'inProgress';
    job.assignedTo = profile.id;
    job.startedAt = now.toISOString();
    job.dueAt = dueAtFrom(job.startedAt, job.etaMinutes);
    await saveState();
    return sendJson(res, 200, {
      job: toPublicJob(job),
      jobs: publicJobs(),
      profiles: state.profiles.map(toPublicProfile),
    });
  }

  const completeJobMatch = pathname.match(/^\/api\/jobs\/([\w-]+)\/complete$/);
  if (completeJobMatch) {
    if (req.method !== 'POST') throw httpError(405, 'Method not allowed.');
    const job = findJob(completeJobMatch[1]);
    if (!job) throw httpError(404, 'Job not found.');
    if (job.status !== 'inProgress') throw httpError(409, 'This job is not in progress.');

    const now = Date.now();
    const outcome = jobElapsedOutcome(job, now);
    if (outcome.failed || outcome.multiplier === null) {
      failJob(job, now);
      await saveState();
      throw httpError(409, 'This job passed its deadline and failed.');
    }

    const payout = jobPayout(job.reward, outcome.multiplier);
    job.status = 'completed';
    job.completedAt = new Date(now).toISOString();
    job.multiplier = outcome.multiplier;
    job.payout = payout;

    const profile = findProfile(job.assignedTo);
    if (profile) {
      const ledger = { ...jobEarningsOf(profile) };
      const key = dayKey(new Date(now));
      ledger[key] = (ledger[key] || 0) + payout;
      profile.jobEarnings = ledger;
    }

    await saveState();
    return sendJson(res, 200, {
      job: toPublicJob(job),
      jobs: publicJobs(),
      profiles: state.profiles.map(toPublicProfile),
    });
  }

  const jobMatch = pathname.match(/^\/api\/jobs\/([\w-]+)$/);
  if (jobMatch) {
    const job = findJob(jobMatch[1]);
    if (!job) throw httpError(404, 'Job not found.');

    if (req.method === 'DELETE') {
      if (job.status !== 'inbox') {
        throw httpError(409, 'Only jobs in the inbox can be removed.');
      }
      state.jobs = jobsOf().filter((entry) => entry.id !== job.id);
      await saveState();
      res.writeHead(204, { 'Cache-Control': 'no-store' });
      return res.end();
    }

    throw httpError(405, 'Method not allowed.');
  }

  // Every habit route below applies to ?profile=<id>, or the active profile.
  const profile = profileForRequest(url);
  if (pathname === '/api/habits') {
    if (req.method === 'GET') {
      return sendJson(res, 200, {
        today: dayKey(),
        habits: profile.habits.map(toPublic),
        profile: toPublicProfile(profile),
        profiles: state.profiles.map(toPublicProfile),
        settings: state.settings,
        ether: etherSummary(profile),
      });
    }

    if (req.method === 'POST') {
      const body = await readJson(req);
      if (profile.habits.length >= MAX_HABITS) {
        throw httpError(400, 'You already have plenty of habits.');
      }

      const habit = {
        id: crypto.randomUUID(),
        name: parseName(body.name),
        createdAt: new Date().toISOString(),
        difficulty: body.difficulty === undefined ? DEFAULT_DIFFICULTY : parseDifficulty(body.difficulty),
        urgency: body.urgency === undefined ? DEFAULT_URGENCY : parseUrgency(body.urgency),
        days: parseDays(body.days),
        completions: [],
        earnings: {},
        penalties: {},
        penaltyFrom: dayKey(),
      };
      profile.habits.push(habit);
      await saveState();
      return sendJson(res, 201, toPublic(habit));
    }

    if (req.method === 'DELETE') {
      profile.habits = [];
      profile.retiredEarnings = {};
      profile.retiredPenalties = {};
      profile.jobEarnings = {};
      profile.jobPenalties = {};
      profile.spentEther = 0;
      await saveState();
      res.writeHead(204, { 'Cache-Control': 'no-store' });
      return res.end();
    }

    throw httpError(405, 'Method not allowed.');
  }

  const toggleMatch = pathname.match(/^\/api\/habits\/([\w-]+)\/toggle$/);
  if (toggleMatch) {
    if (req.method !== 'POST') throw httpError(405, 'Method not allowed.');

    const habit = profile.habits.find((item) => item.id === toggleMatch[1]);
    if (!habit) throw httpError(404, 'Habit not found.');

    const days = daysOf(habit);
    const now = new Date();
    const today = dayKey(now);
    const completions = new Set(Array.isArray(habit.completions) ? habit.completions : []);
    const body = await readJson(req);
    const shouldBeDone = typeof body.done === 'boolean' ? body.done : !completions.has(today);

    // Rest days cannot be completed. Un-checking is still allowed so an old
    // off-day record can be cleaned up.
    if (shouldBeDone && !days.includes(now.getDay())) {
      throw httpError(400, 'This habit is not scheduled for today.');
    }

    // Lock in the reward at completion time so later difficulty or factor
    // changes cannot rewrite history.
    const earnings = { ...earningsOf(habit) };
    if (shouldBeDone) {
      completions.add(today);
      if (!Number.isInteger(earnings[today]) || earnings[today] < 1) {
        earnings[today] = rewardFor(difficultyOf(habit), state.settings.etherFactor);
      }
    } else {
      completions.delete(today);
      delete earnings[today];
    }

    habit.completions = [...completions].sort();
    habit.earnings = earnings;
    await saveState();
    return sendJson(res, 200, toPublic(habit));
  }

  const itemMatch = pathname.match(/^\/api\/habits\/([\w-]+)$/);
  if (itemMatch) {
    const habit = profile.habits.find((item) => item.id === itemMatch[1]);
    if (!habit) throw httpError(404, 'Habit not found.');

    if (req.method === 'PATCH') {
      const body = await readJson(req);
      const updates = {};

      if (body.name !== undefined) updates.name = parseName(body.name);
      if (body.difficulty !== undefined) updates.difficulty = parseDifficulty(body.difficulty);
      if (body.urgency !== undefined) updates.urgency = parseUrgency(body.urgency);
      if (body.days !== undefined) updates.days = parseDays(body.days);

      if (Object.keys(updates).length === 0) {
        throw httpError(400, 'Nothing to update.');
      }

      // Settlement already ran for this request, so past misses keep their old
      // charge. Restarting the window here prevents retroactive re-billing.
      const resetsPenaltyWindow =
        updates.urgency !== undefined || updates.days !== undefined;
      Object.assign(habit, updates);
      if (resetsPenaltyWindow) habit.penaltyFrom = dayKey();
      await saveState();
      return sendJson(res, 200, toPublic(habit));
    }

    if (req.method === 'DELETE') {
      const retired = { ...retiredEarningsOf(profile) };
      for (const [date, amount] of Object.entries(earningsOf(habit))) {
        if (!Number.isInteger(amount) || amount < 1) continue;
        retired[date] = (retired[date] || 0) + amount;
      }
      profile.retiredEarnings = retired;
      // Deleting a habit keeps the penalties it already caused, just like ether.
      const retiredPenalties = { ...retiredPenaltiesOf(profile) };
      for (const [date, amount] of Object.entries(penaltiesOf(habit))) {
        if (!Number.isInteger(amount) || amount < 1) continue;
        retiredPenalties[date] = (retiredPenalties[date] || 0) + amount;
      }
      profile.retiredPenalties = retiredPenalties;
      profile.habits = profile.habits.filter((item) => item.id !== habit.id);
      await saveState();
      res.writeHead(204, { 'Cache-Control': 'no-store' });
      return res.end();
    }

    throw httpError(405, 'Method not allowed.');
  }

  throw httpError(404, 'Not found.');
}

/* ---------- server ---------- */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const { pathname } = url;

  try {
    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname, url);
    } else {
      await serveStatic(req, res, pathname);
    }
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error(error);
    if (!res.headersSent) {
      sendJson(res, status, { error: status >= 500 ? 'Server error.' : error.message });
    } else {
      res.end();
    }
  }
});

loadState().then(async () => {
  // Record any misses or failed jobs that happened while the server was offline.
  const settledHabits = settleAll();
  const settledJobs = settleJobs();
  if (settledHabits || settledJobs) await saveState();
  server.listen(PORT, HOST, () => {
    console.log(`grindwell listening on http://localhost:${PORT}`);
    console.log(`data file: ${DATA_FILE}`);
  });
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}

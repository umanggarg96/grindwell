'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

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
const THEME_IDS = ['ember', 'blue', 'teal', 'green', 'lime', 'violet', 'rose'];
const MAX_PROFILES = 20;
const MAX_SHOP_ITEMS = 100;
const MAX_ITEM_COST = 1000000;
const MAX_URL_LENGTH = 500;
// Ether is a linear reward: max(1, round(difficulty * factor)). One global
// factor keeps tuning simple; earned ether is stored per completion date.
const DEFAULT_ETHER_FACTOR = 1;
const MIN_ETHER_FACTOR = 0.1;
const MAX_ETHER_FACTOR = 10;
// JavaScript weekday numbers: 0 = Sunday ... 6 = Saturday.
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
// Built-in sounds are synthesised in the browser; custom ones point at audio URLs.
const SOUND_IDS = ['chime', 'sparkle', 'pop', 'bell', 'off'];
const DEFAULT_SOUNDS = { habit: 'chime', purchase: 'pop', custom: [] };
const MAX_CUSTOM_SOUNDS = 20;

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

function defaultSounds() {
  return { habit: DEFAULT_SOUNDS.habit, purchase: DEFAULT_SOUNDS.purchase, custom: [] };
}

function defaultSettings() {
  return { etherFactor: DEFAULT_ETHER_FACTOR, sounds: defaultSounds() };
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

function earnedEther(profile) {
  let total = 0;
  for (const earnings of [retiredEarningsOf(profile), ...(profile.habits || []).map(earningsOf)]) {
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
  return earnedEther(profile) - spentEtherOf(profile);
}

function etherSummary(profile) {
  const byDate = new Map();
  const completionsByDate = new Map();
  addEarnings(byDate, retiredEarningsOf(profile));
  for (const habit of profile.habits || []) {
    addEarnings(byDate, earningsOf(habit));
    const completions = Array.isArray(habit.completions) ? habit.completions : [];
    for (const date of completions) {
      if (typeof date !== 'string') continue;
      completionsByDate.set(date, (completionsByDate.get(date) || 0) + 1);
    }
  }

  const now = new Date();
  const days = [];
  for (let offset = 29; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
    const key = dayKey(date);
    days.push({
      date: key,
      ether: byDate.get(key) || 0,
      completed: completionsByDate.get(key) || 0,
    });
  }

  return {
    factor: state.settings.etherFactor,
    total: etherBalance(profile),
    earned: earnedEther(profile),
    spent: spentEtherOf(profile),
    today: byDate.get(dayKey(now)) || 0,
    last7: days.slice(-7).reduce((sum, day) => sum + day.ether, 0),
    last30: days.reduce((sum, day) => sum + day.ether, 0),
    completedToday: completionsByDate.get(dayKey(now)) || 0,
    completedLast7: days.slice(-7).reduce((sum, day) => sum + day.completed, 0),
    completedLast30: days.reduce((sum, day) => sum + day.completed, 0),
    days,
  };
}

function toPublic(habit) {
  const completions = Array.isArray(habit.completions) ? habit.completions : [];
  const days = daysOf(habit);
  const today = new Date();
  const todayKey = dayKey(today);
  const difficulty = difficultyOf(habit);
  const earned = earningsOf(habit)[todayKey];
  return {
    id: habit.id,
    name: habit.name,
    createdAt: habit.createdAt,
    difficulty,
    days,
    dueToday: days.includes(today.getDay()),
    doneToday: completions.includes(todayKey),
    streak: currentStreak(completions, days),
    reward: rewardFor(difficulty, state.settings.etherFactor),
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

  const earningsChanged =
    Object.keys(existing).length !== Object.keys(earnings).length ||
    Object.entries(earnings).some(([date, value]) => existing[date] !== value);

  const changed =
    !Array.isArray(habit.days) ||
    habit.days.length !== days.length ||
    habit.days.some((day, index) => day !== days[index]) ||
    !Array.isArray(habit.completions) ||
    habit.completions.length !== completions.length ||
    habit.completions.some((date, index) => date !== completions[index]) ||
    earningsChanged;

  return { habit: { ...habit, days, completions, earnings }, changed };
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
      const sounds = normalizeSounds(parsed.settings && parsed.settings.sounds);
      if (JSON.stringify(sounds) !== JSON.stringify(parsed.settings && parsed.settings.sounds)) {
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
        profiles.push({ ...profile, name, theme, habits, retiredEarnings, spentEther });
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

      state = { settings: { etherFactor, sounds }, profiles, shop: shop.shop, activeProfileId };
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
    state = {
      settings: defaultSettings(),
      profiles: [profile],
      shop: { items: [] },
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
const APP_ROUTES = new Set(['/dashboard', '/settings', '/shop']);

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
      if (body.sounds !== undefined) {
        updates.sounds = parseSoundsUpdate(body.sounds);
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
        days: parseDays(body.days),
        completions: [],
        earnings: {},
      };
      profile.habits.push(habit);
      await saveState();
      return sendJson(res, 201, toPublic(habit));
    }

    if (req.method === 'DELETE') {
      profile.habits = [];
      profile.retiredEarnings = {};
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
      if (body.days !== undefined) updates.days = parseDays(body.days);

      if (Object.keys(updates).length === 0) {
        throw httpError(400, 'Nothing to update.');
      }

      Object.assign(habit, updates);
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

loadState().then(() => {
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

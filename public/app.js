'use strict';

const els = {
  date: document.getElementById('date'),
  appIcon: document.getElementById('app-icon'),
  appIconArt: document.getElementById('app-icon-art'),
  iconPanel: document.getElementById('icon-panel'),
  iconPanelClose: document.getElementById('icon-panel-close'),
  iconPresets: document.getElementById('icon-presets'),
  iconForm: document.getElementById('icon-form'),
  iconName: document.getElementById('icon-name'),
  iconUrl: document.getElementById('icon-url'),
  iconCustomList: document.getElementById('icon-custom-list'),
  appearanceToggle: document.getElementById('appearance-toggle'),
  appearanceLabel: document.getElementById('appearance-label'),
  profileTabs: document.getElementById('profile-tabs'),
  profileSections: document.getElementById('profile-sections'),
  profileList: document.getElementById('profile-list'),
  profileAdd: document.getElementById('profile-add'),
  etherForm: document.getElementById('ether-form'),
  etherFactor: document.getElementById('ether-factor'),
  urgencyForm: document.getElementById('urgency-form'),
  urgencyFactor: document.getElementById('urgency-factor'),
  habitSound: document.getElementById('habit-sound'),
  purchaseSound: document.getElementById('purchase-sound'),
  soundPreviews: document.querySelectorAll('[data-preview]'),
  soundForm: document.getElementById('sound-form'),
  soundName: document.getElementById('sound-name'),
  soundUrl: document.getElementById('sound-url'),
  soundList: document.getElementById('sound-list'),
  etherTotal: document.getElementById('ether-total'),
  etherToday: document.getElementById('ether-today'),
  etherRange: document.getElementById('ether-range'),
  etherRangeLabel: document.getElementById('ether-range-label'),
  etherPenalties: document.getElementById('ether-penalties'),
  dashboardRange: document.getElementById('dashboard-range'),
  dashboardTabs: document.getElementById('dashboard-tabs'),
  dashboardEtherPanel: document.getElementById('dashboard-panel-ether'),
  dashboardHabitsPanel: document.getElementById('dashboard-panel-habits'),
  dashboardList: document.getElementById('dashboard-list'),
  dashboardHabits: document.getElementById('dashboard-habits'),
  shopAddToggle: document.getElementById('shop-add-toggle'),
  shopForm: document.getElementById('shop-form'),
  shopFormClose: document.getElementById('shop-form-close'),
  shopName: document.getElementById('shop-name'),
  shopLink: document.getElementById('shop-link'),
  shopLookup: document.getElementById('shop-lookup'),
  shopLookupStatus: document.getElementById('shop-lookup-status'),
  shopBookmarklet: document.getElementById('shop-bookmarklet'),
  shopCost: document.getElementById('shop-cost'),
  shopImage: document.getElementById('shop-image'),
  shopConsumable: document.getElementById('shop-consumable'),
  shopList: document.getElementById('shop-list'),
  shopEmpty: document.getElementById('shop-empty'),
  shopBalance: document.getElementById('shop-balance'),
  jobActor: document.getElementById('job-actor'),
  jobForm: document.getElementById('job-form'),
  jobTitle: document.getElementById('job-title'),
  jobReward: document.getElementById('job-reward'),
  jobEta: document.getElementById('job-eta'),
  jobInbox: document.getElementById('jobs-inbox'),
  jobInboxEmpty: document.getElementById('jobs-inbox-empty'),
  jobInboxCount: document.getElementById('jobs-inbox-count'),
  jobProgress: document.getElementById('jobs-progress'),
  jobProgressCount: document.getElementById('jobs-progress-count'),
  jobCompleted: document.getElementById('jobs-completed'),
  jobCompletedBox: document.getElementById('jobs-completed-box'),
  jobCompletedEmpty: document.getElementById('jobs-completed-empty'),
  jobCompletedCount: document.getElementById('jobs-completed-count'),
  jobFailed: document.getElementById('jobs-failed'),
  jobFailedEmpty: document.getElementById('jobs-failed-empty'),
  jobFailedCount: document.getElementById('jobs-failed-count'),
  jobStatus: document.getElementById('jobs-status'),
  pages: {
    habits: document.getElementById('page-habits'),
    dashboard: document.getElementById('page-dashboard'),
    jobs: document.getElementById('page-jobs'),
    shop: document.getElementById('page-shop'),
    settings: document.getElementById('page-settings'),
  },
  navLinks: document.querySelectorAll('[data-nav]'),
};

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const parseHabitInput = window.HabitInput.parseHabitInput;
const formatJobDuration = window.JobMath.formatDuration;
const parseAmazonLink = window.AmazonLink.parseAmazonLink;
// Display weeks starting on Monday; the wire format stays 0 = Sunday.
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
// Colours live in styles.css as [data-theme="..."] blocks; keep ids in sync.
const THEMES = [
  { id: 'ember', name: 'Ember' },
  { id: 'blue', name: 'Blue' },
  { id: 'teal', name: 'Teal' },
  { id: 'violet', name: 'Violet' },
];
// Built-in sounds are synthesised; custom sounds come from settings.sounds.custom.
const SOUND_PRESETS = [
  { id: 'chime', label: 'Chime', notes: [523.25, 659.25, 783.99] },
  { id: 'sparkle', label: 'Sparkle', notes: [880, 1108.73, 1318.51, 1760] },
  { id: 'pop', label: 'Pop', notes: [660, 880] },
  { id: 'bell', label: 'Bell', notes: [783.99, 1046.5, 1318.51] },
  { id: 'off', label: 'Off', notes: null },
];
// Built-in icons are inline SVG paths; custom icons come from settings.icon.custom.
const ICON_PRESETS = [
  {
    id: 'flame',
    label: 'Flame',
    path: 'M12.6 2.2c.4 3.3-1.4 4.9-2.9 6.6C8 10.7 6.4 12.6 6.4 15a5.6 5.6 0 0 0 11.2 0c0-2.3-1-4.2-2.5-5.7-.2 1.5-1 2.5-2 2.8.5-3.3-.1-6.9-1.5-9.9Z',
  },
  {
    id: 'spark',
    label: 'Spark',
    path: 'M12 2l2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2Z',
  },
  { id: 'bolt', label: 'Bolt', path: 'M13 2 4 14h6l-1 8 9-12h-6l1-8Z' },
  {
    id: 'moon',
    label: 'Moon',
    path: 'M20.7 14.2A8.7 8.7 0 0 1 9.8 3.3 8.8 8.8 0 1 0 20.7 14.2Z',
  },
  { id: 'gem', label: 'Gem', path: 'M12 2 2.5 8.8 12 22l9.5-13.2L12 2Z' },
  {
    id: 'heart',
    label: 'Heart',
    path: 'M12 21s-8-5.1-8-11a4.6 4.6 0 0 1 8-3 4.6 4.6 0 0 1 8 3c0 5.9-8 11-8 11Z',
  },
];
const PAGE_PATH = window.location.pathname.replace(/\/+$/, '') || '/';
const PAGE =
  PAGE_PATH === '/dashboard'
    ? 'dashboard'
    : PAGE_PATH === '/settings'
      ? 'settings'
      : PAGE_PATH === '/shop'
        ? 'shop'
        : PAGE_PATH === '/jobs'
          ? 'jobs'
          : 'habits';
const DASHBOARD_RANGE_KEY = 'grindwell.dashboardRange';
const DASHBOARD_VIEW_KEY = 'grindwell.dashboardView';
const APPEARANCE_KEY = 'grindwell.appearance';
const APPEARANCE_COLORS = { dark: '#100d0b', light: '#f6f2ec' };
const SVG_NS = 'http://www.w3.org/2000/svg';
const STAR_PATH =
  'M12 2.2l2.94 6.02 6.64.96-4.79 4.67 1.13 6.61L12 17.36l-5.92 3.1 1.13-6.61L2.42 9.18l6.64-.96L12 2.2z';

let profiles = [];
let settings = {
  etherFactor: 1,
  urgencyFactor: 1,
  sounds: { habit: 'chime', purchase: 'pop', custom: [] },
  icon: { id: 'flame', custom: [] },
};
let shop = { items: [] };
let lookup = { amazon: false, mode: 'off' };
const shopLookupState = { attempted: '', pending: false };
let shopLookupTimer = null;
let jobs = { inbox: [], inProgress: [], completed: [], failed: [] };
let jobLimits = { maxInProgress: 3, terminalShown: 10 };
let jobActorId = null;
let jobNow = Date.now();
let today = '';
let activeTabId = null;
let dashboardRange = storedDashboardRange();
let dashboardView = storedDashboardView();
let appearance = document.documentElement.dataset.appearance === 'light' ? 'light' : 'dark';
let toastTimer = null;
let audioContext = null;
const customAudio = new Map();
let editingKey = null;
let editDraft = null;

/* ---------- utilities ---------- */

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body && body.error) message = body.error;
    } catch {
      /* keep the default message */
    }
    throw new Error(message);
  }

  return res.status === 204 ? null : res.json();
}

function toast(message) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

// Short chimes, synthesised so the app stays asset-free.
function ensureAudioContext() {
  const Audio = window.AudioContext || window.webkitAudioContext;
  if (!Audio) return null;

  try {
    if (!audioContext) audioContext = new Audio();
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
    return audioContext;
  } catch {
    return null;
  }
}

function playChime(frequencies) {
  const context = ensureAudioContext();
  if (!context) return;

  try {
    const now = context.currentTime;

    frequencies.forEach((frequency, index) => {
      const start = now + index * 0.11;
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = 'triangle';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.16, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);

      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.24);
    });
  } catch {
    /* Sound is a bonus; never block the action. */
  }
}

function customSounds() {
  const list = settings.sounds && settings.sounds.custom;
  return Array.isArray(list) ? list : [];
}

function playAudioUrl(url) {
  try {
    let audio = customAudio.get(url);
    if (!audio) {
      audio = new window.Audio(url);
      audio.preload = 'auto';
      customAudio.set(url, audio);
    }
    audio.currentTime = 0;
    const playback = audio.play();
    if (playback && typeof playback.catch === 'function') playback.catch(() => {});
  } catch {
    /* Sound is a bonus; never block the action. */
  }
}

function playSound(id) {
  if (!id || id === 'off') return;

  const custom = customSounds().find((sound) => sound.id === id);
  if (custom) {
    playAudioUrl(custom.url);
    return;
  }

  const preset = SOUND_PRESETS.find((sound) => sound.id === id);
  if (preset && preset.notes) playChime(preset.notes);
}

function playPurchaseSound() {
  playSound((settings.sounds && settings.sounds.purchase) || 'pop');
}

function playHabitSound() {
  playSound((settings.sounds && settings.sounds.habit) || 'chime');
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function localDayKey() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
}

function difficultyBand(value) {
  if (value <= 3) return { key: 'easy', word: 'easy' };
  if (value <= 7) return { key: 'moderate', word: 'moderate' };
  return { key: 'hard', word: 'hard' };
}

// Difficulty is stored 1–10 but shown as 0.5–5 stars.
function starRating(difficulty) {
  const rating = Math.max(0.5, Math.min(5, Number(difficulty) / 2));
  const wrap = document.createElement('span');
  wrap.className = 'stars';
  wrap.setAttribute('role', 'img');
  wrap.setAttribute('aria-label', `Difficulty ${rating} out of 5 stars`);
  wrap.title = `Difficulty ${rating}/5`;

  for (let index = 1; index <= 5; index += 1) {
    const fill = rating >= index ? 'full' : rating >= index - 0.5 ? 'half' : 'empty';
    const star = document.createElement('span');
    star.className = 'star';
    star.dataset.fill = fill;
    star.innerHTML =
      `<svg class="star-base" viewBox="0 0 24 24" aria-hidden="true"><path d="${STAR_PATH}"/></svg>` +
      `<svg class="star-fill" viewBox="0 0 24 24" aria-hidden="true"><path d="${STAR_PATH}"/></svg>`;
    wrap.append(star);
  }

  return wrap;
}

function storedDashboardRange() {
  try {
    return localStorage.getItem(DASHBOARD_RANGE_KEY) === 'month' ? 'month' : 'week';
  } catch {
    return 'week';
  }
}

function rememberDashboardRange(value) {
  try {
    localStorage.setItem(DASHBOARD_RANGE_KEY, value);
  } catch {
    /* storage may be unavailable; the in-memory value still works */
  }
}

function storedDashboardView() {
  try {
    return localStorage.getItem(DASHBOARD_VIEW_KEY) === 'habit' ? 'habit' : 'ether';
  } catch {
    return 'ether';
  }
}

function rememberDashboardView(value) {
  try {
    localStorage.setItem(DASHBOARD_VIEW_KEY, value);
  } catch {
    /* storage may be unavailable; the in-memory value still works */
  }
}

function rememberAppearance(value) {
  try {
    localStorage.setItem(APPEARANCE_KEY, value);
  } catch {
    /* storage may be unavailable; the in-memory value still works */
  }
}

function applyAppearance(next, { persist = true } = {}) {
  appearance = next === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.appearance = appearance;

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', APPEARANCE_COLORS[appearance]);

  if (els.appearanceToggle) {
    const light = appearance === 'light';
    els.appearanceToggle.setAttribute('aria-pressed', String(light));
    els.appearanceToggle.setAttribute(
      'aria-label',
      light ? 'Light mode. Switch to dark mode.' : 'Dark mode. Switch to light mode.',
    );
    els.appearanceToggle.title = light ? 'Switch to dark mode' : 'Switch to light mode';
  }

  if (els.appearanceLabel) {
    els.appearanceLabel.textContent = appearance === 'light' ? 'Light' : 'Dark';
  }

  if (persist) rememberAppearance(appearance);
}

function rangeLabel() {
  return dashboardRange === 'month' ? 'Last 30 days' : 'Last 7 days';
}

function rangeDays(summary) {
  const days = Array.isArray(summary.days) ? summary.days : [];
  return dashboardRange === 'month' ? days.slice(-30) : days.slice(-7);
}

function rangeNet(summary) {
  return dashboardRange === 'month'
    ? Number(summary.netLast30) || 0
    : Number(summary.netLast7) || 0;
}

function rangePenalty(summary) {
  return dashboardRange === 'month'
    ? Number(summary.penaltyLast30) || 0
    : Number(summary.penaltyLast7) || 0;
}

// Every profile summary covers the same 30 days, so the selected range can be
// sliced once per profile when rendering its own chart.
function rangeCompletions(days) {
  return days.reduce((sum, day) => sum + day.completed, 0);
}

function rangeMissed(days) {
  return days.reduce((sum, day) => sum + (Number(day.missed) || 0), 0);
}

function syncDifficulty(input, output) {
  const value = Number(input.value);
  const { word } = difficultyBand(value);
  output.textContent = String(value);
  input.setAttribute('aria-valuetext', `${value} out of 10, ${word}`);
}

function syncUrgency(input, output) {
  const value = Number(input.value);
  output.textContent = String(value);
  input.setAttribute(
    'aria-valuetext',
    value === 0 ? '0, penalties off' : `${value} out of 10`,
  );
}

function selectedDays(container) {
  return [...container.querySelectorAll('.day')]
    .filter((button) => button.getAttribute('aria-pressed') === 'true')
    .map((button) => Number(button.dataset.day))
    .sort((a, b) => a - b);
}

function scheduleLabel(days) {
  if (days.length === 7) return 'Daily';
  const selected = new Set(days);
  return WEEK_ORDER.filter((day) => selected.has(day))
    .map((day) => DAY_SHORT[day])
    .join(', ');
}

function themeName(id) {
  return THEMES.find((theme) => theme.id === id)?.name || THEMES[0].name;
}

function habitKey(profile, habit) {
  return `${profile.id}:${habit.id}`;
}

function profileQuery(profile) {
  return `?profile=${encodeURIComponent(profile.id)}`;
}

function themeDot() {
  const dot = document.createElement('span');
  dot.className = 'theme-dot';
  dot.setAttribute('aria-hidden', 'true');
  return dot;
}

function etherIcon(className = 'ether-icon') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', '#icon-ether');
  svg.append(use);
  return svg;
}

/* ---------- pages ---------- */

function applyPage() {
  document.body.dataset.page = PAGE;

  for (const [name, node] of Object.entries(els.pages)) {
    if (node) node.hidden = name !== PAGE;
  }

  for (const link of els.navLinks) {
    if (link.dataset.nav === PAGE) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

/* ---------- profiles ---------- */

function themePicker(profile) {
  const group = document.createElement('div');
  group.className = 'theme-picker';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', `Theme for ${profile.name}`);

  for (const theme of THEMES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'swatch';
    button.dataset.theme = theme.id;
    button.title = theme.name;
    button.setAttribute('aria-label', `${theme.name} theme for ${profile.name}`);
    button.setAttribute('aria-pressed', String(profile.theme === theme.id));

    button.append(themeDot());
    button.addEventListener('click', () => setProfileTheme(profile, theme.id));
    group.append(button);
  }

  return group;
}

function renderProfileSettings() {
  const nodes = profiles.map((profile) => {
    const item = document.createElement('li');
    item.className = 'profile-setting';
    item.dataset.theme = profile.theme;

    const main = document.createElement('div');
    main.className = 'profile-setting-main';

    const name = document.createElement('span');
    name.className = 'profile-setting-name';
    name.textContent = profile.name;

    const meta = document.createElement('span');
    meta.className = 'profile-setting-meta';
    meta.textContent = `${plural(profile.habitCount, 'habit')} · ${plural(profile.ether, 'ether')}`;

    main.append(name, meta);

    const rename = document.createElement('button');
    rename.type = 'button';
    rename.className = 'profile-icon';
    rename.textContent = '✎';
    rename.title = `Rename ${profile.name}`;
    rename.setAttribute('aria-label', `Rename ${profile.name}`);
    rename.addEventListener('click', () => renameProfile(profile));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'profile-icon';
    remove.textContent = '×';
    remove.title = `Delete ${profile.name}`;
    remove.setAttribute('aria-label', `Delete ${profile.name}`);
    remove.disabled = profiles.length === 1;
    remove.addEventListener('click', () => deleteProfile(profile));

    item.append(themeDot(), main, themePicker(profile), rename, remove);
    return item;
  });

  els.profileList.replaceChildren(...nodes);
}

async function setProfileTheme(profile, themeId) {
  if (profile.theme === themeId) return;

  try {
    const updated = await api(`/api/profiles/${profile.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ theme: themeId }),
    });
    profile.theme = updated.theme;
    renderProfileSettings();
    renderHabits();
    renderDashboard();
    renderShop();
    toast(`${profile.name} now uses the ${themeName(profile.theme)} theme.`);
  } catch (error) {
    toast(error.message);
  }
}

async function createProfile() {
  const name = window.prompt('Name for the new profile:');
  if (!name || !name.trim()) return;

  try {
    const created = await api('/api/profiles', {
      method: 'POST',
      body: JSON.stringify({ name, theme: THEMES[0].id }),
    });
    activeTabId = created.id;
    await load({ silent: true });
    toast(`Profile "${name.trim()}" added.`);
  } catch (error) {
    toast(error.message);
  }
}

async function renameProfile(profile) {
  const name = window.prompt('Rename profile:', profile.name);
  if (!name || !name.trim() || name.trim() === profile.name) return;

  try {
    await api(`/api/profiles/${profile.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    });
    await load({ silent: true });
  } catch (error) {
    toast(error.message);
  }
}

async function deleteProfile(profile) {
  if (profiles.length === 1) {
    toast('Keep at least one profile.');
    return;
  }
  if (!window.confirm(`Delete profile "${profile.name}" and all its habits? This cannot be undone.`)) {
    return;
  }

  try {
    await api(`/api/profiles/${profile.id}`, { method: 'DELETE' });
    if (activeTabId === profile.id) activeTabId = null;
    await load({ silent: true });
    toast(`Profile "${profile.name}" deleted.`);
  } catch (error) {
    toast(error.message);
  }
}

/* ---------- habits ---------- */

function visibleProfile() {
  return profiles.find((profile) => profile.id === activeTabId) || profiles[0] || null;
}

function focusTab(id) {
  els.profileTabs.querySelector(`[data-profile="${id}"]`)?.focus();
}

function selectProfileTab(id, { focus = false } = {}) {
  if (!profiles.some((profile) => profile.id === id)) return;

  if (activeTabId !== id) {
    activeTabId = id;
    // Switching tabs abandons any half-finished inline edit.
    editingKey = null;
    editDraft = null;
    renderHabits();
  }

  if (focus) focusTab(id);

  // Keep the server's active profile in step so a reload lands on the same tab.
  api(`/api/profiles/${id}/activate`, { method: 'POST' }).catch(() => {
    /* the tab still works even if activation fails */
  });
}

function onTabKeydown(event) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;

  const index = profiles.findIndex((profile) => profile.id === activeTabId);
  if (index === -1) return;

  event.preventDefault();
  let next = index;
  if (event.key === 'ArrowRight') next = (index + 1) % profiles.length;
  if (event.key === 'ArrowLeft') next = (index - 1 + profiles.length) % profiles.length;
  if (event.key === 'Home') next = 0;
  if (event.key === 'End') next = profiles.length - 1;
  selectProfileTab(profiles[next].id, { focus: true });
}

function renderProfileTabs(current) {
  const tabs = profiles.map((profile) => {
    const selected = profile.id === current?.id;
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'profile-tab';
    tab.dataset.profile = profile.id;
    tab.dataset.theme = profile.theme;
    tab.id = `profile-tab-${profile.id}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(selected));
    if (selected) tab.setAttribute('aria-controls', `profile-panel-${profile.id}`);
    tab.tabIndex = selected ? 0 : -1;
    tab.title = `Show ${profile.name}'s habits`;
    tab.append(themeDot(), document.createTextNode(profile.name));
    tab.addEventListener('click', () => selectProfileTab(profile.id, { focus: true }));
    tab.addEventListener('keydown', onTabKeydown);
    return tab;
  });

  els.profileTabs.replaceChildren(...tabs);
}

function focusAddInput(profileId) {
  const input = els.profileSections.querySelector(
    `[data-profile="${profileId}"] .add .text-input`,
  );
  input?.focus();
}

function habitNode(profile, habit) {
  const li = document.createElement('li');
  li.dataset.id = habit.id;
  li.className =
    'habit' + (habit.doneToday ? ' is-done' : '') + (habit.dueToday ? '' : ' is-rest');

  // Editing happens in place: the card itself becomes the form.
  if (editingKey === habitKey(profile, habit)) {
    li.classList.add('is-editing');
    li.append(editFormNode(profile, habit));
    return li;
  }

  const check = document.createElement('button');
  check.type = 'button';
  check.className = 'check';
  // A rest day cannot be completed. If an old off-day completion exists,
  // keep the control usable so it can be cleared.
  const locked = !habit.dueToday && !habit.doneToday;
  check.disabled = locked;
  check.setAttribute('aria-pressed', String(habit.doneToday));
  if (locked) {
    check.title = 'Not scheduled today';
    check.setAttribute('aria-label', `"${habit.name}" is not scheduled today`);
  } else {
    check.setAttribute(
      'aria-label',
      `Mark "${habit.name}" as ${habit.doneToday ? 'not done' : 'done'} today`,
    );
  }
  check.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
  check.addEventListener('click', () => toggleHabit(profile, habit.id));

  const main = document.createElement('div');
  main.className = 'habit-main';

  const name = document.createElement('span');
  name.className = 'habit-name';
  name.textContent = habit.name;

  const meta = document.createElement('span');
  meta.className = 'habit-meta';

  const streak = document.createElement('span');
  streak.textContent = habit.streak > 0 ? `🔥 ${plural(habit.streak, 'day')} streak` : 'No streak yet';

  meta.append(streak, starRating(habit.difficulty));

  if (habit.urgency > 0 && habit.penalty > 0) {
    const penalty = document.createElement('span');
    penalty.className = 'chip chip-penalty';
    penalty.textContent = `−${habit.penalty} if missed`;
    penalty.title = `Urgency ${habit.urgency} of 10`;
    meta.append(penalty);
  }

  if (!habit.dueToday) {
    const rest = document.createElement('span');
    rest.className = 'chip chip-rest';
    rest.textContent = 'Rest day';
    rest.title = `Scheduled ${scheduleLabel(habit.days)}`;
    meta.append(rest);
  } else if (habit.days.length < 7) {
    const schedule = document.createElement('span');
    schedule.className = 'habit-days';
    schedule.textContent = scheduleLabel(habit.days);
    schedule.title = `Scheduled ${scheduleLabel(habit.days)}`;
    meta.append(schedule);
  }

  main.append(name, meta);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'del';
  remove.setAttribute('aria-label', `Delete "${habit.name}"`);
  remove.textContent = '×';
  remove.addEventListener('click', () => deleteHabit(profile, habit));

  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'edit';
  edit.setAttribute('aria-label', `Edit "${habit.name}"`);
  edit.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h3.5L18.6 8.9a2.1 2.1 0 0 0-3-3L4.5 17Z"/><path d="m13.6 6.9 3 3"/></svg>';
  edit.addEventListener('click', () => openEdit(profile, habit));

  li.append(check, main, edit, remove);
  return li;
}

function editFormNode(profile, habit) {
  const key = habitKey(profile, habit);
  const draft = editDraft && editDraft.key === key ? editDraft : habit;

  const form = document.createElement('form');
  form.className = 'habit-edit';
  form.setAttribute('aria-label', `Edit "${habit.name}"`);

  const title = document.createElement('p');
  title.className = 'habit-edit-title';
  title.textContent = `Edit habit for ${profile.name}`;

  const nameInput = document.createElement('input');
  nameInput.className = 'text-input';
  nameInput.type = 'text';
  nameInput.name = 'name';
  nameInput.maxLength = 60;
  nameInput.required = true;
  nameInput.value = draft.name;
  nameInput.setAttribute('aria-label', 'Habit name');
  nameInput.addEventListener('input', () => {
    if (editDraft && editDraft.key === key) editDraft.name = nameInput.value;
  });

  const difficultyField = document.createElement('div');
  difficultyField.className = 'field';

  const difficultyLabel = document.createElement('label');
  difficultyLabel.textContent = 'Difficulty';
  difficultyLabel.htmlFor = `edit-difficulty-${habit.id}`;

  const difficultyInput = document.createElement('input');
  difficultyInput.id = `edit-difficulty-${habit.id}`;
  difficultyInput.type = 'range';
  difficultyInput.min = '1';
  difficultyInput.max = '10';
  difficultyInput.step = '1';
  difficultyInput.value = String(draft.difficulty);
  difficultyInput.setAttribute('aria-describedby', `edit-difficulty-value-${habit.id}`);

  const difficultyOutput = document.createElement('output');
  difficultyOutput.id = `edit-difficulty-value-${habit.id}`;
  difficultyOutput.htmlFor = difficultyInput.id;
  difficultyOutput.textContent = String(draft.difficulty);

  difficultyInput.addEventListener('input', () => {
    syncDifficulty(difficultyInput, difficultyOutput);
    if (editDraft && editDraft.key === key) {
      editDraft.difficulty = Number(difficultyInput.value);
    }
  });
  syncDifficulty(difficultyInput, difficultyOutput);

  difficultyField.append(difficultyLabel, difficultyInput, difficultyOutput);

  const urgencyField = document.createElement('div');
  urgencyField.className = 'field';

  const urgencyLabel = document.createElement('label');
  urgencyLabel.textContent = 'Urgency';
  urgencyLabel.htmlFor = `edit-urgency-${habit.id}`;

  const urgencyInput = document.createElement('input');
  urgencyInput.id = `edit-urgency-${habit.id}`;
  urgencyInput.type = 'range';
  urgencyInput.min = '0';
  urgencyInput.max = '10';
  urgencyInput.step = '1';
  urgencyInput.value = String(draft.urgency);
  urgencyInput.setAttribute('aria-describedby', `edit-urgency-value-${habit.id}`);

  const urgencyOutput = document.createElement('output');
  urgencyOutput.id = `edit-urgency-value-${habit.id}`;
  urgencyOutput.htmlFor = urgencyInput.id;
  urgencyOutput.textContent = String(draft.urgency);

  urgencyInput.addEventListener('input', () => {
    syncUrgency(urgencyInput, urgencyOutput);
    if (editDraft && editDraft.key === key) {
      editDraft.urgency = Number(urgencyInput.value);
    }
  });
  syncUrgency(urgencyInput, urgencyOutput);

  urgencyField.append(urgencyLabel, urgencyInput, urgencyOutput);

  const daysField = document.createElement('div');
  daysField.className = 'field';

  const daysLabel = document.createElement('span');
  daysLabel.className = 'field-label';
  daysLabel.id = `edit-days-label-${habit.id}`;
  daysLabel.textContent = 'Schedule';

  const days = document.createElement('div');
  days.className = 'days';
  days.setAttribute('role', 'group');
  days.setAttribute('aria-labelledby', daysLabel.id);

  for (const day of WEEK_ORDER) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'day';
    button.dataset.day = String(day);
    button.textContent = DAY_SHORT[day].slice(0, 2);
    button.title = DAY_NAMES[day];
    button.setAttribute('aria-pressed', String(draft.days.includes(day)));
    button.addEventListener('click', () => {
      const pressed = button.getAttribute('aria-pressed') === 'true';
      button.setAttribute('aria-pressed', String(!pressed));
      if (editDraft && editDraft.key === key) editDraft.days = selectedDays(days);
    });
    days.append(button);
  }

  daysField.append(daysLabel, days);

  const actions = document.createElement('div');
  actions.className = 'habit-edit-actions';

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'ghost';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => closeEdit(profile, habit.id));

  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'primary';
  save.textContent = 'Save';

  actions.append(cancel, save);

  form.append(title, nameInput, difficultyField, urgencyField, daysField, actions);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    saveEdit(profile, habit, {
      name: nameInput.value,
      difficulty: Number(difficultyInput.value),
      urgency: Number(urgencyInput.value),
      days: selectedDays(days),
      save,
    });
  });

  return form;
}

function profileSection(profile) {
  const section = document.createElement('section');
  section.className = 'profile-section';
  section.dataset.profile = profile.id;
  section.dataset.theme = profile.theme;
  section.id = `profile-panel-${profile.id}`;
  section.setAttribute('role', 'tabpanel');
  section.setAttribute('aria-labelledby', `profile-tab-${profile.id}`);

  const head = document.createElement('header');
  head.className = 'profile-section-head';

  const titleWrap = document.createElement('div');
  titleWrap.className = 'profile-section-title-wrap';

  const title = document.createElement('h3');
  title.className = 'profile-section-title';
  title.append(themeDot(), document.createTextNode(profile.name));

  const meta = document.createElement('p');
  meta.className = 'profile-section-meta';
  meta.textContent = `${plural(profile.habitCount, 'habit')} · ${plural(profile.ether, 'ether')}`;

  titleWrap.append(title, meta);

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'reset profile-reset';
  reset.textContent = 'Reset';
  reset.title = `Delete ${profile.name}'s habits, history, and ether`;
  reset.setAttribute('aria-label', `Reset all habits and ether for ${profile.name}`);
  reset.disabled =
    profile.habits.length === 0 && profile.ether === 0 && !(profile.penalties > 0);
  reset.addEventListener('click', () => resetHabits(profile));

  head.append(titleWrap, reset);
  section.append(head);

  // Progress only counts habits that are actually due today.
  const due = profile.habits.filter((habit) => habit.dueToday);
  const total = due.length;
  const done = due.filter((habit) => habit.doneToday).length;
  const percent = total ? Math.round((done / total) * 100) : 0;

  const progress = document.createElement('section');
  progress.className = 'progress-card profile-progress';
  progress.setAttribute('aria-live', 'polite');

  const progressText = document.createElement('p');
  progressText.className = 'progress-text';
  const doneStrong = document.createElement('strong');
  doneStrong.textContent = String(done);
  progressText.append(doneStrong, document.createTextNode(` of ${total} done today`));

  const bar = document.createElement('div');
  bar.className = 'bar';
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-label', `${profile.name} habits completed today`);
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  bar.setAttribute('aria-valuenow', String(percent));

  const fill = document.createElement('div');
  fill.className = 'bar-fill';
  fill.style.width = `${percent}%`;
  bar.append(fill);

  const hint = document.createElement('p');
  hint.className = 'hint';
  if (profile.habits.length === 0) {
    hint.textContent = 'No habits yet. Add the first one below.';
  } else if (total === 0) {
    hint.textContent = 'Nothing scheduled today. Rest up.';
  } else if (done === total) {
    hint.textContent = 'All done for today. Well forged.';
  } else {
    hint.textContent = `${plural(total - done, 'habit')} left today.`;
  }

  progress.append(progressText, bar, hint);
  section.append(progress);

  const form = document.createElement('form');
  form.className = 'add';
  form.autocomplete = 'off';

  const row = document.createElement('div');
  row.className = 'add-row';

  const label = document.createElement('label');
  label.className = 'sr-only';
  label.htmlFor = `habit-input-${profile.id}`;
  label.textContent = `New habit for ${profile.name}`;

  const input = document.createElement('input');
  input.className = 'text-input';
  input.id = `habit-input-${profile.id}`;
  input.name = 'name';
  input.type = 'text';
  input.placeholder = 'Read 10 pages ; 6 ; 3 ; sat,sun';
  input.maxLength = 100;
  input.required = true;

  const button = document.createElement('button');
  button.type = 'submit';
  button.textContent = 'Add';

  row.append(label, input, button);
  form.append(row);
  form.addEventListener('submit', (event) => addHabit(event, profile, input, button));
  section.append(form);

  const list = document.createElement('ul');
  list.className = 'habits';
  list.setAttribute('aria-label', `${profile.name} habits`);

  // Rest-day habits stay visible but sink below today's work.
  const ordered = [...profile.habits].sort((a, b) => Number(b.dueToday) - Number(a.dueToday));
  list.replaceChildren(...ordered.map((habit) => habitNode(profile, habit)));
  section.append(list);

  const empty = document.createElement('p');
  empty.className = 'empty';
  empty.textContent = 'No habits yet. Add your first one above.';
  empty.hidden = profile.habits.length !== 0;
  section.append(empty);

  return section;
}

function renderHabits() {
  const current = visibleProfile();
  renderProfileTabs(current);
  els.profileSections.replaceChildren(...(current ? [profileSection(current)] : []));
}

/* ---------- dashboard ---------- */

function statNode(label, value) {
  const wrap = document.createElement('div');
  const term = document.createElement('dt');
  term.textContent = label;
  const detail = document.createElement('dd');
  detail.textContent = String(value);
  wrap.append(term, detail);
  return wrap;
}

function etherChartNode(days, profileName) {
  const monthly = dashboardRange === 'month';
  const hasNegative = days.some((day) => (Number(day.net) || 0) < 0);
  const chart = document.createElement('div');
  chart.className =
    'ether-chart' + (monthly ? ' is-month' : '') + (hasNegative ? ' has-negative' : '');
  chart.setAttribute('role', 'img');
  chart.setAttribute(
    'aria-label',
    `Net ether per day over the ${rangeLabel().toLowerCase()} for ${profileName}`,
  );

  const max = Math.max(1, ...days.map((day) => Math.abs(Number(day.net) || 0)));
  const nodes = days.map((day, index) => {
    const [year, month, date] = day.date.split('-').map(Number);
    const weekday = DAY_SHORT[new Date(year, month - 1, date).getDay()];
    const showLabel = !monthly || index % 5 === 0 || index === days.length - 1;
    const net = Number(day.net) || 0;

    const column = document.createElement('div');
    column.className = 'ether-day' + (day.date === today ? ' is-today' : '');

    if (!monthly) {
      const value = document.createElement('span');
      value.className = 'ether-day-value';
      value.textContent = String(net);
      column.append(value);
    }

    const track = document.createElement('div');
    track.className = 'ether-bar-track';

    const bar = document.createElement('div');
    bar.className = 'ether-bar' + (net < 0 ? ' is-negative' : '');
    const share = Math.round((Math.abs(net) / max) * (hasNegative ? 50 : 100));
    bar.style.height = `${share}%`;
    if (hasNegative) {
      if (net < 0) {
        bar.style.top = '50%';
        bar.style.bottom = 'auto';
      } else {
        bar.style.bottom = '50%';
      }
    }
    track.append(bar);

    const name = document.createElement('span');
    name.className = 'ether-day-label';
    name.textContent = showLabel ? (monthly ? String(date) : weekday) : '';

    column.append(track, name);
    column.title = day.penalty
      ? `${day.date}: ${day.ether} earned, ${day.penalty} lost (${net} net)`
      : `${day.date}: ${net} net ether`;
    return column;
  });

  chart.replaceChildren(...nodes);
  return chart;
}

function completionChart(days, profileName) {
  const monthly = dashboardRange === 'month';
  const hasMissed = days.some((day) => (Number(day.missed) || 0) > 0);
  const chart = document.createElement('div');
  chart.className =
    'ether-chart habit-chart' +
    (monthly ? ' is-month' : '') +
    (hasMissed ? ' has-negative' : '');
  chart.setAttribute('role', 'img');
  chart.setAttribute(
    'aria-label',
    `Habits completed and missed per day over the ${rangeLabel().toLowerCase()} for ${profileName}`,
  );

  // Completed and missed counts share one scale so the bars line up: completed
  // grows up from the midline, missed grows down.
  const max = Math.max(
    1,
    ...days.map((day) => Math.max(Number(day.completed) || 0, Number(day.missed) || 0)),
  );
  const nodes = days.map((day, index) => {
    const [year, month, date] = day.date.split('-').map(Number);
    const weekday = DAY_SHORT[new Date(year, month - 1, date).getDay()];
    const showLabel = !monthly || index % 5 === 0 || index === days.length - 1;
    const completed = Number(day.completed) || 0;
    const missed = Number(day.missed) || 0;

    const column = document.createElement('div');
    column.className = 'ether-day' + (day.date === today ? ' is-today' : '');

    if (!monthly) {
      const value = document.createElement('span');
      value.className = 'ether-day-value';
      value.textContent = String(completed);
      column.append(value);
    }

    const track = document.createElement('div');
    track.className = 'ether-bar-track';

    const up = document.createElement('div');
    up.className = 'ether-bar';
    up.style.height = `${Math.round((completed / max) * (hasMissed ? 50 : 100))}%`;
    if (hasMissed) up.style.bottom = '50%';
    track.append(up);

    if (hasMissed) {
      const down = document.createElement('div');
      down.className = 'ether-bar is-negative';
      down.style.height = `${Math.round((missed / max) * 50)}%`;
      down.style.top = '50%';
      down.style.bottom = 'auto';
      track.append(down);
    }

    const name = document.createElement('span');
    name.className = 'ether-day-label';
    name.textContent = showLabel ? (monthly ? String(date) : weekday) : '';

    if (monthly) {
      column.append(track, name);
    } else {
      const missedValue = document.createElement('span');
      missedValue.className = 'ether-day-value ether-day-missed';
      missedValue.textContent = hasMissed ? (missed > 0 ? `−${missed}` : '0') : '';
      column.append(track, missedValue, name);
    }

    column.title = `${day.date}: ${completed} completed, ${missed} missed`;
    return column;
  });

  chart.replaceChildren(...nodes);
  return chart;
}

function habitTrendCard(profile) {
  const summary = profile.summary || {};
  const days = rangeDays(summary);
  const total = rangeCompletions(days);
  const missed = rangeMissed(days);
  const todayCount = days.find((day) => day.date === today)?.completed || 0;
  const average = days.length ? Math.round((total / days.length) * 10) / 10 : 0;

  const card = document.createElement('section');
  card.className = 'ether-card dashboard-card habit-card';
  card.dataset.theme = profile.theme;
  card.setAttribute('aria-labelledby', `habits-${profile.id}`);

  const head = document.createElement('div');
  head.className = 'ether-head';

  const left = document.createElement('div');

  const title = document.createElement('p');
  title.className = 'ether-title';
  title.id = `habits-${profile.id}`;
  title.append(themeDot(), document.createTextNode(profile.name));

  const totalLine = document.createElement('p');
  totalLine.className = 'ether-total';
  const strong = document.createElement('strong');
  strong.textContent = String(total);
  const suffix = document.createElement('span');
  suffix.textContent = total === 1 ? 'habit completed' : 'habits completed';
  totalLine.append(strong, suffix);

  left.append(title, totalLine);

  const stats = document.createElement('dl');
  stats.className = 'ether-stats';
  stats.append(
    statNode('Today', todayCount),
    statNode('Missed', missed),
    statNode('Daily average', average),
  );

  head.append(left, stats);
  card.append(head, completionChart(days, profile.name));
  return card;
}

function dashboardCard(profile) {
  const summary = profile.summary || {
    total: profile.ether,
    earned: profile.earned ?? profile.ether,
    netToday: 0,
    netLast7: 0,
    netLast30: 0,
    penaltyLast7: 0,
    penaltyLast30: 0,
    days: [],
  };

  const card = document.createElement('section');
  card.className = 'ether-card dashboard-card';
  card.dataset.theme = profile.theme;
  card.setAttribute('aria-labelledby', `dashboard-${profile.id}`);

  const head = document.createElement('div');
  head.className = 'ether-head';

  const left = document.createElement('div');

  const title = document.createElement('p');
  title.className = 'ether-title';
  title.id = `dashboard-${profile.id}`;
  title.append(themeDot(), document.createTextNode(profile.name));

  const total = document.createElement('p');
  total.className = 'ether-total';
  const strong = document.createElement('strong');
  strong.textContent = String(summary.earned);
  const suffix = document.createElement('span');
  suffix.textContent = 'ether earned';
  total.append(etherIcon(), strong, suffix);

  left.append(title, total);

  const stats = document.createElement('dl');
  stats.className = 'ether-stats';
  stats.append(
    statNode('Today', summary.netToday ?? summary.today ?? 0),
    statNode(rangeLabel(), rangeNet(summary)),
    statNode('Penalties', rangePenalty(summary)),
  );

  head.append(left, stats);
  card.append(head, etherChartNode(rangeDays(summary), profile.name));
  return card;
}

function dashboardTabNodes() {
  return [...(els.dashboardTabs ? els.dashboardTabs.querySelectorAll('[role="tab"]') : [])];
}

function applyDashboardView({ focus = false } = {}) {
  const ether = dashboardView !== 'habit';
  if (els.dashboardEtherPanel) els.dashboardEtherPanel.hidden = !ether;
  if (els.dashboardHabitsPanel) els.dashboardHabitsPanel.hidden = ether;

  for (const tab of dashboardTabNodes()) {
    const selected = tab.dataset.view === dashboardView;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    if (selected && focus) tab.focus();
  }
}

function setDashboardView(view, { focus = false } = {}) {
  dashboardView = view === 'habit' ? 'habit' : 'ether';
  rememberDashboardView(dashboardView);
  applyDashboardView({ focus });
}

function onDashboardTabKeydown(event) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;

  const tabs = dashboardTabNodes();
  const index = tabs.findIndex((tab) => tab.dataset.view === dashboardView);
  if (index === -1) return;

  event.preventDefault();
  let next = index;
  if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
  if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
  if (event.key === 'Home') next = 0;
  if (event.key === 'End') next = tabs.length - 1;
  setDashboardView(tabs[next].dataset.view, { focus: true });
}

function renderDashboard() {
  const total = profiles.reduce((sum, profile) => sum + (profile.ether || 0), 0);
  const todayTotal = profiles.reduce(
    (sum, profile) => sum + ((profile.summary && profile.summary.netToday) || 0),
    0,
  );
  const rangeTotal = profiles.reduce(
    (sum, profile) => sum + rangeNet(profile.summary || {}),
    0,
  );
  const penaltyTotal = profiles.reduce(
    (sum, profile) => sum + rangePenalty(profile.summary || {}),
    0,
  );

  els.etherTotal.textContent = String(total);
  els.etherToday.textContent = String(todayTotal);
  els.etherRangeLabel.textContent = rangeLabel();
  els.etherRange.textContent = String(rangeTotal);
  els.etherPenalties.textContent = String(penaltyTotal);
  els.dashboardRange.value = dashboardRange;

  els.dashboardList.replaceChildren(...profiles.map(dashboardCard));
  els.dashboardHabits.replaceChildren(...profiles.map(habitTrendCard));
  applyDashboardView();
}

/* ---------- shop ---------- */

function itemExcludedProfiles(item) {
  return new Set(Array.isArray(item.excludedProfiles) ? item.excludedProfiles : []);
}

function includedProfiles(item) {
  const excluded = itemExcludedProfiles(item);
  return profiles.filter((profile) => !excluded.has(profile.id));
}

function itemAvailable(item) {
  return includedProfiles(item).reduce(
    (sum, profile) => sum + Math.max(0, Number(profile.ether) || 0),
    0,
  );
}

function itemPurchased(item) {
  return item.consumable !== true && Boolean(item.purchasedAt);
}

function shopInitial(item) {
  const fallback = document.createElement('span');
  fallback.className = 'shop-item-initial';
  fallback.textContent = (item.name || '?').trim().charAt(0).toUpperCase() || '?';
  fallback.setAttribute('aria-hidden', 'true');
  return fallback;
}

function shopImage(item) {
  const media = document.createElement('div');
  media.className = 'shop-item-media';

  if (item.image) {
    const image = document.createElement('img');
    image.src = item.image;
    image.alt = '';
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => {
      image.remove();
      media.append(shopInitial(item));
    });
    media.append(image);
  } else {
    media.append(shopInitial(item));
  }

  return media;
}

function contributorToggle(item, profile, amount) {
  const label = document.createElement('label');
  label.className = 'shop-contributor';
  label.dataset.theme = profile.theme;

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = !itemExcludedProfiles(item).has(profile.id);
  input.setAttribute('aria-label', `Include ${profile.name} in ${item.name}`);
  input.addEventListener('change', () => setContributor(item, profile, input.checked));

  const name = document.createElement('span');
  name.className = 'shop-contributor-name';
  name.textContent = profile.name;

  label.append(input, themeDot(), name);

  if (amount !== undefined) {
    const value = document.createElement('span');
    value.className = 'shop-contributor-amount';
    value.textContent = String(amount);
    label.append(value);
  }

  return label;
}

async function setContributor(item, profile, included) {
  const excluded = itemExcludedProfiles(item);
  if (included) excluded.delete(profile.id);
  else excluded.add(profile.id);

  try {
    const updated = await api(`/api/shop/items/${item.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ excludedProfiles: [...excluded] }),
    });
    Object.assign(item, updated);
    renderShop();
  } catch (error) {
    toast(error.message);
    renderShop();
  }
}

function shopContributorShares(item) {
  const contributors = includedProfiles(item)
    .map((profile) => ({ profile, balance: Math.max(0, Number(profile.ether) || 0) }))
    .filter((entry) => entry.balance > 0);
  const available = contributors.reduce((sum, entry) => sum + entry.balance, 0);

  if (available < item.cost) {
    return {
      available,
      ready: false,
      shares: contributors.map((entry) => ({ profile: entry.profile, amount: entry.balance })),
    };
  }

  // Mirror the server's largest-remainder split so the legend matches the
  // whole-number charges a purchase would actually make.
  const exact = contributors.map((entry) => (item.cost * entry.balance) / available);
  const amounts = exact.map((value) => Math.floor(value));
  const remainder = item.cost - amounts.reduce((sum, value) => sum + value, 0);
  const order = exact
    .map((value, index) => ({
      index,
      fraction: value - amounts[index],
      balance: contributors[index].balance,
      id: contributors[index].profile.id,
    }))
    .sort(
      (a, b) =>
        b.fraction - a.fraction || b.balance - a.balance || a.id.localeCompare(b.id),
    );
  for (let index = 0; index < remainder; index += 1) {
    amounts[order[index % order.length].index] += 1;
  }

  return {
    available,
    ready: true,
    shares: contributors
      .map((entry, index) => ({ profile: entry.profile, amount: amounts[index] }))
      .filter((entry) => entry.amount > 0),
  };
}

function shopProgress(item) {
  const { available, ready, shares } = shopContributorShares(item);
  const capped = Math.min(available, item.cost);

  const wrap = document.createElement('div');
  wrap.className = 'shop-progress';

  const label = document.createElement('div');
  label.className = 'shop-progress-label';

  const amount = document.createElement('span');
  amount.textContent = `${available} / ${item.cost} ether`;

  const status = document.createElement('span');
  status.className = ready ? 'shop-ready' : 'shop-needed';
  status.textContent = ready ? 'Ready to buy' : `${item.cost - available} more needed`;

  label.append(amount, status);

  const bar = document.createElement('div');
  bar.className = 'shop-bar';
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', String(item.cost));
  bar.setAttribute('aria-valuenow', String(capped));

  const breakdown = shares
    .map((share) => `${share.profile.name} ${share.amount}`)
    .join(', ');
  bar.setAttribute(
    'aria-valuetext',
    ready
      ? `Ready to buy: ${breakdown || 'no contributors'} of ${item.cost} ether`
      : `${available} of ${item.cost} ether available${breakdown ? `: ${breakdown}` : ''}`,
  );
  bar.setAttribute('aria-label', `Progress towards ${item.name}`);

  for (const share of shares) {
    const segment = document.createElement('span');
    segment.className = 'shop-bar-segment';
    segment.dataset.theme = share.profile.theme;
    segment.style.width = `${(share.amount / item.cost) * 100}%`;
    segment.title = `${share.profile.name}: ${share.amount} ether`;
    bar.append(segment);
  }

  wrap.append(label, bar);

  if (shares.length > 0) {
    const legend = document.createElement('div');
    legend.className = 'shop-bar-legend';
    legend.setAttribute('aria-hidden', 'true');

    for (const share of shares) {
      const key = document.createElement('span');
      key.className = 'shop-bar-key';
      key.dataset.theme = share.profile.theme;
      key.title = `${share.profile.name}: ${share.amount} ether`;

      const dot = document.createElement('span');
      dot.className = 'shop-bar-key-dot';
      dot.setAttribute('aria-hidden', 'true');

      const name = document.createElement('span');
      name.textContent = share.profile.name;

      const value = document.createElement('span');
      value.className = 'shop-bar-key-value';
      value.textContent = String(share.amount);

      key.append(dot, name, value);
      legend.append(key);
    }

    wrap.append(legend);
  }

  return wrap;
}

function shopItemCard(item) {
  const purchased = itemPurchased(item);
  const card = document.createElement('article');
  card.className = 'shop-item' + (purchased ? ' is-purchased' : '');

  const body = document.createElement('div');
  body.className = 'shop-item-body';

  const head = document.createElement('div');
  head.className = 'shop-item-head';

  const title = document.createElement('a');
  title.className = 'shop-item-name';
  title.href = item.link;
  title.target = '_blank';
  title.rel = 'noopener noreferrer';
  title.textContent = item.name;
  title.title = `Open ${item.name}`;

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'shop-item-remove';
  remove.textContent = '×';
  remove.title = `Remove ${item.name} from the shop`;
  remove.setAttribute('aria-label', `Remove ${item.name} from the shop`);
  remove.addEventListener('click', () => deleteShopItem(item));

  const buy = document.createElement('button');
  buy.type = 'button';
  buy.className = 'shop-buy';
  if (purchased) {
    buy.textContent = 'Bought';
    buy.disabled = true;
    buy.setAttribute('aria-label', `${item.name} already bought`);
  } else {
    buy.setAttribute('aria-label', `Buy ${item.name} for ${item.cost} ether`);
    buy.append(
      document.createTextNode('Buy · '),
      etherIcon('ether-icon ether-icon-inline'),
      document.createTextNode(String(item.cost)),
    );
    buy.disabled = itemAvailable(item) < item.cost;
    buy.addEventListener('click', () => buyShopItem(item));
  }

  const side = document.createElement('div');
  side.className = 'shop-item-side';
  side.append(buy, remove);

  head.append(title, side);

  const contributors = document.createElement('div');
  contributors.className = 'shop-contributors';

  const contributorsLabel = document.createElement('p');
  contributorsLabel.className = 'shop-contributors-label';
  contributorsLabel.textContent = 'Contributors';

  const contributorRow = document.createElement('div');
  contributorRow.className = 'shop-contributor-row';
  contributorRow.append(...profiles.map((profile) => contributorToggle(item, profile)));
  if (purchased) {
    for (const input of contributorRow.querySelectorAll('input')) input.disabled = true;
  }

  contributors.append(contributorsLabel, contributorRow);

  body.append(head, purchased ? shopPurchasedNote(item) : shopProgress(item), contributors);
  card.append(shopImage(item), body);
  return card;
}

function shopTileCard(item) {
  const { shares } = shopContributorShares(item);
  const shareAmounts = new Map(shares.map((share) => [share.profile.id, share.amount]));

  const card = document.createElement('article');
  card.className = 'shop-tile';

  const media = shopImage(item);
  media.classList.add('shop-tile-media');

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'shop-tile-remove';
  remove.textContent = '×';
  remove.title = `Remove ${item.name} from the shop`;
  remove.setAttribute('aria-label', `Remove ${item.name} from the shop`);
  remove.addEventListener('click', () => deleteShopItem(item));

  const body = document.createElement('div');
  body.className = 'shop-tile-body';

  const name = document.createElement('a');
  name.className = 'shop-tile-name';
  name.href = item.link;
  name.target = '_blank';
  name.rel = 'noopener noreferrer';
  name.textContent = item.name;
  name.title = `Open ${item.name}`;

  const buy = document.createElement('button');
  buy.type = 'button';
  buy.className = 'shop-buy shop-tile-buy';
  buy.setAttribute('aria-label', `Buy ${item.name} for ${item.cost} ether`);
  buy.append(
    document.createTextNode('Buy · '),
    etherIcon('ether-icon ether-icon-inline'),
    document.createTextNode(String(item.cost)),
  );
  buy.disabled = itemAvailable(item) < item.cost;
  buy.addEventListener('click', () => buyShopItem(item));

  const contributors = document.createElement('div');
  contributors.className = 'shop-contributors';

  const contributorRow = document.createElement('div');
  contributorRow.className = 'shop-contributor-row';
  contributorRow.append(
    ...profiles.map((profile) =>
      contributorToggle(item, profile, shareAmounts.get(profile.id) || 0),
    ),
  );

  contributors.append(contributorRow);

  body.append(name, shopProgress(item), contributors, buy);
  card.append(media, remove, body);
  return card;
}

function shopPurchasedNote(item) {
  const when = item.purchasedAt ? new Date(item.purchasedAt) : null;
  const note = document.createElement('p');
  note.className = 'shop-purchased-note';
  note.textContent =
    when && !Number.isNaN(when.getTime()) ? `Purchased ${when.toLocaleDateString()}` : 'Purchased';
  return note;
}

function shopSection(title, note, items, { className = 'shop-list', card = shopItemCard } = {}) {
  if (items.length === 0) return null;

  const section = document.createElement('section');
  section.className = 'shop-section';

  const head = document.createElement('div');
  head.className = 'shop-section-head';

  const heading = document.createElement('h3');
  heading.className = 'shop-section-title';
  heading.textContent = title;

  const subtitle = document.createElement('p');
  subtitle.className = 'shop-section-note';
  subtitle.textContent = note;

  head.append(heading, subtitle);

  const list = document.createElement('div');
  list.className = className;
  list.append(...items.map((item) => card(item)));

  section.append(head, list);
  return section;
}

function renderShop() {
  const balance = profiles.reduce(
    (sum, profile) => sum + Math.max(0, Number(profile.ether) || 0),
    0,
  );
  els.shopBalance.textContent = String(balance);

  const consumables = shop.items.filter((item) => item.consumable);
  const rewards = shop.items.filter((item) => !item.consumable);
  const sections = [
    shopSection(
      'Consumables',
      'Consumables can be bought again and again.',
      consumables,
      { className: 'shop-grid', card: shopTileCard },
    ),
    shopSection('Rewards', 'Buy once. Cards grey out after purchase.', rewards),
  ].filter(Boolean);

  els.shopList.replaceChildren(...sections);
  els.shopEmpty.hidden = shop.items.length > 0;
}

function setShopFormOpen(open, { focus = true } = {}) {
  els.shopForm.hidden = !open;
  els.shopAddToggle.hidden = open;
  els.shopAddToggle.setAttribute('aria-expanded', String(open));
  clearTimeout(shopLookupTimer);
  if (open) syncShopLookup();
  if (focus) (open ? els.shopName : els.shopAddToggle).focus();
}

function setShopLookupStatus(message, tone = '') {
  els.shopLookupStatus.textContent = message;
  if (tone) els.shopLookupStatus.dataset.tone = tone;
  else delete els.shopLookupStatus.dataset.tone;
}

const LOOKUP_OFF_MESSAGE = 'Amazon auto-fill is off on this server. Enter the details manually.';

function syncShopLookup() {
  const parsed = parseAmazonLink(els.shopLink.value);
  const ready = lookup.amazon && Boolean(parsed) && !shopLookupState.pending;

  els.shopLookup.disabled = !ready;
  els.shopLookup.title = !lookup.amazon
    ? 'Amazon auto-fill is off on this server'
    : parsed
      ? 'Fetch the name, price, and image from Amazon'
      : 'Paste a full amazon.in product link';

  if (!lookup.amazon && parsed) setShopLookupStatus(LOOKUP_OFF_MESSAGE);
}

function scheduleShopLookup() {
  clearTimeout(shopLookupTimer);
  const parsed = parseAmazonLink(els.shopLink.value);
  if (!lookup.amazon || !parsed || shopLookupState.pending) return;
  if (shopLookupState.attempted === parsed.asin) return;
  shopLookupTimer = setTimeout(() => lookupShopLink({ auto: true }), 700);
}

async function lookupShopLink({ auto = false } = {}) {
  if (shopLookupState.pending) return;

  if (!lookup.amazon) {
    setShopLookupStatus(LOOKUP_OFF_MESSAGE, 'error');
    return;
  }

  const parsed = parseAmazonLink(els.shopLink.value);
  if (!parsed) {
    if (!auto) setShopLookupStatus('Paste a full amazon.in product link.', 'error');
    return;
  }

  shopLookupState.pending = true;
  shopLookupState.attempted = parsed.asin;
  syncShopLookup();
  setShopLookupStatus('Fetching details from Amazon…', 'pending');

  try {
    const result = await api('/api/shop/lookup', {
      method: 'POST',
      body: JSON.stringify({ link: els.shopLink.value.trim() }),
    });
    const item = result.item || {};
    if (item.name) els.shopName.value = item.name;
    if (Number.isInteger(item.cost) && item.cost >= 1) els.shopCost.value = String(item.cost);
    if (item.image) els.shopImage.value = item.image;

    const price = item.price && item.price.display;
    if (lookup.mode === 'page') {
      // The fallback reads the public page, so the price is a best guess.
      setShopLookupStatus(
        price
          ? `Read from the Amazon page · ${price} — check it before adding.`
          : 'Read the name and image from the Amazon page. Add the price.',
        'ok',
      );
    } else {
      setShopLookupStatus(price ? `Filled from Amazon · ${price}` : 'Filled from Amazon.', 'ok');
    }
  } catch (error) {
    setShopLookupStatus(`${error.message} Enter the details manually.`, 'error');
  } finally {
    shopLookupState.pending = false;
    syncShopLookup();
  }
}

// A bookmarklet cannot know where this app is hosted, so the link is built
// from the current origin. Dragging it to the bookmarks bar is the reliable
// way to install it; clicking it here only explains that.
function shopBookmarkletHref() {
  const origin = window.location.origin;
  const source = [
    '(function(){',
    "var a=document.querySelector('#ASIN'),",
    "p=location.pathname.match(/\\/(?:dp|gp\\/product)\\/([A-Z0-9]{10})/i),",
    "t=document.querySelector('#productTitle'),",
    "i=document.querySelector('#landingImage'),",
    "o=document.querySelector('.a-offscreen'),",
    "m=o&&o.textContent.match(/[0-9][0-9,.]*/),",
    "asin=a?a.value.trim():(p?p[1]:'');",
    "if(!asin||asin.length!==10){alert('Open an amazon.in product page first.');return}",
    'var u=' + JSON.stringify(origin) + "+'/shop?add=1&link='+encodeURIComponent('https://www.amazon.in/dp/'+asin);",
    "if(t){var n=t.textContent.replace(/\\s+/g,' ').trim();if(n)u+='&name='+encodeURIComponent(n)}",
    "if(m){var c=Math.round(Number(m[0].replace(/,/g,'')));if(c>0)u+='&cost='+c}",
    "if(i){var g=i.getAttribute('data-old-hires')||i.getAttribute('src');if(g)u+='&image='+encodeURIComponent(g)}",
    "window.open(u,'_blank')",
    '})()',
  ].join('');
  return 'javascript:' + encodeURIComponent(source);
}

// Read the bookmarklet's query string once, fill the add form, then drop the
// parameters so a reload does not refill it. Nothing is submitted here.
function applyShopImport() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('add') !== '1') return false;

  const link = (params.get('link') || '').trim();
  const parsed = parseAmazonLink(link);
  if (!parsed) return false;

  const name = (params.get('name') || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const cost = Number(params.get('cost'));
  const image = (params.get('image') || '').trim();

  setShopFormOpen(true, { focus: false });
  els.shopLink.value = link;
  if (name) els.shopName.value = name;
  if (Number.isInteger(cost) && cost >= 1 && cost <= 1000000) els.shopCost.value = String(cost);
  if (/^https?:\/\//i.test(image) && image.length <= 500) els.shopImage.value = image;

  shopLookupState.attempted = parsed.asin;
  syncShopLookup();
  setShopLookupStatus(
    name
      ? 'Imported from the Amazon page. Check the price, then add it.'
      : 'Link imported. Add a name and cost.',
    'ok',
  );
  history.replaceState({}, '', '/shop');
  els.shopName.focus();
  return true;
}

async function addShopItem(event) {
  event.preventDefault();

  const name = els.shopName.value.trim();
  const link = els.shopLink.value.trim();
  const image = els.shopImage.value.trim();
  const cost = Number(els.shopCost.value);
  const consumable = els.shopConsumable.checked;

  if (!name) {
    toast('Give the item a name.');
    els.shopName.focus();
    return;
  }
  if (!link) {
    toast('Add a link to where the item can be bought.');
    els.shopLink.focus();
    return;
  }
  if (!Number.isInteger(cost) || cost < 1) {
    toast('Cost must be a whole number of at least 1 ether.');
    els.shopCost.focus();
    return;
  }

  try {
    const created = await api('/api/shop/items', {
      method: 'POST',
      body: JSON.stringify({ name, link, cost, image, consumable }),
    });
    shop.items.push(created);
    els.shopForm.reset();
    shopLookupState.attempted = '';
    setShopLookupStatus('');
    syncShopLookup();
    renderShop();
    setShopFormOpen(false);
    toast(`${created.name} added to the shop.`);
  } catch (error) {
    toast(error.message);
  }
}

async function deleteShopItem(item) {
  if (!window.confirm(`Remove "${item.name}" from the shop?`)) return;

  try {
    await api(`/api/shop/items/${item.id}`, { method: 'DELETE' });
    shop.items = shop.items.filter((entry) => entry.id !== item.id);
    renderShop();
    toast(`${item.name} removed from the shop.`);
  } catch (error) {
    toast(error.message);
  }
}

async function buyShopItem(item) {
  if (itemPurchased(item)) {
    toast(`${item.name} has already been bought.`);
    return;
  }

  const available = itemAvailable(item);
  if (available < item.cost) {
    toast(`Not enough ether yet: ${available} of ${item.cost}.`);
    return;
  }

  // Unlock audio while the click is still a user gesture, then chime on success.
  ensureAudioContext();

  try {
    const result = await api(`/api/shop/items/${item.id}/buy`, { method: 'POST' });
    playPurchaseSound();
    const paid = result.contributions
      .map((entry) => `${entry.name} ${entry.amount}`)
      .join(', ');
    toast(`Bought ${item.name}.${paid ? ` Spent ${paid} ether.` : ''}`);
    await load({ silent: true });
  } catch (error) {
    toast(error.message);
  }
}

/* ---------- jobs ---------- */

function jobProfile(id) {
  return profiles.find((profile) => profile.id === id) || null;
}

function jobProfileName(id) {
  const profile = jobProfile(id);
  return profile ? profile.name : 'Deleted profile';
}

function jobInProgressCount(profileId) {
  return jobs.inProgress.filter((job) => job.assignedTo === profileId).length;
}

function jobRemainingLabel(job) {
  const due = Date.parse(job.dueAt);
  if (!Number.isFinite(due)) return '';
  const left = due - jobNow;
  return left >= 0
    ? `${formatJobDuration(left)} left`
    : `${formatJobDuration(-left)} overdue`;
}

function jobElapsedLabel(job) {
  const started = Date.parse(job.startedAt);
  const finished = Date.parse(job.completedAt);
  if (!Number.isFinite(started) || !Number.isFinite(finished)) return '';
  return `Finished in ${formatJobDuration(Math.max(0, finished - started))}`;
}

function jobChip(text, className = '') {
  const chip = document.createElement('span');
  chip.className = `job-chip${className ? ` ${className}` : ''}`;
  chip.textContent = text;
  return chip;
}

function jobActionButton(label, className, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `job-action ${className}`;
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function jobCard(job, { draggable = false } = {}) {
  const card = document.createElement('article');
  card.className = `job-card is-${job.status}`;
  card.dataset.id = job.id;
  card.setAttribute('role', 'listitem');

  const title = document.createElement('p');
  title.className = 'job-card-title';
  title.textContent = job.title;

  const meta = document.createElement('div');
  meta.className = 'job-meta';

  const reward = document.createElement('span');
  reward.className = 'job-chip job-chip-reward';
  reward.append(etherIcon(), document.createTextNode(` ${job.reward} ether`));

  meta.append(reward, jobChip(`ETA ${formatJobDuration(job.etaMinutes * 60000)}`));

  const foot = document.createElement('div');
  foot.className = 'job-card-foot';

  const by = document.createElement('span');
  by.className = 'job-by';

  if (job.status === 'inbox') {
    by.textContent = `Posted by ${jobProfileName(job.createdBy)}`;
    const actions = document.createElement('div');
    actions.className = 'job-actions';

    const take = jobActionButton('Take', 'job-take', () => takeJob(job));
    const full =
      !jobActorId || jobInProgressCount(jobActorId) >= jobLimits.maxInProgress;
    take.disabled = full;
    if (full) {
      take.title = jobActorId
        ? `${jobProfileName(jobActorId)} already has ${jobLimits.maxInProgress} jobs in progress`
        : 'Pick a profile first';
    }

    const remove = jobActionButton('×', 'job-remove', () => deleteJob(job));
    remove.title = `Remove ${job.title} from the inbox`;
    remove.setAttribute('aria-label', `Remove ${job.title} from the inbox`);

    actions.append(take, remove);
    foot.append(by, actions);
  } else if (job.status === 'inProgress') {
    const remaining = jobRemainingLabel(job);
    const overdue = Date.parse(job.dueAt) < jobNow;
    by.textContent = `Taken by ${jobProfileName(job.assignedTo)}`;
    const time = jobChip(remaining, overdue ? 'job-time is-overdue' : 'job-time');
    const actions = document.createElement('div');
    actions.className = 'job-actions';
    actions.append(jobActionButton('Complete', 'job-complete', () => completeJob(job)));
    foot.append(by, time, actions);
  } else if (job.status === 'completed') {
    by.textContent = `By ${jobProfileName(job.assignedTo)} · ${jobElapsedLabel(job)}`;
    const outcome = jobChip(
      `×${job.multiplier} · +${job.payout} ether`,
      'job-outcome is-success',
    );
    foot.append(by, outcome);
  } else {
    by.textContent = `By ${jobProfileName(job.assignedTo)}`;
    const outcome = jobChip(`Failed · ${job.payout} ether`, 'job-outcome is-failure');
    foot.append(by, outcome);
  }

  card.append(title, meta, foot);

  if (draggable) {
    card.draggable = true;
    card.addEventListener('dragstart', (event) => startJobDrag(event, job));
    card.addEventListener('dragend', endJobDrag);
  }

  return card;
}

function startJobDrag(event, job) {
  if (!event.dataTransfer) return;
  event.dataTransfer.setData('text/plain', job.id);
  event.dataTransfer.effectAllowed = 'move';
  event.currentTarget.classList.add('is-dragging');
}

function endJobDrag(event) {
  event.currentTarget.classList.remove('is-dragging');
  for (const node of document.querySelectorAll('.is-drop')) {
    node.classList.remove('is-drop');
  }
}

function wireJobDrop(node, onDrop) {
  node.addEventListener('dragover', (event) => {
    if (!event.dataTransfer) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    node.classList.add('is-drop');
  });
  node.addEventListener('dragleave', (event) => {
    if (node.contains(event.relatedTarget)) return;
    node.classList.remove('is-drop');
  });
  node.addEventListener('drop', (event) => {
    event.preventDefault();
    node.classList.remove('is-drop');
    const id = event.dataTransfer ? event.dataTransfer.getData('text/plain') : '';
    if (id) onDrop(id);
  });
}

function jobProfileBox(profile) {
  const box = document.createElement('section');
  box.className = 'job-profile-box';
  box.dataset.theme = profile.theme;
  box.dataset.profile = profile.id;

  const own = jobs.inProgress.filter((job) => job.assignedTo === profile.id);

  const head = document.createElement('div');
  head.className = 'job-profile-head';

  const dot = document.createElement('span');
  dot.className = 'job-profile-dot';
  dot.setAttribute('aria-hidden', 'true');

  const name = document.createElement('span');
  name.className = 'job-profile-name';
  name.textContent = profile.name;

  const count = document.createElement('span');
  count.className = 'job-profile-count';
  count.textContent = `${own.length}/${jobLimits.maxInProgress}`;

  head.append(dot, name, count);

  const list = document.createElement('div');
  list.className = 'jobs-list';
  list.setAttribute('role', 'list');
  list.replaceChildren(...own.map((job) => jobCard(job, { draggable: true })));

  const empty = document.createElement('p');
  empty.className = 'jobs-empty';
  empty.textContent = own.length === 0 ? 'Free for a job.' : '';
  empty.hidden = own.length > 0;

  wireJobDrop(box, (id) => {
    const job = jobs.inbox.find((entry) => entry.id === id);
    if (job) takeJob(job, profile.id);
  });

  box.append(head, list, empty);
  return box;
}

function renderJobActor() {
  if (profiles.length === 0) {
    jobActorId = null;
    els.jobActor.replaceChildren();
    return;
  }

  const signature = profiles.map((profile) => `${profile.id}:${profile.name}`).join('|');
  if (els.jobActor.dataset.signature !== signature) {
    els.jobActor.replaceChildren(
      ...profiles.map((profile) => {
        const option = document.createElement('option');
        option.value = profile.id;
        option.textContent = profile.name;
        return option;
      }),
    );
    els.jobActor.dataset.signature = signature;
  }

  if (!profiles.some((profile) => profile.id === jobActorId)) {
    jobActorId = profiles[0].id;
  }
  els.jobActor.value = jobActorId;
}

function renderJobs() {
  renderJobActor();

  els.jobInbox.replaceChildren(...jobs.inbox.map((job) => jobCard(job, { draggable: true })));
  els.jobInboxEmpty.hidden = jobs.inbox.length > 0;
  els.jobInboxCount.textContent = String(jobs.inbox.length);

  els.jobProgress.replaceChildren(...profiles.map(jobProfileBox));
  els.jobProgressCount.textContent = String(jobs.inProgress.length);

  els.jobCompleted.replaceChildren(...jobs.completed.map((job) => jobCard(job)));
  els.jobCompletedEmpty.hidden = jobs.completed.length > 0;
  els.jobCompletedCount.textContent = String(jobs.completed.length);

  els.jobFailed.replaceChildren(...jobs.failed.map((job) => jobCard(job)));
  els.jobFailedEmpty.hidden = jobs.failed.length > 0;
  els.jobFailedCount.textContent = String(jobs.failed.length);

  els.jobStatus.textContent = `Last updated ${new Date(jobNow).toLocaleTimeString()}`;
}

async function loadJobs() {
  const data = await api('/api/jobs');
  jobs = data.jobs || { inbox: [], inProgress: [], completed: [], failed: [] };
  jobLimits = data.limits || jobLimits;
  jobNow = Date.parse(data.now) || Date.now();

  if (!profiles.some((profile) => profile.id === jobActorId)) {
    jobActorId = data.activeProfileId || profiles[0]?.id || null;
  }

  renderJobs();
}

async function refreshJobsQuietly() {
  try {
    await loadJobs();
  } catch {
    /* keep the current board */
  }
}

async function addJob(event) {
  event.preventDefault();
  const title = els.jobTitle.value.trim();
  const reward = Number(els.jobReward.value);
  const etaMinutes = Number(els.jobEta.value);

  if (!title) {
    toast('Give the job a title.');
    els.jobTitle.focus();
    return;
  }

  const submit = els.jobForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    const data = await api('/api/jobs', {
      method: 'POST',
      body: JSON.stringify({ title, reward, etaMinutes }),
    });
    jobs = data.jobs || jobs;
    els.jobForm.reset();
    renderJobs();
    els.jobTitle.focus();
    toast('Job posted to the inbox.');
  } catch (error) {
    toast(error.message);
  } finally {
    submit.disabled = false;
  }
}

async function takeJob(job, profileId = jobActorId) {
  if (!profileId) {
    toast('Pick a profile first.');
    return;
  }

  try {
    const data = await api(`/api/jobs/${job.id}/take?profile=${encodeURIComponent(profileId)}`, {
      method: 'POST',
      body: '{}',
    });
    jobs = data.jobs || jobs;
    jobNow = Date.now();
    renderJobs();
    toast(`${jobProfileName(profileId)} took the job.`);
  } catch (error) {
    toast(error.message);
    await refreshJobsQuietly();
  }
}

async function completeJob(job) {
  try {
    const data = await api(`/api/jobs/${job.id}/complete`, {
      method: 'POST',
      body: '{}',
    });
    jobs = data.jobs || jobs;
    jobNow = Date.now();
    renderJobs();
    const payout = data.job ? data.job.payout : 0;
    toast(`Job completed: ${payout > 0 ? '+' : ''}${payout} ether.`);
  } catch (error) {
    toast(error.message);
    await refreshJobsQuietly();
  }
}

async function deleteJob(job) {
  if (!window.confirm(`Remove "${job.title}" from the inbox?`)) return;
  try {
    await api(`/api/jobs/${job.id}`, { method: 'DELETE' });
    await loadJobs();
    toast('Job removed.');
  } catch (error) {
    toast(error.message);
    await refreshJobsQuietly();
  }
}

async function selectJobActor(id) {
  if (!id) return;
  jobActorId = id;
  try {
    await api(`/api/profiles/${id}/activate`, { method: 'POST' });
    activeTabId = id;
    renderJobs();
  } catch (error) {
    toast(error.message);
  }
}

/* ---------- settings ---------- */

function soundOptions() {
  return [
    ...SOUND_PRESETS.map((sound) => ({ id: sound.id, name: sound.label })),
    ...customSounds().map((sound) => ({ id: sound.id, name: sound.name })),
  ];
}

function fillSoundSelect(select, selected) {
  const options = soundOptions();
  select.replaceChildren(
    ...options.map((sound) => {
      const option = document.createElement('option');
      option.value = sound.id;
      option.textContent = sound.name;
      option.selected = sound.id === selected;
      return option;
    }),
  );

  if (!options.some((sound) => sound.id === selected)) {
    const fallback = document.createElement('option');
    fallback.value = selected;
    fallback.textContent = selected;
    fallback.selected = true;
    select.append(fallback);
  }
}

function soundName(id) {
  return soundOptions().find((sound) => sound.id === id)?.name || id;
}

function soundRow(sound) {
  const item = document.createElement('li');
  item.className = 'sound-item';

  const main = document.createElement('div');
  main.className = 'sound-item-main';

  const name = document.createElement('span');
  name.className = 'sound-item-name';
  name.textContent = sound.name;

  const url = document.createElement('span');
  url.className = 'sound-item-url';
  url.textContent = sound.url;

  main.append(name, url);

  const play = document.createElement('button');
  play.type = 'button';
  play.className = 'profile-icon';
  play.textContent = '▶';
  play.title = `Preview ${sound.name}`;
  play.setAttribute('aria-label', `Preview ${sound.name}`);
  play.addEventListener('click', () => {
    ensureAudioContext();
    playSound(sound.id);
  });

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'profile-icon';
  remove.textContent = '×';
  remove.title = `Remove ${sound.name}`;
  remove.setAttribute('aria-label', `Remove ${sound.name}`);
  remove.addEventListener('click', () => deleteSound(sound));

  item.append(main, play, remove);
  return item;
}

function renderSounds() {
  if (!els.habitSound || !els.purchaseSound) return;

  fillSoundSelect(els.habitSound, (settings.sounds && settings.sounds.habit) || 'chime');
  fillSoundSelect(els.purchaseSound, (settings.sounds && settings.sounds.purchase) || 'pop');

  const custom = customSounds();
  els.soundList.replaceChildren(...custom.map(soundRow));
  els.soundList.hidden = custom.length === 0;
}

function renderSettings() {
  if (document.activeElement !== els.etherFactor) {
    els.etherFactor.value = String(settings.etherFactor);
  }
  if (document.activeElement !== els.urgencyFactor) {
    els.urgencyFactor.value = String(settings.urgencyFactor ?? 1);
  }
  renderSounds();
  renderAppIcon();
  renderIconPanel();
}

async function saveSoundChoice(slot, value) {
  try {
    settings = await api('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({ sounds: { [slot]: value } }),
    });
    renderSounds();
    playSound(value);
    toast(`${slot === 'habit' ? 'Habit' : 'Purchase'} sound set to ${soundName(value)}.`);
  } catch (error) {
    toast(error.message);
    renderSounds();
  }
}

async function addSound(event) {
  event.preventDefault();

  const name = els.soundName.value.trim();
  const url = els.soundUrl.value.trim();
  if (!name || !url) return;

  try {
    const data = await api('/api/settings/sounds', {
      method: 'POST',
      body: JSON.stringify({ name, url }),
    });
    settings = { ...settings, sounds: data.sounds };
    els.soundForm.reset();
    renderSounds();
    ensureAudioContext();
    playSound(data.sound.id);
    toast(`${data.sound.name} added.`);
  } catch (error) {
    toast(error.message);
  }
}

async function deleteSound(sound) {
  if (!window.confirm(`Remove "${sound.name}"?`)) return;

  try {
    settings = await api(`/api/settings/sounds/${sound.id}`, { method: 'DELETE' });
    renderSounds();
    toast(`${sound.name} removed.`);
  } catch (error) {
    toast(error.message);
  }
}

/* ---------- app icon ---------- */

function customIcons() {
  const list = settings.icon && settings.icon.custom;
  return Array.isArray(list) ? list : [];
}

function selectedIconId() {
  return (settings.icon && settings.icon.id) || 'flame';
}

function iconLabel(id) {
  const custom = customIcons().find((icon) => icon.id === id);
  if (custom) return custom.name;
  return (ICON_PRESETS.find((icon) => icon.id === id) || ICON_PRESETS[0]).label;
}

function iconArtNode(id, className = '') {
  const custom = customIcons().find((icon) => icon.id === id);
  if (custom) {
    const img = document.createElement('img');
    img.src = custom.url;
    img.alt = '';
    if (className) img.className = className;
    return img;
  }

  const preset = ICON_PRESETS.find((icon) => icon.id === id) || ICON_PRESETS[0];
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  if (className) svg.setAttribute('class', className);
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', preset.path);
  svg.append(path);
  return svg;
}

function faviconHref(id) {
  const custom = customIcons().find((icon) => icon.id === id);
  if (custom) return custom.url;

  const preset = ICON_PRESETS.find((icon) => icon.id === id) || ICON_PRESETS[0];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#ff7a2f" d="${preset.path}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function renderAppIcon() {
  if (!els.appIconArt || !els.appIcon) return;

  const id = selectedIconId();
  els.appIconArt.replaceChildren(iconArtNode(id));
  els.appIcon.setAttribute(
    'aria-label',
    `Change app icon (currently ${iconLabel(id)}).`,
  );
  els.appIcon.title = `App icon: ${iconLabel(id)}. Change it.`;

  const favicon = document.querySelector('link[rel="icon"]');
  if (favicon) favicon.setAttribute('href', faviconHref(id));
}

function iconTile(icon) {
  const selected = selectedIconId() === icon.id;
  const label = icon.label || icon.name;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'icon-tile' + (selected ? ' is-selected' : '');
  button.dataset.icon = icon.id;
  button.setAttribute('aria-pressed', String(selected));
  button.setAttribute('aria-label', `${label}${selected ? ' (selected)' : ''}`);
  button.title = label;
  button.append(iconArtNode(icon.id, 'icon-tile-art'));

  const name = document.createElement('span');
  name.className = 'icon-tile-name';
  name.textContent = label;
  button.append(name);
  button.addEventListener('click', () => selectIcon(icon.id));
  return button;
}

function iconRow(icon) {
  const item = document.createElement('li');
  item.className = 'icon-item';

  const art = iconArtNode(icon.id, 'icon-item-art');

  const main = document.createElement('div');
  main.className = 'icon-item-main';

  const name = document.createElement('span');
  name.className = 'icon-item-name';
  name.textContent = icon.name;

  const url = document.createElement('span');
  url.className = 'icon-item-url';
  url.textContent = icon.url;

  main.append(name, url);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'profile-icon';
  remove.textContent = '×';
  remove.title = `Remove ${icon.name}`;
  remove.setAttribute('aria-label', `Remove ${icon.name}`);
  remove.addEventListener('click', () => deleteIcon(icon));

  item.append(art, main, remove);
  return item;
}

function renderIconPanel() {
  if (!els.iconPresets) return;

  const custom = customIcons();
  els.iconPresets.replaceChildren(
    ...ICON_PRESETS.map(iconTile),
    ...custom.map((icon) => iconTile({ id: icon.id, name: icon.name })),
  );

  els.iconCustomList.replaceChildren(...custom.map(iconRow));
  els.iconCustomList.hidden = custom.length === 0;
}

function setIconPanelOpen(open, { focus = true } = {}) {
  if (!els.iconPanel || !els.appIcon) return;

  els.iconPanel.hidden = !open;
  els.appIcon.setAttribute('aria-expanded', String(open));

  if (!open) {
    if (focus) els.appIcon.focus();
    return;
  }

  renderIconPanel();
  if (focus) els.iconPresets.querySelector('button')?.focus();
}

function focusIconTile(id) {
  const tile = [...els.iconPresets.querySelectorAll('button')].find(
    (button) => button.dataset.icon === id,
  );
  if (tile) tile.focus();
}

async function selectIcon(id) {
  try {
    settings = await api('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({ icon: { id } }),
    });
    renderSettings();
    focusIconTile(id);
    toast(`App icon set to ${iconLabel(id)}.`);
  } catch (error) {
    toast(error.message);
    renderIconPanel();
  }
}

async function addIcon(event) {
  event.preventDefault();

  const name = els.iconName.value.trim();
  const url = els.iconUrl.value.trim();
  if (!name || !url) return;

  try {
    const data = await api('/api/settings/icons', {
      method: 'POST',
      body: JSON.stringify({ name, url }),
    });
    settings = data.settings || settings;
    els.iconForm.reset();
    renderSettings();
    focusIconTile(data.icon.id);
    toast(`${data.icon.name} loaded.`);
  } catch (error) {
    toast(error.message);
  }
}

async function deleteIcon(icon) {
  if (!window.confirm(`Remove "${icon.name}"?`)) return;

  try {
    settings = await api(`/api/settings/icons/${icon.id}`, { method: 'DELETE' });
    renderSettings();
    focusIconTile(selectedIconId());
    toast(`${icon.name} removed.`);
  } catch (error) {
    toast(error.message);
  }
}

async function saveEtherFactor(event) {
  event.preventDefault();
  const factor = Number(els.etherFactor.value);

  if (!Number.isFinite(factor) || factor < 0.1 || factor > 10) {
    toast('Ether factor must be between 0.1 and 10.');
    return;
  }

  try {
    settings = await api('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({ etherFactor: factor }),
    });
    await load({ silent: true });
    toast(`Reward rate set to ${settings.etherFactor} ether per difficulty point.`);
  } catch (error) {
    toast(error.message);
  }
}

async function saveUrgencyFactor(event) {
  event.preventDefault();
  const factor = Number(els.urgencyFactor.value);

  if (!Number.isFinite(factor) || factor < 0.1 || factor > 10) {
    toast('Urgency factor must be between 0.1 and 10.');
    return;
  }

  try {
    settings = await api('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({ urgencyFactor: factor }),
    });
    await load({ silent: true });
    toast(`Penalty rate set to ${settings.urgencyFactor} ether per urgency point.`);
  } catch (error) {
    toast(error.message);
  }
}

/* ---------- load ---------- */

async function load({ silent = false } = {}) {
  try {
    const data = await api('/api/overview');
    profiles = data.profiles;
    settings = data.settings || {
      etherFactor: 1,
      urgencyFactor: 1,
      sounds: { habit: 'chime', purchase: 'pop', custom: [] },
      icon: { id: 'flame', custom: [] },
    };
    shop = data.shop && Array.isArray(data.shop.items) ? data.shop : { items: [] };
    lookup =
      data.lookup && data.lookup.amazon === true
        ? { amazon: true, mode: data.lookup.mode === 'api' ? 'api' : 'page' }
        : { amazon: false, mode: 'off' };
    today = data.today;

    if (!profiles.some((profile) => profile.id === activeTabId)) {
      activeTabId =
        profiles.find((profile) => profile.id === data.activeProfileId)?.id ||
        profiles[0]?.id ||
        null;
    }

    els.date.textContent = new Date().toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });

    renderProfileSettings();
    renderHabits();
    renderDashboard();
    renderShop();
    syncShopLookup();
    if (PAGE === 'shop') applyShopImport();
    if (PAGE === 'jobs') await loadJobs();
    renderSettings();
  } catch (error) {
    if (!silent) toast(`Could not load habits: ${error.message}`);
  }
}

/* ---------- actions ---------- */

async function addHabit(event, profile, input, button) {
  event.preventDefault();

  const raw = input.value.trim();
  if (!raw) return;

  let parsed;
  try {
    parsed = parseHabitInput(raw);
  } catch (error) {
    toast(error.message);
    return;
  }

  button.disabled = true;
  try {
    const habit = await api(`/api/habits${profileQuery(profile)}`, {
      method: 'POST',
      body: JSON.stringify(parsed),
    });
    profile.habits.push(habit);
    profile.habitCount = profile.habits.length;
    renderHabits();
    focusAddInput(profile.id);
  } catch (error) {
    toast(error.message);
    button.disabled = false;
  }
}

async function toggleHabit(profile, id) {
  const habit = profile.habits.find((item) => item.id === id);
  if (!habit) return;

  if (!habit.dueToday && !habit.doneToday) {
    toast('This habit is not scheduled for today.');
    return;
  }

  // Unlock audio while the tap is still a user gesture; the chime plays on success.
  ensureAudioContext();

  const next = !habit.doneToday;

  // Optimistic update so the tap feels instant. Streak is left alone; the
  // server recomputes it against the habit's schedule.
  habit.doneToday = next;
  renderHabits();

  try {
    const updated = await api(`/api/habits/${id}/toggle${profileQuery(profile)}`, {
      method: 'POST',
      body: JSON.stringify({ done: next }),
    });
    Object.assign(habit, updated);
    if (next) playHabitSound();
    await load({ silent: true });
    if (next) toast(`+${updated.earnedToday || updated.reward} ether earned for ${profile.name}`);
  } catch (error) {
    toast(error.message);
    await load({ silent: true });
  }
}

async function deleteHabit(profile, habit) {
  if (!window.confirm(`Delete "${habit.name}" from ${profile.name}? Its history will be lost.`)) {
    return;
  }

  try {
    await api(`/api/habits/${habit.id}${profileQuery(profile)}`, { method: 'DELETE' });
    await load({ silent: true });
  } catch (error) {
    toast(error.message);
  }
}

async function resetHabits(profile) {
  const hasHabits = profile.habits.length > 0;
  const hasHistory = profile.ether !== 0 || (profile.penalties || 0) > 0;
  if (!hasHabits && !hasHistory) {
    toast(`There is nothing to reset for ${profile.name}.`);
    return;
  }

  const message = hasHabits
    ? `Delete all ${plural(profile.habits.length, 'habit')} for ${profile.name}, their history, and all earned ether? This cannot be undone.`
    : `Delete the remaining ether and penalty history for ${profile.name}? This cannot be undone.`;
  if (!window.confirm(message)) {
    return;
  }

  try {
    await api(`/api/habits${profileQuery(profile)}`, { method: 'DELETE' });
    editingKey = null;
    editDraft = null;
    await load({ silent: true });
    toast(
      hasHabits
        ? `All habits and ether cleared for ${profile.name}.`
        : `Ether history cleared for ${profile.name}.`,
    );
  } catch (error) {
    toast(error.message);
  }
}

/* ---------- editing ---------- */

function habitCard(profile, id) {
  return (
    [...els.profileSections.querySelectorAll('.habit')].find(
      (node) =>
        node.dataset.id === id &&
        node.closest('[data-profile]')?.dataset.profile === profile.id,
    ) || null
  );
}

function focusEditName() {
  const input = els.profileSections.querySelector('.habit.is-editing .text-input');
  if (!input) return;
  input.focus();
  input.select();
}

function openEdit(profile, habit) {
  const key = habitKey(profile, habit);
  if (editingKey === key) return;
  editingKey = key;
  editDraft = {
    key,
    name: habit.name,
    difficulty: habit.difficulty,
    urgency: habit.urgency,
    days: [...habit.days],
  };
  renderHabits();
  focusEditName();
}

function closeEdit(profile, id = null) {
  if (!editingKey) return;
  editingKey = null;
  editDraft = null;
  renderHabits();
  if (id) habitCard(profile, id)?.querySelector('.edit')?.focus();
}

async function saveEdit(profile, habit, { name, difficulty, urgency, days, save }) {
  const trimmed = name.trim();
  if (!trimmed) {
    toast('Give the habit a name.');
    return;
  }
  if (days.length === 0) {
    toast('Pick at least one day for this habit.');
    return;
  }

  save.disabled = true;
  try {
    const updated = await api(`/api/habits/${habit.id}${profileQuery(profile)}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: trimmed, difficulty, urgency, days }),
    });
    Object.assign(habit, updated);
    editingKey = null;
    editDraft = null;
    renderHabits();
    habitCard(profile, habit.id)?.querySelector('.edit')?.focus();
  } catch (error) {
    toast(error.message);
    save.disabled = false;
  }
}

/* ---------- wiring ---------- */

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (editingKey) {
    event.preventDefault();
    closeEdit();
    return;
  }
  if (els.iconPanel && !els.iconPanel.hidden) {
    event.preventDefault();
    setIconPanelOpen(false);
    return;
  }
  if (PAGE === 'shop' && !els.shopForm.hidden) {
    event.preventDefault();
    setShopFormOpen(false);
  }
});

document.addEventListener('click', (event) => {
  if (!els.iconPanel || els.iconPanel.hidden) return;
  if (event.target.closest('#icon-panel') || event.target.closest('#app-icon')) return;
  setIconPanelOpen(false, { focus: false });
});

els.profileAdd.addEventListener('click', createProfile);
els.appIcon.addEventListener('click', () => setIconPanelOpen(els.iconPanel.hidden));
els.iconPanelClose.addEventListener('click', () => setIconPanelOpen(false));
els.iconForm.addEventListener('submit', addIcon);
els.etherForm.addEventListener('submit', saveEtherFactor);
els.urgencyForm.addEventListener('submit', saveUrgencyFactor);
els.habitSound.addEventListener('change', () => saveSoundChoice('habit', els.habitSound.value));
els.purchaseSound.addEventListener('change', () =>
  saveSoundChoice('purchase', els.purchaseSound.value),
);
els.soundPreviews.forEach((button) => {
  button.addEventListener('click', () => {
    const slot = button.dataset.preview === 'purchase' ? 'purchase' : 'habit';
    ensureAudioContext();
    playSound((settings.sounds && settings.sounds[slot]) || (slot === 'habit' ? 'chime' : 'pop'));
  });
});
els.soundForm.addEventListener('submit', addSound);
els.shopForm.addEventListener('submit', addShopItem);
els.shopAddToggle.addEventListener('click', () => setShopFormOpen(true));
els.shopFormClose.addEventListener('click', () => setShopFormOpen(false));
els.shopLookup.addEventListener('click', () => lookupShopLink());
els.shopBookmarklet.href = shopBookmarkletHref();
els.shopBookmarklet.addEventListener('click', (event) => {
  event.preventDefault();
  toast('Drag this link to your bookmarks bar, then click it on an amazon.in product page.');
});
els.shopLink.addEventListener('input', () => {
  const parsed = parseAmazonLink(els.shopLink.value);
  if (!parsed || parsed.asin !== shopLookupState.attempted) setShopLookupStatus('');
  syncShopLookup();
  scheduleShopLookup();
});
els.jobForm.addEventListener('submit', addJob);
els.jobActor.addEventListener('change', () => selectJobActor(els.jobActor.value));
wireJobDrop(els.jobCompletedBox, (id) => {
  const job = jobs.inProgress.find((entry) => entry.id === id);
  if (job) completeJob(job);
});
els.appearanceToggle.addEventListener('click', () => {
  applyAppearance(appearance === 'light' ? 'dark' : 'light');
});
els.dashboardRange.addEventListener('change', () => {
  dashboardRange = els.dashboardRange.value === 'month' ? 'month' : 'week';
  rememberDashboardRange(dashboardRange);
  renderDashboard();
});
for (const tab of dashboardTabNodes()) {
  tab.addEventListener('click', () => setDashboardView(tab.dataset.view));
  tab.addEventListener('keydown', onDashboardTabKeydown);
}

/* ---------- keep "today" honest ---------- */

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) load({ silent: true });
});

setInterval(() => {
  if (today && localDayKey() !== today) load({ silent: true });
}, 60 * 1000);

// Keep the shared job board fresh so everyone sees a job being taken.
setInterval(() => {
  if (PAGE === 'jobs' && !document.hidden) refreshJobsQuietly();
}, 10 * 1000);

applyPage();
applyDashboardView();
applyAppearance(appearance, { persist: false });

load();

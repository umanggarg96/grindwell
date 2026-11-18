'use strict';

const els = {
  date: document.getElementById('date'),
  appearanceToggle: document.getElementById('appearance-toggle'),
  appearanceLabel: document.getElementById('appearance-label'),
  profileTabs: document.getElementById('profile-tabs'),
  profileSections: document.getElementById('profile-sections'),
  profileList: document.getElementById('profile-list'),
  profileAdd: document.getElementById('profile-add'),
  etherForm: document.getElementById('ether-form'),
  etherFactor: document.getElementById('ether-factor'),
  etherTotal: document.getElementById('ether-total'),
  etherToday: document.getElementById('ether-today'),
  etherRange: document.getElementById('ether-range'),
  etherRangeLabel: document.getElementById('ether-range-label'),
  dashboardRange: document.getElementById('dashboard-range'),
  dashboardList: document.getElementById('dashboard-list'),
  shopAddToggle: document.getElementById('shop-add-toggle'),
  shopForm: document.getElementById('shop-form'),
  shopFormClose: document.getElementById('shop-form-close'),
  shopName: document.getElementById('shop-name'),
  shopLink: document.getElementById('shop-link'),
  shopCost: document.getElementById('shop-cost'),
  shopImage: document.getElementById('shop-image'),
  shopConsumable: document.getElementById('shop-consumable'),
  shopList: document.getElementById('shop-list'),
  shopEmpty: document.getElementById('shop-empty'),
  shopBalance: document.getElementById('shop-balance'),
  pages: {
    habits: document.getElementById('page-habits'),
    dashboard: document.getElementById('page-dashboard'),
    shop: document.getElementById('page-shop'),
    settings: document.getElementById('page-settings'),
  },
  navLinks: document.querySelectorAll('[data-nav]'),
};

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const parseHabitInput = window.HabitInput.parseHabitInput;
// Display weeks starting on Monday; the wire format stays 0 = Sunday.
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
// Colours live in styles.css as [data-theme="..."] blocks; keep ids in sync.
const THEMES = [
  { id: 'ember', name: 'Ember' },
  { id: 'blue', name: 'Blue' },
  { id: 'teal', name: 'Teal' },
  { id: 'green', name: 'Green' },
  { id: 'lime', name: 'Lime' },
  { id: 'violet', name: 'Violet' },
  { id: 'rose', name: 'Rose' },
];
const PAGE_PATH = window.location.pathname.replace(/\/+$/, '') || '/';
const PAGE =
  PAGE_PATH === '/dashboard'
    ? 'dashboard'
    : PAGE_PATH === '/settings'
      ? 'settings'
      : PAGE_PATH === '/shop'
        ? 'shop'
        : 'habits';
const DASHBOARD_RANGE_KEY = 'grindwell.dashboardRange';
const APPEARANCE_KEY = 'grindwell.appearance';
const APPEARANCE_COLORS = { dark: '#100d0b', light: '#f6f2ec' };
const SVG_NS = 'http://www.w3.org/2000/svg';
const STAR_PATH =
  'M12 2.2l2.94 6.02 6.64.96-4.79 4.67 1.13 6.61L12 17.36l-5.92 3.1 1.13-6.61L2.42 9.18l6.64-.96L12 2.2z';

let profiles = [];
let settings = { etherFactor: 1 };
let shop = { items: [] };
let today = '';
let activeTabId = null;
let dashboardRange = storedDashboardRange();
let appearance = document.documentElement.dataset.appearance === 'light' ? 'light' : 'dark';
let toastTimer = null;
let audioContext = null;
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

function playPurchaseSound() {
  playChime([660, 880]);
}

function playHabitSound() {
  playChime([523.25, 659.25, 783.99]);
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

function rangeEther(summary) {
  return dashboardRange === 'month'
    ? Number(summary.last30) || 0
    : Number(summary.last7) || 0;
}

function syncDifficulty(input, output) {
  const value = Number(input.value);
  const { word } = difficultyBand(value);
  output.textContent = String(value);
  input.setAttribute('aria-valuetext', `${value} out of 10, ${word}`);
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

  form.append(title, nameInput, difficultyField, daysField, actions);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    saveEdit(profile, habit, {
      name: nameInput.value,
      difficulty: Number(difficultyInput.value),
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
  reset.disabled = profile.habits.length === 0 && profile.ether === 0;
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
  input.placeholder = 'Read 10 pages ; 6 ; sat,sun';
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
  const chart = document.createElement('div');
  chart.className = 'ether-chart' + (monthly ? ' is-month' : '');
  chart.setAttribute('role', 'img');
  chart.setAttribute(
    'aria-label',
    `Ether earned per day over the ${rangeLabel().toLowerCase()} for ${profileName}`,
  );

  const max = Math.max(1, ...days.map((day) => day.ether));
  const nodes = days.map((day, index) => {
    const [year, month, date] = day.date.split('-').map(Number);
    const weekday = DAY_SHORT[new Date(year, month - 1, date).getDay()];
    const showLabel = !monthly || index % 5 === 0 || index === days.length - 1;

    const column = document.createElement('div');
    column.className = 'ether-day' + (day.date === today ? ' is-today' : '');

    if (!monthly) {
      const value = document.createElement('span');
      value.className = 'ether-day-value';
      value.textContent = String(day.ether);
      column.append(value);
    }

    const track = document.createElement('div');
    track.className = 'ether-bar-track';

    const bar = document.createElement('div');
    bar.className = 'ether-bar';
    bar.style.height = `${Math.round((day.ether / max) * 100)}%`;
    track.append(bar);

    const name = document.createElement('span');
    name.className = 'ether-day-label';
    name.textContent = showLabel ? (monthly ? String(date) : weekday) : '';

    column.append(track, name);
    column.title = `${day.date}: ${plural(day.ether, 'ether')}`;
    return column;
  });

  chart.replaceChildren(...nodes);
  return chart;
}

function dashboardCard(profile) {
  const summary = profile.summary || {
    total: profile.ether,
    earned: profile.earned ?? profile.ether,
    today: 0,
    last7: 0,
    last30: 0,
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
  stats.append(statNode('Today', summary.today), statNode(rangeLabel(), rangeEther(summary)));

  head.append(left, stats);
  card.append(head, etherChartNode(rangeDays(summary), profile.name));
  return card;
}

function renderDashboard() {
  const total = profiles.reduce((sum, profile) => sum + (profile.ether || 0), 0);
  const todayTotal = profiles.reduce(
    (sum, profile) => sum + ((profile.summary && profile.summary.today) || 0),
    0,
  );
  const rangeTotal = profiles.reduce(
    (sum, profile) => sum + rangeEther(profile.summary || {}),
    0,
  );

  els.etherTotal.textContent = String(total);
  els.etherToday.textContent = String(todayTotal);
  els.etherRangeLabel.textContent = rangeLabel();
  els.etherRange.textContent = String(rangeTotal);
  els.dashboardRange.value = dashboardRange;

  els.dashboardList.replaceChildren(...profiles.map(dashboardCard));
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
  if (focus) (open ? els.shopName : els.shopAddToggle).focus();
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

/* ---------- settings ---------- */

function renderSettings() {
  if (document.activeElement !== els.etherFactor) {
    els.etherFactor.value = String(settings.etherFactor);
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

/* ---------- load ---------- */

async function load({ silent = false } = {}) {
  try {
    const data = await api('/api/overview');
    profiles = data.profiles;
    settings = data.settings || { etherFactor: 1 };
    shop = data.shop && Array.isArray(data.shop.items) ? data.shop : { items: [] };
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
  const hasEther = profile.ether > 0;
  if (!hasHabits && !hasEther) {
    toast(`There is nothing to reset for ${profile.name}.`);
    return;
  }

  const message = hasHabits
    ? `Delete all ${plural(profile.habits.length, 'habit')} for ${profile.name}, their history, and all earned ether? This cannot be undone.`
    : `Delete all ${plural(profile.ether, 'ether')} for ${profile.name}? This cannot be undone.`;
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
        : `Ether cleared for ${profile.name}.`,
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

async function saveEdit(profile, habit, { name, difficulty, days, save }) {
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
      body: JSON.stringify({ name: trimmed, difficulty, days }),
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
  if (PAGE === 'shop' && !els.shopForm.hidden) {
    event.preventDefault();
    setShopFormOpen(false);
  }
});

els.profileAdd.addEventListener('click', createProfile);
els.etherForm.addEventListener('submit', saveEtherFactor);
els.shopForm.addEventListener('submit', addShopItem);
els.shopAddToggle.addEventListener('click', () => setShopFormOpen(true));
els.shopFormClose.addEventListener('click', () => setShopFormOpen(false));
els.appearanceToggle.addEventListener('click', () => {
  applyAppearance(appearance === 'light' ? 'dark' : 'light');
});
els.dashboardRange.addEventListener('change', () => {
  dashboardRange = els.dashboardRange.value === 'month' ? 'month' : 'week';
  rememberDashboardRange(dashboardRange);
  renderDashboard();
});

/* ---------- keep "today" honest ---------- */

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) load({ silent: true });
});

setInterval(() => {
  if (today && localDayKey() !== today) load({ silent: true });
}, 60 * 1000);

applyPage();
applyAppearance(appearance, { persist: false });

load();

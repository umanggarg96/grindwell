'use strict';

const els = {
  date: document.getElementById('date'),
  theme: document.getElementById('theme'),
  themeToggle: document.getElementById('theme-toggle'),
  themePanel: document.getElementById('theme-panel'),
  themeSwatches: document.getElementById('theme-swatches'),
  profiles: document.getElementById('profile-pills'),
  profileAdd: document.getElementById('profile-add'),
  reset: document.getElementById('reset-habits'),
  form: document.getElementById('add-form'),
  input: document.getElementById('habit-input'),
  submit: document.querySelector('#add-form button'),
  list: document.getElementById('habit-list'),
  empty: document.getElementById('empty'),
  doneCount: document.getElementById('done-count'),
  totalCount: document.getElementById('total-count'),
  bar: document.getElementById('bar'),
  barFill: document.getElementById('bar-fill'),
  hint: document.getElementById('hint'),
  etherTotal: document.getElementById('ether-total'),
  etherToday: document.getElementById('ether-today'),
  etherWeek: document.getElementById('ether-week'),
  etherChart: document.getElementById('ether-chart'),
  etherForm: document.getElementById('ether-form'),
  etherFactor: document.getElementById('ether-factor'),
  dashboardProfile: document.getElementById('dashboard-profile'),
  pages: {
    habits: document.getElementById('page-habits'),
    dashboard: document.getElementById('page-dashboard'),
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
const THEME_KEY = 'grindwell.theme';
const PAGE_PATH = window.location.pathname.replace(/\/+$/, '') || '/';
const PAGE =
  PAGE_PATH === '/dashboard' ? 'dashboard' : PAGE_PATH === '/settings' ? 'settings' : 'habits';

let habits = [];
let profiles = [];
let activeProfile = null;
let ether = null;
let settings = { etherFactor: 1 };
let today = '';
let toastTimer = null;
let editingId = null;
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

/* ---------- pages ---------- */

function applyPage() {
  document.body.dataset.page = PAGE;

  for (const [name, node] of Object.entries(els.pages)) {
    if (node) node.hidden = name !== PAGE;
  }

  // Reset only makes sense on the habits page.
  els.reset.hidden = PAGE !== 'habits';

  for (const link of els.navLinks) {
    if (link.dataset.nav === PAGE) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

/* ---------- theme ---------- */

function currentThemeId() {
  const id = document.documentElement.getAttribute('data-theme');
  return THEMES.some((theme) => theme.id === id) ? id : THEMES[0].id;
}

function syncThemeButtons() {
  const current = currentThemeId();
  for (const button of els.themeSwatches.querySelectorAll('.swatch')) {
    button.setAttribute('aria-pressed', String(button.dataset.theme === current));
  }
  const active = THEMES.find((theme) => theme.id === current);
  els.themeToggle.setAttribute('aria-label', `Theme color: ${active.name}. Change theme`);
}

function applyTheme(id, { persistServer = false } = {}) {
  const theme = THEMES.find((item) => item.id === id) || THEMES[0];
  document.documentElement.setAttribute('data-theme', theme.id);
  try {
    // Acts as a pre-paint cache for the active profile's server-side theme.
    localStorage.setItem(THEME_KEY, theme.id);
  } catch {
    /* storage unavailable; the theme still applies for this session */
  }
  syncThemeButtons();

  if (persistServer && activeProfile) {
    api(`/api/profiles/${activeProfile.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ theme: theme.id }),
    })
      .then((updated) => {
        activeProfile = updated;
        const inList = profiles.find((item) => item.id === updated.id);
        if (inList) inList.theme = updated.theme;
      })
      .catch((error) => toast(`Could not save theme: ${error.message}`));
  }
}

function buildThemes() {
  for (const theme of THEMES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'swatch';
    button.dataset.theme = theme.id;
    button.setAttribute('aria-pressed', 'false');

    const dot = document.createElement('span');
    dot.className = 'swatch-dot';
    dot.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.className = 'swatch-label';
    label.textContent = theme.name;

    button.append(dot, label);
    button.addEventListener('click', () => {
      applyTheme(theme.id, { persistServer: true });
      setThemePanel(false);
      els.themeToggle.focus();
    });

    els.themeSwatches.appendChild(button);
  }

  syncThemeButtons();
}

function setThemePanel(open) {
  els.themePanel.hidden = !open;
  els.themeToggle.setAttribute('aria-expanded', String(open));
}

/* ---------- profiles ---------- */

function renderProfiles() {
  const nodes = profiles.map((profile) => {
    const isActive = profile.id === activeProfile?.id;
    const item = document.createElement('div');
    item.className = 'profile-item' + (isActive ? ' is-active' : '');

    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'profile-pill';
    pill.textContent = profile.name;
    pill.setAttribute('aria-pressed', String(isActive));
    pill.title = `Switch to ${profile.name}`;
    pill.addEventListener('click', () => switchProfile(profile.id));

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

    item.append(pill, rename, remove);
    return item;
  });

  els.profiles.replaceChildren(...nodes);
}

async function switchProfile(id) {
  if (!id || id === activeProfile?.id) return;
  try {
    await api(`/api/profiles/${id}/activate`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    await load({ silent: true });
  } catch (error) {
    toast(error.message);
  }
}

async function createProfile() {
  const name = window.prompt('Name for the new profile:');
  if (!name || !name.trim()) return;

  try {
    await api('/api/profiles', {
      method: 'POST',
      body: JSON.stringify({ name, theme: currentThemeId() }),
    });
    await load({ silent: true });
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
    await load({ silent: true });
    toast(`Profile "${profile.name}" deleted.`);
  } catch (error) {
    toast(error.message);
  }
}

/* ---------- ether ---------- */

function renderEther() {
  if (!ether) return;

  els.etherTotal.textContent = String(ether.total);
  els.etherToday.textContent = String(ether.today);
  els.etherWeek.textContent = String(ether.last7);

  if (document.activeElement !== els.etherFactor) {
    els.etherFactor.value = String(settings.etherFactor);
  }

  const max = Math.max(1, ...ether.days.map((day) => day.ether));
  const nodes = ether.days.map((day) => {
    const [year, month, date] = day.date.split('-').map(Number);
    const label = DAY_SHORT[new Date(year, month - 1, date).getDay()];

    const column = document.createElement('div');
    column.className = 'ether-day' + (day.date === today ? ' is-today' : '');

    const value = document.createElement('span');
    value.className = 'ether-day-value';
    value.textContent = String(day.ether);

    const track = document.createElement('div');
    track.className = 'ether-bar-track';

    const bar = document.createElement('div');
    bar.className = 'ether-bar';
    bar.style.height = `${Math.round((day.ether / max) * 100)}%`;
    track.append(bar);

    const name = document.createElement('span');
    name.className = 'ether-day-label';
    name.textContent = label;

    column.append(value, track, name);
    column.title = `${day.date}: ${plural(day.ether, 'ether')}`;
    return column;
  });

  els.etherChart.replaceChildren(...nodes);
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

/* ---------- rendering ---------- */

function habitNode(habit) {
  const li = document.createElement('li');
  li.dataset.id = habit.id;
  li.className =
    'habit' + (habit.doneToday ? ' is-done' : '') + (habit.dueToday ? '' : ' is-rest');

  // Editing happens in place: the card itself becomes the form.
  if (habit.id === editingId) {
    li.classList.add('is-editing');
    li.append(editFormNode(habit));
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
  check.addEventListener('click', () => toggleHabit(habit.id));

  const main = document.createElement('div');
  main.className = 'habit-main';

  const name = document.createElement('span');
  name.className = 'habit-name';
  name.textContent = habit.name;

  const meta = document.createElement('span');
  meta.className = 'habit-meta';

  const streak = document.createElement('span');
  streak.textContent = habit.streak > 0 ? `🔥 ${plural(habit.streak, 'day')} streak` : 'No streak yet';

  const band = difficultyBand(habit.difficulty);
  const difficulty = document.createElement('span');
  difficulty.className = `chip chip-${band.key}`;
  difficulty.textContent = `Difficulty ${habit.difficulty}/10`;
  difficulty.title = `${band.word[0].toUpperCase()}${band.word.slice(1)} difficulty`;

  const reward = document.createElement('span');
  reward.className = 'chip chip-ether';
  reward.textContent = `+${habit.reward} ether`;
  reward.title = `Earn ${plural(habit.reward, 'ether')} when you complete this`;

  meta.append(streak, difficulty, reward);

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
  remove.addEventListener('click', () => deleteHabit(habit));

  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'edit';
  edit.setAttribute('aria-label', `Edit "${habit.name}"`);
  edit.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h3.5L18.6 8.9a2.1 2.1 0 0 0-3-3L4.5 17Z"/><path d="m13.6 6.9 3 3"/></svg>';
  edit.addEventListener('click', () => openEdit(habit));

  li.append(check, main, edit, remove);
  return li;
}

function editFormNode(habit) {
  const draft = editDraft && editDraft.id === habit.id ? editDraft : habit;

  const form = document.createElement('form');
  form.className = 'habit-edit';
  form.setAttribute('aria-label', `Edit "${habit.name}"`);

  const title = document.createElement('p');
  title.className = 'habit-edit-title';
  title.textContent = 'Edit habit';

  const nameInput = document.createElement('input');
  nameInput.className = 'text-input';
  nameInput.type = 'text';
  nameInput.name = 'name';
  nameInput.maxLength = 60;
  nameInput.required = true;
  nameInput.value = draft.name;
  nameInput.setAttribute('aria-label', 'Habit name');
  nameInput.addEventListener('input', () => {
    if (editDraft && editDraft.id === habit.id) editDraft.name = nameInput.value;
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
    if (editDraft && editDraft.id === habit.id) {
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
      if (editDraft && editDraft.id === habit.id) editDraft.days = selectedDays(days);
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
  cancel.addEventListener('click', () => closeEdit(habit.id));

  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'primary';
  save.textContent = 'Save';

  actions.append(cancel, save);

  form.append(title, nameInput, difficultyField, daysField, actions);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    saveEdit(habit, {
      name: nameInput.value,
      difficulty: Number(difficultyInput.value),
      days: selectedDays(days),
      save,
    });
  });

  return form;
}

function render() {
  // Progress only counts habits that are actually due today.
  const due = habits.filter((habit) => habit.dueToday);
  const total = due.length;
  const done = due.filter((habit) => habit.doneToday).length;
  const percent = total ? Math.round((done / total) * 100) : 0;

  els.totalCount.textContent = String(total);
  els.doneCount.textContent = String(done);
  els.barFill.style.width = `${percent}%`;
  els.bar.setAttribute('aria-valuenow', String(percent));
  els.empty.hidden = habits.length !== 0;

  if (habits.length === 0) {
    els.hint.textContent = 'Nothing here yet. Add a habit you want to do every day.';
  } else if (total === 0) {
    els.hint.textContent = 'Nothing scheduled today. Rest up.';
  } else if (done === total) {
    els.hint.textContent = 'All done for today. Well forged.';
  } else {
    els.hint.textContent = `${plural(total - done, 'habit')} left today.`;
  }

  // Rest-day habits stay visible but sink below today's work.
  const ordered = [...habits].sort((a, b) => Number(b.dueToday) - Number(a.dueToday));
  els.list.replaceChildren(...ordered.map(habitNode));
}

/* ---------- actions ---------- */

async function load({ silent = false } = {}) {
  try {
    const data = await api('/api/habits');
    habits = data.habits;
    profiles = data.profiles;
    activeProfile = data.profile;
    ether = data.ether;
    settings = data.settings || { etherFactor: ether.factor };
    today = data.today;

    applyTheme(activeProfile.theme);
    renderProfiles();
    els.dashboardProfile.textContent = `Ether for ${activeProfile.name}`;

    els.date.textContent = new Date().toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });

    render();
    renderEther();
  } catch (error) {
    if (!silent) toast(`Could not load habits: ${error.message}`);
  }
}

async function toggleHabit(id) {
  const habit = habits.find((item) => item.id === id);
  if (!habit) return;

  if (!habit.dueToday && !habit.doneToday) {
    toast('This habit is not scheduled for today.');
    return;
  }

  const next = !habit.doneToday;
  const earnedBefore = habit.earnedToday || 0;

  // Optimistic update so the tap feels instant. Streak is left alone; the
  // server recomputes it against the habit's schedule.
  habit.doneToday = next;
  render();

  try {
    const updated = await api(`/api/habits/${id}/toggle`, {
      method: 'POST',
      body: JSON.stringify({ done: next }),
    });
    Object.assign(habit, updated);

    // Keep the dashboard in sync without a full reload. The server locks in
    // the reward, so use the amount it reports.
    if (ether) {
      const delta = updated.earnedToday - earnedBefore;
      if (delta !== 0) {
        ether.total += delta;
        ether.today += delta;
        ether.last7 += delta;
        const todayBucket = ether.days[ether.days.length - 1];
        if (todayBucket && todayBucket.date === today) {
          todayBucket.ether = Math.max(0, todayBucket.ether + delta);
        }
        renderEther();
      }
    }

    render();
    if (next) toast(`+${updated.earnedToday || updated.reward} ether earned`);
  } catch (error) {
    toast(error.message);
    await load({ silent: true });
  }
}

async function deleteHabit(habit) {
  if (!window.confirm(`Delete "${habit.name}"? Its history will be lost.`)) return;

  try {
    await api(`/api/habits/${habit.id}`, { method: 'DELETE' });
    habits = habits.filter((item) => item.id !== habit.id);
    await load({ silent: true });
  } catch (error) {
    toast(error.message);
  }
}

async function resetHabits() {
  if (habits.length === 0) {
    toast('There is nothing to reset.');
    return;
  }
  if (!window.confirm(`Delete all ${plural(habits.length, 'habit')} and their history? This cannot be undone.`)) {
    return;
  }

  els.reset.disabled = true;
  try {
    await api('/api/habits', { method: 'DELETE' });
    habits = [];
    editingId = null;
    editDraft = null;
    await load({ silent: true });
    toast('All habits cleared.');
  } catch (error) {
    toast(error.message);
  } finally {
    els.reset.disabled = false;
  }
}

/* ---------- editing ---------- */

function habitCard(id) {
  return [...els.list.querySelectorAll('.habit')].find((node) => node.dataset.id === id) || null;
}

function focusEditName() {
  const input = els.list.querySelector('.habit.is-editing .text-input');
  if (!input) return;
  input.focus();
  input.select();
}

function openEdit(habit) {
  if (editingId === habit.id) return;
  editingId = habit.id;
  editDraft = {
    id: habit.id,
    name: habit.name,
    difficulty: habit.difficulty,
    days: [...habit.days],
  };
  render();
  focusEditName();
}

function closeEdit(id = editingId) {
  if (!id) return;
  editingId = null;
  editDraft = null;
  render();
  habitCard(id)?.querySelector('.edit')?.focus();
}

async function saveEdit(habit, { name, difficulty, days, save }) {
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
    const updated = await api(`/api/habits/${habit.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: trimmed, difficulty, days }),
    });
    Object.assign(habit, updated);
    editingId = null;
    editDraft = null;
    render();
    habitCard(habit.id)?.querySelector('.edit')?.focus();
  } catch (error) {
    toast(error.message);
    save.disabled = false;
  }
}

els.themeToggle.addEventListener('click', () => {
  setThemePanel(els.themePanel.hidden);
});

document.addEventListener('click', (event) => {
  if (els.themePanel.hidden) return;
  if (els.theme.contains(event.target)) return;
  setThemePanel(false);
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (editingId) {
    event.preventDefault();
    closeEdit();
    return;
  }
  if (!els.themePanel.hidden) {
    setThemePanel(false);
    els.themeToggle.focus();
  }
});

els.profileAdd.addEventListener('click', createProfile);
els.reset.addEventListener('click', resetHabits);
els.etherForm.addEventListener('submit', saveEtherFactor);

els.form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const raw = els.input.value.trim();
  if (!raw) return;

  let parsed;
  try {
    parsed = parseHabitInput(raw);
  } catch (error) {
    toast(error.message);
    return;
  }

  els.submit.disabled = true;
  try {
    const habit = await api('/api/habits', {
      method: 'POST',
      body: JSON.stringify(parsed),
    });
    habits.push(habit);
    els.input.value = '';
    render();
  } catch (error) {
    toast(error.message);
  } finally {
    els.submit.disabled = false;
    els.input.focus();
  }
});

/* ---------- keep "today" honest ---------- */

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) load({ silent: true });
});

setInterval(() => {
  if (today && localDayKey() !== today) load({ silent: true });
}, 60 * 1000);

applyPage();
buildThemes();

load();

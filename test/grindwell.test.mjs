import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'grindwell-test-'));
const dataFile = path.join(tmpDir, 'data.json');
const port = Number(process.env.TEST_PORT || 3111);

const require = createRequire(import.meta.url);
const { parseHabitInput } = require(path.join(root, 'public/habit-input.js'));

let failures = 0;
function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` -> ${detail}` : ''}`);
  }
}

function dayKeyOf(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

const todayRef = new Date();
const todayDow = todayRef.getDay();
const otherDow = (todayDow + 1) % 7;
const TODAY = dayKeyOf(todayRef);
const daysAgo = (n) => {
  const date = new Date(todayRef);
  date.setDate(date.getDate() - n);
  return dayKeyOf(date);
};

await fs.rm(dataFile, { force: true });
await fs.writeFile(
  dataFile,
  JSON.stringify({
    habits: [
      {
        id: 'legacy-habit',
        name: 'Legacy habit',
        createdAt: new Date().toISOString(),
        completions: [],
      },
      {
        id: 'weekly-today',
        name: 'Weekly today',
        createdAt: new Date().toISOString(),
        days: [todayDow],
        completions: [daysAgo(7), daysAgo(14), TODAY],
      },
      {
        id: 'weekly-missed',
        name: 'Weekly missed',
        createdAt: new Date().toISOString(),
        days: [todayDow],
        completions: [daysAgo(7)],
      },
      {
        id: 'rest-bonus',
        name: 'Rest bonus',
        createdAt: new Date().toISOString(),
        days: [otherDow],
        completions: [TODAY],
      },
    ],
  }),
);

const child = spawn(process.execPath, [path.join(root, 'server.js')], {
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_FILE: dataFile },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let logs = '';
child.stdout.on('data', (d) => (logs += d));
child.stderr.on('data', (d) => (logs += d));

await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`server did not start:\n${logs}`)), 5000);
  child.stdout.on('data', () => {
    if (logs.includes('listening')) {
      clearTimeout(timer);
      resolve();
    }
  });
});

const base = `http://127.0.0.1:${port}`;
async function call(p, options = {}) {
  const res = await fetch(base + p, options);
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body, headers: res.headers };
}

const json = (payload) => ({
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

try {
  console.log('\nlegacy data + schedule math');
  let r = await call('/api/health');
  check('health returns ok', r.status === 200 && r.body.ok === true, JSON.stringify(r.body));

  r = await call('/api/habits');
  const seeded = new Map(r.body.habits.map((habit) => [habit.id, habit]));

  check(
    'legacy file migrated into a profile',
    r.body.profile?.name === 'Mine' &&
      r.body.profile?.theme === 'ember' &&
      r.body.profiles?.length === 1 &&
      r.body.profiles[0].habitCount === 4,
    JSON.stringify(r.body.profiles),
  );

  const legacy = seeded.get('legacy-habit');
  check(
    'legacy habit becomes daily with difficulty 5',
    legacy.difficulty === 5 &&
      JSON.stringify(legacy.days) === JSON.stringify([0, 1, 2, 3, 4, 5, 6]) &&
      legacy.dueToday === true,
    JSON.stringify(legacy),
  );

  const seededRaw = JSON.parse(await fs.readFile(dataFile, 'utf8'));
  check(
    'legacy habits live under the profile on disk',
    Array.isArray(
      seededRaw.profiles[0].habits.find((habit) => habit.id === 'legacy-habit').days,
    ) &&
      seededRaw.profiles[0].habits.length === 4 &&
      seededRaw.activeProfileId === seededRaw.profiles[0].id,
  );

  const weeklyToday = seeded.get('weekly-today');
  check(
    'scheduled streak counts scheduled days only',
    weeklyToday.streak === 3 && weeklyToday.dueToday === true && weeklyToday.doneToday === true,
    JSON.stringify(weeklyToday),
  );

  const weeklyMissed = seeded.get('weekly-missed');
  check(
    'scheduled streak survives until today ends',
    weeklyMissed.doneToday === false && weeklyMissed.streak === 1,
    `${weeklyMissed.doneToday} / ${weeklyMissed.streak}`,
  );

  const restBonus = seeded.get('rest-bonus');
  check(
    'legacy off-day completion is kept out of the streak',
    restBonus.dueToday === false && restBonus.doneToday === true && restBonus.streak === 0,
    JSON.stringify(restBonus),
  );

  r = await call('/api/habits/rest-bonus/toggle', { method: 'POST', ...json({ done: true }) });
  check('rest day cannot be marked done', r.status === 400, `${r.status} ${JSON.stringify(r.body)}`);

  r = await call('/api/habits/rest-bonus/toggle', { method: 'POST', ...json({}) });
  check(
    'legacy off-day completion can be cleared',
    r.status === 200 && r.body.doneToday === false,
    `${r.status} ${JSON.stringify(r.body)}`,
  );

  for (const seedId of ['legacy-habit', 'weekly-today', 'weekly-missed', 'rest-bonus']) {
    await call(`/api/habits/${seedId}`, { method: 'DELETE' });
  }

  r = await call('/api/habits');
  check('empty habit list', r.status === 200 && Array.isArray(r.body.habits) && r.body.habits.length === 0);
  check('today is a YYYY-MM-DD key', /^\d{4}-\d{2}-\d{2}$/.test(r.body.today), r.body.today);

  // Deleting the seeded habits keeps their earned ether by design, so clear it
  // before the ether tests that assert exact totals.
  r = await call('/api/habits', { method: 'DELETE' });
  check('reset clears seeded ether', r.status === 204);

  console.log('\ncreate');
  r = await call('/api/habits', { method: 'POST', ...json({ name: '  Read   10 pages  ' }) });
  check('create returns 201', r.status === 201, String(r.status));
  check('name is trimmed/collapsed', r.body.name === 'Read 10 pages', r.body.name);
  check('starts not done', r.body.doneToday === false);
  check('starts with empty streak', r.body.streak === 0);
  check('defaults difficulty to 5', r.body.difficulty === 5, String(r.body.difficulty));
  check(
    'defaults to daily schedule',
    JSON.stringify(r.body.days) === JSON.stringify([0, 1, 2, 3, 4, 5, 6]) && r.body.dueToday === true,
    JSON.stringify(r.body.days),
  );
  const id = r.body.id;

  r = await call('/api/habits', { method: 'POST', ...json({ name: '   ' }) });
  check('blank name rejected', r.status === 400 && typeof r.body.error === 'string');

  r = await call('/api/habits', { method: 'POST', ...json({ name: 'x'.repeat(61) }) });
  check('long name rejected', r.status === 400);

  console.log('\ndifficulty');
  r = await call('/api/habits', { method: 'POST', ...json({ name: 'Run 5k', difficulty: 8 }) });
  check('difficulty 8 stored', r.status === 201 && r.body.difficulty === 8, JSON.stringify(r.body));
  const hardId = r.body.id;

  for (const bad of [0, 11, 1.5, '7', null]) {
    r = await call('/api/habits', { method: 'POST', ...json({ name: 'Bad difficulty', difficulty: bad }) });
    check(`difficulty ${JSON.stringify(bad)} rejected`, r.status === 400, `${r.status} ${JSON.stringify(r.body)}`);
  }

  await call(`/api/habits/${hardId}`, { method: 'DELETE' });

  console.log('\nschedule');
  r = await call('/api/habits', { method: 'POST', ...json({ name: 'Weekdays', days: [5, 1, 3, 1] }) });
  check('days deduplicated and sorted', JSON.stringify(r.body.days) === JSON.stringify([1, 3, 5]), JSON.stringify(r.body.days));
  check(
    'dueToday follows the day set',
    r.body.dueToday === [1, 3, 5].includes(todayDow),
    `dueToday=${r.body.dueToday} dow=${todayDow}`,
  );
  const scheduledId = r.body.id;

  r = await call('/api/habits', { method: 'POST', ...json({ name: 'Not today', days: [otherDow] }) });
  check('habit off today is not due', r.status === 201 && r.body.dueToday === false);
  const offId = r.body.id;

  r = await call(`/api/habits/${offId}/toggle`, { method: 'POST', ...json({ done: true }) });
  check('rest day rejects explicit completion', r.status === 400, `${r.status} ${JSON.stringify(r.body)}`);

  r = await call(`/api/habits/${offId}/toggle`, { method: 'POST', ...json({}) });
  check('rest day rejects bodyless completion', r.status === 400, `${r.status}`);

  r = await call(`/api/habits/${offId}/toggle`, { method: 'POST', ...json({ done: false }) });
  check('rest day allows unmarking', r.status === 200 && r.body.doneToday === false, `${r.status}`);

  r = await call('/api/habits');
  check(
    'rejected rest-day completion wrote nothing',
    r.body.habits.find((habit) => habit.id === offId).doneToday === false,
  );

  for (const bad of [[], [7], [-1], [1.5], ['Mon'], 'daily', null]) {
    r = await call('/api/habits', { method: 'POST', ...json({ name: 'Bad days', days: bad }) });
    check(`days ${JSON.stringify(bad)} rejected`, r.status === 400, `${r.status} ${JSON.stringify(r.body)}`);
  }

  await call(`/api/habits/${scheduledId}`, { method: 'DELETE' });
  await call(`/api/habits/${offId}`, { method: 'DELETE' });

  console.log('\ntoggle');
  r = await call(`/api/habits/${id}/toggle`, { method: 'POST', ...json({ done: true }) });
  check('mark done', r.status === 200 && r.body.doneToday === true);
  check('streak is 1', r.body.streak === 1, String(r.body.streak));

  r = await call(`/api/habits/${id}/toggle`, { method: 'POST', ...json({ done: true }) });
  check('idempotent done', r.body.doneToday === true && r.body.streak === 1);

  r = await call('/api/habits');
  check('persisted in list', r.body.habits.length === 1 && r.body.habits[0].doneToday === true);

  const raw = JSON.parse(await fs.readFile(dataFile, 'utf8'));
  check(
    'one completion stored',
    raw.profiles[0].habits[0].completions.length === 1,
    JSON.stringify(raw.profiles[0].habits[0].completions),
  );

  r = await call(`/api/habits/${id}/toggle`, { method: 'POST', ...json({ done: false }) });
  check('mark undone', r.body.doneToday === false && r.body.streak === 0);

  r = await call(`/api/habits/${id}/toggle`, { method: 'POST', ...json({}) });
  check('bodyless toggle flips to done', r.body.doneToday === true);
  r = await call(`/api/habits/${id}/toggle`, { method: 'POST', ...json({}) });
  check('bodyless toggle flips back', r.body.doneToday === false);

  console.log('\nedit');
  r = await call(`/api/habits/${id}`, { method: 'PATCH', ...json({ name: 'Read 20 pages' }) });
  check('rename works', r.status === 200 && r.body.name === 'Read 20 pages', `${r.status} ${JSON.stringify(r.body)}`);
  check('rename preserves other fields', r.body.difficulty === 5 && r.body.days.length === 7);

  r = await call(`/api/habits/${id}`, { method: 'PATCH', ...json({ difficulty: 9 }) });
  check('difficulty edit works', r.status === 200 && r.body.difficulty === 9);
  check('difficulty edit preserves name', r.body.name === 'Read 20 pages');

  r = await call(`/api/habits/${id}`, { method: 'PATCH', ...json({ days: [todayDow] }) });
  check(
    'schedule edit works',
    r.status === 200 && JSON.stringify(r.body.days) === JSON.stringify([todayDow]) && r.body.dueToday === true,
    JSON.stringify(r.body),
  );

  r = await call(`/api/habits/${id}`, { method: 'PATCH', ...json({ days: [otherDow] }) });
  check('schedule edit can make today a rest day', r.status === 200 && r.body.dueToday === false);

  r = await call(`/api/habits/${id}/toggle`, { method: 'POST', ...json({ done: true }) });
  check('edited rest day still rejects completion', r.status === 400, `${r.status}`);

  r = await call(`/api/habits/${id}`, { method: 'PATCH', ...json({ days: [todayDow, otherDow] }) });
  check('schedule edit can restore today', r.status === 200 && r.body.dueToday === true);

  r = await call(`/api/habits/${id}`, { method: 'PATCH', ...json({}) });
  check('empty edit rejected', r.status === 400);

  for (const payload of [
    { name: '  ' },
    { name: 'x'.repeat(61) },
    { difficulty: 0 },
    { difficulty: 11 },
    { difficulty: 1.5 },
    { days: [] },
    { days: [9] },
  ]) {
    r = await call(`/api/habits/${id}`, { method: 'PATCH', ...json(payload) });
    check(`edit ${JSON.stringify(payload)} rejected`, r.status === 400, `${r.status} ${JSON.stringify(r.body)}`);
  }

  r = await call('/api/habits/not-real', { method: 'PATCH', ...json({ name: 'x' }) });
  check('edit unknown habit is 404', r.status === 404);

  r = await call('/api/habits', { method: 'PATCH', ...json({ name: 'x' }) });
  check('PATCH on collection is 405', r.status === 405);

  const edited = JSON.parse(await fs.readFile(dataFile, 'utf8')).profiles[0].habits.find(
    (habit) => habit.id === id,
  );
  check(
    'edits persisted to disk',
    edited.name === 'Read 20 pages' &&
      edited.difficulty === 9 &&
      JSON.stringify(edited.days) === JSON.stringify([todayDow, otherDow]),
    JSON.stringify(edited),
  );

  console.log('\ntheme wiring');
  const html = await fs.readFile(path.join(root, 'public/index.html'), 'utf8');
  const css = await fs.readFile(path.join(root, 'public/styles.css'), 'utf8');
  const js = await fs.readFile(path.join(root, 'public/app.js'), 'utf8');

  check(
    'profile theme pickers live on the settings page',
    html.includes('id="profile-list"') &&
      html.indexOf('id="page-settings"') < html.indexOf('id="profile-list"') &&
      js.includes('function themePicker'),
  );
  check('default theme is ember', html.includes('data-theme="ember"'));
  check(
    'themes are applied per profile section and dashboard card',
    js.includes('section.dataset.theme = profile.theme') &&
      js.includes('card.dataset.theme = profile.theme') &&
      js.includes('setProfileTheme'),
  );

  console.log('\nprofile tabs');
  check(
    'habits page has a tab list above the checklist',
    html.includes('id="profile-tabs"') &&
      html.includes('role="tablist"') &&
      html.indexOf('id="page-habits"') < html.indexOf('id="profile-tabs"') &&
      html.indexOf('id="profile-tabs"') < html.indexOf('id="profile-sections"'),
  );
  check(
    'tabs are built per profile with tab semantics',
    js.includes('function renderProfileTabs') &&
      js.includes("tab.setAttribute('role', 'tab')") &&
      js.includes("tab.setAttribute('aria-selected'") &&
      js.includes('tab.dataset.theme = profile.theme'),
  );
  check(
    'only the selected profile section is rendered',
    js.includes('function visibleProfile') &&
      js.includes('const current = visibleProfile()') &&
      js.includes('current ? [profileSection(current)] : []'),
  );
  check(
    'switching tabs activates the profile for reloads',
    js.includes('function selectProfileTab') &&
      js.includes('`/api/profiles/${id}/activate`') &&
      js.includes("method: 'POST'"),
  );
  check(
    'tab bar supports keyboard navigation',
    js.includes('function onTabKeydown') &&
      ['ArrowLeft', 'ArrowRight', 'Home', 'End'].every((key) => js.includes(key)),
  );

  const cssThemes = [...css.matchAll(/\[data-theme="([a-z]+)"\]/g)].map((match) => match[1]);
  const jsThemes = [...js.matchAll(/\{ id: '([a-z]+)', name: '/g)].map((match) => match[1]);

  check(
    'theme ids match between CSS and JS',
    cssThemes.length > 0 && JSON.stringify(cssThemes) === JSON.stringify(jsThemes),
    `${cssThemes} vs ${jsThemes}`,
  );

  const serverSource = await fs.readFile(path.join(root, 'server.js'), 'utf8');
  const themeBlock = serverSource.match(/const THEME_IDS = \[([^\]]*)\]/)?.[1] || '';
  const serverThemes = [...themeBlock.matchAll(/'([a-z]+)'/g)].map((match) => match[1]);
  check(
    'theme ids match the server allowlist',
    JSON.stringify(cssThemes) === JSON.stringify(serverThemes),
    `${cssThemes} vs ${serverThemes}`,
  );
  check(
    'palette includes blue and green shades',
    ['blue', 'teal', 'green', 'lime'].every((id) => cssThemes.includes(id)),
    cssThemes.join(', '),
  );

  for (const id of cssThemes) {
    const block =
      css.match(new RegExp(`\\[data-theme="${id}"\\]\\s*\\{([^}]*)\\}`))?.[1] || '';
    const required = [
      '--accent:',
      '--accent-bright:',
      '--accent-rgb:',
      '--accent-bright-rgb:',
      '--on-accent:',
    ];
    check(`theme ${id} defines every accent variable`, required.every((v) => block.includes(v)));
  }

  check('accent colours are variable-driven', !/rgba\(255,\s*122,\s*47/.test(css) && !css.includes('--ember'));

  console.log('\nappearance toggle');
  check(
    'appearance toggle sits in the header with an accessible state',
    html.includes('id="appearance-toggle"') &&
      html.includes('aria-pressed="false"') &&
      html.includes('appearance-sun') &&
      html.includes('appearance-moon') &&
      html.includes('id="appearance-label"') &&
      html.indexOf('id="appearance-toggle"') < html.indexOf('id="page-habits"'),
  );
  check(
    'appearance is applied to the document root',
    /<html[^>]*data-appearance="dark"/.test(html) &&
      js.includes('document.documentElement.dataset.appearance = appearance'),
  );
  check(
    'appearance preference is persisted and bootstrapped before paint',
    js.includes("APPEARANCE_KEY = 'grindwell.appearance'") &&
      js.includes('localStorage.setItem(APPEARANCE_KEY') &&
      html.includes("localStorage.getItem('grindwell.appearance')") &&
      html.includes('matchMedia'),
  );
  check(
    'appearance toggle is wired and updates the meta theme colour',
    js.includes('function applyAppearance') &&
      js.includes("els.appearanceToggle.addEventListener('click'") &&
      js.includes('APPEARANCE_COLORS') &&
      js.includes('querySelector(\'meta[name="theme-color"]\')'),
  );
  check(
    'light mode flips neutral surfaces but keeps profile accents',
    /\[data-appearance="light"\]\s*\{[^}]*color-scheme:\s*light/.test(css) &&
      /\[data-appearance="light"\]\s*\{[^}]*--bg:/.test(css) &&
      /\[data-appearance="light"\]\s*\{[^}]*--text:/.test(css) &&
      !/\[data-appearance="light"\]\s*\{[^}]*--accent:/.test(css),
  );
  check(
    'theme blocks expose light-safe accent text',
    css.includes('--accent-text: var(--accent-bright)') &&
      css.includes('--accent-deep:') &&
      css.includes('[data-appearance="light"] [data-theme]') &&
      css.includes('--accent-text: var(--accent-deep)'),
  );
  check(
    'light mode does not rely on hardcoded white overlays',
    !/rgba\(255,\s*255,\s*255/.test(css) && css.includes('rgba(var(--tint-rgb)'),
  );

  const usedVars = new Set([...css.matchAll(/var\((--[a-z-]+)/g)].map((match) => match[1]));
  const definedVars = new Set([...css.matchAll(/(--[a-z-]+)\s*:/g)].map((match) => match[1]));
  const missingVars = [...usedVars].filter((name) => !definedVars.has(name));
  check('every CSS variable used is defined', missingVars.length === 0, missingVars.join(', '));

  console.log('\ncompact habit input');
  const parseCase = (raw) => {
    try {
      return { value: parseHabitInput(raw) };
    } catch (error) {
      return { error: error.message };
    }
  };

  let parsed = parseCase('habit 1 ; 10 ; tu,th');
  check(
    'name and difficulty parsed from semicolons',
    parsed.value?.name === 'habit 1' && parsed.value?.difficulty === 10,
    JSON.stringify(parsed),
  );
  check(
    'listed days become rest days',
    JSON.stringify(parsed.value?.days) === JSON.stringify([0, 1, 3, 5, 6]),
    JSON.stringify(parsed.value?.days),
  );

  parsed = parseCase('Read 10 pages');
  check('difficulty defaults to 5', parsed.value?.difficulty === 5);
  check(
    'schedule defaults to all days',
    JSON.stringify(parsed.value?.days) === JSON.stringify([0, 1, 2, 3, 4, 5, 6]),
  );

  parsed = parseCase('Read 10 pages ; 4');
  check(
    'difficulty without days keeps every day',
    parsed.value?.difficulty === 4 && parsed.value?.days.length === 7,
  );

  parsed = parseCase('Read 10 pages ;  ; sat,sun');
  check(
    'blank difficulty falls back to 5',
    parsed.value?.difficulty === 5 && !parsed.value?.days.includes(0) && !parsed.value?.days.includes(6),
  );

  parsed = parseCase('Read 10 pages ; sat sun');
  check(
    'non-numeric middle part is read as days',
    parsed.value?.difficulty === 5 && JSON.stringify(parsed.value?.days) === JSON.stringify([1, 2, 3, 4, 5]),
  );

  parsed = parseCase('  Read   10   pages  ;  7  ;  MON, tues  ');
  check(
    'names and day tokens are normalised',
    parsed.value?.name === 'Read 10 pages' &&
      parsed.value?.difficulty === 7 &&
      JSON.stringify(parsed.value?.days) === JSON.stringify([0, 3, 4, 5, 6]),
    JSON.stringify(parsed.value),
  );

  for (const [label, raw] of [
    ['empty input', '   '],
    ['missing name', '; 5 ; mon'],
    ['difficulty 0', 'x ; 0'],
    ['difficulty 11', 'x ; 11'],
    ['unknown day', 'x ; 9 ; funday'],
    ['all days skipped', 'x ; 5 ; mon,tue,wed,thu,fri,sat,sun'],
    ['too many semicolons', 'x ; 5 ; mon ; extra'],
    ['days before difficulty', 'x ; mon ; 5'],
    ['long name', `${'x'.repeat(61)} ; 5`],
  ]) {
    parsed = parseCase(raw);
    check(`rejects ${label}`, Boolean(parsed.error), JSON.stringify(parsed));
  }

  console.log('\ninline editing');
  check('edit dialog removed from markup', !html.includes('<dialog') && !html.includes('edit-dialog'));
  check(
    'inline editor styles present',
    css.includes('.habit.is-editing') && css.includes('.habit-edit {') && css.includes('.habit-edit-actions'),
  );
  check(
    'editor is rendered inside the habit card',
    js.includes('function editFormNode') &&
      js.includes("li.classList.add('is-editing')") &&
      js.includes('habit-edit-actions'),
  );
  check(
    'no modal edit APIs left',
    !js.includes('showModal(') && !js.includes('editDialog') && !js.includes('sheet'),
  );

  console.log('\nadd form');
  check(
    'difficulty and schedule controls removed from add form',
    !html.includes('id="difficulty-input"') &&
      !html.includes('id="difficulty-value"') &&
      !html.includes('id="days-picker"'),
  );
  check(
    'add form hint tooltip removed',
    !html.includes('id="add-hint"') &&
      !html.includes('Optional:') &&
      !css.includes('.add-hint'),
  );
  check(
    'parser is loaded before the app',
    html.includes('/habit-input.js') &&
      html.indexOf('/habit-input.js') < html.indexOf('/app.js'),
  );
  check(
    'app uses the shared parser',
    js.includes('window.HabitInput.parseHabitInput') && js.includes('parseHabitInput(raw)'),
  );

  console.log('\nreset button');
  check(
    'reset is rendered for each profile',
    js.includes('reset.className = \'reset profile-reset\'') &&
      js.includes('resetHabits(profile)') &&
      js.includes('Reset all habits and ether for ${profile.name}'),
  );
  check(
    'reset is enabled while ether remains without habits',
    js.includes('reset.disabled = profile.habits.length === 0 && profile.ether === 0') &&
      js.includes('const hasEther = profile.ether > 0'),
  );
  check(
    'reset wipes the selected profile through the collection endpoint',
    js.includes('async function resetHabits(profile)') &&
      js.includes('`/api/habits${profileQuery(profile)}`') &&
      js.includes("method: 'DELETE'"),
  );

  console.log('\nstatic files + safety');
  r = await call('/');
  check('index served', r.status === 200 && String(r.body).includes('grindwell'));
  check('html content type', String(r.headers.get('content-type')).startsWith('text/html'));

  for (const asset of ['/styles.css', '/app.js', '/habit-input.js']) {
    r = await call(asset);
    check(`${asset} served`, r.status === 200);
  }

  for (const route of ['/dashboard', '/settings', '/dashboard/']) {
    r = await call(route);
    check(
      `${route} serves the app`,
      r.status === 200 && String(r.body).includes('id="page-dashboard"'),
      String(r.status),
    );
    check(
      `${route} is html`,
      String(r.headers.get('content-type')).startsWith('text/html'),
    );
  }

  r = await call('/nope.html');
  check('missing file is 404', r.status === 404);

  r = await call('/%2e%2e/server.js');
  check('traversal via dot segment blocked', [400, 404].includes(r.status) && !String(r.body).includes('grindwell listening'), `${r.status}`);

  r = await call('/%2e%2e%2fserver.js');
  check('traversal via encoded slash blocked', [400, 404].includes(r.status) && !String(r.body).includes('grindwell listening'), `${r.status}`);

  r = await call('/..%2fserver.js');
  check('traversal via encoded slash (2) blocked', [400, 404].includes(r.status) && !String(r.body).includes('grindwell listening'), `${r.status}`);

  console.log('\nprofiles');
  r = await call('/api/profiles');
  check(
    'profiles listed with an active one',
    r.status === 200 &&
      r.body.profiles.length === 1 &&
      r.body.profiles[0].name === 'Mine' &&
      r.body.profiles[0].theme === 'ember' &&
      r.body.profiles[0].habitCount === 1 &&
      r.body.activeProfileId === r.body.profiles[0].id,
    JSON.stringify(r.body),
  );
  const mineId = r.body.activeProfileId;

  r = await call('/api/profiles', { method: 'POST', ...json({ name: '  Alex  ', theme: 'blue' }) });
  check(
    'create profile trims the name and keeps the theme',
    r.status === 201 && r.body.name === 'Alex' && r.body.theme === 'blue',
    `${r.status} ${JSON.stringify(r.body)}`,
  );
  const alexId = r.body.id;

  r = await call('/api/profiles');
  check(
    'new profile becomes active',
    r.body.profiles.length === 2 && r.body.activeProfileId === alexId,
    JSON.stringify(r.body),
  );

  r = await call('/api/habits');
  check(
    'new profile starts with no habits',
    r.body.profile.id === alexId && r.body.habits.length === 0,
    JSON.stringify(r.body.habits),
  );

  r = await call('/api/habits', { method: 'POST', ...json({ name: 'Alex habit' }) });
  check('habit created inside the active profile', r.status === 201);
  const alexHabitId = r.body.id;

  r = await call(`/api/profiles/${mineId}/activate`, { method: 'POST', ...json({}) });
  check('activate returns the profile', r.status === 200 && r.body.id === mineId);

  r = await call('/api/habits');
  check(
    'habits are isolated per profile',
    r.body.profile.id === mineId &&
      r.body.habits.length === 1 &&
      r.body.habits[0].id === id &&
      !r.body.habits.some((habit) => habit.id === alexHabitId),
    JSON.stringify(r.body.habits),
  );

  r = await call(`/api/habits/${alexHabitId}`, { method: 'DELETE' });
  check('another profile habit is not reachable while inactive', r.status === 404);

  r = await call(`/api/profiles/${alexId}`, { method: 'PATCH', ...json({ theme: 'rose' }) });
  check('profile theme updated', r.status === 200 && r.body.theme === 'rose');

  r = await call(`/api/profiles/${alexId}`, { method: 'PATCH', ...json({ name: 'Alex B' }) });
  check('profile renamed', r.status === 200 && r.body.name === 'Alex B');

  for (const payload of [{}, { theme: 'neon' }, { name: '   ' }, { name: 'x'.repeat(61) }]) {
    r = await call(`/api/profiles/${alexId}`, { method: 'PATCH', ...json(payload) });
    check(`profile edit ${JSON.stringify(payload)} rejected`, r.status === 400, String(r.status));
  }

  const profileRaw = JSON.parse(await fs.readFile(dataFile, 'utf8'));
  const alexOnDisk = profileRaw.profiles.find((profile) => profile.id === alexId);
  check(
    'profile name, theme, and habits persisted',
    alexOnDisk.name === 'Alex B' &&
      alexOnDisk.theme === 'rose' &&
      alexOnDisk.habits.length === 1 &&
      alexOnDisk.habits[0].id === alexHabitId &&
      profileRaw.activeProfileId === mineId,
    JSON.stringify(alexOnDisk),
  );

  r = await call(`/api/profiles/${alexId}/activate`, { method: 'POST', ...json({}) });
  check('switch back to the second profile', r.status === 200 && r.body.id === alexId);
  r = await call('/api/habits');
  check('second profile kept its own habit', r.body.habits.length === 1 && r.body.habits[0].id === alexHabitId);

  r = await call(`/api/profiles/${alexId}`, { method: 'DELETE' });
  check('delete profile returns 204', r.status === 204);
  r = await call('/api/profiles');
  check(
    'deleting the active profile falls back to the first one',
    r.body.profiles.length === 1 && r.body.activeProfileId === mineId,
    JSON.stringify(r.body),
  );

  r = await call(`/api/profiles/${mineId}`, { method: 'DELETE' });
  check('last profile cannot be deleted', r.status === 400, String(r.status));
  r = await call('/api/profiles/not-real/activate', { method: 'POST', ...json({}) });
  check('activate unknown profile is 404', r.status === 404);
  r = await call('/api/profiles/not-real', { method: 'PATCH', ...json({ name: 'x' }) });
  check('edit unknown profile is 404', r.status === 404);
  r = await call('/api/profiles/not-real', { method: 'DELETE' });
  check('delete unknown profile is 404', r.status === 404);
  r = await call('/api/profiles', { method: 'DELETE' });
  check('unsupported profiles method is 405', r.status === 405);

  r = await call('/api/habits');
  check(
    'habit list reports the profile summaries',
    r.body.profiles.length === 1 && r.body.profile.id === mineId,
  );

  console.log('\nshared overview + scoped habits');
  r = await call('/api/overview');
  check(
    'overview lists every profile with habits and a summary',
    r.status === 200 &&
      r.body.profiles.length === 1 &&
      r.body.profiles[0].id === mineId &&
      Array.isArray(r.body.profiles[0].habits) &&
      r.body.profiles[0].habits.length === 1 &&
      Array.isArray(r.body.profiles[0].summary.days) &&
      r.body.profiles[0].summary.days.length === 30 &&
      typeof r.body.profiles[0].summary.last7 === 'number' &&
      typeof r.body.profiles[0].summary.last30 === 'number' &&
      r.body.settings.etherFactor === 1,
    JSON.stringify(r.body),
  );
  check(
    'overview reports the active profile for the initial tab',
    r.body.activeProfileId === mineId,
    JSON.stringify(r.body.activeProfileId),
  );
  r = await call('/api/overview', { method: 'POST' });
  check('unsupported overview method is 405', r.status === 405);

  r = await call('/api/profiles', { method: 'POST', ...json({ name: 'Shared A', theme: 'teal' }) });
  const sharedA = r.body.id;
  r = await call('/api/profiles', { method: 'POST', ...json({ name: 'Shared B', theme: 'violet' }) });
  const sharedB = r.body.id;

  r = await call(`/api/habits?profile=${sharedA}`, {
    method: 'POST',
    ...json({ name: 'Shared A habit', difficulty: 2 }),
  });
  check('habit added to an explicit profile', r.status === 201, `${r.status}`);
  const sharedHabitA = r.body.id;

  r = await call(`/api/habits?profile=${sharedB}`);
  check(
    'scoped habit list is isolated',
    r.status === 200 && r.body.profile.id === sharedB && r.body.habits.length === 0,
    JSON.stringify(r.body),
  );

  r = await call('/api/overview');
  const overviewA = r.body.profiles.find((profile) => profile.id === sharedA);
  const overviewB = r.body.profiles.find((profile) => profile.id === sharedB);
  check(
    'overview carries each profile theme and habit',
    r.status === 200 &&
      overviewA.theme === 'teal' &&
      overviewA.habits.some((habit) => habit.id === sharedHabitA) &&
      overviewB.theme === 'violet' &&
      overviewB.habits.length === 0,
    JSON.stringify({ overviewA, overviewB }),
  );

  r = await call(`/api/habits/${sharedHabitA}/toggle?profile=${sharedA}`, {
    method: 'POST',
    ...json({ done: true }),
  });
  check('scoped toggle awards ether', r.status === 200 && r.body.earnedToday === 2, `${r.status}`);

  r = await call('/api/overview');
  const earnedA = r.body.profiles.find((profile) => profile.id === sharedA);
  const earnedB = r.body.profiles.find((profile) => profile.id === sharedB);
  check(
    'overview keeps ether separate per profile',
    earnedA.summary.today === 2 && earnedA.ether === 2 && earnedB.summary.today === 0 && earnedB.ether === 0,
    JSON.stringify({ a: earnedA.summary, b: earnedB.summary }),
  );

  r = await call(`/api/habits/${sharedHabitA}?profile=${sharedB}`, { method: 'DELETE' });
  check('habit routes are scoped to the requested profile', r.status === 404, String(r.status));

  r = await call('/api/habits?profile=not-real');
  check('unknown profile query is 404', r.status === 404, String(r.status));

  r = await call(`/api/habits/${sharedHabitA}?profile=${sharedA}`, { method: 'DELETE' });
  check('scoped delete removes the habit', r.status === 204, String(r.status));
  r = await call(`/api/profiles/${sharedB}`, { method: 'DELETE' });
  check('cleanup shared profile B', r.status === 204, String(r.status));
  r = await call(`/api/profiles/${sharedA}`, { method: 'DELETE' });
  check('cleanup shared profile A', r.status === 204, String(r.status));

  console.log('\nprofile wiring');
  check(
    'profile management lives on the settings page',
    html.includes('id="profile-list"') &&
      html.includes('id="profile-add"') &&
      html.indexOf('id="page-settings"') < html.indexOf('id="profile-add"'),
  );
  check(
    'app renders and manages profiles',
    ['renderProfileSettings', 'createProfile', 'renameProfile', 'deleteProfile', 'setProfileTheme'].every(
      (name) => js.includes(`function ${name}`),
    ) && js.includes('/api/profiles'),
  );

  console.log('\nsettings + ether');
  r = await call('/api/settings');
  check(
    'settings expose the global ether factor',
    r.status === 200 && r.body.etherFactor === 1,
    JSON.stringify(r.body),
  );

  r = await call('/api/habits');
  check(
    'habit list includes the ether dashboard',
    r.status === 200 &&
      r.body.ether &&
      r.body.ether.factor === 1 &&
      Array.isArray(r.body.ether.days) &&
      r.body.ether.days.length === 30 &&
      r.body.ether.days[29].date === TODAY &&
      typeof r.body.ether.last7 === 'number' &&
      typeof r.body.ether.last30 === 'number',
    JSON.stringify(r.body.ether),
  );
  const baselineTotal = r.body.ether.total;
  const baselineCompletions = r.body.ether.completedToday;
  check('dashboard starts from the current balance', baselineTotal >= 0, String(baselineTotal));
  check(
    'summary exposes completion counts',
    typeof baselineCompletions === 'number' &&
      typeof r.body.ether.completedLast7 === 'number' &&
      typeof r.body.ether.completedLast30 === 'number' &&
      typeof r.body.ether.days[29].completed === 'number',
    JSON.stringify({
      today: baselineCompletions,
      last7: r.body.ether.completedLast7,
      last30: r.body.ether.completedLast30,
    }),
  );

  r = await call('/api/habits', { method: 'POST', ...json({ name: 'Ether four', difficulty: 4 }) });
  const fourId = r.body.id;
  check(
    'reward equals difficulty at factor 1',
    r.body.reward === 4 && r.body.earnedToday === 0,
    JSON.stringify({ reward: r.body.reward, earnedToday: r.body.earnedToday }),
  );

  r = await call(`/api/habits/${fourId}/toggle`, { method: 'POST', ...json({ done: true }) });
  check('completing a habit awards ether', r.body.earnedToday === 4, String(r.body.earnedToday));

  r = await call('/api/habits');
  check(
    'summary counts today completions per day',
    r.body.ether.completedToday === baselineCompletions + 1 &&
      r.body.ether.days[29].completed === baselineCompletions + 1 &&
      r.body.ether.completedLast7 >= 1 &&
      r.body.ether.completedLast30 >= 1,
    JSON.stringify({
      today: r.body.ether.completedToday,
      day: r.body.ether.days[29],
      last7: r.body.ether.completedLast7,
      last30: r.body.ether.completedLast30,
    }),
  );

  r = await call('/api/habits');
  check(
    'dashboard total grows by the reward',
    r.body.ether.total === baselineTotal + 4,
    `${r.body.ether.total} vs ${baselineTotal + 4}`,
  );
  check(
    'dashboard today bucket grows by the reward',
    r.body.ether.today === 4,
    String(r.body.ether.today),
  );

  r = await call(`/api/habits/${fourId}/toggle`, { method: 'POST', ...json({ done: false }) });
  check('unchecking clears the day earning', r.body.earnedToday === 0);
  r = await call('/api/habits');
  check('dashboard total drops after unchecking', r.body.ether.total === baselineTotal);
  check(
    'unchecking removes the completion count',
    r.body.ether.completedToday === baselineCompletions,
    `${r.body.ether.completedToday} vs ${baselineCompletions}`,
  );

  r = await call('/api/habits', { method: 'POST', ...json({ name: 'Locked reward', difficulty: 5 }) });
  const lockId = r.body.id;
  r = await call(`/api/habits/${lockId}/toggle`, { method: 'POST', ...json({ done: true }) });
  check('earning is stored at completion', r.body.earnedToday === 5, String(r.body.earnedToday));

  r = await call(`/api/habits/${lockId}`, { method: 'PATCH', ...json({ difficulty: 10 }) });
  check(
    'difficulty edits do not rewrite earned ether',
    r.status === 200 && r.body.earnedToday === 5,
    JSON.stringify({ status: r.status, earnedToday: r.body.earnedToday }),
  );

  r = await call('/api/settings', { method: 'PATCH', ...json({ etherFactor: 0.5 }) });
  check('ether factor updated', r.status === 200 && r.body.etherFactor === 0.5);

  r = await call('/api/habits');
  check(
    'reward scales with the factor',
    r.body.habits.find((habit) => habit.id === fourId).reward === 2,
    JSON.stringify(r.body.habits.find((habit) => habit.id === fourId)),
  );
  check(
    'factor changes do not rewrite past ether',
    r.body.habits.find((habit) => habit.id === lockId).earnedToday === 5,
    String(r.body.habits.find((habit) => habit.id === lockId).earnedToday),
  );

  await call('/api/settings', { method: 'PATCH', ...json({ etherFactor: 0.1 }) });
  r = await call('/api/habits', { method: 'POST', ...json({ name: 'Minimum ether', difficulty: 1 }) });
  const minId = r.body.id;
  check('reward has a floor of one ether', r.body.reward === 1, String(r.body.reward));

  r = await call(`/api/habits/${minId}/toggle`, { method: 'POST', ...json({ done: true }) });
  check('minimum completion awards one ether', r.body.earnedToday === 1, String(r.body.earnedToday));

  r = await call('/api/habits');
  check(
    'large difficulty still floors at one',
    r.body.habits.find((habit) => habit.id === fourId).reward === 1,
    String(r.body.habits.find((habit) => habit.id === fourId).reward),
  );

  await call('/api/settings', { method: 'PATCH', ...json({ etherFactor: 1 }) });
  r = await call('/api/habits');
  check(
    'earned ether survives factor changes',
    r.body.habits.find((habit) => habit.id === minId).earnedToday === 1,
  );
  check(
    'future rewards use the restored factor',
    r.body.habits.find((habit) => habit.id === fourId).reward === 4,
  );

  for (const payload of [{}, { etherFactor: 0 }, { etherFactor: 11 }, { etherFactor: 'abc' }]) {
    r = await call('/api/settings', { method: 'PATCH', ...json(payload) });
    check(`settings ${JSON.stringify(payload)} rejected`, r.status === 400, String(r.status));
  }
  r = await call('/api/settings', { method: 'DELETE' });
  check('unsupported settings method is 405', r.status === 405);

  console.log('\nsounds');
  r = await call('/api/settings');
  check(
    'settings expose sound defaults',
    r.status === 200 &&
      r.body.sounds &&
      r.body.sounds.habit === 'chime' &&
      r.body.sounds.purchase === 'pop' &&
      Array.isArray(r.body.sounds.custom) &&
      r.body.sounds.custom.length === 0,
    JSON.stringify(r.body.sounds),
  );

  r = await call('/api/settings', { method: 'PATCH', ...json({ sounds: { habit: 'bell' } }) });
  check(
    'habit sound can be changed',
    r.status === 200 && r.body.sounds.habit === 'bell' && r.body.sounds.purchase === 'pop',
    JSON.stringify(r.body.sounds),
  );

  r = await call('/api/settings', { method: 'PATCH', ...json({ sounds: { habit: 'nope' } }) });
  check('unknown sound is rejected', r.status === 400, String(r.status));

  r = await call('/api/settings/sounds', {
    method: 'POST',
    ...json({ name: 'Doorbell', url: 'https://example.com/doorbell.mp3' }),
  });
  const customSoundId = r.body.sound && r.body.sound.id;
  check(
    'custom sound can be added',
    r.status === 201 &&
      typeof customSoundId === 'string' &&
      r.body.sounds.custom.length === 1 &&
      r.body.sounds.custom[0].name === 'Doorbell',
    JSON.stringify(r.body),
  );

  r = await call('/api/settings', {
    method: 'PATCH',
    ...json({ sounds: { purchase: customSoundId } }),
  });
  check(
    'custom sound can be selected',
    r.status === 200 && r.body.sounds.purchase === customSoundId,
    JSON.stringify(r.body.sounds),
  );

  r = await call('/api/settings/sounds', {
    method: 'POST',
    ...json({ name: 'Bad sound', url: 'ftp://example.com/bad.mp3' }),
  });
  check('custom sound URL must be http(s)', r.status === 400, String(r.status));

  r = await call(`/api/settings/sounds/${customSoundId}`, { method: 'DELETE' });
  check(
    'removing a selected custom sound falls back to a built-in',
    r.status === 200 &&
      r.body.sounds.custom.length === 0 &&
      r.body.sounds.purchase === 'pop',
    JSON.stringify(r.body.sounds),
  );

  r = await call('/api/settings', {
    method: 'PATCH',
    ...json({ sounds: { habit: 'chime', purchase: 'pop' } }),
  });
  check('sounds restored to defaults', r.status === 200 && r.body.sounds.habit === 'chime');

  console.log('\nicons');
  r = await call('/api/settings');
  check(
    'settings expose icon defaults',
    r.status === 200 &&
      r.body.icon &&
      r.body.icon.id === 'flame' &&
      Array.isArray(r.body.icon.custom) &&
      r.body.icon.custom.length === 0,
    JSON.stringify(r.body.icon),
  );

  r = await call('/api/settings', { method: 'PATCH', ...json({ icon: { id: 'moon' } }) });
  check(
    'icon can be changed',
    r.status === 200 && r.body.icon.id === 'moon',
    JSON.stringify(r.body.icon),
  );

  r = await call('/api/settings', { method: 'PATCH', ...json({ icon: { id: 'nope' } }) });
  check('unknown icon is rejected', r.status === 400, String(r.status));

  r = await call('/api/settings/icons', {
    method: 'POST',
    ...json({ name: 'Avatar', url: 'https://example.com/avatar.png' }),
  });
  const customIconId = r.body.icon && r.body.icon.id;
  check(
    'custom icon can be added and selected',
    r.status === 201 &&
      typeof customIconId === 'string' &&
      r.body.settings.icon.id === customIconId &&
      r.body.settings.icon.custom.length === 1 &&
      r.body.settings.icon.custom[0].name === 'Avatar',
    JSON.stringify(r.body),
  );

  r = await call('/api/settings/icons', {
    method: 'POST',
    ...json({ name: 'Bad icon', url: 'ftp://example.com/bad.png' }),
  });
  check('custom icon URL must be http(s)', r.status === 400, String(r.status));

  r = await call(`/api/settings/icons/${customIconId}`, { method: 'DELETE' });
  check(
    'removing a selected custom icon falls back to the default',
    r.status === 200 && r.body.icon.custom.length === 0 && r.body.icon.id === 'flame',
    JSON.stringify(r.body.icon),
  );

  r = await call('/api/settings', { method: 'PATCH', ...json({ icon: { id: 'flame' } }) });
  check('icon restored to default', r.status === 200 && r.body.icon.id === 'flame');

  const etherDisk = JSON.parse(await fs.readFile(dataFile, 'utf8'));
  check('ether factor persisted to disk', etherDisk.settings.etherFactor === 1);
  check(
    'sound settings persisted to disk',
    etherDisk.settings.sounds &&
      etherDisk.settings.sounds.habit === 'chime' &&
      etherDisk.settings.sounds.purchase === 'pop',
    JSON.stringify(etherDisk.settings.sounds),
  );
  check(
    'icon settings persisted to disk',
    etherDisk.settings.icon &&
      etherDisk.settings.icon.id === 'flame' &&
      Array.isArray(etherDisk.settings.icon.custom),
    JSON.stringify(etherDisk.settings.icon),
  );
  const mineOnDisk = etherDisk.profiles.find((profile) => profile.id === mineId);
  check(
    'earnings persisted per completion date',
    mineOnDisk.habits.find((habit) => habit.id === lockId).earnings[TODAY] === 5,
    JSON.stringify(mineOnDisk.habits.find((habit) => habit.id === lockId).earnings),
  );

  r = await call('/api/profiles', { method: 'POST', ...json({ name: 'Ether two' }) });
  const secondEtherId = r.body.id;
  r = await call('/api/habits');
  check('a new profile starts with zero ether', r.body.ether.total === 0);

  r = await call('/api/habits', { method: 'POST', ...json({ name: 'Other reward', difficulty: 6 }) });
  const otherHabitId = r.body.id;
  r = await call(`/api/habits/${otherHabitId}/toggle`, { method: 'POST', ...json({ done: true }) });
  check('second profile earns its own ether', r.body.earnedToday === 6);

  r = await call('/api/habits');
  check(
    'second profile dashboard is independent',
    r.body.ether.total === 6 && r.body.profile.ether === 6,
    JSON.stringify({ ether: r.body.ether, profile: r.body.profile }),
  );

  await call(`/api/profiles/${mineId}/activate`, { method: 'POST', ...json({}) });
  r = await call('/api/habits');
  check(
    'first profile total is unchanged',
    r.body.ether.total === baselineTotal + 6,
    `${r.body.ether.total} vs ${baselineTotal + 6}`,
  );

  r = await call(`/api/profiles/${secondEtherId}`, { method: 'DELETE' });
  check('cleanup second ether profile', r.status === 204);

  await call(`/api/habits/${fourId}`, { method: 'DELETE' });
  await call(`/api/habits/${minId}`, { method: 'DELETE' });
  await call(`/api/habits/${lockId}`, { method: 'DELETE' });

  r = await call('/api/habits');
  check(
    'deleting habits keeps ether already earned',
    r.body.ether.total === baselineTotal + 6 && r.body.ether.today === 6,
    JSON.stringify({ total: r.body.ether.total, today: r.body.ether.today }),
  );
  const afterDeleteDisk = JSON.parse(await fs.readFile(dataFile, 'utf8'));
  const afterDeleteProfile = afterDeleteDisk.profiles.find((profile) => profile.id === mineId);
  check(
    'retired earnings persist on disk',
    afterDeleteProfile.retiredEarnings[TODAY] === 6,
    JSON.stringify(afterDeleteProfile.retiredEarnings),
  );

  console.log('\nether wiring');
  check(
    'shared dashboard and settings markup present',
    [
      'ether-total',
      'ether-today',
      'ether-range',
      'ether-range-label',
      'dashboard-range',
      'dashboard-list',
      'ether-form',
      'ether-factor',
    ].every((id) => html.includes(`id="${id}"`)),
  );
  check(
    'dashboard range dropdown offers weekly and monthly',
    html.includes('id="dashboard-range"') &&
      html.includes('value="week"') &&
      html.includes('value="month"'),
  );
  check(
    'app renders every profile on the dashboard and saves the factor',
    js.includes('function renderDashboard') &&
      js.includes('function etherChartNode') &&
      js.includes('profiles.map(dashboardCard)') &&
      js.includes("api('/api/settings'") &&
      js.includes("api('/api/overview'"),
  );
  check(
    'dashboard card headline shows lifetime ether earned',
    js.includes('function dashboardCard') &&
      js.includes('strong.textContent = String(summary.earned)') &&
      js.includes("suffix.textContent = 'ether earned'") &&
      !js.includes('strong.textContent = String(summary.total)'),
  );
  check(
    'dashboard range is wired to local state and storage',
    js.includes("DASHBOARD_RANGE_KEY = 'grindwell.dashboardRange'") &&
      js.includes('function storedDashboardRange') &&
      js.includes('function rangeDays') &&
      js.includes('function rangeEther') &&
      js.includes("els.dashboardRange.addEventListener('change'"),
  );
  check(
    'dashboard trends card tracks daily completions',
    html.includes('id="dashboard-trends"') &&
      js.includes('function completionDays') &&
      js.includes('function completionChart') &&
      js.includes('function trendsCard') &&
      js.includes('els.dashboardTrends.replaceChildren(trendsCard())') &&
      js.includes("day.completed / max"),
  );
  check(
    'trends card styles present',
    css.includes('.trends-card') && css.includes('.trends-chart'),
  );
  check(
    'difficulty renders as stars and the card reward chip is gone',
    js.includes('function starRating') &&
      js.includes('starRating(habit.difficulty)') &&
      !js.includes('chip-ether') &&
      !js.includes('`+${habit.reward} ether`'),
  );
  check(
    'star styles present',
    css.includes('.stars') &&
      css.includes('.star') &&
      css.includes('.star[data-fill="half"]') &&
      !css.includes('.chip-ether'),
  );
  check(
    'dashboard range styles present',
    css.includes('.range-control') && css.includes('.ether-chart.is-month'),
  );
  check('ether dashboard styles present', css.includes('.ether-card') && css.includes('.ether-chart'));
  const toggleSource = js.slice(
    js.indexOf('async function toggleHabit'),
    js.indexOf('async function deleteHabit'),
  );
  check(
    'completing a habit plays a short chime',
    js.includes('function playHabitSound') &&
      js.includes('function playChime') &&
      toggleSource.includes('ensureAudioContext()') &&
      toggleSource.includes('if (next) playHabitSound()'),
  );

  console.log('\nsound wiring');
  check(
    'settings page has sound controls',
    ['habit-sound', 'purchase-sound', 'sound-form', 'sound-name', 'sound-url', 'sound-list'].every(
      (id) => html.includes(`id="${id}"`),
    ) &&
      html.includes('data-preview="habit"') &&
      html.includes('data-preview="purchase"'),
  );
  check(
    'app renders and saves configurable sounds',
    ['SOUND_PRESETS', 'playSound', 'playAudioUrl', 'renderSounds', 'saveSoundChoice', 'addSound', 'deleteSound'].every(
      (name) => js.includes(name),
    ) &&
      js.includes("api('/api/settings/sounds'") &&
      js.includes("settings.sounds.purchase") &&
      js.includes("settings.sounds.habit"),
  );
  check(
    'sound styles present',
    css.includes('.sound-row') && css.includes('.sound-form') && css.includes('.sound-list'),
  );

  console.log('\napp icon wiring');
  check(
    'header icon opens an inline icon picker',
    [
      'app-icon',
      'app-icon-art',
      'icon-panel',
      'icon-panel-close',
      'icon-presets',
      'icon-form',
      'icon-name',
      'icon-url',
      'icon-custom-list',
    ].every((id) => html.includes(`id="${id}"`)) &&
      /<button[^>]*id="app-icon"[^>]*aria-expanded="false"[^>]*aria-controls="icon-panel"/.test(
        html,
      ) &&
      /<div[^>]*id="icon-panel"[^>]*hidden/.test(html) &&
      !html.includes('<dialog'),
  );
  check(
    'app renders and saves configurable icons',
    [
      'ICON_PRESETS',
      'renderAppIcon',
      'faviconHref',
      'renderIconPanel',
      'setIconPanelOpen',
      'selectIcon',
      'addIcon',
      'deleteIcon',
    ].every((name) => js.includes(name)) &&
      js.includes("api('/api/settings/icons'") &&
      js.includes('settings.icon.custom') &&
      js.includes('aria-expanded') &&
      js.includes('link[rel="icon"]'),
  );
  check(
    'icon picker styles present',
    css.includes('.icon-panel') &&
      css.includes('.icon-grid') &&
      css.includes('.icon-tile') &&
      css.includes('.icon-form') &&
      css.includes('.icon-list'),
  );

  const jsIcons = [
    ...js.matchAll(/\{\s*id: '([a-z]+)',\s*label: '[A-Za-z]+',\s*path:/g),
  ].map((match) => match[1]);
  const serverIconBlock = serverSource.match(/const ICON_IDS = \[([^\]]*)\]/)?.[1] || '';
  const serverIcons = [...serverIconBlock.matchAll(/'([a-z]+)'/g)].map((match) => match[1]);
  check(
    'icon ids match the server allowlist',
    JSON.stringify(jsIcons) === JSON.stringify(serverIcons),
    `${jsIcons} vs ${serverIcons}`,
  );

  console.log('\nshop');

  r = await call('/api/shop');
  check(
    'shop starts empty',
    r.status === 200 && Array.isArray(r.body.items) && r.body.items.length === 0,
    JSON.stringify(r.body),
  );
  r = await call('/api/shop', { method: 'POST' });
  check('unsupported shop method is 405', r.status === 405, String(r.status));

  const badItems = [
    { link: 'https://example.com', cost: 5 },
    { name: 'No link', cost: 5 },
    { name: 'Bad link', link: 'javascript:alert(1)', cost: 5 },
    { name: 'Bad cost', link: 'https://example.com', cost: 0 },
    { name: 'Fraction cost', link: 'https://example.com', cost: 2.5 },
    { name: 'Bad image', link: 'https://example.com', image: 'not-a-url', cost: 5 },
    {
      name: 'Bad contributor',
      link: 'https://example.com',
      cost: 5,
      excludedProfiles: ['not-a-profile'],
    },
  ];
  for (const payload of badItems) {
    r = await call('/api/shop/items', { method: 'POST', ...json(payload) });
    check(
      `shop item ${JSON.stringify(payload)} rejected`,
      r.status === 400,
      `${r.status} ${JSON.stringify(r.body)}`,
    );
  }

  r = await call('/api/profiles', { method: 'POST', ...json({ name: 'Shop A', theme: 'lime' }) });
  const shopA = r.body.id;
  r = await call('/api/habits', { method: 'POST', ...json({ name: 'Shop A earn', difficulty: 4 }) });
  const shopAHabit = r.body.id;
  await call(`/api/habits/${shopAHabit}/toggle`, { method: 'POST', ...json({ done: true }) });

  r = await call('/api/profiles', { method: 'POST', ...json({ name: 'Shop B', theme: 'teal' }) });
  const shopB = r.body.id;
  r = await call('/api/habits', { method: 'POST', ...json({ name: 'Shop B earn', difficulty: 8 }) });
  const shopBHabit = r.body.id;
  await call(`/api/habits/${shopBHabit}/toggle`, { method: 'POST', ...json({ done: true }) });

  r = await call('/api/overview');
  const shopOverviewA = r.body.profiles.find((profile) => profile.id === shopA);
  const shopOverviewB = r.body.profiles.find((profile) => profile.id === shopB);
  const shopOverviewMine = r.body.profiles.find((profile) => profile.id === mineId);
  check(
    'shop profiles have known balances',
    shopOverviewA.ether === 4 && shopOverviewB.ether === 8 && shopOverviewMine.ether === 6,
    JSON.stringify({
      a: shopOverviewA.ether,
      b: shopOverviewB.ether,
      mine: shopOverviewMine.ether,
    }),
  );

  r = await call('/api/shop/items', {
    method: 'POST',
    ...json({ name: 'Too dear', link: 'https://example.com/dear', cost: 1000 }),
  });
  const dearId = r.body.id;
  r = await call(`/api/shop/items/${dearId}/buy`, { method: 'POST' });
  check('purchase rejects insufficient ether', r.status === 400, `${r.status} ${JSON.stringify(r.body)}`);
  r = await call(`/api/shop/items/${dearId}`, { method: 'DELETE' });
  check('cleanup too-expensive item', r.status === 204, String(r.status));
  r = await call('/api/shop/items/not-real/buy', { method: 'POST' });
  check('buying an unknown shop item is 404', r.status === 404, String(r.status));

  r = await call('/api/shop/items', {
    method: 'POST',
    ...json({
      name: 'Shared reward',
      link: 'https://example.com/reward',
      cost: 6,
      image: 'https://example.com/reward.png',
    }),
  });
  const shopItemId = r.body.id;
  check(
    'shop item created with its fields',
    r.status === 201 &&
      r.body.name === 'Shared reward' &&
      r.body.link === 'https://example.com/reward' &&
      r.body.cost === 6 &&
      r.body.image === 'https://example.com/reward.png' &&
      r.body.consumable === false &&
      r.body.purchasedAt === null &&
      Array.isArray(r.body.excludedProfiles) &&
      r.body.excludedProfiles.length === 0,
    `${r.status} ${JSON.stringify(r.body)}`,
  );

  r = await call(`/api/shop/items/${shopItemId}`, {
    method: 'PATCH',
    ...json({ excludedProfiles: [mineId] }),
  });
  check(
    'shop item can exclude a profile',
    r.status === 200 &&
      r.body.excludedProfiles.length === 1 &&
      r.body.excludedProfiles[0] === mineId,
    JSON.stringify(r.body),
  );

  r = await call(`/api/shop/items/${shopItemId}`, {
    method: 'PATCH',
    ...json({ excludedProfiles: ['not-a-profile'] }),
  });
  check('shop item rejects unknown contributors', r.status === 400, String(r.status));

  r = await call('/api/overview');
  check(
    'overview carries the shop',
    r.status === 200 &&
      Array.isArray(r.body.shop.items) &&
      r.body.shop.items.some((item) => item.id === shopItemId),
    JSON.stringify(r.body.shop),
  );

  r = await call(`/api/shop/items/${shopItemId}/buy`, { method: 'POST' });
  const paidA = r.body.contributions?.find((entry) => entry.profileId === shopA)?.amount;
  const paidB = r.body.contributions?.find((entry) => entry.profileId === shopB)?.amount;
  check(
    'purchase deducts the cost proportionally',
    r.status === 200 && paidA === 2 && paidB === 4,
    `${r.status} ${JSON.stringify(r.body)}`,
  );
  check(
    'excluded profiles are not charged',
    !r.body.contributions?.some((entry) => entry.profileId === mineId),
    JSON.stringify(r.body.contributions),
  );

  r = await call('/api/overview');
  const afterBuyA = r.body.profiles.find((profile) => profile.id === shopA);
  const afterBuyB = r.body.profiles.find((profile) => profile.id === shopB);
  const afterBuyMine = r.body.profiles.find((profile) => profile.id === mineId);
  check(
    'purchases reduce each contributor balance',
    afterBuyA.ether === 2 &&
      afterBuyB.ether === 4 &&
      afterBuyMine.ether === 6 &&
      afterBuyA.earned === 4 &&
      afterBuyA.spent === 2 &&
      afterBuyA.summary.total === 2,
    JSON.stringify({ a: afterBuyA, b: afterBuyB, mine: afterBuyMine }),
  );

  const shopDisk = JSON.parse(await fs.readFile(dataFile, 'utf8'));
  const shopADisk = shopDisk.profiles.find((profile) => profile.id === shopA);
  const shopDiskItem = shopDisk.shop.items.find((item) => item.id === shopItemId);
  check(
    'spent ether and shop items persist to disk',
    shopADisk.spentEther === 2 &&
      shopDisk.shop.items.some((item) => item.id === shopItemId) &&
      shopDisk.shop.items[0].excludedProfiles[0] === mineId &&
      shopDiskItem.consumable === false &&
      typeof shopDiskItem.purchasedAt === 'string',
    JSON.stringify({ spentEther: shopADisk.spentEther, shop: shopDisk.shop }),
  );

  r = await call('/api/shop/items', {
    method: 'POST',
    ...json({ name: 'One-time reward', link: 'https://example.com/once', cost: 1 }),
  });
  const oneTimeId = r.body.id;
  check(
    'shop items are one-time by default',
    r.status === 201 && r.body.consumable === false && r.body.purchasedAt === null,
    `${r.status} ${JSON.stringify(r.body)}`,
  );

  r = await call(`/api/shop/items/${oneTimeId}/buy`, { method: 'POST' });
  check(
    'one-time item can be bought once',
    r.status === 200 && typeof r.body.item.purchasedAt === 'string',
    `${r.status} ${JSON.stringify(r.body)}`,
  );
  r = await call(`/api/shop/items/${oneTimeId}/buy`, { method: 'POST' });
  check(
    'bought one-time item cannot be bought again',
    r.status === 400,
    `${r.status} ${JSON.stringify(r.body)}`,
  );

  r = await call('/api/shop/items', {
    method: 'POST',
    ...json({
      name: 'Repeatable reward',
      link: 'https://example.com/repeat',
      cost: 1,
      consumable: true,
    }),
  });
  const repeatableId = r.body.id;
  check(
    'consumable items are flagged',
    r.status === 201 && r.body.consumable === true && r.body.purchasedAt === null,
    `${r.status} ${JSON.stringify(r.body)}`,
  );

  r = await call(`/api/shop/items/${repeatableId}/buy`, { method: 'POST' });
  const firstRepeat = r.status;
  r = await call(`/api/shop/items/${repeatableId}/buy`, { method: 'POST' });
  check(
    'consumable items can be bought repeatedly',
    firstRepeat === 200 && r.status === 200 && r.body.item.purchasedAt === null,
    `${firstRepeat} ${r.status} ${JSON.stringify(r.body)}`,
  );

  r = await call(`/api/shop/items/${repeatableId}`, {
    method: 'PATCH',
    ...json({ consumable: false }),
  });
  check(
    'shop item consumable flag can be updated',
    r.status === 200 && r.body.consumable === false,
    `${r.status} ${JSON.stringify(r.body)}`,
  );

  r = await call(`/api/shop/items/${oneTimeId}`, { method: 'DELETE' });
  check('cleanup one-time item', r.status === 204, String(r.status));
  r = await call(`/api/shop/items/${repeatableId}`, { method: 'DELETE' });
  check('cleanup repeatable item', r.status === 204, String(r.status));

  r = await call(`/api/habits?profile=${shopA}`, { method: 'DELETE' });
  check('reset clears spent ether', r.status === 204, String(r.status));
  r = await call('/api/overview');
  const afterResetA = r.body.profiles.find((profile) => profile.id === shopA);
  check(
    'reset clears the spent balance',
    afterResetA.spent === 0 && afterResetA.ether === 0,
    JSON.stringify(afterResetA),
  );

  r = await call('/api/shop');
  check(
    'bought items stay in the shop',
    r.body.items.some((item) => item.id === shopItemId),
    JSON.stringify(r.body.items),
  );

  r = await call(`/api/shop/items/${shopItemId}`, {
    method: 'PATCH',
    ...json({ excludedProfiles: [shopB, mineId] }),
  });
  check('shop item accepts multiple exclusions', r.status === 200, String(r.status));
  r = await call(`/api/profiles/${shopB}`, { method: 'DELETE' });
  check('cleanup shop profile B', r.status === 204, String(r.status));
  r = await call('/api/shop');
  const afterProfileDelete = r.body.items.find((item) => item.id === shopItemId);
  check(
    'deleting a profile clears it from exclusions',
    afterProfileDelete.excludedProfiles.length === 1 &&
      afterProfileDelete.excludedProfiles[0] === mineId,
    JSON.stringify(afterProfileDelete.excludedProfiles),
  );

  r = await call(`/api/shop/items/${shopItemId}`, { method: 'DELETE' });
  check('shop item delete returns 204', r.status === 204, String(r.status));
  r = await call('/api/shop');
  check('shop is empty after deleting the item', r.body.items.length === 0, JSON.stringify(r.body));
  r = await call(`/api/shop/items/${shopItemId}`, { method: 'DELETE' });
  check('deleting an unknown shop item is 404', r.status === 404, String(r.status));
  r = await call(`/api/profiles/${shopA}`, { method: 'DELETE' });
  check('cleanup shop profile A', r.status === 204, String(r.status));

  console.log('\nshop wiring');
  check(
    'shop page markup present',
    [
      'page-shop',
      'shop-add-toggle',
      'shop-form',
      'shop-form-close',
      'shop-name',
      'shop-link',
      'shop-cost',
      'shop-image',
      'shop-consumable',
      'shop-list',
      'shop-empty',
      'shop-balance',
    ].every((id) => html.includes(`id="${id}"`)),
  );
  check(
    'shop add form starts collapsed behind an expandable toggle',
    /<button[^>]*id="shop-add-toggle"[^>]*aria-expanded="false"[^>]*aria-controls="shop-form"/.test(
      html,
    ) &&
      /<form[^>]*id="shop-form"[^>]*hidden/.test(html) &&
      js.includes('function setShopFormOpen') &&
      js.includes("els.shopAddToggle.addEventListener('click'") &&
      js.includes("els.shopFormClose.addEventListener('click'"),
  );
  check(
    'app renders and wires the shop',
    ['renderShop', 'shopItemCard', 'addShopItem', 'buyShopItem', 'setContributor'].every((name) =>
      js.includes(`function ${name}`),
    ) &&
      js.includes("api('/api/shop/items'") &&
      js.includes('/buy`'),
  );
  check(
    'buying a shop item does not ask for confirmation',
    !js
      .slice(js.indexOf('async function buyShopItem'), js.indexOf('/* ---------- settings ---------- */'))
      .includes('window.confirm'),
  );
  check(
    'buying a shop item plays a short purchase sound',
    js.includes('function playPurchaseSound') &&
      js.includes('function ensureAudioContext') &&
      js.includes('window.AudioContext || window.webkitAudioContext') &&
      js
        .slice(js.indexOf('async function buyShopItem'), js.indexOf('/* ---------- settings ---------- */'))
        .includes('ensureAudioContext()') &&
      js
        .slice(js.indexOf('async function buyShopItem'), js.indexOf('/* ---------- settings ---------- */'))
        .includes('playPurchaseSound()'),
  );
  check(
    'shop item name is the link to the item page',
    js.includes("title.className = 'shop-item-name'") &&
      js.includes('title.href = item.link') &&
      js.includes("title.target = '_blank'") &&
      !js.includes("'Open link'") &&
      css.includes('.shop-item-name:hover'),
  );
  check(
    'shop item name and buy button share a row',
    js.includes("side.className = 'shop-item-side'") &&
      js.includes('side.append(buy, remove)') &&
      !js.includes('shop-item-actions') &&
      css.includes('.shop-item-side'),
  );
  check(
    'ether uses a shared sparkle icon',
    html.includes('id="icon-ether"') &&
      (html.match(/class="ether-icon"/g) || []).length >= 2 &&
      js.includes('function etherIcon') &&
      js.includes("use.setAttribute('href', '#icon-ether')") &&
      js.includes('total.append(etherIcon(), strong, suffix)') &&
      css.includes('.ether-icon'),
  );
  check(
    'shop splits consumables and rewards',
    js.includes('function itemPurchased') &&
      js.includes('function shopSection') &&
      js.includes("'Consumables'") &&
      js.includes("'Rewards'") &&
      js.indexOf("'Consumables'") < js.indexOf("'Rewards'") &&
      js.includes('els.shopConsumable.checked') &&
      js.includes('{ name, link, cost, image, consumable }') &&
      css.includes('.shop-section') &&
      css.includes('.shop-item.is-purchased') &&
      css.includes('.shop-purchased-note') &&
      css.includes('.shop-check'),
  );
  check(
    'consumables render as a three-column tile grid',
    js.includes('function shopTileCard') &&
      js.includes("className: 'shop-grid'") &&
      js.includes('card: shopTileCard') &&
      /\.shop-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/.test(css) &&
      /\.shop-tile\s*\{[^}]*aspect-ratio:\s*1/.test(css) &&
      css.includes('.shop-tile .shop-bar-legend') &&
      css.includes('.shop-tile-remove') &&
      css.includes('.shop-tile-buy') &&
      css.includes('.shop-contributor-amount') &&
      /@media \(max-width: 720px\)[\s\S]*?\.shop-grid\s*\{[^}]*repeat\(2,/.test(css),
  );
  check(
    'shop progress bar is colour coded per profile',
    js.includes('function shopContributorShares') &&
      js.includes('segment.dataset.theme = share.profile.theme') &&
      js.includes('shop-bar-key-dot') &&
      js.includes('aria-valuetext') &&
      css.includes('.shop-bar-segment') &&
      css.includes('.shop-bar-legend') &&
      /\.shop-bar-segment\s*\{[^}]*background:\s*var\(--accent\)/.test(css),
  );
  check(
    'shop styles present',
    css.includes('.shop-item') &&
      css.includes('.shop-bar-segment') &&
      css.includes('.shop-contributor') &&
      css.includes('.shop-add-toggle') &&
      css.includes('.shop-form[hidden]') &&
      css.includes('body[data-page="shop"]'),
  );

  console.log('\npages + neutral chrome');
  check(
    'navigation links to every page',
    html.includes('href="/" data-nav="habits"') &&
      html.includes('href="/dashboard" data-nav="dashboard"') &&
      html.includes('href="/shop" data-nav="shop"') &&
      html.includes('href="/settings" data-nav="settings"'),
  );
  check(
    'four page containers exist',
    ['page-habits', 'page-dashboard', 'page-shop', 'page-settings'].every((id) =>
      html.includes(`id="${id}"`),
    ),
  );
  const dashboardHtml = html.slice(
    html.indexOf('id="page-dashboard"'),
    html.indexOf('id="page-settings"'),
  );
  check(
    'factor form lives only on the settings page',
    !dashboardHtml.includes('id="ether-form"') &&
      html.indexOf('id="page-settings"') < html.indexOf('id="ether-form"'),
  );
  check(
    'app applies page visibility and navigation state',
    js.includes('function applyPage') &&
      js.includes("PAGE_PATH === '/dashboard'") &&
      js.includes("PAGE_PATH === '/settings'") &&
      js.includes("PAGE_PATH === '/shop'") &&
      js.includes('aria-current'),
  );
  check(
    'dashboard cards keep each profile palette',
    css.includes('body[data-page="dashboard"]') &&
      /\.ether-bar\s*\{[^}]*var\(--accent\)/.test(css) &&
      css.includes('.dashboard-card .ether-title'),
  );

  const navBlock = css.match(/\.page-nav\s*\{([^}]*)\}/)?.[1] || '';
  const totalBlock = css.match(/\.dashboard-total \.ether-total strong\s*\{([^}]*)\}/)?.[1] || '';
  const factorBlock = css.match(/\.factor-form button\s*\{([^}]*)\}/)?.[1] || '';
  check(
    'shared page chrome avoids palette colours',
    navBlock.length > 0 &&
      totalBlock.length > 0 &&
      factorBlock.length > 0 &&
      !navBlock.includes('--accent') &&
      !totalBlock.includes('--accent') &&
      !factorBlock.includes('--accent') &&
      !/\.page-nav a\[aria-current="page"\]\s*\{[^}]*--accent/.test(css),
  );
  check(
    'reserved chrome colour is not in the palette',
    /--chrome:\s*#[0-9a-f]{6}/i.test(css) &&
      !cssThemes.includes('chrome') &&
      !cssThemes.includes('slate'),
  );

  console.log('\ndelete');
  r = await call(`/api/habits/${id}`, { method: 'DELETE' });
  check('delete returns 204', r.status === 204);
  r = await call('/api/habits');
  check('list empty after delete', r.body.habits.length === 0);

  console.log('\nreset');
  r = await call('/api/habits');
  check(
    'ether remains with no habits before reset',
    r.body.habits.length === 0 && r.body.ether.total > 0,
    JSON.stringify({ habits: r.body.habits.length, ether: r.body.ether.total }),
  );

  r = await call('/api/habits', { method: 'DELETE' });
  check('reset works with no habits but remaining ether', r.status === 204, String(r.status));
  r = await call('/api/habits');
  check(
    'reset with no habits clears the ether',
    r.body.habits.length === 0 && r.body.ether.total === 0,
    JSON.stringify({ habits: r.body.habits.length, ether: r.body.ether.total }),
  );

  await call('/api/habits', { method: 'POST', ...json({ name: 'temp one' }) });
  await call('/api/habits', { method: 'POST', ...json({ name: 'temp two' }) });
  r = await call('/api/habits');
  check('two habits before reset', r.body.habits.length === 2, String(r.body.habits.length));

  r = await call('/api/habits', { method: 'DELETE' });
  check('reset returns 204', r.status === 204, String(r.status));

  r = await call('/api/habits');
  check('reset empties the list', r.body.habits.length === 0);
  check('reset clears retired ether', r.body.ether.total === 0, String(r.body.ether.total));
  const afterReset = JSON.parse(await fs.readFile(dataFile, 'utf8'));
  const resetProfile = afterReset.profiles.find(
    (profile) => profile.id === afterReset.activeProfileId,
  );
  check('reset persists to disk', resetProfile.habits.length === 0);
  check(
    'reset persists cleared retired ether',
    Object.keys(resetProfile.retiredEarnings).length === 0,
    JSON.stringify(resetProfile.retiredEarnings),
  );

  r = await call('/api/habits', { method: 'DELETE' });
  check('reset on an empty list is still 204', r.status === 204);
  r = await call('/api/habits', { method: 'PUT' });
  check('unsupported collection method is 405', r.status === 405);

  r = await call('/api/habits/does-not-exist/toggle', { method: 'POST', ...json({}) });
  check('unknown habit is 404', r.status === 404);

  console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} check(s) failed`}`);
} finally {
  child.kill('SIGTERM');
  await new Promise((resolve) => child.on('exit', resolve));
  await fs.rm(tmpDir, { recursive: true, force: true });
}

process.exit(failures === 0 ? 0 : 1);

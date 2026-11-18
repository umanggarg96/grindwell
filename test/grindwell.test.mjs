import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
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
const { jobOutcome, jobPayout } = require(path.join(root, 'public/job-math.js'));
const {
  parseAmazonLink,
  shortItemName,
  priceToCost,
  shapeAmazonItem,
  parseAmazonPage,
  isAmazonBlockPage,
} = require(path.join(root, 'public/amazon-link.js'));

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
      {
        id: 'penalty-seed',
        name: 'Penalty seed',
        createdAt: new Date().toISOString(),
        urgency: 6,
        penaltyFrom: daysAgo(5),
        days: [0, 1, 2, 3, 4, 5, 6],
        completions: [],
      },
    ],
  }),
);

const child = spawn(process.execPath, [path.join(root, 'server.js')], {
  env: (() => {
    const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_FILE: dataFile };
    // Keep the unconfigured Amazon path deterministic even if the shell exports
    // Creators API credentials for real use.
    for (const key of Object.keys(env)) {
      if (key.startsWith('AMAZON_')) delete env[key];
    }
    // Keep the page fallback off so the suite never requests the real Amazon.
    env.AMAZON_PAGE_LOOKUP = 'off';
    return env;
  })(),
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
      r.body.profiles[0].habitCount === 5,
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
  check(
    'legacy habits opt out of penalties',
    legacy.urgency === 0 && legacy.penalty === 0,
    JSON.stringify({ urgency: legacy.urgency, penalty: legacy.penalty }),
  );

  const seededRaw = JSON.parse(await fs.readFile(dataFile, 'utf8'));
  check(
    'legacy habits live under the profile on disk',
    Array.isArray(
      seededRaw.profiles[0].habits.find((habit) => habit.id === 'legacy-habit').days,
    ) &&
      seededRaw.profiles[0].habits.length === 5 &&
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

  console.log('\nurgency penalties');
  r = await call('/api/habits');
  const penaltySeed = r.body.habits.find((habit) => habit.id === 'penalty-seed');
  check(
    'seeded misses are settled automatically',
    r.status === 200 &&
      penaltySeed.urgency === 6 &&
      penaltySeed.penalty === 6 &&
      r.body.ether.penalties === 30 &&
      r.body.ether.total === -10,
    JSON.stringify({
      urgency: penaltySeed.urgency,
      penalty: penaltySeed.penalty,
      penalties: r.body.ether.penalties,
      total: r.body.ether.total,
    }),
  );
  check(
    'penalties count in the range and per-day net',
    r.body.ether.penaltyLast7 === 30 &&
      r.body.ether.netLast7 === -25 &&
      r.body.ether.days.find((day) => day.date === daysAgo(5)).penalty === 6 &&
      r.body.ether.days.find((day) => day.date === daysAgo(5)).net === -6,
    JSON.stringify({
      penaltyLast7: r.body.ether.penaltyLast7,
      netLast7: r.body.ether.netLast7,
      day: r.body.ether.days.find((day) => day.date === daysAgo(5)),
    }),
  );
  check(
    'summary tracks missed scheduled days without counting today',
    r.body.ether.missedLast7 === 5 &&
      r.body.ether.missedLast30 === 5 &&
      r.body.ether.days.find((day) => day.date === daysAgo(5)).missed === 1 &&
      r.body.ether.days.find((day) => day.date === daysAgo(6)).missed === 0 &&
      r.body.ether.days[29].missed === 0,
    JSON.stringify({
      missedLast7: r.body.ether.missedLast7,
      missedLast30: r.body.ether.missedLast30,
      from: r.body.ether.days.find((day) => day.date === daysAgo(5)),
      before: r.body.ether.days.find((day) => day.date === daysAgo(6)),
      today: r.body.ether.days[29],
    }),
  );
  check(
    'negative balances are allowed',
    r.body.profile.ether < 0,
    String(r.body.profile.ether),
  );

  const penaltyDisk = JSON.parse(await fs.readFile(dataFile, 'utf8'));
  const penaltyOnDisk = penaltyDisk.profiles[0].habits.find(
    (habit) => habit.id === 'penalty-seed',
  );
  check(
    'penalties persist per missed date and skip today',
    penaltyOnDisk.penaltyFrom === daysAgo(5) &&
      Object.keys(penaltyOnDisk.penalties).length === 5 &&
      penaltyOnDisk.penalties[daysAgo(5)] === 6 &&
      penaltyOnDisk.penalties[daysAgo(1)] === 6 &&
      !penaltyOnDisk.penalties[TODAY],
    JSON.stringify(penaltyOnDisk.penalties),
  );

  r = await call('/api/settings', { method: 'PATCH', ...json({ urgencyFactor: 2 }) });
  check('urgency factor updated', r.status === 200 && r.body.urgencyFactor === 2);
  r = await call('/api/habits');
  check(
    'recorded penalties keep the old rate',
    r.body.ether.penalties === 30 &&
      r.body.habits.find((habit) => habit.id === 'penalty-seed').penalty === 12,
    JSON.stringify({
      penalties: r.body.ether.penalties,
      penalty: r.body.habits.find((habit) => habit.id === 'penalty-seed').penalty,
    }),
  );
  await call('/api/settings', { method: 'PATCH', ...json({ urgencyFactor: 1 }) });

  for (const seedId of [
    'legacy-habit',
    'weekly-today',
    'weekly-missed',
    'rest-bonus',
    'penalty-seed',
  ]) {
    await call(`/api/habits/${seedId}`, { method: 'DELETE' });
  }

  r = await call('/api/habits');
  check(
    'deleting a habit keeps its penalties',
    r.body.ether.penalties === 30 && r.body.ether.total === -10,
    JSON.stringify({ penalties: r.body.ether.penalties, total: r.body.ether.total }),
  );
  const penaltyRetiredDisk = JSON.parse(await fs.readFile(dataFile, 'utf8'));
  check(
    'retired penalties persist on disk',
    penaltyRetiredDisk.profiles[0].retiredPenalties[daysAgo(5)] === 6,
    JSON.stringify(penaltyRetiredDisk.profiles[0].retiredPenalties),
  );

  r = await call('/api/habits');
  check('empty habit list', r.status === 200 && Array.isArray(r.body.habits) && r.body.habits.length === 0);
  check('today is a YYYY-MM-DD key', /^\d{4}-\d{2}-\d{2}$/.test(r.body.today), r.body.today);

  // Deleting the seeded habits keeps their earned ether by design, so clear it
  // before the ether tests that assert exact totals.
  r = await call('/api/habits', { method: 'DELETE' });
  check('reset clears seeded ether', r.status === 204);
  r = await call('/api/habits');
  check(
    'reset clears retired penalties',
    r.body.ether.penalties === 0 && r.body.ether.total === 0,
    JSON.stringify({ penalties: r.body.ether.penalties, total: r.body.ether.total }),
  );

  console.log('\ncreate');
  r = await call('/api/habits', { method: 'POST', ...json({ name: '  Read   10 pages  ' }) });
  check('create returns 201', r.status === 201, String(r.status));
  check('name is trimmed/collapsed', r.body.name === 'Read 10 pages', r.body.name);
  check('starts not done', r.body.doneToday === false);
  check('starts with empty streak', r.body.streak === 0);
  check('defaults difficulty to 5', r.body.difficulty === 5, String(r.body.difficulty));
  check(
    'defaults urgency to 1',
    r.body.urgency === 1 && r.body.penalty === 1,
    JSON.stringify({ urgency: r.body.urgency, penalty: r.body.penalty }),
  );
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

  console.log('\nurgency');
  r = await call('/api/habits', { method: 'POST', ...json({ name: 'Urgent task', urgency: 7 }) });
  check(
    'urgency 7 stored with its penalty',
    r.status === 201 && r.body.urgency === 7 && r.body.penalty === 7,
    JSON.stringify({ urgency: r.body.urgency, penalty: r.body.penalty }),
  );
  const urgentId = r.body.id;

  for (const bad of [-1, 11, 1.5, '7', null]) {
    r = await call('/api/habits', { method: 'POST', ...json({ name: 'Bad urgency', urgency: bad }) });
    check(`urgency ${JSON.stringify(bad)} rejected`, r.status === 400, `${r.status} ${JSON.stringify(r.body)}`);
  }

  r = await call(`/api/habits/${urgentId}`, { method: 'PATCH', ...json({ urgency: 4 }) });
  check('urgency edit works', r.status === 200 && r.body.urgency === 4);
  const urgencyDisk = JSON.parse(await fs.readFile(dataFile, 'utf8'));
  const urgentOnDisk = urgencyDisk.profiles
    .find((profile) => profile.id === urgencyDisk.activeProfileId)
    .habits.find((habit) => habit.id === urgentId);
  check(
    'urgency edits restart the penalty window at today',
    urgentOnDisk.penaltyFrom === TODAY,
    urgentOnDisk.penaltyFrom,
  );

  r = await call(`/api/habits/${urgentId}`, { method: 'PATCH', ...json({ urgency: 0 }) });
  check('urgency can be turned off', r.status === 200 && r.body.urgency === 0 && r.body.penalty === 0);
  await call(`/api/habits/${urgentId}`, { method: 'DELETE' });

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
    { urgency: -1 },
    { urgency: 11 },
    { urgency: 1.5 },
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
    'palette includes blue, teal, and violet shades',
    ['blue', 'teal', 'violet'].every((id) => cssThemes.includes(id)),
    cssThemes.join(', '),
  );
  check(
    'green and red palettes are removed so they do not clash with trend bars',
    ['green', 'lime', 'rose'].every((id) => !cssThemes.includes(id)),
    cssThemes.join(', '),
  );
  check(
    'trend charts use green and red instead of theme accents',
    css.includes('--graph-up:') &&
      css.includes('--graph-down:') &&
      /\.ether-bar\s*\{[^}]*var\(--graph-up\)/.test(css) &&
      /\.ether-bar\.is-negative\s*\{[^}]*var\(--graph-down\)/.test(css) &&
      /\.habit-card \.habit-chart \.ether-bar\s*\{[^}]*var\(--graph-up\)/.test(css) &&
      /\.habit-card \.habit-chart \.ether-bar\.is-negative\s*\{[^}]*var\(--graph-down\)/.test(css),
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

  let parsed = parseCase('habit 1 ; 10 ; 3 ; tu,th');
  check(
    'name, difficulty, and urgency parsed from semicolons',
    parsed.value?.name === 'habit 1' &&
      parsed.value?.difficulty === 10 &&
      parsed.value?.urgency === 3,
    JSON.stringify(parsed),
  );
  check(
    'listed days become rest days',
    JSON.stringify(parsed.value?.days) === JSON.stringify([0, 1, 3, 5, 6]),
    JSON.stringify(parsed.value?.days),
  );

  parsed = parseCase('Read 10 pages');
  check('difficulty defaults to 5', parsed.value?.difficulty === 5);
  check('urgency defaults to 1', parsed.value?.urgency === 1);
  check(
    'schedule defaults to all days',
    JSON.stringify(parsed.value?.days) === JSON.stringify([0, 1, 2, 3, 4, 5, 6]),
  );

  parsed = parseCase('Read 10 pages ; 4');
  check(
    'difficulty without urgency keeps every day',
    parsed.value?.difficulty === 4 &&
      parsed.value?.urgency === 1 &&
      parsed.value?.days.length === 7,
  );

  parsed = parseCase('Read 10 pages ; 4 ; 6');
  check(
    'urgency is read from the third part',
    parsed.value?.difficulty === 4 &&
      parsed.value?.urgency === 6 &&
      parsed.value?.days.length === 7,
  );

  parsed = parseCase('Read 10 pages ;  ;  ; sat,sun');
  check(
    'blank difficulty and urgency fall back to defaults',
    parsed.value?.difficulty === 5 &&
      parsed.value?.urgency === 1 &&
      !parsed.value?.days.includes(0) &&
      !parsed.value?.days.includes(6),
  );

  parsed = parseCase('  Read   10   pages  ;  7  ;  2  ;  MON, tues  ');
  check(
    'names and day tokens are normalised',
    parsed.value?.name === 'Read 10 pages' &&
      parsed.value?.difficulty === 7 &&
      parsed.value?.urgency === 2 &&
      JSON.stringify(parsed.value?.days) === JSON.stringify([0, 3, 4, 5, 6]),
    JSON.stringify(parsed.value),
  );

  parsed = parseCase('Read ; 5 ; 0');
  check('urgency 0 is allowed and disables penalties', parsed.value?.urgency === 0);

  parsed = parseCase('Read ; 5 ; 10');
  check('urgency 10 is allowed', parsed.value?.urgency === 10);

  parsed = parseCase('x ; 5 ; mon');
  check(
    'days in the urgency slot are rejected',
    Boolean(parsed.error) && parsed.error.includes('Urgency'),
    parsed.error,
  );

  for (const [label, raw] of [
    ['empty input', '   '],
    ['missing name', '; 5 ; 3 ; mon'],
    ['difficulty 0', 'x ; 0'],
    ['difficulty 11', 'x ; 11'],
    ['urgency 11', 'x ; 5 ; 11'],
    ['urgency -1', 'x ; 5 ; -1'],
    ['unknown day', 'x ; 9 ; 2 ; funday'],
    ['all days skipped', 'x ; 5 ; 2 ; mon,tue,wed,thu,fri,sat,sun'],
    ['too many semicolons', 'x ; 5 ; 2 ; mon ; extra'],
    ['days before difficulty', 'x ; mon'],
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
    'reset is enabled while ether or penalties remain without habits',
    js.includes(
      'profile.habits.length === 0 && profile.ether === 0 && !(profile.penalties > 0)',
    ) &&
      js.includes('const hasHistory = profile.ether !== 0 || (profile.penalties || 0) > 0'),
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

  r = await call(`/api/profiles/${alexId}`, { method: 'PATCH', ...json({ theme: 'violet' }) });
  check('profile theme updated', r.status === 200 && r.body.theme === 'violet');

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
      alexOnDisk.theme === 'violet' &&
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
      typeof r.body.profiles[0].summary.netLast7 === 'number' &&
      typeof r.body.profiles[0].summary.penalties === 'number' &&
      typeof r.body.profiles[0].penalties === 'number' &&
      r.body.settings.etherFactor === 1 &&
      r.body.settings.urgencyFactor === 1,
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
  check(
    'settings expose the global urgency factor',
    r.status === 200 && r.body.urgencyFactor === 1,
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
      typeof r.body.ether.last30 === 'number' &&
      typeof r.body.ether.netLast7 === 'number' &&
      typeof r.body.ether.penaltyLast7 === 'number',
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

  for (const payload of [
    {},
    { etherFactor: 0 },
    { etherFactor: 11 },
    { etherFactor: 'abc' },
    { urgencyFactor: 0 },
    { urgencyFactor: 11 },
    { urgencyFactor: 'abc' },
  ]) {
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
  check('urgency factor persisted to disk', etherDisk.settings.urgencyFactor === 1);
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
  check(
    'new habits persist urgency and a penalty window',
    mineOnDisk.habits.find((habit) => habit.id === lockId).urgency === 1 &&
      mineOnDisk.habits.find((habit) => habit.id === lockId).penaltyFrom === TODAY,
    JSON.stringify({
      urgency: mineOnDisk.habits.find((habit) => habit.id === lockId).urgency,
      penaltyFrom: mineOnDisk.habits.find((habit) => habit.id === lockId).penaltyFrom,
    }),
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
      'dashboard-tabs',
      'dashboard-panel-ether',
      'dashboard-panel-habits',
      'dashboard-list',
      'dashboard-habits',
      'ether-form',
      'ether-factor',
      'ether-penalties',
      'urgency-form',
      'urgency-factor',
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
      js.includes('function saveUrgencyFactor') &&
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
      js.includes('function rangeNet') &&
      js.includes('function rangePenalty') &&
      js.includes("els.dashboardRange.addEventListener('change'"),
  );
  check(
    'dashboard trends show net ether and penalties',
    js.includes('statNode(rangeLabel(), rangeNet(summary))') &&
      js.includes("statNode('Penalties', rangePenalty(summary))") &&
      js.includes('els.etherPenalties.textContent') &&
      js.includes('const net = Number(day.net) || 0') &&
      js.includes("bar.className = 'ether-bar' + (net < 0 ? ' is-negative' : '')") &&
      js.includes("chart.className =") &&
      js.includes('has-negative') &&
      css.includes('.ether-bar.is-negative') &&
      css.includes('.ether-chart.has-negative'),
  );
  check(
    'dashboard splits ether and habit trends into sub-pages',
    html.includes('id="dashboard-tabs"') &&
      html.includes('role="tablist"') &&
      html.includes('id="dashboard-tab-ether"') &&
      html.includes('id="dashboard-tab-habits"') &&
      html.includes('id="dashboard-panel-ether"') &&
      html.includes('id="dashboard-panel-habits"') &&
      html.includes('role="tabpanel"'),
  );
  check(
    'habit trends render a separate chart for each profile',
    js.includes('function habitTrendCard') &&
      js.includes('profiles.map(habitTrendCard)') &&
      js.includes('function completionChart') &&
      js.includes('completionChart(days, profile.name)') &&
      js.includes('card.dataset.theme = profile.theme') &&
      !js.includes('function completionDays') &&
      !js.includes('function trendsCard') &&
      js.includes("DASHBOARD_VIEW_KEY = 'grindwell.dashboardView'") &&
      js.includes('function setDashboardView'),
  );
  check(
    'habit trends split completed and missed into diverging bars',
    js.includes('function rangeMissed') &&
      js.includes('Number(day.missed)') &&
      js.includes('const hasMissed') &&
      js.includes("chart.className =") &&
      js.includes('has-negative') &&
      js.includes("down.className = 'ether-bar is-negative'") &&
      js.includes("statNode('Missed', missed)") &&
      css.includes('.ether-day-missed') &&
      css.includes('.habit-card .habit-chart .ether-bar.is-negative'),
  );
  check(
    'dashboard sub-page styles present',
    css.includes('.dashboard-tabs') &&
      css.includes('.dashboard-tab') &&
      css.includes('.dashboard-panel') &&
      css.includes('.habit-chart'),
  );
  check(
    'difficulty renders as stars and the card reward chip is gone',
    js.includes('function starRating') &&
      js.includes('starRating(habit.difficulty)') &&
      !js.includes('chip-ether') &&
      !js.includes('`+${habit.reward} ether`'),
  );
  check(
    'habit cards show the missed penalty and the editor sets urgency',
    js.includes('habit.urgency > 0 && habit.penalty > 0') &&
      js.includes('chip chip-penalty') &&
      js.includes('`−${habit.penalty} if missed`') &&
      js.includes("urgencyLabel.textContent = 'Urgency'") &&
      js.includes('function syncUrgency') &&
      js.includes('urgency: Number(urgencyInput.value)') &&
      css.includes('.chip-penalty'),
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

  console.log('\namazon link helpers');

  const amazonLink = parseAmazonLink(
    'https://www.amazon.in/Echo-Dot-4th-Gen/dp/B08N5WRWNW/ref=sr_1_1?keywords=echo',
  );
  check(
    'amazon.in product links resolve to an ASIN',
    amazonLink && amazonLink.asin === 'B08N5WRWNW',
    JSON.stringify(amazonLink),
  );
  check(
    'amazon.in gp/product links resolve too',
    parseAmazonLink('https://amazon.in/gp/product/B08N5WRWNW?th=1')?.asin === 'B08N5WRWNW',
  );
  check(
    'non-India and non-product links are rejected',
    parseAmazonLink('https://www.amazon.com/dp/B08N5WRWNW') === null &&
      parseAmazonLink('https://example.com/dp/B08N5WRWNW') === null &&
      parseAmazonLink('not a url') === null,
  );
  check(
    'short names collapse whitespace and cut on a word boundary',
    shortItemName('  Echo   Dot  (4th Gen) Smart speaker with Alexa - Charcoal  ') ===
      'Echo Dot (4th Gen) Smart speaker with Alexa - Charcoal' &&
      shortItemName('Echo Dot (4th Gen) Smart speaker with Alexa - Charcoal', 24) ===
        'Echo Dot (4th Gen)…' &&
      shortItemName('OneVeryLongWordThatCannotBreakAnywhere', 12).length === 12,
  );
  check(
    'amazon prices become whole ether costs',
    priceToCost('₹1,299.49') === 1299 &&
      priceToCost(99.4) === 99 &&
      priceToCost('not a price') === null &&
      priceToCost(0) === null,
  );
  const shaped = shapeAmazonItem({
    itemsResult: {
      items: [
        {
          asin: 'B08N5WRWNW',
          detailPageURL: 'https://www.amazon.in/dp/B08N5WRWNW',
          itemInfo: { title: { displayValue: 'Echo Dot (4th Gen) Smart speaker with Alexa' } },
          images: { primary: { medium: { url: 'https://m.media-amazon.com/images/I/echo.jpg' } } },
          offersV2: {
            listings: [
              {
                isBuyBoxWinner: false,
                price: { money: { amount: 4499, currency: 'INR', displayAmount: '₹4,499.00' } },
              },
              {
                isBuyBoxWinner: true,
                price: { money: { amount: 3999.5, currency: 'INR', displayAmount: '₹3,999.50' } },
              },
            ],
          },
        },
      ],
    },
  });
  check(
    'Creators API responses prefer the Buy Box price and fall back to medium images',
    shaped &&
      shaped.asin === 'B08N5WRWNW' &&
      shaped.cost === 4000 &&
      shaped.image === 'https://m.media-amazon.com/images/I/echo.jpg' &&
      shaped.price.currency === 'INR' &&
      shaped.price.display === '₹3,999.50',
    JSON.stringify(shaped),
  );
  check(
    'empty Creators API responses are ignored',
    shapeAmazonItem({ itemsResult: { items: [] } }) === null &&
      shapeAmazonItem({}) === null,
  );

  // The page fallback reads the same markup a browser renders. Amazon.in
  // serves no Open Graph tags, so the fixture mirrors the real structure.
  const pageHtml = `<!doctype html><html><head><title>Amazon.in</title></head><body>
    <img src="https://m.media-amazon.com/images/I/fallback.jpg"
      data-a-image-name="landingImage" id="landingImage"
      data-a-dynamic-image="{&quot;https://m.media-amazon.com/images/I/dyn.jpg&quot;:[355,222]}">
    <span id="productTitle" class="a-size-large">  Echo Dot (4th Gen) Smart
      speaker with Alexa - Charcoal </span>
    <div id="corePriceDisplay_desktop_feature_div">
      <span class="a-price"><span class="a-offscreen">₹4,499.00</span></span>
      <span class="a-price-whole">9,999</span>
    </div>
  </body></html>`;
  const pageItem = parseAmazonPage(pageHtml);
  check(
    'product pages are read without any API credentials',
    pageItem &&
      pageItem.name === 'Echo Dot (4th Gen) Smart speaker with Alexa - Charcoal' &&
      pageItem.cost === 4499 &&
      pageItem.image === 'https://m.media-amazon.com/images/I/fallback.jpg' &&
      pageItem.price.currency === 'INR',
    JSON.stringify(pageItem),
  );
  check(
    'a page without a title is not treated as a product',
    parseAmazonPage('<html><body>Nothing here</body></html>') === null &&
      parseAmazonPage('') === null,
  );
  check(
    'the whole-price fallback works when no offscreen price exists',
    parseAmazonPage(
      '<span id="productTitle">Thing</span><span class="a-price-whole">1,299</span><span class="a-price-fraction">50</span>',
    )?.cost === 1300,
  );
  check(
    'bot checks are recognised',
    isAmazonBlockPage('<title>Robot Check</title>') === true &&
      isAmazonBlockPage('Enter the characters you see below') === true &&
      isAmazonBlockPage(pageHtml) === false,
  );

  console.log('\nshop');

  r = await call('/api/shop');
  check(
    'shop starts empty',
    r.status === 200 && Array.isArray(r.body.items) && r.body.items.length === 0,
    JSON.stringify(r.body),
  );
  check(
    'shop reports Amazon lookup availability',
    r.body.lookup && r.body.lookup.amazon === false && r.body.lookup.mode === 'off',
    JSON.stringify(r.body.lookup),
  );
  r = await call('/api/shop', { method: 'POST' });
  check('unsupported shop method is 405', r.status === 405, String(r.status));

  r = await call('/api/overview');
  check(
    'overview reports Amazon lookup availability',
    r.body.lookup && r.body.lookup.amazon === false && r.body.lookup.mode === 'off',
    JSON.stringify(r.body.lookup),
  );

  r = await call('/api/shop/lookup', {
    method: 'POST',
    ...json({ link: 'https://www.amazon.in/dp/B08N5WRWNW' }),
  });
  check(
    'disabled Amazon lookup explains how to enable it',
    r.status === 503 && /turned off/i.test(r.body.error),
    `${r.status} ${JSON.stringify(r.body)}`,
  );

  r = await call('/api/shop/lookup');
  check('Amazon lookup rejects non-POST methods', r.status === 405, String(r.status));

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

  r = await call('/api/profiles', { method: 'POST', ...json({ name: 'Shop A', theme: 'violet' }) });
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
    'shop link row offers Amazon auto-fill',
    html.includes('id="shop-lookup"') &&
      html.includes('id="shop-lookup-status"') &&
      html.includes('src="/amazon-link.js"') &&
      js.includes('function lookupShopLink') &&
      js.includes('function syncShopLookup') &&
      js.includes('function scheduleShopLookup') &&
      js.includes("api('/api/shop/lookup'") &&
      js.includes('els.shopLookup.addEventListener') &&
      js.includes('els.shopLink.addEventListener') &&
      css.includes('.shop-link-row') &&
      css.includes('.shop-lookup-status'),
  );
  check(
    'shop offers the bookmarklet fallback',
    html.includes('id="shop-bookmarklet"') &&
      html.includes('class="shop-helper"') &&
      js.includes('function shopBookmarkletHref') &&
      js.includes('function applyShopImport') &&
      js.includes("els.shopBookmarklet.href = shopBookmarkletHref()") &&
      js.includes("if (PAGE === 'shop') applyShopImport()") &&
      css.includes('.shop-bookmarklet'),
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
      .slice(js.indexOf('async function buyShopItem'), js.indexOf('/* ---------- jobs ---------- */'))
      .includes('window.confirm'),
  );
  check(
    'buying a shop item plays a short purchase sound',
    js.includes('function playPurchaseSound') &&
      js.includes('function ensureAudioContext') &&
      js.includes('window.AudioContext || window.webkitAudioContext') &&
      js
        .slice(js.indexOf('async function buyShopItem'), js.indexOf('/* ---------- jobs ---------- */'))
        .includes('ensureAudioContext()') &&
      js
        .slice(js.indexOf('async function buyShopItem'), js.indexOf('/* ---------- jobs ---------- */'))
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
    'dashboard cards keep each profile palette while bars use graph colours',
    css.includes('body[data-page="dashboard"]') &&
      /\.habit-card \.ether-total strong\s*\{[^}]*var\(--accent-text\)/.test(css) &&
      css.includes('.dashboard-card .ether-title') &&
      /\.ether-bar\s*\{[^}]*var\(--graph-up\)/.test(css),
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
  check(
    'reset persists cleared retired penalties',
    Object.keys(resetProfile.retiredPenalties).length === 0,
    JSON.stringify(resetProfile.retiredPenalties),
  );

  r = await call('/api/habits', { method: 'DELETE' });
  check('reset on an empty list is still 204', r.status === 204);
  r = await call('/api/habits', { method: 'PUT' });
  check('unsupported collection method is 405', r.status === 405);

  r = await call('/api/habits/does-not-exist/toggle', { method: 'POST', ...json({}) });
  check('unknown habit is 404', r.status === 404);

  console.log('\njobs');

  const eta = 60;
  check(
    'job multiplier is 2x at half the ETA',
    jobOutcome(30 * 60000, eta).multiplier === 2,
    JSON.stringify(jobOutcome(30 * 60000, eta)),
  );
  check(
    'job multiplier is 1.5x past half but before the ETA',
    jobOutcome(31 * 60000, eta).multiplier === 1.5,
    JSON.stringify(jobOutcome(31 * 60000, eta)),
  );
  check(
    'job multiplier is 1x at the ETA and inside the 10% margin',
    jobOutcome(60 * 60000, eta).multiplier === 1 &&
      jobOutcome(66 * 60000, eta).multiplier === 1,
    JSON.stringify([jobOutcome(60 * 60000, eta), jobOutcome(66 * 60000, eta)]),
  );
  check(
    'job multiplier is 0.5x past the margin',
    jobOutcome(67 * 60000, eta).multiplier === 0.5,
    JSON.stringify(jobOutcome(67 * 60000, eta)),
  );
  check(
    'job fails past twice the ETA',
    jobOutcome(121 * 60000, eta).failed === true &&
      jobOutcome(121 * 60000, eta).multiplier === -0.5,
    JSON.stringify(jobOutcome(121 * 60000, eta)),
  );
  check(
    'job payouts are signed whole ether',
    jobPayout(20, 2) === 40 &&
      jobPayout(20, 1.5) === 30 &&
      jobPayout(20, 1) === 20 &&
      jobPayout(20, 0.5) === 10 &&
      jobPayout(20, -0.5) === -10,
    JSON.stringify([2, 1.5, 1, 0.5, -0.5].map((factor) => jobPayout(20, factor))),
  );

  r = await call('/api/profiles', { method: 'POST', ...json({ name: 'Job A', theme: 'blue' }) });
  const jobA = r.body.id;
  r = await call('/api/profiles', { method: 'POST', ...json({ name: 'Job B', theme: 'teal' }) });
  const jobB = r.body.id;

  r = await call('/api/jobs', {
    method: 'POST',
    ...json({ title: '  Wash   the van  ', reward: 10, etaMinutes: 60 }),
  });
  const firstJob = r.body.job;
  check(
    'job create normalises the title',
    r.status === 201 &&
      firstJob.title === 'Wash the van' &&
      firstJob.status === 'inbox' &&
      firstJob.createdBy === jobB,
    JSON.stringify(firstJob),
  );

  r = await call('/api/jobs');
  check(
    'new job appears in the inbox',
    r.body.jobs.inbox.some((job) => job.id === firstJob.id) &&
      r.body.jobs.inProgress.length === 0,
    JSON.stringify(r.body.jobs),
  );
  check(
    'job board exposes the limits',
    r.body.limits.maxInProgress === 3 && r.body.limits.terminalShown === 10,
    JSON.stringify(r.body.limits),
  );

  r = await call(`/api/jobs/${firstJob.id}/take?profile=${jobA}`, {
    method: 'POST',
    ...json({}),
  });
  check(
    'job can be taken by a profile',
    r.status === 200 &&
      r.body.job.status === 'inProgress' &&
      r.body.job.assignedTo === jobA,
    `${r.status} ${JSON.stringify(r.body)}`,
  );
  check(
    'job due date uses the ETA',
    Date.parse(r.body.job.dueAt) - Date.parse(r.body.job.startedAt) === 60 * 60000,
    `${r.body.job.startedAt} -> ${r.body.job.dueAt}`,
  );

  r = await call(`/api/jobs/${firstJob.id}/take?profile=${jobB}`, {
    method: 'POST',
    ...json({}),
  });
  check('a taken job cannot be taken twice', r.status === 409, String(r.status));

  r = await call(`/api/jobs/${firstJob.id}/complete`, { method: 'POST', ...json({}) });
  check(
    'a fast job completes at the 2x multiplier',
    r.status === 200 &&
      r.body.job.status === 'completed' &&
      r.body.job.multiplier === 2 &&
      r.body.job.payout === 20,
    `${r.status} ${JSON.stringify(r.body.job)}`,
  );

  r = await call(`/api/habits?profile=${jobA}`);
  check(
    'job reward lands in the profile balance',
    r.body.ether.earned === 20 && r.body.ether.total === 20 && r.body.ether.penalties === 0,
    JSON.stringify(r.body.ether),
  );

  r = await call('/api/overview');
  const jobAOverview = r.body.profiles.find((profile) => profile.id === jobA);
  check(
    'job ether shows in the dashboard summary',
    jobAOverview.summary.earned === 20 &&
      jobAOverview.summary.today === 20 &&
      jobAOverview.summary.netToday === 20,
    JSON.stringify(jobAOverview.summary),
  );

  r = await call('/api/jobs');
  check(
    'completed job appears in the completed box',
    r.body.jobs.completed[0]?.id === firstJob.id && r.body.jobs.inProgress.length === 0,
    JSON.stringify(r.body.jobs),
  );

  r = await call(`/api/jobs/${firstJob.id}`, { method: 'DELETE' });
  check('completed jobs cannot be deleted', r.status === 409, String(r.status));

  r = await call(`/api/jobs/${firstJob.id}/complete`, { method: 'POST', ...json({}) });
  check('completed jobs cannot be completed again', r.status === 409, String(r.status));

  r = await call('/api/jobs', {
    method: 'POST',
    ...json({ title: 'Throwaway', reward: 5, etaMinutes: 5 }),
  });
  const throwaway = r.body.job.id;
  r = await call(`/api/jobs/${throwaway}`, { method: 'DELETE' });
  check('an inbox job can be deleted', r.status === 204, String(r.status));
  r = await call('/api/jobs');
  check(
    'deleted inbox job is gone',
    !r.body.jobs.inbox.some((job) => job.id === throwaway),
  );

  for (const payload of [
    {},
    { title: '   ', reward: 5, etaMinutes: 5 },
    { title: 'Bad reward', reward: 0, etaMinutes: 5 },
    { title: 'Bad eta', reward: 5, etaMinutes: 0 },
    { title: 'Fraction reward', reward: 1.5, etaMinutes: 5 },
    { title: 'Fraction eta', reward: 5, etaMinutes: 1.5 },
  ]) {
    r = await call('/api/jobs', { method: 'POST', ...json(payload) });
    check(`job create ${JSON.stringify(payload)} rejected`, r.status === 400, String(r.status));
  }

  const limitJobs = [];
  for (let index = 0; index < 4; index += 1) {
    r = await call('/api/jobs', {
      method: 'POST',
      ...json({ title: `Limit ${index}`, reward: 5, etaMinutes: 60 }),
    });
    limitJobs.push(r.body.job.id);
  }
  for (let index = 0; index < 3; index += 1) {
    r = await call(`/api/jobs/${limitJobs[index]}/take?profile=${jobA}`, {
      method: 'POST',
      ...json({}),
    });
    check(`job ${index + 1} fits the in-progress limit`, r.status === 200, String(r.status));
  }
  r = await call(`/api/jobs/${limitJobs[3]}/take?profile=${jobA}`, {
    method: 'POST',
    ...json({}),
  });
  check('a fourth in-progress job is rejected', r.status === 400, String(r.status));
  r = await call(`/api/jobs/${limitJobs[3]}/take?profile=${jobB}`, {
    method: 'POST',
    ...json({}),
  });
  check('another profile can take the job', r.status === 200, String(r.status));

  for (let index = 0; index < 4; index += 1) {
    r = await call(`/api/jobs/${limitJobs[index]}/complete`, { method: 'POST', ...json({}) });
    check(`limit job ${index + 1} completes`, r.status === 200, String(r.status));
  }

  for (let index = 0; index < 6; index += 1) {
    r = await call('/api/jobs', {
      method: 'POST',
      ...json({ title: `History ${index}`, reward: 5, etaMinutes: 60 }),
    });
    const historyId = r.body.job.id;
    await call(`/api/jobs/${historyId}/take?profile=${jobA}`, {
      method: 'POST',
      ...json({}),
    });
    await call(`/api/jobs/${historyId}/complete`, { method: 'POST', ...json({}) });
  }

  r = await call('/api/jobs');
  check(
    'the completed box shows only the latest 10',
    r.body.jobs.completed.length === 10,
    String(r.body.jobs.completed.length),
  );
  check(
    'older completed jobs are hidden',
    !r.body.jobs.completed.some((job) => job.id === firstJob.id),
    JSON.stringify(r.body.jobs.completed.map((job) => job.id)),
  );
  check(
    'the failed box is capped too',
    r.body.jobs.failed.length <= 10,
    String(r.body.jobs.failed.length),
  );

  r = await call('/api/profiles', { method: 'POST', ...json({ name: 'Job C', theme: 'violet' }) });
  const jobC = r.body.id;
  r = await call('/api/jobs', {
    method: 'POST',
    ...json({ title: 'C job', reward: 5, etaMinutes: 60 }),
  });
  const cJob = r.body.job.id;
  await call(`/api/jobs/${cJob}/take?profile=${jobC}`, { method: 'POST', ...json({}) });
  r = await call(`/api/profiles/${jobC}`, { method: 'DELETE' });
  check('deleting a profile succeeds', r.status === 204, String(r.status));
  r = await call('/api/jobs');
  const returned = r.body.jobs.inbox.find((job) => job.id === cJob);
  check(
    'deleting a profile returns its in-progress job to the inbox',
    returned &&
      returned.assignedTo === null &&
      returned.startedAt === null &&
      returned.dueAt === null,
    JSON.stringify(returned),
  );
  await call(`/api/jobs/${cJob}`, { method: 'DELETE' });

  r = await call(`/api/habits?profile=${jobA}`);
  check('job ether is present before reset', r.body.ether.earned > 0, String(r.body.ether.earned));
  r = await call(`/api/habits?profile=${jobA}`, { method: 'DELETE' });
  check('reset returns 204 for a job earner', r.status === 204, String(r.status));
  r = await call(`/api/habits?profile=${jobA}`);
  check(
    'reset clears job ether',
    r.body.ether.earned === 0 && r.body.ether.total === 0,
    JSON.stringify(r.body.ether),
  );
  const jobDisk = JSON.parse(await fs.readFile(dataFile, 'utf8'));
  const jobAOnDisk = jobDisk.profiles.find((profile) => profile.id === jobA);
  check(
    'reset persists cleared job ledgers',
    Object.keys(jobAOnDisk.jobEarnings).length === 0 &&
      Object.keys(jobAOnDisk.jobPenalties).length === 0,
    JSON.stringify({ earnings: jobAOnDisk.jobEarnings, penalties: jobAOnDisk.jobPenalties }),
  );

  console.log('\njobs frontend');

  r = await call('/jobs');
  check(
    'jobs route serves the app',
    r.status === 200 && String(r.headers.get('content-type')).includes('text/html'),
    String(r.status),
  );
  check(
    'jobs page has a four-column board',
    ['page-jobs', 'jobs-inbox', 'jobs-progress-box', 'jobs-progress', 'jobs-completed', 'jobs-failed'].every(
      (id) => html.includes(`id="${id}"`),
    ),
  );
  check(
    'jobs page has a full-width add toggle',
    html.includes('id="jobs-add-toggle"') &&
      html.includes('aria-controls="job-form"') &&
      /<form[^>]*id="job-form"[^>]*hidden/.test(html) &&
      html.includes('id="job-form-close"') &&
      js.includes('function setJobFormOpen') &&
      js.includes("els.jobAddToggle.addEventListener('click'") &&
      js.includes("els.jobFormClose.addEventListener('click'"),
  );
  check('jobs page has an acting-as selector', html.includes('id="job-actor"'));
  check('jobs page loads the job math helper', html.includes('/job-math.js'));
  check(
    'jobs frontend renders and polls',
    js.includes('function renderJobs') &&
      js.includes('function loadJobs') &&
      js.includes('refreshJobsQuietly') &&
      js.includes('/api/jobs'),
  );
  check(
    'jobs support drag and drop plus buttons',
    js.includes('function wireJobDrop') &&
      js.includes('draggable = true') &&
      js.includes('job-complete'),
  );
  check(
    'jobs styling covers the board, owners, and outcomes',
    css.includes('.jobs-board') &&
      css.includes('repeat(4, minmax(0, 1fr))') &&
      css.includes('.jobs-column') &&
      css.includes('.job-owner') &&
      css.includes('.job-card.is-failed') &&
      css.includes('.job-outcome.is-success'),
  );

  console.log('\njob auto-fail');

  const failPort = port + 1;
  const failDataFile = path.join(tmpDir, 'jobs-fail.json');
  const overdueStart = new Date(Date.now() - 10 * 60000).toISOString();
  await fs.writeFile(
    failDataFile,
    JSON.stringify({
      settings: { etherFactor: 1, urgencyFactor: 1 },
      profiles: [
        {
          id: 'fail-profile',
          name: 'Fail Tester',
          theme: 'ember',
          createdAt: new Date().toISOString(),
          habits: [],
          retiredEarnings: {},
          retiredPenalties: {},
          jobEarnings: {},
          jobPenalties: {},
          spentEther: 0,
        },
      ],
      jobs: [
        {
          id: 'overdue-job',
          title: 'Overdue seeded job',
          reward: 20,
          etaMinutes: 1,
          status: 'inProgress',
          createdBy: 'fail-profile',
          assignedTo: 'fail-profile',
          createdAt: overdueStart,
          startedAt: overdueStart,
          dueAt: new Date(Date.now() - 9 * 60000).toISOString(),
          completedAt: null,
          failedAt: null,
          multiplier: null,
          payout: null,
        },
      ],
      shop: { items: [] },
      activeProfileId: 'fail-profile',
    }),
  );

  const failChild = spawn(process.execPath, [path.join(root, 'server.js')], {
    env: {
      ...process.env,
      PORT: String(failPort),
      HOST: '127.0.0.1',
      DATA_FILE: failDataFile,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let failLogs = '';
  failChild.stdout.on('data', (data) => (failLogs += data));
  failChild.stderr.on('data', (data) => (failLogs += data));

  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`fail server did not start:\n${failLogs}`)),
      5000,
    );
    failChild.stdout.on('data', () => {
      if (failLogs.includes('listening')) {
        clearTimeout(timer);
        resolve();
      }
    });
  });

  try {
    const failBase = `http://127.0.0.1:${failPort}`;
    const failCall = async (p, options = {}) => {
      const res = await fetch(failBase + p, options);
      const text = await res.text();
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }
      return { status: res.status, body };
    };

    let failResult = await failCall('/api/jobs');
    check(
      'an overdue job fails automatically on startup',
      failResult.body.jobs.failed.some(
        (job) => job.id === 'overdue-job' && job.multiplier === -0.5 && job.payout === -10,
      ),
      JSON.stringify(failResult.body.jobs),
    );

    failResult = await failCall('/api/habits?profile=fail-profile');
    check(
      'a failed job records a penalty',
      failResult.body.ether.penalties === 10 && failResult.body.ether.total === -10,
      JSON.stringify(failResult.body.ether),
    );

    const failDisk = JSON.parse(await fs.readFile(failDataFile, 'utf8'));
    check(
      'the failed job penalty persists',
      failDisk.profiles[0].jobPenalties[TODAY] === 10,
      JSON.stringify(failDisk.profiles[0].jobPenalties),
    );
  } finally {
    failChild.kill('SIGTERM');
    await new Promise((resolve) => failChild.on('exit', resolve));
  }

  console.log('\nrecurring jobs');

  const recPort = port + 4;
  const recDataFile = path.join(tmpDir, 'recurring.json');
  const recProfiles = [
    {
      id: 'rec-a',
      name: 'Rec A',
      theme: 'ember',
      createdAt: new Date().toISOString(),
      habits: [],
      retiredEarnings: {},
      retiredPenalties: {},
      jobEarnings: {},
      jobPenalties: {},
      spentEther: 0,
    },
    {
      id: 'rec-b',
      name: 'Rec B',
      theme: 'teal',
      createdAt: new Date().toISOString(),
      habits: [],
      retiredEarnings: {},
      retiredPenalties: {},
      jobEarnings: {},
      jobPenalties: {},
      spentEther: 0,
    },
  ];
  await fs.writeFile(
    recDataFile,
    JSON.stringify({
      settings: { etherFactor: 1, urgencyFactor: 1 },
      profiles: recProfiles,
      jobs: [],
      recurring: [],
      shop: { items: [] },
      activeProfileId: 'rec-a',
    }),
  );

  async function startServer(serverPort, serverDataFile) {
    const proc = spawn(process.execPath, [path.join(root, 'server.js')], {
      env: {
        ...process.env,
        PORT: String(serverPort),
        HOST: '127.0.0.1',
        DATA_FILE: serverDataFile,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    proc.stdout.on('data', (data) => (output += data));
    proc.stderr.on('data', (data) => (output += data));
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`recurring server did not start:\n${output}`)),
        5000,
      );
      proc.stdout.on('data', () => {
        if (output.includes('listening')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    return proc;
  }

  const recCall = async (p, options = {}) => {
    const res = await fetch(`http://127.0.0.1:${recPort}` + p, options);
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { status: res.status, body };
  };

  let recChild = await startServer(recPort, recDataFile);
  let recTemplateId = null;

  try {
    let recResult = await recCall(
      '/api/jobs',
      { method: 'POST', ...json({ title: 'Water the plants', reward: 20, etaMinutes: 60, days: [todayDow] }) },
    );
    recTemplateId = recResult.body.recurring[0]?.id || null;
    check(
      'a recurring job posts its first occurrence',
      recResult.status === 201 &&
        recResult.body.job.templateId === recTemplateId &&
        recResult.body.jobs.inbox.length === 1 &&
        recResult.body.recurring.length === 1,
      JSON.stringify(recResult.body),
    );
    check(
      'the recurring template keeps its repeat days',
      recResult.body.recurring[0]?.days?.length === 1 &&
        recResult.body.recurring[0].days[0] === todayDow,
      JSON.stringify(recResult.body.recurring),
    );

    recResult = await recCall(
      '/api/jobs',
      { method: 'POST', ...json({ title: 'No days', reward: 5, etaMinutes: 10, days: [] }) },
    );
    check('a recurring job needs at least one day', recResult.status === 400);

    recResult = await recCall(
      '/api/jobs',
      { method: 'POST', ...json({ title: 'Bad day', reward: 5, etaMinutes: 10, days: [9] }) },
    );
    check('a recurring job rejects unknown weekdays', recResult.status === 400);

    recResult = await recCall('/api/jobs');
    const firstOccurrence = recResult.body.jobs.inbox.find(
      (job) => job.templateId === recTemplateId,
    );
    check(
      'the board reports the recurring template',
      recResult.body.recurring.length === 1 && Boolean(firstOccurrence),
      JSON.stringify(recResult.body),
    );

    recResult = await recCall(`/api/jobs/${firstOccurrence.id}`, { method: 'DELETE' });
    check('a recurring occurrence can be deleted from the inbox', recResult.status === 204);

    recResult = await recCall('/api/jobs');
    check(
      'deleting an occurrence skips it without recreating it',
      recResult.body.jobs.inbox.length === 0 &&
        recResult.body.recurring.length === 1,
      JSON.stringify(recResult.body.jobs.inbox),
    );
  } finally {
    recChild.kill('SIGTERM');
    await new Promise((resolve) => recChild.on('exit', resolve));
  }

  // Seed a leftover inbox occurrence from yesterday so the next start settles a
  // missed day: the old card fails at twice the reward and a fresh one posts.
  const recSeeded = JSON.parse(await fs.readFile(recDataFile, 'utf8'));
  recSeeded.recurring[0].lastPostedDate = daysAgo(1);
  recSeeded.jobs = [
    {
      id: 'leftover-occurrence',
      templateId: recSeeded.recurring[0].id,
      title: recSeeded.recurring[0].title,
      reward: 20,
      etaMinutes: 60,
      status: 'inbox',
      createdBy: 'rec-a',
      assignedTo: null,
      createdAt: new Date(Date.now() - 86400000).toISOString(),
      startedAt: null,
      dueAt: null,
      completedAt: null,
      failedAt: null,
      multiplier: null,
      payout: null,
    },
  ];
  await fs.writeFile(recDataFile, JSON.stringify(recSeeded));

  recChild = await startServer(recPort, recDataFile);
  try {
    let recResult = await recCall('/api/jobs');
    const missed = recResult.body.jobs.failed.find((job) => job.id === 'leftover-occurrence');
    check(
      'a leftover inbox card fails on its next scheduled day',
      missed && missed.multiplier === -2 && missed.payout === -40,
      JSON.stringify(recResult.body.jobs.failed),
    );
    const fresh = recResult.body.jobs.inbox.find(
      (job) => job.templateId === recSeeded.recurring[0].id,
    );
    check(
      'a fresh occurrence posts for the new day',
      Boolean(fresh) && fresh.id !== 'leftover-occurrence',
      JSON.stringify(recResult.body.jobs.inbox),
    );

    recResult = await recCall('/api/habits?profile=rec-a');
    const recEtherA = recResult.body.ether;
    recResult = await recCall('/api/habits?profile=rec-b');
    const recEtherB = recResult.body.ether;
    check(
      'the missed penalty is split across profiles',
      recEtherA.penalties === 20 && recEtherB.penalties === 20,
      JSON.stringify({ a: recEtherA.penalties, b: recEtherB.penalties }),
    );

    const recDisk = JSON.parse(await fs.readFile(recDataFile, 'utf8'));
    check(
      'the recurring template and split penalty persist',
      recDisk.recurring.length === 1 &&
        recDisk.recurring[0].lastPostedDate === TODAY &&
        recDisk.profiles.find((p) => p.id === 'rec-a').jobPenalties[TODAY] === 20 &&
        recDisk.profiles.find((p) => p.id === 'rec-b').jobPenalties[TODAY] === 20,
      JSON.stringify(recDisk.recurring),
    );

    recResult = await recCall(`/api/jobs/recurring/${recSeeded.recurring[0].id}`, {
      method: 'DELETE',
    });
    check('a recurring series can be stopped', recResult.status === 204);

    recResult = await recCall('/api/jobs');
    check(
      'stopping a series clears it and its waiting occurrence',
      recResult.body.recurring.length === 0 && recResult.body.jobs.inbox.length === 0,
      JSON.stringify(recResult.body),
    );
  } finally {
    recChild.kill('SIGTERM');
    await new Promise((resolve) => recChild.on('exit', resolve));
  }

  check(
    'recurring frontend renders the toggle, days, and series list',
    html.includes('id="job-recurring"') &&
      html.includes('id="job-recurring-days"') &&
      html.includes('id="jobs-recurring-list"') &&
      js.includes('function buildJobDayPicker') &&
      js.includes('function renderJobRecurring') &&
      js.includes('function deleteRecurring') &&
      js.includes('jobRecurringToggle.checked') &&
      css.includes('.job-day') &&
      css.includes('.jobs-recurring-row') &&
      css.includes('.job-chip-recurring'),
  );

  console.log('\namazon shop lookup');

  let tokenRequests = 0;
  let mockToken = null;
  let mockItem = null;
  const amazonMock = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      let payload = {};
      try {
        payload = body ? JSON.parse(body) : {};
      } catch {
        payload = {};
      }

      if (req.url === '/token') {
        tokenRequests += 1;
        mockToken = { headers: req.headers, payload };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ access_token: 'test-token', expires_in: 3600 }));
        return;
      }

      if (req.url === '/items') {
        mockItem = { headers: req.headers, payload };
        if (payload.itemIds && payload.itemIds[0] === 'B000000000') {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ errors: [{ message: 'boom' }] }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            itemsResult: {
              items: [
                {
                  asin: 'B08N5WRWNW',
                  detailPageURL: 'https://www.amazon.in/dp/B08N5WRWNW',
                  itemInfo: {
                    title: {
                      displayValue: 'Echo Dot (4th Gen) Smart speaker with Alexa - Charcoal',
                    },
                  },
                  images: {
                    primary: {
                      medium: { url: 'https://m.media-amazon.com/images/I/echo.jpg' },
                    },
                  },
                  offersV2: {
                    listings: [
                      {
                        isBuyBoxWinner: false,
                        price: {
                          money: {
                            amount: 4499,
                            currency: 'INR',
                            displayAmount: '₹4,499.00',
                          },
                        },
                      },
                      {
                        isBuyBoxWinner: true,
                        price: {
                          money: {
                            amount: 3999.5,
                            currency: 'INR',
                            displayAmount: '₹3,999.50',
                          },
                        },
                      },
                    ],
                  },
                },
              ],
            },
          }),
        );
        return;
      }

      res.writeHead(404);
      res.end();
    });
  });
  await new Promise((resolve) => amazonMock.listen(0, '127.0.0.1', resolve));
  const amazonMockPort = amazonMock.address().port;

  const lookupPort = port + 2;
  const lookupDataFile = path.join(tmpDir, 'amazon-lookup.json');
  const lookupChild = spawn(process.execPath, [path.join(root, 'server.js')], {
    env: {
      ...process.env,
      PORT: String(lookupPort),
      HOST: '127.0.0.1',
      DATA_FILE: lookupDataFile,
      AMAZON_CREATORS_CLIENT_ID: 'test-client',
      AMAZON_CREATORS_CLIENT_SECRET: 'test-secret',
      AMAZON_PARTNER_TAG: 'grindwell-21',
      AMAZON_MARKETPLACE: 'www.amazon.in',
      AMAZON_CREATORS_TOKEN_URL: `http://127.0.0.1:${amazonMockPort}/token`,
      AMAZON_CREATORS_API_URL: `http://127.0.0.1:${amazonMockPort}/items`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let lookupLogs = '';
  lookupChild.stdout.on('data', (data) => (lookupLogs += data));
  lookupChild.stderr.on('data', (data) => (lookupLogs += data));

  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`lookup server did not start:\n${lookupLogs}`)),
      5000,
    );
    lookupChild.stdout.on('data', () => {
      if (lookupLogs.includes('listening')) {
        clearTimeout(timer);
        resolve();
      }
    });
  });

  try {
    const lookupBase = `http://127.0.0.1:${lookupPort}`;
    const lookupCall = async (p, options = {}) => {
      const res = await fetch(lookupBase + p, options);
      const text = await res.text();
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }
      return { status: res.status, body };
    };

    let lookupResult = await lookupCall('/api/overview');
    check(
      'a configured server advertises Amazon lookup',
      lookupResult.body.lookup && lookupResult.body.lookup.amazon === true,
      JSON.stringify(lookupResult.body.lookup),
    );

    lookupResult = await lookupCall('/api/shop/lookup', {
      method: 'POST',
      ...json({ link: 'https://www.amazon.in/Echo-Dot/dp/B08N5WRWNW/ref=sr_1_1' }),
    });
    check(
      'Amazon lookup fills the name, cost, and image',
      lookupResult.status === 200 &&
        lookupResult.body.item.asin === 'B08N5WRWNW' &&
        lookupResult.body.item.name ===
          'Echo Dot (4th Gen) Smart speaker with Alexa - Charcoal' &&
        lookupResult.body.item.cost === 4000 &&
        lookupResult.body.item.image === 'https://m.media-amazon.com/images/I/echo.jpg' &&
        lookupResult.body.item.price.currency === 'INR',
      `${lookupResult.status} ${JSON.stringify(lookupResult.body)}`,
    );
    check(
      'Amazon token request uses client credentials',
      mockToken &&
        mockToken.payload.grant_type === 'client_credentials' &&
        mockToken.payload.client_id === 'test-client' &&
        mockToken.payload.client_secret === 'test-secret' &&
        mockToken.payload.scope === 'creatorsapi::default',
      JSON.stringify(mockToken && mockToken.payload),
    );
    check(
      'Amazon item request uses the bearer token and marketplace header',
      mockItem &&
        mockItem.headers.authorization === 'Bearer test-token' &&
        mockItem.headers['x-marketplace'] === 'www.amazon.in' &&
        mockItem.payload.itemIdType === 'ASIN' &&
        mockItem.payload.marketplace === 'www.amazon.in' &&
        mockItem.payload.partnerTag === 'grindwell-21' &&
        JSON.stringify(mockItem.payload.itemIds) === JSON.stringify(['B08N5WRWNW']) &&
        mockItem.payload.resources.includes('itemInfo.title') &&
        mockItem.payload.resources.includes('offersV2.listings.price'),
      JSON.stringify(mockItem && { headers: mockItem.headers, payload: mockItem.payload }),
    );

    lookupResult = await lookupCall('/api/shop/lookup', {
      method: 'POST',
      ...json({ link: 'https://www.amazon.in/dp/B08N5WRWNW?tag=other' }),
    });
    check(
      'Amazon tokens are cached between lookups',
      lookupResult.status === 200 && tokenRequests === 1,
      `${lookupResult.status} / ${tokenRequests} token requests`,
    );

    lookupResult = await lookupCall('/api/shop/lookup', {
      method: 'POST',
      ...json({ link: 'https://example.com/dp/B08N5WRWNW' }),
    });
    check(
      'Amazon lookup rejects non-Amazon links',
      lookupResult.status === 400 && /amazon\.in/i.test(lookupResult.body.error),
      `${lookupResult.status} ${JSON.stringify(lookupResult.body)}`,
    );

    lookupResult = await lookupCall('/api/shop/lookup', {
      method: 'POST',
      ...json({ link: 'https://www.amazon.in/dp/B000000000' }),
    });
    check(
      'Amazon API failures are exposed to the form',
      lookupResult.status === 502 && /lookup failed/i.test(lookupResult.body.error),
      `${lookupResult.status} ${JSON.stringify(lookupResult.body)}`,
    );
  } finally {
    lookupChild.kill('SIGTERM');
    await new Promise((resolve) => lookupChild.on('exit', resolve));
    await new Promise((resolve) => {
      amazonMock.close(resolve);
      amazonMock.closeAllConnections?.();
    });
  }

  console.log('\namazon page fallback');

  const fixturePageHtml = `<!doctype html><html><head><title>Amazon.in: Echo Dot</title></head><body>
    <img src="https://m.media-amazon.com/images/I/echo-page.jpg" id="landingImage">
    <span id="productTitle" class="a-size-large">Echo Dot (4th Gen) Smart speaker with Alexa - Charcoal</span>
    <span class="a-price"><span class="a-offscreen">₹4,499.00</span></span>
  </body></html>`;
  let pageRequests = 0;
  const pageMock = http.createServer((req, res) => {
    pageRequests += 1;
    if (req.url === '/dp/B08N5WRWNW') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fixturePageHtml);
      return;
    }
    if (req.url === '/dp/B0BLOCKED0') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<title>Robot Check</title><p>Enter the characters you see below</p>');
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<title>Page Not Found</title>');
  });
  await new Promise((resolve) => pageMock.listen(0, '127.0.0.1', resolve));
  const pageMockPort = pageMock.address().port;

  const pagePort = port + 3;
  const pageDataFile = path.join(tmpDir, 'amazon-page.json');
  const pageEnv = { ...process.env };
  for (const key of Object.keys(pageEnv)) {
    if (key.startsWith('AMAZON_')) delete pageEnv[key];
  }
  const pageChild = spawn(process.execPath, [path.join(root, 'server.js')], {
    env: {
      ...pageEnv,
      PORT: String(pagePort),
      HOST: '127.0.0.1',
      DATA_FILE: pageDataFile,
      AMAZON_PAGE_LOOKUP: 'on',
      AMAZON_PAGE_URL: `http://127.0.0.1:${pageMockPort}`,
      AMAZON_PAGE_MIN_GAP: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let pageLogs = '';
  pageChild.stdout.on('data', (data) => (pageLogs += data));
  pageChild.stderr.on('data', (data) => (pageLogs += data));

  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`page lookup server did not start:\n${pageLogs}`)),
      5000,
    );
    pageChild.stdout.on('data', () => {
      if (pageLogs.includes('listening')) {
        clearTimeout(timer);
        resolve();
      }
    });
  });

  try {
    const pageBase = `http://127.0.0.1:${pagePort}`;
    const pageCall = async (p, options = {}) => {
      const res = await fetch(pageBase + p, options);
      const text = await res.text();
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }
      return { status: res.status, body };
    };

    let pageResult = await pageCall('/api/overview');
    check(
      'without credentials the page reader advertises auto-fill',
      pageResult.body.lookup &&
        pageResult.body.lookup.amazon === true &&
        pageResult.body.lookup.mode === 'page',
      JSON.stringify(pageResult.body.lookup),
    );

    pageResult = await pageCall('/api/shop/lookup', {
      method: 'POST',
      ...json({ link: 'https://www.amazon.in/dp/B08N5WRWNW' }),
    });
    check(
      'the page fallback fills the name, cost, and image',
      pageResult.status === 200 &&
        pageResult.body.item.name === 'Echo Dot (4th Gen) Smart speaker with Alexa - Charcoal' &&
        pageResult.body.item.cost === 4499 &&
        pageResult.body.item.image === 'https://m.media-amazon.com/images/I/echo-page.jpg' &&
        pageResult.body.item.price.display === '₹4,499.00',
      `${pageResult.status} ${JSON.stringify(pageResult.body)}`,
    );

    pageResult = await pageCall('/api/shop/lookup', {
      method: 'POST',
      ...json({ link: 'https://www.amazon.in/gp/product/B08N5WRWNW?th=1' }),
    });
    check(
      'repeated page lookups are cached',
      pageResult.status === 200 && pageRequests === 1,
      `${pageResult.status} / ${pageRequests} page requests`,
    );

    pageResult = await pageCall('/api/shop/lookup', {
      method: 'POST',
      ...json({ link: 'https://www.amazon.in/dp/B0BLOCKED0' }),
    });
    check(
      'a bot check is reported instead of filling junk',
      pageResult.status === 502 && /blocked/i.test(pageResult.body.error),
      `${pageResult.status} ${JSON.stringify(pageResult.body)}`,
    );

    pageResult = await pageCall('/api/shop/lookup', {
      method: 'POST',
      ...json({ link: 'https://www.amazon.in/dp/B000000000' }),
    });
    check(
      'a missing product page is a 404',
      pageResult.status === 404,
      `${pageResult.status} ${JSON.stringify(pageResult.body)}`,
    );

    pageResult = await pageCall('/api/shop/lookup', {
      method: 'POST',
      ...json({ link: 'https://example.com/dp/B08N5WRWNW' }),
    });
    check(
      'the page fallback still rejects non-Amazon links',
      pageResult.status === 400,
      `${pageResult.status} ${JSON.stringify(pageResult.body)}`,
    );
  } finally {
    pageChild.kill('SIGTERM');
    await new Promise((resolve) => pageChild.on('exit', resolve));
    await new Promise((resolve) => {
      pageMock.close(resolve);
      pageMock.closeAllConnections?.();
    });
  }

  console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} check(s) failed`}`);
} finally {
  child.kill('SIGTERM');
  await new Promise((resolve) => child.on('exit', resolve));
  await fs.rm(tmpDir, { recursive: true, force: true });
}

process.exit(failures === 0 ? 0 : 1);

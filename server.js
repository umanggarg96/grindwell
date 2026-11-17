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
// JavaScript weekday numbers: 0 = Sunday ... 6 = Saturday.
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

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

let state = { profiles: [], activeProfileId: null };
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

function toPublic(habit) {
  const completions = Array.isArray(habit.completions) ? habit.completions : [];
  const days = daysOf(habit);
  const today = new Date();
  return {
    id: habit.id,
    name: habit.name,
    createdAt: habit.createdAt,
    difficulty: difficultyOf(habit),
    days,
    dueToday: days.includes(today.getDay()),
    doneToday: completions.includes(dayKey(today)),
    streak: currentStreak(completions, days),
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
  };
}

function normalizeHabit(habit) {
  const days = daysOf(habit);
  const changed =
    !Array.isArray(habit.days) ||
    habit.days.length !== days.length ||
    habit.days.some((day, index) => day !== days[index]);
  return { habit: { ...habit, days }, changed };
}

/* ---------- persistence ---------- */

async function loadState() {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);

    if (parsed && Array.isArray(parsed.profiles) && parsed.profiles.length > 0) {
      let changed = false;
      const profiles = [];

      for (const profile of parsed.profiles) {
        if (!profile || typeof profile.id !== 'string') {
          changed = true;
          continue;
        }

        const habits = (Array.isArray(profile.habits) ? profile.habits : []).map((habit) => {
          const normalized = normalizeHabit(habit);
          if (normalized.changed) changed = true;
          return normalized.habit;
        });
        const theme = THEME_IDS.includes(profile.theme) ? profile.theme : DEFAULT_THEME;
        const name =
          typeof profile.name === 'string' && profile.name.trim() ? profile.name : 'Profile';

        if (theme !== profile.theme || name !== profile.name || !Array.isArray(profile.habits)) {
          changed = true;
        }
        profiles.push({ ...profile, name, theme, habits });
      }

      if (profiles.length === 0) {
        profiles.push(makeProfile('Mine'));
        changed = true;
      }

      const activeProfileId = profiles.some((profile) => profile.id === parsed.activeProfileId)
        ? parsed.activeProfileId
        : profiles[0].id;
      if (activeProfileId !== parsed.activeProfileId) changed = true;

      state = { profiles, activeProfileId };
      if (changed) await saveState();
      return;
    }

    // Old single-profile file: keep its habits inside the first profile.
    const profile = makeProfile('Mine');
    if (parsed && Array.isArray(parsed.habits)) {
      profile.habits = parsed.habits.map((habit) => normalizeHabit(habit).habit);
    }
    state = { profiles: [profile], activeProfileId: profile.id };
    await saveState();
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error(`Could not read ${DATA_FILE}: ${error.message}`);
    }
    if (state.profiles.length === 0) {
      const profile = makeProfile('Mine');
      state = { profiles: [profile], activeProfileId: profile.id };
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

function resolvePublicPath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const relative = decoded === '/' ? 'index.html' : decoded;
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

async function handleApi(req, res, pathname) {
  if (pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, today: dayKey() });
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
      if (state.activeProfileId === profile.id) {
        state.activeProfileId = state.profiles[0].id;
      }
      await saveState();
      res.writeHead(204, { 'Cache-Control': 'no-store' });
      return res.end();
    }

    throw httpError(405, 'Method not allowed.');
  }

  // Every habit route below applies to the currently active profile.
  const profile = activeProfile();

  if (pathname === '/api/habits') {
    if (req.method === 'GET') {
      return sendJson(res, 200, {
        today: dayKey(),
        habits: profile.habits.map(toPublic),
        profile: toPublicProfile(profile),
        profiles: state.profiles.map(toPublicProfile),
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
      };
      profile.habits.push(habit);
      await saveState();
      return sendJson(res, 201, toPublic(habit));
    }

    if (req.method === 'DELETE') {
      profile.habits = [];
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

    if (shouldBeDone) completions.add(today);
    else completions.delete(today);

    habit.completions = [...completions].sort();
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
  const { pathname } = new URL(req.url, 'http://localhost');

  try {
    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname);
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

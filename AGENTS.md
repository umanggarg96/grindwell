# AGENTS.md — grindwell developer guide

This file is for any agent or developer picking up **grindwell**. Read it before changing code.

## What this is

grindwell is a tiny, self-hosted habit tracker. Its one job is to answer “did I do it today?”
for every habit. Completing a habit earns ether; missing a scheduled habit costs it. Ether can be
spent in a shared shop of user-added rewards. It is deliberately small:

- **Zero dependencies.** Only Node.js built-ins and vanilla browser HTML/CSS/JS.
- **No build step.** `public/` is served directly.
- **No database.** One atomic JSON file, `data.json`.
- **No accounts.** Profiles are lightweight names, not authenticated users.
- **Self-hostable.** Designed for a homelab/LAN, Docker, or a reverse proxy.

The project name is always lowercase: **grindwell**.

## Project conventions

These conventions are intentional. Do not undo them without asking.

1. **Do not commit or push unless the person you're working with asks.**
   - No `git commit`, `git push`, force-push, tag, or release unless told.
   - It is fine to inspect `git status` / `git diff`.
2. **Keep it dependency-free.** Do not add npm packages, bundlers, frameworks, CSS libraries, or a
   build step without explicit approval.
3. **Do not add authentication** unless asked. The app is meant for a trusted LAN or a proxy that
   handles auth.
4. **The compact add syntax stays one line:** `name ; difficulty ; urgency ; days-to-skip`.
   - No add-form difficulty or urgency slider, day picker, or “Optional:” hint tooltip. Those were
     removed on purpose.
   - Difficulty, urgency, and schedule editing happen in the inline habit editor, not a modal.
   - The third slot is urgency, not days. Days in the third slot are an error, not a shorthand.
5. **Inline editing only.** Do not reintroduce `<dialog>` or a separate edit page. The habit card
   itself becomes the form.
6. **Rest days are server-enforced.** A habit not scheduled today cannot be marked complete.
   Unchecking is always allowed so old off-day records can be cleaned up.
7. **Themes are per profile.** Palette ids are `ember`, `blue`, `teal`, `violet`. Ember is the
   default. Green and red are reserved for trend-chart bars, so they are not palette ids.
8. **Ether is per profile.** Reward and penalty rates are each a single global setting. Do not add a
   streak bonus unless asked.
9. **Ether history is locked in.** Changing a factor, or a habit's difficulty or urgency, must not
   rewrite already-earned ether or already-recorded penalties. Unchecking removes that day's ether.
   Deleting a habit keeps the ether it already earned and the penalties it already caused; only
   Reset clears them.
10. **Reset is per profile.** It deletes that profile's habits/history/ether/penalties, not the
    profile itself and not other profiles. It must stay available when a profile has history but no
    habits.
11. **Shared pages use the reserved slate chrome.** Dashboard, Shop, and Settings are common pages.
    Their nav/header/page chrome uses `--chrome`, a colour deliberately **not** in the palette
    selector. Dashboard cards and Shop contributor checkboxes still use profile palettes.
12. **The Habits page uses one tab per profile.** Selecting a tab shows that profile's progress,
    add form, list, and reset. All profiles stay reachable from the tab bar; there is no separate
    profile-switcher control.
13. **Keep user data safe.** `data.json` holds user data and is gitignored. Never delete or
    overwrite it without confirmation. Use a temporary `DATA_FILE` for tests.
14. **Keep the UI accessible and mobile-friendly.** Preserve labels, `aria-*` state, keyboard
    focus, and `Esc` behaviour.
15. **Match existing style.** Plain JavaScript with single quotes, semicolons, two-space indent,
    small functions, and comments only where logic is non-obvious.
16. **The Shop is shared.** It lives at top-level `state.shop.items`, starts empty, and any profile
    can add items. Do not scope shop items to a profile.
17. **Ether has a balance, a penalty ledger, and a spend ledger.** A profile's balance is earned
    ether minus recorded penalties minus `spentEther`. Shop purchases reduce the balance; they must
    not rewrite `earnings`. Balances may go negative.
18. **Purchases are shared and proportional.** Every profile contributes to an item unless it is in
    that item's `excludedProfiles`. Split the cost across included profiles with a positive balance
    in proportion to their balances, using whole-number shares that add up to the cost exactly.
19. **Dark/light mode is global, themes are per profile.** The header toggle sets
    `data-appearance` (`dark` or `light`) on `<html>` for the whole app. It must not become another
    profile palette. Profile `data-theme` accents keep working in both modes.

## Architecture at a glance

- Five shared pages, selected client-side from the URL:
  - `/` — **Habits**: a tab per profile with that profile's checklist.
  - `/dashboard` — **Dashboard**: Ether trends and Habit trends sub-pages, each with one themed card per profile.
  - `/jobs` — **Jobs**: a shared four-column Kanban board (Inbox, In progress, Completed, Failed) with a full-width `+` row for posting work.
  - `/shop` — **Shop**: shared reward items, contributor checkboxes, and purchases.
  - `/settings` — **Settings**: global reward and penalty rates, sounds, and profile management.
- The server stores `activeProfileId` so a reload opens the last selected Habits tab. Habit routes
  accept `?profile=<id>`; selecting a tab also activates that profile server-side.
- Missed scheduled days are settled server-side at startup and at the start of every non-health API
  request. There is no cron and no client-side charge; `settleAll()` walks yesterday-and-earlier
  scheduled days and records penalties before the request is handled. `settleJobs()` does the same
  for jobs past twice their ETA, failing them and recording the penalty. `settleRecurringJobs()`
  reposts recurring series and fails any occurrence still waiting in the inbox.
- Jobs are shared like the Shop. A job moves `inbox` → `inProgress` → `completed` or `failed`, and
  payouts feed the same profile balance as habit ether.
- The header toggle switches the whole app between dark and light. The choice lives in the browser,
  not in `data.json`, so no server restart or API change is involved.
- The grindwell mark in the header opens the app icon picker. The selected icon and any custom icons
  are global settings, so they persist across profiles and reloads.
- The server listens on port `3000` by default; override it with `PORT`.
- `data.json` is created on first run and is gitignored.

## Stack and file map

| Path | Purpose |
| --- | --- |
| `server.js` | Zero-dependency `node:http` server, API, persistence, validation. |
| `public/index.html` | Single document with all four page containers, nav, appearance toggle, pre-paint appearance bootstrap, settings and shop forms. |
| `public/app.js` | All client state, API calls, rendering, appearance toggle, inline editor, dashboard, shop, settings. |
| `public/styles.css` | Dark/light appearance variables, theme palettes, reserved slate chrome, layout, responsive styles. |
| `public/habit-input.js` | UMD parser for the compact add syntax; unit-testable in Node. |
| `public/job-math.js` | UMD job multiplier, payout, and duration helpers shared by server, browser, and tests. |
| `public/amazon-link.js` | UMD amazon.in link parser, Creators API item shaping, and product-page reader shared by server, browser, and tests. |
| `test/grindwell.test.mjs` | Integration suite; starts its own server on a temporary data file. |
| `README.md` | User-facing docs. Keep it in sync with behaviour. |
| `package.json` | `npm start` / `npm run dev` / `npm test`; no dependencies. |
| `Dockerfile` | Node 22 Alpine image, data volume at `/data`. |
| `data.json` | Runtime state. **Gitignored. Never commit.** |
| `.gitignore` | Ignores `node_modules/`, `data.json`, `data.json.tmp`, `.DS_Store`. |

## Run, restart, verify

```sh
npm start                 # http://localhost:3000
npm run dev               # auto-restart on file changes
```

Health check:

```sh
curl -s http://localhost:3000/api/health
# {"ok":true,"today":"YYYY-MM-DD"}
```

Restart the server after backend changes. Stop the process you started, then:

```sh
npm start
curl -s --retry 15 --retry-connrefused --retry-delay 1 http://localhost:3000/api/health
```

Use `HOST=127.0.0.1` behind a reverse proxy. `DATA_FILE` can point anywhere:

```sh
PORT=8080 HOST=127.0.0.1 DATA_FILE=./data.json npm start
```

Shop auto-fill is optional and has two paths. With all three Amazon Creators API variables set, the
server uses the official API:

```sh
AMAZON_CREATORS_CLIENT_ID=... AMAZON_CREATORS_CLIENT_SECRET=... AMAZON_PARTNER_TAG=yourtag-21 npm start
```

Without credentials it falls back to reading the public product page with `parseAmazonPage()`. That
path needs no Amazon account, is rate-limited by `AMAZON_PAGE_MIN_GAP` (default 3000 ms), caches
results for ten minutes, and can be turned off with `AMAZON_PAGE_LOOKUP=off`. `AMAZON_PAGE_URL`
(default `https://www.amazon.in`) is the base URL for the fallback and lets tests point it at a local
fixture.

`AMAZON_MARKETPLACE` (default `www.amazon.in`), `AMAZON_CREATORS_TOKEN_URL` (default
`https://api.amazon.co.uk/auth/o2/token`), and `AMAZON_CREATORS_API_URL` (default
`https://creatorsapi.amazon/catalog/v1/getItems`) are overrides for tests or advanced deployments.
Product links are always parsed as amazon.in. `lookup.mode` reports `api`, `page`, or `off`; only
`off` makes `/api/shop/lookup` return `503`.

## Testing

There is no test runner dependency. Syntax checks first:

```sh
node --check server.js
node --check public/app.js
node --check public/habit-input.js
```

The integration suite lives in `test/grindwell.test.mjs` and uses only Node built-ins:

```sh
npm test
# or: node test/grindwell.test.mjs
```

It starts its own server on port **3111** with a temporary `DATA_FILE`, seeds a legacy flat file,
checks migration/API/frontend wiring, and removes its temp files at the end. Set `TEST_PORT` if
3111 is already in use. When you add a feature, add checks to the suite as well.

Quick browser smoke test with any Chromium-based browser:

```sh
CHROME=/path/to/chrome
"$CHROME" --headless=new --disable-gpu --no-first-run --no-default-browser-check \
  --user-data-dir="$(mktemp -d)" --virtual-time-budget=5000 --dump-dom http://localhost:3000/
```

Check `/dashboard`, `/shop`, and `/settings` the same way. The DOM should contain generated profile
tabs, the Ether trends and Habit trends sub-page tabs, dashboard and habit cards, theme pickers, and
shop items. Check both appearances: the toggle must flip `<html data-appearance>` between `dark` and
`light`, update the label and `aria-pressed`, and leave profile accents intact.

## Data model and persistence

`data.json` shape:

```json
{
  "settings": {
    "etherFactor": 1,
    "urgencyFactor": 1,
    "sounds": {
      "habit": "chime",
      "purchase": "pop",
      "custom": [
        {
          "id": "c1a2...",
          "name": "Doorbell",
          "url": "https://example.com/doorbell.mp3"
        }
      ]
    },
    "icon": {
      "id": "flame",
      "custom": []
    }
  },
  "profiles": [
    {
      "id": "9f12...",
      "name": "Mine",
      "theme": "ember",
      "createdAt": "2026-11-17T08:00:00.000Z",
      "retiredEarnings": { "2026-11-15": 4 },
      "retiredPenalties": { "2026-11-14": 3 },
      "jobEarnings": { "2026-11-16": 20 },
      "jobPenalties": { "2026-11-15": 10 },
      "spentEther": 12,
      "habits": [
        {
          "id": "0c9a...",
          "name": "Read 10 pages",
          "createdAt": "2026-11-17T08:00:00.000Z",
          "difficulty": 4,
          "urgency": 3,
          "penaltyFrom": "2026-11-17",
          "days": [1, 2, 3, 4, 5],
          "completions": ["2026-11-16", "2026-11-17"],
          "earnings": { "2026-11-16": 4, "2026-11-17": 4 },
          "penalties": { "2026-11-15": 3 }
        }
      ]
    }
  ],
  "shop": {
    "items": [
      {
        "id": "4b7c...",
        "name": "Coffee",
        "link": "https://example.com/coffee",
        "cost": 20,
        "image": "https://example.com/coffee.jpg",
        "createdAt": "2026-11-17T08:00:00.000Z",
        "excludedProfiles": []
      }
    ]
  },
  "jobs": [
    {
      "id": "7d3e...",
      "title": "Fix the leaking tap",
      "reward": 20,
      "etaMinutes": 60,
      "status": "inProgress",
      "createdBy": "9f12...",
      "assignedTo": "9f12...",
      "createdAt": "2026-11-17T08:00:00.000Z",
      "startedAt": "2026-11-17T09:00:00.000Z",
      "dueAt": "2026-11-17T10:00:00.000Z",
      "completedAt": null,
      "failedAt": null,
      "multiplier": null,
      "payout": null
    }
  ],
  "activeProfileId": "9f12..."
}
```

Key rules:

- Weekdays are JavaScript numbers: **0 = Sunday … 6 = Saturday**.
- Every habit, shop item, and job carries a whole-number `order` for drag-only manual sorting.
  Legacy cards get sequential orders from their array position on first load. Habits and shop items
  sort ascending; jobs sort descending so the first id in a reorder request sits on top of its column.
  Reordering is scoped to one habit profile, one shop section, or one job column.
- `days` means **scheduled** days, not skipped days. All seven means daily.
- `completions`, `earnings`, and `penalties` keys are local calendar dates `YYYY-MM-DD`.
- `earnings[date]` is the ether locked in when that completion was recorded.
- `penalties[date]` is the ether locked in for a missed scheduled day. `penaltyFrom` is the first
  date a habit can be charged for a miss; it starts on the creation day and resets to today after an
  urgency or schedule edit. Settlement never charges today, rest days, or completed days.
- `retiredEarnings[date]` keeps ether earned by habits that were later deleted, and
  `retiredPenalties[date]` keeps penalties those habits caused, so deleting a habit never changes
  either total. Both are included in `ether` and `summary`, and Reset clears them.
- `spentEther` is the running total spent in the Shop. Balance is `earnedEther(profile) -
  penaltyEther(profile) - spentEther`. It may be negative. It is only cleared by Reset.
- `shop.items` is shared. `excludedProfiles` lists profile ids that do not contribute to that item;
  an empty list means every profile contributes.
- `jobs` is shared. Status is one of `inbox`, `inProgress`, `completed`, or `failed`. `reward` is an
  integer 1–1000 and `etaMinutes` an integer 1–10080. `startedAt` and `dueAt` are set when a job is
  taken; `completedAt` or `failedAt` is set when it finishes. `multiplier` and `payout` are the
  locked-in outcome, with `payout` negative for a failure. `templateId` links a card to the recurring
  series that posted it, and is `null` for a one-off job.
- `recurring` holds shared repeat templates: `{ id, title, reward, etaMinutes, days[], createdBy,
  createdAt, lastPostedDate }`. `days` is a non-empty list of weekdays `0`–`6`. `lastPostedDate` is
  the last day the series posted, so a deleted inbox card is not recreated the same day.
- `jobEarnings[date]` and `jobPenalties[date]` hold job payouts and failure penalties on the day they
  finished. They are included in `ether`, `earned`, `penalties`, and `summary`, and Reset clears them.
- The API returns only the newest `TERMINAL_JOBS_SHOWN` (10) completed and 10 failed jobs. Older
  finished jobs stay in `data.json` as history. Deleting a profile returns its in-progress jobs to the
  inbox but leaves finished jobs in place with a now-missing assignee.
- `shop.items[].consumable` defaults to `false`. A one-time item stores `purchasedAt` after its first
  purchase; consumable items keep it `null`. Older items normalize to `consumable: false` and
  `purchasedAt: null`.
- Legacy files with a top-level `habits` array migrate into a profile named **Mine**.
- Older completions without earnings are backfilled using the current factor and difficulty.
- Habits saved before urgency existed migrate to urgency `0` and `penaltyFrom` at their creation
  day, so they never collect retroactive penalties. New habits default to urgency `1`.
- Writes are serialized through `saveChain` and are atomic: write `data.json.tmp`, then rename.
- `normalizeHabit` repairs/migrates habit fields on startup; `normalizeShop` drops invalid items and
  removes exclusions for profiles that no longer exist.
- The last profile cannot be deleted. Deleting the active profile falls back to the first remaining.
- A new profile starts empty with the requested theme (default `ember`) and becomes active.

## API

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/health` | `{ ok, today }` |
| `GET` | `/api/overview` | `{ today, settings, activeProfileId, profiles[], shop, lookup }`; each profile has `summary` and `habits` |
| `GET` | `/api/profiles` | `{ profiles[], activeProfileId }` |
| `POST` | `/api/profiles` | `{ name, theme? }`; creates and activates |
| `PATCH` | `/api/profiles/:id` | any of `name`, `theme` |
| `POST` | `/api/profiles/:id/activate` | legacy/API compatibility |
| `DELETE` | `/api/profiles/:id` | `204`; last profile is rejected |
| `GET` | `/api/settings` | `{ etherFactor, urgencyFactor, sounds, icon }` |
| `PATCH` | `/api/settings` | any of `etherFactor` (`0.1`–`10`), `urgencyFactor` (`0.1`–`10`), `sounds: { habit?, purchase? }`, `icon: { id }` |
| `POST` | `/api/settings/sounds` | `{ name, url }`; adds a custom sound |
| `DELETE` | `/api/settings/sounds/:id` | `200`; falls back if the sound was selected |
| `POST` | `/api/settings/icons` | `{ name, url }`; adds and selects a custom icon, returns `{ icon, settings }` |
| `DELETE` | `/api/settings/icons/:id` | `200`; falls back if the icon was selected |
| `GET` | `/api/shop` | `{ items[], profiles[], lookup }` |
| `POST` | `/api/shop/lookup` | `{ link }`; resolves an amazon.in product through the Creators API |
| `POST` | `/api/shop/items` | `{ name, link, cost, image?, excludedProfiles? }` |
| `PATCH` | `/api/shop/items/:id` | any of `name`, `link`, `cost`, `image`, `excludedProfiles` |
| `DELETE` | `/api/shop/items/:id` | `204` |
| `POST` | `/api/shop/items/:id/buy` | splits the cost and returns `{ item, contributions[], profiles[] }` |
| `POST` | `/api/shop/items/reorder` | `{ ids[] }`; saves the manual order of all shop items |
| `GET` | `/api/jobs` | `{ today, now, activeProfileId, profiles[], jobs, limits }` |
| `POST` | `/api/jobs` | `{ title, reward, etaMinutes }`; adds to the inbox |
| `POST` | `/api/jobs/reorder` | `{ ids[] }`; saves the manual order of those jobs (first id ends up on top) |
| `POST` | `/api/jobs/:id/take` | accepts `?profile=<id>`; enforces the in-progress limit |
| `POST` | `/api/jobs/:id/complete` | scores elapsed time, records the payout, returns `{ job, jobs, profiles[] }` |
| `DELETE` | `/api/jobs/:id` | `204`; inbox jobs only |
| `GET` | `/api/habits` | active profile by default; accepts `?profile=<id>` |
| `POST` | `/api/habits` | `{ name, difficulty?, urgency?, days? }`; accepts `?profile=<id>` |
| `POST` | `/api/habits/reorder` | `{ ids[] }`; saves the manual order of that profile's habits; accepts `?profile=<id>` |
| `PATCH` | `/api/habits/:id` | any of `name`, `difficulty`, `urgency`, `days`; accepts `?profile=<id>` |
| `DELETE` | `/api/habits` | wipes the selected profile's habits, ether, penalties, and spend ledger; accepts `?profile=<id>` |
| `POST` | `/api/habits/:id/toggle` | `{ done?: boolean }`; accepts `?profile=<id>` |
| `DELETE` | `/api/habits/:id` | accepts `?profile=<id>` |

Details:

- Unknown `?profile=` id returns `404`.
- `GET /api/overview` is what the frontend loads. It returns
  `{ today, settings, activeProfileId, profiles[], shop, lookup }`; each profile entry is
  `{ id, name, theme, habitCount, ether, earned, penalties, spent, summary, habits }`.
  `lookup` is `{ amazon: boolean, mode: 'api' | 'page' | 'off' }` and reports which Shop auto-fill
  path is active.
- `summary` is
  `{ factor, total, earned, penalties, spent, today, last7, last30, penaltyToday, penaltyLast7,
  penaltyLast30, netToday, netLast7, netLast30, completedToday, completedLast7, completedLast30,
  missedLast7, missedLast30, days: [{ date, ether, penalty, net, completed, missed } × 30] }`.
  `total` is the current balance; `today`, `last7`, `last30`, and `days[].ether` count earned ether;
  the `penalty*` fields and `days[].penalty` count lost ether; the `net*` fields and `days[].net` are
  earned minus lost; the `completed*` fields and `days[].completed` count habit completions, while
  `missedLast7`, `missedLast30`, and `days[].missed` count scheduled days before today with no
  completion, for the per-profile Habit trends cards. Today is never counted as missed.
- A public habit is `{ id, name, createdAt, difficulty, urgency, days, dueToday, doneToday, streak,
  reward, penalty, earnedToday }`.
- A public shop item is
  `{ id, name, link, cost, image, createdAt, consumable, purchasedAt, excludedProfiles }`.
- `settings.sounds` is `{ habit, purchase, custom[] }`. Built-in ids are `chime`, `sparkle`, `pop`,
  `bell`, and `off`; custom sounds are `{ id, name, url }` with an `http(s)` URL. Custom sounds are
  limited to `MAX_CUSTOM_SOUNDS`. Deleting a selected custom sound resets that slot to its default.
- `settings.icon` is `{ id, custom[] }`. Built-in ids are `flame`, `spark`, `bolt`, `moon`, `gem`,
  and `heart`; custom icons are `{ id, name, url }` with an `http(s)` image URL, limited to
  `MAX_CUSTOM_ICONS`. Adding a custom icon selects it; deleting a selected one falls back to
  `flame`.
- `POST /api/habits` defaults `difficulty` to `5`, `urgency` to `1`, and `days` to all seven.
- `difficulty` must be an integer 1–10; `urgency` must be an integer 0–10. `days` must be a non-empty
  array of unique integers 0–6.
- Changing `urgency` or `days` restarts the habit's `penaltyFrom` at today. Settlement runs before
  the request, so past misses keep the amount they were already charged.
- Toggling a rest day on returns `400`; toggling it off is allowed.
- `toggle` with no body flips today's state; send `done` explicitly from the UI.
- Shop `link` and `image` must be `http(s)` URLs; `cost` is an integer 1–`MAX_ITEM_COST`. `consumable`
  defaults to `false`; a non-consumable item is marked with `purchasedAt` after its first purchase
  and rejects another with `400`. Buying with too little ether returns `400`. Deleting a profile also
  removes it from every item's exclusions.
- `POST /api/shop/lookup` resolves an amazon.in product through the Creators API when credentials
  exist, otherwise through the product-page fallback. It returns
  `{ item: { asin, name, cost, image, price, detailPageURL } }`; `cost` is the rounded whole-number
  price (`null` when the page shows none) and `price` is `{ amount, currency, display }`. It returns
  `503` only when both paths are off, `400` for links that are not amazon.in product pages, `404`
  when the product cannot be read, and `502` with an exposed message when Amazon blocks or fails.
  Token, API, and page requests time out after ten seconds. The access token is cached until shortly
  before it expires, and page results are cached for ten minutes behind a minimum request gap.
- `/dashboard`, `/jobs`, `/shop`, and `/settings` serve the same HTML document as `/`; the client
  picks the view from `window.location.pathname`. `APP_ROUTES` in `server.js` controls the clean URLs.
- Job routes are shared, not profile-scoped except that `take` reads `?profile=<id>` (or the active
  profile). The server enforces `MAX_JOBS_IN_PROGRESS` (3), caps stored jobs at `MAX_JOBS`, and
  rejects unknown statuses. A job past twice its ETA is failed by `settleJobs()` before the request is
  handled; completing an already-failed job returns `409`. Only `inbox` jobs can be deleted.
  `POST /api/jobs` with a non-empty `days` array creates a series in `recurring` and posts its first
  card; `DELETE /api/jobs/recurring/:id` stops the series and clears its waiting inbox card.

## Frontend architecture

`public/app.js` is a single vanilla script. There is no framework and no build step.

- `els` caches DOM nodes.
- State: `profiles` (from `/api/overview`), `settings`, `shop`, `lookup`, `jobs`, `jobLimits`,
  `jobActorId`, `jobNow`, `today`, `activeTabId`, `editingKey`, `editDraft`, `dashboardRange`
  (`'week'` or `'month'`, persisted in `localStorage`), `dashboardView` (`'ether'` or `'habit'`,
  persisted in `localStorage`), and `appearance` (`'dark'` or `'light'`, persisted in
  `localStorage`).
- The appearance bootstrap in `public/index.html` sets `data-appearance` before paint so light mode
  does not flash dark. It reads `localStorage` first, then falls back to `prefers-color-scheme`.
- `applyAppearance(next, { persist })` sets `data-appearance`, updates the toggle's label,
  `aria-pressed`, `title`, and `aria-label`, and updates `<meta name="theme-color">`.
  `rememberAppearance` writes the `grindwell.appearance` key; storage failures are ignored.
- `load()` fetches `/api/overview` and calls:
  - `renderProfileSettings()` — profile rows on Settings, including theme pickers.
  - `renderHabits()` — the profile tab bar plus the selected profile's checklist.
  - `renderDashboard()` — combined balances, one `.dashboard-card` per profile on the Ether trends
    sub-page, and one `.habit-card` per profile on the Habit trends sub-page.
  - `renderShop()` — shop balance, the Consumables and Rewards sections, item cards and tiles,
    progress bars, and contributor checkboxes.
  - `renderSettings()` — ether and urgency factor fields, sound pickers, and the app icon picker.
- `wireReorder(container, { onReorder, accepts })` is the shared drag handler for habit lists, shop
  `.shop-list`/`.shop-grid` sections, and each job column. Cards are direct children with `data-id`;
  `accepts` keeps a drag inside one habit group or one job column. `reorderCards()` posts `{ ids }`
  and reloads. There are no handles or move buttons. CSS `drop-before`/`drop-after` show the target.
- `renderSounds()` fills the habit and purchase sound pickers from `SOUND_PRESETS` plus
  `settings.sounds.custom`, renders each custom sound with preview/remove buttons, and hides the
  list when there are none. `saveSoundChoice()`, `addSound()`, and `deleteSound()` persist changes
  through `/api/settings` and `/api/settings/sounds`.
- `ICON_PRESETS` mirrors the server's icon allowlist. `renderAppIcon()` swaps the header mark and the
  `<link rel="icon">`; `renderIconPanel()` builds the preset/custom tile grid and the custom icon
  list. `setIconPanelOpen(open)` toggles `#icon-panel`, keeps `aria-expanded` in sync, and moves
  focus to the first tile or back to the mark. `selectIcon()`, `addIcon()`, and `deleteIcon()` persist
  changes through `/api/settings` and `/api/settings/icons`. `Esc`, the close button, and an outside
  click close the panel.
- `renderProfileTabs(current)` builds `role="tab"` buttons, one per profile, each carrying that
  profile's `data-theme`. Arrow keys, Home, and End move between tabs.
- `selectProfileTab(id)` updates `activeTabId`, clears any inline edit, re-renders, and activates
  the profile server-side so a reload returns to the same tab.
- `profileSection(profile)` builds the selected profile's header, progress, add form, habit list,
  empty state, and reset button. It is a `role="tabpanel"` and sets
  `section.dataset.theme = profile.theme`.
- `habitNode(profile, habit)` builds the check button, meta chips, edit button, delete button.
  Difficulty is rendered with `starRating(habit.difficulty)` as 0.5–5 stars. A habit with urgency
  above zero shows missed damage with `damageHearts(habit.urgency)` as 0.5–5 hearts (urgency / 2, in
  the danger colour). Do not add a reward chip back to the card. Toggles are optimistic; the server
  response is authoritative. Checking a habit plays a short chime through `playHabitSound()`.
- `editFormNode(profile, habit)` renders the inline editor, including difficulty and urgency range
  inputs. `editingKey` is `${profileId}:${habitId}`. `Esc` closes the editor.
- `dashboardCard(profile)` sets `card.dataset.theme = profile.theme` and uses `profile.summary`. The
  headline number is `summary.earned` (lifetime ether earned, including ether already spent); the
  combined dashboard total is the current balance. `rangeDays()`, `rangeNet()`, and `rangePenalty()`
  slice the 30-day summary by `dashboardRange`. Each card shows net today, net over the range, and
  the range's penalties.
- `etherChartNode(days, profileName)` plots `days[].net`. When any day is negative the chart gets
  `.has-negative`, a zero line, and bars grow up or down from the middle; negative bars use
  `.ether-bar.is-negative`.
- `habitTrendCard(profile)` renders one per-profile Habit trends card. It sets
  `card.dataset.theme = profile.theme` and uses `rangeDays()`, `rangeCompletions()`, and
  `rangeMissed()` to count `summary.days[].completed` and `summary.days[].missed` for that profile
  only, then renders `completionChart(days, profile.name)`. The chart shares one scale and grows
  completed bars up from a midline and missed bars down. There is no merged cross-profile graph.
- `#dashboard-tabs` switches `dashboardView` between the `#dashboard-panel-ether` and
  `#dashboard-panel-habits` tabpanels. `applyDashboardView()`, `setDashboardView()`, and
  `onDashboardTabKeydown()` keep `aria-selected`, `tabindex`, hidden panels, and arrow/Home/End key
  movement in sync. The choice is stored under `grindwell.dashboardView`.
- The Dashboard's `#dashboard-range` select switches `dashboardRange` and re-renders both sub-pages
  without a reload.
- `shopItemCard(item)` renders a reward as a wide card: image on the left, the name as a large link
  to the item page, and a side group holding the buy button and remove button in the same row. Then
  come the progress bar and one contributor checkbox per profile. Each checkbox label carries
  `data-theme` so it uses that profile's palette; unchecking adds the profile to
  `item.excludedProfiles`.
- `shopTileCard(item)` renders a consumable as a compact square tile. The media area sits on top with
  an overlaid remove button; the body holds the name, progress bar, contributor chips with each
  profile's share, and a full-width buy button. The tile hides `.shop-bar-legend` because the chips
  carry the same amounts.
- `itemPurchased(item)` is true only for a non-consumable item with `purchasedAt`. Those cards get
  `.is-purchased`, a **Purchased** note instead of the progress bar, a disabled **Bought** button,
  and locked contributor checkboxes. `shopSection()` splits `renderShop()` into **Consumables**
  (`.shop-grid`, `shopTileCard`) and **Rewards** (`.shop-list`, `shopItemCard`), in that order.
- `etherIcon()` builds an inline `<use>` reference to the `#icon-ether` sparkle sprite in
  `public/index.html`, so balances, costs, and the buy button all share one currency icon.
- `itemAvailable(item)` sums the balances of included profiles with a positive balance.
  `shopContributorShares(item)` splits the cost the same way the server does, so the colour-coded
  progress segments and legend match the purchase charges. `buyShopItem` posts to
  `/api/shop/items/:id/buy` and reloads; it buys immediately with no confirmation dialog and calls
  `playPurchaseSound()` on success. `playPurchaseSound()` and `playHabitSound()` resolve the
  configured id through `playSound()`: built-in presets use `playChime()` (Web Audio synthesis) and
  custom sounds use `playAudioUrl()` with a cached `HTMLAudioElement`. `addShopItem` and
  `deleteShopItem` manage items.
- `renderJobs()` fills the four Jobs columns. It calls `renderJobActor()` to build the **Acting as**
  selector, renders the inbox, in-progress, and terminal lists with `jobCard()`, and calls
  `renderJobLegend()` to show each profile's `used/3` in-progress count under the In progress heading.
  In-progress cards carry their claimer's `data-theme` and use `jobOwnerNode()` for a themed dot and
  name, so one column shows who holds each task. `jobCard()` shows the reward, ETA, poster or claimer,
  remaining time, and outcome chips. Inbox cards and in-progress cards are draggable; `wireJobDrop()`
  lets an inbox card be dropped on the In progress column (take as the acting profile) or an
  in-progress card on the Completed column (complete). `takeJob()`, `completeJob()`, `deleteJob()`,
  and `addJob()` post to the job API and re-render from the returned board. `loadJobs()` fetches
  `/api/jobs`; the page polls `refreshJobsQuietly()` every ten seconds while visible so claims appear
  live. Job multipliers, payouts, and duration formatting come from `public/job-math.js` (`JobMath`).
- The Jobs add form starts collapsed behind the full-width `#jobs-add-toggle` (`+`).
  `setJobFormOpen(open)` hides the toggle, reveals `#job-form`, keeps `aria-expanded` in sync, and
  focuses the title field or the toggle. `Esc`, the close button, and a successful post collapse it
  again.
- `#job-recurring` is the **Auto recurring** checkbox and `#job-recurring-days` holds the weekday
  picker built by `buildJobDayPicker()`. `syncRecurringField()` reveals the picker only while the box
  is ticked; `selectedJobDays()` reads the pressed buttons and `clearJobDays()` resets them.
  `addJob()` sends `days` only when the box is ticked. `jobRecurringChip()` adds a `↻ Mon, Wed` chip
  to any card with a `templateId`, and `renderJobRecurring()` fills the `#jobs-recurring-list` panel
  under the board from `jobRecurring`. `deleteRecurring()` stops a series; `deleteJob()` explains
  that removing a recurring card skips only that occurrence.
- The shop add form starts collapsed behind `#shop-add-toggle`. `setShopFormOpen(open)` hides the
  toggle, reveals `#shop-form`, keeps `aria-expanded` in sync, and focuses the name field or the
  toggle. `Esc`, the close button, and a successful add collapse it again.
- `public/amazon-link.js` (`AmazonLink`) provides `parseAmazonLink`, `shortItemName`,
  `priceToCost`, `shapeAmazonItem`, `parseAmazonPage`, and `isAmazonBlockPage`.
  `syncShopLookup()` enables the **Fetch details** button only for a valid amazon.in link when
  `lookup.amazon` is true; `scheduleShopLookup()` debounces automatic lookup, and `lookupShopLink()`
  posts to `/api/shop/lookup` and fills the name, cost, and image. When `lookup.mode` is `page` the
  success message says the values were read from the page and asks the user to check the price.
  Lookup failures leave every field editable and put the message in `#shop-lookup-status`.
- `shopBookmarkletHref()` builds a `javascript:` bookmarklet from `window.location.origin`, so the
  same code works on any host or port. The link is draggable, not clickable: clicking it only shows a
  toast telling the user to drag it to the bookmarks bar. `applyShopImport()` reads
  `/shop?add=1&link=…&name=…&cost=…&image=…`, opens the add form, fills only valid values, and then
  calls `history.replaceState` to drop the query string. It never submits, and the server still
  validates everything on add.
- `themePicker(profile)` builds the four colour dots; each swatch also gets `data-theme` so its dot
  previews that palette.
- API helpers append `?profile=<id>` via `profileQuery(profile)`.
- Profile add/rename/delete currently use `window.prompt` / `window.confirm`, matching the existing
  lightweight style.
- Keep `aria-pressed`, `aria-label`, `aria-valuenow`, `role`, and focus management intact.

## Styling and themes

- Palette blocks in `public/styles.css` look like `[data-theme="blue"] { --accent: …; … }`.
- A profile section or dashboard card with `data-theme` inherits that palette for its content.
- Global appearance lives in `[data-appearance="light"] { … }`, which flips neutral surfaces and
  shared chrome. `:root` holds the dark defaults, and `color-scheme` switches with the mode.
- Use the neutral variables (`--bg`, `--surface`, `--surface-raised`, `--border`, `--text`,
  `--muted`, `--faint`, `--placeholder`, `--tint-rgb`, `--danger-rgb`, etc.) instead of hardcoded
  dark colours or white overlays. Tests reject `rgba(255, 255, 255, …)`.
- Each palette exposes `--accent-text`, `--accent-focus`, and `--accent-deep`. Dark mode uses the
  bright shade for accent text and focus; light mode overrides those with `--accent-deep` for
  contrast. Filled controls and gradients keep the bright shade in both modes.
- `.ether-icon` is a `currentColor` sparkle. Dashboard cards tint it with `--accent-text`; shared
  totals and the Shop use `--chrome-bright`, so no palette colour leaks into shared chrome.
- Shop progress segments and their legend dots carry each contributor's `data-theme` and use
  `var(--accent)`. This is the intentional exception to the reserved chrome on shared pages.
- Trend charts are the exception to palette accents: `.ether-bar` and the Habit trends bars use
  `--graph-up`/`--graph-up-bright` (green) and `--graph-down`/`--graph-down-bright` (red) in both
  appearances, so gains and misses read the same regardless of a profile's theme.
- Shared chrome uses reserved slate variables defined in `:root` and overridden for light mode:
  - `--chrome`, `--chrome-bright`, `--chrome-rgb`, `--chrome-bright-rgb`, `--on-chrome`.
  - These are intentionally **not** palette ids and must not be added to the selector.
- `body[data-page="dashboard"]`, `body[data-page="settings"]`, and `body[data-page="shop"]` use a
  slate background glow.
- Nav, page titles, dashboard totals, Shop controls, and Settings controls must not use `--accent`;
  tests enforce this. Contributor checkboxes are the exception: their labels carry a profile's
  `data-theme` so the checkbox and dot use that profile's palette.
- The Dashboard's sub-page tab bar is shared chrome: use `--chrome*` variables for its selected tab,
  border, and focus ring. The per-profile cards inside both sub-pages still use each profile's theme.
- The Jobs page columns, counts, add row, form controls, and terminal history use `--chrome*` for
  shared chrome. The `+` row spans the full board width, and the four columns are equal at
  `repeat(4, minmax(0, 1fr))`, dropping to two columns under 1100px and one under 720px. In-progress
  cards and legend chips carry `data-theme` so the owner dot, name, and drop highlight use that
  profile's palette. Success and failure chips use the reserved `--graph-up`/`--graph-down` colours,
  not palette accents. The recurring weekday picker (`.job-days`/`.job-day`) also uses `--chrome*`,
  and the `↻` chip (`.job-chip-recurring`) is reserved chrome too.
- The header mark and icon picker are shared chrome. Use `--chrome*` variables for selected tiles,
  focus rings, and the panel border; do not tint them with a profile palette.
- Keep `THEMES` in `public/app.js`, the `[data-theme]` blocks in `public/styles.css`, and
  `THEME_IDS` in `server.js` in the same order.
- Preserve mobile layout (`max-width: 420px`) and `prefers-reduced-motion` handling.

## Habit input parser

`public/habit-input.js` is UMD: browser global `window.HabitInput`, Node `module.exports`.

Input: `name ; difficulty ; urgency ; days-to-skip`

- `name` is required, trimmed, and whitespace-collapsed; max 60 characters.
- `difficulty` is an optional integer 1–10; defaults to 5.
- `urgency` is an optional integer 0–10; defaults to 1. `0` disables penalties.
- The fourth part lists **days to skip**, not scheduled days.
- Day aliases accept 2/3-letter and full names, case-insensitive: `su`, `sun`, `sunday`, `mo`,
  `mon`, `monday`, etc. Commas and/or spaces separate tokens.
- No skip list means all seven days.
- The third slot is strictly urgency. `name ; sat,sun` is an error, not shorthand for days; days
  belong in the fourth slot (`name ; 5 ; 1 ; sat,sun`).
- At most three semicolons.
- Error strings are asserted by tests:
  - `Unknown day "..."...`
  - `A habit needs at least one day. Do not skip all seven.`
  - `Difficulty must be a whole number from 1 to 10.`
  - `Urgency must be a whole number from 0 to 10.`

## Domain rules

### Habits and streaks

- Progress counts only habits with `dueToday === true`.
- Rest-day habits remain visible at the bottom of the list, marked **Rest day**, with the check
  disabled.
- Streaks walk backwards over scheduled days only. Unscheduled days are skips, not misses.
- Today does not break a streak until the day is over.
- Editing a schedule keeps past completions; the streak is recalculated.
- Deleting a habit removes its schedule and streak history but keeps the ether it already earned in
  `profile.retiredEarnings` and the penalties it caused in `profile.retiredPenalties`.
- Difficulty is stored as 1–10 and shown as stars: `difficulty / 2` out of 5, so 1 is a half star
  and 10 is five stars. Urgency is stored as 0–10 and shown as a `−N if missed` chip when above 0.

### Ether

Reward formula:

```text
earned = max(1, round(difficulty × etherFactor))
```

Penalty formula:

```text
lost = max(1, round(urgency × urgencyFactor))
```

- One global `settings.etherFactor`, default `1`, allowed `0.1`–`10`.
- One global `settings.urgencyFactor`, default `1`, allowed `0.1`–`10`.
- The `max(1, …)` floors mean every completion earns at least 1 ether and every missed day costs at
  least 1.
- No streak bonus.
- Rewards are stored in `earnings[date]` when the habit is completed, so later factor or difficulty
  changes only affect future completions.
- Penalties are stored in `penalties[date]` when a scheduled day is settled, so later factor or
  urgency changes only affect future misses. Settlement runs at startup and before every non-health
  API request, walks from `penaltyFrom` through yesterday, and skips rest days, completed days, and
  days that already have a penalty. Today is never charged. Changing urgency or the schedule resets
  `penaltyFrom` to today.
- Unchecking deletes that day's earning.
- Ether is per profile. Balance is `earned - penalties - spent`, where `earned` includes `earnings`
  and `retiredEarnings`, `penalties` includes `penalties` and `retiredPenalties`, and `spent` is
  `spentEther`. Balances may be negative; the Shop only charges profiles with a positive balance.
- The dashboard shows a combined balance plus one card per profile. The combined total is the current
  balance; each card's headline is lifetime ether earned (`summary.earned`), while its today and range
  values are net (`netToday`, `netLast7`, `netLast30`) and it also shows range penalties.
- The Dashboard has separate **Ether trends** and **Habit trends** sub-pages. Ether trends holds the
  combined balance and per-profile ether cards; Habit trends holds one card per profile with diverging
  bars: completed habits grow up, missed scheduled habits grow down. A day only counts as missed once
  it has ended, so today is never missed. There is no merged habit graph.
- Both sub-pages follow the same weekly/monthly range selector (last 7 or last 30 days), and each
  profile card is tinted with that profile's theme.

### Sounds

- Sounds are global settings, not per profile.
- Built-in ids are `chime`, `sparkle`, `pop`, `bell`, and `off`. They are synthesised in the browser,
  so there are no audio assets.
- `settings.sounds.custom` holds `{ id, name, url }` entries. URLs must be `http(s)`, names are
  capped at `MAX_NAME_LENGTH`, and the list is capped at `MAX_CUSTOM_SOUNDS`.
- Habit completion plays `settings.sounds.habit`; Shop purchases play `settings.sounds.purchase`.
- Deleting a custom sound that is selected resets that slot to its built-in default.
- Custom audio is fetched by the browser, so an unreachable URL simply fails silently.

### App icon

- The app icon is a global setting, not per profile.
- Built-in ids are `flame` (default), `spark`, `bolt`, `moon`, `gem`, and `heart`. They are inline SVG
  paths in `ICON_PRESETS` and render as `currentColor` in the header.
- `settings.icon.custom` holds `{ id, name, url }` entries. URLs must be `http(s)`, names are capped
  at `MAX_NAME_LENGTH`, and the list is capped at `MAX_CUSTOM_ICONS`.
- Adding a custom icon selects it immediately; deleting the selected custom icon falls back to
  `flame`. The header mark and the browser tab icon both follow the selection.
- The picker is inline in the header, not a `<dialog>`. Keep `aria-expanded`, focus handling, `Esc`,
  the close button, and outside-click dismissal working.
- Custom images are fetched by the browser, so an unreachable URL simply shows the fallback art.

### Shop

- Shop items are shared by every profile and start empty.
- Each item has `name`, `link`, `cost`, optional `image`, `consumable`, `purchasedAt`, and
  `excludedProfiles`.
- `consumable` defaults to `false`. A one-time item can be bought once, then its `purchasedAt` is set
  and further purchases return `400`. Consumable items stay buyable and keep `purchasedAt` null.
- The Shop renders **Consumables** first as a three-column square-tile grid (two columns on narrow
  screens) and **Rewards** below as wider cards; bought reward cards grey out.
- Every profile with a positive balance contributes to an item unless it is excluded.
- `purchaseShopItem(item)` filters exclusions, computes each contributor's proportional share, and
  uses largest remainders so the integer shares add up to `cost` exactly.
- A purchase increments each contributor's `spentEther`; it never changes `earnings`.
- Items remain after purchase, so repeat purchases are allowed while balances last.
- Reset clears `spentEther` along with habits, `retiredEarnings`, and `retiredPenalties`.
- Deleting a profile removes its id from every item's `excludedProfiles`.
- Amazon auto-fill has two paths. Creators API credentials are exact and take priority. Without them
  the server reads the public product page (`parseAmazonPage`), which needs no account but is
  best-effort: prices can be missing, markup can change, and Amazon can answer with a bot check. It
  is rate-limited, cached for ten minutes, and disabled by `AMAZON_PAGE_LOOKUP=off`.
- Auto-fill is only a convenience. The add form always stays editable, and a lookup never creates an
  item by itself. The bookmarklet prefill is untrusted input and must be validated on add.
- Do not add a scraping library or a third-party product API without asking; the fallback is plain
  `fetch` plus regex on purpose.

### Jobs

- The board is shared by every profile, like the Shop. Any profile can post a job; any profile can
  claim it.
- A job has one combined `title` (max 160 characters), an integer `reward` 1–1000, and an integer
  `etaMinutes` 1–10080. New jobs start in the `inbox`.
- Claiming moves a job to `inProgress`, sets `assignedTo`, `startedAt`, and `dueAt`, and counts against
  the claimer's limit of three in-progress jobs. The limit is server-enforced.
- Completing scores elapsed time against the ETA with `jobOutcome()`: ≤ 50% is `2×`, > 50% and < 100%
  is `1.5×`, 100%–110% is `1×`, > 110% and ≤ 2× is `0.5×`, and > 2× is a failure. Payout is
  `max(1, round(reward × multiplier))`; a failure costs `max(1, round(reward × 0.5))`.
- A job past twice its ETA fails automatically. `settleJobs()` runs at startup and before every
  non-health API request, records `jobPenalties[date]`, and moves the card to the Failed column.
  Today's completed job earns `jobEarnings[date]`; both ledgers feed the normal balance and dashboard.
- Completed and failed jobs are immutable and greyed out. The API returns only the latest ten of each.
- Only inbox jobs can be deleted. Deleting a profile returns its in-progress jobs to the inbox;
  finished jobs keep the assignee id and render as **Deleted profile**.
- Recurring series post a fresh inbox card on each of their weekdays. A card still in the inbox when
  the next scheduled day starts was never done, so `failMissedOccurrence()` fails it with
  `MISSED_RECURRING_MULTIPLIER` (`-2`, twice the reward) and splits that penalty across every profile
  with whole-number shares. A claimed occurrence that runs past twice its ETA fails normally to its
  claimer instead.
- Deleting a recurring card skips only that occurrence: `lastPostedDate` already covers the day, so
  it is not recreated, and the next scheduled day posts a clean card with no reward or penalty.
- Reset clears `jobEarnings` and `jobPenalties` with the habit ether ledgers.

### Profiles

- At least one profile always exists.
- A new profile starts empty and becomes active on the server.
- Deleting the active profile falls back to the first remaining profile.
- The last profile cannot be deleted.
- Profile names are trimmed, whitespace-collapsed, non-empty, max 60 characters.
- Themes are validated against the palette allowlist.

## Common change recipes

### Add or change an API field

1. Update validation/normalization in `server.js`.
2. Update `toPublic` / `toPublicProfile` / `overviewProfile` as needed.
3. Update `public/app.js` rendering and `load()` state.
4. Update the README API/data sections.
5. Add or update checks in the test suite.

### Add a theme

1. Add a `[data-theme="name"]` block with all accent variables in `public/styles.css`, including
   `--accent-deep`, `--accent-text`, and `--accent-focus`.
2. Add `{ id: 'name', name: 'Name' }` to `THEMES` in `public/app.js`.
3. Add `'name'` to `THEME_IDS` in `server.js`.
4. Keep the order identical in all three places.
5. Run the theme-sync tests.

### Add an app icon preset

1. Add `{ id, label, path }` to `ICON_PRESETS` in `public/app.js` using a 24×24 SVG path.
2. Add the id to `ICON_IDS` in `server.js` in the same order.
3. Run the icon-sync test and check the picker in both appearances.

### Add or change a colour

1. Use an existing neutral variable if one fits; otherwise add the variable to both `:root` and
   `[data-appearance="light"]`.
2. Do not hardcode dark colours or white overlays in component rules; tests reject
   `rgba(255, 255, 255, …)`.
3. Accent text and focus should use `--accent-text` / `--accent-focus`, not raw `--accent-bright`.
4. Check the page in both appearances before finishing.

### Add a page

1. Add the route to `APP_ROUTES` in `server.js` so it serves `index.html`.
2. Add a nav link and a `.page` container in `public/index.html`.
3. Extend the `PAGE` detection and `els.pages` map in `public/app.js`.
4. Add page-specific rendering and CSS.
5. Verify `/new-page` and `/new-page/` both return the app.

### Change the data shape

1. Update `normalizeHabit` / `normalizeShop` / profile normalization for migration.
2. Update the README JSON example.
3. Add migration and persistence tests.
4. Never assume existing `data.json` files already have the new field.

## Git and safety

- **No commits or pushes unless the person you're working with asks.**
- `data.json` is gitignored and contains user data. Do not stage it.
- Do not run destructive commands (`git reset --hard`, `git clean -fd`, deleting `data.json`) without
  explicit permission.
- Do not change the remote or branch without being asked.
- If you finish a change, report:
  - files changed,
  - tests run and result,
  - whether the server was restarted,
  - that nothing was committed/pushed unless instructed.

## Definition of done

For a normal feature change:

1. `node --check` every changed JS file.
2. Run the integration suite; it must pass.
3. Add tests for new behaviour.
4. Restart the server if `server.js` changed.
5. Check `/api/health` and the four pages.
6. Update `README.md` for user-visible changes.
7. Do **not** commit or push unless asked.

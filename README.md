# grindwell

A tiny, zero-dependency habit tracker. One job: mark whether you did each habit **today**. Habits carry a difficulty from 1 to 10, an urgency from 0 to 10, and a weekly schedule (daily by default), and streaks are tracked because they come for free once you store completed dates. Completing a habit earns **ether** based on difficulty, while missing a scheduled habit costs ether based on urgency. Several people can share one server: each **profile** has its own habits, progress, ether balance, and colour theme. Earned ether can be spent in a shared **Shop** on rewards that anyone can add.

Built to live on a homelab. No accounts, no database server, no build step — just Node and one JSON file.

## Run

Requires Node.js 18 or newer. There are no dependencies to install.

```sh
npm start
# grindwell listening on http://localhost:3000
```

Then open <http://localhost:3000>, or `http://<your-machine-ip>:3000` from your phone on the same network.

The app has four pages, linked from the nav bar:

- **Habits** (`/`) — a tab per profile with that person's checklist for today.
- **Dashboard** (`/dashboard`) — a combined ether balance plus a colour-coded card and chart for
  every profile, with separate **Ether trends** and **Habit trends** views, switchable between the
  last 7 days and the last 30 days.
- **Shop** (`/shop`) — a shared list of rewards everyone can add and buy with ether, with optional
  `amazon.in` auto-fill for the name, price, and image (no account required).
- **Settings** (`/settings`) — the global ether reward rate, sounds, and profile management.

## Dark and light mode

The button in the top-right switches the whole app between dark and light. The choice is saved in
the browser (`localStorage`, key `grindwell.appearance`); on a first visit the app follows your
operating system's `prefers-color-scheme` setting. The mode changes the neutral background,
surfaces, text, and shared slate chrome. Each profile's chosen accent colour still tints its
habits, progress bar, dashboard card, and shop contributor checkbox in either mode.

For development with auto-restart on file changes:

```sh
npm run dev
```

## Adding habits

Type the habit name in the box, optionally followed by a difficulty, an urgency, and the days to skip:

```text
Read 10 pages ; 6 ; 3 ; sat,sun
Stretch ; 2
Meditate
```

- **Difficulty** is a whole number from 1 to 10 and defaults to **5**. It sets the reward and is shown
  on each habit card as stars out of five: difficulty 2 is one star, 3 is one and a half, and 10 is
  five stars.
- **Urgency** is a whole number from 0 to 10 and defaults to **1**. It sets the penalty for missing a
  scheduled day; `0` disables penalties. A habit card shows a `−N if missed` chip when urgency is
  above zero.
- **Days** are the days you want to *skip* (rest days): `mo`, `tu`, `we`, `th`, `fr`, `sa`, `su`
  (three-letter and full names work too), separated by commas and/or spaces. With no days, the
  habit runs every day.
- So `Read 10 pages ; 6 ; 3 ; sat,sun` creates a difficulty-6, urgency-3 habit that is scheduled
  Monday to Friday. `Stretch ; 2` is difficulty 2, urgency 1, daily. `Meditate` uses the defaults.
- The third slot is urgency, not days. Put days in the fourth slot: `Read ; 5 ; 2 ; sat,sun`.
  Writing `Read ; 5 ; sat,sun` is an error.
- The pencil button still opens the inline editor for the name, difficulty, urgency, and schedule
  (the editor shows the days that *are* scheduled, i.e. the inverse of the skip list).

## Profiles

Every profile gets its own tab on the **Habits** page. Selecting a tab shows that profile's progress
card, add box, habit list, and reset button. Each profile keeps its own habits, completions, streaks,
ether, and colour theme.

Profiles are managed on the **Settings** page. The **+ Add** button creates one; the pencil and ×
buttons rename or delete it. Deleting a profile removes all of its habits, and the last remaining
profile cannot be deleted.

The server remembers the last active profile so a reload opens the same tab. Because there is no
authentication, anyone who can reach the server can edit any profile — keep it on a trusted LAN or
behind a reverse proxy with auth.

## Ether rewards and penalties

Each completion earns ether using a linear rate:

```text
earned = max(1, round(difficulty × etherFactor))
```

Each missed scheduled day costs ether using the habit's urgency:

```text
lost = max(1, round(urgency × urgencyFactor))
```

Ether amounts are marked with a small sparkle icon so the currency is easy to spot.

- **Difficulty** (1–10) sets the reward. **Urgency** (0–10) sets the penalty; urgency `0` turns
  penalties off. New habits default to difficulty 5 and urgency 1.
- **`etherFactor`** and **`urgencyFactor`** are global settings, each defaulting to **1**. Set them
  between `0.1` and `10` on the **Settings** page (or with `PATCH /api/settings`). The `max(1, …)`
  floors mean even a difficulty-1 habit earns at least one ether and even an urgency-1 habit loses
  at least one.
- Rewards and penalties are **locked in when the day is settled**. Changing either factor, or editing
  a habit's difficulty or urgency later, only affects future days, so history and trends stay put.
- Missed days are settled automatically by the server: at startup and before every API request it
  walks scheduled days from the habit's penalty window up to yesterday. Rest days and completed days
  are skipped, and today is never charged until it is over. Changing a habit's urgency or schedule
  restarts its penalty window at today, so edits never re-bill the past.
- Unchecking a habit removes that day's ether. Deleting a habit keeps the ether it already earned and
  the penalties it already caused; **Reset** clears both.
- Balances can go **negative** when penalties outpace earnings. Spending ether in the **Shop** lowers
  the balance further. The dashboard's combined total is the current balance, while each profile
  card's headline shows lifetime ether earned (including ether already spent); today and the range
  chart count **net** ether (earned minus lost).
- The **Dashboard** page has two sub-pages, **Ether trends** and **Habit trends**. Ether trends shows
  a combined balance for all profiles plus one card per profile with its lifetime ether earned, net
  ether today, net ether and penalties over the selected range, and a bar for each day. Gains draw
  green upward bars and losses draw red downward bars. Habit trends shows one card per profile with
  its own chart that tracks both sides of the day: completed habits grow upward in green and missed
  scheduled habits grow downward in red, with today, missed, and daily average counts beside it. A day
  is only counted as missed once it has ended, so today never counts. Use the **Range** dropdown to
  switch both views between the last 7 days and the last 30 days. Each profile card's chrome is tinted
  with that profile's selected palette, while the bars stay green and red.
- Checking a habit plays a short chime. It is synthesised in the browser, so it needs no audio file.
  You can change it, or the Shop purchase sound, on the **Settings** page; see **Sounds** below.
- There is no streak bonus; difficulty is the only reward input.

The nav bar, header, page titles, and shared page controls deliberately use a reserved slate colour
that is **not** one of the selectable palettes. That keeps shared chrome distinct from every
profile's colour while the habit content, dashboard cards, and shop contributor checkboxes still use
the profile themes.

## Sounds

The **Settings** page has a **Sounds** card with two pickers: one for completing a habit and one for
buying a Shop reward. The built-in sounds are **Chime**, **Sparkle**, **Pop**, **Bell**, and **Off**;
they are synthesised in the browser, so the app still ships no audio files. Each picker has a
**Preview** button, and changing a picker saves immediately.

To add your own sound, use the **Add a sound** form with a name and a direct `http(s)` link to an
audio file. Custom sounds appear in both pickers and in the list below, where each one has a preview
and remove button. Removing a sound that is currently selected falls back to the built-in default.
Custom sound URLs are stored in `data.json`, so the browser fetches them directly.

## App icon

Click the grindwell mark in the header to open the icon picker. It offers six built-in example
icons — **Flame**, **Spark**, **Bolt**, **Moon**, **Gem**, and **Heart** — and the current choice is
highlighted. Selecting one changes the mark and the browser tab icon immediately.

To load your own icon, use the **Load an icon** form with a name and a direct `http(s)` link to a
square image. New icons are added to the grid, selected straight away, and listed below with a remove
button. Removing the selected custom icon falls back to **Flame**. The picker closes with **Esc**, its
close button, or a click outside it.

## Shop

The **Shop** page is shared by every profile. It starts empty. Tap **Add an item** to open the form,
then enter a name, a link to where it can be bought, an ether cost, and an optional image URL. Tick
**Consumable** if the reward can be bought more than once; leave it off for a one-time reward.

When you paste an `amazon.in` product link, the form fills in the product name, current price, and
image. The price becomes a whole-number ether cost that you can adjust, and **Fetch details** retries
the lookup by hand. The fields stay editable, so you can always enter everything manually.

There are three ways it can fill in:

- **With Creators API credentials**, the server asks Amazon's official API, which is exact.
- **Without credentials**, the server reads the public product page. That needs no account, but it is
  best-effort: Amazon can block it, and the price is a guess you should check.
- **The bookmarklet** reads the page your own browser already loaded. Open **Amazon page won't fill
  in?** in the form, drag **Import Amazon item** to your bookmarks bar, then click it on any
  `amazon.in` product page. It opens this Shop with the name, price, and image filled in. Nothing is
  added until you press **Add item**.

The Shop groups items into **Consumables** and **Rewards**. Consumables come first as compact square
tiles in a three-column grid, with the item image or initial on top and its name, progress bar,
contributor chips, and **Buy** button below. Rewards use the wider card layout. A reward can be
bought once; after that its card greys out, its contributor checkboxes lock, and the button reads
**Bought**. A consumable stays available and can be bought again whenever the group can afford it.

By default every profile contributes its balance to every item. Use the contributor checkboxes on a
card to exclude profiles from that item; each checkbox uses that profile's theme colour. The
progress bar counts only the included profiles that have a positive balance, and it is split into
colour-coded segments showing which profile is funding which part of the item. A reward card shows a
matching legend under the bar; consumable tiles show each profile's amount in the contributor chips.
Once the item is affordable, the segments and amounts show the exact whole-number split a purchase
would charge.

When an item is bought, its cost is split across the included contributors in proportion to their
balances. Someone with more ether pays more, and the shares always add up to exactly the item's
cost. Clicking **Buy** purchases immediately, with no confirmation step; a short chime confirms the
purchase. Purchases reduce each contributor's balance and are recorded in `spentEther`. Consumable
items stay buyable; a one-time item is marked as purchased and rejects a second purchase.

## Jobs

The **Jobs** page is a shared job board. Any profile can post work, any profile can claim it, and
finishing on time pays ether into the claimer's balance.

A job is one combined **title / description**, an **ether reward** (1–1000), and an **ETA in whole
minutes** (1–10080, so up to one week). Posting adds it to the **Inbox**, which every profile sees.
Select a profile in **Acting as**, then use **Take** (or drag the card onto that profile's box) to
claim a job. Each profile can hold at most **three jobs in progress** at once; the server rejects a
fourth. Everyone sees claims live: the board refreshes every ten seconds and after each action.

The reward depends on how much of the ETA had passed when the job was completed:

| Elapsed time              | Multiplier | Result                         |
| ------------------------- | ---------- | ------------------------------ |
| 50% of the ETA or less    | `2×`       | Fast finish                    |
| More than 50%, under 100% | `1.5×`     | Beat the estimate              |
| 100% through 110%         | `1×`       | On time, including a 10% grace |
| More than 110% through 2× | `0.5×`     | Late                           |
| More than twice the ETA   | failure    | Penalty, not a reward          |

The payout is `max(1, round(reward × multiplier))`. A job that runs past twice its ETA fails
automatically: the server settles it at startup and before every API request, the card moves to the
**Failed** box, and the claimer loses `max(1, round(reward × 0.5))` ether. Completing a job after it
has already failed is rejected.

Completed and failed jobs are greyed out and immutable. The board shows only the **latest ten** of
each; older finished jobs stay in `data.json` as history. Jobs still in the inbox can be removed with
the **×** button. Deleting a profile returns any job it had in progress to the Inbox, while finished
jobs keep their assignee id and display **Deleted profile**.

Job ether is part of the same balance as habit ether: it feeds the profile totals, the Dashboard
trends, and the Shop. It is recorded in `jobEarnings` and `jobPenalties` on the day the job finishes,
so later changes never rewrite it. **Reset** clears both ledgers along with the habit ether.

## Resetting

Each profile tab has its own **Reset** button. It deletes every habit, completion, and earned
ether for that profile — including ether kept from deleted habits and the record of ether spent in
the Shop — after a confirmation. The button stays available while the profile has any ether, even
if it currently has no habits. There is no undo, so back up `data.json` first if you might want it
back. Other profiles and their themes are left alone.

## Configuration

| Variable    | Default      | Purpose                                                      |
| ----------- | ------------ | ------------------------------------------------------------ |
| `PORT`      | `3000`       | Port to listen on                                            |
| `HOST`      | `0.0.0.0`    | Bind address. Set `127.0.0.1` when behind a reverse proxy.    |
| `DATA_FILE` | `./data.json` | Where habit data is stored.                                  |
| `AMAZON_CREATORS_CLIENT_ID` | — | Amazon Creators API client id, for Shop auto-fill |
| `AMAZON_CREATORS_CLIENT_SECRET` | — | Amazon Creators API client secret |
| `AMAZON_PARTNER_TAG` | — | Amazon Associates partner tag, for example `yourtag-21` |
| `AMAZON_MARKETPLACE` | `www.amazon.in` | Marketplace sent to the Creators API |
| `AMAZON_CREATORS_TOKEN_URL` | `https://api.amazon.co.uk/auth/o2/token` | OAuth token endpoint override |
| `AMAZON_CREATORS_API_URL` | `https://creatorsapi.amazon/catalog/v1/getItems` | `GetItems` endpoint override |
| `AMAZON_PAGE_LOOKUP` | `on` | Read the product page when no credentials are set. `off` disables it |
| `AMAZON_PAGE_URL` | `https://www.amazon.in` | Base URL for the page fallback |
| `AMAZON_PAGE_MIN_GAP` | `3000` | Milliseconds between page requests |

Example:

```sh
PORT=8080 HOST=127.0.0.1 DATA_FILE=/srv/grindwell/data.json npm start
```

Shop auto-fill works without any setup by reading the public product page. That path needs no Amazon
account, but it is best-effort: Amazon may answer with a bot check, and the markup can change. To use
the official Creators API instead, you need an Amazon Associates account that has been accepted into
the program and has referred qualifying sales. Create an application and credential under
**Tools → Creators API** in Associates Central, then set all three credential variables. Credentials
take priority over the page fallback. Set `AMAZON_PAGE_LOOKUP=off` to disable the fallback and return
`503` when no credentials are configured.

The `AMAZON_MARKETPLACE`, token, and API URL overrides are only needed for an advanced setup or a
test endpoint; product links are always parsed as `amazon.in`.

## Your data

Everything lives in `data.json` (gitignored):

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
        "consumable": false,
        "purchasedAt": null,
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

Completed dates are stored as local `YYYY-MM-DD` keys, so streaks survive restarts. `earnings`
records the ether awarded for each of those dates, and `penalties` records the ether lost for each
missed scheduled date. When a habit is deleted, its earned ether moves to the profile's
`retiredEarnings` and its penalties move to `retiredPenalties`, so neither total is reduced.
`spentEther` is the running total spent in the Shop; a profile's balance is its earned ether minus
its penalties minus `spentEther`. Job payouts and failure penalties live in the profile's
`jobEarnings` and `jobPenalties`, keyed by the day the job finished, and count toward the same
balance. Top-level `jobs` holds the shared board; finished jobs stay there as history even though the
API only returns the latest ten of each. Back the file up by copying it; move machines by taking it
with you. Older single-profile files (a top-level `habits` array) are migrated into a profile named
**Mine** on startup, and completions from before the reward system are backfilled using the current
factor and difficulty. Habits saved before urgency existed migrate to urgency `0`, so they never
collect retroactive penalties; `penaltyFrom` marks the first date a habit can be charged for a miss.
`settings.sounds` stores the selected habit and purchase sound ids plus any custom sounds; built-in
ids are `chime`, `sparkle`, `pop`, `bell`, and `off`. `settings.icon` stores the selected icon id plus
any custom icons; built-in ids are `flame`, `spark`, `bolt`, `moon`, `gem`, and `heart`.

## Homelab notes

Docker:

```sh
docker build -t grindwell .
docker run -d --name grindwell -p 3000:3000 -v grindwell-data:/data grindwell
```

- **No authentication.** Keep it on your LAN or Tailscale, or put it behind a reverse proxy (Caddy/nginx) with basic auth. If you proxy it, run with `HOST=127.0.0.1` so it is not exposed directly.
- **systemd:** a simple unit running `node /srv/grindwell/server.js` with `Restart=always` is enough.
- **Health check:** `GET /api/health` returns `{ "ok": true, "today": "YYYY-MM-DD" }`.

## API

| Method   | Path                       | Body                                          | Result                    |
| -------- | -------------------------- | --------------------------------------------- | ------------------------- |
| `GET`    | `/api/overview`            | —                                             | `{ today, settings, profiles[], shop, lookup }` |
| `GET`    | `/api/profiles`            | —                                             | `{ profiles[], activeProfileId }` |
| `POST`   | `/api/profiles`            | `{ "name": "...", "theme": "blue" }`          | Created profile (becomes active) |
| `PATCH`  | `/api/profiles/:id`        | any of `name`, `theme`                        | Updated profile           |
| `POST`   | `/api/profiles/:id/activate` | —                                           | Updated active profile    |
| `DELETE` | `/api/profiles/:id`        | —                                             | `204`                     |
| `GET`    | `/api/settings`            | —                                             | `{ etherFactor, urgencyFactor, sounds, icon }` |
| `PATCH`  | `/api/settings`            | any of `etherFactor`, `urgencyFactor`, `sounds: { habit, purchase }`, `icon: { id }` | Updated settings |
| `POST`   | `/api/settings/sounds`     | `{ "name": "...", "url": "https://..." }`     | `{ sound, sounds }`       |
| `DELETE` | `/api/settings/sounds/:id` | —                                             | Updated settings          |
| `POST`   | `/api/settings/icons`      | `{ "name": "...", "url": "https://..." }`     | `{ icon, settings }`; selects the new icon |
| `DELETE` | `/api/settings/icons/:id`  | —                                             | Updated settings          |
| `GET`    | `/api/shop`                | —                                             | `{ items[], profiles[], lookup }` |
| `POST`   | `/api/shop/lookup`         | `{ "link": "https://www.amazon.in/dp/..." }`  | `{ item: { asin, name, cost, image, price, detailPageURL } }` |
| `POST`   | `/api/shop/items`          | `{ "name": "...", "link": "...", "cost": 20, "image": "...", "consumable": false }` | Created item |
| `PATCH`  | `/api/shop/items/:id`      | any of `name`, `link`, `cost`, `image`, `consumable`, `excludedProfiles` | Updated item |
| `DELETE` | `/api/shop/items/:id`      | —                                             | `204`                     |
| `POST`   | `/api/shop/items/:id/buy`  | —                                             | `{ item, contributions[], profiles[] }` |
| `GET`    | `/api/jobs`                | —                                             | `{ today, now, activeProfileId, profiles[], jobs, limits }` |
| `POST`   | `/api/jobs`                | `{ "title": "...", "reward": 20, "etaMinutes": 60 }` | Created job in the inbox |
| `POST`   | `/api/jobs/:id/take`       | —                                             | `{ job, jobs, profiles[] }`; accepts `?profile=<id>` |
| `POST`   | `/api/jobs/:id/complete`   | —                                             | `{ job, jobs, profiles[] }` |
| `DELETE` | `/api/jobs/:id`            | —                                             | `204`; inbox jobs only |
| `GET`    | `/api/habits`              | —                                             | `{ today, habits[], profile, profiles[], settings, ether }` |
| `POST`   | `/api/habits`              | `{ "name": "...", "difficulty": 5, "urgency": 1, "days": [1,3,5] }` | Created habit     |
| `PATCH`  | `/api/habits/:id`          | any of `name`, `difficulty`, `urgency`, `days` | Updated habit            |
| `DELETE` | `/api/habits`              | —                                             | `204`; also clears ether, penalties, and spent |
| `POST`   | `/api/habits/:id/toggle`   | `{ "done": true }`                            | Updated habit             |
| `DELETE` | `/api/habits/:id`          | —                                             | `204`                     |
| `GET`    | `/api/health`              | —                                             | `{ ok, today }`           |

`GET /dashboard`, `GET /jobs`, `GET /shop`, and `GET /settings` serve the same single-page document
as `/`; the client chooses which view to show from the URL. This keeps the HTML, theme handling, and profile
data in one place without a build step.

All `/api/habits` routes accept an optional `?profile=<id>` and otherwise apply to the **active
profile**. The UI uses that query parameter so each profile tab can read and write its own habits
without touching anyone else's. An unknown profile id returns `404`.

`/api/jobs` is shared, not profile-scoped. `GET` returns the board split into `inbox`, `inProgress`,
`completed`, and `failed`, plus the `limits` (`maxInProgress` and `terminalShown`). `POST /api/jobs`
adds to the inbox. `POST /api/jobs/:id/take` claims a job for `?profile=<id>` (or the active profile),
enforces the three-job limit, and starts the ETA clock. `POST /api/jobs/:id/complete` scores the job
from its elapsed time and records the payout. Only inbox jobs can be deleted; finished jobs are
immutable. A job past twice its ETA is failed automatically before any non-health API request is
handled.

`GET /api/overview` is what the frontend loads: it returns every profile with its public habits,
its `ether` balance, and a 30-day `summary` (the dashboard slices the last 7 or 30 days from it),
plus the shared `shop`:

```json
{
  "today": "2026-11-18",
  "settings": {
    "etherFactor": 1,
    "urgencyFactor": 1,
    "sounds": { "habit": "chime", "purchase": "pop", "custom": [] },
    "icon": { "id": "flame", "custom": [] }
  },
  "activeProfileId": "9f12...",
  "profiles": [
    {
      "id": "9f12...",
      "name": "Mine",
      "theme": "ember",
      "habitCount": 3,
      "ether": 42,
      "earned": 54,
      "penalties": 12,
      "spent": 12,
      "summary": {
        "factor": 1,
        "total": 42,
        "earned": 54,
        "penalties": 12,
        "spent": 12,
        "today": 9,
        "last7": 28,
        "last30": 35,
        "penaltyToday": 0,
        "penaltyLast7": 6,
        "penaltyLast30": 12,
        "netToday": 9,
        "netLast7": 22,
        "netLast30": 23,
        "completedToday": 3,
        "completedLast7": 14,
        "completedLast30": 19,
        "days": [
          { "date": "2026-10-20", "ether": 4, "penalty": 0, "net": 4, "completed": 2 },
          "… 30 days ending today"
        ]
      },
      "habits": ["… same shape as GET /api/habits"]
    }
  ],
  "shop": { "items": ["… same shape as GET /api/shop"] },
  "lookup": { "amazon": true, "mode": "page" }
}
```

A public profile is `{ id, name, theme, habitCount, ether, earned, penalties, spent }`. `ether` is
the current balance, `earned` is all ether ever earned, `penalties` is all ether ever lost, and
`spent` is the amount spent in the Shop. `summary.total` is the balance while `summary.today`,
`last7`, `last30`, and `days[].ether` count earned ether. `summary.penaltyToday`,
`penaltyLast7`, `penaltyLast30`, and `days[].penalty` count lost ether; `summary.netToday`,
`netLast7`, `netLast30`, and `days[].net` are earned minus lost. `summary.completedToday`,
`completedLast7`, `completedLast30`, and `days[].completed` count habit completions, while
`missedLast7`, `missedLast30`, and `days[].missed` count scheduled days before today with no
completion, for the per-profile Habit trends cards. `theme` must be one of the palette ids below; it defaults to
`ember`. Creating a profile switches the server's active profile to it, and deleting the active
profile switches to the first remaining one. The last profile cannot be deleted. `activeProfileId`
tells the Habits page which tab to open first.

Shop items are `{ id, name, link, cost, image, createdAt, consumable, purchasedAt, excludedProfiles }`.
`link` and `image` must be `http://` or `https://` URLs (the image is optional), `cost` must be a
whole number of at least 1, and `excludedProfiles` lists profile ids that do not contribute to that
item. `consumable` defaults to `false`. A one-time item gets a `purchasedAt` timestamp after its
first purchase and rejects later purchases; consumable items stay available. Buying splits the cost
across the included profiles that have a positive balance, proportionally to those balances, and
returns the per-profile `contributions`.

`POST /api/shop/lookup` accepts an `amazon.in` product link and returns a name, rounded whole-number
`cost`, `image`, `price` (`amount`, `currency`, `display`), and `detailPageURL`. With Creators API
credentials the values come from Amazon's API. Without them the server reads the public product page,
so `cost` may be `null` when the page shows no price. It returns `503` only when the page fallback is
disabled and no credentials exist, `400` for links that are not amazon.in product pages, `404` when
the product cannot be read, and `502` when Amazon blocks or fails the request.

`lookup` in `/api/overview` and `/api/shop` is `{ amazon, mode }`. `mode` is `api` when credentials
are configured, `page` when only the page fallback is available, and `off` when neither is. The
frontend enables **Fetch details** when `amazon` is `true` and words the result differently for
`page`.

Each public habit includes `urgency`, `penalty` (what missing it today would cost), `reward` (what
completing it today would earn), and `earnedToday`. `PATCH /api/settings` changes the global
`etherFactor` or `urgencyFactor`; both accept values from `0.1` to `10` and only affect future days.

`difficulty` and `urgency` must be whole numbers from 1 to 10 and 0 to 10 respectively; both default
when omitted (`difficulty` to `5`, `urgency` to `1`). `days` is an array of weekdays using
`0 = Sunday ... 6 = Saturday`; it defaults to all seven days (daily). Send at least one day.
Duplicates are removed and the result is sorted.

`toggle` also works with no body, in which case it flips today's state. Sending `done` explicitly
is safer against double taps. `DELETE /api/habits` wipes the selected profile's habits, history,
earned ether, penalties, and spent balance.

### Schedule behaviour

- `dueToday` is computed from `days`, and the progress bar counts only habits due today.
- Habits that are not due stay visible at the bottom of the list, marked **Rest day**, with
  the check disabled. The API rejects marking them done (`400`); un-checking is allowed so an
  old off-day record can be cleared.
- Streaks walk backwards over *scheduled* days only. Unschedule a day and it becomes a free
  skip instead of a miss. Today never breaks a streak until it is over.
- Habits saved before schedules existed are migrated to daily (all seven days) on startup.

### Editing habits

Each habit has a pencil button that turns that card into an inline editor for its name, difficulty,
urgency, and schedule — no popup, and the rest of the list stays visible. Save sends a
`PATCH /api/habits/:id`; Cancel or `Esc` throws the draft away and returns focus to the pencil.
`PATCH` accepts any subset of those fields; sending an empty body is a `400`.
Changing the schedule keeps past completions — streaks are simply recalculated against the new
days. Changing urgency or the schedule restarts the habit's penalty window at today, so past misses
keep the amount they were charged.

## Themes

Each profile chooses its own accent colour on the **Settings** page: **Ember** (default), **Blue**,
**Teal**, or **Violet**. Green and red are deliberately not offered as palettes so the dashboard's
green-up / red-down trend bars stay unambiguous.

The choice is saved to `data.json` via `PATCH /api/profiles/:id`. A profile's habits, progress bar,
and dashboard card all use its colour, so the shared pages stay readable while each person keeps
their own identity. The dark/light mode toggle is separate from these palettes: it changes the
neutral surfaces, while each profile keeps its accent colour in both modes.

Shared chrome uses a reserved slate colour (`--chrome` in `public/styles.css`) that is deliberately
**not** one of the selectable palettes. The nav bar, header, page titles, dashboard totals, and
Settings controls all use it, so no profile colour leaks into the shared UI.

To add a palette, define a `[data-theme="name"]` block of accent variables in
`public/styles.css`, add the matching `{ id, name }` entry to `THEMES` in `public/app.js`, and add
the id to `THEME_IDS` in `server.js`.

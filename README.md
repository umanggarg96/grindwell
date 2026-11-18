# grindwell

A tiny, zero-dependency habit tracker. One job: mark whether you did each habit **today**. Habits carry a difficulty from 1 to 10 and a weekly schedule (daily by default), and streaks are tracked because they come for free once you store completed dates. Completing a habit also earns **ether**, a configurable reward based on difficulty, with a per-day dashboard. Several people can share one server: each **profile** has its own habits, progress, ether balance, and colour theme. Earned ether can be spent in a shared **Shop** on rewards that anyone can add.

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
- **Shop** (`/shop`) — a shared list of rewards everyone can add and buy with ether.
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

Type the habit name in the box, optionally followed by a difficulty and the days to skip:

```text
Read 10 pages ; 6 ; sat,sun
Stretch ; 2
Meditate
```

- **Difficulty** is a whole number from 1 to 10 and defaults to **5**. It is shown on each habit
  card as stars out of five: difficulty 2 is one star, 3 is one and a half, and 10 is five.
- **Days** are the days you want to *skip* (rest days): `mo`, `tu`, `we`, `th`, `fr`, `sa`, `su`
  (three-letter and full names work too), separated by commas and/or spaces. With no days, the
  habit runs every day.
- So `Read 10 pages ; 6 ; sat,sun` creates a difficulty-6 habit that is scheduled Monday to
  Friday. `Stretch ; 2` is difficulty 2, daily.
- `Stretch ; sat,sun` also works — a non-numeric middle part is read as days.
- The pencil button still opens the inline editor for the name, difficulty, and schedule (the
  editor shows the days that *are* scheduled, i.e. the inverse of the skip list).

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

## Ether rewards

Each completion earns ether using a linear rate:

```text
ether = max(1, round(difficulty × factor))
```

Ether amounts are marked with a small sparkle icon so the currency is easy to spot.

- The **factor** is one global setting, default **1**, so difficulty 4 earns 4 ether. It can be
  set between `0.1` and `10` on the **Settings** page (or with `PATCH /api/settings`). The
  `max(1, …)` floor means even a difficulty-1 habit always earns at least one ether.
- Rewards are **locked in when you check a habit**. Changing the factor or editing a habit's
  difficulty later only affects future completions, so your history and weekly trends stay put.
- Unchecking a habit removes that day's ether.
- Deleting a habit removes it from the checklist but keeps the ether it already earned. Use
  **Reset** if you want to clear a profile's ether as well.
- Spending ether in the **Shop** lowers that profile's balance. The dashboard's combined total shows
  the current balance, while each profile card's headline shows lifetime ether earned (including
  ether already spent); today and the range chart also count earned ether.
- The **Dashboard** page has two sub-pages, **Ether trends** and **Habit trends**. Ether trends shows
  a combined balance for all profiles plus one card per profile with its lifetime ether earned, ether
  earned today, ether over the selected range, and a bar for each day. Habit trends shows one card per
  profile counting how many habits that person completed each day, with its own chart. Use the
  **Range** dropdown to switch both views between the last 7 days and the last 30 days. Each profile
  card is tinted with that profile's selected palette, so people can tell their progress apart at a
  glance.
- Checking a habit plays a short chime. It is synthesised in the browser, so it needs no audio file.
  You can change it, or the Shop purchase sound, on the **Settings** page; see **Sounds** below.
- There is no streak bonus; difficulty is the only input.

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

Example:

```sh
PORT=8080 HOST=127.0.0.1 DATA_FILE=/srv/grindwell/data.json npm start
```

## Your data

Everything lives in `data.json` (gitignored):

```json
{
  "settings": {
    "etherFactor": 1,
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
      "spentEther": 12,
      "habits": [
        {
          "id": "0c9a...",
          "name": "Read 10 pages",
          "createdAt": "2026-11-17T08:00:00.000Z",
          "difficulty": 4,
          "days": [1, 2, 3, 4, 5],
          "completions": ["2026-11-16", "2026-11-17"],
          "earnings": { "2026-11-16": 4, "2026-11-17": 4 }
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
  "activeProfileId": "9f12..."
}
```

Completed dates are stored as local `YYYY-MM-DD` keys, so streaks survive restarts. `earnings`
records the ether awarded for each of those dates. When a habit is deleted, its earned ether moves
to the profile's `retiredEarnings` so the earned total is never reduced. `spentEther` is the running
total spent in the Shop; a profile's balance is its earned ether minus `spentEther`. Back the file up
by copying it; move machines by taking it with you. Older single-profile files (a top-level `habits`
array) are migrated into a profile named **Mine** on startup, and completions from before the reward
system are backfilled using the current factor and difficulty. `settings.sounds` stores the selected
habit and purchase sound ids plus any custom sounds; built-in ids are `chime`, `sparkle`, `pop`,
`bell`, and `off`. `settings.icon` stores the selected icon id plus any custom icons; built-in ids
are `flame`, `spark`, `bolt`, `moon`, `gem`, and `heart`.

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
| `GET`    | `/api/overview`            | —                                             | `{ today, settings, profiles[], shop }` |
| `GET`    | `/api/profiles`            | —                                             | `{ profiles[], activeProfileId }` |
| `POST`   | `/api/profiles`            | `{ "name": "...", "theme": "blue" }`          | Created profile (becomes active) |
| `PATCH`  | `/api/profiles/:id`        | any of `name`, `theme`                        | Updated profile           |
| `POST`   | `/api/profiles/:id/activate` | —                                           | Updated active profile    |
| `DELETE` | `/api/profiles/:id`        | —                                             | `204`                     |
| `GET`    | `/api/settings`            | —                                             | `{ etherFactor, sounds, icon }` |
| `PATCH`  | `/api/settings`            | any of `etherFactor`, `sounds: { habit, purchase }`, `icon: { id }` | Updated settings |
| `POST`   | `/api/settings/sounds`     | `{ "name": "...", "url": "https://..." }`     | `{ sound, sounds }`       |
| `DELETE` | `/api/settings/sounds/:id` | —                                             | Updated settings          |
| `POST`   | `/api/settings/icons`      | `{ "name": "...", "url": "https://..." }`     | `{ icon, settings }`; selects the new icon |
| `DELETE` | `/api/settings/icons/:id`  | —                                             | Updated settings          |
| `GET`    | `/api/shop`                | —                                             | `{ items[], profiles[] }` |
| `POST`   | `/api/shop/items`          | `{ "name": "...", "link": "...", "cost": 20, "image": "...", "consumable": false }` | Created item |
| `PATCH`  | `/api/shop/items/:id`      | any of `name`, `link`, `cost`, `image`, `consumable`, `excludedProfiles` | Updated item |
| `DELETE` | `/api/shop/items/:id`      | —                                             | `204`                     |
| `POST`   | `/api/shop/items/:id/buy`  | —                                             | `{ item, contributions[], profiles[] }` |
| `GET`    | `/api/habits`              | —                                             | `{ today, habits[], profile, profiles[], settings, ether }` |
| `POST`   | `/api/habits`              | `{ "name": "...", "difficulty": 5, "days": [1,3,5] }` | Created habit     |
| `PATCH`  | `/api/habits/:id`          | any of `name`, `difficulty`, `days`           | Updated habit             |
| `DELETE` | `/api/habits`              | —                                             | `204`; also clears ether and spent |
| `POST`   | `/api/habits/:id/toggle`   | `{ "done": true }`                            | Updated habit             |
| `DELETE` | `/api/habits/:id`          | —                                             | `204`                     |
| `GET`    | `/api/health`              | —                                             | `{ ok, today }`           |

`GET /dashboard`, `GET /shop`, and `GET /settings` serve the same single-page document as `/`; the
client chooses which view to show from the URL. This keeps the HTML, theme handling, and profile
data in one place without a build step.

All `/api/habits` routes accept an optional `?profile=<id>` and otherwise apply to the **active
profile**. The UI uses that query parameter so each profile tab can read and write its own habits
without touching anyone else's. An unknown profile id returns `404`.

`GET /api/overview` is what the frontend loads: it returns every profile with its public habits,
its `ether` balance, and a 30-day `summary` (the dashboard slices the last 7 or 30 days from it),
plus the shared `shop`:

```json
{
  "today": "2026-11-18",
  "settings": {
    "etherFactor": 1,
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
      "spent": 12,
      "summary": {
        "factor": 1,
        "total": 42,
        "earned": 54,
        "spent": 12,
        "today": 9,
        "last7": 28,
        "last30": 35,
        "completedToday": 3,
        "completedLast7": 14,
        "completedLast30": 19,
        "days": [{ "date": "2026-10-20", "ether": 4, "completed": 2 }, "… 30 days ending today"]
      },
      "habits": ["… same shape as GET /api/habits"]
    }
  ],
  "shop": { "items": ["… same shape as GET /api/shop"] }
}
```

A public profile is `{ id, name, theme, habitCount, ether, earned, spent }`. `ether` is the
current balance, `earned` is all ether ever earned, and `spent` is the amount spent in the Shop.
`summary.total` is the balance while `summary.today`, `last7`, `last30`, and `days` count earned
ether. `summary.completedToday`, `completedLast7`, `completedLast30`, and `days[].completed` count
habit completions for the per-profile Habit trends cards. `theme` must be one of the palette ids below; it defaults to
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

Each public habit includes `reward` (what completing it today would earn) and `earnedToday`.
`PATCH /api/settings` changes the global factor; it accepts values from `0.1` to `10` and only
affects future completions.

`difficulty` must be a whole number from 1 to 10 and defaults to `5` when omitted.
`days` is an array of weekdays using `0 = Sunday ... 6 = Saturday`; it defaults to all seven
days (daily). Send at least one day. Duplicates are removed and the result is sorted.

`toggle` also works with no body, in which case it flips today's state. Sending `done` explicitly
is safer against double taps. `DELETE /api/habits` wipes the selected profile's habits, history,
earned ether, and spent balance.

### Schedule behaviour

- `dueToday` is computed from `days`, and the progress bar counts only habits due today.
- Habits that are not due stay visible at the bottom of the list, marked **Rest day**, with
  the check disabled. The API rejects marking them done (`400`); un-checking is allowed so an
  old off-day record can be cleared.
- Streaks walk backwards over *scheduled* days only. Unschedule a day and it becomes a free
  skip instead of a miss. Today never breaks a streak until it is over.
- Habits saved before schedules existed are migrated to daily (all seven days) on startup.

### Editing habits

Each habit has a pencil button that turns that card into an inline editor for its name,
difficulty, and schedule — no popup, and the rest of the list stays visible. Save sends a
`PATCH /api/habits/:id`; Cancel or `Esc` throws the draft away and returns focus to the pencil.
`PATCH` accepts any subset of those fields; sending an empty body is a `400`.
Changing the schedule keeps past completions — streaks are simply recalculated against the new
days.

## Themes

Each profile chooses its own accent colour on the **Settings** page: **Ember** (default), **Blue**,
**Teal**, **Green**, **Lime**, **Violet**, or **Rose**. Blue and green each have two shades
(blue/teal and green/lime).

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

# grindwell

A tiny, zero-dependency habit tracker. One job: mark whether you did each habit **today**. Habits carry a difficulty from 1 to 10 and a weekly schedule (daily by default), and streaks are tracked because they come for free once you store completed dates. Completing a habit also earns **ether**, a configurable reward based on difficulty, with a per-day dashboard. Several people can share one server: each **profile** has its own habits, progress, ether balance, and colour theme.

Built to live on a homelab. No accounts, no database server, no build step — just Node and one JSON file.

## Run

Requires Node.js 18 or newer. There are no dependencies to install.

```sh
npm start
# grindwell listening on http://localhost:3000
```

Then open <http://localhost:3000>, or `http://<your-machine-ip>:3000` from your phone on the same network.

The app has three pages, linked from the nav bar:

- **Habits** (`/`) — today's checklist and progress.
- **Dashboard** (`/dashboard`) — the active profile's ether balance and daily chart.
- **Settings** (`/settings`) — the global ether reward rate.

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

- **Difficulty** is a whole number from 1 to 10 and defaults to **5**.
- **Days** are the days you want to *skip* (rest days): `mo`, `tu`, `we`, `th`, `fr`, `sa`, `su`
  (three-letter and full names work too), separated by commas and/or spaces. With no days, the
  habit runs every day.
- So `Read 10 pages ; 6 ; sat,sun` creates a difficulty-6 habit that is scheduled Monday to
  Friday. `Stretch ; 2` is difficulty 2, daily.
- `Stretch ; sat,sun` also works — a non-numeric middle part is read as days.
- The pencil button still opens the inline editor for the name, difficulty, and schedule (the
  editor shows the days that *are* scheduled, i.e. the inverse of the skip list).

## Profiles

The row under the header lists every profile. Click a name to switch to it; the **+** button adds
a new one. Each profile keeps its own habits, completions, streaks, and colour theme. The small
pencil and × on a profile rename or delete it — deleting a profile removes all of its habits, and
the last remaining profile cannot be deleted.

The active profile is stored on the server, so switching on one device changes the view
everywhere. Because there is no authentication, anyone who can reach the server can switch or
edit any profile — keep it on a trusted LAN or behind a reverse proxy with auth.

## Ether rewards

Each completion earns ether using a linear rate:

```text
ether = max(1, round(difficulty × factor))
```

- The **factor** is one global setting, default **1**, so difficulty 4 earns 4 ether. It can be
  set between `0.1` and `10` on the **Settings** page (or with `PATCH /api/settings`). The
  `max(1, …)` floor means even a difficulty-1 habit always earns at least one ether.
- Rewards are **locked in when you check a habit**. Changing the factor or editing a habit's
  difficulty later only affects future completions, so your history and weekly trends stay put.
- Unchecking a habit removes that day's ether.
- The **Dashboard** page shows the active profile's total balance, ether earned today, ether over
  the last seven days, and a bar for each day. Switching profiles switches the balance because
  ether is stored per profile. The dashboard is tinted with that profile's selected palette.
- There is no streak bonus; difficulty is the only input.

The nav bar, header, profile row, and settings controls deliberately use neutral greys, so the
palette colour is reserved for the dashboard and the habit content.

## Resetting

The **Reset** button in the header deletes every habit, its completion history, and its earned
ether for the currently active profile after a confirmation. There is no undo, so back up
`data.json` first if you might want it back. Profiles and their themes are left alone.

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
    "etherFactor": 1
  },
  "profiles": [
    {
      "id": "9f12...",
      "name": "Mine",
      "theme": "ember",
      "createdAt": "2026-11-17T08:00:00.000Z",
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
  "activeProfileId": "9f12..."
}
```

Completed dates are stored as local `YYYY-MM-DD` keys, so streaks survive restarts. `earnings`
records the ether awarded for each of those dates. Back the file up by copying it; move machines
by taking it with you. Older single-profile files (a top-level `habits` array) are migrated into a
profile named **Mine** on startup, and completions from before the reward system are backfilled
using the current factor and difficulty.

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
| `GET`    | `/api/profiles`            | —                                             | `{ profiles[], activeProfileId }` |
| `POST`   | `/api/profiles`            | `{ "name": "...", "theme": "blue" }`          | Created profile (becomes active) |
| `PATCH`  | `/api/profiles/:id`        | any of `name`, `theme`                        | Updated profile           |
| `POST`   | `/api/profiles/:id/activate` | —                                           | Updated active profile    |
| `DELETE` | `/api/profiles/:id`        | —                                             | `204`                     |
| `GET`    | `/api/settings`            | —                                             | `{ etherFactor }`         |
| `PATCH`  | `/api/settings`            | `{ "etherFactor": 0.5 }`                      | Updated settings          |
| `GET`    | `/api/habits`              | —                                             | `{ today, habits[], profile, profiles[], settings, ether }` |
| `POST`   | `/api/habits`              | `{ "name": "...", "difficulty": 5, "days": [1,3,5] }` | Created habit     |
| `PATCH`  | `/api/habits/:id`          | any of `name`, `difficulty`, `days`           | Updated habit             |
| `DELETE` | `/api/habits`              | —                                             | `204`                     |
| `POST`   | `/api/habits/:id/toggle`   | `{ "done": true }`                            | Updated habit             |
| `DELETE` | `/api/habits/:id`          | —                                             | `204`                     |
| `GET`    | `/api/health`              | —                                             | `{ ok, today }`           |

`GET /dashboard` and `GET /settings` serve the same single-page document as `/`; the client
chooses which view to show from the URL. This keeps the HTML, theme bootstrap, and profile bar in
one place without a build step.

All `/api/habits` routes apply to the **active profile**. A profile summary is
`{ id, name, theme, habitCount, ether }`. `theme` must be one of the palette ids below; it
defaults to `ember`. Creating a profile switches to it, and deleting the active profile switches
to the first remaining one. The last profile cannot be deleted.

`GET /api/habits` also returns the active profile's `ether` summary:

```json
{
  "factor": 1,
  "total": 42,
  "today": 9,
  "last7": 28,
  "days": [{ "date": "2026-11-11", "ether": 4 }, "… seven days ending today"]
}
```

Each public habit includes `reward` (what completing it today would earn) and `earnedToday`.
`PATCH /api/settings` changes the global factor; it accepts values from `0.1` to `10` and only
affects future completions.

`difficulty` must be a whole number from 1 to 10 and defaults to `5` when omitted.
`days` is an array of weekdays using `0 = Sunday ... 6 = Saturday`; it defaults to all seven
days (daily). Send at least one day. Duplicates are removed and the result is sorted.

`toggle` also works with no body, in which case it flips today's state. Sending `done` explicitly
is safer against double taps. `DELETE /api/habits` wipes the active profile's habits and history.

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

The palette button in the header switches the accent colour between **Ember** (default), **Blue**,
**Teal**, **Green**, **Lime**, **Violet**, and **Rose**. Blue and green each have two shades
(blue/teal and green/lime).

The choice belongs to the **active profile** and is saved to `data.json` via
`PATCH /api/profiles/:id`, so switching profiles switches the theme too. A copy is kept in
`localStorage` and applied by a tiny inline script before first paint so there is no colour flash
on reload.

The palette colours the **Dashboard** and the habit content. Shared chrome — the nav bar, header,
profile row, and Settings controls — stays neutral grey so it does not compete with the selected
theme.

To add a palette, define a `[data-theme="name"]` block of accent variables in
`public/styles.css`, add the matching `{ id, name }` entry to `THEMES` in `public/app.js`, and add
the id to `THEME_IDS` in `server.js`.

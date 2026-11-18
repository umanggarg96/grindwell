# TODO

Project tasks for **grindwell**. Check off completed items and add new work below.

## Inbox

Nothing queued right now.

## Done

- [x] Auto-recurring jobs: post a job on chosen weekdays, fail any occurrence left in the inbox at twice its reward (split across profiles), allow deleting a single occurrence to skip it, and list/stop series from the Jobs page.
- [x] Fill Shop items without Amazon credentials: read the public `amazon.in` product page (rate-limited, cached, switchable off) and add a drag-to-bookmarks helper that prefills the form from the page the browser already loaded.
- [x] Auto-fill new Shop items from `amazon.in` links with the official Amazon Creators API `GetItems` operation: fetch the title, image, and current price (rounded to ether), keep the form editable, and return a clear `503` when credentials are not configured.
- [x] Add a shared Jobs page: post a job with an ether reward and minute ETA, claim it into a four-column Kanban board (Inbox, In progress, Completed, Failed, max three in progress per profile), complete it for a time-based multiplier, or let it auto-fail into the Failed column with a penalty.
- [x] Add automatic ether penalties for missed scheduled habits: each habit has an urgency from 0 to 10, a global urgency factor lives in Settings, and the Dashboard shows net ether with negative bars.
- [x] Add sound configuration to the Settings page for habit completion and shop purchases: include sample sounds and a way to add more sounds.
- [x] Add a Trends card to the Dashboard that tracks how many habits are completed each day, with both 7-day and 30-day views supported.
- [x] Make the grindwell app icon configurable by clicking it: include example icons and allow loading more icons.
- [x] Split the Dashboard into Ether trends and Habit trends sub-pages and give every profile its own habit chart instead of one merged graph.


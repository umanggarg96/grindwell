# TODO

Project tasks for **grindwell**. Check off completed items and add new work below.

## Inbox

- Auto-fill new Shop items from `amazon.in` links: fetch the price, a short name, and the product image. Research found Amazon's official [Creators API `GetItems`](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/api-reference/operations/get-items) (the successor to deprecated PA-API 5) supports title, image, and price for India (`www.amazon.in`, `INR`), but needs Associates credentials and 10 qualifying sales. Prefer the official API over brittle page scraping; keep the form editable when lookup is unavailable.

## Done

- [x] Add a shared Jobs page: post a job with an ether reward and minute ETA, claim it into a per-profile in-progress box (max three), complete it for a time-based multiplier, or let it auto-fail into a Failed box with a penalty.
- [x] Add automatic ether penalties for missed scheduled habits: each habit has an urgency from 0 to 10, a global urgency factor lives in Settings, and the Dashboard shows net ether with negative bars.
- [x] Add sound configuration to the Settings page for habit completion and shop purchases: include sample sounds and a way to add more sounds.
- [x] Add a Trends card to the Dashboard that tracks how many habits are completed each day, with both 7-day and 30-day views supported.
- [x] Make the grindwell app icon configurable by clicking it: include example icons and allow loading more icons.
- [x] Split the Dashboard into Ether trends and Habit trends sub-pages and give every profile its own habit chart instead of one merged graph.


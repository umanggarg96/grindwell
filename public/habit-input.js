/* Compact habit input: "name ; difficulty ; days to skip".
   Loaded as a plain script in the browser, and exported for Node tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HabitInput = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
  const DEFAULT_DIFFICULTY = 5;
  const MAX_NAME_LENGTH = 60;

  const DAY_ALIASES = {
    su: 0,
    sun: 0,
    sunday: 0,
    mo: 1,
    mon: 1,
    monday: 1,
    tu: 2,
    tue: 2,
    tues: 2,
    tuesday: 2,
    we: 3,
    wed: 3,
    weds: 3,
    wednesday: 3,
    th: 4,
    thu: 4,
    thur: 4,
    thurs: 4,
    thursday: 4,
    fr: 5,
    fri: 5,
    friday: 5,
    sa: 6,
    sat: 6,
    saturday: 6,
  };

  function parseSkipDays(text) {
    const skip = new Set();
    for (const token of String(text).split(/[\s,]+/).filter(Boolean)) {
      const day = DAY_ALIASES[token.toLowerCase()];
      if (day === undefined) {
        throw new Error(`Unknown day "${token}". Use mo, tu, we, th, fr, sa, su, or full names.`);
      }
      skip.add(day);
    }
    return skip;
  }

  function parseHabitInput(raw) {
    const parts = String(raw).split(';').map((part) => part.trim());
    if (parts.length > 3) {
      throw new Error('Use at most two semicolons: name ; difficulty ; days to skip.');
    }

    const [rawName, second = '', third = ''] = parts;
    const name = rawName.replace(/\s+/g, ' ');

    if (!name) throw new Error('Give the habit a name.');
    if (name.length > MAX_NAME_LENGTH) {
      throw new Error(`Keep names under ${MAX_NAME_LENGTH} characters.`);
    }

    let difficulty = DEFAULT_DIFFICULTY;
    let daysText = '';

    if (second) {
      if (/^\d+$/.test(second)) {
        difficulty = Number(second);
        daysText = third;
      } else if (third) {
        throw new Error('Put the difficulty (1-10) before the days, separated by semicolons.');
      } else {
        // "name ; sat,sun" is accepted as shorthand for skipping those days.
        daysText = second;
      }
    } else {
      daysText = third;
    }

    if (difficulty < 1 || difficulty > 10) {
      throw new Error('Difficulty must be a whole number from 1 to 10.');
    }

    const skip = parseSkipDays(daysText);
    const days = ALL_DAYS.filter((day) => !skip.has(day));
    if (days.length === 0) {
      throw new Error('A habit needs at least one day. Do not skip all seven.');
    }

    return { name, difficulty, days };
  }

  return { parseHabitInput };
});

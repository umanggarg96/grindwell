(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.JobMath = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MINUTE_MS = 60000;

  // Multiplier is based on how much of the ETA has elapsed when the job is
  // finished. More than twice the ETA is a failure, not a payout.
  function jobOutcome(elapsedMs, etaMinutes) {
    const eta = Number(etaMinutes) * MINUTE_MS;
    const elapsed = Math.max(0, Number(elapsedMs) || 0);
    if (!(eta > 0)) return { multiplier: null, failed: true };

    const ratio = elapsed / eta;
    if (ratio <= 0.5) return { multiplier: 2, failed: false };
    if (ratio < 1) return { multiplier: 1.5, failed: false };
    if (ratio <= 1.1) return { multiplier: 1, failed: false };
    if (ratio <= 2) return { multiplier: 0.5, failed: false };
    return { multiplier: -0.5, failed: true };
  }

  // Signed whole ether: positive for a completed job, negative for a failure.
  function jobPayout(reward, multiplier) {
    const base = Math.max(1, Math.round(Number(reward) || 0));
    const factor = Number(multiplier);
    if (!(factor > 0)) {
      return -Math.max(1, Math.round(base * Math.abs(factor || 0)));
    }
    return Math.max(1, Math.round(base * factor));
  }

  function formatDuration(ms) {
    const totalMinutes = Math.max(0, Math.round(Math.abs(Number(ms) || 0) / MINUTE_MS));
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    const parts = [];
    if (days) parts.push(`${days}d`);
    if (hours) parts.push(`${hours}h`);
    if (minutes || parts.length === 0) parts.push(`${minutes}m`);
    return parts.join(' ');
  }

  return { MINUTE_MS, jobOutcome, jobPayout, formatDuration };
});

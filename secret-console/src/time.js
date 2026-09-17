'use strict';

const TOKYO_OFFSET_MS = 9 * 60 * 60 * 1000;

function toTokyoIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError('Invalid date');
  return new Date(date.getTime() + TOKYO_OFFSET_MS)
    .toISOString()
    .replace('Z', '+09:00');
}

module.exports = { toTokyoIso };

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { listRailTrains, validateRailStatic } from '../rail/static-provider.js';

const example = JSON.parse(await readFile(new URL('../rail/rail-static.example.json', import.meta.url)));
const epoch = (date, time) => Date.parse(`${date}T${time}:00+09:00`) / 1000;
const copy = () => structuredClone(example);

test('user-managed sample has both calendars and no fictional Nambu trains', () => {
  assert.equal(validateRailStatic(example), example);
  assert.equal(example.management, 'user');
  assert.equal(example.sample, true);
  assert.deepEqual([...new Set(example.trains.map((row) => row.calendarType))].sort(),
    ['weekday', 'weekend']);
  assert.equal(example.trains.filter((row) => row.route === 'tamagawa_to_noborito').length, 34);
  assert.equal(example.trains.filter((row) => row.route === 'tachikawa_to_mizonokuchi').length, 0);
});

test('selector starts with the next five source departures and can page back to a departed train', () => {
  const result = listRailTrains({ artifact: example, journeyId: 'university',
    now: epoch('2026-09-28', '18:02') });
  assert.equal(result.calendarType, 'weekday');
  assert.equal(result.trains.length, 5);
  assert.equal(result.trains[0].sourceDeparture, '18:20');
  assert.equal(result.hasPrevious, true);
  const previous = listRailTrains({ artifact: example, journeyId: 'university',
    now: epoch('2026-09-28', '18:02'), page: -1 });
  assert.equal(previous.trains.at(-1).sourceDeparture, '18:00');
  assert.equal(previous.trains.at(-1).stationTimes.mukougaoka, epoch('2026-09-28', '18:18'));
  assert.equal(previous.trains.at(-1).stationTimes.noborito, epoch('2026-09-28', '18:21'));
  assert.equal(previous.hasNext, true);
});

test('school stations remain in the actual Noborito then Musashi-Mizonokuchi order', () => {
  const result = listRailTrains({ artifact: example, journeyId: 'high_school',
    now: epoch('2026-09-28', '18:35') });
  assert.deepEqual(result.trains, []);
});

test('weekend and explicit user calendar overrides select their own rows', () => {
  const saturday = listRailTrains({ artifact: example, journeyId: 'university',
    now: epoch('2026-10-03', '18:04') });
  assert.equal(saturday.calendarType, 'weekend');
  assert.equal(saturday.trains[0].sourceDeparture, '18:05');
  const edited = copy();
  edited.calendarOverrides['2026-09-28'] = 'weekend';
  const holiday = listRailTrains({ artifact: edited, journeyId: 'university',
    now: epoch('2026-09-28', '18:04') });
  assert.equal(holiday.calendarType, 'weekend');
  assert.equal(holiday.trains[0].sourceDeparture, '18:05');
});

test('signed pages move in five-train blocks and stop at service-date boundaries', () => {
  const first = listRailTrains({ artifact: example, journeyId: 'university',
    now: epoch('2026-09-28', '17:55') });
  const next = listRailTrains({ artifact: example, journeyId: 'university',
    now: epoch('2026-09-28', '17:55'), page: 1 });
  assert.equal(first.hasPrevious, true);
  assert.equal(next.hasPrevious, true);
  assert.ok(next.trains[0].sourceDepartureAt > first.trains[4].sourceDepartureAt);
  assert.equal(new Set([...first.trains, ...next.trains].map((row) => row.id)).size, 10);
  const start = listRailTrains({ artifact: example, journeyId: 'university',
    now: epoch('2026-09-28', '06:00') });
  assert.equal(start.hasPrevious, false);
  const end = listRailTrains({ artifact: example, journeyId: 'university',
    now: epoch('2026-09-28', '21:59') });
  assert.equal(end.hasNext, false);
  const afterLast = listRailTrains({ artifact: example, journeyId: 'university',
    now: epoch('2026-09-28', '22:30') });
  const lastFive = listRailTrains({ artifact: example, journeyId: 'university',
    now: epoch('2026-09-28', '22:30'), page: -1 });
  assert.equal(afterLast.trains.length, 0);
  assert.equal(afterLast.hasPrevious, true);
  assert.equal(lastFive.trains.length, 5);
  assert.equal(lastFive.hasNext, false);
});

test('malformed, duplicated and reverse-order input fails closed', () => {
  const reverse = copy();
  reverse.trains.find((row) => row.route === 'tamagawa_to_noborito')
    .candidateStations.reverse();
  assert.throws(() => validateRailStatic(reverse), /RAIL_STATIC_INVALID/);
  const duplicate = copy();
  duplicate.trains.push(structuredClone(duplicate.trains[0]));
  assert.throws(() => validateRailStatic(duplicate), /RAIL_STATIC_INVALID/);
  const impossible = copy();
  impossible.trains[0].candidateStations[0].stationTime = impossible.trains[0].sourceDeparture;
  assert.throws(() => validateRailStatic(impossible), /RAIL_STATIC_INVALID/);
  const unknownHoliday = copy();
  unknownHoliday.calendarOverrides['2026-09-28'] = 'guessed';
  assert.throws(() => validateRailStatic(unknownHoliday), /RAIL_STATIC_INVALID/);
  assert.throws(() => listRailTrains({ artifact: example, journeyId: 'unknown',
    now: epoch('2026-09-28', '18:00') }), /RAIL_STATIC_INVALID/);
});

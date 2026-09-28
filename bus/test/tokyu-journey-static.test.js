import test from 'node:test';
import assert from 'node:assert/strict';
import { MUKOUGAOKA_TO_KIBUKIHONCHO as QUERY } from '../providers/tokyu/config.js';
import { getFutureTokyuBuses, normalizeTokyuJourneyTimetables } from '../providers/tokyu/journey-static.js';

const epoch = (date, time) => Date.parse(`${date}T${time}:00+09:00`) / 1000;
const trip = (calendar, number, departure, arrival, override = {}) => ({
  'owl:sameAs': `odpt.BusTimetable:TokyuBus.synthetic.${calendar}.${number}`,
  'odpt:operator': QUERY.operatorId, 'odpt:busroutePattern': QUERY.routePatternId,
  'odpt:calendar': `odpt.Calendar:${calendar}`,
  'odpt:busTimetableObject': [
    { 'odpt:index': QUERY.fromStopIndex, 'odpt:busstopPole': QUERY.fromStopId,
      'odpt:departureTime': departure },
    { 'odpt:index': QUERY.targetStopIndex, 'odpt:busstopPole': QUERY.targetStopId,
      'odpt:arrivalTime': arrival }
  ], ...override
});
const fixture = () => [
  trip('Weekday', 1, '18:27', '18:39'), trip('Weekday', 2, '18:45', '18:57'),
  trip('Saturday', 1, '18:29', '18:41'), trip('Holiday', 1, '18:31', '18:43')
];

test('Tokyu trip timetable joins exact route, pole indices and scheduled home arrival', () => {
  const index = normalizeTokyuJourneyTimetables(fixture());
  const buses = getFutureTokyuBuses({ index, now: epoch('2026-09-28', '18:00'),
    boardingAt: epoch('2026-09-28', '18:26') });
  assert.equal(buses[0].provider, 'tokyu');
  assert.equal(buses[0].departureAt, epoch('2026-09-28', '18:27'));
  assert.equal(buses[0].estimatedArrival, epoch('2026-09-28', '18:39'));
  assert.equal(buses[0].timingQuality, 'static_only');
  assert.equal(buses[0].delayMinutes, null);
  assert.equal(buses[0].queryId, QUERY.sourceId);
});

test('Sunday and official holidays use the matching BusTimetable Holiday calendar', () => {
  const index = normalizeTokyuJourneyTimetables(fixture());
  for (const date of ['2026-09-27', '2026-10-12']) {
    const buses = getFutureTokyuBuses({ index, now: epoch(date, '18:00'),
      boardingAt: epoch(date, '18:26') });
    assert.equal(buses[0].departureAt, epoch(date, '18:31'));
    assert.equal(buses[0].estimatedArrival, epoch(date, '18:43'));
  }
});

test('Future boarding time and horizon control candidates, without claiming realtime', () => {
  const index = normalizeTokyuJourneyTimetables(fixture());
  const buses = getFutureTokyuBuses({ index, now: epoch('2026-09-28', '18:00'),
    boardingAt: epoch('2026-09-28', '18:28'), horizonSec: 30 * 60 });
  assert.equal(buses.length, 1);
  assert.equal(buses[0].departureAt, epoch('2026-09-28', '18:45'));
  assert.equal(buses[0].estimatedDeparture, null);
});

test('Mismatched stop, duplicate departure, missing arrival and unknown calendar fail closed', () => {
  for (const invalid of [
    (rows) => { rows[0]['odpt:busTimetableObject'][1]['odpt:busstopPole'] = QUERY.fromStopId; },
    (rows) => { rows[1]['odpt:busTimetableObject'][0]['odpt:departureTime'] = '18:27'; },
    (rows) => { delete rows[0]['odpt:busTimetableObject'][1]['odpt:arrivalTime']; },
    (rows) => { rows[0]['odpt:calendar'] = 'odpt.Calendar:Special'; }
  ]) {
    const rows = fixture(); invalid(rows);
    assert.throws(() => normalizeTokyuJourneyTimetables(rows), /BUS_TOKYU_JOURNEY_INVALID/);
  }
});

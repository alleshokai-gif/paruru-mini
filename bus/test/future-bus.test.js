import test from 'node:test';
import assert from 'node:assert/strict';
import { getFutureBuses } from '../journey/future-bus.js';
import { indexFixture, NOW, P0_INPUT } from './fixtures.js';

const query = P0_INPUT.queries.find((item) => item.id === 'noborito_to_home');
const epoch = (time) => Date.parse(`2026-09-10T${time}:00+09:00`) / 1000;

function indexWithThree() {
  const index = indexFixture(), original = index.directions[query.id][0];
  index.directions = { ...index.directions, [query.id]: ['08:05', '08:15', '08:30'].map((time, i) => ({
    ...original, tripId: `future-${i}`, startTime: `${time}:00`,
    scheduledSeconds: epoch(time) - epoch('00:00'),
    scheduledArrivalSeconds: epoch(['08:20', '08:29', '08:43'][i]) - epoch('00:00')
  })) };
  return index;
}

function realtime(updates) {
  return { timestamp: NOW, updates: updates.map(({ i, departure, arrival, relationship = 0 }) => ({
    trip: { tripId: `future-${i}`, routeId: query.routeIds[0], startDate: '20260910',
      startTime: `${['08:05', '08:15', '08:30'][i]}:00`, relationship }, timestamp: NOW,
    stops: [{ stopId: query.fromStopIds[0], sequence: 1, relationship: 0,
      departure: departure == null ? null : { time: departure, delay: departure - epoch(['08:05', '08:15', '08:30'][i]) } },
    { stopId: query.toStopIds[0], sequence: 9, relationship: 0,
      arrival: arrival == null ? null : { time: arrival, delay: 0 } }]
  })) };
}

test('future boarding selects buses after transfer, preserving earlier static before later realtime', () => {
  const index = indexWithThree();
  const result = getFutureBuses({ index, queries: [query], providerContext: P0_INPUT.providerContext,
    realtime: realtime([{ i: 1, departure: epoch('08:18'), arrival: epoch('08:34') }]),
    now: NOW, boardingAt: epoch('08:02') });
  const rows = result.results[0].arrivals;
  assert.deepEqual(rows.map((row) => row.departureTime), ['08:05', '08:18', '08:30']);
  assert.deepEqual(rows.map((row) => row.timingQuality),
    ['static_only', 'realtime_arrival', 'static_only']);
  assert.deepEqual(rows.map((row) => row.homeArrivalTime), ['08:20', '08:34', '08:43']);
  assert.equal(rows[0].delayMinutes, null);
});

test('future query excludes missed or cancelled trips and projects only a labeled departure delay', () => {
  const index = indexWithThree();
  const result = getFutureBuses({ index, queries: [query], providerContext: P0_INPUT.providerContext,
    realtime: realtime([{ i: 0, departure: epoch('08:00') },
      { i: 1, departure: epoch('08:20') }, { i: 2, relationship: 3 }]),
    now: NOW, boardingAt: epoch('08:03') });
  const rows = result.results[0].arrivals;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].departureTime, '08:20');
  assert.equal(rows[0].homeArrivalTime, '08:34');
  assert.equal(rows[0].timingQuality, 'departure_delay_projection');
  assert.equal(rows[0].delayMinutes, 5);
});

test('uncertain departure falls below normal future trips without being presented as catchable', () => {
  const index = indexWithThree();
  const result = getFutureBuses({ index, queries: [query], providerContext: P0_INPUT.providerContext,
    now: NOW, boardingAt: epoch('08:00'), departureStateForTrip: ({ row }) =>
      row.tripId === 'future-0' ? 'departure_uncertain' : 'scheduled' });
  const rows = result.results[0].arrivals;
  assert.deepEqual(rows.map((row) => row.tripId.slice(-8)), ['future-1', 'future-2', 'future-0']);
  assert.equal(rows[2].recommendable, false);
  assert.equal(rows[2].departureState, 'departure_uncertain');
});

test('missing GTFS target arrival remains unknown instead of fabricated', () => {
  const index = indexWithThree(); index.directions[query.id][0].scheduledArrivalSeconds = null;
  const row = getFutureBuses({ index, queries: [query], providerContext: P0_INPUT.providerContext,
    now: NOW, boardingAt: epoch('08:00') }).results[0].arrivals.find((item) => item.tripId.endsWith('future-0'));
  assert.equal(row.homeArrivalTime, null);
  assert.equal(row.timingQuality, 'arrival_unknown');
  assert.equal(row.recommendable, false);
});

test('unconfirmed origin remains advisory after scheduled time, never catchable', () => {
  const index = indexWithThree();
  index.directions[query.id][0].isOrigin = true;
  const rows = getFutureBuses({ index, queries: [query], providerContext: P0_INPUT.providerContext,
    now: epoch('08:07'), boardingAt: epoch('08:10'), departureStateForTrip: ({ row }) =>
      row.tripId === 'future-0' ? { state: 'departure_overdue', keep: true,
        actionability: 'uncertain' } : 'scheduled' }).results[0].arrivals;
  assert.equal(rows.at(-1).tripId.endsWith('future-0'), true);
  assert.equal(rows.at(-1).departureState, 'departure_overdue');
  assert.equal(rows.at(-1).recommendable, false);
  assert.equal(rows[0].tripId.endsWith('future-1'), true);
});

test('unconfirmed origin without a positive keep decision cannot persist past boarding time', () => {
  const index = indexWithThree();
  index.directions[query.id][0].isOrigin = true;
  const rows = getFutureBuses({ index, queries: [query], providerContext: P0_INPUT.providerContext,
    now: epoch('08:07'), boardingAt: epoch('08:10'), departureStateForTrip: ({ row }) =>
      row.tripId === 'future-0' ? 'departure_overdue' : 'scheduled' }).results[0].arrivals;
  assert.equal(rows.some((row) => row.tripId.endsWith('future-0')), false);
});

test('future origin with do-not-recommend actionability stays advisory', () => {
  const index = indexWithThree();
  index.directions[query.id][0].isOrigin = true;
  const row = getFutureBuses({ index, queries: [query], providerContext: P0_INPUT.providerContext,
    now: NOW, boardingAt: epoch('08:00'), departureStateForTrip: ({ row }) => row.tripId === 'future-0'
      ? { state: 'departure_pending', keep: true, actionability: 'do_not_recommend' }
      : 'scheduled' }).results[0].arrivals.find((item) => item.tripId.endsWith('future-0'));
  assert.equal(row.recommendable, false);
});

test('past ordinary stop and past scheduled origin remain excluded', () => {
  const index = indexWithThree();
  index.directions[query.id][0].isOrigin = true;
  const rows = getFutureBuses({ index, queries: [query], providerContext: P0_INPUT.providerContext,
    now: epoch('08:07'), boardingAt: epoch('08:10') }).results[0].arrivals;
  assert.equal(rows.some((row) => row.tripId.endsWith('future-0')), false);
});

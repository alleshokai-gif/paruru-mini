import test from 'node:test';
import assert from 'node:assert/strict';
import { createStopSequenceObserver } from '../position/stop-sequence.js';
import { normalizeHubArrival } from '../hub/model.js';

const NOW = Date.parse('2026-09-29T07:30:00+09:00') / 1000;
const date = '20260929';
const ids = ['home_to_noborito', 'home_to_mizonokuchi', 'mizonokuchi_to_home',
  'noborito_to_home', 'mukougaoka_to_kibukihoncho', 'kibukihoncho_to_miyamae_washigamine',
  'kibukihoncho_to_noborito_tamagawa', 'noborito_tamagawa_to_kibukihoncho'];
const rows = Object.fromEntries(ids.map((id, n) => [id, [{ tripId: `trip-${n}`, routeId: `route-${n}`,
  serviceId: 'weekday', startTime: '07:00:00', fromStopId: `boarding-${n}`, stopSequence: 3,
  toStopId: `terminal-${n}`, alightSequence: 5 }]]));
const index = { directions: rows, calendar: [{ service_id: 'weekday', start_date: date, end_date: date,
  monday: '0', tuesday: '1', wednesday: '0', thursday: '0', friday: '0', saturday: '0', sunday: '0' }],
calendarDates: [] };
const stops = Object.fromEntries(ids.flatMap((_, n) => [1, 2, 3, 4, 5].map((seq) =>
  [`${seq === 3 ? 'boarding' : seq === 5 ? 'terminal' : 'stop-' + seq}-${n}`,
    { name: `停留所${seq}-${n}` }])));
const staticData = { stops,
  trips: Object.fromEntries(ids.map((_, n) => [`trip-${n}`, { routeId: `route-${n}`, chainId: `chain-${n}` }])),
  chains: Object.fromEntries(ids.map((_, n) => [`chain-${n}`, { stops: [1, 2, 3, 4, 5]
    .map((sequence) => ({ sequence, stopId: `${sequence === 3 ? 'boarding' : sequence === 5 ? 'terminal' : 'stop-' + sequence}-${n}` })) }])) };
const vehicle = (n, changes = {}) => ({ trip: { tripId: `trip-${n}`, startDate: date,
  routeId: `route-${n}`, startTime: '07:00:00', relationship: 0 },
  timestamp: NOW - 10, sequence: 2, status: 2, stopId: `stop-2-${n}`,
  position: { lat: null, lon: null }, vehicleId: `private-${n}`, ...changes });
const feed = (vehicles, timestamp = NOW - 10) => ({ timestamp, vehicles });
const key = (n) => `${date}:trip-${n}:boarding-${n}:3`;

test('all eight Kawasaki query chains provide stop-level location without geometry or GPS', () => {
  const observer = createStopSequenceObserver({ index, positionStatic: staticData });
  observer.observe({ realtime: feed(ids.map((_, n) => vehicle(n))), now: NOW });
  const snapshot = observer.snapshot();
  assert.equal(snapshot.size, 8);
  for (let n = 0; n < ids.length; n++) {
    assert.deepEqual(snapshot.get(key(n)), { supported: true, fidelity: 'stop_sequence',
      state: 'near_stop', previousStop: `停留所1-${n}`, nextStop: `停留所2-${n}`,
      stopsAway: 1, observedAt: NOW - 10 });
  }
  assert.doesNotMatch(JSON.stringify([...snapshot.values()]), /private-|"lat"|"lon"/);
});

test('service, trip, route, stop and freshness mismatches do not invent position', () => {
  const observer = createStopSequenceObserver({ index, positionStatic: staticData });
  for (const wrong of [
    { trip: { ...vehicle(0).trip, routeId: 'wrong' } },
    { trip: { ...vehicle(0).trip, startDate: '20260930' } },
    { stopId: 'wrong' }, { sequence: 9 }, { sequence: 4, stopId: 'stop-4-0' },
    { timestamp: NOW - 121 }, { status: 8 }
  ]) {
    observer.observe({ realtime: feed([vehicle(0, wrong)]), now: NOW });
    assert.equal(observer.snapshot().size, 0);
  }
  observer.observe({ realtime: feed([vehicle(0)], NOW - 121), now: NOW });
  assert.equal(observer.snapshot().size, 0);
  observer.observe({ realtime: feed([vehicle(0), vehicle(0, { vehicleId: 'other' })]), now: NOW });
  assert.equal(observer.snapshot().size, 0);
});

test('stop-level Hub DTO keeps only stop names, count and timestamp', () => {
  const observer = createStopSequenceObserver({ index, positionStatic: staticData });
  observer.observe({ realtime: feed([vehicle(0)]), now: NOW });
  const value = normalizeHubArrival({ id: 'id', sourceId: ids[0], provider: 'kawasaki', routeId: 'route-0',
    routeLabel: '登05', destination: '登戸駅', originStop: { id: 'boarding-0', name: '神木本町' },
    targetStop: { id: 'boarding-0', name: '神木本町' }, scheduledDeparture: NOW + 300,
    estimatedDeparture: NOW + 360, etaMinutes: 6, delayMinutes: 1, platform: '2番',
    realtimeState: 'realtime', departureState: 'realtime',
    position: observer.snapshot().get(key(0)) }, NOW);
  assert.equal(value.position.fidelity, 'stop_sequence');
  assert.equal(value.position.stopsAway, 1);
  assert.doesNotMatch(JSON.stringify(value), /private-|"lat"|"lon"|"confidence":0/);
});

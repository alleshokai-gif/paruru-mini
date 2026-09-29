import test from 'node:test';
import assert from 'node:assert/strict';
import { createTurnaroundObserver } from '../departure/turnaround-observer.js';

const NOW = Date.parse('2026-09-29T07:30:00+09:00') / 1000;
const row = { tripId: 'outgoing', routeId: '10035', serviceId: 'weekday', startTime: '07:30:00',
  fromStopId: 'origin', stopSequence: 1, isOrigin: true };
const index = { directions: { to_home: [row] }, calendar: [{ service_id: 'weekday',
  start_date: '20260929', end_date: '20260929', tuesday: '1' }], calendarDates: [] };
const staticData = { stops: { terminal: { name: '溝口駅南口' }, origin: { name: '溝口駅南口' },
  other: { name: '別の停留所' } },
trips: { incoming: { chainId: 'incoming' }, outgoing: { chainId: 'outgoing' },
  unrelated: { chainId: 'unrelated' } },
chains: { incoming: { stops: [{ stopId: 'other', sequence: 1 }, { stopId: 'terminal', sequence: 9 }] },
  outgoing: { stops: [{ stopId: 'origin', sequence: 1 }, { stopId: 'other', sequence: 2 }] },
  unrelated: { stops: [{ stopId: 'terminal', sequence: 1 }, { stopId: 'other', sequence: 9 }] } } };
const vp = (tripId, timestamp, changes = {}) => ({ vehicleId: 'private-vehicle', timestamp,
  sequence: tripId === 'incoming' ? 9 : 1, status: 1,
  trip: { tripId, startDate: '20260929', routeId: tripId === 'outgoing' ? '10035' : 'other',
    startTime: tripId === 'outgoing' ? '07:30:00' : '07:00:00' }, ...changes });

test('same vehicle at incoming terminal then assigned to origin trip yields only a coarse hint', () => {
  const observer = createTurnaroundObserver({ index, positionStatic: staticData });
  observer.observe({ realtime: { timestamp: NOW - 30, vehicles: [vp('incoming', NOW - 30)] }, now: NOW - 30 });
  observer.observe({ realtime: { timestamp: NOW, vehicles: [vp('outgoing', NOW)] }, now: NOW });
  const values = [...observer.snapshot().values()];
  assert.deepEqual(values, [{ status: 'high', incomingTerminal: '溝口駅南口', observedAt: NOW }]);
  assert.doesNotMatch(JSON.stringify(values), /private-vehicle/);
  observer.observe({ realtime: { timestamp: NOW + 25, vehicles: [vp('outgoing', NOW + 25)] }, now: NOW + 25 });
  assert.equal(observer.snapshot().size, 1);
});

test('unrelated terminal, missing identity or stale observation does not create turnaround hint', () => {
  for (const first of [vp('unrelated', NOW - 30), vp('incoming', NOW - 30, { vehicleId: null }),
    vp('incoming', NOW - 3600)]) {
    const observer = createTurnaroundObserver({ index, positionStatic: staticData });
    observer.observe({ realtime: { timestamp: first.timestamp, vehicles: [first] }, now: first.timestamp });
    observer.observe({ realtime: { timestamp: NOW, vehicles: [vp('outgoing', NOW)] }, now: NOW });
    assert.equal(observer.snapshot().size, 0);
  }
});

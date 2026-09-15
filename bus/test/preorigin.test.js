import test from 'node:test';
import assert from 'node:assert/strict';
import bindings from 'gtfs-realtime-bindings';
import { parseRealtime } from '../providers/kawasaki/adapter.js';
import { classifyRawVehiclePositions, createPreoriginTracker, extractKibukihonchoOriginTrips,
  PREORIGIN_OBSERVATION_FIELDS } from '../research/preorigin.js';
import { indexFixture } from './fixtures.js';

const HASH = 'h'.repeat(32), NOW = Date.parse('2026-09-14T07:00:00+09:00') / 1000;
const bytes = (vehicles) => bindings.transit_realtime.FeedMessage.encode(bindings.transit_realtime.FeedMessage.create({
  header: { gtfsRealtimeVersion: '2.0', timestamp: NOW, incrementality: 0 },
  entity: vehicles.map((vehicle, index) => ({ id: `entity-${index}`, vehicle }))
})).finish();
const vehicle = (patch = {}) => ({ vehicle: { id: 'raw-vehicle' }, timestamp: NOW,
  position: { latitude: 35.601, longitude: 139.583 }, ...patch });

test('research classifier retains HMAC-only tripless GPS rows that production parser intentionally drops', () => {
  const source = bytes([vehicle(), vehicle({ trip: { tripId: 'partial' } }),
    vehicle({ trip: { tripId: 'target', startDate: '20260914', routeId: '10035', scheduleRelationship: 0 } })]);
  const raw = classifyRawVehiclePositions(source, { hashKey: HASH, receivedAt: NOW });
  assert.deepEqual(raw.summary, { entities: 3, assigned: 1, unassignedCandidates: 1, partialAssignments: 1,
    unusable: 0, droppedByRuntimeParser: 2, tripIdMissing: 1, routeIdMissing: 2, positioned: 3,
    gpsMissing: 0, stale: 0 });
  assert.equal(parseRealtime(source, NOW).vehicles.length, 1);
  assert.ok(raw.vehicles.every((value) => value.vehicleHash?.startsWith('veh_')));
  assert.doesNotMatch(JSON.stringify(raw), /raw-vehicle|entity-/);
});

test('preorigin tracker creates Level A only for the same HMAC vehicle assignment transition', () => {
  const target = { tripId: 'target', serviceDate: '20260914', scheduledDeparture: NOW + 600 };
  const tracker = createPreoriginTracker({ origin: { lat: 35.601256, lon: 139.583436 }, targetTrips: [target] });
  let sample = classifyRawVehiclePositions(bytes([vehicle({ timestamp: NOW })]), { hashKey: HASH, receivedAt: NOW });
  let observed = tracker.observe({ sample, now: NOW });
  assert.equal(observed.records[0].level, 'B'); assert.equal(observed.records[0].preorigin_vehicle_seen, true);
  sample = classifyRawVehiclePositions(bytes([vehicle({ timestamp: NOW + 30,
    trip: { tripId: 'target', startDate: '20260914', routeId: '10035' } })]), { hashKey: HASH, receivedAt: NOW + 30 });
  observed = tracker.observe({ sample, now: NOW + 30 });
  assert.equal(observed.transitions.length, 1); assert.equal(observed.records[0].level, 'A');
  assert.equal(observed.records[0].seconds_before_scheduled, 570);
  assert.ok(observed.records[0].trip_assignment_transition_at);

  const unmatched = createPreoriginTracker({ origin: { lat: 35.601256, lon: 139.583436 }, targetTrips: [target] });
  unmatched.observe({ sample: classifyRawVehiclePositions(bytes([vehicle({ vehicle: { id: 'first' } })]),
    { hashKey: HASH, receivedAt: NOW }), now: NOW });
  const other = classifyRawVehiclePositions(bytes([vehicle({ vehicle: { id: 'second' }, timestamp: NOW + 30,
    trip: { tripId: 'target', startDate: '20260914', routeId: '10035' } })]), { hashKey: HASH, receivedAt: NOW + 30 });
  assert.equal(unmatched.observe({ sample: other, now: NOW + 30 }).transitions.length, 0);
});

test('raw classifier reports stale and GPS-missing entities and rotates hashes by service date', () => {
  const source = bytes([vehicle({ timestamp: NOW - 121 }), vehicle({ position: {} })]);
  const first = classifyRawVehiclePositions(source, { hashKey: HASH, receivedAt: NOW, hashScope: '20260914' });
  const second = classifyRawVehiclePositions(source, { hashKey: HASH, receivedAt: NOW, hashScope: '20260915' });
  assert.equal(first.summary.stale, 1); assert.equal(first.summary.gpsMissing, 1);
  assert.notEqual(first.vehicles[0].vehicleHash, second.vehicles[0].vehicleHash);
  assert.ok(first.vehicles.every((value) => !Object.hasOwn(value, 'vehicleId')));
});

test('stale, missing identity and off-corridor candidates never become incoming evidence', () => {
  const target = { tripId: 'target', serviceDate: '20260914', scheduledDeparture: NOW + 600 };
  const tracker = createPreoriginTracker({ origin: { lat: 35.601256, lon: 139.583436 }, targetTrips: [target] });
  const sample = classifyRawVehiclePositions(bytes([
    vehicle({ timestamp: NOW - 121 }), vehicle({ vehicle: {}, timestamp: NOW }),
    vehicle({ vehicle: { id: 'far' }, position: { latitude: 35.7, longitude: 139.7 } })
  ]), { hashKey: HASH, receivedAt: NOW });
  assert.equal(tracker.observe({ sample, now: NOW }).records.length, 0);
});

test('Kibukihoncho origin extraction requires exact verified stop, route and origin flag', () => {
  const index = indexFixture(), row = index.directions.home_to_mizonokuchi[0];
  index.directions.home_to_mizonokuchi = [
    { ...row, tripId: 'target', routeId: '10035', originStopId: '184_1', fromStopId: '184_1', isOrigin: true },
    { ...row, tripId: 'mid-route', routeId: '10035', originStopId: 'other', isOrigin: false }
  ];
  assert.deepEqual(extractKibukihonchoOriginTrips(index).map((value) => value.tripId), ['target']);
});

test('preorigin research exposes the requested append-only Observation field contract', () => {
  assert.deepEqual(PREORIGIN_OBSERVATION_FIELDS, [
    'preorigin_vehicle_seen', 'preorigin_first_seen_at', 'preorigin_distance_to_origin',
    'trip_assignment_transition_at', 'seconds_before_scheduled', 'arrival_to_origin',
    'departure_positive_evidence'
  ]);
});

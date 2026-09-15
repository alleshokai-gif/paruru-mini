import test from 'node:test';
import assert from 'node:assert/strict';
import { PREORIGIN_HEADERS, finalizePreoriginObservation, preoriginObservationValues } from '../observation/preorigin-schema.js';
import { summarizePreoriginExecutions, summarizePreoriginRows } from '../observation/preorigin-report.js';

const KEY = 'synthetic-preorigin-report-key-0001';
const VEHICLE = `veh_${'a'.repeat(32)}`;
function observation(overrides = {}) {
  return finalizePreoriginObservation({
    run_id: 'run-a', sample_index: 0, observed_at: '2026-09-16T06:40:00+09:00',
    service_date: '20260916', target_trip_id: '4112_01_100002368',
    scheduled_departure: '2026-09-16T06:50:00+09:00', origin_stop_id: '184_1',
    route_id: '10035', platform: '1番', record_kind: 'target_snapshot',
    vehicle_classification: 'none', vehicle_hash: null, vehicle_timestamp: null,
    position_lat: null, position_lon: null, distance_to_origin_m: null, gps_age_sec: null,
    feed_timestamp: 1789508400, rt_age_sec: 0, raw_vehicle_entities: 4, assigned_count: 3,
    tripless_count: 1, partial_descriptor_count: 0, stale_count: 0, gps_missing_count: 0,
    runtime_dropped_count: 0, preorigin_vehicle_seen: false, preorigin_first_seen_at: null,
    preorigin_distance_to_origin: null, trip_assignment_transition_at: null,
    seconds_before_scheduled: 600, arrival_to_origin: null,
    departure_positive_evidence: null, evidence_level: 'undetermined', censored: false,
    ...overrides,
  }, KEY);
}
const sheet = (...rows) => [PREORIGIN_HEADERS, ...rows.map(preoriginObservationValues)];

test('report derives Level A only from an ordered same-HMAC transition', () => {
  const candidate = observation({ record_kind: 'vehicle_observation', vehicle_classification: 'unassigned_candidate',
    vehicle_hash: VEHICLE, vehicle_timestamp: 1789508400, position_lat: 35.6, position_lon: 139.58 });
  const assigned = observation({ sample_index: 1, observed_at: '2026-09-16T06:40:32+09:00',
    record_kind: 'assignment_transition', vehicle_classification: 'assigned', vehicle_hash: VEHICLE,
    vehicle_timestamp: 1789508432, feed_timestamp: 1789508432,
    trip_assignment_transition_at: '2026-09-16T06:40:32+09:00' });
  const result = summarizePreoriginRows(sheet(candidate, assigned), '2026-09-16');
  assert.equal(result.levelA.chains, 1);
  assert.equal(result.levelA.trips, 1);
  assert.equal(result.levelBCandidateTrips, 0);
  assert.equal(result.levelC, null);
  assert.equal(result.levelCStatus, 'not_auto_classified');
});

test('report keeps Level B as a candidate and never invents Level C', () => {
  const candidate = observation({ record_kind: 'vehicle_observation', vehicle_classification: 'partial_assignment',
    vehicle_hash: VEHICLE, vehicle_timestamp: 1789508400 });
  const result = summarizePreoriginRows(sheet(candidate), '2026-09-16');
  assert.equal(result.levelA.chains, 0);
  assert.equal(result.levelBCandidateTrips, 1);
  assert.equal(result.levelC, null);
});

test('duplicate conflicts and schema drift fail closed', () => {
  const row = observation();
  const duplicate = preoriginObservationValues(row);
  duplicate[PREORIGIN_HEADERS.indexOf('raw_vehicle_entities')] = 999;
  assert.throws(() => summarizePreoriginRows([PREORIGIN_HEADERS, preoriginObservationValues(row), duplicate], '2026-09-16'),
    /PREORIGIN_REPORT_DUPLICATE_CONFLICT/);
  assert.throws(() => summarizePreoriginRows([PREORIGIN_HEADERS.slice(1)], '2026-09-16'),
    /PREORIGIN_REPORT_INPUT_INVALID/);
});

test('execution summary separates success, failure, and running in JST', () => {
  const result = summarizePreoriginExecutions([
    { name: 'executions/success-a', createTime: '2026-09-15T21:35:00Z', completionTime: '2026-09-15T21:41:00Z', succeededCount: 1 },
    { name: 'executions/failure-a', createTime: '2026-09-15T22:00:00Z', completionTime: '2026-09-15T22:02:00Z', failedCount: 1 },
    { name: 'executions/running-a', createTime: '2026-09-15T23:00:00Z' },
    { name: 'executions/other-day', createTime: '2026-09-14T23:00:00Z', succeededCount: 1 },
  ], '2026-09-16');
  assert.deepEqual(result, { targetDate: '2026-09-16', count: 3, succeeded: 1, failed: 1, running: 1,
    latestExecution: 'running-a' });
});
import test from 'node:test';
import assert from 'node:assert/strict';
import { OBSERVATION_HEADERS } from '../observation/schema.js';
import { derivePositionEvaluations, evaluatePositionObservations } from '../observation/position-evaluator.js';
import { POSITION_DAILY_HEADERS, POSITION_EVALUATION_HEADERS, positionDailyValues,
  positionObservationValues } from '../observation/position-evaluator-schema.js';
import { prepareShape } from '../position/geometry.js';

const DATE = '2026-09-14';
const TARGET = { provider: 'kawasaki', directionId: 'home_to_noborito', routeId: '10044', targetStopId: 's3' };
const CHAIN = 'chain-1', VEHICLE = `veh_${'a'.repeat(32)}`;
const stops = [0, 0.01, 0.02, 0.03].map((offset, index) => ({
  stopId: `s${index}`, sequence: index + 1, position: { lat: 35 + offset, lon: 139 }
}));
const positionStatic = {
  sourceHash: 'source-hash',
  stops: Object.fromEntries(stops.map((stop) => [stop.stopId,
    { stopId: stop.stopId, name: stop.stopId, position: stop.position }])),
  chains: { [CHAIN]: { chainId: CHAIN, stops: stops.map(({ stopId, sequence }) => ({ stopId, sequence })) } },
  trips: {}
};
const artifact = (points = stops.map((stop) => stop.position), overrides = {}) => {
  const total = prepareShape(points).total;
  return {
    schemaVersion: 1, provider: 'kawasaki', routeId: TARGET.routeId,
    sourceType: 'validated_road_geometry', sourceVersion: 'fixture-v1',
    staticSourceHash: 'source-hash', generatedAt: `${DATE}T00:00:00.000Z`, directionId: TARGET.directionId,
    approvedForShadow: true, approvedForPublic: false, geometryReady: false,
    chains: { [CHAIN]: { geometryId: 'fixture-geometry', eligible: false, geometryReady: false,
      approvedForShadow: true, approvedForPublic: false, points, reasons: [],
      stopProjections: stops.map((stop, ordinal) => ({ stopId: stop.stopId, sequence: stop.sequence,
        ordinal, along: ordinal * total / (stops.length - 1), distance: 0 })), ...overrides } }
  };
};
let sequence = 0;
function row({ tripId = 'trip-1', lat, lon = 139, timestamp, age = 1, vehicleHash = VEHICLE,
  auxSequence = '', positionReason = 'route_geometry_unavailable' } = {}) {
  positionStatic.trips[tripId] = { tripId, routeId: TARGET.routeId, chainId: CHAIN, shapeId: null };
  const value = {
    observation_id: `obs_${(++sequence).toString(16).padStart(32, '0')}`, run_id: 'run-1', sample_index: sequence,
    observation_kind: 'position', observed_at: `${DATE}T07:00:00.000+09:00`, provider: TARGET.provider,
    direction_id: TARGET.directionId, route_id: TARGET.routeId, trip_id: tripId, service_date: '20260914',
    origin_stop_id: 's0', platform: '1番', scheduled_departure: `${DATE}T06:50:00.000+09:00`,
    evidence_type: '', departure_state: '', elapsed_from_scheduled_sec: '', gps_age_sec: age, rt_age_sec: 1,
    next_bus_gap_min: '', censored: false, vehicle_hash: vehicleHash, gps_timestamp: timestamp,
    position_lat: lat ?? '', position_lon: lat === undefined ? '' : lon, position_state: '', position_confidence: '',
    position_reason: positionReason, previous_stop_id: '', next_stop_id: '', position_segment_key: '',
    position_expected_segments: 3, aux_stop_id: '', aux_stop_sequence: auxSequence, aux_status: ''
  };
  return OBSERVATION_HEADERS.map((name) => value[name] ?? '');
}
function evaluate(rows, geometry = artifact()) {
  return evaluatePositionObservations({ rawValues: [OBSERVATION_HEADERS, ...rows], serviceDate: DATE,
    evaluatedAt: `${DATE}T21:00:00+09:00`, positionStatic, geometryArtifact: geometry, target: TARGET });
}

test('shadow evaluator snaps GPS to stop intervals and derives naturally decreasing stopsAway', () => {
  const base = Date.parse(`${DATE}T07:00:00+09:00`) / 1000;
  const result = evaluate([row({ lat: 35.005, timestamp: base }), row({ lat: 35.015, timestamp: base + 64 }),
    row({ lat: 35.025, timestamp: base + 128 })]);
  assert.equal(result.stage, 'stage_1_shadow'); assert.equal(result.snap_matched_rows, 3);
  assert.equal(result.snap_match_rate, 1);
  assert.equal(result.stops_away_rows, 3); assert.equal(result.severe_stops_away_contradiction_count, 0);
  assert.equal(result.direction_trace_count, 1); assert.equal(result.monotonic_trace_count, 1);
  assert.equal(result.direction_consistency, 1); assert.equal(result.observed_interval_count, 3);
  assert.equal(result.geometry_ready_candidate, false); assert.equal(result.decision, 'HOLD');
  assert.equal(positionDailyValues(result).length, POSITION_DAILY_HEADERS.length);
});

test('stale, missing and identity-missing GPS fail closed before geometry projection', () => {
  const base = Date.parse(`${DATE}T07:00:00+09:00`) / 1000;
  const result = evaluate([row({ timestamp: base }), row({ lat: 35.005, timestamp: base, age: 121 }),
    row({ lat: 35.006, timestamp: base + 32, vehicleHash: '' })]);
  assert.equal(result.gps_missing_rows, 1); assert.equal(result.gps_stale_rows, 1);
  assert.equal(result.identity_missing_rows, 1); assert.equal(result.snap_matched_rows, 0);
  assert.ok(JSON.parse(result.reason_codes).includes('NO_USABLE_GPS'));
});

test('reverse movement and stopsAway increase are retained as shadow contradictions, never public GO', () => {
  const base = Date.parse(`${DATE}T07:00:00+09:00`) / 1000;
  const result = evaluate([row({ lat: 35.025, timestamp: base }), row({ lat: 35.005, timestamp: base + 32 })]);
  assert.equal(result.reverse_or_jump_count, 1); assert.equal(result.severe_stops_away_contradiction_count, 1);
  const reasons = JSON.parse(result.reason_codes);
  assert.ok(reasons.includes('DIRECTION_CONTRADICTION_PRESENT'));
  assert.ok(reasons.includes('SEVERE_STOPS_AWAY_CONTRADICTION'));
  assert.equal(result.geometry_ready_candidate, false);
});

test('small stop-boundary jitter is counted separately from severe contradiction', () => {
  const base = Date.parse(`${DATE}T07:00:00+09:00`) / 1000;
  const result = evaluate([row({ lat: 35.0101, timestamp: base }), row({ lat: 35.0099, timestamp: base + 32 }),
    row({ lat: 35.0102, timestamp: base + 64 })]);
  assert.equal(result.stops_away_jitter_count, 1);
  assert.equal(result.severe_stops_away_contradiction_count, 0);
});

test('route crossing ambiguity and route-off GPS remain unsupported', () => {
  const base = Date.parse(`${DATE}T07:00:00+09:00`) / 1000;
  const crossing = artifact([
    { lat: 35, lon: 139 }, { lat: 35.03, lon: 139 }, { lat: 35.03, lon: 139.02 },
    { lat: 35.015, lon: 139 }, { lat: 35, lon: 139.02 }
  ]);
  const ambiguous = evaluate([row({ lat: 35.015, lon: 139, timestamp: base })], crossing);
  assert.equal(ambiguous.snap_ambiguous_rows, 1); assert.equal(ambiguous.snap_matched_rows, 0);
  const offRoute = evaluate([row({ lat: 35.01, lon: 139.01, timestamp: base })]);
  assert.equal(offRoute.snap_off_route_rows, 1); assert.equal(offRoute.snap_matched_rows, 0);
});

test('raw sequence is auxiliary evidence and cannot make a position supported', () => {
  const base = Date.parse(`${DATE}T07:00:00+09:00`) / 1000;
  const result = evaluate([row({ lat: 35.005, timestamp: base, auxSequence: 99 })]);
  assert.equal(result.aux_sequence_contradiction_count, 1); assert.equal(result.snap_matched_rows, 1);
  assert.equal(result.direction_trace_count, 0); assert.equal(result.geometry_ready_candidate, false);
});

test('research confidence threshold suppresses weak points without promoting geometryReady', () => {
  const base = Date.parse(`${DATE}T07:00:00+09:00`) / 1000;
  const weak = evaluate([row({ lat: 35.005, lon: 139.00035, timestamp: base, age: 120 })]);
  assert.equal(weak.confidence_fail_rows, 1); assert.equal(weak.snap_matched_rows, 0);
  assert.equal(weak.geometry_ready_candidate, false); assert.equal(weak.stage, 'stage_1_shadow');
});

test('raw schema, HMAC and response-shaped cell violations produce NO_GO without exposing values', () => {
  const badHeader = evaluatePositionObservations({ rawValues: [[...OBSERVATION_HEADERS, 'unexpected']], serviceDate: DATE,
    evaluatedAt: `${DATE}T21:00:00+09:00`, positionStatic, geometryArtifact: artifact(), target: TARGET });
  assert.equal(badHeader.decision, 'NO_GO');
  const base = Date.parse(`${DATE}T07:00:00+09:00`) / 1000;
  const invalid = row({ lat: 35.005, timestamp: base, vehicleHash: 'raw-vehicle-id' });
  invalid[OBSERVATION_HEADERS.indexOf('position_reason')] = '{"entity":"raw"}';
  const result = evaluate([invalid]);
  assert.equal(result.decision, 'NO_GO'); assert.equal(result.raw_id_count, 1); assert.equal(result.raw_response_count, 1);
  assert.doesNotMatch(JSON.stringify(result), /raw-vehicle-id|position_lat|position_lon/);
});

test('missing target identity is rejected before any Raw interpretation', () => {
  assert.throws(() => evaluatePositionObservations({ rawValues: [OBSERVATION_HEADERS], serviceDate: DATE,
    evaluatedAt: `${DATE}T21:00:00+09:00`, positionStatic, geometryArtifact: artifact(), target: null }),
  /POSITION_EVALUATOR_INPUT_INVALID/);
});

test('derived rows retain no raw GPS and use deterministic evaluation IDs', () => {
  const base = Date.parse(`${DATE}T07:00:00+09:00`) / 1000;
  const args = { rawValues: [OBSERVATION_HEADERS, row({ lat: 35.005, timestamp: base })], serviceDate: DATE,
    evaluatedAt: `${DATE}T21:00:00+09:00`, positionStatic, geometryArtifact: artifact(), target: TARGET };
  const first = derivePositionEvaluations(args), replay = derivePositionEvaluations(args);
  assert.equal(first.evaluations.length, 1);
  assert.equal(first.evaluations[0].evaluation_id, replay.evaluations[0].evaluation_id);
  assert.equal(first.daily.daily_id, replay.daily.daily_id);
  assert.equal(first.evaluations[0].candidate_stops_away, 2);
  assert.equal(first.evaluations[0].monotonicity_status, 'insufficient_history');
  assert.equal(positionObservationValues(first.evaluations[0]).length, POSITION_EVALUATION_HEADERS.length);
  assert.doesNotMatch(JSON.stringify(first.evaluations[0]), /position_lat|position_lon|35\.005/);
});

test('sequence and stop status remain auxiliary and cannot decide stopsAway', () => {
  const base = Date.parse(`${DATE}T07:00:00+09:00`) / 1000;
  const raw = row({ lat: 35.005, timestamp: base, auxSequence: 99 });
  raw[OBSERVATION_HEADERS.indexOf('aux_status')] = 'IN_TRANSIT_TO';
  const result = derivePositionEvaluations({ rawValues: [OBSERVATION_HEADERS, raw], serviceDate: DATE,
    evaluatedAt: `${DATE}T21:00:00+09:00`, positionStatic, geometryArtifact: artifact(), target: TARGET });
  assert.equal(result.evaluations[0].aux_consistency, 'conflict');
  assert.equal(result.evaluations[0].candidate_stops_away, 2);
  assert.equal(result.daily.aux_sequence_contradiction_count, 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OBSERVATION_HEADERS } from '../observation/schema.js';
import { derivePositionEvaluations } from '../observation/position-evaluator.js';
import { selectPositionGeometry, validatePositionGeometryBundle } from '../observation/position-evaluator-geometry.js';
import { NOBORITO_SHADOW_GEOMETRY, validateApprovedPositionShadowBundle }
  from '../observation/position-shadow-geometry.js';

const bundle = JSON.parse(readFileSync(new URL('../observation/position-shadow-geometry.json', import.meta.url), 'utf8'));
const source = bundle.sources[0], [chainId, candidate] = Object.entries(source.chains)[0];
const chain = { chainId, stops: candidate.stopProjections.map(({ stopId, sequence }) => ({ stopId, sequence })) };
const target = { provider: 'kawasaki', routeId: '10044', directionId: 'home_to_noborito', targetStopId: '362_1' };
const positionStatic = {
  schemaVersion: 1, provider: 'kawasaki', sourceHash: bundle.staticSourceHash,
  sourceVersion: source.sourceReferences.find((value) => value.type === 'gtfs_stop_sequence').sourceVersion,
  stops: Object.fromEntries(candidate.stopProjections.map((row) => [row.stopId, { stopId: row.stopId, name: row.stopId }])),
  chains: { [chainId]: chain },
  trips: { 'shadow-fixture-trip': { tripId: 'shadow-fixture-trip', routeId: '10044', chainId, shapeId: null } }
};

function raw(point, suffix = '1') {
  const value = {
    observation_id: `obs_${suffix.repeat(32)}`, run_id: 'shadow-artifact-test', sample_index: 1,
    observation_kind: 'position', observed_at: '2026-09-16T07:00:00+09:00', provider: 'kawasaki',
    direction_id: 'home_to_noborito', route_id: '10044', trip_id: 'shadow-fixture-trip', service_date: '20260916',
    origin_stop_id: '184_2', platform: '2番', scheduled_departure: '2026-09-16T06:50:00+09:00',
    evidence_type: '', departure_state: '', elapsed_from_scheduled_sec: '', gps_age_sec: 1, rt_age_sec: 1,
    next_bus_gap_min: '', censored: false, vehicle_hash: `veh_${'a'.repeat(32)}`,
    gps_timestamp: Date.parse('2026-09-16T07:00:00+09:00') / 1000,
    position_lat: point.lat, position_lon: point.lon, position_state: '', position_confidence: '',
    position_reason: 'route_geometry_unavailable', previous_stop_id: '', next_stop_id: '',
    position_segment_key: '', position_expected_segments: 19, aux_stop_id: '', aux_stop_sequence: '', aux_status: ''
  };
  return OBSERVATION_HEADERS.map((name) => value[name] ?? '');
}

test('approved Noborito artifact fixes one versioned shadow source while every public gate stays off', () => {
  validateApprovedPositionShadowBundle(bundle, positionStatic);
  validatePositionGeometryBundle(bundle, positionStatic);
  const selected = selectPositionGeometry({ bundle, positionStatic, target });
  assert.equal(selected, source);
  assert.equal(source.sourceVersion, 'osm:7109917:v14+mlit:n07:2022');
  assert.equal(source.approvalVersion, NOBORITO_SHADOW_GEOMETRY.approvalVersion);
  assert.equal(source.approvedForShadow, true); assert.equal(source.approvedForPublic, false);
  assert.equal(source.geometryReady, false); assert.equal(candidate.geometryReady, false);
  assert.equal(candidate.eligible, false);
});

test('artifact reproduces 281 points, gap zero, 20 ordered stops and the fixed terminal resolution', () => {
  assert.equal(candidate.points.length, 281); assert.equal(source.validation.gapCount, 0);
  assert.equal(source.validation.selfIntersectionCount, 0);
  assert.equal(candidate.stopProjections.length, 20);
  assert.deepEqual(source.validation.stopProjectionAmbiguousStopIds, ['362_1']);
  assert.equal(source.validation.stopProjectionResolution, 'terminal_route_end_order_constraint');
  assert.ok(candidate.stopProjections.every((row, index) => index === 0
    || row.along > candidate.stopProjections[index - 1].along + 1));
  assert.deepEqual(candidate.corridor, { fromStopId: '184_2', fromOrdinal: 12, toStopId: '362_1', toOrdinal: 19 });
});

test('artifact retains OSM, MLIT and GTFS provenance without approving geometryReady', () => {
  assert.equal(source.validation.n07MatchRate, 1);
  assert.equal(source.validation.monotonicTrips, 10);
  assert.equal(source.validation.gpsProjectionAmbiguousCount, 1);
  assert.ok(source.sourceReferences.some((value) => value.type === 'osm_route_relation'
    && value.version === 14 && /^[a-f0-9]{64}$/.test(value.sha256)));
  assert.ok(source.sourceReferences.some((value) => value.type === 'mlit_n07_corroboration'
    && value.year === 2022 && /^[a-f0-9]{64}$/.test(value.sha256)));
  assert.ok(source.validation.publicGateReasons.includes('official_reference_insufficient'));
});

test('evaluator loads the approved artifact and snaps a real geometry point only in shadow mode', () => {
  const point = candidate.points[150];
  const output = derivePositionEvaluations({ rawValues: [OBSERVATION_HEADERS, raw(point)],
    serviceDate: '2026-09-16', evaluatedAt: '2026-09-16T19:45:00+09:00',
    positionStatic, geometryArtifact: source, target });
  assert.equal(output.daily.stage, 'stage_1_shadow');
  assert.equal(output.daily.snap_matched_rows, 1);
  assert.equal(output.daily.geometry_ready_candidate, false);
  assert.equal(output.daily.decision, 'HOLD');
  assert.equal(output.evaluations[0].geometry_source, 'validated_road_geometry');
  assert.equal(output.evaluations[0].snap_distance_m, 0);
});

test('schema rejects any attempt to promote the shadow artifact to public or geometryReady', () => {
  const publicBundle = structuredClone(bundle);
  publicBundle.sources[0].approvedForPublic = true;
  assert.throws(() => validateApprovedPositionShadowBundle(publicBundle, positionStatic),
    /POSITION_SHADOW_BUNDLE_INVALID/);
  const readyBundle = structuredClone(bundle);
  readyBundle.sources[0].geometryReady = true;
  assert.throws(() => validateApprovedPositionShadowBundle(readyBundle, positionStatic),
    /POSITION_SHADOW_BUNDLE_INVALID/);
});

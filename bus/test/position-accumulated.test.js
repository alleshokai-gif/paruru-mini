import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAccumulatedPosition } from '../observation/position-accumulated.js';

const artifact = { provider: 'kawasaki', routeId: '10044', directionId: 'home_to_noborito',
  approvedForShadow: true, approvedForPublic: false, geometryReady: false };
const dates = ['2026-09-16', '2026-09-17', '2026-09-18'];
const dailyRows = dates.map((service_date, index) => ({ daily_id: `daily-${index}`,
  service_date, route_id: '10044', direction_id: 'home_to_noborito', expected_interval_count: 19,
  decision: 'HOLD', header_match: true }));
const positionStatic = { trips: Object.fromEntries(Array.from({ length: 21 }, (_, i) =>
  [`trip-${i}`, { chainId: i < 14 ? 'main-pattern' : 'short-pattern' }])) };
const observationRows = Array.from({ length: 21 }, (_, index) => ({
  evaluation_id: `row-${index}`, service_date: dates[Math.floor(index / 7)],
  route_id: '10044', direction: 'home_to_noborito', trip_id: `trip-${index}`,
  stop_interval_index: index % 19, inferred_direction: 'forward', monotonicity_status: 'monotonic',
  ambiguity_reason: '', severe_contradiction_flag: false
}));
const evaluate = (patch = {}) => evaluateAccumulatedPosition({ dailyRows, observationRows,
  positionStatic, geometryArtifact: artifact, throughDate: '2026-10-12', ...patch });

test('multi-day evaluator aggregates patterns and interval union without promoting shadow geometry', () => {
  const rows = observationRows.map((row, index) => ({ ...row, stop_interval_index: index % 19 }));
  const result = evaluate({ observationRows: rows });
  assert.equal(result.serviceDays, 3); assert.equal(result.independentTripDays, 21);
  assert.equal(result.observedIntervals, 19); assert.deepEqual(result.missingIntervals, []);
  assert.equal(result.reasonCodes.includes('MULTI_DAY_COVERAGE_INSUFFICIENT'), false);
  assert.equal(result.patterns.length, 2); assert.equal(result.geometryReadyCandidate, false);
  assert.equal(result.approvedForPublic, false); assert.equal(result.decision, 'HOLD');
  assert.equal(JSON.stringify(result).includes('position_lat'), false);
});

test('pattern mismatch, reverse and unknown direction stay visible as separate evidence', () => {
  const rows = observationRows.map((row) => ({ ...row }));
  rows[0].ambiguity_reason = 'trip_geometry_mismatch';
  rows[1].inferred_direction = 'reverse'; rows[1].monotonicity_status = 'reverse';
  rows[2].inferred_direction = 'unknown';
  const result = evaluate({ observationRows: rows });
  assert.equal(result.mismatch, 1); assert.equal(result.reverse, 1); assert.equal(result.unknownDirection, 1);
  assert.ok(result.reasonCodes.includes('TRIP_GEOMETRY_MISMATCH'));
  assert.ok(result.reasonCodes.includes('DIRECTION_CONTRADICTION_PRESENT'));
  assert.equal(result.patterns.find((p) => p.chainId === 'main-pattern').mismatch, 1);
});

test('incomplete dates, intervals and invalid shadow approval fail closed', () => {
  const short = evaluate({ dailyRows: dailyRows.slice(0, 2),
    observationRows: observationRows.filter((row) => row.service_date !== dates[2]) });
  assert.ok(short.reasonCodes.includes('MULTI_DAY_COVERAGE_INSUFFICIENT'));
  assert.ok(short.reasonCodes.includes('INDEPENDENT_TRIPS_INSUFFICIENT'));
  assert.ok(short.reasonCodes.includes('STOP_INTERVAL_COVERAGE_INSUFFICIENT'));
  assert.throws(() => evaluate({ geometryArtifact: { ...artifact, approvedForPublic: true } }),
    /POSITION_ACCUMULATED_INPUT_INVALID/);
  assert.throws(() => evaluate({ observationRows: [observationRows[0], observationRows[0]] }),
    /POSITION_ACCUMULATED_INPUT_INVALID/);
});

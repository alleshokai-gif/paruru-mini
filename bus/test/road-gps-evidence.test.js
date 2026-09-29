import test from 'node:test';
import assert from 'node:assert/strict';
import { OBSERVATION_HEADERS } from '../observation/schema.js';
import { buildCandidateRowRanges, indexCandidatePositionRows, mapCandidateGpsSamples,
  positionTripIndex, safeRoadValidationSummary } from '../observation/road-gps-evidence.js';

test('candidate indexing enforces the persisted raw schema and filters by target route, trip, and position kind', () => {
  const tripIndex = new Map([['trip-a', { chainId: 'chain-a', routeId: '10032' }]]);
  const kinds = [['observation_kind'], ['position'], ['departure'], ['departure_position'], ['position']];
  const rows = [['route_id', 'trip_id', 'service_date'], ['10032', 'trip-a', '20260928'],
    ['10032', 'trip-a', '20260928'], ['10032', 'trip-a', '20260928'], ['10035', 'trip-a', '20260928']];
  assert.deepEqual(indexCandidatePositionRows({ headers: OBSERVATION_HEADERS, kindValues: kinds,
    routeTripDateValues: rows, tripIndex }).map(({ sheetRow }) => sheetRow), [2, 4]);
  assert.throws(() => indexCandidatePositionRows({ headers: OBSERVATION_HEADERS.slice(1), kindValues: kinds,
    routeTripDateValues: rows, tripIndex }), /ROAD_GPS_RAW_SCHEMA_INVALID/);
});

test('trip index only includes the requested geometry chains', () => {
  const positionStatic = { trips: { a: { chainId: 'keep', routeId: '10032' },
    b: { chainId: 'drop', routeId: '10032' }, c: { chainId: 'keep', routeId: '10035' } } };
  assert.deepEqual([...positionTripIndex(positionStatic, ['keep'])], [
    ['a', { chainId: 'keep', routeId: '10032' }], ['c', { chainId: 'keep', routeId: '10035' }]
  ]);
});

test('GPS ranges include only exact candidate row runs and required cells', () => {
  const runs = buildCandidateRowRanges([{ sheetRow: 2 }, { sheetRow: 3 }, { sheetRow: 8 }]);
  assert.deepEqual(runs.map(({ start, end, ranges }) => ({ start, end, ranges })), [
    { start: 2, end: 3, ranges: ["'Bus_Observation_Raw'!E2:E3", "'Bus_Observation_Raw'!Q2:Q3", "'Bus_Observation_Raw'!U2:X3"] },
    { start: 8, end: 8, ranges: ["'Bus_Observation_Raw'!E8:E8", "'Bus_Observation_Raw'!Q8:Q8", "'Bus_Observation_Raw'!U8:X8"] }
  ]);
  assert.throws(() => buildCandidateRowRanges([{ sheetRow: 1 }]), /ROAD_GPS_ROW_INDEX_INVALID/);
});

test('sample mapping keeps HMAC only in memory and safe summary omits coordinates and identities', () => {
  const rows = [{ sheetRow: 2, routeId: '10032', tripId: 'trip-a', serviceDate: '20260928', chainId: 'chain-a' }];
  const runs = buildCandidateRowRanges(rows);
  const samples = mapCandidateGpsSamples({ rows, runs, valueRanges: [
    { values: [['2026-09-28T07:00:00+09:00']] }, { values: [[8]] },
    { values: [['veh_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 1790546400, 35.6, 139.6]] }
  ] });
  assert.equal(samples[0].identityValid, true);
  assert.equal(samples[0].lat, 35.6);
  const safe = safeRoadValidationSummary({ chainId: 'chain-a', routeId: '10032', relationId: 123,
    relationVersion: 4, sampleCount: 1, gaps: 0, validation: { eligible: true, geometryReady: false,
      points: [{ lat: 35.6, lon: 139.6 }], reasons: [], evidence: { gps: { evaluated: 1, matched: 1,
        serviceDays: ['20260928'], segments: [] }, stops: { total: 2, projected: 2 } } } });
  const encoded = JSON.stringify(safe);
  assert.equal(encoded.includes('35.6'), false);
  assert.equal(encoded.includes('139.6'), false);
  assert.equal(encoded.includes('veh_'), false);
  assert.equal(encoded.includes('trip-a'), false);
  assert.equal(safe.eligible, true);
});

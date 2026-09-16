import test from 'node:test';
import assert from 'node:assert/strict';
import { OBSERVATION_HEADERS } from '../observation/schema.js';
import { derivePositionEvaluations } from '../observation/position-evaluator.js';
import { positionEvaluatorConfig } from '../observation/position-evaluator-config.js';
import { selectPositionGeometry } from '../observation/position-evaluator-geometry.js';
import { POSITION_DAILY_HEADERS, POSITION_DAILY_SHEET, POSITION_EVALUATION_HEADERS,
  POSITION_EVALUATION_SHEET } from '../observation/position-evaluator-schema.js';
import { createPositionEvaluationStore } from '../observation/position-evaluator-sheets.js';
import { startPositionEvaluatorJob } from '../observation/position-evaluator-job.js';
import { prepareShape } from '../position/geometry.js';

const DATE = '2026-09-16', TARGET = {
  provider: 'kawasaki', directionId: 'home_to_noborito', routeId: '10044', targetStopId: '362_1'
};
const CHAIN = 'chain-1', VEHICLE = `veh_${'a'.repeat(32)}`;
const stops = [0, 0.01, 0.02].map((offset, index) => ({
  stopId: index === 2 ? '362_1' : `s${index}`, sequence: index + 1, position: { lat: 35 + offset, lon: 139 }
}));
const positionStatic = {
  schemaVersion: 1, provider: 'kawasaki', sourceHash: 'source-hash', sourceVersion: 'fixture',
  stops: Object.fromEntries(stops.map((stop) => [stop.stopId,
    { stopId: stop.stopId, name: stop.stopId, position: stop.position }])),
  chains: { [CHAIN]: { chainId: CHAIN, stops: stops.map(({ stopId, sequence }) => ({ stopId, sequence })) } },
  trips: { 'trip-1': { tripId: 'trip-1', routeId: '10044', chainId: CHAIN, shapeId: null } }
};
const source = (sourceType = 'validated_road_geometry', geometryId = sourceType) => ({
  schemaVersion: 1, provider: 'kawasaki', routeId: TARGET.routeId, sourceType, sourceVersion: 'fixture-v1',
  staticSourceHash: 'source-hash', generatedAt: `${DATE}T00:00:00.000Z`, directionId: TARGET.directionId,
  approvedForShadow: true, approvedForPublic: false, geometryReady: false,
  chains: { [CHAIN]: { geometryId, eligible: false, geometryReady: false,
    approvedForShadow: true, approvedForPublic: false, points: stops.map((stop) => stop.position), reasons: [],
    stopProjections: stops.map((stop, ordinal) => ({ stopId: stop.stopId, sequence: stop.sequence, ordinal,
      along: ordinal * prepareShape(stops.map((value) => value.position)).total / (stops.length - 1), distance: 0 })) } }
});
const bundle = (...sources) => ({ schemaVersion: 1, staticSourceHash: 'source-hash', sources });
function rawRow() {
  const value = {
    observation_id: `obs_${'1'.repeat(32)}`, run_id: 'run-1', sample_index: 1,
    observation_kind: 'position', observed_at: `${DATE}T07:00:00.000+09:00`, provider: 'kawasaki',
    direction_id: TARGET.directionId, route_id: TARGET.routeId, trip_id: 'trip-1', service_date: '20260916',
    origin_stop_id: 's0', platform: '1番', scheduled_departure: `${DATE}T06:50:00.000+09:00`,
    evidence_type: '', departure_state: '', elapsed_from_scheduled_sec: '', gps_age_sec: 1, rt_age_sec: 1,
    next_bus_gap_min: '', censored: false, vehicle_hash: VEHICLE,
    gps_timestamp: Date.parse(`${DATE}T07:00:00+09:00`) / 1000,
    position_lat: 35.005, position_lon: 139, position_state: '', position_confidence: '',
    position_reason: 'route_geometry_unavailable', previous_stop_id: '', next_stop_id: '',
    position_segment_key: '', position_expected_segments: 2, aux_stop_id: '', aux_stop_sequence: '',
    aux_status: ''
  };
  return OBSERVATION_HEADERS.map((name) => value[name] ?? '');
}
function result() {
  return derivePositionEvaluations({ rawValues: [OBSERVATION_HEADERS, rawRow()], serviceDate: DATE,
    evaluatedAt: `${DATE}T19:45:00+09:00`, positionStatic,
    geometryArtifact: source(), target: TARGET });
}

test('geometry selector preserves documented source priority and rejects equal-priority ambiguity', () => {
  const selected = selectPositionGeometry({ bundle: bundle(source('observed_corridor'),
    source('validated_road_geometry'), source('official_odpt_geometry')), positionStatic, target: TARGET });
  assert.equal(selected.sourceType, 'official_odpt_geometry');
  assert.throws(() => selectPositionGeometry({ bundle: bundle(source('validated_road_geometry', 'a'),
    source('validated_road_geometry', 'b')), positionStatic, target: TARGET }),
  /POSITION_GEOMETRY_SOURCE_AMBIGUOUS/);
});

test('position evaluator config has no ODPT or HMAC secret boundary', () => {
  const config = positionEvaluatorConfig({ PALURU_BUS_OBSERVATION_SPREADSHEET_ID: 'A'.repeat(24) });
  assert.equal(config.targets.length, 1);
  assert.throws(() => positionEvaluatorConfig({ PALURU_BUS_OBSERVATION_SPREADSHEET_ID: 'A'.repeat(24),
    ODPT_ACCESS_TOKEN: 'present' }), /SECRET_BOUNDARY_INVALID/);
  assert.throws(() => positionEvaluatorConfig({ PALURU_BUS_OBSERVATION_SPREADSHEET_ID: 'A'.repeat(24),
    OBSERVATION_HMAC_KEY: '' }), /SECRET_BOUNDARY_INVALID/);
});

test('position store creates only derived tabs and deterministically deduplicates both outputs', async () => {
  const titles = new Set(), headers = new Map(), created = [], appended = [];
  const client = { request: async ({ url, method, data }) => {
    const decoded = decodeURIComponent(url);
    if (decoded.includes('?fields=sheets.properties.title')) return {
      data: { sheets: [...titles].map((title) => ({ properties: { title } })) }
    };
    if (url.endsWith(':batchUpdate')) {
      const title = data.requests[0].addSheet.properties.title; titles.add(title); created.push(title);
      return { data: { replies: [{}] } };
    }
    if (method === 'PUT') {
      const title = decoded.includes(POSITION_EVALUATION_SHEET) ? POSITION_EVALUATION_SHEET : POSITION_DAILY_SHEET;
      headers.set(title, data.values[0]); return { data: { updatedRows: 1 } };
    }
    if (decoded.includes(POSITION_EVALUATION_SHEET) && decoded.includes('A1:'))
      return { data: { values: [headers.get(POSITION_EVALUATION_SHEET)] } };
    if (decoded.includes(POSITION_DAILY_SHEET) && decoded.includes('A1:'))
      return { data: { values: [headers.get(POSITION_DAILY_SHEET)] } };
    if (decoded.includes('majorDimension=COLUMNS')) return { data: { values: [] } };
    if (url.includes(':append')) {
      appended.push({ decoded, rows: data.values }); return { data: { updates: { updatedRows: data.values.length } } };
    }
    throw Error(`UNEXPECTED_REQUEST_${decoded}`);
  } };
  const store = createPositionEvaluationStore({ client, spreadsheetId: 'A'.repeat(24) }), output = result();
  await store.initialize();
  assert.deepEqual(created.sort(), [POSITION_DAILY_SHEET, POSITION_EVALUATION_SHEET].sort());
  assert.deepEqual(headers.get(POSITION_EVALUATION_SHEET), POSITION_EVALUATION_HEADERS);
  assert.deepEqual(headers.get(POSITION_DAILY_SHEET), POSITION_DAILY_HEADERS);
  assert.deepEqual(await store.appendEvaluations(output.evaluations), { inserted: 1, duplicate: 0 });
  assert.deepEqual(await store.appendEvaluations(output.evaluations), { inserted: 0, duplicate: 1 });
  await assert.rejects(() => store.appendEvaluations([{ ...output.evaluations[0],
    source_fingerprint: 'f'.repeat(32) }]), /POSITION_EVALUATOR_ID_CONFLICT/);
  assert.deepEqual(await store.appendDaily(output.daily), { inserted: 1, duplicate: 0 });
  assert.deepEqual(await store.appendDaily(output.daily), { inserted: 0, duplicate: 1 });
  assert.equal(appended.length, 2);
  assert.ok([...titles].every((title) => title !== 'Bus_Observation_Raw'));
});

test('position Job reads Raw only and writes derived rows through the isolated store', async () => {
  const requests = [], writes = { evaluations: null, daily: null }, logged = [];
  const client = { request: async (request) => {
    requests.push(request); const decoded = decodeURIComponent(request.url);
    if (decoded.includes('?fields=sheets.properties.title')) return {
      data: { sheets: [{ properties: { title: 'Bus_Observation_Raw' } }] }
    };
    if (decoded.includes("'Bus_Observation_Raw'!A1:AH1")) return { data: { values: [OBSERVATION_HEADERS] } };
    if (decoded.includes("'Bus_Observation_Raw'!J2:J")) return { data: { values: [['20260916']] } };
    if (decoded.includes("'Bus_Observation_Raw'!A2:AH2")) return { data: { values: [rawRow()] } };
    throw Error(`UNEXPECTED_REQUEST_${decoded}`);
  } };
  const output = await startPositionEvaluatorJob({
    env: { PALURU_BUS_OBSERVATION_SPREADSHEET_ID: 'A'.repeat(24) },
    now: () => Date.parse(`${DATE}T19:45:00+09:00`),
    auth: { getClient: async () => client },
    storeFactory: () => ({
      initialize: async () => {},
      appendEvaluations: async (rows) => { writes.evaluations = rows; return { inserted: rows.length, duplicate: 0 }; },
      appendDaily: async (row) => { writes.daily = row; return { inserted: 1, duplicate: 0 }; }
    }),
    loadPositionStatic: () => positionStatic, loadGeometryBundle: () => bundle(source()),
    log: (value) => logged.push(value)
  });
  assert.equal(output.summaries.length, 1);
  assert.equal(writes.evaluations.length, 1); assert.equal(writes.daily.stage, 'stage_1_shadow');
  assert.equal(logged.at(-1).event, 'position_evaluator_complete');
  assert.ok(requests.every((request) => !/secretmanager|odpt/i.test(request.url)));
  assert.ok(requests.every((request) => request.method !== 'PUT' && request.method !== 'POST'));
});

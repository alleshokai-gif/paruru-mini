import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import bindings from 'gtfs-realtime-bindings';
import { preoriginObservationConfig } from '../observation/preorigin-config.js';
import { createPreoriginObservationCollector, PREORIGIN_EXPECTED_START_TIMES } from '../observation/preorigin-collector.js';
import { PREORIGIN_HEADERS, finalizePreoriginObservation, preoriginObservationValues } from '../observation/preorigin-schema.js';
import { createPreoriginSheetsStore } from '../observation/preorigin-sheets.js';
import { runPreoriginObservation } from '../observation/preorigin-runner.js';

const HASH = 'h'.repeat(32), NOW = Date.parse('2026-09-14T06:40:00+09:00') / 1000;
const index = JSON.parse(readFileSync(new URL('../generated/p0-static.json', import.meta.url), 'utf8'));
const positionStatic = JSON.parse(readFileSync(new URL('../generated/p1-position-static.json', import.meta.url), 'utf8'));
const bytes = (vehicles, timestamp = NOW) => bindings.transit_realtime.FeedMessage.encode(
  bindings.transit_realtime.FeedMessage.create({ header: { gtfsRealtimeVersion: '2.0', timestamp, incrementality: 0 },
    entity: vehicles.map((vehicle, item) => ({ id: `raw-${item}`, vehicle })) })).finish();
const vehicle = (patch = {}) => ({ vehicle: { id: 'raw-vehicle' }, timestamp: NOW,
  position: { latitude: 35.601, longitude: 139.583 }, ...patch });
const baseRow = (patch = {}) => finalizePreoriginObservation({ preorigin_observation_id: null, run_id: 'run-1', sample_index: 0,
  observed_at: '2026-09-14T06:40:00.000+09:00', service_date: '20260914', target_trip_id: 'target',
  scheduled_departure: '2026-09-14T06:50:00.000+09:00', origin_stop_id: '184_1', route_id: '10035', platform: '1',
  record_kind: 'target_snapshot', vehicle_classification: 'none', vehicle_hash: null, vehicle_timestamp: null,
  position_lat: null, position_lon: null, distance_to_origin_m: null, gps_age_sec: null, feed_timestamp: NOW,
  rt_age_sec: 0, raw_vehicle_entities: 1, assigned_count: 0, tripless_count: 1, partial_descriptor_count: 0,
  stale_count: 0, gps_missing_count: 0, runtime_dropped_count: 1, preorigin_vehicle_seen: false,
  preorigin_first_seen_at: null, preorigin_distance_to_origin: null, trip_assignment_transition_at: null,
  seconds_before_scheduled: null, arrival_to_origin: null, departure_positive_evidence: null,
  evidence_level: 'undetermined', censored: true, ...patch }, HASH);

test('preorigin automatic config is bounded to the weekday morning observation window', () => {
  const value = preoriginObservationConfig({ ODPT_ACCESS_TOKEN: 'token', OBSERVATION_HMAC_KEY: HASH,
    PALURU_BUS_OBSERVATION_SPREADSHEET_ID: 'A'.repeat(24) });
  assert.equal(value.sampleCount, 10); assert.equal(value.intervalSec, 32); assert.equal(value.maxRunSec, 310);
  assert.deepEqual(value.timeBands, [{ start: 395, end: 536 }]);
  assert.throws(() => preoriginObservationConfig({ ODPT_ACCESS_TOKEN: 'token', OBSERVATION_HMAC_KEY: HASH,
    PALURU_BUS_OBSERVATION_SPREADSHEET_ID: 'A'.repeat(24), PREORIGIN_SAMPLE_COUNT: '11' }), /SAMPLE_COUNT/);
});

test('preorigin schema is deterministic, HMAC-only and never assigns Level C automatically', () => {
  const first = baseRow(), second = baseRow();
  assert.equal(first.preorigin_observation_id, second.preorigin_observation_id);
  assert.equal(PREORIGIN_HEADERS.length, preoriginObservationValues(first).length);
  assert.equal(PREORIGIN_HEADERS.includes('preorigin_distance_to_origin'), true);
  assert.equal(JSON.stringify(first).includes('raw-vehicle'), false);
  assert.throws(() => baseRow({ evidence_level: 'C' }), /ROW_INVALID/);
});

test('collector limits itself to the 12 verified trips and records Level A only after same-vehicle assignment', () => {
  const collector = createPreoriginObservationCollector({ index, positionStatic, hashKey: HASH });
  assert.equal(collector.targetCount(NOW), 12); assert.equal(PREORIGIN_EXPECTED_START_TIMES.length, 12);
  const first = collector.collect({ bytes: bytes([vehicle()]), now: NOW, runId: 'run-1', sampleIndex: 0 });
  assert.equal(first.rows.filter((row) => row.record_kind === 'target_snapshot').length, 1);
  assert.ok(first.rows.some((row) => row.vehicle_classification === 'unassigned_candidate' && row.evidence_level === 'B'));
  const tripId = index.directions.home_to_mizonokuchi.find((row) => row.startTime === '06:50:00'
    && row.isOrigin && row.routeId === '10035').tripId;
  const next = NOW + 32;
  const assigned = collector.collect({ bytes: bytes([vehicle({ timestamp: next, trip: {
    tripId, routeId: '10035', startDate: '20260914' } })], next), now: next, runId: 'run-1', sampleIndex: 1 });
  const transition = assigned.rows.find((row) => row.record_kind === 'assignment_transition');
  assert.ok(transition); assert.equal(transition.evidence_level, 'A'); assert.equal(transition.seconds_before_scheduled, 568);
  assert.equal(JSON.stringify(assigned.rows).includes('raw-vehicle'), false);
});

test('dedicated Sheets store creates only its own tab/header and suppresses retry duplicates', async () => {
  const row = baseRow(), calls = [];
  const responses = [{ sheets: [] }, { replies: [{}] }, { updatedRows: 1 }, { values: [] }, { updates: { updatedRows: 1 } }];
  const fetcher = async (url, options) => { calls.push({ url, options }); const body = responses.shift();
    return { ok: true, headers: { get: () => null }, text: async () => JSON.stringify(body) }; };
  const store = createPreoriginSheetsStore({ spreadsheetId: 'A'.repeat(24), fetcher, tokenProvider: async () => 'access-token' });
  const result = await store.append([row, row]);
  assert.deepEqual(result, { attempted: 2, inserted: 1, duplicates: 1 });
  assert.equal(calls.length, 5); assert.match(calls[1].options.body, /Bus_Preorigin_Raw/);
  assert.equal(JSON.stringify(calls).includes('raw-vehicle'), false);
  assert.equal((await store.append([row])).inserted, 0);
});

test('preorigin runner fetches one raw feed per sample and stops outside the target band', async () => {
  let current = NOW, fetches = 0, writes = 0;
  const result = await runPreoriginObservation({ config: { runId: 'run-1', sampleCount: 2, intervalSec: 32,
    maxRunSec: 100, timeBands: [{ start: 395, end: 536 }] }, fetchRaw: async () => { fetches++; return new Uint8Array([1]); },
    collector: { targetCount: () => 12, activeTargetCount: () => 1,
      collect: () => ({ rows: [baseRow()], summary: { entities: 1, tripIdMissing: 1, partialAssignments: 0, stale: 0, gpsMissing: 0 } }) },
    store: { append: async () => { writes++; return writes === 1 ? { inserted: 1, duplicates: 0 }
      : { inserted: 0, duplicates: 1 }; } }, clock: () => current, sleep: async (seconds) => { current += seconds; } });
  assert.deepEqual({ fetches, writes, samples: result.samples, inserted: result.inserted, duplicates: result.duplicates },
    { fetches: 2, writes: 2, samples: 2, inserted: 1, duplicates: 1 });
});

test('preorigin image is isolated from the public API and its Cloud Build never deploys or receives secrets', () => {
  const apiDocker = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
  const jobDocker = readFileSync(new URL('../observation/Dockerfile.preorigin', import.meta.url), 'utf8');
  const build = readFileSync(new URL('../observation/cloudbuild.preorigin.yaml', import.meta.url), 'utf8');
  assert.equal(apiDocker.includes('research/preorigin.js'), false);
  assert.match(jobDocker, /observation\/preorigin-job\.js/); assert.match(jobDocker, /research\/preorigin\.js/);
  assert.doesNotMatch(jobDocker, /runtime\/start\.js|http\/handler/);
  assert.doesNotMatch(build, /gcloud\s+run|jobs\s+(create|update|execute)|availableSecrets|secretEnv|--set-secrets/);
  assert.match(build, /PREORIGIN_IMAGE_SMOKE_PASS/);
});

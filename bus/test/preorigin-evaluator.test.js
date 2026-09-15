import test from 'node:test';
import assert from 'node:assert/strict';
import { PREORIGIN_HEADERS } from '../observation/preorigin-schema.js';
import { evaluatePreoriginCanary, expectedPreoriginSlots } from '../observation/preorigin-evaluator.js';
import { PREORIGIN_DAILY_HEADERS, PREORIGIN_EVALUATOR_SCHEDULE,
  preoriginDailyValues } from '../observation/preorigin-evaluator-schema.js';
import { createPreoriginDailyStore } from '../observation/preorigin-evaluator-sheets.js';
import { preoriginEvaluatorConfig } from '../observation/preorigin-evaluator-config.js';
import { PREORIGIN_SCHEDULER_CONFIG } from '../observation/preorigin-scheduler.js';
import { readFileSync } from 'node:fs';

const DATE = '2026-09-16';
const TYPES = {
  started: 'type.googleapis.com/google.cloud.scheduler.logging.AttemptStarted',
  finished: 'type.googleapis.com/google.cloud.scheduler.logging.AttemptFinished'
};
const TARGETS = [
  ['trip-0650', '06:50'], ['trip-0700', '07:00'], ['trip-0710', '07:10'], ['trip-0720', '07:20'],
  ['trip-0730', '07:30'], ['trip-0740', '07:40'], ['trip-0750', '07:50'], ['trip-0800', '08:00'],
  ['trip-0810', '08:10'], ['trip-0820', '08:20'], ['trip-0835', '08:35'], ['trip-0850', '08:50']
];
const isoJst = (minute, second = 0) => {
  const hour = Math.floor(minute / 60), min = minute % 60;
  return `${DATE}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(second).padStart(2, '0')}.000+09:00`;
};
const resources = () => PREORIGIN_SCHEDULER_CONFIG.schedules.map((item) => ({
  name: `projects/p/locations/r/jobs/${item.id}`, schedule: item.cron, timeZone: 'Asia/Tokyo', state: 'ENABLED',
  httpTarget: { httpMethod: 'POST', uri: PREORIGIN_SCHEDULER_CONFIG.targetUri,
    oauthToken: { serviceAccountEmail: PREORIGIN_SCHEDULER_CONFIG.schedulerServiceAccount } },
  retryConfig: { maxRetryAttempts: 0 }
}));

function healthyInput() {
  const slots = expectedPreoriginSlots(DATE), schedulerLogEntries = [], executions = [], runLogEntries = [];
  for (const [index, slot] of slots.entries()) {
    const jobName = index < 5 ? 'paluru-bus-preorigin-0635' : 'paluru-bus-preorigin-0700';
    schedulerLogEntries.push({ timestamp: slot.at, jsonPayload: { '@type': TYPES.started,
      jobName: `projects/p/locations/r/jobs/${jobName}`, scheduleTime: slot.at } });
    schedulerLogEntries.push({ timestamp: new Date(Date.parse(slot.at) + 1000).toISOString(),
      jsonPayload: { '@type': TYPES.finished, jobName: `projects/p/locations/r/jobs/${jobName}`,
        scheduleTime: slot.at, status: 0 } });
    const runId = `run-${index}`, completion = new Date(Date.parse(slot.at) + 4 * 60 * 1000).toISOString();
    executions.push({ name: `projects/p/locations/r/jobs/j/executions/ex-${index}`, createTime: slot.at,
      completionTime: completion, succeededCount: 1, failedCount: 0, retriedCount: 0 });
    runLogEntries.push({ timestamp: slot.at, jsonPayload: { event: 'preorigin_start', runId,
      targetTrips: 12, sampleCount: 10, intervalSec: 32, maxRunSec: 310 } });
    if (slot.coreObservation) for (let sampleIndex = 0; sampleIndex < 10; sampleIndex++) {
      runLogEntries.push({ timestamp: new Date(Date.parse(slot.at) + sampleIndex * 32000).toISOString(),
        jsonPayload: { event: 'preorigin_sample', runId, sampleIndex } });
    }
    runLogEntries.push({ timestamp: completion, jsonPayload: { event: 'preorigin_complete', runId,
      samples: slot.coreObservation ? 10 : 0, status: slot.coreObservation ? 'success' : 'bounded',
      reason: slot.coreObservation ? null : 'no_active_target' } });
  }
  const rawValues = [PREORIGIN_HEADERS]; let sequence = 0;
  for (const [targetIndex, [tripId, hhmm]] of TARGETS.entries()) {
    const scheduledMinute = Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
    const rowCount = targetIndex < 4 ? 24 : 23;
    for (let index = 0; index < rowCount; index++) {
      const before = index < 15, observedMinute = scheduledMinute + (before ? -15 + index : index - 15);
      const value = {
        preorigin_observation_id: `pre_${(++sequence).toString(16).padStart(32, '0')}`,
        run_id: `fixture-${sequence}`, sample_index: 0, observed_at: isoJst(observedMinute),
        service_date: '20260916', target_trip_id: tripId, scheduled_departure: isoJst(scheduledMinute),
        origin_stop_id: '184_1', route_id: '10035', platform: '1番', record_kind: 'target_snapshot',
        vehicle_classification: 'none', vehicle_hash: '', vehicle_timestamp: '', position_lat: '', position_lon: '',
        distance_to_origin_m: '', gps_age_sec: '', feed_timestamp: sequence, rt_age_sec: 1,
        raw_vehicle_entities: 70, assigned_count: 70, tripless_count: 0, partial_descriptor_count: 0,
        stale_count: 0, gps_missing_count: 0, runtime_dropped_count: 0, preorigin_vehicle_seen: false,
        preorigin_first_seen_at: '', preorigin_distance_to_origin: '', trip_assignment_transition_at: '',
        seconds_before_scheduled: '', arrival_to_origin: '', departure_positive_evidence: '',
        evidence_level: 'undetermined', censored: true
      };
      rawValues.push(PREORIGIN_HEADERS.map((name) => value[name] ?? ''));
    }
  }
  return { targetDate: DATE, evaluatedAt: `${DATE}T09:10:00+09:00`, schedulerResources: resources(),
    schedulerLogEntries, executions, runLogEntries, rawValues };
}

test('09:10 evaluator schedule leaves 590 seconds after the bounded 08:55 run', () => {
  assert.deepEqual(PREORIGIN_EVALUATOR_SCHEDULE,
    { id: 'paluru-bus-preorigin-evaluator-0910', cron: '10 9 * * 1-5', timeZone: 'Asia/Tokyo' });
  assert.equal(9 * 3600 + 10 * 60 - (8 * 3600 + 55 * 60 + 310), 590);
});

test('healthy first-day evidence is HOLD only for classification fields absent from Raw v1', () => {
  const result = evaluatePreoriginCanary(healthyInput());
  assert.equal(result.decision, 'HOLD');
  assert.deepEqual(JSON.parse(result.reason_codes), ['CLASSIFICATION_DETAIL_UNAVAILABLE']);
  assert.equal(result.expected_runs, 29); assert.equal(result.actual_runs, 29);
  assert.equal(result.expected_samples, 280); assert.equal(result.actual_samples, 280);
  assert.equal(result.target_trips_observed, 12); assert.equal(result.target_trip_coverage, 1);
  assert.equal(result.level_a_count, 0); assert.equal(result.unusable_count, null);
  assert.equal(preoriginDailyValues(result).length, PREORIGIN_DAILY_HEADERS.length);
  assert.doesNotMatch(JSON.stringify(result), /veh_[a-f0-9]{32}|position_lat|position_lon|Level C/i);
});

test('missing fire, failed execution and partial samples stay HOLD with stable reason codes', () => {
  const input = healthyInput();
  input.schedulerLogEntries.splice(0, 2);
  input.executions[1] = { ...input.executions[1], succeededCount: 0, failedCount: 1 };
  input.runLogEntries = input.runLogEntries.filter((entry) => !(entry.jsonPayload.event === 'preorigin_sample'
    && entry.jsonPayload.runId === 'run-2' && entry.jsonPayload.sampleIndex > 2));
  const result = evaluatePreoriginCanary(input), reasons = JSON.parse(result.reason_codes);
  assert.equal(result.decision, 'HOLD');
  assert.ok(reasons.includes('SCHEDULER_FIRE_MISSING'));
  assert.ok(reasons.includes('JOB_FAILURE_PRESENT'));
  assert.ok(reasons.includes('SAMPLE_COVERAGE_INSUFFICIENT'));
});

test('Scheduler target failure and an extra Cloud Run execution are reported separately', () => {
  const input = healthyInput();
  input.schedulerLogEntries[1].jsonPayload.status = { code: 13 };
  input.executions.push({ ...input.executions.at(-1), name: 'projects/p/locations/r/jobs/j/executions/manual-extra' });
  const result = evaluatePreoriginCanary(input), reasons = JSON.parse(result.reason_codes);
  assert.equal(result.decision, 'HOLD'); assert.ok(reasons.includes('SCHEDULER_ATTEMPT_FAILURE'));
  assert.ok(reasons.includes('EXECUTION_COUNT_MISMATCH')); assert.equal(result.duplicate_execution_count, 1);
});

test('log and Raw sample counts must agree even when both independently meet the minimum', () => {
  const input = healthyInput();
  const extra = [...input.rawValues.at(-1)];
  extra[PREORIGIN_HEADERS.indexOf('preorigin_observation_id')] = `pre_${'f'.repeat(32)}`;
  extra[PREORIGIN_HEADERS.indexOf('run_id')] = 'fixture-extra';
  extra[PREORIGIN_HEADERS.indexOf('sample_index')] = 99;
  extra[PREORIGIN_HEADERS.indexOf('feed_timestamp')] = 999999;
  input.rawValues.push(extra);
  const reasons = JSON.parse(evaluatePreoriginCanary(input).reason_codes);
  assert.ok(reasons.includes('SAMPLE_SOURCE_MISMATCH'));
});

test('consecutive Job failures and target trip mismatch are NO_GO', () => {
  const input = healthyInput();
  input.executions[0] = { ...input.executions[0], succeededCount: 0, failedCount: 1 };
  input.executions[1] = { ...input.executions[1], succeededCount: 0, failedCount: 1 };
  input.rawValues = input.rawValues.filter((row, index) => index === 0 || row[5] !== 'trip-0850');
  const result = evaluatePreoriginCanary(input), reasons = JSON.parse(result.reason_codes);
  assert.equal(result.decision, 'NO_GO');
  assert.ok(reasons.includes('CONSECUTIVE_JOB_FAILURES'));
  assert.ok(reasons.includes('TARGET_TRIPS_NOT_12'));
});

test('header mismatch, conflicting duplicate and invalid vehicle hash fail closed', () => {
  const header = healthyInput(); header.rawValues[0] = [...PREORIGIN_HEADERS, 'unexpected'];
  assert.equal(evaluatePreoriginCanary(header).decision, 'NO_GO');
  const conflict = healthyInput(), copy = [...conflict.rawValues[1]];
  copy[PREORIGIN_HEADERS.indexOf('vehicle_classification')] = 'assigned'; conflict.rawValues.push(copy);
  assert.ok(JSON.parse(evaluatePreoriginCanary(conflict).reason_codes).includes('OBSERVATION_ID_CONFLICT'));
  const invalid = healthyInput(); invalid.rawValues[1][PREORIGIN_HEADERS.indexOf('vehicle_hash')] = 'raw-id';
  const result = evaluatePreoriginCanary(invalid);
  assert.equal(result.decision, 'NO_GO'); assert.equal(result.invalid_hmac_count, 1);
});

test('no target service remains HOLD and never creates Level C', () => {
  const input = healthyInput(); input.rawValues = [PREORIGIN_HEADERS]; input.runLogEntries = [];
  for (const [index, slot] of expectedPreoriginSlots(DATE).entries()) input.runLogEntries.push({ timestamp: slot.at,
    jsonPayload: { event: 'preorigin_skipped', runId: `skip-${index}`, reason: 'no_target_service' } });
  const result = evaluatePreoriginCanary(input), encoded = JSON.stringify(result);
  assert.equal(result.decision, 'HOLD'); assert.equal(result.no_target_service_count, 29);
  assert.ok(!JSON.parse(result.reason_codes).includes('TARGET_TRIPS_NOT_12'));
  assert.doesNotMatch(encoded, /level_c|LEVEL_C/);
});

test('evaluation ID is idempotent for the same evidence despite evaluated_at changing', () => {
  const first = evaluatePreoriginCanary(healthyInput()), input = healthyInput();
  input.evaluatedAt = `${DATE}T09:11:00+09:00`;
  const second = evaluatePreoriginCanary(input);
  assert.equal(first.evaluation_id, second.evaluation_id);
  assert.equal(first.source_fingerprint, second.source_fingerprint);
});

test('Daily store creates only its dedicated tab and suppresses the same evaluation ID', async () => {
  let exists = false, header = null, appends = 0;
  const client = { request: async ({ url, method, data }) => {
    if (url.includes('?fields=sheets.properties.title'))
      return { data: { sheets: exists ? [{ properties: { title: 'Bus_Preorigin_Daily' } }] : [] } };
    if (url.endsWith(':batchUpdate')) { exists = true; return { data: { replies: [{}] } }; }
    if (method === 'PUT') { header = data.values[0]; return { data: { updatedRows: 1 } }; }
    if (url.includes("%271%3A1%27") || url.includes('1%3A1')) return { data: { values: [header] } };
    if (url.includes('A2%3AA')) return { data: { values: [] } };
    if (url.includes(':append')) { appends++; return { data: { updates: { updatedRows: 1 } } }; }
    throw Error(`UNEXPECTED_REQUEST_${url}`);
  } };
  const store = createPreoriginDailyStore({ client, spreadsheetId: 'A'.repeat(24) });
  const row = evaluatePreoriginCanary(healthyInput());
  assert.deepEqual(await store.append(row), { inserted: 1, duplicate: 0 });
  assert.deepEqual(await store.append(row), { inserted: 0, duplicate: 1 });
  assert.equal(appends, 1); assert.deepEqual(header, PREORIGIN_DAILY_HEADERS);
});

test('evaluator runtime rejects ODPT/HMAC secret bindings and image excludes collection code', () => {
  assert.equal(preoriginEvaluatorConfig({ PALURU_BUS_OBSERVATION_SPREADSHEET_ID: 'A'.repeat(24) }).sourceJob,
    'paluru-bus-preorigin-observer');
  assert.throws(() => preoriginEvaluatorConfig({ PALURU_BUS_OBSERVATION_SPREADSHEET_ID: 'A'.repeat(24),
    ODPT_ACCESS_TOKEN: 'present' }), /SECRET_BOUNDARY_INVALID/);
  const docker = readFileSync(new URL('../observation/Dockerfile.preorigin-evaluator', import.meta.url), 'utf8');
  assert.match(docker, /preorigin-evaluator-job\.js/);
  assert.doesNotMatch(docker, /preorigin-job\.js|preorigin-collector\.js|providers\/kawasaki|generated\/p0-static/);
});

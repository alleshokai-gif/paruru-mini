import { PREORIGIN_HEADERS } from './preorigin-schema.js';
import { PREORIGIN_SCHEDULER_CONFIG, preoriginScheduledStartMinutes,
  validatePreoriginSchedulerConfig } from './preorigin-scheduler.js';
import { finalizePreoriginDaily } from './preorigin-evaluator-schema.js';

const JST = 9 * 3600 * 1000;
const TARGET_TIMES = new Set(['06:50', '07:00', '07:10', '07:20', '07:30', '07:40', '07:50',
  '08:00', '08:10', '08:20', '08:35', '08:50']);
const HMAC = /^veh_[a-f0-9]{32}$/;
const OBSERVATION_ID = /^pre_[a-f0-9]{32}$/;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const STARTED = 'type.googleapis.com/google.cloud.scheduler.logging.AttemptStarted';
const FINISHED = 'type.googleapis.com/google.cloud.scheduler.logging.AttemptFinished';
const FATAL = new Set(['SCHEDULER_CONFIG_INVALID', 'RAW_HEADER_MISMATCH', 'RAW_UNEXPECTED_COLUMNS',
  'RAW_ROW_INVALID', 'OBSERVATION_ID_CONFLICT', 'INVALID_HMAC_FORMAT', 'RAW_ID_OR_SECRET_DETECTED',
  'TARGET_TRIPS_NOT_12', 'STATIC_MISMATCH_FAILURE', 'CONSECUTIVE_JOB_FAILURES']);

const time = (value) => Number.isFinite(Date.parse(value || '')) ? Date.parse(value) : null;
const jstDate = (value) => {
  const parsed = time(value); return parsed === null ? null : new Date(parsed + JST).toISOString().slice(0, 10);
};
const dateStart = (date) => Date.parse(`${date}T00:00:00+09:00`);
const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.ceil(p * sorted.length) - 1];
};
const rowObject = (row) => Object.fromEntries(PREORIGIN_HEADERS.map((name, index) => [name, row[index] ?? '']));
const integer = (value) => Number.isInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const text = (value) => String(value ?? '');

export function expectedPreoriginSlots(targetDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate || '')) throw Error('PREORIGIN_EVALUATOR_DATE_INVALID');
  const start = dateStart(targetDate);
  return preoriginScheduledStartMinutes().map((minute) => Object.freeze({
    minute, at: new Date(start + minute * 60 * 1000).toISOString(), coreObservation: minute < 8 * 60 + 55
  }));
}

export function normalizeSchedulerAttempts(entries, targetDate) {
  const result = [];
  for (const entry of entries || []) {
    const payload = entry?.jsonPayload || {};
    if (![STARTED, FINISHED].includes(payload['@type'])) continue;
    const at = payload.scheduleTime || entry.timestamp;
    if (jstDate(at) !== targetDate) continue;
    const jobName = text(payload.jobName || entry.resource?.labels?.job_id).split('/').at(-1);
    const status = typeof payload.status === 'object' ? payload.status?.code : payload.status;
    result.push(Object.freeze({ type: payload['@type'] === STARTED ? 'started' : 'finished', jobName,
      scheduledAt: payload.scheduleTime || null, loggedAt: entry.timestamp || null,
      statusCode: status === undefined || status === null ? null : Number(status) }));
  }
  return Object.freeze(result);
}

function validateSchedulerResources(resources) {
  try { validatePreoriginSchedulerConfig(); } catch { return false; }
  const expected = new Map(PREORIGIN_SCHEDULER_CONFIG.schedules.map((item) => [item.id, item.cron]));
  if (!Array.isArray(resources) || resources.length !== expected.size) return false;
  return resources.every((item) => expected.get(text(item.name).split('/').at(-1)) === item.schedule
    && item.timeZone === 'Asia/Tokyo' && item.state === 'ENABLED' && item.httpTarget?.httpMethod === 'POST'
    && item.httpTarget?.uri === PREORIGIN_SCHEDULER_CONFIG.targetUri
    && item.httpTarget?.oauthToken?.serviceAccountEmail === PREORIGIN_SCHEDULER_CONFIG.schedulerServiceAccount
    && Number(item.retryConfig?.maxRetryAttempts || 0) === 0);
}

function schedulerSummary({ targetDate, schedulerResources, schedulerLogEntries }) {
  const slots = expectedPreoriginSlots(targetDate), allAttempts = normalizeSchedulerAttempts(schedulerLogEntries, targetDate);
  const attempts = allAttempts.filter((value) => value.type === 'started');
  const finished = allAttempts.filter((value) => value.type === 'finished');
  const startedWithSchedule = attempts.filter((value) => time(value.scheduledAt) !== null);
  const byMinute = new Map();
  for (const attempt of startedWithSchedule) {
    const minute = Math.round((time(attempt.scheduledAt) - dateStart(targetDate)) / 60000);
    byMinute.set(minute, (byMinute.get(minute) || 0) + 1);
  }
  const matched = slots.filter((slot) => byMinute.has(slot.minute)).length;
  const duplicates = [...byMinute.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
  return Object.freeze({ configured: validateSchedulerResources(schedulerResources), expected: slots.length,
    started: attempts.length, matched, missing: slots.length - matched, duplicates,
    failedAttempts: finished.filter((value) => Number.isFinite(value.statusCode) && value.statusCode !== 0).length,
    scheduleTimesComplete: attempts.length === startedWithSchedule.length });
}

function executionSummary(executions, targetDate) {
  const rows = (executions || []).filter((item) => jstDate(item.createTime) === targetDate);
  const uniqueNames = new Set(rows.map((item) => text(item.name)));
  const succeeded = rows.filter((item) => Number(item.succeededCount || 0) > 0 && Number(item.failedCount || 0) === 0).length;
  const failed = rows.filter((item) => Number(item.failedCount || 0) > 0).length;
  const running = rows.filter((item) => !item.completionTime && Number(item.failedCount || 0) === 0).length;
  const completions = rows.map((item) => time(item.completionTime)).filter(Number.isFinite);
  const ordered = rows.slice().sort((a, b) => time(a.createTime) - time(b.createTime));
  let overlaps = 0, consecutiveFailures = 0, longestFailures = 0;
  for (let index = 0; index < ordered.length; index++) {
    const failedNow = Number(ordered[index].failedCount || 0) > 0;
    consecutiveFailures = failedNow ? consecutiveFailures + 1 : 0;
    longestFailures = Math.max(longestFailures, consecutiveFailures);
    if (index && time(ordered[index].createTime) < time(ordered[index - 1].completionTime)) overlaps++;
  }
  return Object.freeze({ count: rows.length, unique: uniqueNames.size, succeeded, failed, running, overlaps,
    retriedTasks: rows.reduce((sum, item) => sum + Number(item.retriedCount || 0), 0),
    latestCompletion: completions.length ? new Date(Math.max(...completions)).toISOString() : null,
    consecutiveFailure: longestFailures >= 2 });
}

function runLogSummary(entries, targetDate) {
  const starts = new Map(), samples = new Map(), completions = new Map(), skipped = new Map();
  const failures = [];
  for (const entry of entries || []) {
    if (jstDate(entry.timestamp) !== targetDate) continue;
    const value = entry.jsonPayload || {}, runId = text(value.runId);
    if (value.event === 'preorigin_failed') { failures.push(text(value.code)); continue; }
    if (!RUN_ID.test(runId)) continue;
    if (value.event === 'preorigin_start') starts.set(runId, { ...value, timestamp: entry.timestamp });
    if (value.event === 'preorigin_sample') {
      const key = `${runId}:${value.sampleIndex}`;
      if (!samples.has(key)) samples.set(key, { ...value, timestamp: entry.timestamp });
    }
    if (value.event === 'preorigin_complete') completions.set(runId, { ...value, timestamp: entry.timestamp });
    if (value.event === 'preorigin_skipped') skipped.set(runId, { ...value, timestamp: entry.timestamp });
  }
  const byRun = new Map();
  for (const value of samples.values()) {
    if (!byRun.has(value.runId)) byRun.set(value.runId, []);
    byRun.get(value.runId).push(value);
  }
  let intervalAnomalies = 0;
  for (const values of byRun.values()) {
    values.sort((a, b) => Number(a.sampleIndex) - Number(b.sampleIndex));
    for (let index = 1; index < values.length; index++) {
      const delta = (time(values[index].timestamp) - time(values[index - 1].timestamp)) / 1000;
      if (!Number.isFinite(delta) || delta < 24 || delta > 40
        || Number(values[index].sampleIndex) !== Number(values[index - 1].sampleIndex) + 1) intervalAnomalies++;
    }
  }
  return Object.freeze({ starts, samples, completions, skipped, failures, intervalAnomalies,
    outside: [...skipped.values()].filter((item) => item.reason === 'outside_time_band').length,
    noTarget: [...skipped.values()].filter((item) => item.reason === 'no_target_service').length,
    staticMismatch: failures.filter((code) => code === 'PREORIGIN_TARGET_SET_INVALID').length });
}

function rawSummary(values, targetDate) {
  const empty = { headerMatch: false, unexpectedColumns: 0, rows: 0, duplicates: 0, conflicts: 0,
    invalidRows: 0, invalidHmac: 0, rawId: 0, tokenLeak: 0, rawResponse: 0, trips: new Map(),
    sampleKeys: new Set(), sampleCounters: new Map(), unassignedKeys: new Set(),
    assigned: 0, unassigned: 0, partial: 0, stale: 0, gpsMissing: 0,
    undetermined: 0, transitions: 0, levelA: 0, levelB: 0, secondsBefore: [] };
  if (!Array.isArray(values) || !values.length) return empty;
  const header = values[0].map(String), headerMatch = JSON.stringify(header) === JSON.stringify(PREORIGIN_HEADERS);
  const result = { ...empty, headerMatch, unexpectedColumns: Math.max(0, header.length - PREORIGIN_HEADERS.length) };
  if (!headerMatch) return result;
  const seen = new Map(), chains = new Map();
  for (const row of values.slice(1)) {
    const value = rowObject(row), identity = PREORIGIN_HEADERS.map((name) => text(value[name])).join('\u001f');
    if (text(value.service_date) !== targetDate.replaceAll('-', '')) continue;
    result.rows++;
    const id = text(value.preorigin_observation_id);
    if (seen.has(id)) {
      if (seen.get(id) === identity) result.duplicates++; else result.conflicts++;
      continue;
    }
    seen.set(id, identity);
    const vehicle = text(value.vehicle_hash), scheduled = text(value.scheduled_departure), observed = text(value.observed_at);
    const scheduledTime = scheduled.slice(11, 16), classification = text(value.vehicle_classification);
    const tokenLike = Object.values(value).some((cell) => /(?:Bearer\s+|ya29\.|access[_-]?token|ODPT_ACCESS_TOKEN)/i.test(text(cell)));
    const responseLike = Object.values(value).some((cell) => /^[\[{].*[\]}]$/.test(text(cell).trim()));
    const invalidHmac = vehicle !== '' && !HMAC.test(vehicle);
    const valid = OBSERVATION_ID.test(id) && RUN_ID.test(text(value.run_id)) && TARGET_TIMES.has(scheduledTime)
      && text(value.origin_stop_id) === '184_1' && text(value.route_id) === '10035'
      && ['target_snapshot', 'vehicle_observation', 'assignment_transition'].includes(text(value.record_kind))
      && ['none', 'assigned', 'unassigned_candidate', 'partial_assignment'].includes(classification)
      && text(value.evidence_level) === 'undetermined' && time(scheduled) !== null && time(observed) !== null
      && integer(value.sample_index) !== null && integer(value.raw_vehicle_entities) !== null
      && integer(value.assigned_count) !== null && integer(value.tripless_count) !== null
      && integer(value.partial_descriptor_count) !== null && integer(value.stale_count) !== null
      && integer(value.gps_missing_count) !== null && integer(value.runtime_dropped_count) !== null
      && !invalidHmac && !tokenLike && !responseLike;
    if (!valid) result.invalidRows++;
    if (invalidHmac) { result.invalidHmac++; result.rawId++; }
    if (tokenLike) result.tokenLeak++;
    if (responseLike) result.rawResponse++;
    const tripId = text(value.target_trip_id);
    if (!result.trips.has(tripId)) result.trips.set(tripId, { before: new Set(), after: new Set() });
    const sampleKey = `${value.run_id}:${value.sample_index}:${value.feed_timestamp}`;
    result.sampleKeys.add(sampleKey);
    if (!result.sampleCounters.has(sampleKey)) result.sampleCounters.set(sampleKey, {
      assigned: integer(value.assigned_count) || 0, partial: integer(value.partial_descriptor_count) || 0,
      stale: integer(value.stale_count) || 0, gpsMissing: integer(value.gps_missing_count) || 0
    });
    const tripSample = `${sampleKey}:${tripId}`;
    (time(observed) < time(scheduled) ? result.trips.get(tripId).before : result.trips.get(tripId).after).add(tripSample);
    if (classification === 'unassigned_candidate' && vehicle) result.unassignedKeys.add(`${sampleKey}:${vehicle}`);
    result.undetermined++;
    if (text(value.record_kind) === 'assignment_transition') result.transitions++;
    if (vehicle && ['assigned', 'unassigned_candidate', 'partial_assignment'].includes(classification)) {
      const chainKey = `${tripId}:${vehicle}`;
      if (!chains.has(chainKey)) chains.set(chainKey, { candidate: [], assigned: [] });
      chains.get(chainKey)[classification === 'assigned' ? 'assigned' : 'candidate'].push(time(observed));
    }
    const seconds = Number(value.seconds_before_scheduled);
    if (value.seconds_before_scheduled !== '' && Number.isFinite(seconds)) result.secondsBefore.push(seconds);
  }
  for (const chain of chains.values()) {
    const candidate = chain.candidate.length ? Math.min(...chain.candidate) : null;
    const assigned = chain.assigned.length ? Math.min(...chain.assigned) : null;
    if (candidate !== null && assigned !== null && candidate <= assigned) result.levelA++;
    else if (candidate !== null) result.levelB++;
  }
  for (const counters of result.sampleCounters.values()) {
    result.assigned += counters.assigned; result.partial += counters.partial;
    result.stale += counters.stale; result.gpsMissing += counters.gpsMissing;
  }
  result.unassigned = result.unassignedKeys.size;
  return result;
}

export function evaluatePreoriginCanary({ targetDate, evaluatedAt = new Date().toISOString(), schedulerResources = [],
  schedulerLogEntries = [], executions = [], runLogEntries = [], rawValues = [] } = {}) {
  const reasons = new Set(), scheduler = schedulerSummary({ targetDate, schedulerResources, schedulerLogEntries });
  const execution = executionSummary(executions, targetDate), logs = runLogSummary(runLogEntries, targetDate);
  const raw = rawSummary(rawValues, targetDate);
  if (!scheduler.configured) reasons.add('SCHEDULER_CONFIG_INVALID');
  if (!scheduler.scheduleTimesComplete) reasons.add('SCHEDULER_SCHEDULE_TIME_MISSING');
  if (scheduler.missing) reasons.add('SCHEDULER_FIRE_MISSING');
  if (scheduler.duplicates) reasons.add('SCHEDULER_DUPLICATE_FIRE');
  if (scheduler.failedAttempts) reasons.add('SCHEDULER_ATTEMPT_FAILURE');
  if (execution.failed) reasons.add('JOB_FAILURE_PRESENT');
  if (execution.consecutiveFailure) reasons.add('CONSECUTIVE_JOB_FAILURES');
  if (execution.running) reasons.add('JOB_EXECUTION_STILL_RUNNING');
  if (execution.count !== scheduler.expected) reasons.add('EXECUTION_COUNT_MISMATCH');
  if (logs.outside) reasons.add('OUTSIDE_TIME_BAND_EXECUTION');
  if (logs.noTarget) reasons.add('NO_TARGET_SERVICE');
  if (logs.staticMismatch) reasons.add('STATIC_MISMATCH_FAILURE');
  if (!raw.headerMatch) reasons.add('RAW_HEADER_MISMATCH');
  if (raw.unexpectedColumns) reasons.add('RAW_UNEXPECTED_COLUMNS');
  if (raw.invalidRows) reasons.add('RAW_ROW_INVALID');
  if (raw.conflicts) reasons.add('OBSERVATION_ID_CONFLICT');
  if (raw.duplicates) reasons.add('OBSERVATION_ID_DUPLICATE');
  if (raw.invalidHmac) reasons.add('INVALID_HMAC_FORMAT');
  if (raw.rawId || raw.tokenLeak || raw.rawResponse) reasons.add('RAW_ID_OR_SECRET_DETECTED');
  if (raw.trips.size !== 12 && !logs.noTarget) reasons.add('TARGET_TRIPS_NOT_12');
  const sufficientlyCovered = raw.trips.size === 12 && [...raw.trips.values()]
    .every((value) => value.before.size >= 10 && value.after.size >= 5);
  if (!sufficientlyCovered) reasons.add('TARGET_WINDOW_COVERAGE_INSUFFICIENT');
  if (logs.samples.size < 280 || raw.sampleKeys.size < 280) reasons.add('SAMPLE_COVERAGE_INSUFFICIENT');
  if (logs.samples.size !== raw.sampleKeys.size) reasons.add('SAMPLE_SOURCE_MISMATCH');
  if (logs.intervalAnomalies) reasons.add('SAMPLE_INTERVAL_ANOMALY');
  if (execution.overlaps) reasons.add('RUN_OVERLAP');
  // The deployed v1 Raw schema does not persist feed-wide unusable, identity-missing, or out-of-radius counts.
  // Keep them null rather than deriving values from overlapping counters.
  reasons.add('CLASSIFICATION_DETAIL_UNAVAILABLE');
  const reasonCodes = [...reasons].sort();
  const decision = reasonCodes.some((code) => FATAL.has(code)) ? 'NO_GO' : reasonCodes.length ? 'HOLD' : 'GO';
  const seconds = raw.secondsBefore;
  return finalizePreoriginDaily({
    service_date: targetDate, evaluated_at: evaluatedAt, expected_runs: scheduler.expected,
    actual_runs: execution.count, success_runs: execution.succeeded, failed_runs: execution.failed,
    skipped_runs: logs.skipped.size, duplicate_execution_count: Math.max(0,
      execution.count - execution.unique, execution.count - scheduler.expected),
    latest_completion_at: execution.latestCompletion, expected_observation_runs: 28,
    actual_observation_runs: Math.max(0, logs.starts.size - logs.skipped.size), expected_samples: 280,
    actual_samples: Math.max(logs.samples.size, raw.sampleKeys.size),
    missing_sample_count: Math.max(0, 280 - Math.min(logs.samples.size, raw.sampleKeys.size)),
    sample_interval_anomaly_count: logs.intervalAnomalies, run_overlap_count: execution.overlaps,
    outside_time_band_count: logs.outside, no_target_service_count: logs.noTarget,
    static_mismatch_count: logs.staticMismatch, target_trip_coverage: raw.trips.size / 12,
    target_trips_observed: raw.trips.size, assigned_count: raw.assigned, unassigned_count: raw.unassigned,
    partial_count: raw.partial, unusable_count: null, stale_count: raw.stale, gps_missing_count: raw.gpsMissing,
    identity_missing_count: null, out_of_radius_count: null, undetermined_count: raw.undetermined,
    transition_count: raw.transitions, level_a_count: raw.levelA, level_b_count: raw.levelB,
    seconds_before_scheduled_p50: percentile(seconds, .5), seconds_before_scheduled_p80: percentile(seconds, .8),
    seconds_before_scheduled_p90: percentile(seconds, .9), seconds_before_scheduled_p95: percentile(seconds, .95),
    header_match: raw.headerMatch, duplicate_count: raw.duplicates, invalid_hmac_count: raw.invalidHmac,
    raw_id_count: raw.rawId, token_leak_count: raw.tokenLeak, raw_response_count: raw.rawResponse,
    unexpected_column_count: raw.unexpectedColumns, decision, reasonCodes
  });
}

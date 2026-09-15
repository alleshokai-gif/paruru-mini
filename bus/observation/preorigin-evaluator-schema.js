import { createHash } from 'node:crypto';

export const PREORIGIN_DAILY_SHEET = 'Bus_Preorigin_Daily';
export const PREORIGIN_EVALUATOR_VERSION = 'p3.2-v1';
export const PREORIGIN_EVALUATOR_SCHEDULE = Object.freeze({
  id: 'paluru-bus-preorigin-evaluator-0910',
  cron: '10 9 * * 1-5',
  timeZone: 'Asia/Tokyo'
});

export const PREORIGIN_DAILY_HEADERS = Object.freeze([
  'evaluation_id', 'service_date', 'evaluated_at', 'expected_runs', 'actual_runs', 'success_runs',
  'failed_runs', 'skipped_runs', 'duplicate_execution_count', 'latest_completion_at',
  'expected_observation_runs', 'actual_observation_runs', 'expected_samples', 'actual_samples',
  'missing_sample_count', 'sample_interval_anomaly_count', 'run_overlap_count',
  'outside_time_band_count', 'no_target_service_count', 'static_mismatch_count',
  'target_trip_coverage', 'target_trips_observed', 'assigned_count', 'unassigned_count',
  'partial_count', 'unusable_count', 'stale_count', 'gps_missing_count', 'identity_missing_count',
  'out_of_radius_count', 'undetermined_count', 'transition_count', 'level_a_count', 'level_b_count',
  'seconds_before_scheduled_p50', 'seconds_before_scheduled_p80', 'seconds_before_scheduled_p90',
  'seconds_before_scheduled_p95', 'header_match', 'duplicate_count', 'invalid_hmac_count',
  'raw_id_count', 'token_leak_count', 'raw_response_count', 'unexpected_column_count',
  'decision', 'reason_codes', 'evaluator_version', 'source_fingerprint'
]);

const DECISIONS = new Set(['GO', 'HOLD', 'NO_GO']);
const iso = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const countOrNull = (value) => value === null || Number.isInteger(value) && value >= 0;
const numberOrNull = (value) => value === null || Number.isFinite(value);

export function preoriginEvaluationFingerprint(value) {
  const encoded = JSON.stringify(value);
  return createHash('sha256').update(encoded).digest('hex').slice(0, 32);
}

export function finalizePreoriginDaily(row) {
  const value = { ...row };
  value.reason_codes = JSON.stringify([...(value.reasonCodes || [])].sort());
  delete value.reasonCodes;
  value.evaluator_version = PREORIGIN_EVALUATOR_VERSION;
  const fingerprintInput = Object.fromEntries(PREORIGIN_DAILY_HEADERS
    .filter((name) => !['evaluation_id', 'evaluated_at', 'source_fingerprint'].includes(name))
    .map((name) => [name, value[name] ?? null]));
  value.source_fingerprint = preoriginEvaluationFingerprint(fingerprintInput);
  value.evaluation_id = `pev_${preoriginEvaluationFingerprint([
    value.service_date, value.evaluator_version, value.source_fingerprint
  ])}`;
  validatePreoriginDaily(value);
  return Object.freeze(value);
}

export function validatePreoriginDaily(row) {
  const countFields = PREORIGIN_DAILY_HEADERS.filter((name) => name.endsWith('_count'))
    .concat(['expected_runs', 'actual_runs', 'success_runs', 'failed_runs', 'skipped_runs',
      'expected_observation_runs', 'actual_observation_runs', 'expected_samples', 'actual_samples',
      'target_trips_observed', 'assigned_count', 'unassigned_count', 'partial_count', 'unusable_count']);
  const percentileFields = ['target_trip_coverage', 'seconds_before_scheduled_p50',
    'seconds_before_scheduled_p80', 'seconds_before_scheduled_p90', 'seconds_before_scheduled_p95'];
  let reasons;
  try { reasons = JSON.parse(row?.reason_codes); } catch { throw Error('PREORIGIN_DAILY_ROW_INVALID'); }
  if (!row || !/^pev_[a-f0-9]{32}$/.test(row.evaluation_id || '')
    || !/^\d{4}-\d{2}-\d{2}$/.test(row.service_date || '') || !iso(row.evaluated_at)
    || !DECISIONS.has(row.decision) || row.evaluator_version !== PREORIGIN_EVALUATOR_VERSION
    || !/^[a-f0-9]{32}$/.test(row.source_fingerprint || '') || typeof row.header_match !== 'boolean'
    || !Array.isArray(reasons) || reasons.some((code) => !/^[A-Z0-9_]{3,80}$/.test(code))
    || countFields.some((name) => !countOrNull(row[name]))
    || percentileFields.some((name) => !numberOrNull(row[name])))
    throw Error('PREORIGIN_DAILY_ROW_INVALID');
  return row;
}

export function preoriginDailyValues(row) {
  validatePreoriginDaily(row);
  return PREORIGIN_DAILY_HEADERS.map((name) => row[name] === null || row[name] === undefined ? '' : row[name]);
}

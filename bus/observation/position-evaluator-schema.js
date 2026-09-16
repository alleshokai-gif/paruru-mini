import { createHash } from 'node:crypto';

export const POSITION_EVALUATION_SHEET = 'Bus_Position_Evaluation';
export const POSITION_DAILY_SHEET = 'Bus_Position_Daily';
export const POSITION_EVALUATOR_VERSION = 'p3.3-shadow-v2';

export const POSITION_EVALUATION_HEADERS = Object.freeze([
  'evaluation_id', 'source_observation_id', 'service_date', 'observed_at', 'provider', 'route_id',
  'trip_id', 'direction', 'vehicle_hmac', 'geometry_source', 'geometry_version', 'geometry_id',
  'snap_distance_m', 'snapped_progress', 'inferred_direction', 'direction_confidence',
  'previous_stop_id', 'next_stop_id', 'stop_interval_index', 'candidate_stops_away',
  'stops_away_confidence', 'monotonicity_status', 'jitter_flag', 'severe_contradiction_flag',
  'ambiguity_reason', 'aux_consistency', 'evaluator_version'
]);

export const POSITION_DAILY_HEADERS = Object.freeze([
  'daily_id', 'service_date', 'evaluated_at', 'provider', 'direction_id', 'route_id',
  'geometry_source', 'geometry_version', 'geometry_id', 'stage', 'raw_rows', 'unique_observations',
  'derived_rows', 'duplicate_count', 'conflicting_duplicate_count', 'service_day_count',
  'independent_trip_count', 'timeband_count', 'gps_rows', 'gps_missing_rows', 'gps_stale_rows',
  'identity_missing_rows', 'gps_usable_rows', 'gps_usable_coverage', 'snap_matched_rows',
  'snap_ambiguous_rows', 'snap_off_route_rows', 'trip_geometry_mismatch_rows', 'snap_match_rate',
  'snap_distance_p50_m', 'snap_distance_p80_m', 'snap_distance_p90_m', 'snap_distance_p95_m',
  'snap_distance_max_m', 'confidence_fail_rows', 'direction_trace_count', 'monotonic_trace_count',
  'direction_consistency', 'reverse_or_jump_count', 'stop_count', 'stop_projection_count',
  'stop_projection_order_violation_count', 'expected_interval_count', 'observed_interval_count',
  'stop_interval_coverage', 'stops_away_rows', 'stops_away_jitter_count',
  'severe_stops_away_contradiction_count', 'aux_sequence_contradiction_count', 'ambiguous_count',
  'stale_count', 'token_leak_count', 'raw_id_count', 'raw_response_count', 'header_match',
  'geometry_ready_candidate', 'decision', 'reason_codes', 'evaluator_version', 'source_fingerprint'
]);

const DECISIONS = new Set(['GO', 'HOLD', 'NO_GO']);
const MONOTONICITY = new Set(['not_evaluated', 'insufficient_history', 'monotonic', 'reverse', 'jump',
  'duplicate_timestamp', 'ambiguous']);
const DIRECTIONS = new Set(['forward', 'reverse', 'unknown']);
const AUX = new Set(['consistent', 'conflict', 'not_available']);
const countOrNull = (value) => value === null || Number.isInteger(value) && value >= 0;
const numberOrNull = (value) => value === null || Number.isFinite(value);
const probabilityOrNull = (value) => value === null || Number.isFinite(value) && value >= 0 && value <= 1;
const textOrNull = (value) => value === null || typeof value === 'string';
const identifierOrNull = (value) => value === null || /^[A-Za-z0-9_.:-]{1,200}$/.test(value);

function hash32(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32);
}

export function finalizePositionObservation(row) {
  const value = { ...row, evaluator_version: POSITION_EVALUATOR_VERSION };
  value.evaluation_id = `posrow_${hash32([
    value.source_observation_id, value.provider, value.direction, value.route_id,
    value.geometry_source, value.geometry_version, value.geometry_id, value.evaluator_version
  ])}`;
  validatePositionObservation(value);
  return Object.freeze(value);
}

export function validatePositionObservation(row) {
  if (!row || !/^posrow_[a-f0-9]{32}$/.test(row.evaluation_id || '')
    || !/^obs_[a-f0-9]{32}$/.test(row.source_observation_id || '')
    || !/^\d{4}-\d{2}-\d{2}$/.test(row.service_date || '')
    || !Number.isFinite(Date.parse(row.observed_at || ''))
    || !identifierOrNull(row.provider) || !identifierOrNull(row.route_id)
    || !identifierOrNull(row.trip_id) || !identifierOrNull(row.direction)
    || !/^veh_[a-f0-9]{32}$/.test(row.vehicle_hmac || '')
    || !textOrNull(row.geometry_source) || !textOrNull(row.geometry_version)
    || !textOrNull(row.geometry_id) || !numberOrNull(row.snap_distance_m)
    || !probabilityOrNull(row.snapped_progress) || !DIRECTIONS.has(row.inferred_direction)
    || !probabilityOrNull(row.direction_confidence) || !textOrNull(row.previous_stop_id)
    || !textOrNull(row.next_stop_id) || !countOrNull(row.stop_interval_index)
    || !countOrNull(row.candidate_stops_away) || !probabilityOrNull(row.stops_away_confidence)
    || !MONOTONICITY.has(row.monotonicity_status) || typeof row.jitter_flag !== 'boolean'
    || typeof row.severe_contradiction_flag !== 'boolean' || !textOrNull(row.ambiguity_reason)
    || !AUX.has(row.aux_consistency) || row.evaluator_version !== POSITION_EVALUATOR_VERSION)
    throw Error('POSITION_OBSERVATION_ROW_INVALID');
  return row;
}

export function positionObservationValues(row) {
  validatePositionObservation(row);
  return POSITION_EVALUATION_HEADERS.map((name) => row[name] === null || row[name] === undefined ? '' : row[name]);
}

export function finalizePositionDaily(row) {
  const value = { ...row, reason_codes: JSON.stringify([...(row.reasonCodes || [])].sort()),
    evaluator_version: POSITION_EVALUATOR_VERSION };
  delete value.reasonCodes;
  const fingerprintInput = Object.fromEntries(POSITION_DAILY_HEADERS
    .filter((name) => !['daily_id', 'evaluated_at', 'source_fingerprint'].includes(name))
    .map((name) => [name, value[name] ?? null]));
  value.source_fingerprint = hash32(fingerprintInput);
  value.daily_id = `posday_${hash32([
    value.service_date, value.provider, value.direction_id, value.route_id,
    value.evaluator_version, value.source_fingerprint
  ])}`;
  validatePositionDaily(value);
  return Object.freeze(value);
}

export function validatePositionDaily(row) {
  const counts = POSITION_DAILY_HEADERS.filter((name) => name.endsWith('_count') || name.endsWith('_rows'))
    .concat(['raw_rows', 'unique_observations', 'derived_rows', 'independent_trip_count', 'timeband_count',
      'gps_rows', 'snap_matched_rows', 'direction_trace_count', 'monotonic_trace_count', 'stop_count',
      'stop_projection_count', 'expected_interval_count', 'observed_interval_count']);
  const numbers = ['gps_usable_coverage', 'snap_distance_p50_m', 'snap_distance_p80_m',
    'snap_distance_p90_m', 'snap_distance_p95_m', 'snap_distance_max_m', 'direction_consistency',
    'stop_interval_coverage', 'snap_match_rate'];
  let reasons;
  try { reasons = JSON.parse(row?.reason_codes); } catch { throw Error('POSITION_DAILY_ROW_INVALID'); }
  if (!row || !/^posday_[a-f0-9]{32}$/.test(row.daily_id || '')
    || !/^\d{4}-\d{2}-\d{2}$/.test(row.service_date || '')
    || !Number.isFinite(Date.parse(row.evaluated_at)) || !DECISIONS.has(row.decision)
    || !['stage_0', 'stage_1_shadow'].includes(row.stage) || typeof row.header_match !== 'boolean'
    || row.geometry_ready_candidate !== false || row.evaluator_version !== POSITION_EVALUATOR_VERSION
    || !/^[a-f0-9]{32}$/.test(row.source_fingerprint || '')
    || !Array.isArray(reasons) || reasons.some((code) => !/^[A-Z0-9_]{3,100}$/.test(code))
    || counts.some((name) => !countOrNull(row[name])) || numbers.some((name) => !numberOrNull(row[name])))
    throw Error('POSITION_DAILY_ROW_INVALID');
  return row;
}

export function positionDailyValues(row) {
  validatePositionDaily(row);
  return POSITION_DAILY_HEADERS.map((name) => row[name] === null || row[name] === undefined ? '' : row[name]);
}

// Existing callers treated the daily summary as the evaluator result. Keep the name as a compatibility alias.
export const finalizePositionEvaluation = finalizePositionDaily;
export const validatePositionEvaluation = validatePositionDaily;
export const positionEvaluationValues = positionDailyValues;

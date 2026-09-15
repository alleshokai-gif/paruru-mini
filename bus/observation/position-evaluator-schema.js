import { createHash } from 'node:crypto';

export const POSITION_EVALUATION_SHEET = 'Bus_Position_Evaluation';
export const POSITION_EVALUATOR_VERSION = 'p3.3-shadow-v1';
export const POSITION_EVALUATION_HEADERS = Object.freeze([
  'evaluation_id', 'service_date', 'evaluated_at', 'provider', 'direction_id', 'route_id',
  'geometry_source', 'geometry_version', 'geometry_id', 'stage', 'raw_rows', 'unique_observations',
  'duplicate_count', 'conflicting_duplicate_count', 'service_day_count', 'independent_trip_count',
  'gps_rows', 'gps_missing_rows', 'gps_stale_rows', 'identity_missing_rows', 'gps_usable_rows',
  'gps_usable_coverage', 'snap_matched_rows', 'snap_ambiguous_rows', 'snap_off_route_rows',
  'trip_geometry_mismatch_rows', 'snap_match_rate',
  'snap_distance_p50_m', 'snap_distance_p80_m', 'snap_distance_p90_m', 'snap_distance_p95_m',
  'snap_distance_max_m', 'confidence_fail_rows', 'direction_trace_count', 'monotonic_trace_count',
  'direction_accuracy', 'reverse_or_jump_count', 'stop_count', 'stop_projection_count',
  'stop_projection_order_violation_count', 'expected_segment_count', 'observed_segment_count',
  'segment_coverage', 'stops_away_rows', 'stops_away_jitter_count',
  'severe_stops_away_contradiction_count', 'aux_sequence_contradiction_count',
  'token_leak_count', 'raw_id_count', 'raw_response_count', 'header_match', 'geometry_ready',
  'decision', 'reason_codes', 'evaluator_version', 'source_fingerprint'
]);

const DECISIONS = new Set(['GO', 'HOLD', 'NO_GO']);
const countOrNull = (value) => value === null || Number.isInteger(value) && value >= 0;
const numberOrNull = (value) => value === null || Number.isFinite(value);

export function finalizePositionEvaluation(row) {
  const value = { ...row, reason_codes: JSON.stringify([...(row.reasonCodes || [])].sort()),
    evaluator_version: POSITION_EVALUATOR_VERSION };
  delete value.reasonCodes;
  const fingerprintInput = Object.fromEntries(POSITION_EVALUATION_HEADERS
    .filter((name) => !['evaluation_id', 'evaluated_at', 'source_fingerprint'].includes(name))
    .map((name) => [name, value[name] ?? null]));
  value.source_fingerprint = createHash('sha256').update(JSON.stringify(fingerprintInput)).digest('hex').slice(0, 32);
  value.evaluation_id = `posev_${createHash('sha256').update(JSON.stringify([
    value.service_date, value.provider, value.direction_id, value.route_id,
    value.evaluator_version, value.source_fingerprint
  ])).digest('hex').slice(0, 32)}`;
  validatePositionEvaluation(value);
  return Object.freeze(value);
}

export function validatePositionEvaluation(row) {
  const counts = POSITION_EVALUATION_HEADERS.filter((name) => name.endsWith('_count') || name.endsWith('_rows'))
    .concat(['raw_rows', 'unique_observations', 'independent_trip_count', 'gps_rows', 'snap_matched_rows',
      'direction_trace_count', 'monotonic_trace_count', 'stop_count', 'stop_projection_count',
      'expected_segment_count', 'observed_segment_count']);
  const numbers = ['gps_usable_coverage', 'snap_distance_p50_m', 'snap_distance_p80_m',
    'snap_distance_p90_m', 'snap_distance_p95_m', 'snap_distance_max_m', 'direction_accuracy',
    'segment_coverage', 'snap_match_rate'];
  let reasons;
  try { reasons = JSON.parse(row?.reason_codes); } catch { throw Error('POSITION_EVALUATION_ROW_INVALID'); }
  if (!row || !/^posev_[a-f0-9]{32}$/.test(row.evaluation_id || '')
    || !/^\d{4}-\d{2}-\d{2}$/.test(row.service_date || '')
    || !Number.isFinite(Date.parse(row.evaluated_at)) || !DECISIONS.has(row.decision)
    || !['stage_0', 'stage_1_shadow'].includes(row.stage) || typeof row.header_match !== 'boolean'
    || typeof row.geometry_ready !== 'boolean' || row.evaluator_version !== POSITION_EVALUATOR_VERSION
    || !/^[a-f0-9]{32}$/.test(row.source_fingerprint || '')
    || !Array.isArray(reasons) || reasons.some((code) => !/^[A-Z0-9_]{3,100}$/.test(code))
    || counts.some((name) => !countOrNull(row[name])) || numbers.some((name) => !numberOrNull(row[name])))
    throw Error('POSITION_EVALUATION_ROW_INVALID');
  return row;
}

export function positionEvaluationValues(row) {
  validatePositionEvaluation(row);
  return POSITION_EVALUATION_HEADERS.map((name) => row[name] === null || row[name] === undefined ? '' : row[name]);
}

import { createHmac } from 'node:crypto';

export const PREORIGIN_RAW_SHEET = 'Bus_Preorigin_Raw';
export const PREORIGIN_HEADERS = Object.freeze([
  'preorigin_observation_id', 'run_id', 'sample_index', 'observed_at', 'service_date', 'target_trip_id',
  'scheduled_departure', 'origin_stop_id', 'route_id', 'platform', 'record_kind', 'vehicle_classification',
  'vehicle_hash', 'vehicle_timestamp', 'position_lat', 'position_lon', 'distance_to_origin_m', 'gps_age_sec',
  'feed_timestamp', 'rt_age_sec', 'raw_vehicle_entities', 'assigned_count', 'tripless_count',
  'partial_descriptor_count', 'stale_count', 'gps_missing_count', 'runtime_dropped_count',
  'preorigin_vehicle_seen', 'preorigin_first_seen_at', 'preorigin_distance_to_origin', 'trip_assignment_transition_at',
  'seconds_before_scheduled', 'arrival_to_origin', 'departure_positive_evidence', 'evidence_level', 'censored'
]);

const KINDS = new Set(['target_snapshot', 'vehicle_observation', 'assignment_transition']);
const CLASSIFICATIONS = new Set(['none', 'assigned', 'unassigned_candidate', 'partial_assignment']);
const LEVELS = new Set(['A', 'B', 'undetermined']);
const identifier = (value) => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(value);
const iso = (value) => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?\+09:00$/.test(value)
  && Number.isFinite(Date.parse(value));
const optionalIso = (value) => value === null || iso(value);
const finiteOrNull = (value) => value === null || Number.isFinite(value);
const integerOrNull = (value) => value === null || Number.isSafeInteger(value);
const count = (value) => Number.isInteger(value) && value >= 0;
const round = (value, digits = 3) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null;

export function finalizePreoriginObservation(row, key) {
  if (typeof key !== 'string' || key.length < 32) throw Error('PREORIGIN_HASH_INPUT_INVALID');
  const value = { ...row };
  value.position_lat = round(value.position_lat, 6); value.position_lon = round(value.position_lon, 6);
  value.distance_to_origin_m = round(value.distance_to_origin_m, 1);
  value.preorigin_distance_to_origin = round(value.preorigin_distance_to_origin, 1);
  value.gps_age_sec = round(value.gps_age_sec); value.rt_age_sec = round(value.rt_age_sec);
  const canonical = [value.service_date, value.target_trip_id, value.record_kind, value.vehicle_hash,
    value.vehicle_timestamp, value.feed_timestamp, value.evidence_level, value.trip_assignment_transition_at]
    .map((item) => item === null || item === undefined ? '' : String(item)).join('\u001f');
  value.preorigin_observation_id = `pre_${createHmac('sha256', key).update(canonical).digest('hex').slice(0, 32)}`;
  validatePreoriginObservation(value);
  return Object.freeze(value);
}

export function validatePreoriginObservation(row) {
  const counters = ['raw_vehicle_entities', 'assigned_count', 'tripless_count', 'partial_descriptor_count',
    'stale_count', 'gps_missing_count', 'runtime_dropped_count'];
  if (!row || !/^pre_[a-f0-9]{32}$/.test(row.preorigin_observation_id || '') || !identifier(row.run_id)
    || !Number.isInteger(row.sample_index) || row.sample_index < 0 || !iso(row.observed_at)
    || !/^\d{8}$/.test(row.service_date || '') || !identifier(row.target_trip_id)
    || !iso(row.scheduled_departure) || row.origin_stop_id !== '184_1' || row.route_id !== '10035'
    || typeof row.platform !== 'string' || row.platform.length > 80 || !KINDS.has(row.record_kind)
    || !CLASSIFICATIONS.has(row.vehicle_classification)
    || !(row.vehicle_hash === null || /^veh_[a-f0-9]{32}$/.test(row.vehicle_hash))
    || !integerOrNull(row.vehicle_timestamp) || !finiteOrNull(row.position_lat) || !finiteOrNull(row.position_lon)
    || (row.position_lat === null) !== (row.position_lon === null)
    || row.position_lat !== null && Math.abs(row.position_lat) > 90
    || row.position_lon !== null && Math.abs(row.position_lon) > 180
    || !finiteOrNull(row.distance_to_origin_m) || !finiteOrNull(row.gps_age_sec)
    || !integerOrNull(row.feed_timestamp) || !finiteOrNull(row.rt_age_sec)
    || !counters.every((name) => count(row[name])) || typeof row.preorigin_vehicle_seen !== 'boolean'
    || !optionalIso(row.preorigin_first_seen_at) || !finiteOrNull(row.preorigin_distance_to_origin)
    || !optionalIso(row.trip_assignment_transition_at)
    || !finiteOrNull(row.seconds_before_scheduled) || !optionalIso(row.arrival_to_origin)
    || !(row.departure_positive_evidence === null || identifier(row.departure_positive_evidence))
    || !LEVELS.has(row.evidence_level) || typeof row.censored !== 'boolean')
    throw Error('PREORIGIN_ROW_INVALID');
  return row;
}

export function preoriginObservationValues(row) {
  validatePreoriginObservation(row);
  return PREORIGIN_HEADERS.map((name) => row[name] === null || row[name] === undefined ? '' : row[name]);
}

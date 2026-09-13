import { createHmac } from 'node:crypto';

export const RAW_SHEET='Bus_Observation_Raw';
export const DAILY_SHEET='Bus_Observation_Daily';
export const OBSERVATION_HEADERS=Object.freeze([
  'observation_id','run_id','sample_index','observation_kind','observed_at','provider','direction_id','route_id','trip_id',
  'service_date','origin_stop_id','platform','scheduled_departure','evidence_type','departure_state',
  'elapsed_from_scheduled_sec','gps_age_sec','rt_age_sec','next_bus_gap_min','censored','vehicle_hash','gps_timestamp',
  'position_lat','position_lon','position_state','position_confidence','position_reason','previous_stop_id','next_stop_id',
  'position_segment_key','position_expected_segments','aux_stop_id','aux_stop_sequence','aux_status'
]);
export const DAILY_HEADERS=Object.freeze([
  'summary_id','generated_at','local_date','provider','direction_id','route_id','origin_stop_id','platform','raw_rows',
  'unique_observations','unique_trips','positive_trips','censored_trips','departure_anomaly_rows','median_sec','p80_sec','p90_sec','p95_sec',
  'gps_rows','position_supported_rows','position_missing_rows','position_stale_rows','position_anomaly_rows',
  'observed_segment_count','expected_segment_count','position_coverage','missing_field_rows','duplicate_rows',
  'calibration_ready','candidate_overdue_sec','candidate_unknown_sec'
]);
const STATES=new Set(['scheduled','realtime','departure_pending','departure_overdue','departure_uncertain','departed','cancelled','unknown']);
const EVIDENCE=new Set(['gps_origin_passed','vehicle_next_trip','trip_next_stop','rt_departed','gps_at_origin','cancelled']);
const KINDS=new Set(['departure','position','departure_position']);
const identifier=value=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(value);
const optionalIdentifier=value=>value===null||value===''||identifier(value);
const finiteOrNull=value=>value===null||Number.isFinite(value);
const iso=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?\+09:00$/.test(value)
  &&Number.isFinite(Date.parse(value));
const date=value=>typeof value==='string'&&/^\d{8}$/.test(value);
const round=(value,digits=3)=>Number.isFinite(value)?Number(value.toFixed(digits)):null;
export function hmacId(prefix,key,parts) {
  if(typeof key!=='string'||key.length<32||!Array.isArray(parts))throw Error('OBSERVATION_HASH_INPUT_INVALID');
  const canonical=parts.map(value=>value===null||value===undefined?'':typeof value==='boolean'?(value?'1':'0'):String(value)).join('\u001f');
  return `${prefix}_${createHmac('sha256',key).update(canonical).digest('hex').slice(0,32)}`;
}
export const vehicleHash=(key,vehicleId)=>identifier(vehicleId)?hmacId('veh',key,[vehicleId]):null;
export function finalizeObservation(row,key) {
  const value={...row};
  value.position_lat=round(value.position_lat,6);value.position_lon=round(value.position_lon,6);
  value.position_confidence=round(value.position_confidence,4);
  value.gps_age_sec=round(value.gps_age_sec);value.rt_age_sec=round(value.rt_age_sec);
  value.next_bus_gap_min=round(value.next_bus_gap_min,2);value.elapsed_from_scheduled_sec=round(value.elapsed_from_scheduled_sec);
  value.observation_id=hmacId('obs',key,[value.provider,value.direction_id,value.route_id,value.trip_id,value.service_date,
    value.observation_kind,value.gps_timestamp,value.rt_timestamp??null,value.departure_state,value.evidence_type,
    value.position_state,value.position_segment_key]);
  delete value.rt_timestamp;
  validateObservation(value);
  return Object.freeze(value);
}
export function validateObservation(row) {
  if(!row||!identifier(row.observation_id)||!identifier(row.run_id)||!Number.isInteger(row.sample_index)||row.sample_index<0
    ||!KINDS.has(row.observation_kind)||!iso(row.observed_at)||!identifier(row.provider)||!identifier(row.direction_id)
    ||!identifier(row.route_id)||!identifier(row.trip_id)||!date(row.service_date)||!identifier(row.origin_stop_id)
    ||typeof row.platform!=='string'||row.platform.length>80||!iso(row.scheduled_departure)
    ||!(row.evidence_type===null||EVIDENCE.has(row.evidence_type))
    ||!(row.departure_state===null||STATES.has(row.departure_state))
    ||![row.elapsed_from_scheduled_sec,row.gps_age_sec,row.rt_age_sec,row.next_bus_gap_min,row.position_confidence]
      .every(finiteOrNull)||typeof row.censored!=='boolean'||!optionalIdentifier(row.vehicle_hash)
    ||!(row.gps_timestamp===null||Number.isSafeInteger(row.gps_timestamp))
    ||!finiteOrNull(row.position_lat)||!finiteOrNull(row.position_lon)
    ||(row.position_lat!==null&&Math.abs(row.position_lat)>90)||(row.position_lon!==null&&Math.abs(row.position_lon)>180)
    ||!optionalIdentifier(row.position_state)||!optionalIdentifier(row.position_reason)
    ||!optionalIdentifier(row.previous_stop_id)||!optionalIdentifier(row.next_stop_id)||!optionalIdentifier(row.position_segment_key)
    ||!(row.position_expected_segments===null||Number.isInteger(row.position_expected_segments)&&row.position_expected_segments>=1)
    ||!optionalIdentifier(row.aux_stop_id)||!(row.aux_stop_sequence===null||Number.isInteger(row.aux_stop_sequence)&&row.aux_stop_sequence>=0)
    ||!(row.aux_status===null||Number.isInteger(row.aux_status)))throw Error('OBSERVATION_ROW_INVALID');
  return row;
}
export function observationValues(row) {
  validateObservation(row);
  return OBSERVATION_HEADERS.map(name=>row[name]===null||row[name]===undefined?'':row[name]);
}

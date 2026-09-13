import { LIMITS } from '../config/policy.js';
import { serviceActive,iso } from '../core/arrivals.js';
import { clockSeconds } from '../core/time.js';
import { createDepartureConfidence } from '../departure/confidence.js';
import { createPositionEngine,normalizeVehicle } from '../position/engine.js';
import { createRouteIndex } from '../position/route-index.js';
import { resolvePlatform } from '../providers/kawasaki/config.js';
import { finalizeObservation,vehicleHash } from './schema.js';

const DAY=86400,JST=9*3600,LOOK_BACK_SEC=45*60,LOOK_AHEAD_SEC=30*60;
const dayStart=seconds=>Math.floor((seconds+JST)/DAY)*DAY-JST;
const dateKey=seconds=>iso(seconds).slice(0,10).replaceAll('-','');
const dayFromDate=value=>/^\d{8}$/.test(value||'')?Date.parse(`${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6)}T00:00:00+09:00`)/1000:NaN;
const key=trip=>`${trip?.startDate||''}:${trip?.tripId||''}`;
const fresh=(timestamp,now,maxAge)=>Number.isFinite(timestamp)&&timestamp<=now+5&&now-timestamp>=0&&now-timestamp<=maxAge;
const positive=new Set(['gps_origin_passed','vehicle_next_trip','trip_next_stop','rt_departed']);
const evidenceType=decision=>decision?.state==='cancelled'?'cancelled':
  positive.has(decision?.reason)?decision.reason:decision?.state==='departure_pending'?'gps_at_origin':null;
const sameStart=(descriptor,row)=>!descriptor?.startTime||clockSeconds(descriptor.startTime)===clockSeconds(row.startTime);

function staticRows(index) {
  const rows=new Map();
  for(const [directionId,items] of Object.entries(index.directions||{}))for(const source of items) {
    const row={...source,directionId};
    const current=rows.get(row.tripId);
    if(current&&(current.routeId!==row.routeId||current.originStopId!==row.originStopId||current.startTime!==row.startTime))
      throw Error('OBSERVATION_STATIC_TRIP_AMBIGUOUS');
    if(!current||row.isOrigin)rows.set(row.tripId,row);
  }
  return rows;
}
export function createObservationCollector({index,positionStatic,hashKey,provider='kawasaki'}={}) {
  if(!index?.directions||!positionStatic?.trips||!positionStatic?.chains||typeof hashKey!=='string'||hashKey.length<32)
    throw Error('OBSERVATION_COLLECTOR_CONFIG_INVALID');
  const rows=staticRows(index),departureDirections=new Set(['noborito_to_home','mizonokuchi_to_home']);
  const routeIndex=createRouteIndex(positionStatic,index,provider),positionEngine=createPositionEngine({routeIndex});
  const departure=createDepartureConfidence({index,positionStatic});
  const scheduleCache=new Map();
  function routeSchedule(row,date) {
    const cacheKey=`${date}:${row.routeId}:${row.originStopId}`;
    if(scheduleCache.has(cacheKey))return scheduleCache.get(cacheKey);
    const start=dayFromDate(date),values=[];
    if(Number.isFinite(start))for(const value of rows.values())if(value.routeId===row.routeId&&value.originStopId===row.originStopId
      &&serviceActive(index,value.serviceId,start)) {
      const seconds=clockSeconds(value.startTime);if(Number.isFinite(seconds))values.push(start+seconds);
    }
    const result=[...new Set(values)].sort((a,b)=>a-b);scheduleCache.set(cacheKey,result);return result;
  }
  function nextScheduled(row,date,scheduled) {return routeSchedule(row,date).find(value=>value>scheduled)||null;}
  function candidateDepartureRows(now) {
    const result=[];
    for(const day of [dayStart(now)-DAY,dayStart(now),dayStart(now)+DAY]) {
      const date=dateKey(day);
      for(const row of rows.values())if(row.isOrigin&&departureDirections.has(row.directionId)
        &&serviceActive(index,row.serviceId,day)) {
        const originSeconds=clockSeconds(row.startTime),scheduled=Number.isFinite(originSeconds)?day+originSeconds:NaN;
        if(Number.isFinite(scheduled)&&scheduled>=now-LOOK_BACK_SEC&&scheduled<=now+LOOK_AHEAD_SEC)
          result.push({row,date,scheduled});
      }
    }
    return result;
  }
  function positionResult(vehicle,row,date,now) {
    if(!vehicle)return {result:null,expected:null};
    const trip=positionStatic.trips[row.tripId],chain=positionStatic.chains[trip?.chainId];
    if(!chain?.stops?.length)return {result:null,expected:null};
    const last=chain.stops.at(-1),start=dayFromDate(date),normalized=normalizeVehicle({
      ...vehicle,trip:{...vehicle.trip,routeId:vehicle.trip?.routeId||row.routeId}},provider);
    const result=positionEngine.evaluate({...normalized,serviceDayStart:start},{stopId:last.stopId,sequence:last.sequence},now);
    return {result,expected:chain.stops.length-1};
  }
  function collect({realtime,now,runId,sampleIndex}) {
    if(!realtime||!Number.isFinite(now)||typeof runId!=='string'||!Number.isInteger(sampleIndex)||sampleIndex<0)
      throw Error('OBSERVATION_SAMPLE_INVALID');
    departure.observe({realtime,now});
    const feedFresh=fresh(realtime.timestamp,now,LIMITS.feedMaxAgeSec),updates=new Map(),vehicles=new Map();
    for(const [source,target] of [[realtime.updates||[],updates],[realtime.vehicles||[],vehicles]])for(const item of source) {
      const tripKey=key(item.trip);if(!target.has(tripKey))target.set(tripKey,[]);target.get(tripKey).push(item);
    }
    const candidates=new Map();
    for(const candidate of candidateDepartureRows(now))candidates.set(`${candidate.date}:${candidate.row.tripId}`,{...candidate,departure:true,position:false});
    for(const vehicle of realtime.vehicles||[]) {
      const row=rows.get(vehicle.trip?.tripId),date=vehicle.trip?.startDate,start=dayFromDate(date);
      if(!row||!Number.isFinite(start)||!serviceActive(index,row.serviceId,start)||!sameStart(vehicle.trip,row))continue;
      const scheduled=start+clockSeconds(row.startTime),tripKey=`${date}:${row.tripId}`,current=candidates.get(tripKey);
      candidates.set(tripKey,current?{...current,position:true}:{row,date,scheduled,departure:false,position:true});
    }
    const observations=[];
    for(const candidate of candidates.values()) {
      const {row,date,scheduled}=candidate,tripKey=`${date}:${row.tripId}`;
      const vehicleList=vehicles.get(tripKey)||[],updateList=updates.get(tripKey)||[];
      const vehicle=vehicleList.length===1&&sameStart(vehicleList[0].trip,row)?vehicleList[0]:null;
      const tripUpdate=updateList.length===1&&sameStart(updateList[0].trip,row)?updateList[0]:null;
      const next=nextScheduled(row,date,scheduled);
      const decision=candidate.departure?departure.evaluate({row,date,scheduled,estimated:null,now,nextScheduled:next,
        feedFresh,tripActive:true,cancelled:Boolean(feedFresh&&tripUpdate?.trip?.relationship===3),tripUpdate,vehicle}):null;
      const evidence=evidenceType(decision),position=positionResult(vehicle,row,date,now),supported=position.result?.supported===true;
      const gpsTimestamp=Number.isSafeInteger(vehicle?.timestamp)?vehicle.timestamp:null;
      const segment=supported&&position.result.previousStop&&position.result.nextStop
        ?`${position.result.previousStop.id}:${position.result.nextStop.id}`:null;
      observations.push(finalizeObservation({
        observation_id:null,run_id:runId,sample_index:sampleIndex,
        observation_kind:candidate.departure&&candidate.position?'departure_position':candidate.departure?'departure':'position',
        observed_at:iso(now),provider,direction_id:row.directionId,route_id:row.routeId,trip_id:row.tripId,service_date:date,
        origin_stop_id:row.originStopId,platform:resolvePlatform(row.originStopId)||'',scheduled_departure:iso(scheduled),
        evidence_type:evidence,departure_state:decision?.state||null,
        elapsed_from_scheduled_sec:candidate.departure?(decision?.evidenceAt??now)-scheduled:null,
        gps_age_sec:gpsTimestamp===null?null:Math.max(0,now-gpsTimestamp),
        rt_age_sec:Number.isFinite(realtime.timestamp)?Math.max(0,now-realtime.timestamp):null,
        next_bus_gap_min:next===null?null:(next-scheduled)/60,
        censored:Boolean(candidate.departure&&scheduled<=now&&!positive.has(evidence)&&decision?.state!=='cancelled'),
        vehicle_hash:vehicleHash(hashKey,vehicle?.vehicleId),gps_timestamp:gpsTimestamp,
        position_lat:Number.isFinite(vehicle?.position?.lat)?vehicle.position.lat:null,
        position_lon:Number.isFinite(vehicle?.position?.lon)?vehicle.position.lon:null,
        position_state:position.result?.state||null,position_confidence:position.result?.confidence??null,
        position_reason:position.result?.reason||null,previous_stop_id:supported?position.result.previousStop?.id||null:null,
        next_stop_id:supported?position.result.nextStop?.id||null:null,position_segment_key:segment,
        position_expected_segments:position.expected,aux_stop_id:vehicle?.stopId||null,
        aux_stop_sequence:Number.isInteger(vehicle?.sequence)?vehicle.sequence:null,
        aux_status:Number.isInteger(vehicle?.status)?vehicle.status:null,rt_timestamp:realtime.timestamp
      },hashKey));
    }
    return observations;
  }
  return {collect,stats:()=>({staticTrips:rows.size,position:routeIndex.stats,departure:departure.stats()})};
}

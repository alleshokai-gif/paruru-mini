import { distanceMeters,validPoint } from '../position/geometry.js';
import { ORIGIN_EVIDENCE_POLICY } from './policy.js';

const unknown=(reason,extra={})=>({supported:false,state:'unknown',originPassed:false,confidence:0,
  tripId:null,startDate:null,observedAt:null,...extra,reason});
const identity=value=>typeof value==='string'&&value.length>0&&value.length<=128
  &&!/[\u0000-\u001f\u007f]/.test(value);

export function createOriginEvidenceTracker({policy:overrides={}}={}) {
  const policy={...ORIGIN_EVIDENCE_POLICY,...overrides},histories=new Map();
  if(!Number.isFinite(policy.maxAgeSec)||policy.maxAgeSec<=0||!Number.isFinite(policy.futureSec)||policy.futureSec<0
    ||!Number.isFinite(policy.historySec)||policy.historySec<=0||!Number.isInteger(policy.maxVehicles)||policy.maxVehicles<1
    ||!Number.isInteger(policy.maxPoints)||policy.maxPoints<policy.minSamples||!Number.isInteger(policy.minSamples)||policy.minSamples<3
    ||!Number.isInteger(policy.minOutsideSamples)||policy.minOutsideSamples<2||policy.minOutsideSamples>=policy.maxPoints
    ||policy.atOriginMeters<=0||policy.exitMeters<=policy.atOriginMeters||policy.minExitProgressMeters<=0
    ||policy.confidence<0||policy.confidence>1)throw Error('ORIGIN_EVIDENCE_CONFIG_INVALID');

  const prune=now=>{
    for(const [key,value] of histories)if(now-value.lastSeen>policy.historySec)histories.delete(key);
    while(histories.size>policy.maxVehicles)histories.delete(histories.keys().next().value);
  };
  function observe({vehicle,row,date,originPosition,now}) {
    prune(now);
    if(!row?.isOrigin||row.originStopId!==row.fromStopId||vehicle?.trip?.tripId!==row.tripId
      ||vehicle?.trip?.startDate!==date||!identity(vehicle.vehicleId))return unknown('trip_identity_invalid');
    const key=`${date}:${row.tripId}:${vehicle.vehicleId}`,timestamp=vehicle.timestamp,age=now-timestamp;
    const reject=reason=>{histories.delete(key);return unknown(reason,{tripId:row.tripId,startDate:date});};
    if(!Number.isFinite(now)||!Number.isFinite(timestamp)||age>policy.maxAgeSec||age< -policy.futureSec)
      return reject('gps_stale_or_future');
    if(!validPoint(vehicle.position)||!validPoint(originPosition))return reject('gps_missing');
    const point={timestamp,position:{lat:vehicle.position.lat,lon:vehicle.position.lon},
      distance:distanceMeters(vehicle.position,originPosition)};
    const entry=histories.get(key)||{points:[],lastSeen:now};
    const sameTime=entry.points.find(value=>value.timestamp===timestamp);
    if(sameTime) {
      if(distanceMeters(sameTime.position,point.position)>1)return reject('gps_timestamp_conflict');
      entry.lastSeen=now;histories.delete(key);histories.set(key,entry);
    } else {
      const previous=entry.points.at(-1);
      if(previous) {
        const delta=timestamp-previous.timestamp,moved=distanceMeters(previous.position,point.position);
        if(delta<=0)return reject('gps_time_reversed');
        if(moved>delta*policy.maxSpeedMps+policy.jumpAllowanceMeters) {
          histories.set(key,{points:[point],lastSeen:now});return unknown('gps_jump',{tripId:row.tripId,startDate:date,observedAt:timestamp});
        }
      }
      entry.points.push(point);entry.points=entry.points.slice(-policy.maxPoints);entry.lastSeen=now;
      histories.delete(key);histories.set(key,entry);prune(now);
    }
    const points=entry.points,last=points.at(-1),recent=points.slice(-policy.minSamples);
    if(recent.length===policy.minSamples&&last.timestamp-recent[0].timestamp>=policy.minSpanSec
      &&recent.every(value=>value.distance<=policy.atOriginMeters))return {supported:true,state:'at_stop',originPassed:false,
        confidence:policy.confidence,tripId:row.tripId,startDate:date,observedAt:last.timestamp,
        nextStop:{id:row.originStopId},reason:null,method:'gps_origin_geofence'};

    const outside=points.slice(-policy.minOutsideSamples);
    const insideIndex=points.findLastIndex((value,index)=>index<points.length-policy.minOutsideSamples
      &&value.distance<=policy.atOriginMeters);
    if(insideIndex>=0&&outside.length===policy.minOutsideSamples
      &&outside.every(value=>value.distance>=policy.exitMeters)
      &&last.timestamp-points[insideIndex].timestamp>=policy.minSpanSec
      &&outside.every((value,index)=>index===0||value.distance+policy.jitterMeters>=outside[index-1].distance)
      &&distanceMeters(points[insideIndex].position,last.position)>=policy.minExitProgressMeters) {
      const confidence=Math.max(policy.confidence,Math.min(0.99,0.99-0.04*Math.max(0,age)/policy.maxAgeSec));
      return {supported:true,state:'departed',originPassed:true,confidence,tripId:row.tripId,startDate:date,
        observedAt:last.timestamp,timestamp:last.timestamp,reason:null,method:'gps_origin_geofence'};
    }
    return unknown('motion_unconfirmed',{tripId:row.tripId,startDate:date,observedAt:last.timestamp});
  }
  return {observe,historySize:()=>histories.size,clear:()=>histories.clear(),policy:Object.freeze({...policy})};
}

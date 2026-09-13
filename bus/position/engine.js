import { POSITION_POLICY } from './policy.js';
import { validPoint, distanceMeters, snapCandidates } from './geometry.js';
const unknown=(reason,extra={})=>({supported:false,state:'unknown',method:'gps_route_geometry_snap',confidence:0,
  matched:false,distanceFromRouteMeters:null,progress:null,previousStop:null,nextStop:null,betweenStops:false,stopsAway:null,...extra,reason});
const stopDTO=s=>s?{id:s.id,name:s.name,sequence:s.sequence}:null;
export function normalizeVehicle(vehicle,provider) {
  return {provider,vehicleId:vehicle.vehicleId??null,tripId:vehicle.trip?.tripId??null,routeId:vehicle.trip?.routeId??null,
    startDate:vehicle.trip?.startDate??null,startTime:vehicle.trip?.startTime??null,
    relationship:vehicle.trip?.relationship??null,timestamp:vehicle.timestamp??null,
    position:{lat:vehicle.position?.lat??null,lon:vehicle.position?.lon??null},
    rawState:{stopId:vehicle.stopId??null,sequence:vehicle.sequence??null,status:vehicle.status??null}};
}
export function createPositionEngine({routeIndex,policy:overrides={}}) {
  const policy={...POSITION_POLICY,...overrides}, histories=new Map();
  if(!routeIndex || policy.minSamples<3 || policy.maxTrips<1 || policy.maxPoints<policy.minSamples
    || policy.threshold<0 || policy.threshold>1)throw Error('POSITION_CONFIG_INVALID');
  function evaluate(vehicle,target,now) {
    for(const [key,entry] of histories)if(now-entry.lastSeen>policy.historySec)histories.delete(key);
    if(!vehicle || vehicle.provider!==routeIndex.provider || !vehicle.tripId || !vehicle.routeId
      || !/^\d{8}$/.test(vehicle.startDate||'') || vehicle.relationship!==0 || !Number.isFinite(now)) return unknown('trip_identity_invalid');
    const key=JSON.stringify([vehicle.provider,routeIndex.sourceHash,vehicle.tripId,vehicle.startDate,vehicle.startTime]);
    const reject=reason=>{histories.delete(key);return unknown(reason);};
    // Adapter/composition may supply a timezone-resolved service interval. The generic Engine does not assume a timezone.
    if(vehicle.serviceDayStart!==undefined && (!Number.isFinite(vehicle.serviceDayStart)
      || vehicle.timestamp<vehicle.serviceDayStart-policy.futureSec || vehicle.timestamp>=vehicle.serviceDayStart+48*3600))return reject('service_day_mismatch');
    const age=now-vehicle.timestamp;
    if(!Number.isFinite(vehicle.timestamp)||age>policy.maxAgeSec||age < -policy.futureSec)return reject('gps_stale_or_future');
    if(!validPoint(vehicle.position))return reject('gps_missing');
    const trip=routeIndex.getTrip(vehicle.tripId);
    if(!trip||trip.routeId!==vehicle.routeId)return reject('trip_static_mismatch');
    if(!trip.supported)return reject(trip.reason);
    const targetIndex=trip.stops.findIndex(s=>s.id===target?.stopId&&s.sequence===target?.sequence);
    if(targetIndex<0)return reject('target_not_in_trip');
    const candidates=snapCandidates(trip.geometry,vehicle.position,policy.routeMeters,policy.candidateSlackMeters);
    if(!candidates.length)return reject('route_snap_failed');
    // Work is bounded even on pathological self-overlapping shapes.
    if(candidates.length>16)return reject('route_candidates_excessive');
    let history=histories.get(key)?.points||[];
    history=history.filter(p=>vehicle.timestamp-p.timestamp<=policy.historySec);
    if(history.length && vehicle.timestamp<history.at(-1).timestamp)return unknown('out_of_order');
    if(history.length && vehicle.timestamp===history.at(-1).timestamp) {
      if(distanceMeters(vehicle.position,history.at(-1).position)>0.1)return reject('timestamp_conflict');
    } else history=[...history,{timestamp:vehicle.timestamp,position:{...vehicle.position},candidates}].slice(-policy.maxPoints);
    if(!histories.has(key)&&histories.size>=policy.maxTrips)histories.delete(histories.keys().next().value);
    histories.set(key,{points:history,lastSeen:now});
    if(history.length<policy.minSamples||history.at(-1).timestamp-history[0].timestamp<policy.minSpanSec)return unknown('insufficient_history');
    // Dynamic paths preserve multiple plausible projections; raw sequence never selects one.
    let paths=history[0].candidates.map(c=>[c]);
    for(let i=1;i<history.length;i++) {
      const next=[],dt=history[i].timestamp-history[i-1].timestamp;
      for(const path of paths)for(const c of history[i].candidates) {
        const delta=c.along-path.at(-1).along;
        if(delta>=-policy.jitterMeters && delta<=dt*policy.maxSpeedMps+policy.jumpAllowanceMeters)next.push([...path,c]);
      }
      if(next.length>256)return unknown('trajectory_ambiguous');
      paths=next;
    }
    paths=paths.filter(p=>p.at(-1).along-p[0].along>=-policy.jitterMeters);
    if(!paths.length){histories.delete(key);return unknown('reverse_or_jump');}
    paths.sort((a,b)=>a.reduce((s,c)=>s+c.distance,0)-b.reduce((s,c)=>s+c.distance,0));
    const path=paths[0],snap=path.at(-1);
    if(paths.some(p=>Math.abs(p.at(-1).along-snap.along)>=policy.ambiguityMeters))return unknown('route_projection_ambiguous');
    const method=`gps_${trip.geometrySourceType}_snap`;
    const geometry={matched:true,distanceFromRouteMeters:snap.distance,progress:snap.along/trip.geometry.total,
      geometrySource:{type:trip.geometrySourceType,version:trip.geometrySourceVersion,id:trip.geometryId}};
    const progress=snap.along-path[0].along;
    const nearest=trip.stops.reduce((a,b)=>Math.abs(a.along-snap.along)<=Math.abs(b.along-snap.along)?a:b);
    const near=Math.abs(nearest.along-snap.along)<=policy.nearStopMeters;
    const dwell=history.at(-1).timestamp-history.at(-policy.minSamples).timestamp>=policy.minSpanSec
      && history.slice(-policy.minSamples).every(p=>distanceMeters(p.position,nearest.position)<=policy.atStopMeters)
      && history.slice(-policy.minSamples).every(p=>distanceMeters(p.position,history.at(-1).position)<=policy.dwellSpreadMeters);
    let state='between_stops',nextIndex=trip.stops.findIndex(s=>s.along>snap.along),previousIndex=nextIndex-1;
    if(dwell){state='at_stop';nextIndex=nearest.ordinal;previousIndex=nextIndex-1;}
    else if(progress<policy.minProgressMeters)return unknown('motion_ambiguous',geometry);
    else if(near) {
      if(snap.along<nearest.along){state='approaching';nextIndex=nearest.ordinal;previousIndex=nextIndex-1;}
      else {state='departed';previousIndex=nearest.ordinal;nextIndex=previousIndex+1;}
    }
    if(nextIndex<0||nextIndex>=trip.stops.length||snap.along>trip.stops[targetIndex].along+policy.atStopMeters)return unknown('target_passed_or_route_end',geometry);
    if(targetIndex<nextIndex)return unknown('target_passed',geometry);
    const previous=trip.stops[previousIndex],next=trip.stops[nextIndex],raw=vehicle.rawState||{},conflicts=[];
    if(raw.sequence!=null&&!([previous?.sequence,next.sequence].includes(raw.sequence)))conflicts.push('raw_sequence');
    if(raw.stopId!=null&&!([previous?.id,next.id].includes(raw.stopId)))conflicts.push('raw_stop');
    if(raw.status===1 && state==='between_stops')conflicts.push('raw_status');
    if(raw.status===2 && state==='at_stop')conflicts.push('raw_status');
    if(raw.status!=null&&![0,1,2].includes(raw.status))conflicts.push('raw_status_unknown');
    const confidence=Math.max(0,Math.min(1,0.98-0.10*Math.max(0,age)/policy.maxAgeSec-0.10*snap.distance/policy.routeMeters-0.04*conflicts.length));
    if(confidence<policy.threshold)return unknown('confidence_below_threshold',{...geometry,confidence,conflicts});
    return {supported:true,state,reason:null,method,confidence,...geometry,
      previousStop:stopDTO(previous),nextStop:stopDTO(next),betweenStops:state==='between_stops',
      stopsAway:targetIndex-nextIndex,observedAt:vehicle.timestamp,conflicts};
  }
  return {evaluate,historySize:()=>histories.size,clear:()=>histories.clear()};
}

// Public compatibility boundary. Position publication is deliberately not enabled by a runtime flag.
export const POSITION_PUBLIC_ENABLED=false;
export function publicPosition() {
  return {supported:false,status:null,stopsAway:null,previousStop:null,nextStop:null};
}

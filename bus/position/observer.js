import { createPositionEngine, normalizeVehicle } from './engine.js';
import { serviceActive } from '../core/arrivals.js';
import { clockSeconds } from '../core/time.js';
import { POSITION_POLICY } from './policy.js';
// Internal sink. Never returned by the HTTP handler or combined with a public Arrival via spread.
export function createPositionObserver({routeIndex,index}) {
  const engine=createPositionEngine({routeIndex}),targets=new Map();
  for(const row of Object.values(index.directions).flat()) {
    if(!targets.has(row.tripId))targets.set(row.tripId,[]);
    targets.get(row.tripId).push({stopId:row.fromStopId,sequence:row.stopSequence,serviceId:row.serviceId,startTime:row.startTime});
  }
  let summary={evaluated:0,supported:0,reasons:{}};
  return {
    observe({realtime,now}) {
      const result={evaluated:0,supported:0,reasons:{}};
      if(realtime && (!Number.isFinite(realtime.timestamp)||now-realtime.timestamp>POSITION_POLICY.maxAgeSec||now-realtime.timestamp< -POSITION_POLICY.futureSec)) {
        engine.clear();summary={evaluated:0,supported:0,reasons:{feed_stale:1}};return;
      }
      for(const vehicle of realtime?.vehicles||[])for(const target of targets.get(vehicle.trip?.tripId)||[]) {
        const date=vehicle.trip?.startDate||'';
        // The existing normalized Static/P0 service calendar uses Asia/Tokyo. No Navi/raw state participates.
        const day=/^\d{8}$/.test(date)?Date.parse(`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6)}T00:00:00+09:00`)/1000:NaN;
        const roundTrip=Number.isFinite(day)?new Date((day+9*3600)*1000).toISOString().slice(0,10).replaceAll('-',''):null;
        if(roundTrip!==date||!serviceActive(index,target.serviceId,day)
          ||(vehicle.trip.startTime && clockSeconds(vehicle.trip.startTime)!==clockSeconds(target.startTime))) {
          result.evaluated++;result.reasons.service_instance_mismatch=(result.reasons.service_instance_mismatch||0)+1;continue;
        }
        const position=engine.evaluate({...normalizeVehicle(vehicle,routeIndex.provider),serviceDayStart:day},target,now);
        result.evaluated++;if(position.supported)result.supported++;
        else result.reasons[position.reason]=(result.reasons[position.reason]||0)+1;
      }
      summary=result;
    },
    summary:()=>structuredClone(summary)
  };
}

import { createOriginDepartureEngine } from './engine.js';
import { createOriginEvidenceTracker } from './origin-evidence.js';
import { createVehicleTripTracker } from './tracker.js';
import { resolveTerminalArea } from '../providers/kawasaki/departure.js';

const key=(date,tripId)=>`${date}:${tripId}`;
const fresh=(timestamp,now,maxAge)=>Number.isFinite(timestamp)&&timestamp<=now+5&&now-timestamp>=0&&now-timestamp<=maxAge;

export function createDepartureConfidence({index,positionStatic=null,engine=null,evidenceTracker=null,tripTracker=null}={}) {
  if(!index?.directions)throw Error('DEPARTURE_CONFIDENCE_CONFIG_INVALID');
  const rows=new Map();
  for(const row of Object.values(index.directions).flat())if(!rows.has(row.tripId))rows.set(row.tripId,row);
  const resolveTrip=trip=>{
    const row=rows.get(trip?.tripId),positionTrip=positionStatic?.trips?.[trip?.tripId];
    const chain=positionStatic?.chains?.[positionTrip?.chainId];
    if(!row||!chain?.stops?.length)return null;
    const originStopId=chain.stops[0].stopId,terminalStopId=chain.stops.at(-1).stopId;
    return {originStopId,terminalStopId,originAreaId:resolveTerminalArea(originStopId),terminalAreaId:resolveTerminalArea(terminalStopId)};
  };
  const machine=engine||createOriginDepartureEngine();
  const gps=evidenceTracker||createOriginEvidenceTracker();
  const vehicles=tripTracker||createVehicleTripTracker({resolveTrip});
  let positions=new Map(),departures=new Map(),vehicleKeys=new Set(),updateKeys=new Set(),snapshotAt=null;

  function resetSnapshot() {positions=new Map();vehicleKeys=new Set();updateKeys=new Set();snapshotAt=null;}
  function observe({realtime,now}) {
    resetSnapshot();snapshotAt=now;
    if(!realtime)return;
    const tracked=vehicles.observe({realtime,now});
    for(const transition of tracked.transitions||[])if(transition.level==='A') {
      const split=transition.incomingTrip.indexOf(':'),date=transition.incomingTrip.slice(0,split),tripId=transition.incomingTrip.slice(split+1);
      const row=rows.get(tripId);
      if(row?.isOrigin)departures.set(transition.incomingTrip,[{type:'vehicle_next_trip',level:'A',tripId,startDate:date,
        timestamp:transition.observedAt}]);
    }
    for(const vehicle of realtime.vehicles||[]) {
      const row=rows.get(vehicle.trip?.tripId),date=vehicle.trip?.startDate;
      if(!row||!date)continue;
      const tripKey=key(date,row.tripId);vehicleKeys.add(tripKey);
      if(!row.isOrigin)continue;
      const originPosition=positionStatic?.stops?.[row.originStopId]?.position;
      positions.set(tripKey,gps.observe({vehicle,row,date,originPosition,now}));
    }
    for(const update of realtime.updates||[])if(rows.has(update.trip?.tripId)&&update.trip?.startDate)
      updateKeys.add(key(update.trip.startDate,update.trip.tripId));
    const oldest=now-machine.policy.stateRetentionSec;
    for(const [tripKey,list] of departures)if(!list.some(value=>value.timestamp>=oldest))departures.delete(tripKey);
  }
  function evaluate(value) {
    const tripKey=key(value.date,value.row.tripId),maxAge=machine.policy.evidenceMaxAgeSec;
    const vehicle=value.vehicle,update=value.tripUpdate;
    return machine.evaluate({...value,positionEvidence:positions.get(tripKey)||null,
      departureEvidence:departures.get(tripKey)||null,
      tripUpdateFresh:Boolean(value.feedFresh&&updateKeys.has(tripKey)&&fresh(update?.timestamp,value.now,maxAge)),
      vehicleFresh:Boolean(value.feedFresh&&vehicleKeys.has(tripKey)&&fresh(vehicle?.timestamp,value.now,maxAge)),
      vehicleIdentified:Boolean(vehicle?.vehicleId)});
  }
  return {observe,evaluate,resetSnapshot,stateCount:machine.stateCount,
    stats:()=>({snapshotAt,positions:positions.size,departedEvidence:departures.size,vehicles:vehicleKeys.size,updates:updateKeys.size})};
}

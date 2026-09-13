const key=trip=>trip?`${trip.startDate||''}:${trip.tripId||''}`:null;
const validIdentity=value=>typeof value==='string'&&value.length>0&&value.length<=128;
const defaultPolicy=Object.freeze({maxTransitionSec:30*60,maxObservationAgeSec:120,futureSec:5,
  positionConfidence:0.9,maxVehicles:512});

export function createVehicleTripTracker({resolveTrip,policy:overrides={}}) {
  const policy={...defaultPolicy,...overrides};
  if(typeof resolveTrip!=='function'||!Number.isFinite(policy.maxTransitionSec)||policy.maxTransitionSec<=0
    ||!Number.isFinite(policy.maxObservationAgeSec)||policy.maxObservationAgeSec<=0
    ||!Number.isFinite(policy.futureSec)||policy.futureSec<0
    ||!Number.isInteger(policy.maxVehicles)||policy.maxVehicles<1)throw Error('DEPARTURE_TRACKER_CONFIG_INVALID');
  const history=new Map(),links=[];
  function compatible(incoming,outgoing) {
    const before=resolveTrip(incoming.trip),after=resolveTrip(outgoing.trip);
    return before&&after&&before.terminalStopId&&(before.terminalStopId===after.originStopId
      ||before.terminalAreaId&&before.terminalAreaId===after.originAreaId);
  }
  function trustedPosition(value,state) {
    return value?.supported===true&&Number.isFinite(value.confidence)&&value.confidence>=policy.positionConfidence
      &&value[state]===true;
  }
  function link(incoming,outgoing,mode,positionEvidence) {
    if(!compatible(incoming,outgoing))return {level:'C',reason:'terminal_origin_mismatch'};
    if(!Number.isFinite(incoming.timestamp)||!Number.isFinite(outgoing.timestamp))return {level:'C',reason:'transition_time_invalid'};
    const gap=outgoing.timestamp-incoming.timestamp;
    if(gap<0||gap>policy.maxTransitionSec)return {level:'C',reason:'transition_time_invalid'};
    const incomingPosition=positionEvidence?.get(key(incoming.trip)),outgoingPosition=positionEvidence?.get(key(outgoing.trip));
    const positionVerified=trustedPosition(incomingPosition,'terminalReached')&&trustedPosition(outgoingPosition,'originPassed');
    // GTFS-RT VehicleDescriptor.id is the exact identity proof. GPS is separately required for dwell timestamps.
    const result={level:'A',reason:null,mode,positionVerified,
      incomingTrip:key(incoming.trip),outgoingTrip:key(outgoing.trip),observedAt:outgoing.timestamp,gapSec:gap};
    links.push(result);
    return result;
  }
  function observe({realtime,now,positionEvidence=new Map()}) {
    if(!Number.isFinite(now))throw Error('DEPARTURE_TRACKER_INPUT_INVALID');
    const transitions=[],assignments=[],currentByVehicle=new Map();
    const freshTimestamp=timestamp=>Number.isFinite(timestamp)&&timestamp<=now+policy.futureSec
      &&now-timestamp<=policy.maxObservationAgeSec;
    for(const vehicle of realtime?.vehicles||[])if(validIdentity(vehicle.vehicleId)&&vehicle.trip?.tripId&&vehicle.trip?.startDate
      &&freshTimestamp(vehicle.timestamp)) {
      const current={trip:vehicle.trip,timestamp:vehicle.timestamp,vehicleId:vehicle.vehicleId};
      currentByVehicle.set(vehicle.vehicleId,current);
      const previous=history.get(vehicle.vehicleId);
      if(previous&&key(previous.trip)!==key(current.trip))transitions.push(link(previous,current,'observed_transition',positionEvidence));
      history.delete(vehicle.vehicleId);history.set(vehicle.vehicleId,current);
    }
    for(const update of realtime?.updates||[])if(validIdentity(update.vehicleId)&&update.trip?.tripId&&update.trip?.startDate
      &&freshTimestamp(update.timestamp)) {
      const current=currentByVehicle.get(update.vehicleId);
      if(current&&key(current.trip)!==key(update.trip))assignments.push(link(current,{trip:update.trip,timestamp:update.timestamp,vehicleId:update.vehicleId},
        'same_feed_future_assignment',positionEvidence));
    }
    while(history.size>policy.maxVehicles)history.delete(history.keys().next().value);
    return {transitions,assignments,levelALinks:links.length};
  }
  return {observe,links:()=>structuredClone(links),historySize:()=>history.size};
}

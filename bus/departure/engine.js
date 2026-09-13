import { DEPARTURE_POLICY } from './policy.js';

export const DEPARTURE_PREDICTION_PUBLIC_ENABLED=false;
export const DEPARTURE_STATES=Object.freeze(['scheduled','departure_pending','departure_overdue',
  'departure_uncertain','departed','cancelled','unknown']);
export const DEPARTURE_ACTIONABILITY=Object.freeze(['catchable','uncertain','do_not_recommend']);

const finite=value=>Number.isFinite(value);
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const tripKey=(row,date)=>`${date}:${row.tripId}`;
const sameTrip=(evidence,row,date)=>evidence?.tripId===row.tripId&&evidence?.startDate===date;
const unavailable=(state='unknown',reason='unavailable',extra={})=>({
  state,keep:false,reason,actionability:'do_not_recommend',ranking:'exclude',scheduledDeparture:null,
  incomingArrivalEstimated:null,turnaroundEstimateSec:null,estimatedReadyTime:null,estimatedDeparture:null,
  effectiveDeparture:null,confidence:0,source:'unavailable',...extra
});

export function originGraceSeconds(scheduled,nextScheduled,policy=DEPARTURE_POLICY) {
  const headway=finite(nextScheduled)&&nextScheduled>scheduled?nextScheduled-scheduled:null;
  const proposed=headway===null?policy.fallbackGraceSec:headway*policy.headwayMultiplier;
  return clamp(proposed,policy.minGraceSec,policy.maxGraceSec);
}

export function originConfidenceWindows({scheduled,nextScheduled,feedFresh=false,tripUpdateFresh=false,
  vehicleFresh=false},policy=DEPARTURE_POLICY) {
  const headwaySec=finite(nextScheduled)&&nextScheduled>scheduled?nextScheduled-scheduled:null;
  const frequencyBasis=headwaySec??policy.fallbackGraceSec;
  const lowFrequency=headwaySec!==null&&headwaySec>=policy.lowFrequencyHeadwaySec;
  let overdueSec=clamp(frequencyBasis*policy.overdueHeadwayRatio,policy.overdueMinSec,policy.overdueMaxSec);
  if(feedFresh&&(tripUpdateFresh||vehicleFresh))overdueSec=Math.min(policy.overdueMaxSec,overdueSec+policy.freshEvidenceBonusSec);
  if(lowFrequency)overdueSec=Math.min(overdueSec,policy.lowFrequencyOverdueMaxSec);
  if(!feedFresh)overdueSec=Math.min(overdueSec,policy.staleOverdueMaxSec);
  let retentionSec=originGraceSeconds(scheduled,nextScheduled,policy);
  if(lowFrequency)retentionSec=Math.min(retentionSec,Math.max(policy.minGraceSec,
    headwaySec*policy.lowFrequencyRetentionMultiplier));
  if(!feedFresh)retentionSec=Math.max(overdueSec+policy.overdueMinSec,retentionSec*policy.staleRetentionRatio);
  retentionSec=clamp(retentionSec,overdueSec+policy.overdueMinSec,policy.maxGraceSec);
  return {headwaySec,lowFrequency,overdueSec,retentionSec,feedFresh,tripUpdateFresh,vehicleFresh};
}

function evidenceFresh(evidence,row,date,now,policy) {
  const timestamp=evidence?.timestamp??evidence?.observedAt;
  return sameTrip(evidence,row,date)&&finite(timestamp)&&timestamp<=now+5&&now-timestamp>=0
    &&now-timestamp<=policy.evidenceMaxAgeSec;
}

function positionState(position,row,date,now,feedFresh,policy) {
  if(!feedFresh||position?.supported!==true||!finite(position.confidence)
    ||position.confidence<policy.positionConfidence||!evidenceFresh(position,row,date,now,policy))return null;
  if(position.originPassed===true)return {state:'departed',reason:'gps_origin_passed',confidence:position.confidence,
    evidenceAt:position.timestamp??position.observedAt};
  if(position.state==='at_stop'&&position.nextStop?.id===row.originStopId)
    return {state:'at_origin',reason:'gps_at_origin',confidence:position.confidence};
  return null;
}

function positiveDepartureEvidence(list,row,date,now,feedFresh,policy) {
  if(!feedFresh||!Array.isArray(list))return null;
  for(const evidence of list) {
    if(!evidenceFresh(evidence,row,date,now,policy))continue;
    if(evidence.type==='gps_origin_passed'&&finite(evidence.confidence)&&evidence.confidence>=policy.positionConfidence)
      return {reason:'gps_origin_passed',confidence:evidence.confidence,evidenceAt:evidence.timestamp??evidence.observedAt};
    if(evidence.type==='trip_next_stop'&&evidence.exactVehicle===true&&evidence.gpsConsistent===true
      &&finite(evidence.confidence)&&evidence.confidence>=policy.positionConfidence)
      return {reason:'trip_next_stop',confidence:evidence.confidence,evidenceAt:evidence.timestamp??evidence.observedAt};
    if(evidence.type==='rt_departed'&&evidence.explicit===true&&evidence.exactVehicle===true)
      return {reason:'rt_departed',confidence:1,evidenceAt:evidence.timestamp??evidence.observedAt};
    if(evidence.type==='vehicle_next_trip'&&evidence.level==='A')
      return {reason:'vehicle_next_trip',confidence:1,evidenceAt:evidence.timestamp??evidence.observedAt};
  }
  return null;
}

function validatePolicy(policy) {
  const seconds=['minGraceSec','fallbackGraceSec','maxGraceSec','overdueMinSec','overdueMaxSec','staleOverdueMaxSec',
    'freshEvidenceBonusSec','lowFrequencyHeadwaySec','lowFrequencyOverdueMaxSec','evidenceMaxAgeSec','maxIncomingAgeSec',
    'stateRetentionSec'];
  if(seconds.some(name=>!finite(policy[name])||policy[name]<0)||policy.minGraceSec>policy.fallbackGraceSec
    ||policy.fallbackGraceSec>policy.maxGraceSec||policy.overdueMinSec>policy.overdueMaxSec
    ||policy.headwayMultiplier<=0||policy.overdueHeadwayRatio<=0||policy.lowFrequencyRetentionMultiplier<=0
    ||policy.staleRetentionRatio<=0||policy.staleRetentionRatio>1||policy.positionConfidence<0||policy.positionConfidence>1
    ||!Number.isInteger(policy.minTurnaroundSamples)||policy.minTurnaroundSamples<1
    ||!Number.isInteger(policy.maxStateEntries)||policy.maxStateEntries<1)throw Error('DEPARTURE_CONFIG_INVALID');
}

export function createOriginDepartureEngine({policy:overrides={}}={}) {
  const policy={...DEPARTURE_POLICY,...overrides},states=new Map();validatePolicy(policy);
  const prune=now=>{
    for(const [key,value] of states)if(now-value.lastSeen>policy.stateRetentionSec)states.delete(key);
    while(states.size>policy.maxStateEntries)states.delete(states.keys().next().value);
  };
  const remember=(key,value,now)=>{
    if(value.state!=='scheduled'&&value.state!=='realtime'){
      states.delete(key);states.set(key,{state:value.state,result:{...value},lastSeen:now});prune(now);
    }
    return value;
  };
  function evaluate({row,date,scheduled,estimated,now,nextScheduled=null,feedFresh=false,tripActive=true,
    tripUpdateFresh=false,vehicleFresh=false,vehicleIdentified=false,cancelled=false,positionEvidence=null,
    departureEvidence=null,incomingLink=null,turnaroundEvidence=null}) {
    if(!row?.isOrigin)return null;
    if(!finite(scheduled)||!finite(now)||!/^[0-9]{8}$/.test(date||''))return unavailable('unknown','input_invalid');
    prune(now);const key=tripKey(row,date),previous=states.get(key);
    if(previous?.state==='departed'||previous?.state==='cancelled')return {...previous.result};
    if(cancelled)return remember(key,unavailable('cancelled','cancelled',{scheduledDeparture:scheduled}),now);
    if(!tripActive)return remember(key,unavailable('unknown','trip_inactive',{scheduledDeparture:scheduled}),now);
    const position=positionState(positionEvidence,row,date,now,feedFresh,policy);
    const departed=position?.state==='departed'?position:positiveDepartureEvidence(departureEvidence,row,date,now,feedFresh,policy);
    if(departed)return remember(key,unavailable('departed',departed.reason,{scheduledDeparture:scheduled,
      confidence:departed.confidence,source:departed.reason,evidenceAt:departed.evidenceAt??null}),now);

    const overdue=finite(estimated)?estimated<now:scheduled<now;
    if(!overdue)return {state:finite(estimated)?'realtime':'scheduled',keep:true,reason:null,actionability:'catchable',ranking:'normal',
      scheduledDeparture:scheduled,incomingArrivalEstimated:null,turnaroundEstimateSec:null,estimatedReadyTime:null,
      estimatedDeparture:finite(estimated)?estimated:null,effectiveDeparture:finite(estimated)?Math.max(scheduled,estimated):scheduled,
      confidence:finite(estimated)&&feedFresh?0.7:0,source:finite(estimated)&&feedFresh?'trip_update':'static'};

    if(position?.state==='at_origin')return remember(key,{state:'departure_pending',keep:true,reason:position.reason,
      actionability:'catchable',ranking:'front',scheduledDeparture:scheduled,incomingArrivalEstimated:null,
      turnaroundEstimateSec:null,estimatedReadyTime:null,estimatedDeparture:null,effectiveDeparture:scheduled,
      confidence:position.confidence,source:'gps_at_origin'},now);

    const windows=originConfidenceWindows({scheduled,nextScheduled,feedFresh,tripUpdateFresh,vehicleFresh},policy);
    const elapsedSec=Math.max(0,now-scheduled);
    if(elapsedSec>windows.retentionSec) {
      const result=unavailable('unknown','confidence_window_expired',{scheduledDeparture:scheduled,elapsedSec,windows});
      return previous?remember(key,result,now):result;
    }

    let incomingArrivalEstimated=null,turnaroundEstimateSec=null,estimatedReadyTime=null,estimatedDeparture=null;
    let confidence=0,source='unconfirmed';
    const exactIncoming=incomingLink?.level==='A'&&finite(incomingLink.arrivalEstimated)
      &&finite(incomingLink.timestamp)&&now-incomingLink.timestamp>=0&&now-incomingLink.timestamp<=policy.maxIncomingAgeSec;
    const observedTurnaround=turnaroundEvidence?.sampleCount>=policy.minTurnaroundSamples
      &&finite(turnaroundEvidence.estimateSec)&&turnaroundEvidence.estimateSec>=0;
    if(exactIncoming) {
      incomingArrivalEstimated=incomingLink.arrivalEstimated;confidence=clamp(incomingLink.confidence||0,0,1);
      source='linked_incoming_trip';
      if(observedTurnaround) {
        turnaroundEstimateSec=turnaroundEvidence.estimateSec;estimatedReadyTime=incomingArrivalEstimated+turnaroundEstimateSec;
        estimatedDeparture=Math.max(scheduled,estimatedReadyTime);source='linked_incoming_trip_observed_turnaround';
      }
    }

    const remainOverdue=elapsedSec<=windows.overdueSec&&previous?.state!=='departure_uncertain';
    if(remainOverdue) {
      const ranking=feedFresh&&tripUpdateFresh&&vehicleFresh&&vehicleIdentified&&!windows.lowFrequency?'front':'after_next';
      const actionability=windows.lowFrequency||!feedFresh?'do_not_recommend':'uncertain';
      return remember(key,{state:'departure_overdue',keep:true,
        reason:feedFresh?'departure_unconfirmed':'realtime_unavailable_or_stale',actionability,ranking,
        scheduledDeparture:scheduled,incomingArrivalEstimated,turnaroundEstimateSec,estimatedReadyTime,estimatedDeparture,
        effectiveDeparture:estimatedDeparture??scheduled,confidence,source,elapsedSec,windows},now);
    }

    const actionability=windows.lowFrequency||!feedFresh||!vehicleFresh?'do_not_recommend':'uncertain';
    return remember(key,{state:'departure_uncertain',keep:true,reason:'departure_evidence_missing',actionability,
      ranking:'after_next',scheduledDeparture:scheduled,incomingArrivalEstimated,turnaroundEstimateSec,estimatedReadyTime,
      estimatedDeparture:null,effectiveDeparture:null,confidence:0,source:'unconfirmed',elapsedSec,windows},now);
  }
  return {evaluate,policy:Object.freeze({...policy}),stateCount:()=>states.size,clear:()=>states.clear()};
}

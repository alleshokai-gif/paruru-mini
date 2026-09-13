// Research-only bounded observation. Raw vehicle IDs and complete RT responses are never persisted.
import { createHash } from 'node:crypto';
import { readFileSync,writeFileSync,renameSync } from 'node:fs';
import { setTimeout as wait } from 'node:timers/promises';
import { readLocalToken } from './local-secret.js';
import { fetchRealtime,parseRealtime } from '../providers/kawasaki/adapter.js';
import { createOriginEvidenceTracker } from '../departure/origin-evidence.js';
import { resolveTerminalArea } from '../providers/kawasaki/departure.js';
import { serviceActive } from '../core/arrivals.js';

const SAMPLE_COUNT=12,INTERVAL_MS=31000,LOOK_BACK_SEC=45*60,LOOK_AHEAD_SEC=30*60;
const dateKey=seconds=>new Date((seconds+9*3600)*1000).toISOString().slice(0,10).replaceAll('-','');
const dayStart=date=>Date.parse(`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6)}T00:00:00+09:00`)/1000;
const instance=trip=>`${trip.startDate}:${trip.tripId}`;

try {
  const token=readLocalToken(),index=JSON.parse(readFileSync(new URL('../generated/p0-static.json',import.meta.url),'utf8'));
  const position=JSON.parse(readFileSync(new URL('../generated/p1-position-static.json',import.meta.url),'utf8'));
  const rows=new Map(),targetDirections=new Set(['noborito_to_home','mizonokuchi_to_home']);
  for(const [directionId,items] of Object.entries(index.directions))for(const row of items)
    if(!rows.has(row.tripId))rows.set(row.tripId,{...row,directionId});
  const endpoints=tripId=>{
    const trip=position.trips[tripId],chain=position.chains[trip?.chainId];
    if(!chain?.stops?.length)return null;
    const originStopId=chain.stops[0].stopId,terminalStopId=chain.stops.at(-1).stopId;
    return {originStopId,terminalStopId,originAreaId:resolveTerminalArea(originStopId),terminalAreaId:resolveTerminalArea(terminalStopId)};
  };
  const compatible=(before,after)=>before&&after&&(before.terminalStopId===after.originStopId
    ||before.terminalAreaId&&before.terminalAreaId===after.originAreaId);
  const captureId=new Date().toISOString().slice(0,19).replaceAll(/[-:]/g,''),salt=`paluru-confidence:${captureId}:`;
  const hash=value=>createHash('sha256').update(`${salt}${value}`).digest('hex').slice(0,24);
  const target=new URL(`../generated/departure-confidence-${captureId}.json`,import.meta.url),temporary=new URL(`${target.href}.tmp`);
  const tracker=createOriginEvidenceTracker(),records=new Map(),lastByVehicle=new Map();
  const result={researchOnly:true,productionInput:false,captureId,startedAt:new Date().toISOString(),sourceVersion:index.sourceVersion,
    intendedSamples:SAMPLE_COUNT,intervalMs:INTERVAL_MS,vehicleIdsHashed:true,records:[],samples:[],summary:null};
  const ensureRecord=(row,date)=>{
    const key=`${date}:${row.tripId}`;
    if(!records.has(key))records.set(key,{tripKey:key,directionId:row.directionId,routeId:row.routeId,routeLabel:row.routeLabel,
      originStopId:row.originStopId,platform:row.platform,scheduledDeparture:dayStart(date)+row.scheduledSeconds,
      firstPositiveDepartedEvidence:null,cancellationEvidence:null,nextTripTransition:null,observations:[]});
    return records.get(key);
  };
  const markEvidence=(record,evidence)=>{
    if(record.firstPositiveDepartedEvidence)return;
    record.firstPositiveDepartedEvidence={...evidence,
      elapsedSeconds:evidence.timestamp-record.scheduledDeparture};
  };
  for(let sampleIndex=0;sampleIndex<SAMPLE_COUNT;sampleIndex++) {
    if(sampleIndex)await wait(INTERVAL_MS);
    const receivedAt=Date.now()/1000,realtime=parseRealtime(await fetchRealtime(token),receivedAt);
    const feedFresh=Number.isFinite(realtime.timestamp)&&receivedAt-realtime.timestamp>=-5&&receivedAt-realtime.timestamp<=120;
    const date=dateKey(receivedAt),start=dayStart(date),candidates=[];
    for(const row of rows.values())if(targetDirections.has(row.directionId)&&row.isOrigin&&serviceActive(index,row.serviceId,start)) {
      const scheduled=start+row.scheduledSeconds;
      if(scheduled>=receivedAt-LOOK_BACK_SEC&&scheduled<=receivedAt+LOOK_AHEAD_SEC)candidates.push(row);
    }
    const vehiclesByTrip=new Map(),updatesByTrip=new Map();
    for(const vehicle of realtime.vehicles||[])if(vehicle.vehicleId&&vehicle.trip?.tripId&&vehicle.trip?.startDate) {
      const tripKey=instance(vehicle.trip),items=vehiclesByTrip.get(tripKey)||[];items.push(vehicle);vehiclesByTrip.set(tripKey,items);
      const previous=lastByVehicle.get(vehicle.vehicleId),current={trip:vehicle.trip,timestamp:vehicle.timestamp};
      if(previous&&instance(previous.trip)!==tripKey&&feedFresh&&Number.isFinite(previous.timestamp)&&Number.isFinite(current.timestamp)
        &&current.timestamp>=previous.timestamp&&current.timestamp-previous.timestamp<=30*60) {
        const beforeRow=rows.get(previous.trip.tripId),afterRow=rows.get(current.trip.tripId),before=endpoints(previous.trip.tripId),after=endpoints(current.trip.tripId);
        if(beforeRow?.isOrigin&&targetDirections.has(beforeRow.directionId)&&compatible(before,after)) {
          const record=ensureRecord(beforeRow,previous.trip.startDate),transition={type:'vehicle_next_trip',level:'A',
            timestamp:current.timestamp,vehicleKey:hash(vehicle.vehicleId),nextTrip:`${current.trip.startDate}:${current.trip.tripId}`};
          record.nextTripTransition=transition;markEvidence(record,transition);
        }
      }
      lastByVehicle.set(vehicle.vehicleId,current);
    }
    for(const update of realtime.updates||[])if(update.trip?.tripId&&update.trip?.startDate) {
      const tripKey=instance(update.trip),items=updatesByTrip.get(tripKey)||[];items.push(update);updatesByTrip.set(tripKey,items);
    }
    let vehiclePresent=0,positiveEvidence=0;
    for(const row of candidates) {
      const tripKey=`${date}:${row.tripId}`,record=ensureRecord(row,date),vehicleRows=vehiclesByTrip.get(tripKey)||[],updateRows=updatesByTrip.get(tripKey)||[];
      const vehicle=vehicleRows.length===1?vehicleRows[0]:null,update=updateRows.length===1?updateRows[0]:null;
      let evidence=null;
      if(vehicle) {
        vehiclePresent++;
        const originPosition=position.stops[row.originStopId]?.position;
        const observed=tracker.observe({vehicle,row,date,originPosition,now:receivedAt});
        if(feedFresh&&observed.supported&&observed.originPassed) {
          evidence={type:'gps_origin_passed',timestamp:observed.observedAt,confidence:observed.confidence,
            vehicleKey:hash(vehicle.vehicleId)};markEvidence(record,evidence);
        }
      }
      if(feedFresh&&update?.trip?.relationship&&update.trip.relationship!==0) {
        evidence={type:'cancelled',timestamp:update.timestamp??realtime.timestamp,vehicleKey:update.vehicleId?hash(update.vehicleId):null};
        record.cancellationEvidence??=evidence;
      }
      if(record.firstPositiveDepartedEvidence)positiveEvidence++;
      record.observations.push({sample:sampleIndex,receivedAt,feedTimestamp:realtime.timestamp,feedFresh,
        vehiclePresent:Boolean(vehicle),vehicleKey:vehicle?hash(vehicle.vehicleId):null,gpsTimestamp:vehicle?.timestamp??null,
        tripUpdatePresent:Boolean(update),tripUpdateTimestamp:update?.timestamp??null,evidenceType:evidence?.type??null});
    }
    result.records=[...records.values()];result.samples.push({sample:sampleIndex,receivedAt,feedTimestamp:realtime.timestamp,
      feedFresh,candidates:candidates.length,vehiclePresent,positiveEvidence});
    result.summary={samples:result.samples.length,tripInstances:records.size,
      positiveEvidence:[...records.values()].filter(value=>value.firstPositiveDepartedEvidence).length,
      censored:[...records.values()].filter(value=>!value.firstPositiveDepartedEvidence).length,
      transitions:[...records.values()].filter(value=>value.nextTripTransition).length};
    const encoded=JSON.stringify(result,null,2)+'\n';
    if(encoded.includes(token)||encoded.includes(encodeURIComponent(token)))throw Error('SECRET_LEAK');
    writeFileSync(temporary,encoded,{encoding:'utf8',flush:true});renameSync(temporary,target);
    console.log(JSON.stringify({status:'DEPARTURE_CONFIDENCE_SAMPLE',sample:sampleIndex+1,...result.summary}));
  }
  console.log(JSON.stringify({status:'DEPARTURE_CONFIDENCE_OBSERVATION_PASS',captureId,...result.summary}));
} catch {
  console.log('{"status":"DEPARTURE_CONFIDENCE_OBSERVATION_STOPPED","previousSamplesPreserved":true}');process.exitCode=1;
}

// Research-only bounded observer. Vehicle IDs are salted per capture before local persistence.
import { createHash } from 'node:crypto';
import { writeFileSync,renameSync } from 'node:fs';
import { setTimeout as wait } from 'node:timers/promises';
import { readFileSync } from 'node:fs';
import { readLocalToken } from './local-secret.js';
import { fetchRealtime,parseRealtime } from '../providers/kawasaki/adapter.js';

const SAMPLE_COUNT=8,INTERVAL_MS=31000;
const hash=value=>createHash('sha256').update(value).digest('hex').slice(0,24);
const identity=trip=>`${trip.startDate||''}:${trip.tripId||''}`;

try {
  const token=readLocalToken(),index=JSON.parse(readFileSync(new URL('../generated/p0-static.json',import.meta.url),'utf8'));
  const selected=new Map(),targetOrigins=new Set();
  for(const [directionId,rows] of Object.entries(index.directions))for(const row of rows) {
    selected.set(row.tripId,{...row,directionId});
    if(['noborito_to_home','mizonokuchi_to_home'].includes(directionId)&&row.isOrigin)targetOrigins.add(row.tripId);
  }
  const captureId=new Date().toISOString().slice(0,19).replaceAll(/[-:]/g,''),salt=`paluru-departure:${captureId}:`;
  const target=new URL(`../generated/departure-poc-${captureId}.json`,import.meta.url),temporary=new URL(`${target.href}.tmp`);
  const result={researchOnly:true,productionInput:false,captureId,startedAt:new Date().toISOString(),sourceVersion:index.sourceVersion,
    intendedSamples:SAMPLE_COUNT,intervalMs:INTERVAL_MS,vehicleIdsHashed:true,samples:[],summary:null};
  const last=new Map(),transitions=[],assignments=[];
  for(let sampleIndex=0;sampleIndex<SAMPLE_COUNT;sampleIndex++) {
    if(sampleIndex)await wait(INTERVAL_MS);
    const receivedAt=Date.now()/1000,realtime=parseRealtime(await fetchRealtime(token),receivedAt);
    const vehicles=realtime.vehicles.filter(value=>value.vehicleId&&selected.has(value.trip.tripId)).map(value=>({
      vehicleKey:hash(`${salt}${value.vehicleId}`),tripId:value.trip.tripId,startDate:value.trip.startDate,routeId:value.trip.routeId,
      timestamp:value.timestamp,lat:value.position.lat,lon:value.position.lon,targetOutgoing:targetOrigins.has(value.trip.tripId),
      auxiliary:{stopId:value.stopId,sequence:value.sequence,status:value.status}}));
    const updates=realtime.updates.filter(value=>value.vehicleId&&selected.has(value.trip.tripId)).map(value=>{
      const row=selected.get(value.trip.tripId),origin=value.stops.filter(stop=>stop.stopId===row.originStopId&&stop.sequence===row.originSequence);
      return {vehicleKey:hash(`${salt}${value.vehicleId}`),tripId:value.trip.tripId,startDate:value.trip.startDate,routeId:value.trip.routeId,
        timestamp:value.timestamp,targetOutgoing:targetOrigins.has(value.trip.tripId),originDeparture:origin.length===1?origin[0].departure:null};
    });
    const current=new Map(vehicles.map(value=>[value.vehicleKey,value]));
    for(const vehicle of vehicles) {
      const previous=last.get(vehicle.vehicleKey);
      if(previous&&identity(previous)!==identity(vehicle))transitions.push({sample:sampleIndex,vehicleKey:vehicle.vehicleKey,
        incomingTrip:identity(previous),outgoingTrip:identity(vehicle),incomingTarget:previous.targetOutgoing,outgoingTarget:vehicle.targetOutgoing,
        previousTimestamp:previous.timestamp,currentTimestamp:vehicle.timestamp});
      last.set(vehicle.vehicleKey,vehicle);
    }
    for(const update of updates) {
      const vehicle=current.get(update.vehicleKey);
      if(vehicle&&identity(vehicle)!==identity(update))assignments.push({sample:sampleIndex,vehicleKey:update.vehicleKey,
        incomingTrip:identity(vehicle),outgoingTrip:identity(update),outgoingTarget:update.targetOutgoing,
        vehicleTimestamp:vehicle.timestamp,updateTimestamp:update.timestamp});
    }
    result.samples.push({sample:sampleIndex,receivedAt:new Date(receivedAt*1000).toISOString(),feedTimestamp:realtime.timestamp,vehicles,updates});
    result.summary={samples:result.samples.length,selectedVehicles:result.samples.reduce((n,value)=>n+value.vehicles.length,0),
      selectedUpdates:result.samples.reduce((n,value)=>n+value.updates.length,0),tripTransitions:transitions.length,
      targetOutgoingTransitions:transitions.filter(value=>value.outgoingTarget).length,sameFeedFutureAssignments:assignments.length,
      targetOutgoingAssignments:assignments.filter(value=>value.outgoingTarget).length,levelATripChains:0,turnaroundSamples:0};
    const encoded=JSON.stringify({...result,transitions,assignments},null,2)+'\n';
    if(encoded.includes(token)||encoded.includes(encodeURIComponent(token)))throw Error('SECRET_LEAK');
    writeFileSync(temporary,encoded,{encoding:'utf8',flush:true});renameSync(temporary,target);
    console.log(JSON.stringify({status:'DEPARTURE_OBSERVATION_SAMPLE',sample:sampleIndex+1,...result.summary}));
  }
  console.log(JSON.stringify({status:'DEPARTURE_OBSERVATION_PASS',captureId,...result.summary}));
} catch {
  console.log('{"status":"DEPARTURE_OBSERVATION_STOPPED","previousSamplesPreserved":true}');process.exitCode=1;
}

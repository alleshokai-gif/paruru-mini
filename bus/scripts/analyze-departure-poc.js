import { readFileSync,readdirSync,writeFileSync } from 'node:fs';
import { resolveTerminalArea } from '../providers/kawasaki/departure.js';

const percentile=(values,p)=>{if(!values.length)return null;const rows=[...values].sort((a,b)=>a-b);return rows[Math.min(rows.length-1,Math.floor((rows.length-1)*p))];};
const dayStart=date=>Date.parse(`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6)}T00:00:00+09:00`)/1000;
const parseIdentity=value=>{const split=value.indexOf(':');return {startDate:value.slice(0,split),tripId:value.slice(split+1)};};
const summarize=values=>({samples:values.length,medianSec:percentile(values,0.5),p80Sec:percentile(values,0.8),maxSec:percentile(values,1)});

try {
  const folder=new URL('../generated/',import.meta.url),index=JSON.parse(readFileSync(new URL('p0-static.json',folder),'utf8'));
  const position=JSON.parse(readFileSync(new URL('p1-position-static.json',folder),'utf8'));
  const rows=new Map();
  for(const [directionId,items] of Object.entries(index.directions))for(const row of items)rows.set(row.tripId,{...row,directionId});
  const resolve=value=>{
    const row=rows.get(value.tripId),trip=position.trips[value.tripId],chain=position.chains[trip?.chainId];if(!row||!chain)return null;
    const originStopId=chain.stops[0].stopId,terminalStopId=chain.stops.at(-1).stopId;
    return {...row,originStopId,terminalStopId,originAreaId:resolveTerminalArea(originStopId),terminalAreaId:resolveTerminalArea(terminalStopId)};
  };
  const headways={};
  for(const directionId of ['noborito_to_home','mizonokuchi_to_home']) {
    const groups=new Map();
    for(const row of index.directions[directionId].filter(value=>value.isOrigin)) {
      const key=`${row.fromStopId}|${row.serviceId}`,values=groups.get(key)||[];values.push(row.scheduledSeconds);groups.set(key,values);
    }
    const byPlatform={};
    for(const [key,values] of groups) {
      values.sort((a,b)=>a-b);const stopId=key.split('|')[0],diffs=byPlatform[stopId]||[];
      for(let i=1;i<values.length;i++)if(values[i]>values[i-1]&&values[i]-values[i-1]<=3*3600)diffs.push(values[i]-values[i-1]);
      byPlatform[stopId]=diffs;
    }
    headways[directionId]=Object.fromEntries(Object.entries(byPlatform).map(([stopId,values])=>[stopId,summarize(values)]));
  }
  const files=readdirSync(folder).filter(name=>/^departure-poc-\d{8}T\d{6}\.json$/.test(name)),links=[],assignments=[],delays=new Map();
  for(const name of files) {
    const capture=JSON.parse(readFileSync(new URL(name,folder),'utf8'));
    for(const value of capture.transitions||[]) {
      const incoming=parseIdentity(value.incomingTrip),outgoing=parseIdentity(value.outgoingTrip),before=resolve(incoming),after=resolve(outgoing);
      const sameTerminal=before&&after&&(before.terminalStopId===after.originStopId||before.terminalAreaId&&before.terminalAreaId===after.originAreaId);
      const gapSec=value.currentTimestamp-value.previousTimestamp;
      const scheduled=after?.isOrigin?dayStart(outgoing.startDate)+after.scheduledSeconds:null;
      links.push({incomingTrip:value.incomingTrip,outgoingTrip:value.outgoingTrip,outgoingDirection:after?.directionId||null,
        outgoingPlatform:after?.platform||null,sameTerminal:Boolean(sameTerminal),gapSec,
        transitionLeadSec:scheduled===null?null:scheduled-value.currentTimestamp,
        level:sameTerminal&&gapSec>=0&&gapSec<=30*60?'A':'C',evidence:'same_vehicle_id_observed_trip_transition'});
    }
    for(const value of capture.assignments||[]) {
      const incoming=parseIdentity(value.incomingTrip),outgoing=parseIdentity(value.outgoingTrip),before=resolve(incoming),after=resolve(outgoing);
      const sameTerminal=before&&after&&(before.terminalStopId===after.originStopId||before.terminalAreaId&&before.terminalAreaId===after.originAreaId);
      assignments.push({incomingTrip:value.incomingTrip,outgoingTrip:value.outgoingTrip,outgoingDirection:after?.directionId||null,
        outgoingPlatform:after?.platform||null,sameTerminal:Boolean(sameTerminal),level:sameTerminal?'A':'C'});
    }
    for(const sample of capture.samples||[])for(const update of sample.updates||[]) {
      const row=rows.get(update.tripId);if(!row?.isOrigin||!update.targetOutgoing)continue;
      const event=update.originDeparture;if(!event)continue;
      const scheduled=dayStart(update.startDate)+row.scheduledSeconds;
      const delay=Number.isFinite(event.time)?event.time-scheduled:Number.isFinite(event.delay)?event.delay:null;
      if(Number.isFinite(delay))delays.set(`${update.startDate}:${update.tripId}`,{directionId:row.directionId,stopId:row.fromStopId,delay});
    }
  }
  const delaysByPlatform={};
  for(const value of delays.values()) {
    const key=`${value.directionId}:${value.stopId}`,items=delaysByPlatform[key]||[];items.push(value.delay);delaysByPlatform[key]=items;
  }
  const result={researchOnly:true,productionInput:false,generatedAt:new Date().toISOString(),captureFiles:files.length,
    static:{blockIdSelectedTrips:0,originTrips:{noborito:index.directions.noborito_to_home.filter(value=>value.isOrigin).length,
      mizonokuchi:index.directions.mizonokuchi_to_home.filter(value=>value.isOrigin).length,
      mizonokuchiMidRoute:index.directions.mizonokuchi_to_home.filter(value=>!value.isOrigin).length},headways},
    realtime:{observedTransitions:links.length,levelAPostTransitions:links.filter(value=>value.level==='A').length,
      sameFeedAssignments:assignments.length,levelAFutureAssignments:assignments.filter(value=>value.level==='A').length,
      links,assignments,originDepartureDelay:Object.fromEntries(Object.entries(delaysByPlatform).map(([key,values])=>[key,summarize(values)])),
      exactTurnaroundSamples:0},
    conclusion:{incomingLinkBeforeDeparture:assignments.some(value=>value.level==='A')?'level_a_observed':'level_c_unavailable',
      postTransitionTripChain:links.some(value=>value.level==='A')?'level_a_observed':'unavailable',
      estimatedDeparture:'unavailable',reason:'exact_arrival_and_departure_timestamps_not_observed'}};
  writeFileSync(new URL('departure-poc-summary.json',folder),JSON.stringify(result,null,2)+'\n',{encoding:'utf8',flush:true});
  console.log(JSON.stringify({status:'DEPARTURE_ANALYSIS_PASS',captureFiles:files.length,originTrips:result.static.originTrips,
    levelAPostTransitions:result.realtime.levelAPostTransitions,levelAFutureAssignments:result.realtime.levelAFutureAssignments,
    delay:result.realtime.originDepartureDelay,exactTurnaroundSamples:0,estimatedDeparture:'unavailable'}));
} catch(error) {
  console.log(JSON.stringify({status:'DEPARTURE_ANALYSIS_FAILED',code:/^DEPARTURE_[A-Z_]+$/.test(error?.message||'')?error.message:'ANALYSIS_INVALID'}));process.exitCode=1;
}

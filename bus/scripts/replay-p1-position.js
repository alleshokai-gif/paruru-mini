// Research-only replay. Reference values never enter the position engine.
import { readFileSync,writeFileSync,existsSync,renameSync } from 'node:fs';
import { createRouteIndex } from '../position/route-index.js';
import { createPositionEngine } from '../position/engine.js';
import { distanceMeters,validPoint } from '../position/geometry.js';
import { readLocalToken } from './local-secret.js';
try {
  const name=process.argv[2];if(!/^position-p0-\d{8}T\d{6}\.json$/.test(name))throw Error();
  const read=n=>JSON.parse(readFileSync(new URL(`../generated/${n}`,import.meta.url),'utf8'));
  const index=read('p0-static.json'),source=read('p1-position-static.json'),capture=read(name);
  if(capture.sourceVersion!==source.sourceVersion)throw Error();
  const routeIndex=createRouteIndex(source,index,source.provider),engine=createPositionEngine({routeIndex});
  const byDirection={},examples=[],durations=[];
  for(const sample of capture.samples)for(const d of sample.directions) {
    const stats=byDirection[d.id]??={rows:0,trips:new Set(),uniqueGps:new Set(),gpsMissing:0,gpsStale:0,age:[],supported:0,reasons:{},naviSamples:0,naviMarkers:0,candidateDistances:[]};
    if(d.navi.status==='ok')stats.naviSamples++;stats.naviMarkers+=d.navi.markers.length;
    for(const v of d.vehicles) {
      const now=Date.parse(sample.receivedAt)/1000,position={lat:v.lat,lon:v.lon},age=now-v.timestamp;
      stats.rows++;stats.trips.add(v.tripId);if(!validPoint(position))stats.gpsMissing++;
      else stats.uniqueGps.add(`${v.tripId}:${v.timestamp}`);
      if(v.timestamp!=null){stats.age.push(age);if(age>120||age< -5)stats.gpsStale++;}
      const started=performance.now();
      // Older captures omitted descriptor fields. Do not fabricate them for an Engine replay.
      // In a new capture an explicitly recorded null relationship uses the GTFS-RT default SCHEDULED, as the Adapter does.
      const descriptorCaptured=['relationship','startTime','vehicleRouteId'].every(k=>Object.hasOwn(v,k));
      const estimate=descriptorCaptured ? engine.evaluate({provider:source.provider,tripId:v.tripId,routeId:v.vehicleRouteId,startDate:v.startDate,
        relationship:v.relationship??0,startTime:v.startTime,timestamp:v.timestamp,position,rawState:v.auxiliary},
        {stopId:v.fromStopId,sequence:v.targetSequence},now) : {supported:false,reason:'capture_descriptor_missing'};
      durations.push(performance.now()-started);
      if(estimate.supported)stats.supported++;else stats.reasons[estimate.reason]=(stats.reasons[estimate.reason]||0)+1;
      // Distance describes candidates, not an identity or correctness label.
      const refs=d.navi.markers.filter(m=>m.route===v.routeLabel).map(m=>distanceMeters(position,{lat:Number(m.lat),lon:Number(m.lon)})).filter(Number.isFinite);
      if(refs.length)stats.candidateDistances.push(Math.min(...refs));
      if(examples.filter(e=>e.direction===d.id).length<3 && validPoint(position)&&age<=120)examples.push({direction:d.id,tripId:v.tripId,
        observedAt:sample.receivedAt,gpsTimestamp:v.timestamp,gps:position,rawState:v.auxiliary,estimate,
        referenceContent:d.navi.markers.map(m=>({route:m.route,content:m.content})),exactReferenceJoin:false});
    }
  }
  const summary={researchOnly:true,capture:name,sourceVersion:source.sourceVersion,samples:capture.samples.length,
    startedAt:capture.startedAt,endedAt:capture.samples.at(-1).receivedAt,
    feedIntervals:capture.samples.slice(1).map((s,i)=>s.feedTimestamp-capture.samples[i].feedTimestamp),
    directions:Object.fromEntries(Object.entries(byDirection).map(([id,s])=>[id,{...s,trips:s.trips.size,uniqueGps:s.uniqueGps.size,
      age:undefined,candidateDistances:undefined,minGpsAgeSec:Math.min(...s.age),maxGpsAgeSec:Math.max(...s.age),
      candidateComparisons:s.candidateDistances.length,candidateDistanceMin:s.candidateDistances.length?Math.min(...s.candidateDistances):null,
      candidateDistanceMax:s.candidateDistances.length?Math.max(...s.candidateDistances):null}])),
    verification:{eligiblePairs:0,correct:0,incorrect:0,agreementRate:null,clearErrorRate:null,
      reason:'No adjudicated same-trip/time reference pairs. Inspect shape coverage and suppression reasons; a route-label/GPS candidate is not an exact join.'},
    meanEvaluateMs:durations.reduce((a,b)=>a+b,0)/durations.length,maxEvaluateMs:Math.max(...durations),positionUiEnabled:false,examples};
  const target=new URL(`../generated/${name.replace('.json','-p1-replay.json')}`,import.meta.url),encoded=JSON.stringify(summary,null,2)+'\n',token=readLocalToken();
  if(existsSync(target)||[token,encodeURIComponent(token)].some(t=>encoded.includes(t)))throw Error();
  const temp=new URL(target.href+'.tmp');writeFileSync(temp,encoded);renameSync(temp,target);
  console.log(JSON.stringify({status:'POSITION_REPLAY_PASS',...summary,examples:undefined}));
}catch{console.log('{"status":"POSITION_REPLAY_FAILED"}');process.exitCode=1;}

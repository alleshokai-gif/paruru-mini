import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync,unzipSync,strToU8,strFromU8 } from 'fflate';
import { createHash } from 'node:crypto';
import { prepareShape,snapCandidates,distanceToAlong } from '../position/geometry.js';
import { createRouteIndex } from '../position/route-index.js';
import { createPositionEngine,normalizeVehicle,publicPosition,POSITION_PUBLIC_ENABLED } from '../position/engine.js';
import { loadPosition } from '../runtime/position.js';
import { createPositionObserver } from '../position/observer.js';
import { buildObservedCorridorPoc } from '../position/observed-corridor.js';
import { build } from 'esbuild';
import { buildPositionStatic,publishPositionStatic } from '../scripts/position-static.js';
import { createBusService } from '../core/service.js';
import { staticZip,indexFixture,realtimeFixture,NOW,P0_INPUT } from './fixtures.js';
const latitude=35,longitude=139,m=1/(6371008.8*Math.PI/180),scale=Math.cos(latitude*Math.PI/180);
const point=(x,y=0)=>({lat:latitude+y*m,lon:longitude+x*m/scale});
function fixture({loop=false,distances=true,gaps=false}={}) {
  const shapePoints=(loop?[point(0),point(200),point(200,10),point(0,10)]:[point(0),point(100),point(200),point(300)])
    .map((p,i)=>({...p,sequence:i,shapeDistTraveled:distances?i:null}));
  const stops=Object.fromEntries((loop?[point(0),point(200),point(0,10)]:[point(0),point(100),point(200),point(300)])
    .map((position,i)=>[`s${i}`,{stopId:`s${i}`,name:`Stop ${i}`,position}]));
  const chain=Object.keys(stops).map((id,i)=>({stopId:id,sequence:gaps?i*10+5:i+1,shapeDistTraveled:distances?(loop&&i===2?3:i):null}));
  const row={tripId:'t',routeId:'r',fromStopId:'s0',toStopId:`s${chain.length-1}`,stopSequence:chain[0].sequence,alightSequence:chain.at(-1).sequence};
  const index={sourceVersion:'test',sourceHash:'abc',directions:{q:[row]}};
  const source={schemaVersion:1,provider:'synthetic',sourceVersion:'test',sourceHash:'abc',generatedAt:'2026-09-11T00:00:00Z',
    stops,shapes:{shape:shapePoints},chains:{chain:{shapeId:'shape',stops:chain}},trips:{t:{tripId:'t',routeId:'r',shapeId:'shape',chainId:'chain'}},directions:{q:['t']}};
  return {index,source,target:{stopId:row.toStopId,sequence:row.alightSequence}};
}
const T=Date.parse('2026-09-11T07:00:00+09:00')/1000;
const vehicle=(x,t=T,y=0,rawState={})=>({provider:'synthetic',tripId:'t',routeId:'r',startDate:'20260911',startTime:'07:00:00',relationship:0,timestamp:t,position:point(x,y),rawState});
function setup(options={},policy={}) {const f=fixture(options),routeIndex=createRouteIndex(f.source,f.index,'synthetic');return {...f,routeIndex,engine:createPositionEngine({routeIndex,policy})};}
function move(s,xs,rawState={}) {return xs.map((x,i)=>s.engine.evaluate(vehicle(x,T+i*30,0,rawState),s.target,T+i*30)).at(-1);}

test('shape snap follows bent path rather than nearest stop or endpoint chord',()=>{
  const shape=prepareShape([point(0),point(100),point(100,100)]),snap=snapCandidates(shape,point(110,50),40)[0];
  assert.ok(Math.abs(snap.distance-10)<0.01);assert.ok(Math.abs(snap.along-150)<0.01);
  assert.equal(snapCandidates(shape,point(500),40).length,0);
});
test('shape distances retain source units and map to geometric metres',()=>{
  const shape=prepareShape([0,100,200].map((x,i)=>({...point(x),shapeDistTraveled:i*0.1})));
  assert.ok(Math.abs(distanceToAlong(shape,0.15)-150)<0.001);assert.equal(distanceToAlong(shape,1),null);
});
test('three unique samples locate a stop interval and count intervening stops',()=>{
  const s=setup(),r=move(s,[110,140,160]);assert.equal(r.supported,true);assert.equal(r.state,'between_stops');
  assert.equal(r.previousStop.id,'s1');assert.equal(r.nextStop.id,'s2');assert.equal(r.stopsAway,1);
  assert.ok(r.confidence>=0.85);assert.ok(r.progress>0.5&&r.progress<0.6);
});
test('non-contiguous GTFS sequences count stop ordinals, not sequence numbers',()=>{
  const r=move(setup({gaps:true}),[110,140,160]);assert.equal(r.stopsAway,1);assert.equal(r.nextStop.sequence,25);
});
test('stop approach, departure and dwell use continuous GPS evidence',()=>{
  assert.equal(move(setup(),[40,65,80]).state,'approaching');
  assert.equal(move(setup(),[75,95,120]).state,'departed');
  const stopped=move(setup(),[99,100,101]);assert.equal(stopped.state,'at_stop');assert.equal(stopped.nextStop.id,'s1');
  const jitter=move(setup(),[150,152,149]);assert.equal(jitter.supported,false);assert.equal(jitter.reason,'motion_ambiguous');
});
test('duplicate timestamps never establish history; conflicting timestamps clear it',()=>{
  const s=setup();for(let i=0;i<5;i++)assert.equal(s.engine.evaluate(vehicle(100),s.target,T).supported,false);
  assert.equal(s.engine.evaluate(vehicle(140),s.target,T).reason,'timestamp_conflict');
});
test('missing, old, future and off-route GPS suppress and reset continuity',()=>{
  for(const mutate of [v=>v.position.lat=null,v=>v.timestamp=null,v=>v.timestamp=T-121,v=>v.timestamp=T+6,v=>v.position=point(150,70)]) {
    const s=setup(),v=vehicle(150);mutate(v);const r=s.engine.evaluate(v,s.target,T);assert.equal(r.supported,false);assert.equal(s.engine.historySize(),0);
  }
  const s=setup();move(s,[110,140,160]);assert.equal(s.engine.evaluate(vehicle(190,T+300),s.target,T+300).reason,'insufficient_history');
});
test('reverse travel and physically impossible jumps are unknown',()=>{
  assert.equal(move(setup(),[180,150,120]).reason,'reverse_or_jump');
  const s=setup({}, {maxSpeedMps:0.1,jumpAllowanceMeters:1});assert.equal(move(s,[10,140,250]).reason,'reverse_or_jump');
});
test('near parallel outbound/return legs stay ambiguous without ordered progress',()=>{
  const s=setup({loop:true});let r;
  for(let i=0;i<3;i++)r=s.engine.evaluate(vehicle(100+i,T+i*30,5),s.target,T+i*30);
  assert.equal(r.supported,false);assert.equal(r.reason,'route_projection_ambiguous');
});
test('foldback stop projection without shape distances is rejected; explicit chain survives',()=>{
  const bad=setup({loop:true,distances:false});assert.equal(bad.routeIndex.getTrip('t').supported,false);
  assert.equal(setup({loop:true}).routeIndex.getTrip('t').supported,true);
});
test('route geometry source is injected and reported without requiring GTFS shapes',()=>{
  const f=fixture(),points=f.source.shapes.shape;
  f.source.shapes={};f.source.chains.chain.shapeId=null;f.source.trips.t.shapeId=null;
  const external={schemaVersion:1,provider:'synthetic',sourceType:'observed_corridor',sourceVersion:'research-1',
    staticSourceHash:'abc',generatedAt:'2026-09-12T00:00:00Z',chains:{chain:{geometryId:'observed:test',eligible:true,points}}};
  const routeIndex=createRouteIndex(f.source,f.index,'synthetic',undefined,[external]);
  const engine=createPositionEngine({routeIndex}),s={...f,routeIndex,engine},result=move(s,[110,140,160]);
  assert.equal(result.supported,true,JSON.stringify({result,trip:routeIndex.getTrip('t')}));assert.equal(result.method,'gps_observed_corridor_snap');
  assert.deepEqual(result.geometrySource,{type:'observed_corridor',version:'research-1',id:'observed:test'});
  external.chains.chain.eligible=false;
  assert.equal(createRouteIndex(f.source,f.index,'synthetic',undefined,[external]).getTrip('t').reason,'route_geometry_unavailable');
});
test('official GTFS geometry keeps priority over an injected observed corridor',()=>{
  const f=fixture(),external={schemaVersion:1,provider:'synthetic',sourceType:'observed_corridor',sourceVersion:'research-1',
    staticSourceHash:'abc',generatedAt:'2026-09-12T00:00:00Z',chains:{chain:{geometryId:'observed:test',eligible:true,points:f.source.shapes.shape}}};
  const routeIndex=createRouteIndex(f.source,f.index,'synthetic',undefined,[external]),engine=createPositionEngine({routeIndex});
  assert.equal(move({...f,routeIndex,engine},[110,140,160]).method,'gps_gtfs_shape_snap');
});
test('geometry source priority is GTFS, official ODPT, validated road, then observed corridor',()=>{
  const f=fixture(),points=f.source.shapes.shape;
  f.source.shapes={};f.source.chains.chain.shapeId=null;f.source.trips.t.shapeId=null;
  const sourceType=type=>({schemaVersion:1,provider:'synthetic',sourceType:type,sourceVersion:type,
    staticSourceHash:'abc',generatedAt:'2026-09-12T00:00:00Z',chains:{chain:{geometryId:type,eligible:true,points}}});
  let sources=['observed_corridor','validated_road_geometry','official_odpt_geometry'].map(sourceType);
  let routeIndex=createRouteIndex(f.source,f.index,'synthetic',undefined,sources),engine=createPositionEngine({routeIndex});
  assert.equal(move({...f,routeIndex,engine},[110,140,160]).method,'gps_official_odpt_geometry_snap');
  sources=sources.filter(value=>value.sourceType!=='official_odpt_geometry');
  routeIndex=createRouteIndex(f.source,f.index,'synthetic',undefined,sources);engine=createPositionEngine({routeIndex});
  assert.equal(move({...f,routeIndex,engine},[110,140,160]).method,'gps_validated_road_geometry_snap');
});
test('raw sequence contradiction reduces confidence but never selects a route candidate',()=>{
  const good=move(setup(),[110,140,160]);const mismatch=move(setup(),[110,140,160],{sequence:99,stopId:'wrong',status:1});
  assert.equal(mismatch.supported,true);assert.ok(mismatch.confidence<good.confidence);assert.equal(mismatch.nextStop.id,'s2');
  const low=move(setup({}, {threshold:0.9}),[110,140,160],{sequence:99,stopId:'wrong',status:1});
  assert.equal(low.supported,false);assert.equal(low.reason,'confidence_below_threshold');
});
test('target passed, wrong trip/route/provider, missing target and stale day never assert a position',()=>{
  const s=setup();for(const patch of [{provider:'other'},{routeId:'other'},{tripId:'other'},{startDate:'bad'}])
    assert.equal(s.engine.evaluate({...vehicle(100),...patch},s.target,T).supported,false);
  assert.equal(s.engine.evaluate(vehicle(100),{stopId:'absent',sequence:3},T).supported,false);
  assert.equal(s.engine.evaluate({...vehicle(100),serviceDayStart:T-3*86400},s.target,T).reason,'service_day_mismatch');
  const x=setup();x.target={stopId:'s1',sequence:2};assert.equal(move(x,[150,180,220]).supported,false);
});
test('GPS remains internal, publication gate stays OFF even for supported output',()=>{
  const internal=normalizeVehicle({trip:{tripId:'t',routeId:'r',startDate:'20260911'},timestamp:T,position:{lat:35,lon:139},sequence:1,status:2,stopId:'s0'},'synthetic');
  assert.deepEqual(internal.position,{lat:35,lon:139});assert.equal(internal.rawState.sequence,1);assert.equal(internal.vehicleId,null);
  assert.deepEqual(normalizeVehicle({},'synthetic').position,{lat:null,lon:null});
  assert.equal(POSITION_PUBLIC_ENABLED,false);assert.deepEqual(publicPosition(move(setup(),[110,140,160])),{supported:false,status:null,stopsAway:null,previousStop:null,nextStop:null});
  assert.ok(!/"(?:lat|lon|position|rawState)":/.test(JSON.stringify(move(setup(),[110,140,160]))));
});
test('bounded trip memory expires and keeps different service instances separate',()=>{
  const s=setup({}, {maxTrips:2});
  for(let i=0;i<4;i++)s.engine.evaluate({...vehicle(100),startTime:`07:0${i}:00`},s.target,T);
  assert.equal(s.engine.historySize(),2);s.engine.evaluate(vehicle(100,T+181),s.target,T+181);assert.equal(s.engine.historySize(),1);
});
function gtfsInput() {
  const tables=unzipSync(staticZip());tables['stops.txt']=strToU8(strFromU8(tables['stops.txt']).split('\r\n').map((s,i)=>s+(i?',"35","139"':',"stop_lat","stop_lon"')).join('\r\n'));
  const bytes=zipSync(tables),index=indexFixture();index.sourceHash=createHash('sha256').update(bytes).digest('hex');index.sourceVersion=index.feedInfo.feed_version;
  return {bytes,index};
}
test('position GTFS builder keeps complete chains, exact version, four directions and absent shapes honestly',()=>{
  const {bytes,index}=gtfsInput(),a=buildPositionStatic(bytes,{index,provider:'synthetic'});
  assert.equal(Object.keys(a.trips).length,4);assert.equal(a.sourceCoverage.shapesTable,false);
  assert.equal(createRouteIndex(a,index,'synthetic').stats.supportedChains,0);
  assert.throws(()=>buildPositionStatic(bytes,{index:{...index,sourceHash:'bad'},provider:'synthetic'}));
  const bad=structuredClone(a);bad.chains[Object.keys(bad.chains)[0]].stops.reverse();assert.throws(()=>createRouteIndex(bad,index,'synthetic'));
});
test('Observed Corridor requires pattern separation, multi-day segment coverage, holdout and official evidence',()=>{
  const f=fixture(),chain=f.source.chains.chain,stops=f.source.stops;
  const rows=[],trips={};
  for(const tripId of ['t0','t1']){rows.push({tripId,routeId:'r',fromStopId:'s2',toStopId:'s3',stopSequence:3,alightSequence:4,startTime:'07:00:00'});trips[tripId]={tripId,routeId:'r',shapeId:null,chainId:'chain'};}
  const index={sourceVersion:'test',sourceHash:'abc',directions:{q:rows}},positionStatic={schemaVersion:1,provider:'synthetic',sourceVersion:'test',sourceHash:'abc',
    generatedAt:'2026-09-12T00:00:00Z',stops,shapes:{},chains:{chain:{...chain,shapeId:null}},trips,directions:{q:['t0','t1']}};
  const captures=[];
  for(let day=11;day<=13;day++) {
    const date=`202609${day}`,base=Date.parse(`2026-09-${day}T07:00:00+09:00`)/1000,samples=[];
    for(let pointIndex=0;pointIndex<3;pointIndex++) {
      const timestamp=base+pointIndex*30;
      samples.push({receivedAt:new Date(timestamp*1000).toISOString(),directions:[{id:'q',vehicles:['t0','t1'].map((tripId,tripIndex)=>({
        tripId,startDate:date,startTime:'07:00:00',relationship:0,vehicleRouteId:'r',routeId:'r',
        timestamp,lat:point(50+pointIndex*100+tripIndex).lat,lon:point(50+pointIndex*100+tripIndex).lon
      }))}]});
    }
    captures.push({sourceVersion:'test',samples});
  }
  const patternKey='synthetic:r:chain',withoutReference=buildObservedCorridorPoc({provider:'synthetic',directionId:'q',routeIds:['r'],index,positionStatic,captures});
  assert.equal(withoutReference.chains.chain.geometryReady,true);assert.equal(withoutReference.chains.chain.eligible,false);
  assert.ok(withoutReference.chains.chain.evidence.reasons.includes('official_reference_insufficient'));
  const verified=buildObservedCorridorPoc({provider:'synthetic',directionId:'q',routeIds:['r'],index,positionStatic,captures,
    officialVerification:{[patternKey]:{pairs:20,correct:19}}});
  assert.equal(verified.chains.chain.eligible,true);assert.equal(verified.chains.chain.evidence.serviceDays.length,3);
  assert.equal(verified.chains.chain.evidence.eligibleSegments,3);assert.equal(verified.chains.chain.evidence.leaveOneTripOut.matchRate,1);
  assert.equal(verified.chains.chain.segments.length,3);assert.ok(verified.chains.chain.segments.every(s=>s.points.length>2));
  assert.deepEqual(verified.chains.chain.segments.map(s=>s.stopsAway),[1,0,null]);
  assert.ok(verified.chains.chain.segments.every(s=>s.leaveOneTripOut.matchRate===1));
  const mixed=structuredClone(positionStatic);mixed.trips.t1.chainId='other';mixed.chains.other={...mixed.chains.chain,stops:[...mixed.chains.chain.stops].reverse()};
  assert.throws(()=>buildObservedCorridorPoc({provider:'synthetic',directionId:'q',routeIds:['r'],index,positionStatic:mixed,captures}));
});
test('invalid position build preserves existing artifact bytes',()=>{
  const {bytes,index}=gtfsInput(),a=buildPositionStatic(bytes,{index,provider:'synthetic'}),output=join(mkdtempSync(join(tmpdir(),'bus-position-')),'position.json');
  writeFileSync(output,'previous');assert.throws(()=>publishPositionStatic(a,index,output,{beforeReplace(){throw Error();}}));assert.equal(readFileSync(output,'utf8'),'previous');
  publishPositionStatic(a,index,output);assert.equal(JSON.parse(readFileSync(output,'utf8')).schemaVersion,1);
});
test('builder preserves shape IDs, shape points and optional stop distances including zero',()=>{
  const original=staticZip(),tables=unzipSync(original),baseIndex=indexFixture();
  const ids=Object.values(baseIndex.directions).flat().map(r=>r.tripId);
  tables['trips.txt']=strToU8(strFromU8(tables['trips.txt']).split('\r\n').map((s,i)=>s+(i?',"shape"':',"shape_id"')).join('\r\n'));
  tables['stop_times.txt']=strToU8(strFromU8(tables['stop_times.txt']).split('\r\n').map((s,i)=>s+(i?`,"${i%2?0:1}"`:',"shape_dist_traveled"')).join('\r\n'));
  tables['shapes.txt']=strToU8('shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence,shape_dist_traveled\nshape,35,139,5,0\nshape,35,139.01,15,1\n');
  const bytes=zipSync(tables),index={...baseIndex,sourceVersion:'synthetic',sourceHash:createHash('sha256').update(bytes).digest('hex')};
  const a=buildPositionStatic(bytes,{index,provider:'synthetic'});
  assert.equal(a.sourceCoverage.tripsWithShape,4);assert.equal(a.trips[ids[0]].shapeId,'shape');
  assert.equal(a.shapes.shape[0].sequence,5);assert.equal(a.shapes.shape[0].shapeDistTraveled,0);
  assert.deepEqual(a.chains[a.trips[ids[0]].chainId].stops.map(s=>s.shapeDistTraveled),[0,1]);
});
test('Position observer validates calendar and trip start without changing Provider records',()=>{
  const {bytes,index}=gtfsInput(),source=buildPositionStatic(bytes,{index,provider:'synthetic'}),routeIndex=createRouteIndex(source,index,'synthetic');
  const observer=createPositionObserver({index,routeIndex}),rt=realtimeFixture();
  rt.vehicles=[{trip:{...rt.updates[0].trip},timestamp:NOW,position:point(0),sequence:1,status:1,stopId:'s'}];
  const original=JSON.stringify(rt);observer.observe({realtime:rt,now:NOW});assert.equal(observer.summary().reasons.route_geometry_unavailable,1);assert.equal(JSON.stringify(rt),original);
  rt.vehicles[0].trip.startTime='08:00:00';observer.observe({realtime:rt,now:NOW});assert.equal(observer.summary().reasons.service_instance_mismatch,1);
  rt.timestamp=NOW-121;observer.observe({realtime:rt,now:NOW});assert.equal(observer.summary().reasons.feed_stale,1);
});
test('generic Position graph excludes provider code and Navi, with explicit Docker index allowlist',async()=>{
  const bundle=await build({entryPoints:[new URL('../position/engine.js',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1')],bundle:true,platform:'node',format:'esm',write:false,metafile:true,logLevel:'silent'});
  const graph=Object.keys(bundle.metafile.inputs).join('\n');assert.ok(!/providers|kawasaki|scripts|runtime/.test(graph));
  const runtime=await build({entryPoints:[new URL('../runtime/start.js',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1')],bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
  assert.ok(!/busMarkImg|bus-navigation\.jp|bus-location\.jp/.test(runtime.outputFiles[0].text));
  for(const name of ['.dockerignore','.gcloudignore']) {
    const text=readFileSync(new URL(`../${name}`,import.meta.url),'utf8');assert.ok(text.includes('!position/**'));assert.ok(text.includes('!generated/p1-position-static.json'));assert.ok(!text.includes('!generated/**'));
  }
});
test('Cloud Run startup position sidecar failure and geometry absence are independent of ETA',()=>{
  const {bytes,index}=gtfsInput(),a=buildPositionStatic(bytes,{index,provider:'synthetic'});
  assert.equal(loadPosition({index,provider:'synthetic',read:()=>JSON.stringify(a)}).status,'geometry_unavailable');
  assert.equal(loadPosition({index,provider:'synthetic',read:()=>'{bad'}).observer,null);
  assert.equal(loadPosition({index,provider:'wrong',read:()=>JSON.stringify(a)}).observer,null);
});
test('P0 complete DTO and cached provider calls are unchanged when the Position observer throws',async()=>{
  let calls=0;const base={index:indexFixture(),...P0_INPUT,version:'test',now:()=>NOW,adapter:{getRealtime:async()=>{calls++;return realtimeFixture();}}};
  const reference=await createBusService(base).getArrivals(),service=createBusService({...base,positionObserver:{observe(){throw Error('synthetic position fault');}}});
  assert.deepEqual(await service.getArrivals(),reference);assert.deepEqual(await service.getArrivals(),reference);assert.equal(calls,2);
});

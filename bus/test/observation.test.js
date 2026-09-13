import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { observationConfig,parseTimeBands,withinTimeBands } from '../observation/config.js';
import { OBSERVATION_HEADERS,finalizeObservation,observationValues } from '../observation/schema.js';
import { createSheetsStore,columnName } from '../observation/sheets.js';
import { runBoundedObservation } from '../observation/runner.js';
import { createObservationCollector } from '../observation/collector.js';

const HASH='h'.repeat(32),NOW=Date.parse('2026-09-14T15:01:00+09:00')/1000;
const index=()=>({sourceVersion:'synthetic',sourceHash:'source-hash',fetchedAt:NOW,
  feedInfo:{feed_start_date:'20260101',feed_end_date:'20261231'},calendarDates:[],
  calendar:[{service_id:'daily',start_date:'20260101',end_date:'20261231',monday:'1',tuesday:'1',wednesday:'1',thursday:'1',friday:'1',saturday:'1',sunday:'1'}],
  stops:{'362_1':{name:'登戸駅'},'184_3':{name:'神木本町'}},directions:{noborito_to_home:[{
    tripId:'trip-1',routeId:'10044',routeLabel:'登０５',serviceId:'daily',directionId:'noborito_to_home',startTime:'15:00:00',
    fromStopId:'362_1',toStopId:'184_3',stopSequence:1,alightSequence:3,scheduledSeconds:15*3600,
    originStopId:'362_1',originSequence:1,isOrigin:true,headsign:'菅生車庫',platform:'登05のりば'}]}});
const position=()=>({schemaVersion:1,provider:'kawasaki',sourceVersion:'synthetic',sourceHash:'source-hash',generatedAt:'2026-09-14T00:00:00.000Z',
  trips:{'trip-1':{tripId:'trip-1',routeId:'10044',chainId:'chain-1',shapeId:null}},directions:{noborito_to_home:['trip-1']},
  stops:{'362_1':{stopId:'362_1',name:'登戸駅',position:{lat:35,lon:139}},'mid_1':{stopId:'mid_1',name:'中間',position:{lat:35.005,lon:139}},
    '184_3':{stopId:'184_3',name:'神木本町',position:{lat:35.01,lon:139}}},shapes:{},
  chains:{'chain-1':{chainId:'chain-1',shapeId:null,stops:[{stopId:'362_1',sequence:1,shapeDistTraveled:null},
    {stopId:'mid_1',sequence:2,shapeDistTraveled:null},{stopId:'184_3',sequence:3,shapeDistTraveled:null}]}}});
const realtime=(timestamp,lat=35)=>({schemaVersion:3,fetchedAt:timestamp,timestamp,updates:[],vehicles:[{
  trip:{tripId:'trip-1',startDate:'20260914',startTime:'15:00:00',routeId:'10044',relationship:0},vehicleId:'raw-vehicle',timestamp,
  stopId:'362_1',sequence:1,status:1,position:{lat,lon:139}}]});
const baseRow=overrides=>finalizeObservation({observation_id:null,run_id:'run-1',sample_index:0,observation_kind:'departure',
  observed_at:'2026-09-14T15:01:00.000+09:00',provider:'kawasaki',direction_id:'noborito_to_home',route_id:'10044',trip_id:'trip-1',
  service_date:'20260914',origin_stop_id:'362_1',platform:'登05のりば',scheduled_departure:'2026-09-14T15:00:00.000+09:00',
  evidence_type:null,departure_state:'departure_overdue',elapsed_from_scheduled_sec:60,gps_age_sec:null,rt_age_sec:1,next_bus_gap_min:20,
  censored:true,vehicle_hash:null,gps_timestamp:null,position_lat:null,position_lon:null,position_state:null,position_confidence:null,
  position_reason:null,previous_stop_id:null,next_stop_id:null,position_segment_key:null,position_expected_segments:null,
  aux_stop_id:null,aux_stop_sequence:null,aux_status:null,rt_timestamp:NOW,...overrides},HASH);

test('Observation config is bounded, Asia/Tokyo bands are optional, and secrets are mandatory',()=>{
  const config=observationConfig({ODPT_ACCESS_TOKEN:'token',OBSERVATION_HMAC_KEY:HASH,PALURU_BUS_OBSERVATION_SPREADSHEET_ID:'A'.repeat(24),
    OBSERVATION_TIME_BANDS:'06:30-09:30,16:00-20:30'});
  assert.equal(config.sampleCount,10);assert.equal(config.intervalSec,32);assert.equal(config.maxRunSec,330);
  assert.equal(withinTimeBands(Date.parse('2026-09-14T07:00:00+09:00')/1000,config.timeBands),true);
  assert.equal(withinTimeBands(Date.parse('2026-09-14T12:00:00+09:00')/1000,config.timeBands),false);
  assert.equal(withinTimeBands(NOW,parseTimeBands('22:00-02:00')),false);
  assert.throws(()=>observationConfig({ODPT_ACCESS_TOKEN:'token',OBSERVATION_HMAC_KEY:'short',PALURU_BUS_OBSERVATION_SPREADSHEET_ID:'A'.repeat(24)}),/HASH_SECRET/);
  assert.throws(()=>observationConfig({ODPT_ACCESS_TOKEN:'token',OBSERVATION_HMAC_KEY:HASH,PALURU_BUS_OBSERVATION_SPREADSHEET_ID:'A'.repeat(24),OBSERVATION_SAMPLE_COUNT:'12',OBSERVATION_MAX_RUN_SEC:'330',OBSERVATION_INTERVAL_SEC:'30'}),/BOUNDS/);
});

test('Observation schema creates deterministic IDs, hashes vehicles, and keeps raw identity out of values',()=>{
  const first=baseRow({}),second=baseRow({});
  assert.equal(first.observation_id,second.observation_id);assert.equal(OBSERVATION_HEADERS.length,observationValues(first).length);
  assert.equal(JSON.stringify(first).includes('raw-vehicle'),false);
  assert.throws(()=>baseRow({position_lat:91}),/ROW_INVALID/);
  assert.equal(columnName(OBSERVATION_HEADERS.length),'AH');
});

test('Sheets store validates fixed headers and suppresses existing and same-batch duplicates',async()=>{
  const existing=baseRow({trip_id:'trip-old'}),fresh=baseRow({trip_id:'trip-new'}),calls=[];
  const responses=[{values:[OBSERVATION_HEADERS]},{values:[[existing.observation_id]]},{updates:{updatedRows:1}}];
  const fetcher=async(url,options)=>{calls.push({url,options});const body=responses.shift();return {ok:true,headers:{get:()=>null},text:async()=>JSON.stringify(body)};};
  const store=createSheetsStore({spreadsheetId:'A'.repeat(24),fetcher,tokenProvider:async()=>'access-token'});
  const result=await store.append([existing,fresh,fresh]);
  assert.deepEqual(result,{attempted:3,inserted:1,duplicates:2});assert.equal(calls.length,3);
  const appended=JSON.parse(calls[2].options.body);assert.equal(appended.values.length,1);
  assert.equal(JSON.stringify(appended).includes('access-token'),false);
  assert.equal((await store.append([fresh])).inserted,0);
});

test('Bounded runner fetches once per sample, shares collector output, retries idempotently, and skips outside bands',async()=>{
  let current=NOW,fetches=0,collects=0,writes=0;
  const result=await runBoundedObservation({config:{runId:'run-1',sampleCount:2,intervalSec:30,maxRunSec:90,timeBands:[]},
    getRealtime:async()=>{fetches++;return {timestamp:current};},collector:{collect(){collects++;return [{observation_id:'same'}];}},
    store:{async append(){writes++;return writes===1?{inserted:1,duplicates:0}:{inserted:0,duplicates:1};}},
    clock:()=>current,sleep:async seconds=>{current+=seconds;},log:()=>{}});
  assert.deepEqual({fetches,collects,writes,samples:result.samples,inserted:result.inserted,duplicates:result.duplicates},
    {fetches:2,collects:2,writes:2,samples:2,inserted:1,duplicates:1});
  const skipped=await runBoundedObservation({config:{runId:'run-2',sampleCount:2,intervalSec:30,maxRunSec:90,timeBands:parseTimeBands('06:00-07:00')},
    getRealtime:async()=>{throw Error('should not fetch');},collector:{collect(){return[];}},store:{append:async()=>({inserted:0,duplicates:0})},clock:()=>NOW});
  assert.equal(skipped.status,'skipped');assert.equal(skipped.fetched,0);
});

test('Collector records route/origin separately, keeps GPS minimal, and derives departure only from continuous evidence',()=>{
  const collector=createObservationCollector({index:index(),positionStatic:position(),hashKey:HASH});
  const first=collector.collect({realtime:realtime(NOW,35),now:NOW,runId:'run-1',sampleIndex:0});
  assert.equal(first.length,1);assert.equal(first[0].observation_kind,'departure_position');assert.equal(first[0].origin_stop_id,'362_1');
  assert.equal(first[0].vehicle_hash.startsWith('veh_'),true);assert.equal(JSON.stringify(first[0]).includes('raw-vehicle'),false);
  assert.equal(first[0].departure_state,'departure_overdue');assert.equal(first[0].evidence_type,null);
  assert.equal(first[0].position_reason,'route_geometry_unavailable');assert.equal(first[0].position_segment_key,null);
  collector.collect({realtime:realtime(NOW+20,35.0012),now:NOW+20,runId:'run-1',sampleIndex:1});
  const last=collector.collect({realtime:realtime(NOW+40,35.0016),now:NOW+40,runId:'run-1',sampleIndex:2})[0];
  assert.equal(last.departure_state,'departed');assert.equal(last.evidence_type,'gps_origin_passed');assert.equal(last.censored,false);
  assert.equal(last.elapsed_from_scheduled_sec,100);
});

test('Observation image and build stay separate from the Bus API and never deploy or receive build secrets',()=>{
  const apiDocker=readFileSync(new URL('../Dockerfile',import.meta.url),'utf8');
  const jobDocker=readFileSync(new URL('../observation/Dockerfile',import.meta.url),'utf8');
  const build=readFileSync(new URL('../observation/cloudbuild.yaml',import.meta.url),'utf8');
  const dockerIgnore=readFileSync(new URL('../.dockerignore',import.meta.url),'utf8');
  const gcloudIgnore=readFileSync(new URL('../.gcloudignore',import.meta.url),'utf8');
  assert.equal(apiDocker.includes('observation/'),false);
  assert.match(jobDocker,/observation\/job\.js/);assert.doesNotMatch(jobDocker,/runtime\/start\.js|http\/handler/);
  for(const ignore of [dockerIgnore,gcloudIgnore]) {
    assert.match(ignore,/!providers\/kawasaki\/departure\.js/);
    assert.match(ignore,/observation\/node_modules\/\*\*/);
  }
  assert.doesNotMatch(build,/gcloud\s+run|jobs\s+(create|update|execute)|availableSecrets|secretEnv|--set-secrets/);
  assert.match(build,/OBSERVATION_IMAGE_SMOKE_PASS/);
});

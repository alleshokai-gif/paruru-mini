'use strict';
const assert=require('assert'),crypto=require('crypto'),fs=require('fs'),path=require('path'),vm=require('vm');
const source=fs.readFileSync(path.join(__dirname,'..','gas-bus-observation','BusObservationCalibration.js'),'utf8');
const context={Map,Set,Object,Array,String,Number,Boolean,JSON,Math,Date,Error,
  Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest(algorithm,value){return [...crypto.createHash(algorithm).update(value).digest()];},
    formatDate(value,timeZone,pattern){assert.strictEqual(timeZone,'Asia/Tokyo');assert.strictEqual(pattern,'yyyy-MM-dd');return new Date(value.getTime()+9*60*60*1000).toISOString().slice(0,10);}}};
vm.createContext(context);vm.runInContext(source,context);
const headers=vm.runInContext('BUS_OBSERVATION_RAW_HEADERS.slice()',context),daily=vm.runInContext('BUS_OBSERVATION_DAILY_HEADERS.slice()',context);
const aggregate=(values,date='2026-09-14')=>context.aggregateBusObservationRows_(values,date,'2026-09-15T01:10:00+09:00');
const row=overrides=>{
  const value=Object.assign({observation_id:'obs_'+crypto.randomBytes(16).toString('hex'),run_id:'run',sample_index:0,
    observation_kind:'departure_position',observed_at:'2026-09-14T15:01:00+09:00',provider:'kawasaki',direction_id:'noborito_to_home',
    route_id:'10044',trip_id:'trip-1',service_date:'20260914',origin_stop_id:'362_1',platform:'登05のりば',
    scheduled_departure:'2026-09-14T15:00:00+09:00',evidence_type:'',departure_state:'departure_uncertain',
    elapsed_from_scheduled_sec:60,gps_age_sec:10,rt_age_sec:5,next_bus_gap_min:20,censored:true,vehicle_hash:'veh_x',gps_timestamp:1,
    position_lat:35,position_lon:139,position_state:'between_stops',position_confidence:.95,position_reason:'',previous_stop_id:'s1',next_stop_id:'s2',
    position_segment_key:'s1:s2',position_expected_segments:10,aux_stop_id:'',aux_stop_sequence:'',aux_status:''},overrides||{});
  return headers.map(name=>value[name]===undefined?'':value[name]);
};

const first=row({observation_id:'obs_'+'1'.repeat(32),trip_id:'positive',evidence_type:'gps_origin_passed',departure_state:'departed',elapsed_from_scheduled_sec:100,censored:false});
const duplicate=first.slice(),censored=row({observation_id:'obs_'+'2'.repeat(32),trip_id:'censored'});
const other=row({observation_id:'obs_'+'3'.repeat(32),trip_id:'other',route_id:'10032',origin_stop_id:'434_4',platform:'4番',direction_id:'mizonokuchi_to_home'});
const result=aggregate([headers,first,duplicate,censored,other]);
assert.strictEqual(result.length,2);const noborito=result.find(value=>value.route_id==='10044');
assert.strictEqual(noborito.raw_rows,3);assert.strictEqual(noborito.unique_observations,2);assert.strictEqual(noborito.positive_trips,1);
assert.strictEqual(noborito.censored_trips,1);assert.strictEqual(noborito.median_sec,100);assert.strictEqual(noborito.duplicate_rows,1);
assert.strictEqual(noborito.observed_segment_count,1);assert.strictEqual(noborito.expected_segment_count,10);assert.strictEqual(noborito.position_coverage,.1);
assert.strictEqual(noborito.calibration_ready,false);assert.strictEqual(noborito.candidate_overdue_sec,null);

const calibrated=[headers];for(let i=1;i<=20;i++)calibrated.push(row({observation_id:'obs_'+i.toString(16).padStart(32,'0'),trip_id:'p'+i,
  evidence_type:'gps_origin_passed',departure_state:'departed',elapsed_from_scheduled_sec:i,censored:false}));
calibrated.push(row({observation_id:'obs_'+'f'.repeat(32),trip_id:'censored-only'}));
const ready=aggregate(calibrated)[0];assert.strictEqual(ready.calibration_ready,false);assert.strictEqual(ready.p80_sec,16);
assert.strictEqual(ready.p90_sec,18);assert.strictEqual(ready.p95_sec,19);assert.strictEqual(ready.candidate_overdue_sec,null);
assert.strictEqual(ready.candidate_unknown_sec,null);
assert.strictEqual(JSON.stringify(daily.slice(-3)),JSON.stringify(['calibration_ready','candidate_overdue_sec','candidate_unknown_sec']));
assert.strictEqual(ready.departure_anomaly_rows,0);
const extra=row({observation_id:'obs_'+'e'.repeat(32),trip_id:'later-trip'}),rerun=aggregate(calibrated.concat([extra]))[0];
assert.strictEqual(rerun.summary_id,ready.summary_id);
const oldId='sum_'+'a'.repeat(32),oldDaily=daily.map(name=>Object.assign({},ready,{summary_id:oldId})[name]??'');
const plan=context.busObsPlanDailyUpsert_([rerun],[daily,oldDaily]);
assert.strictEqual(plan.updates.length,1);assert.strictEqual(plan.inserts.length,0);assert.strictEqual(plan.updates[0].rowNumber,2);
assert.strictEqual(plan.updates[0].summary.summary_id,oldId);
const dateCellDaily=oldDaily.slice();dateCellDaily[daily.indexOf('local_date')]=new Date('2026-09-14T00:00:00+09:00');
const dateCellPlan=context.busObsPlanDailyUpsert_([rerun],[daily,dateCellDaily]);
assert.strictEqual(dateCellPlan.updates.length,1);assert.strictEqual(dateCellPlan.inserts.length,0);
assert.strictEqual(dateCellPlan.updates[0].summary.summary_id,oldId);
assert.throws(()=>context.busObsPlanDailyUpsert_([rerun],[daily,oldDaily,oldDaily]),/OBSERVATION_DAILY_DUPLICATE_KEY/);
assert.throws(()=>aggregate([['wrong']]),/OBSERVATION_AGGREGATE_INPUT_INVALID/);
assert(!/departure\/policy|write.*production|setProperty\([^)]*DEPARTURE/i.test(source));
assert(/function runTodayBusObservationCalibration\(\)/.test(source));
assert(/function runWeekdayBusObservationCalibration\(\)/.test(source));
assert.strictEqual(context.busObsIsWeekday_('2026-09-14'),true);assert.strictEqual(context.busObsIsWeekday_('2026-09-13'),false);
assert(/atHour\(20\)\.nearMinute\(45\).*inTimezone\('Asia\/Tokyo'\)/s.test(source));
assert(/SpreadsheetApp\.getActiveSpreadsheet\(\)/.test(source));
assert(!/SpreadsheetApp\.openById\(/.test(source));
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'..','gas-bus-observation','appsscript.json'),'utf8'));
assert(manifest.oauthScopes.includes('https://www.googleapis.com/auth/spreadsheets.currentonly'));
assert(!manifest.oauthScopes.includes('https://www.googleapis.com/auth/spreadsheets'));
console.log('PASS Bus Observation GAS daily grouping, dedupe, percentile, coverage, and calibration isolation');

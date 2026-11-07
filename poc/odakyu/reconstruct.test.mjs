import test from 'node:test';
import assert from 'node:assert/strict';
import { reconstructTrips } from './reconstruct.mjs';
// Synthetic legs only: no real provider rows or acquisition are introduced.
const artifact={sample:false,timezone:'Asia/Tokyo',sourceCheckedAt:'2026-10-27T00:00:00Z',sourceDates:{weekday:'2026-10-27'},legs:[{
 segment:'configured-leg',trainId:'synthetic-only',calendarType:'weekday',trainType:'各停',source:'Odakyu official train detail',stationTimeSource:'arrival',departure:'10:00',stationTime:'10:02',destination:'架空終点'}]};
const model={stations:[{id:'Noborito',index:17},{id:'MukogaokaYuen',index:18}],departures:[{calendar:'Weekday',station:'Noborito',type:'Local',destinationName:'架空終点',time:600,isOrigin:true}]};
test('保存区間設定で遊園を含む明示着発を扱い、固定3区間の変更を要求しない',()=>{
 const p=reconstructTrips(artifact,model,{segments:{'configured-leg':['Noborito','MukogaokaYuen']}});
 assert.equal(p.trips[0].stops[1].station,'MukogaokaYuen');assert.equal(p.trips[0].stops[1].arrival,602);assert.equal(p.report.departureChecks,1);assert.ok(p.report.coverage.includes('MukogaokaYuen'));
 assert.equal(reconstructTrips(artifact,model).trips.length,0);
});
test('不正な区間設定や未知駅を時刻補間で埋めない',()=>{
 assert.throws(()=>reconstructTrips(artifact,model,{segments:{'configured-leg':['Noborito','Noborito']}}));
 assert.throws(()=>reconstructTrips(artifact,model,{segments:{'configured-leg':['Noborito','Unknown']}}));
});

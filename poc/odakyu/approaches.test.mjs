import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadModel} from './model.mjs';
import {listSnapshots} from './storage.mjs';
import {planNavigation} from './navigation.mjs';
import {savedApproaches} from './approaches.mjs';
import {DOWNBOARD as B,UEHARA_THROAT as U,DOWN_SWITCHES,downRails,railX,trainMarker} from './downbound-board.mjs';
const model=await loadModel((await listSnapshots())[0]),pool=model.trips.filter(t=>t.calendar==='Weekday');
const reference=pool.find(t=>t.id===model.example.selectedId),rapid=planNavigation(pool,reference.id,'Noborito',model.example.compareAt).recommendation;
const inbound=pool.find(t=>t.approach?.terminatesAtUehara&&t.stops.at(-1).arrival>=model.example.compareAt
  &&t.stops.at(-1).arrival<=rapid.legs[0].departure-6);
const now=inbound.stops.at(-1).arrival-1;

test('保存Metro441便の便ID・カレンダー・日比谷発・上原着が一致し、小田急と同一便結合しない',()=>{
  assert.equal(model.approachCoverage.accepted,441);assert.equal(model.approachCoverage.intermediateMatched,441);
  assert.equal(model.approachCoverage.sameTrainLinks,0);assert.equal(model.approachCoverage.shinjukuAccepted,0);
  assert.equal(new Set(model.trips.map(t=>t.id)).size,model.trips.length);
  for(const t of model.trips.filter(t=>t.approach)) {
    assert.equal(t.boundary.identity,'unknown');assert.equal(t.continuation,undefined);
    assert.ok(Number.isInteger(t.stops.at(-1).arrival));
    assert.ok(t.stops.slice(0,-1).every(s=>s.arrival===null)); // departures are not manufactured arrivals
  }
});
test('上原前の実便から到着時刻基準で快速急行と快急なしを比較し、乗換を明示する',()=>{
  const fast=planNavigation(pool,inbound.id,'Noborito',now),calm=planNavigation(pool,inbound.id,'Noborito',now,{avoidRapidExpress:true});
  assert.ok(now<inbound.stops.at(-1).arrival);
  assert.equal(fast.status,'TRANSFER_REQUIRED');assert.equal(fast.baseline,null);assert.equal(fast.recommendation.saving,null);
  const leg=fast.recommendation.legs[0];
  assert.equal(leg.station,'YoyogiUehara');assert.equal(leg.timingBasis,'arrival');
  assert.equal(leg.alightTime,inbound.stops.at(-1).arrival);assert.equal(leg.connection.status,'likely');
  assert.ok(calm.recommendation.arrival>fast.recommendation.arrival);
  assert.ok(calm.recommendation.legs.every(l=>pool.find(t=>t.id===l.trainId).type!=='RapidExpress'));
  const waiting=planNavigation(pool,inbound.id,'Noborito',inbound.stops.at(-1).arrival+1);
  assert.equal(waiting.recommendation.arrival,fast.recommendation.arrival);
  assert.equal(waiting.recommendation.legs[0].connection.gapMinutes,leg.departure-inbound.stops.at(-1).arrival-1);
  assert.equal(trainMarker(inbound,inbound.stops.at(-1).arrival+1,model.stations),null);
  assert.equal(planNavigation(pool,inbound.id,'MukogaokaYuen',now).recommendation,null);
});
test('小田急方面の行先でも直通未照合なら継続到着を作らず、明示した乗換案だけを比較する',()=>{
  const through=pool.find(t=>t.approach&&!t.approach.terminatesAtUehara&&t.stops.at(-1).arrival>=model.example.compareAt);
  const plan=planNavigation(pool,through.id,'Noborito',through.stops.at(-1).arrival-1);
  assert.equal(plan.onwardUnknown,true);assert.equal(plan.baseline,null);assert.equal(plan.rideContinuations.length,0);
  assert.ok(!plan.recommendation||plan.recommendation.transfers>0&&plan.recommendation.saving===null);
});
test('進入元・1/2番線・小田原方を分離し、正本の下り渡り線だけを駅の先へ描く',()=>{
  const paths=downRails();
  assert.deepEqual(paths.find(p=>p.id==='shinjuku-approach').points.at(-1),[U.platform1X,B.uehara]);
  assert.deepEqual(paths.find(p=>p.id==='chiyoda-approach').points.at(-1),[U.platform2X,B.uehara]);
  assert.ok(U.platform2X<U.platform1X);
  for(const s of DOWN_SWITCHES.filter(s=>s.station==='YoyogiUehara'))assert.ok(s.fromY>U.platformEnd&&s.toY<U.exit);
  assert.equal(railX('express',U.cross),U.connectorX);assert.equal(railX('local',U.cross),U.platform1X);
  const m=trainMarker(inbound,now,model.stations);
  assert.equal(m.track.id,'chiyoda-approach');assert.equal(m.observed,false);
  assert.equal(trainMarker(inbound,inbound.stops.at(-1).arrival,model.stations).track.id,'platform-2');
  const unknown=trainMarker(reference,reference.stops[0].departure,model.stations);
  assert.equal(unknown.track.id,'uehara-unassigned');assert.notEqual(unknown.x,U.platform1X);assert.notEqual(unknown.x,U.platform2X);
});
test('既存5分短縮、成城で待つと遅い実便、快急回避のそのまま乗車を維持する',()=>{
  const start=reference.stops[0].departure,fast=planNavigation(pool,reference.id,'Noborito',start);
  const calm=planNavigation(pool,reference.id,'Noborito',start,{avoidRapidExpress:true});
  assert.equal(fast.recommendation.saving,5);assert.equal(calm.recommendation.transfers,0);
  const seijo=reference.stops.find(s=>s.station==='SeijogakuenMae');
  const atStation=planNavigation(pool,reference.id,'Noborito',seijo.arrival);
  assert.equal(atStation.recommendation.transfers,0);
  assert.ok(atStation.alternatives.some(a=>a.connection==='likely'&&a.saving<0&&a.legs[0].station===seijo.station));
});
test('異なるMetro ID・カレンダー・着発は補間や近接時刻で同一便にしない',async()=>{
  const artifact=JSON.parse(await readFile(new URL('../../bus/release-static/kazu-commute-static.json',import.meta.url),'utf8'));
  const result=savedApproaches(artifact,{fetchedAt:artifact.sourceCheckedAt,rows:[]});
  assert.equal(result.report.intermediateMatched,0);assert.equal(result.trips.length,441);
  assert.ok(result.trips.every(t=>t.stops.length===2&&!t.continuation));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadModel} from './model.mjs';import {listSnapshots} from './storage.mjs';
import {compareAll} from './comparisons.mjs';
import {createBoardBusSource} from './bus-source.mjs';
import {busConnections} from './home-bus.mjs';
const model=await loadModel((await listSnapshots())[0]),pool=model.trips.filter(t=>t.calendar==='Weekday');
const rider=pool.find(t=>t.id===model.example.selectedId),minute=rider.stops[0].departure;
const c=compareAll(pool,rider,minute),p=c.plans.find(p=>p.destination==='Noborito');
const snapshot=await createBoardBusSource()({serviceDate:rider.sourceServiceDate,minute});
test('既存BUSの保存実ダイヤを再利用し、鉄道が5分早くても同じバスになる実例を比較',()=>{
  const a=busConnections(snapshot,'Noborito',p.baseline.arrival),b=busConnections(snapshot,'Noborito',p.recommendation.arrival);
  assert.equal(a.status,'available');assert.equal(b.status,'available');assert.equal(a.options[0].tripId,b.options[0].tripId);
  assert.equal(b.options[0].waitMinutes-a.options[0].waitMinutes,5);assert.equal(a.options[0].homeArrivalAt,b.options[0].homeArrivalAt);
  assert.equal(a.options[0].walkMeasured,false);assert.equal(a.options[0].guaranteed,false);
});
test('実便の遅着案で徒歩余裕の不足を区別し、遊園の欠測・古い取得を推奨にしない',()=>{
  const late=c.routes.find(r=>r.savings.Noborito===-1),result=busConnections(snapshot,'Noborito',late.arrivals.Noborito);
  assert.equal(result.options[0].connection,'tight');assert.ok(result.options.length>1);
  assert.equal(busConnections(snapshot,'MukogaokaYuen',undefined).status,'rail_arrival_missing');
  assert.equal(busConnections(snapshot,'Noborito',p.baseline.arrival,{wallNow:snapshot.fetchedAt+snapshot.maxAgeSec+1}).status,'stale');
  assert.equal(busConnections({error:true},'Noborito',p.baseline.arrival).options.length,0);
});
test('異なる保存BUS版を混ぜず、取得できない多摩川口・東急が登05を消さない',()=>{
  assert.ok(snapshot.buses.some(b=>b.queryId==='noborito_to_home'));
  assert.ok(snapshot.unavailableSources.includes('kawasaki:noborito_tamagawa_to_kibukihoncho'));
  assert.ok(snapshot.unavailableSources.includes('tokyu:mukougaoka_to_kibukihoncho'));
  assert.equal(snapshot.live.state,'simulation');
});
// Replay the actual, ignored PALURU API response at its own clock. This is
// historical integration evidence, not fresh realtime in the running UI.
test('保存した実APIレスポンスの便ID・運行日・停留所を厳密照合し、失敗時は実測を残さない',async t=>{
  let stored;try{stored=JSON.parse(await readFile(new URL('./data/bus-journey-live.json',import.meta.url),'utf8'));}catch(e){if(e.code==='ENOENT'){t.skip('ローカル実API記録が未配置');return;}throw e;}
  const body=stored.body,wall=body.generatedAt,date=new Date((wall+9*3600)*1000).toISOString(),serviceDate=date.slice(0,10),minute=Number(date.slice(11,13))*60+Number(date.slice(14,16));
  const success=await createBoardBusSource({clock:()=>wall,fetcher:async()=>({ok:true,json:async()=>body})})({serviceDate,minute});
  assert.ok(success.live.matched>0);const live=success.buses.filter(b=>b.departureState==='realtime');assert.ok(live.length>0);
  assert.ok(live.every(b=>Number.isFinite(b.observedAt)&&body.children.some(c=>c.decisionGroup?.arrivals.some(r=>r.id===`${b.provider}:${b.tripId}`))));
  const failed=await createBoardBusSource({clock:()=>wall,fetcher:async()=>{throw Error('OFFLINE');}})({serviceDate,minute});
  assert.equal(failed.live.state,'unavailable');assert.ok(failed.buses.length);assert.ok(failed.buses.every(b=>b.departureState!=='realtime'));
});

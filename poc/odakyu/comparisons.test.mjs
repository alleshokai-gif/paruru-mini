import test from 'node:test';
import assert from 'node:assert/strict';
import {loadModel} from './model.mjs';
import {listSnapshots} from './storage.mjs';
import {compareAll,upcomingDepartures,pathsForTrain} from './comparisons.mjs';
const model=await loadModel((await listSnapshots())[0]),pool=model.trips.filter(t=>t.calendar==='Weekday');
const rider=pool.find(t=>t.id===model.example.selectedId),now=rider.stops[0].departure;
const compared=compareAll(pool,rider,now);
test('保存実便の全候補に早着・遅着・快急回避・2回乗換を残し、接続困難は入れない',()=>{
  assert.ok(compared.routes.length>8);
  for(const predicate of [r=>r.savings.Noborito>0,r=>r.savings.Noborito<0,r=>!r.usesRapidExpress,r=>r.transfers===2,r=>r.connection==='tight'])assert.ok(compared.routes.some(predicate));
  for(const r of compared.routes){assert.ok(r.transfers<=2);assert.ok(r.legs.every(l=>l.connection.status!=='difficult'));}
  assert.equal(compared.plans.find(p=>p.destination==='Noborito').recommendation.saving,5);
  assert.ok(compared.routes.every(r=>r.arrivals.MukogaokaYuen===undefined));
});
test('同じ列車でも上原発と成城発のイベントを混同せず、2回乗換の経由便を維持する',()=>{
  const seijo=compared.routes.find(r=>r.transfers===1&&r.legs[0].station==='SeijogakuenMae');assert.ok(seijo);
  const l=seijo.legs[0],choices=pathsForTrain(compared.routes,l.trainId,{station:l.station,departure:l.departure});
  assert.ok(choices.length);assert.ok(choices.every(r=>r.legs.some(x=>x.trainId===l.trainId&&x.station===l.station&&x.departure===l.departure)));
  const two=compared.routes.find(r=>r.transfers===2),second=two.legs[1];
  const via=pathsForTrain(compared.routes,second.trainId,{station:second.station,departure:second.departure},two);
  assert.ok(via.some(r=>r.key===two.key));assert.ok(via.every(r=>r.legs[0].trainId===two.legs[0].trainId&&r.transfers===2));
});
test('日比谷で次便を待つ比較は実便のまま、上原での乗換と直通未照合を分ける',()=>{
  const inbound=pool.find(t=>t.approach?.terminatesAtUehara&&t.stops.at(-1).arrival>=model.example.compareAt&&t.stops.at(-1).arrival<=compared.plans[0].recommendation.legs[0].departure-6);
  const c=compareAll(pool,inbound,inbound.stops[0].departure),waiting=c.routes.filter(r=>r.originWait);
  assert.ok(waiting.length);assert.equal(c.plans[0].baseline,null);
  for(const r of waiting){assert.notEqual(r.startTrainId,inbound.id);assert.equal(r.legs[0].station,'YoyogiUehara');assert.equal(r.savings.Noborito,null);assert.ok(!pool.find(t=>t.id===r.startTrainId).continuation);}
});
test('新宿の駅別発時刻は選択可能な参照で、未照合の便結合・着時刻を作らない',()=>{
  const events=upcomingDepartures(model,pool,now).filter(t=>t.origin==='Shinjuku');assert.equal(events.length,3);
  for(const e of events){assert.equal(e.identityBasis,'station_departure');assert.equal(e.stops.length,1);assert.equal(e.stops[0].arrival,null);assert.deepEqual(compareAll(pool,e,now).routes,[]);}
});

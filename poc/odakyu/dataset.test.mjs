import test from 'node:test';
import assert from 'node:assert/strict';
import { demoModel } from './demo.mjs';
import { validateDataset, datasetModel } from './dataset.mjs';
import { planNavigation, scheduledPosition } from './navigation.mjs';
const model = demoModel();
const envelope = () => ({schemaVersion:1,id:model.dataset.id,kind:'demo',timezone:'Asia/Tokyo',rights:{status:'synthetic'},stations:model.stations,trips:model.trips});
const run = (suffix, dest='MukogaokaYuen', list=model.trips) => planNavigation(list,'demo:Weekday:'+suffix,dest,549);
test('デモは全人工・平土休日・実運行不可として独立正規化される',()=>{
 assert.equal(model.dataset.kind,'demo'); assert.equal(model.dataset.dailyReady,false); assert.equal(model.trips.length,16);
 assert.ok(model.trips.every(t=>t.id.startsWith('demo:')&&t.dataKind==='demo')); assert.equal(model.capabilities.realtimePosition,false);
});
test('新宿発の継続乗車と遊園までの2回乗換を到着比較する',()=>{
 const p=run('local'); assert.equal(p.baseline.arrival,600); assert.equal(p.recommendation.arrival,578);
 assert.equal(p.recommendation.transfers,2); assert.equal(p.recommendation.saving,22);
 assert.deepEqual(p.recommendation.legs.map(l=>l.station),['YoyogiUehara','Noborito']);
 assert.equal(run('local','Noborito').recommendation.arrival,568);
});
test('快速急行の遊園通過と登戸での停車列車への乗換を区別する',()=>{
 const p=run('rapid'); assert.equal(p.status,'TRANSFER_REQUIRED'); assert.equal(p.baseline,null);
 assert.equal(p.recommendation.arrival,578); assert.equal(p.recommendation.saving,null);
 assert.equal(p.recommendation.legs[0].station,'Noborito');
});
test('直通境界の明示リンク・種別変更は乗換0回、同着の2回乗換より継続を優先',()=>{
 const p=run('through-in'); assert.equal(p.baseline.continuations.length,1);
 assert.equal(p.baseline.arrival,578); assert.equal(p.recommendation.transfers,0);
 assert.equal(p.recommendation.id,'stay');
 const next=model.trips.find(t=>t.id==='demo:Weekday:through-out'); assert.equal(next.type,'Express');
 assert.equal(scheduledPosition(next,560).observed,false);
});
test('直通同定不明は近接する発時刻があっても同一列車へ自動結合しない',()=>{
 const p=run('unidentified'); assert.equal(p.status,'ARRIVAL_UNAVAILABLE'); assert.equal(p.baseline,null); assert.equal(p.recommendation,null);
 const bad=envelope(); bad.trips=structuredClone(bad.trips); bad.trips.find(t=>t.id==='demo:Weekday:unidentified').continuation={station:'YoyogiUehara',nextTripId:'demo:Weekday:through-out',evidence:'explicit_same_train'};
 assert.throws(()=>validateDataset(bad));
});
test('同一IDの別データセットを候補へ混ぜず、別モードの偽の早着を無視する',()=>{
 const alien=structuredClone(model.trips.find(t=>t.id==='demo:Weekday:express')); alien.id='other'; alien.datasetId='another'; alien.dataKind='additional';
 alien.stops.at(-1).arrival=570;
 const original=run('local'), mixed=run('local','MukogaokaYuen',[...model.trips,alien]);
 assert.equal(mixed.recommendation.arrival,original.recommendation.arrival);
});
test('土休日のデモは同じ平日IDを使わずそのカレンダーだけで計算',()=>{
 const p=planNavigation(model.trips,'demo:SaturdayHoliday:local','MukogaokaYuen',549);
 assert.equal(p.recommendation.arrival,578); assert.ok(p.recommendation.legs.every(l=>l.trainId.includes('SaturdayHoliday')));
});
test('時刻矛盾・停車通過矛盾・重複ID・循環継続を正規化入口で拒否する',()=>{
 for(const edit of [d=>d.trips.push(d.trips[0]),d=>d.trips[0].stops[1].departure=1,
  d=>d.trips[0].knownPasses.push('Noborito'),d=>d.trips[0].stops[1].stop=false,
  d=>d.trips.find(t=>t.id==='demo:Weekday:through-out').continuation={station:'MukogaokaYuen',nextTripId:'demo:Weekday:through-in',evidence:'explicit_same_train'}]){
   const d=structuredClone(envelope());edit(d);assert.throws(()=>validateDataset(d));
 }
});
test('追加データは利用条件の記録・有効期限なしでは受理せずデモへ黙って戻さない',()=>{
 const d=structuredClone(envelope());d.kind='additional';d.id='test-additional';d.trips=d.trips.filter(t=>!t.continuation).map(t=>({...t,id:t.id.replace('demo:','test:')}));
 assert.throws(()=>datasetModel(d),/RIGHTS/);
 d.rights={status:'confirmed',useScope:'local-only',evidenceRef:'unit test declaration only',validUntil:'2100-01-01T00:00:00Z'};
 assert.equal(datasetModel(d).dataset.kind,'additional');
 d.rights.validUntil='2000-01-01T00:00:00Z';assert.throws(()=>datasetModel(d),/RIGHTS/);
});

test('直通境界で快速急行へ種別変更した場合も遊園通過を継続先の明示情報で判定',()=>{
 const d=structuredClone(envelope());d.trips=d.trips.filter(t=>['demo:Weekday:through-in','demo:Weekday:through-out'].includes(t.id));
 const out=d.trips.find(t=>t.id==='demo:Weekday:through-out');out.type='RapidExpress';out.stops=out.stops.filter(s=>['YoyogiUehara','Noborito'].includes(s.station));out.knownPasses=['SeijogakuenMae','MukogaokaYuen'];
 const normalized=datasetModel(d);const p=run('through-in','MukogaokaYuen',normalized.trips);
 assert.equal(p.status,'TRANSFER_REQUIRED');assert.equal(p.baseline,null);assert.equal(p.rideContinuations.length,1);assert.equal(p.recommendation,null);
});

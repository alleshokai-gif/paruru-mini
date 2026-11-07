import test from 'node:test';
import assert from 'node:assert/strict';
import { matchTCode, REVIEW_SCOPE } from './tcode.mjs';
import { loadModel } from './model.mjs';
import { listSnapshots } from './storage.mjs';
import { connectionDemoModel } from './demo.mjs';
import { planNavigation } from './navigation.mjs';

test('5コードは保存版の便IDに一意対応するが、異なる運行日の新規時刻へ統合しない',async()=>{
 const m=await loadModel((await listSnapshots())[0]);assert.equal(m.trips.filter(t=>!t.approach).length,695);
 assert.equal(m.tCodeReferences.length,5);
 for(const r of m.tCodeReferences){assert.equal(r.status,'unique_reference');assert.equal(r.count,1);
  assert.equal(r.serviceDate,'2026-10-27');assert.equal(r.sourceServiceDate,'2026-09-30');assert.equal(r.sameServiceDate,false);
  assert.equal(r.referenceOnly,true);assert.equal(r.operatingTrainNumber,null);
  const u=new URL(r.url);assert.equal(u.hostname,'transfer.navitime.biz');assert.equal(u.searchParams.get('tCode'),r.tCode);
  assert.equal(u.searchParams.get('datetime').slice(0,10),r.serviceDate);
  const t=m.trips.find(t=>t.id===r.tripId);assert.equal(t.sourceTrainId,`odakyu-${r.tCode}`);
  assert.ok(!t.stops.some(s=>s.station==='MukogaokaYuen'&&s.arrival!==null));
 }
});
test('版・カレンダー違いと重複候補を近接時刻で救済せず、不正日付を拒否する',()=>{
 const t={id:'fixture',identityBasis:'provider_id',sourceTrainId:'odakyu-81ff0057',calendar:'Weekday',checkedAt:'2026-09-30T00:00:00Z',sourceServiceDate:'2026-09-30',origin:'YoyogiUehara',type:'Local',stops:[{departure:476}]};
 const q={tCode:REVIEW_SCOPE.codes[0],serviceDate:REVIEW_SCOPE.serviceDate,calendar:'Weekday',revision:t.checkedAt};
 assert.equal(matchTCode([t,t],q).status,'ambiguous');assert.equal(matchTCode([t,t],q).url,undefined);
 assert.equal(matchTCode([t],{...q,revision:'2026-10-01T00:00:00Z'}).status,'unmatched');
 assert.equal(matchTCode([t],{...q,calendar:'SaturdayHoliday'}).status,'unmatched');
 assert.throws(()=>matchTCode([t],{...q,serviceDate:'2026-02-31'}));
 assert.throws(()=>matchTCode([t],{...q,tCode:'81ff0057&x=y'}));
});
test('人工の接続5分・到着差7分は、経路不明ならギリギリ、同ホーム確認で接続見込み',()=>{
 const m=connectionDemoModel();const run=options=>planNavigation(m.trips,m.example.selectedId,'MukogaokaYuen',m.example.compareAt,options);
 assert.equal(m.dataset.kind,'demo');assert.ok(m.trips.every(t=>t.id.startsWith('demo:')&&!t.sourceTrainId.includes('81ff')));
 const unknown=run({});assert.equal(unknown.baseline.arrival,752);assert.equal(unknown.recommendation.transfers,0);
 assert.equal(unknown.bestConditional.arrival,745);assert.equal(unknown.bestConditional.saving,7);assert.equal(unknown.bestConditional.connection,'tight');
 const same=run({stationConditions:{YoyogiUehara:'same_platform'}});assert.equal(same.recommendation.saving,7);
 assert.equal(same.recommendation.legs[0].station,'YoyogiUehara');assert.equal(same.recommendation.legs[0].connection.gapMinutes,5);
 assert.equal(same.recommendation.connection,'likely');assert.equal(same.recommendation.legs[0].connection.guaranteed,false);
 const slow=run({extraMinutes:6});assert.equal(slow.recommendation.transfers,0);assert.ok(slow.difficult.length);
});

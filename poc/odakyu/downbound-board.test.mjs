import test from 'node:test';
import assert from 'node:assert/strict';
import {loadModel} from './model.mjs';
import {listSnapshots} from './storage.mjs';
import {TRACK_PATHS} from './track-board.mjs';
import {planNavigation} from './navigation.mjs';
import {DOWNBOARD as B,DOWN_STATIONS,DOWN_SWITCHES,downRails,inferredTrack,railX,trainMarker,visibleTrains,layoutMarkers,tapTrain} from './downbound-board.mjs';
const model=await loadModel((await listSnapshots())[0]),pool=model.trips.filter(t=>t.calendar==='Weekday');
const ref=model.example,selected=pool.find(t=>t.id===ref.selectedId);
const departure=t=>t.stops[0].departure??t.stops[0].arrival;
function section(y){const xs=[];for(const r of downRails())for(let i=1;i<r.points.length;i++){const [a,b]=[r.points[i-1],r.points[i]];if(y>=a[1]&&y<b[1])xs.push(a[0]+(b[0]-a[0])*(y-a[1])/(b[1]-a[1]));}return [...new Set(xs)];}

test('別便タップは乗車便を保持し、候補再タップで乗車変更、乗車便再タップで解除する',()=>{
  let state=tapTrain({},'rider');
  state=tapTrain(state,'candidate');assert.deepEqual(state,{selectedId:'rider',candidateId:'candidate'});
  state=tapTrain(state,'other');assert.deepEqual(state,{selectedId:'rider',candidateId:'other'});
  state=tapTrain(state,'other');assert.deepEqual(state,{selectedId:'other',candidateId:null});
  state=tapTrain(state,'rider');state=tapTrain(state,'other');
  assert.deepEqual(state,{selectedId:null,candidateId:null});
});

test('下り基本2線、登戸以西1線、遊園構内だけ2線、先で再合流する',()=>{
  for(const y of [160,240,350,500,650,740])assert.equal(section(y).length,2);
  assert.equal(section(810).length,1);assert.equal(section(900).length,2);assert.equal(section(1000).length,1);
  assert.equal(railX('express',810),railX('local',810));
});
test('渡り線は添付配線の下り2線間だけに限定し、上り・検車区・立体交差を混ぜない',()=>{
  assert.equal(DOWN_SWITCHES.length,6);
  for(const s of DOWN_SWITCHES){const source=TRACK_PATHS.find(p=>p.id===s.source);assert.equal(source?.kind,'switch');assert.ok(!/depot|lower|grade|inner/.test(s.source));}
  assert.deepEqual(DOWN_SWITCHES.filter(s=>s.station==='SeijogakuenMae').map(s=>[s.from,s.to]),[['express','local']]);
});
test('既存実便5分比較を維持し、未来の便を線路上へ架空配置しない',()=>{
  const plan=planNavigation(pool,selected.id,'Noborito',ref.compareAt);assert.equal(plan.recommendation.saving,5);
  const partners=plan.recommendation.legs.map(l=>l.trainId),trains=visibleTrains(pool,selected,ref.compareAt,partners);
  assert.ok(!trains.some(t=>t.id===partners[0]));assert.equal(trainMarker(selected,ref.compareAt,model.stations),null);
  const marker=trainMarker(selected,departure(selected),model.stations);
  assert.equal(marker.observed,false);assert.equal(marker.track.confidence,'low');
  assert.equal(marker.identityBasis,'provider_id');assert.equal(marker.identityConfidence,'provider_static');assert.equal(inferredTrack(selected).confidence,'unknown');
  assert.equal(planNavigation(pool,selected.id,'MukogaokaYuen',ref.compareAt).recommendation,null);
});
test('同線路の前後関係を維持し、見栄えのために定刻位置をずらさない',()=>{
  const locals=pool.filter(t=>t.type==='Local').map(t=>trainMarker(t,departure(selected)+1,model.stations)).filter(Boolean).slice(0,3);
  assert.equal(locals.length,3);const markers=layoutMarkers(locals);
  for(const m of markers)assert.equal(m.x,railX(m.track.id,m.displayY));
  for(const m of markers){assert.equal(m.y,m.displayY);assert.equal(m.displaced,false);}
  for(let i=1;i<markers.length;i++)assert.ok(markers[i-1].point.index<=markers[i].point.index);
});

test('実便は1分送りで移動し、成城の既知停車中は固定、着時刻以後は外挿しない',()=>{
  const a=trainMarker(selected,departure(selected),model.stations),b=trainMarker(selected,departure(selected)+1,model.stations);
  assert.ok(b.y>a.y);
  const stop=selected.stops.find(s=>s.arrival!==null&&s.departure>s.arrival);
  assert.ok(stop);let y;
  for(let now=stop.arrival;now<stop.departure;now++){
    const m=trainMarker(selected,now,model.stations);assert.equal(m.kind,'scheduled_dwell');
    if(y!==undefined)assert.equal(m.y,y);y=m.y;
  }
  assert.equal(trainMarker(selected,stop.departure,model.stations).y,y);
  assert.equal(trainMarker(selected,stop.departure,model.stations).kind,'scheduled_departure');
  assert.ok(trainMarker(selected,stop.departure+1,model.stations).y>y);
  const end=selected.stops.at(-1);assert.equal(trainMarker(selected,end.arrival,model.stations).kind,'scheduled_arrival');
  assert.equal(trainMarker(selected,end.arrival+1,model.stations),null);
  const incomplete={...selected,stops:selected.stops.map(s=>({...s,arrival:null}))};
  assert.equal(trainMarker(incomplete,departure(selected)+1,model.stations),null);
});

test('準急・通勤準急・不明転線・範囲外は線路未確定、位置・便識別とは別管理',()=>{
  for(const type of ['SemiExpress','CommuterSemiExpress','Unknown'])assert.equal(inferredTrack({...selected,type},{index:10}).id,null);
  assert.equal(inferredTrack(selected,{index:0}).id,null);
  assert.equal(inferredTrack({...selected,identityBasis:'hypothesis'},{index:10}).id,null);
  assert.equal(inferredTrack(selected,{index:18}).id,null);
  assert.equal(inferredTrack(selected,{index:17.65}).id,'single');
  assert.equal(inferredTrack(selected,{index:17.1}).id,null);
  assert.equal(inferredTrack(selected,{index:10},359).id,null);
  assert.equal(inferredTrack(selected,{index:10},1450).id,null);
  assert.equal(inferredTrack(selected,{index:10},500).id,'local');
});
test('既存平日便の前後切替と複数時点で、表示配置不能や架空の実測へ変換しない',()=>{
  for(const t of pool)for(const now of [ref.compareAt,Math.max(0,departure(t)-1),departure(t)+1]) {
    const markers=layoutMarkers(visibleTrains(pool,t,now).map(train=>trainMarker(train,now,model.stations)).filter(Boolean));
    assert.ok(markers.length<=3);assert.ok(markers.every(m=>!m.observed&&m.track.confidence==='low'&&Number.isFinite(m.displayY)));
  }
});

test('下北沢は急行・緩行の異なる地下階ホームで乗換候補として表示する',()=>{
  const shimokita=DOWN_STATIONS.find(s=>s.id==='ShimoKitazawa');
  assert.ok(shimokita);
  assert.ok(B.uehara<shimokita.y&&shimokita.y<B.kyodo);
  assert.ok(section(shimokita.y).length===2);
  assert.ok(!DOWN_SWITCHES.some(s=>s.station==='ShimoKitazawa')); // 駅内の階移動は渡り線ではない
  assert.ok(planNavigation(pool,selected.id,'Noborito',ref.compareAt));
});

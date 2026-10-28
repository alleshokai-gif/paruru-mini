import test from 'node:test';
import assert from 'node:assert/strict';
import {loadModel} from './model.mjs';
import {listSnapshots} from './storage.mjs';
import {TRACK_PATHS} from './track-board.mjs';
import {planNavigation} from './navigation.mjs';
import {DOWNBOARD as B,DOWN_SWITCHES,downRails,inferredTrack,railX,trainMarker,visibleTrains,layoutMarkers} from './downbound-board.mjs';
const model=await loadModel((await listSnapshots())[0]),pool=model.trips.filter(t=>t.calendar==='Weekday');
const ref=model.example,selected=pool.find(t=>t.id===ref.selectedId);
const departure=t=>t.stops[0].departure??t.stops[0].arrival;
function section(y){const xs=[];for(const r of downRails())for(let i=1;i<r.points.length;i++){const [a,b]=[r.points[i-1],r.points[i]];if(y>=a[1]&&y<b[1])xs.push(a[0]+(b[0]-a[0])*(y-a[1])/(b[1]-a[1]));}return [...new Set(xs)];}

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
test('既存実便5分比較を維持し、全アイコンの線路割当は低確度推定、位置未取得は発時刻イベント',()=>{
  const plan=planNavigation(pool,selected.id,'Noborito',ref.compareAt);assert.equal(plan.recommendation.saving,5);
  const partners=plan.recommendation.legs.map(l=>l.trainId),trains=visibleTrains(pool,selected,ref.compareAt,partners);
  assert.ok(trains.some(t=>t.id===partners[0]));assert.equal(trainMarker(selected,ref.compareAt,model.stations).kind,'departure');
  for(const t of trains){const marker=trainMarker(t,ref.compareAt,model.stations);assert.equal(marker.observed,false);assert.equal(marker.track.confidence,'low');assert.equal(inferredTrack(t).observed,false);}
  assert.equal(planNavigation(pool,selected.id,'MukogaokaYuen',ref.compareAt).recommendation,null);
});
test('同位置の複数実便も個別選択できる配置とし、固定線路から外さない',()=>{
  const locals=pool.filter(t=>t.type==='Local'&&t.stops[0].station==='YoyogiUehara'&&departure(t)>ref.compareAt).slice(0,3);
  assert.equal(locals.length,3);const markers=layoutMarkers(locals.map(t=>trainMarker(t,ref.compareAt,model.stations)));
  for(const m of markers)assert.equal(m.x,railX(m.track.id,m.displayY));
  for(let i=0;i<markers.length;i++)for(let j=i+1;j<markers.length;j++)assert.ok(Math.abs(markers[i].displayY-markers[j].displayY)>=32);
});
test('既存平日便の前後切替と複数時点で、表示配置不能や架空の実測へ変換しない',()=>{
  for(const t of pool)for(const now of [ref.compareAt,Math.max(0,departure(t)-1),departure(t)+1]) {
    const markers=layoutMarkers(visibleTrains(pool,t,now).map(train=>trainMarker(train,now,model.stations)).filter(Boolean));
    assert.ok(markers.length<=3);assert.ok(markers.every(m=>!m.observed&&m.track.confidence==='low'&&Number.isFinite(m.displayY)));
  }
});

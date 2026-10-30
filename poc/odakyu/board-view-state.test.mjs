import test from 'node:test';
import assert from 'node:assert/strict';
import {loadModel} from './model.mjs';
import {listSnapshots} from './storage.mjs';
import {compareAll,upcomingDepartures} from './comparisons.mjs';
import {visibleTrains,trainMarker} from './downbound-board.mjs';
import {buildBoardViewState,trainViewKey,boardGeometry,displayRailX} from './board-view-state.mjs';
import {DOWNBOARD as B} from './downbound-board.mjs';
const model=await loadModel((await listSnapshots())[0]),pool=model.trips.filter(t=>t.calendar==='Weekday');
const selected=pool.find(t=>t.id==='provider:Weekday:odakyu-81ff0062');
const comparison=compareAll(pool,selected,497);
const activeRoute=comparison.routes.find(r=>r.legs.length===1&&r.legs[0].trainId==='provider:Weekday:odakyu-81ff0067'&&r.legs[0].station==='YoyogiUehara');
function state(options={}){const now=options.now??497;return buildBoardViewState({serviceDate:'2026-10-30',pool,now,selected,comparison,activeRoute,
 actual:visibleTrains(pool,now,model.stations).map(t=>trainMarker(t,now,model.stations)),originChoices:upcomingDepartures(model,pool,now),...options});}
function unique(s){assert.equal(new Set(s.entities.map(e=>e.key)).size,s.entities.length);assert.equal(new Set(s.visible.map(e=>e.key)).size,s.visible.length);}

test('A/B/C: one date+train entity, exclusive role and one callout per selected train',()=>{
 const a=state({selected:null,comparison:compareAll(pool,null,497),activeRoute:null});unique(a);
 assert.ok(a.visible.length>2);assert.ok(a.entities.every(e=>e.role==='normal'&&!e.bubble));
 const b=state();unique(b);assert.equal(b.entities.filter(e=>e.role==='rider').length,1);assert.equal(b.entities.filter(e=>e.role==='compared').length,0);
 const c=state({comparisonRequested:true});unique(c);
 assert.equal(c.entities.filter(e=>e.role==='rider').length,1);assert.equal(c.entities.filter(e=>e.role==='compared').length,1);assert.equal(c.entities.filter(e=>e.bubble).length,2);
 assert.notEqual(trainViewKey(selected,'2026-10-30'),trainViewKey(selected,'2026-11-02'));
});
test('69 connection groups and all early/late paths remain data; a future train has no current position',()=>{
 const before=JSON.stringify(comparison),s=state({comparisonRequested:true});
 assert.equal(s.groups.length,69);assert.equal(s.groups.reduce((n,g)=>n+g.paths.length,0),comparison.routes.length);
 assert.ok(s.groups.some(g=>g.paths.some(r=>r.savings.Noborito<0)));assert.equal(JSON.stringify(comparison),before);
 const e=s.entities.find(e=>e.role==='compared');assert.equal(e.placement,'departure-planned');assert.equal(e.position,null);
 assert.equal(e.train.id,activeRoute.legs[0].trainId);assert.equal(activeRoute.savings.Noborito,5);
});
test('current position wins over every station reference and changes from planned at departure',()=>{
 const s=state({now:506,comparisonRequested:true});unique(s);
 const e=s.entities.find(e=>e.role==='compared');assert.ok(e.position);assert.equal(e.placement,'track-estimate');
 assert.deepEqual(e.position,trainMarker(e.train,506,model.stations));
 assert.equal(s.visible.filter(v=>v.train.id===e.train.id).length,1);
 const unknown=state().entities.find(e=>e.role==='rider');assert.equal(unknown.placement,'track-unknown');assert.equal(unknown.position.track.confidence,'unknown');
});
test('phone projection centers every supported train on its rail without changing schedule positions',()=>{
 const geometry=boardGeometry(374);assert.ok(geometry.local-geometry.express>200);
 for(const now of [497,506,512,513,1080]){
  const points=visibleTrains(pool,now,model.stations).map(t=>trainMarker(t,now,model.stations)),before=JSON.stringify(points);
  for(const point of points){
   const x=displayRailX(point,geometry);
   if(point.track.id==='uehara-unassigned'){assert.equal(x,null);continue;}
   assert.ok(Number.isFinite(x));
   if(point.y<=B.mergeStart)assert.equal(x,point.track.id==='single'?geometry.single:['express','platform-2','chiyoda-approach'].includes(point.track.id)?geometry.express:geometry.local);
   if(point.y>=B.mergeEnd)assert.equal(x,geometry.single);
  }
  assert.equal(JSON.stringify(points),before);
 }
 assert.equal(displayRailX(null,geometry),null);
 const rider=pool.find(t=>t.id===selected.id);
 const a=trainMarker(rider,512,model.stations),b=trainMarker(rider,513,model.stations);
 assert.equal(a.kind,'scheduled_dwell');assert.equal(a.y,b.y);assert.equal(displayRailX(a,geometry),geometry.local);assert.equal(displayRailX(b,geometry),geometry.local);
});

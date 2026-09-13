import test from 'node:test';
import assert from 'node:assert/strict';
import { createOriginEvidenceTracker } from '../departure/origin-evidence.js';
import { createDepartureConfidence } from '../departure/confidence.js';
import { indexFixture,NOW } from './fixtures.js';

const latitude=35,longitude=139,meters=1/(6371008.8*Math.PI/180),scale=Math.cos(latitude*Math.PI/180);
const point=x=>({lat:latitude,lon:longitude+x*meters/scale});
const index=()=>indexFixture();
const setup=()=>{
  const source=index(),row=source.directions.noborito_to_home[0],date='20260910';
  const vehicle=(timestamp,x,patch={})=>({vehicleId:'vehicle',trip:{tripId:row.tripId,startDate:date,routeId:row.routeId},
    timestamp,position:point(x),stopId:null,sequence:null,status:null,...patch});
  return {source,row,date,vehicle};
};

test('origin geofence requires continuous GPS before asserting at-origin or departure',()=>{
  const {row,date,vehicle}=setup(),tracker=createOriginEvidenceTracker(),originPosition=point(0);
  let result=tracker.observe({vehicle:vehicle(NOW,5),row,date,originPosition,now:NOW});
  assert.equal(result.supported,false);
  result=tracker.observe({vehicle:vehicle(NOW+10,6),row,date,originPosition,now:NOW+10});
  assert.equal(result.supported,false);
  result=tracker.observe({vehicle:vehicle(NOW+20,4),row,date,originPosition,now:NOW+20});
  assert.equal(result.state,'at_stop');assert.equal(result.originPassed,false);assert.equal(result.nextStop.id,row.originStopId);
  result=tracker.observe({vehicle:vehicle(NOW+30,120),row,date,originPosition,now:NOW+30});
  assert.equal(result.supported,false);
  result=tracker.observe({vehicle:vehicle(NOW+40,180),row,date,originPosition,now:NOW+40});
  assert.equal(result.state,'departed');assert.equal(result.originPassed,true);assert.ok(result.confidence>=0.95);
});

test('stale, missing, anonymous, conflicting and jumping GPS never become positive evidence',()=>{
  const {row,date,vehicle}=setup(),originPosition=point(0);
  for(const value of [
    {vehicle:vehicle(NOW,0),now:NOW+121},
    {vehicle:vehicle(NOW,0,{vehicleId:null}),now:NOW},
    {vehicle:vehicle(NOW,0,{position:{lat:null,lon:null}}),now:NOW}
  ])assert.equal(createOriginEvidenceTracker().observe({...value,row,date,originPosition}).supported,false);
  const conflict=createOriginEvidenceTracker();conflict.observe({vehicle:vehicle(NOW,0),row,date,originPosition,now:NOW});
  assert.equal(conflict.observe({vehicle:vehicle(NOW,20),row,date,originPosition,now:NOW}).reason,'gps_timestamp_conflict');
  const jump=createOriginEvidenceTracker();jump.observe({vehicle:vehicle(NOW,0),row,date,originPosition,now:NOW});
  assert.equal(jump.observe({vehicle:vehicle(NOW+1,500),row,date,originPosition,now:NOW+1}).reason,'gps_jump');
});

test('raw next-stop fields alone never prove departure',()=>{
  const {row,date,vehicle}=setup(),tracker=createOriginEvidenceTracker(),originPosition=point(0);
  for(let i=0;i<3;i++) {
    const result=tracker.observe({vehicle:vehicle(NOW+i*10,5,{stopId:'after',sequence:99,status:2}),row,date,originPosition,now:NOW+i*10});
    if(i===2)assert.equal(result.state,'at_stop');
  }
});

test('Departure Confidence connects fresh GPS evidence internally and never exposes identity through its decision',()=>{
  const {source,row,date,vehicle}=setup(),chainId='chain';
  const positionStatic={stops:{[row.originStopId]:{stopId:row.originStopId,name:'origin',position:point(0)},
    [row.toStopId]:{stopId:row.toStopId,name:'to',position:point(1000)}},
    trips:{[row.tripId]:{tripId:row.tripId,routeId:row.routeId,chainId}},
    chains:{[chainId]:{stops:[{stopId:row.originStopId,sequence:1},{stopId:row.toStopId,sequence:9}]}}};
  const confidence=createDepartureConfidence({index:source,positionStatic});
  const evaluate=now=>confidence.evaluate({row,date,scheduled:NOW-30,estimated:null,now,nextScheduled:NOW+600,
    feedFresh:true,tripActive:true,tripUpdate:null,vehicle:vehicle(now,now===NOW?5:now===NOW+10?120:180)});
  confidence.observe({realtime:{vehicles:[vehicle(NOW,5)],updates:[]},now:NOW});assert.notEqual(evaluate(NOW).state,'departed');
  confidence.observe({realtime:{vehicles:[vehicle(NOW+10,120)],updates:[]},now:NOW+10});assert.notEqual(evaluate(NOW+10).state,'departed');
  confidence.observe({realtime:{vehicles:[vehicle(NOW+20,180)],updates:[]},now:NOW+20});
  const result=evaluate(NOW+20);assert.equal(result.state,'departed');assert.equal(result.keep,false);
  assert.ok(!JSON.stringify(result).includes('vehicle'));
});

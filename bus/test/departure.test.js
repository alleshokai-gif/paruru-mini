import test from 'node:test';
import assert from 'node:assert/strict';
import { createOriginDepartureEngine,originGraceSeconds,originConfidenceWindows,
  DEPARTURE_PREDICTION_PUBLIC_ENABLED,DEPARTURE_STATES,DEPARTURE_ACTIONABILITY } from '../departure/engine.js';
import { getArrivals } from '../core/arrivals.js';
import { NOW,indexFixture,realtimeFixture,P0_INPUT } from './fixtures.js';

const date='20260910';
const row=()=>indexFixture().directions.home_to_noborito[0];
const input=(patch={})=>({row:row(),date,scheduled:NOW+240,estimated:null,now:NOW,
  nextScheduled:NOW+15*60,feedFresh:true,tripActive:true,...patch});
const engine=(policy={})=>createOriginDepartureEngine({policy});
const position=(patch={})=>({supported:true,confidence:0.96,tripId:row().tripId,startDate:date,
  observedAt:NOW,...patch});

test('state and actionability vocabularies are fixed; Static marks origins without assuming sequence one',()=>{
  assert.deepEqual(DEPARTURE_STATES,['scheduled','departure_pending','departure_overdue','departure_uncertain','departed','cancelled','unknown']);
  assert.deepEqual(DEPARTURE_ACTIONABILITY,['catchable','uncertain','do_not_recommend']);
  const index=indexFixture();
  for(const rows of Object.values(index.directions))for(const value of rows) {
    assert.equal(value.isOrigin,true);assert.equal(value.originStopId,value.fromStopId);
    assert.equal(value.originSequence,value.stopSequence);
  }
  const mid={...row(),isOrigin:false,originStopId:'before',originSequence:0};
  assert.equal(engine().evaluate(input({row:mid,now:NOW+600})),null);
});

test('confidence windows use headway, freshness and low-frequency risk rather than one fixed duration',()=>{
  const scheduled=NOW,nextScheduled=NOW+20*60;
  const low=originConfidenceWindows({scheduled,nextScheduled,feedFresh:true,tripUpdateFresh:true,vehicleFresh:true});
  const stale=originConfidenceWindows({scheduled,nextScheduled,feedFresh:false});
  const frequent=originConfidenceWindows({scheduled,nextScheduled:NOW+6*60,feedFresh:true,tripUpdateFresh:true,vehicleFresh:true});
  assert.equal(low.lowFrequency,true);assert.equal(frequent.lowFrequency,false);
  assert.ok(low.overdueSec<=90);assert.ok(stale.overdueSec<=60);
  assert.ok(stale.retentionSec<low.retentionSec);assert.notEqual(frequent.retentionSec,low.retentionSec);
});

test('origin progresses overdue to uncertain to unknown without claiming departure',()=>{
  const e=engine({overdueMinSec:60,overdueMaxSec:60,staleOverdueMaxSec:60,freshEvidenceBonusSec:0,
    minGraceSec:180,fallbackGraceSec:300,maxGraceSec:600,headwayMultiplier:1,staleRetentionRatio:1,
    lowFrequencyHeadwaySec:9999});
  let result=e.evaluate(input({scheduled:NOW-30,now:NOW,feedFresh:false,nextScheduled:NOW+270}));
  assert.equal(result.state,'departure_overdue');assert.equal(result.keep,true);assert.notEqual(result.state,'departed');
  result=e.evaluate(input({scheduled:NOW-30,now:NOW+61,feedFresh:false,nextScheduled:NOW+270}));
  assert.equal(result.state,'departure_uncertain');assert.equal(result.keep,true);assert.equal(result.actionability,'do_not_recommend');
  result=e.evaluate(input({scheduled:NOW-30,now:NOW+301,feedFresh:false,nextScheduled:NOW+270}));
  assert.equal(result.state,'unknown');assert.equal(result.keep,false);assert.equal(result.reason,'confidence_window_expired');
});

test('a future realtime estimate remains catchable after the scheduled origin time',()=>{
  const result=engine().evaluate(input({scheduled:NOW-60,estimated:NOW+180,now:NOW,feedFresh:true}));
  assert.equal(result.state,'realtime');assert.equal(result.keep,true);assert.equal(result.actionability,'catchable');
  assert.equal(result.estimatedDeparture,NOW+180);assert.equal(result.effectiveDeparture,NOW+180);
});

test('fresh high-confidence GPS at origin is pending and origin passage is positive departure proof',()=>{
  const waiting=engine().evaluate(input({scheduled:NOW-60,now:NOW,
    positionEvidence:position({state:'at_stop',nextStop:{id:row().originStopId}})}));
  assert.equal(waiting.state,'departure_pending');assert.equal(waiting.keep,true);assert.equal(waiting.actionability,'catchable');
  const departed=engine().evaluate(input({scheduled:NOW-60,now:NOW,
    positionEvidence:position({originPassed:true})}));
  assert.equal(departed.state,'departed');assert.equal(departed.keep,false);
  const rawOnly=engine().evaluate(input({scheduled:NOW-30,now:NOW,positionEvidence:{...position(),supported:false,
    rawState:{sequence:2,status:2,stopId:'after'}}}));
  assert.equal(rawOnly.state,'departure_overdue');assert.equal(rawOnly.keep,true);
});

test('allowlisted exact evidence can depart; stale, mismatched and incomplete evidence cannot',()=>{
  const good={type:'trip_next_stop',tripId:row().tripId,startDate:date,timestamp:NOW,confidence:0.96,
    exactVehicle:true,gpsConsistent:true};
  assert.equal(engine().evaluate(input({scheduled:NOW-30,departureEvidence:[good]})).state,'departed');
  for(const bad of [{...good,timestamp:NOW-121},{...good,startDate:'20260911'},
    {...good,exactVehicle:false},{...good,gpsConsistent:false}]) {
    const result=engine().evaluate(input({scheduled:NOW-30,departureEvidence:[bad]}));
    assert.notEqual(result.state,'departed');
  }
  const transition={type:'vehicle_next_trip',tripId:row().tripId,startDate:date,timestamp:NOW,level:'A'};
  assert.equal(engine().evaluate(input({scheduled:NOW-30,departureEvidence:[transition]})).state,'departed');
});

test('stale feed never promotes current evidence to departed',()=>{
  const result=engine().evaluate(input({scheduled:NOW-30,feedFresh:false,
    positionEvidence:position({originPassed:true}),departureEvidence:[{type:'vehicle_next_trip',tripId:row().tripId,
      startDate:date,timestamp:NOW,level:'A'}]}));
  assert.notEqual(result.state,'departed');assert.equal(result.actionability,'do_not_recommend');
});

test('departed and cancelled are terminal for the same trip instance',()=>{
  const departed=engine();
  assert.equal(departed.evaluate(input({scheduled:NOW-30,positionEvidence:position({originPassed:true})})).state,'departed');
  assert.equal(departed.evaluate(input({scheduled:NOW-30,now:NOW+30,positionEvidence:null})).state,'departed');
  const cancelled=engine();
  assert.equal(cancelled.evaluate(input({cancelled:true})).state,'cancelled');
  assert.equal(cancelled.evaluate(input({now:NOW+30,cancelled:false})).state,'cancelled');
});

test('Core remembers an explicit origin cancellation after the cancellation row disappears',()=>{
  const index=indexFixture(),e=engine(),cancelled=realtimeFixture({timestamp:NOW+300,relationship:3});
  const resolver=value=>e.evaluate(value);
  getArrivals({index,realtime:cancelled,now:NOW+300,originDepartureResolver:resolver,...P0_INPUT});
  const later=getArrivals({index,realtime:null,now:NOW+330,originDepartureResolver:resolver,...P0_INPUT});
  assert.ok(!later.directions[0].arrivals.some(value=>value.tripId===`20260910:${row().tripId}`));
});

test('low-frequency uncertainty is not recommended and does not regress to overdue',()=>{
  const e=engine({overdueMinSec:60,overdueMaxSec:60,freshEvidenceBonusSec:0,lowFrequencyHeadwaySec:10*60,
    minGraceSec:10*60,fallbackGraceSec:20*60,maxGraceSec:30*60});
  let result=e.evaluate(input({scheduled:NOW-120,now:NOW,nextScheduled:NOW+18*60,feedFresh:true,vehicleFresh:false}));
  assert.equal(result.state,'departure_uncertain');assert.equal(result.actionability,'do_not_recommend');
  result=e.evaluate(input({scheduled:NOW-30,now:NOW+1,nextScheduled:NOW+18*60,feedFresh:true,
    tripUpdateFresh:true,vehicleFresh:true,vehicleIdentified:true}));
  assert.equal(result.state,'departure_uncertain');assert.equal(result.ranking,'after_next');
});

test('exact incoming vehicle plus observed turnaround remains internal and never predicts before schedule',()=>{
  const e=engine(),common={scheduled:NOW+300,now:NOW+400,estimated:NOW+200,
    incomingLink:{level:'A',arrivalEstimated:NOW+100,timestamp:NOW+390,confidence:0.88},
    turnaroundEvidence:{sampleCount:12,estimateSec:120}};
  let result=e.evaluate(input(common));
  assert.equal(result.source,'linked_incoming_trip_observed_turnaround');assert.equal(result.estimatedDeparture,NOW+300);
  result=engine().evaluate(input({...common,incomingLink:{...common.incomingLink,level:'B'}}));
  assert.equal(result.estimatedDeparture,null);assert.equal(result.source,'unconfirmed');
});

test('Core places uncertain origin behind future service and reserves one warning row; mid-route stays unchanged',()=>{
  const index=indexFixture(),base=index.directions.home_to_noborito[0];
  index.directions.home_to_noborito=[base,{...base,tripId:'future-origin',scheduledSeconds:base.scheduledSeconds+15*60},
    {...base,tripId:'later-origin',scheduledSeconds:base.scheduledSeconds+30*60}];
  const now=NOW+600,resolver=value=>engine().evaluate(value);
  const arrivals=getArrivals({index,realtime:null,now,originDepartureResolver:resolver,...P0_INPUT}).directions[0].arrivals;
  assert.equal(arrivals[0].tripId,'20260910:future-origin');assert.equal(arrivals[1].tripId,'20260910:later-origin');
  assert.equal(arrivals[2].state,'departure_uncertain');assert.equal(arrivals[2].etaMinutes,null);
  const mid=structuredClone(index);mid.directions.home_to_noborito[0].isOrigin=false;
  assert.ok(!getArrivals({index:mid,realtime:null,now,originDepartureResolver:resolver,...P0_INPUT})
    .directions[0].arrivals.some(value=>value.tripId===`20260910:${base.tripId}`));
});

test('Core supplies route and origin specific headway instead of another platform route frequency',()=>{
  const index=indexFixture(),base=index.directions.mizonokuchi_to_home[0],seen=[];
  index.directions.mizonokuchi_to_home=[base,
    {...base,tripId:'other-route',routeId:'10033',scheduledSeconds:base.scheduledSeconds+5*60},
    {...base,tripId:'same-route',scheduledSeconds:base.scheduledSeconds+20*60}];
  getArrivals({index,realtime:null,now:NOW,originDepartureResolver:value=>{
    if(value.date===date&&value.row.tripId===base.tripId)seen.push(value.nextScheduled-value.scheduled);
    return engine().evaluate(value);
  },...P0_INPUT});
  assert.deepEqual(seen,[20*60]);
});

test('fresh non-low-frequency overdue evidence can lead, but cancellation and departed proof remove it',()=>{
  const index=indexFixture(),base=index.directions.home_to_noborito[0];
  index.directions.home_to_noborito=[base,{...base,tripId:'future-origin',scheduledSeconds:base.scheduledSeconds+6*60}];
  const now=NOW+270,rt=realtimeFixture({timestamp:now,time:NOW+230});
  rt.vehicles=[{trip:{...rt.updates[0].trip},vehicleId:'vehicle',timestamp:now,stopId:null,sequence:null,status:null,
    position:{lat:null,lon:null}}];
  const resolver=value=>engine().evaluate({...value,tripUpdateFresh:true,vehicleFresh:true,vehicleIdentified:true});
  const overdue=getArrivals({index,realtime:rt,now,originDepartureResolver:resolver,...P0_INPUT});
  assert.equal(overdue.directions[0].arrivals[0].state,'departure_overdue');
  const proof=position({tripId:base.tripId,observedAt:now,originPassed:true});
  const departed=getArrivals({index,realtime:rt,now,originDepartureResolver:value=>engine().evaluate({...value,
    positionEvidence:proof}),...P0_INPUT});
  assert.equal(departed.directions[0].arrivals[0].tripId,'20260910:future-origin');
  const cancelled=realtimeFixture({timestamp:now,relationship:3});
  assert.equal(getArrivals({index,realtime:cancelled,now,originDepartureResolver:value=>engine().evaluate(value),...P0_INPUT})
    .directions[0].arrivals[0].tripId,'20260910:future-origin');
});

test('actionability and evidence stay internal while publication gates remain off',()=>{
  assert.equal(DEPARTURE_PREDICTION_PUBLIC_ENABLED,false);
  const dto=getArrivals({index:indexFixture(),realtime:null,now:NOW+600,
    originDepartureResolver:value=>engine().evaluate(value),...P0_INPUT});
  const encoded=JSON.stringify(dto);
  for(const field of ['actionability','incomingArrivalEstimated','estimatedReadyTime','effectiveDeparture','vehicleId','originPassed'])
    assert.ok(!encoded.includes(`"${field}"`));
});

test('legacy grace helper remains bounded for callers and migration evidence',()=>{
  assert.equal(originGraceSeconds(NOW,NOW+60),10*60);assert.equal(originGraceSeconds(NOW,NOW+3600),45*60);
});

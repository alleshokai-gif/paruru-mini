import test from 'node:test';
import assert from 'node:assert/strict';
import { createVehicleTripTracker } from '../departure/tracker.js';
import { createTurnaroundEstimator } from '../departure/turnaround.js';
import { resolveTerminalArea } from '../providers/kawasaki/departure.js';

const trip=(tripId,startDate='20260912')=>({tripId,startDate,routeId:'r'});
const resolved={incoming:{originStopId:'a',terminalStopId:'dropoff',terminalAreaId:'hub'},
  outgoing:{originStopId:'platform',originAreaId:'hub',terminalStopId:'z'},wrong:{originStopId:'other',originAreaId:'other',terminalStopId:'z'}};
const tracker=()=>createVehicleTripTracker({resolveTrip:value=>resolved[value.tripId]||null});
const feed=(tripId,timestamp,updates=[])=>({vehicles:[{vehicleId:'vehicle',trip:trip(tripId),timestamp}],updates});

test('Kawasaki terminal grouping covers verified Mizonokuchi platforms without treating arbitrary stops as a hub',()=>{
  for(const stopId of ['434_2','434_3','434_4','434_5'])assert.equal(resolveTerminalArea(stopId),'mizonokuchi_south');
  assert.equal(resolveTerminalArea('362_1'),'noborito');assert.equal(resolveTerminalArea('184_2'),null);
});

test('same vehicle transition proves the trip chain, while GPS evidence is retained separately for dwell timing',()=>{
  const instance=tracker();instance.observe({realtime:feed('incoming',100),now:100});
  let result=instance.observe({realtime:feed('outgoing',130),now:130});
  assert.equal(result.transitions[0].level,'A');assert.equal(result.transitions[0].positionVerified,false);assert.equal(instance.links().length,1);
  const evidence=new Map([
    ['20260912:incoming',{supported:true,confidence:0.96,terminalReached:true}],
    ['20260912:outgoing',{supported:true,confidence:0.97,originPassed:true}]
  ]);
  const proven=tracker();proven.observe({realtime:feed('incoming',100),now:100,positionEvidence:evidence});
  result=proven.observe({realtime:feed('outgoing',130),now:130,positionEvidence:evidence});
  assert.equal(result.transitions[0].level,'A');assert.equal(result.transitions[0].positionVerified,true);assert.equal(proven.links().length,1);
});

test('same-feed future assignment and endpoint mismatch fail closed without raw state inference',()=>{
  const instance=tracker(),update={vehicleId:'vehicle',trip:trip('outgoing'),timestamp:110};
  let result=instance.observe({realtime:feed('incoming',100,[update]),now:110});
  assert.equal(result.assignments[0].level,'A');assert.equal(result.assignments[0].positionVerified,false);
  const mismatched=tracker();mismatched.observe({realtime:feed('incoming',100),now:100});
  result=mismatched.observe({realtime:feed('wrong',130),now:130});
  assert.equal(result.transitions[0].level,'C');assert.equal(mismatched.links().length,0);
});

test('stale-order, excessive gaps, missing identities and bounded memory never create links',()=>{
  const instance=createVehicleTripTracker({resolveTrip:value=>resolved[value.tripId]||null,policy:{maxTransitionSec:10,maxVehicles:1}});
  instance.observe({realtime:feed('incoming',100),now:100});
  assert.equal(instance.observe({realtime:feed('outgoing',120),now:120}).transitions[0].level,'C');
  instance.observe({realtime:{vehicles:[{vehicleId:null,trip:trip('incoming'),timestamp:130}],updates:[]},now:130});
  assert.equal(instance.historySize(),1);
  const stale=tracker();stale.observe({realtime:feed('incoming',100),now:300});
  assert.equal(stale.historySize(),0);
  stale.observe({realtime:{vehicles:[{vehicleId:'vehicle',trip:trip('incoming'),timestamp:null}],updates:[]},now:300});
  assert.equal(stale.historySize(),0);
});

test('turnaround distribution accepts only exact high-confidence observations and returns conservative p80',()=>{
  const estimator=createTurnaroundEstimator({policy:{minSamples:3}}),query={terminalId:'terminal',platform:'2',timeBand:'18'};
  const base={...query,linkLevel:'A',vehicleKey:'v',incomingTrip:'in',outgoingTrip:'out',terminalArrivalAt:100,confidence:0.95};
  for(const duration of [120,180,300])assert.equal(estimator.record({...base,originDepartureAt:100+duration}),true);
  assert.deepEqual(estimator.estimate(query),{sampleCount:3,medianSec:180,p80Sec:180,estimateSec:180});
  assert.equal(estimator.record({...base,linkLevel:'B',originDepartureAt:200}),false);
  assert.equal(estimator.record({...base,confidence:0.2,originDepartureAt:200}),false);
});

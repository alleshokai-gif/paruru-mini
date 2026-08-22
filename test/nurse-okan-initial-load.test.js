'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const healthRoutine=require('../features/nurse-okan/health-routine.js');
const ctx={console:{log(){},error(){},warn(){}},JSON,Error,Object,String,Array,Number,Promise,module:{exports:{}},exports:{},window:{PALURUHealthRoutine:healthRoutine},crypto:{randomUUID:()=> '11111111-1111-4111-8111-111111111111'},document:{addEventListener(){}},localStorage:{getItem:()=>''},navigator:{onLine:true},location:{hostname:'localhost'}};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('features/nurse-okan/nurse-okan.js','utf8'),ctx);
const api=ctx.module.exports;

async function run(){
  const events=[];
  await api.loadNurseInitialData_({
    loadDaily:async()=>({localDate:'2026-07-30',slots:{}}),
    onDaily:daily=>{events.push(['daily',daily]);},
    loadWeights:async()=>{throw new Error('weight unavailable');},
    onWeights:items=>events.push(['weights',items]),
    onWeightFailure:error=>events.push(['weightFailure',error.message]),
  });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(events[0][1])),{localDate:'2026-07-30',slots:{}},'daily result was not delivered before the KPI request');
  assert.deepStrictEqual(events.map(event=>event[0]),['daily','weightFailure'],'weight failure must not suppress the daily render callback');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(api.buildProgressState_(events[0][1],new Date('2026-07-30T12:00:00+09:00')).map(item=>item.status))),['due_missing','not_due','not_due','not_due','not_due'],'empty daily data must retain five-slot progress states');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(api.buildKpiValues_([],null))),{currentWeight:null,targetWeight:null,remainingKg:null,achievementRate:null},'weight failure must fall back only KPI values to null');

  const success=[];
  await api.loadNurseInitialData_({
    loadDaily:async()=>({slots:{morning:{}}}),
    onDaily:daily=>success.push(['daily',daily]),
    loadWeights:async()=>({items:[{weightKg:58.9}]}),
    onWeights:items=>success.push(['weights',items]),
    onWeightFailure:()=>success.push(['weightFailure']),
  });
  assert.deepStrictEqual(success.map(event=>event[0]),['daily','weights'],'both-success initial load regression');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(api.buildKpiValues_(success[1][1],null))),{currentWeight:58.9,targetWeight:null,remainingKg:null,achievementRate:null},'Health_Weight latest record was not preserved');

  let weightsCalled=false;
  await assert.rejects(()=>api.loadNurseInitialData_({
    loadDaily:async()=>{throw new Error('daily unavailable');},
    onDaily:()=>{throw new Error('daily callback must not run');},
    loadWeights:async()=>{weightsCalled=true;return {items:[]};},
    onWeights:()=>{},onWeightFailure:()=>{},
  }),/daily unavailable/);
  assert.strictEqual(weightsCalled,false,'daily failure must stop before KPI loading');

  const source=fs.readFileSync('features/nurse-okan/nurse-okan.js','utf8');
  assert(!source.includes('Promise.all([callInitialHealth_'), 'daily and weight initial loads must not share Promise.all');
  assert(source.includes("logHealthKpiLoadError_(error)"),'weight failure diagnostic missing');
  assert(source.includes("'日次記録を読み込めませんでした'"),'daily-specific load error message missing');
  console.log('PASS Nurse Okan isolated daily and KPI initial load');
}
run().catch(error=>{console.error(error);process.exitCode=1;});

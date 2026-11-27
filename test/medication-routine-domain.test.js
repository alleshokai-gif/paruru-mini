'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./fixtures/medication-routine-fixture');
function configured(){const f=fixture();f.setup();const receipt=f.api('health.medication.plan.put',{clientRequestId:f.uuid(),payload:{planId:f.planId,expectedRevision:0,plan:f.plan}});assert.equal(receipt.success,true);return f;}
function read(f,actor='guardian'){const out=f.api('health.medication.get',{localDate:f.date},actor);assert.equal(out.success,true);return out.data;}
function record(f,extra={}){return {clientRequestId:f.uuid(),localDate:f.date,slot:'evening',payload:{planId:f.planId,planRevision:1,expectedEventId:'',status:'completed',occurredAt:'2030-04-03T10:55:00Z',...(extra.expectedEventId?{correctionReason:'Synthetic correction'}:{}),...extra}};}

test('unconfigured read writes nothing; explicit schema setup; no delivery',()=>{
  const f=fixture(),data=read(f);assert.equal(data.configured,false);assert.equal(data.notificationTransport,'not_connected');assert.equal(Object.keys(f.sheets).length,0);
  const out=f.api('health.medication.plan.put',{clientRequestId:f.uuid(),payload:{planId:f.planId,expectedRevision:0,plan:f.plan}});assert.equal(out.error.code,'ROUTINE_NOT_CONFIGURED');
});
test('server actor/Home and existing guardian/self/baseline boundaries are retained',()=>{
  const f=configured(),before=f.reached();
  for(const actor of ['unknown','disabled'])assert.equal(f.api('health.medication.get',{localDate:f.date},actor).success,false);
  for(const target of ['other','disabled','peer'])assert.equal(f.api('health.medication.get',{localDate:f.date,targetMemberUserId:target}).error.code,'FORBIDDEN');
  assert.equal(f.reached(),before);
  assert.equal(f.api('health.medication.plan.put',{clientRequestId:f.uuid(),payload:{planId:f.planId,expectedRevision:1,plan:f.plan}},'self').error.code,'FORBIDDEN');
  assert.equal(f.api('health.medication.get',{localDate:f.date,targetMemberUserId:'baseline'}).success,true);
  const own=read(f,'self');assert.equal(own.canConfigure,false);assert.equal(own.canRecord,true);
  assert.equal(f.api('health.medication.get',{localDate:f.date,homeId:'other-synthetic-home',actorRole:'admin'}).success,true);
});
test('weekday times, explicit start date and future notes never change dose',()=>{
  const f=configured(),wednesday=read(f);assert.equal(wednesday.occurrences.find(x=>x.slot==='evening').scheduledAt,'2030-04-03T20:10:00+09:00');
  f.setNow('2030-04-04T11:00:00Z');f.date='2030-04-04';assert.equal(read(f).occurrences.find(x=>x.slot==='evening').scheduledAt,'2030-04-04T19:20:00+09:00');
  f.setNow('2030-04-11T11:00:00Z');f.date='2030-04-11';assert.equal(read(f).plans[0].doseText,'設定内容A');
  const p={...f.plan,startDate:'2030-05-01'};assert.equal(f.api('health.medication.plan.put',{clientRequestId:f.uuid(),payload:{planId:f.planId,expectedRevision:1,plan:p}}).success,true);assert.equal(read(f).occurrences.length,0);
});
test('two device readers share durable event, repeated request is idempotent and stale CAS conflicts',()=>{
  const f=configured(),request=record(f),first=f.api('health.medication.record',request,'self');assert.equal(first.data.persisted,true);
  const second=f.api('health.medication.record',request,'self');assert.equal(second.data.replayed,true);assert.equal(second.data.eventId,first.data.eventId);
  assert.equal(f.sheets.Health_Routine_Events.getLastRow(),2);
  assert.equal(read(f).occurrences.find(x=>x.slot==='evening').eventId,first.data.eventId);
  assert.equal(f.api('health.medication.record',record(f),'guardian').error.code,'REVISION_CONFLICT');
  assert.equal(f.api('health.medication.record',{...request,payload:{...request.payload,status:'held',occurredAt:''}},'self').error.code,'IDEMPOTENCY_CONFLICT');
});
test('lost response is recovered before CAS even after another correction',()=>{
  const f=configured(),request=record(f);f.sheets.Health_Routine_Events.loseResponse=true;
  assert.equal(f.api('health.medication.record',request,'self').success,false);
  const event=read(f).occurrences.find(x=>x.slot==='evening');
  assert.equal(f.api('health.medication.record',record(f,{expectedEventId:event.eventId,status:'held',occurredAt:''}),'guardian').success,true);
  const retry=f.api('health.medication.record',request,'self');assert.equal(retry.data.replayed,true);assert.equal(retry.data.eventId,event.eventId);assert.equal(f.sheets.Health_Routine_Events.getLastRow(),3);
  assert.equal(read(f).occurrences.find(x=>x.slot==='evening').status,'held');
});
test('correction and plan changes keep original revision and actual-time timers',()=>{
  const f=configured(),r=f.api('health.medication.record',record(f),'self');
  let item=read(f).occurrences.find(x=>x.slot==='evening');assert.equal(item.timers.find(x=>x.kind==='observationMinutes').endsAt,'2030-04-03T11:05:00.000Z');
  assert.equal(f.api('health.medication.plan.put',{clientRequestId:f.uuid(),payload:{planId:f.planId,expectedRevision:1,plan:{label:'項目B',timers:{observationMinutes:60},enabled:false}}}).success,true);
  item=read(f).occurrences.find(x=>x.slot==='evening');assert.equal(item.label,'項目A');assert.equal(item.planRevision,1);assert.equal(item.remindersEnabled,false);
  const changed=f.api('health.medication.record',record(f,{expectedEventId:r.data.eventId,status:'held',occurredAt:''}),'guardian');assert.equal(changed.success,true);
  item=read(f).occurrences.find(x=>x.slot==='evening');assert.equal(item.timers.length,0);assert.equal(f.sheets.Health_Routine_Events.getLastRow(),3);
});
test('strict dates/instants reject future, date normalization and offsetless input; late midnight is explicit',()=>{
  const f=configured();
  for(const value of ['2030-04-03T23:00:00Z','2030-02-30T10:00:00Z','2030-04-03T10:00:00','2030-04-03T24:00:00Z'])assert.equal(f.api('health.medication.record',record(f,{occurredAt:value})).error.code,'INVALID_INPUT');
  f.setNow('2030-04-04T00:10:00+09:00');const out=f.api('health.medication.record',record(f,{occurredAt:'2030-04-04T00:01:00+09:00'}));assert.equal(out.success,true);
  const item=read(f).occurrences.find(x=>x.slot==='evening');assert.equal(item.localDate,'2030-04-03');assert.equal(item.occurredAt,'2030-04-03T15:01:00.000Z');
});
test('plan revision CAS and historical days never invent past omissions',()=>{
  const f=configured();assert.equal(f.api('health.medication.plan.put',{clientRequestId:f.uuid(),payload:{planId:f.planId,expectedRevision:0,plan:f.plan}}).error.code,'REVISION_CONFLICT');
  assert.equal(f.api('health.medication.get',{localDate:'2030-04-02'}).data.occurrences.length,0);
});
test('later plan edits allow historical first record at the original day revision; reasons are literal JSON',()=>{
  const f=configured();f.setNow('2030-04-04T11:00:00Z');
  assert.equal(f.api('health.medication.plan.put',{clientRequestId:f.uuid(),payload:{planId:f.planId,expectedRevision:1,plan:{label:'Synthetic revised'}}}).success,true);
  const past=f.api('health.medication.get',{localDate:f.date});assert.equal(past.data.occurrences[0].planRevision,1);
  const first=f.api('health.medication.record',record(f,{correctionReason:'=1+1'}));assert.equal(first.success,true);
  const sheet=f.sheets.Health_Routine_Events,col=sheet.values[0].indexOf('correctionReasonJson');assert.equal(JSON.parse(sheet.values[1][col]),'=1+1');assert(!sheet.values[1][col].startsWith('='));
  const today=f.api('health.medication.record',{...record(f),localDate:'2030-04-04'});assert.equal(today.error.code,'REVISION_CONFLICT');
});
test('anonymous private service access is rejected before data access',()=>{
  const f=fixture();let touched=0;f.service.medicationTables_=()=>{touched++;throw Error('should not be called');};
  const out=f.service.doPost({postData:{contents:JSON.stringify({operation:'health.medication.get',localDate:f.date})}});assert.equal(out.error.code,'UNAUTHORIZED');assert.equal(touched,0);
});
test('generic projection needs enabled current unrecorded item and rejects late/catchup; no names',()=>{
  const f=configured(),data=read(f),item=data.occurrences.find(x=>x.slot==='evening');item.remindersEnabled=true;
  let notices=f.service.medicationDueReminders_([item],'2030-04-03T20:12:00+09:00',{});assert.equal(notices.length,1);assert(!JSON.stringify(notices).includes('項目A'));assert(!JSON.stringify(notices).includes('設定内容A'));
  assert.equal(f.service.medicationDueReminders_([item],'2030-04-03T20:20:00+09:00',{}).length,0);
  item.status='held';assert.equal(f.service.medicationDueReminders_([item],'2030-04-03T20:12:00+09:00',{}).length,0);
  item.status='unrecorded';item.remindersEnabled=false;assert.equal(f.service.medicationDueReminders_([item],'2030-04-03T20:12:00+09:00',{}).length,0);
});

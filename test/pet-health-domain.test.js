'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const vm = require('vm');

class Range {
  constructor(sheet,row,column,rowCount,columnCount){this.sheet=sheet;this.row=row;this.column=column;this.rowCount=rowCount;this.columnCount=columnCount;}
  getValues(){return Array.from({length:this.rowCount},(_,i)=>Array.from({length:this.columnCount},(_,j)=>this.sheet.values[this.row-1+i]?.[this.column-1+j]??''));}
  setValues(values){values.forEach((row,i)=>row.forEach((value,j)=>{(this.sheet.values[this.row-1+i]||=[])[this.column-1+j]=value;}));}
}
class Sheet {
  constructor(){this.values=[];this.failNextAppend=false;this.silentNoOpNextAppend=false;this.afterNextAppend=null;}
  getLastColumn(){return Math.max(0,...this.values.map((row)=>row.length));}
  getLastRow(){return this.values.length;}
  getRange(...args){return new Range(this,...args);}
  getDataRange(){return new Range(this,1,1,Math.max(1,this.getLastRow()),Math.max(1,this.getLastColumn()));}
  appendRow(row){
    if(this.failNextAppend){this.failNextAppend=false;throw new Error('append failure');}
    if(this.silentNoOpNextAppend){this.silentNoOpNextAppend=false;return;}
    this.values.push(row.slice());
    if(this.afterNextAppend){const callback=this.afterNextAppend;this.afterNextAppend=null;callback(this);}
  }
  setFrozenRows(){}
}
class Spreadsheet {
  constructor(){this.sheets={};this.flushCount=0;}
  getSheetByName(name){return this.sheets[name]||null;}
  insertSheet(name){return this.sheets[name]=new Sheet();}
}

function pad(value,length=2){return String(value).padStart(length,'0');}
function tokyoFormat(date,format){
  const local=new Date(date.getTime()+9*60*60*1000),datePart=`${local.getUTCFullYear()}-${pad(local.getUTCMonth()+1)}-${pad(local.getUTCDate())}`;
  if(format==='yyyy-MM-dd')return datePart;
  return `${datePart}T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}+09:00`;
}
function createHarness(){
  const spreadsheet=new Spreadsheet();
  const context={
    console,JSON,Number,String,Object,Array,Date,Math,RegExp,Error,
    Utilities:{
      getUuid:()=>crypto.randomUUID(),
      formatDate:(date,zone,format)=>{assert.strictEqual(zone,'Asia/Tokyo');return tokyoFormat(date,format);},
      base64Encode:(value)=>Buffer.from(value).toString('base64'),
      computeDigest:(_algorithm,value)=>crypto.createHash('sha256').update(value).digest(),
      DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'}
    },
    PropertiesService:{getScriptProperties:()=>({getProperty:(key)=>key==='HEALTH_SPREADSHEET_ID'?'sheet':key==='HEALTH_SERVICE_TOKEN'?'test-token':''})},
    SpreadsheetApp:{openById:()=>spreadsheet,flush:()=>{spreadsheet.flushCount+=1;}},
    LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
    ContentService:{MimeType:{JSON:'application/json'},createTextOutput:(text)=>({text,setMimeType(){return this;},getContent(){return this.text;}})}
  };
  vm.createContext(context);
  ['HealthSetup.js','HealthSecurity.js','HealthRuleService.js','HealthDataService.js','PetHealthSecurity.js','PetHealthDataService.js','PetHealthIdempotency.js','PetHealthSummaryService.js','Code.js'].forEach((file)=>vm.runInContext(fs.readFileSync(`gas-health/${file}`,'utf8'),context));
  context.setupHealthSchema_();
  return {context,spreadsheet};
}
function plain(value){return JSON.parse(JSON.stringify(value));}
function requestId(number){return `00000000-0000-4000-8000-${pad(number,12)}`;}
function baseRecord(event,id=requestId(1),homeId='home-main'){
  return {operation:'pet.health.record',homeId,actorUserId:'father',source:'manual',clientRequestId:id,petId:'popio',event};
}
const fixedNow='2026-08-19T12:00:00+09:00';
function normalize(context,event){return context.petHealthNormalizeRecordRequest_(baseRecord(event),new Date(fixedNow),{});}
function invalid(context,event){assert.throws(()=>normalize(context,event),(error)=>error.code==='INVALID_INPUT');}
function record(context,body,now=fixedNow){return context.petHealthRecord_(body,{now:()=>new Date(now)});}
function summary(context,localDate,homeId='home-main'){
  const body={operation:'pet.health.getDailySummary',homeId,actorUserId:'father',petId:'popio'};
  if(localDate!==undefined)body.localDate=localDate;
  return context.petHealthSummary_(body,{now:()=>new Date('2026-08-22T12:00:00+09:00')});
}

{
  const {context,spreadsheet}=createHarness();
  assert.deepStrictEqual(spreadsheet.sheets.Pet_Health_Events.values[0],['eventId','homeId','petId','eventType','occurredAt','occurredAtSource','localDate','mealSlot','amountG','completion','amountMl','stoolForm','stoolAmount','coprophagy','urineStatus','weightKg','energy','appetite','flagsJson','note','source','recordedBy','recordedAt','clientRequestId','requestHash']);
  assert.deepStrictEqual(spreadsheet.sheets.Pet_Health_Request_Log.values[0],['clientRequestId','operation','actorUserId','petId','requestHash','eventId','responseJson','status','createdAt']);
  ['Health_Daily','Health_Weight','Health_Request_Log'].forEach((name)=>assert(!spreadsheet.sheets[name].values[0].includes('petId'),`${name} was mixed with Pet schema`));

  assert.strictEqual(normalize(context,{eventType:'meal',mealSlot:'breakfast',amountG:20,completion:'finished'}).event.eventData.amountG,20,'PH-D01');
  assert.strictEqual(normalize(context,{eventType:'meal',mealSlot:'breakfast',amountG:0,completion:'refused'}).event.eventData.amountG,0,'meal refused zero');
  invalid(context,{eventType:'meal',mealSlot:'breakfast',amountG:0,completion:'finished'});
  invalid(context,{eventType:'meal',mealSlot:'breakfast',amountG:0.11,completion:'finished'});
  invalid(context,{eventType:'meal',mealSlot:'breakfast',amountG:5000.1,completion:'finished'});
  invalid(context,{eventType:'meal',mealSlot:'brunch',completion:'finished'}); // PH-D02
  invalid(context,{eventType:'meal',mealSlot:'breakfast',amountG:20,completion:'refused'}); // PH-D03
  assert.strictEqual(normalize(context,{eventType:'water',amountMl:150}).event.eventData.amountMl,150,'PH-D04');
  invalid(context,{eventType:'water',amountMl:150.5}); // PH-D05
  invalid(context,{eventType:'water',amountMl:0});
  invalid(context,{eventType:'water',amountMl:10001});
  assert.strictEqual(normalize(context,{eventType:'stool'}).event.eventType,'stool','PH-D06');
  invalid(context,{eventType:'stool',stoolForm:'round'}); // PH-D07
  assert.strictEqual(normalize(context,{eventType:'urine'}).event.eventType,'urine','PH-D08');
  assert.strictEqual(normalize(context,{eventType:'weight',weightKg:2.3}).event.eventData.weightKg,2.3,'PH-D09');
  invalid(context,{eventType:'weight',weightKg:'2.3'}); // PH-D10
  invalid(context,{eventType:'weight',weightKg:0.099});
  invalid(context,{eventType:'weight',weightKg:2.3001});
  invalid(context,{eventType:'weight',weightKg:200.001});
  invalid(context,{eventType:'observation'}); // PH-D11
  invalid(context,{eventType:'observation',flags:['vomiting','vomiting']}); // PH-D12
  invalid(context,{eventType:'stool',amountMl:10}); // PH-D13
  invalid(context,{eventType:'stool',note:'a'.repeat(501)}); // PH-D14
  assert.strictEqual(normalize(context,{eventType:'stool',note:'あ'.repeat(500)}).event.eventData.note.length,500,'note 500 code points');
  invalid(context,{eventType:'stool',occurredAt:'2026-08-19T12:05:01+09:00'}); // PH-D15
  assert.strictEqual(normalize(context,{eventType:'stool',occurredAt:'2026-08-19T12:05:00+09:00'}).event.occurredAt,'2026-08-19T12:05:00+09:00','future exactly five minutes');
  invalid(context,{eventType:'stool',occurredAt:'2026-02-30T12:00:00+09:00'});
  invalid(context,{eventType:'stool',occurredAt:'2026-08-19T12:00:00'});
  invalid(context,{eventType:'stool',note:null});
  invalid(context,{eventType:'stool',recordedAt:'2026-08-19T12:00:00+09:00'});
  assert.throws(()=>context.petHealthNormalizeRecordRequest_({...baseRecord({eventType:'stool'}),unused:null},new Date(fixedNow),{}),(error)=>error.code==='INVALID_INPUT','request null rejection');
  assert.strictEqual(normalize(context,{eventType:'stool',note:'  e\u0301\r\nメモ  '}).event.eventData.note,'é\nメモ','note normalization');
  assert.throws(()=>context.petHealthNormalizeRecordRequest_({...baseRecord({eventType:'stool'}),source:'device'},new Date(fixedNow),{}),(error)=>error.code==='INVALID_INPUT','source enum');
  assert.throws(()=>context.petHealthNormalizeRecordRequest_({...baseRecord({eventType:'stool'}),petId:'other'},new Date(fixedNow),{}),(error)=>error.code==='INVALID_INPUT','petId fixed');
  assert.throws(()=>context.petHealthNormalizeRecordRequest_({...baseRecord({eventType:'stool'}),homeId:' '},new Date(fixedNow),{}),(error)=>error.code==='INVALID_INPUT','homeId required');
  assert.throws(()=>context.petHealthNormalizeRecordRequest_({...baseRecord({eventType:'stool'}),actorUserId:1},new Date(fixedNow),{}),(error)=>error.code==='INVALID_INPUT','actorUserId type');

  const hashA=context.petHealthRecordHash_(context.petHealthNormalizeRecordRequest_(baseRecord({eventType:'observation',flags:['pain_behavior','vomiting'],note:' e\u0301 '} ,requestId(10)),new Date(fixedNow),{}));
  const hashB=context.petHealthRecordHash_(context.petHealthNormalizeRecordRequest_(baseRecord({eventType:'observation',flags:['vomiting','pain_behavior'],note:'é'},requestId(11)),new Date('2026-08-19T13:00:00+09:00'),{}));
  assert.strictEqual(hashA,hashB,'canonical hash excludes request ID, normalizes note/flags, and keeps omitted occurredAt stable');

  const explicit=normalize(context,{eventType:'stool',occurredAt:'2026-08-18T22:00:00Z'});
  assert.strictEqual(explicit.event.occurredAt,'2026-08-19T07:00:00+09:00','PH-T01');
  const omitted=record(context,baseRecord({eventType:'stool'},requestId(20)));
  assert.strictEqual(omitted.data.event.occurredAt,fixedNow,'PH-T02');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(omitted.data.event,'requestHash'),false,'requestHash must not leak');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(omitted.data.event,'clientRequestId'),false,'clientRequestId must not leak');
  assert.strictEqual(explicit.event.occurredAt.slice(0,10),'2026-08-19','PH-T03');
  const replay=record(context,baseRecord({eventType:'stool'},requestId(20)),'2026-08-19T13:00:00+09:00');
  assert.strictEqual(replay.data.event.occurredAt,fixedNow,'PH-T04');
  assert.strictEqual(spreadsheet.sheets.Pet_Health_Events.getLastRow(),2,'PH-I01');
  assert.strictEqual(replay.data.idempotency.replayed,true,'PH-I02');
  assert.strictEqual(spreadsheet.flushCount,2,'first write flushes Event and Request Log before success');
  assert.throws(()=>record(context,baseRecord({eventType:'stool',stoolForm:'soft'},requestId(20))),(error)=>error.code==='IDEMPOTENCY_CONFLICT','PH-I03');
}

{
  const {context,spreadsheet}=createHarness(),body=baseRecord({eventType:'urine'},requestId(30));
  record(context,body);
  spreadsheet.sheets.Pet_Health_Request_Log.appendRow(spreadsheet.sheets.Pet_Health_Request_Log.values[1]);
  assert.throws(()=>record(context,body),(error)=>error.code==='DATA_INTEGRITY_ERROR','PH-I04');
}

{
  const {context,spreadsheet}=createHarness(),body=baseRecord({eventType:'urine'},requestId(31));
  record(context,body);
  const headers=spreadsheet.sheets.Pet_Health_Request_Log.values[0],hashIndex=headers.indexOf('requestHash');
  spreadsheet.sheets.Pet_Health_Request_Log.values[1][hashIndex]='corrupt';
  assert.throws(()=>record(context,{...body,event:{eventType:'urine',urineStatus:'concern'}}),(error)=>error.code==='DATA_INTEGRITY_ERROR','corrupt Request Log must fail before conflict classification');
}

{
  const {context,spreadsheet}=createHarness(),body=baseRecord({eventType:'stool'},requestId(40)),original=context.petHealthAppendRequestLog_;
  context.petHealthAppendRequestLog_=()=>{throw new Error('response log failure');};
  assert.throws(()=>record(context,body));
  assert.strictEqual(spreadsheet.sheets.Pet_Health_Events.getLastRow(),2,'PH-I05 event must exist after partial failure');
  assert.strictEqual(spreadsheet.sheets.Pet_Health_Request_Log.getLastRow(),1,'PH-I05 log must be absent after partial failure');
  context.petHealthAppendRequestLog_=original;
  const recovered=record(context,body,'2026-08-19T14:00:00+09:00');
  assert.strictEqual(recovered.data.idempotency.replayed,true,'PH-I05 recovery must replay');
  assert.strictEqual(spreadsheet.sheets.Pet_Health_Events.getLastRow(),2,'PH-I05 duplicate event');
  assert.strictEqual(spreadsheet.sheets.Pet_Health_Request_Log.getLastRow(),2,'PH-I05 request log recovery');
}

{
  const {context,spreadsheet}=createHarness(),body=baseRecord({eventType:'stool'},requestId(41));
  spreadsheet.sheets.Pet_Health_Events.silentNoOpNextAppend=true;
  assert.throws(()=>record(context,body),(error)=>error.code==='DATA_INTEGRITY_ERROR','PH-I06 Event append silent no-op');
  assert.strictEqual(spreadsheet.sheets.Pet_Health_Events.getLastRow(),1,'PH-I06 Event must be absent');
  assert.strictEqual(spreadsheet.sheets.Pet_Health_Request_Log.getLastRow(),1,'PH-I06 Request Log must not be created');
}

{
  const {context,spreadsheet}=createHarness(),body=baseRecord({eventType:'stool'},requestId(42)),original=context.petHealthEventsByRequestId_;
  let readCount=0;
  context.petHealthEventsByRequestId_=function(clientRequestId){readCount+=1;return readCount===2?[]:original(clientRequestId);};
  assert.throws(()=>record(context,body),(error)=>error.code==='DATA_INTEGRITY_ERROR','PH-I07 Event read-back zero matches');
  assert.strictEqual(spreadsheet.sheets.Pet_Health_Events.getLastRow(),2,'PH-I07 append occurred before unavailable read-back');
  assert.strictEqual(spreadsheet.sheets.Pet_Health_Request_Log.getLastRow(),1,'PH-I07 Request Log must not be created');
}

{
  const {context,spreadsheet}=createHarness(),body=baseRecord({eventType:'stool'},requestId(43)),events=spreadsheet.sheets.Pet_Health_Events;
  events.afterNextAppend=(sheet)=>sheet.values.push(sheet.values[sheet.values.length-1].slice());
  assert.throws(()=>record(context,body),(error)=>error.code==='DATA_INTEGRITY_ERROR','PH-I08 duplicate Event read-back');
  assert.strictEqual(events.getLastRow(),3,'PH-I08 duplicate fixture');
  assert.strictEqual(spreadsheet.sheets.Pet_Health_Request_Log.getLastRow(),1,'PH-I08 Request Log must not be created');
}

{
  const {context,spreadsheet}=createHarness(),body=baseRecord({eventType:'stool'},requestId(44)),events=spreadsheet.sheets.Pet_Health_Events;
  events.afterNextAppend=(sheet)=>{const hashIndex=sheet.values[0].indexOf('requestHash');sheet.values[sheet.values.length-1][hashIndex]='corrupt';};
  assert.throws(()=>record(context,body),(error)=>error.code==='DATA_INTEGRITY_ERROR','PH-I09 Event hash mismatch');
  assert.strictEqual(spreadsheet.sheets.Pet_Health_Request_Log.getLastRow(),1,'PH-I09 Request Log must not be created');
}

{
  const {context,spreadsheet}=createHarness(),body=baseRecord({eventType:'stool'},requestId(45)),events=spreadsheet.sheets.Pet_Health_Events;
  events.afterNextAppend=(sheet)=>{const noteIndex=sheet.values[0].indexOf('note');sheet.values[sheet.values.length-1][noteIndex]='stored-read-back';};
  const response=record(context,body);
  assert.strictEqual(response.data.event.note,'stored-read-back','PH-I10 success response is STORED_EVENT_BASED');
  assert.strictEqual(spreadsheet.flushCount,2,'PH-I10 both persistence stages were flushed');
}

{
  const {context,spreadsheet}=createHarness(),body=baseRecord({eventType:'urine'},requestId(46));
  spreadsheet.sheets.Pet_Health_Request_Log.silentNoOpNextAppend=true;
  assert.throws(()=>record(context,body),(error)=>error.code==='DATA_INTEGRITY_ERROR','PH-I11 Request Log append silent no-op');
  assert.strictEqual(spreadsheet.sheets.Pet_Health_Events.getLastRow(),2,'PH-I11 Event remains persisted');
  assert.strictEqual(spreadsheet.sheets.Pet_Health_Request_Log.getLastRow(),1,'PH-I11 Request Log must be absent');
}

{
  const {context,spreadsheet}=createHarness(),body=baseRecord({eventType:'urine'},requestId(47)),logs=spreadsheet.sheets.Pet_Health_Request_Log;
  logs.afterNextAppend=(sheet)=>{
    const responseIndex=sheet.values[0].indexOf('responseJson'),row=sheet.values[sheet.values.length-1],response=JSON.parse(row[responseIndex]);
    response.data.event.eventId=requestId(999999);
    row[responseIndex]=JSON.stringify(response);
  };
  assert.throws(()=>record(context,body),(error)=>error.code==='DATA_INTEGRITY_ERROR','PH-I12 Request Log read-back mismatch');
  assert.strictEqual(spreadsheet.sheets.Pet_Health_Events.getLastRow(),2,'PH-I12 Event remains persisted');
}

{
  const {context,spreadsheet}=createHarness(),body=baseRecord({eventType:'urine'},requestId(48)),logs=spreadsheet.sheets.Pet_Health_Request_Log;
  logs.silentNoOpNextAppend=true;
  assert.throws(()=>record(context,body),(error)=>error.code==='DATA_INTEGRITY_ERROR','PH-I13 initial Request Log verification failure');
  const recovered=record(context,body,'2026-08-19T14:00:00+09:00');
  assert.strictEqual(recovered.data.idempotency.replayed,true,'PH-I13 retry recovers from stored Event');
  assert.strictEqual(spreadsheet.sheets.Pet_Health_Events.getLastRow(),2,'PH-I13 recovery must not duplicate Event');
  assert.strictEqual(logs.getLastRow(),2,'PH-I13 recovery persists one Request Log');
}

{
  const {context}=createHarness();
  let next=100;
  const add=(event,homeId='home-main')=>record(context,baseRecord(event,requestId(next++),homeId),'2026-08-22T12:00:00+09:00');
  let value=summary(context,'2026-08-10');
  assert.deepStrictEqual(plain(value.data.meal),{eventCount:0,totalAmountG:null,knownAmountG:0,amountStatus:'no_events',bySlot:{breakfast:{eventCount:0,totalAmountG:null,knownAmountG:0,amountStatus:'no_events'},lunch:{eventCount:0,totalAmountG:null,knownAmountG:0,amountStatus:'no_events'},dinner:{eventCount:0,totalAmountG:null,knownAmountG:0,amountStatus:'no_events'},snack:{eventCount:0,totalAmountG:null,knownAmountG:0,amountStatus:'no_events'}},completionCounts:{finished:0,partial:0,refused:0}},'PH-S01');

  add({eventType:'weight',occurredAt:'2026-08-18T20:00:00+09:00',weightKg:2.3,note:'before'});
  add({eventType:'meal',occurredAt:'2026-08-19T07:00:00+09:00',mealSlot:'breakfast',amountG:20,completion:'finished'});
  add({eventType:'meal',occurredAt:'2026-08-19T18:00:00+09:00',mealSlot:'dinner',amountG:30,completion:'partial'});
  add({eventType:'water',occurredAt:'2026-08-19T08:00:00+09:00',amountMl:150});
  add({eventType:'water',occurredAt:'2026-08-19T16:00:00+09:00',amountMl:100});
  add({eventType:'stool',occurredAt:'2026-08-19T09:00:00+09:00',stoolForm:'banana',stoolAmount:'normal',coprophagy:false,note:'ok'});
  add({eventType:'stool',occurredAt:'2026-08-19T21:00:00+09:00'});
  add({eventType:'urine',occurredAt:'2026-08-19T10:00:00+09:00',urineStatus:'concern'});
  add({eventType:'urine',occurredAt:'2026-08-19T13:00:00+09:00'});
  add({eventType:'observation',occurredAt:'2026-08-19T11:00:00+09:00',energy:'low',flags:['pain_behavior','vomiting']});
  add({eventType:'observation',occurredAt:'2026-08-19T12:00:00+09:00',energy:'normal'});
  add({eventType:'observation',occurredAt:'2026-08-19T14:00:00+09:00',note:'少し気になる'});
  add({eventType:'meal',occurredAt:'2026-08-20T07:00:00+09:00',mealSlot:'breakfast',amountG:10,completion:'finished'});
  add({eventType:'meal',occurredAt:'2026-08-20T18:00:00+09:00',mealSlot:'dinner',completion:'partial'});
  add({eventType:'meal',occurredAt:'2026-08-21T07:00:00+09:00',mealSlot:'breakfast',completion:'finished'});
  add({eventType:'meal',occurredAt:'2026-08-21T18:00:00+09:00',mealSlot:'dinner',completion:'partial'});
  add({eventType:'meal',occurredAt:'2026-08-19T07:30:00+09:00',mealSlot:'breakfast',amountG:999,completion:'finished'},'other-home');
  add({eventType:'weight',occurredAt:'2026-08-19T22:00:00+09:00',weightKg:9},'other-home');

  value=summary(context,'2026-08-19');
  assert.strictEqual(value.data.meal.totalAmountG,50,'PH-S02');
  assert.strictEqual(value.data.meal.knownAmountG,50,'PH-S02');
  assert.strictEqual(value.data.meal.amountStatus,'complete','PH-S02');
  assert.strictEqual(value.data.meal.bySlot.breakfast.eventCount,1,'PH-S02 bySlot');
  assert.strictEqual(summary(context,'2026-08-20').data.meal.amountStatus,'partial','PH-S03');
  assert.strictEqual(summary(context,'2026-08-20').data.meal.knownAmountG,10,'PH-S03');
  assert.strictEqual(summary(context,'2026-08-21').data.meal.amountStatus,'unknown','PH-S04');
  assert.strictEqual(value.data.water.totalAmountMl,250,'PH-S05');
  assert.strictEqual(value.data.water.amountStatus,'complete','PH-S05');
  assert.strictEqual(value.data.stool.count,2,'PH-S06');
  assert.deepStrictEqual(plain(value.data.stool.observations[0]),{eventId:value.data.stool.observations[0].eventId,occurredAt:'2026-08-19T09:00:00+09:00',stoolForm:'banana',stoolAmount:'normal',coprophagy:false,note:'ok'},'PH-S06');
  assert.strictEqual(value.data.urine.count,2,'PH-S07');
  assert.strictEqual(value.data.urine.concernCount,1,'PH-S07');
  assert.strictEqual(value.data.latestWeight.weightKg,2.3,'PH-S08');
  assert.strictEqual(value.data.latestWeight.occurredAt,'2026-08-18T20:00:00+09:00','PH-S08');
  assert.strictEqual(value.data.notableObservations.length,2,'PH-S09');
  assert.deepStrictEqual(plain(value.data.notableObservations[0].flags),['vomiting','pain_behavior'],'PH-S09 canonical flags');
  assert.strictEqual(value.data.meal.eventCount,2,'PH-S10 home/date isolation');
  assert.strictEqual(summary(context,'2026-08-20').data.meal.eventCount,2,'PH-S10 date isolation');
  assert.strictEqual(summary(context,undefined).data.localDate,'2026-08-22','summary default date');
  assert.throws(()=>summary(context,''),(error)=>error.code==='INVALID_INPUT');
  assert.throws(()=>summary(context,null),(error)=>error.code==='INVALID_INPUT');

  const apiBody=baseRecord({eventType:'urine',occurredAt:'2026-08-19T15:00:00+09:00'},requestId(999));apiBody.serviceToken='test-token';
  const apiResponse=JSON.parse(context.doPost({postData:{contents:JSON.stringify(apiBody)}}).getContent());
  assert.strictEqual(apiResponse.success,true,'Pet doPost dispatch');
  const unauthorized=JSON.parse(context.doPost({postData:{contents:JSON.stringify({...apiBody,clientRequestId:requestId(998),serviceToken:'wrong'})}}).getContent());
  assert.strictEqual(unauthorized.error.code,'UNAUTHORIZED','Pet service token boundary');
}

{
  const {context,spreadsheet}=createHarness(),expected=spreadsheet.sheets.Pet_Health_Events.values[0].slice();
  spreadsheet.sheets.Pet_Health_Events.values[0].splice(-2);
  context.setupHealthSchema_();
  assert.deepStrictEqual(spreadsheet.sheets.Pet_Health_Events.values[0],expected,'Pet schema migration appends only the missing tail');
  const first=spreadsheet.sheets.Pet_Health_Events.values[0][0];
  spreadsheet.sheets.Pet_Health_Events.values[0][0]=spreadsheet.sheets.Pet_Health_Events.values[0][1];
  spreadsheet.sheets.Pet_Health_Events.values[0][1]=first;
  assert.throws(()=>context.healthSheet_('Pet_Health_Events'),(error)=>error.code==='CONFIGURATION_ERROR','Pet schema header reorder must fail closed');
}

console.log('PASS Pet Health PH-D01..15, PH-T01..04, PH-I01..13, PH-S01..10, schema, token, and dispatch');

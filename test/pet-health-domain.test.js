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
function baseCorrect(event,correctionOfEventId,id=requestId(1),homeId='home-main'){
  return {operation:'pet.health.correct',homeId,actorUserId:'father',source:'manual',clientRequestId:id,petId:'popio',correctionOfEventId,event};
}
function baseVoid(correctionOfEventId,id=requestId(1),homeId='home-main'){
  return {operation:'pet.health.void',homeId,actorUserId:'father',source:'manual',clientRequestId:id,petId:'popio',correctionOfEventId};
}
const fixedNow='2026-08-19T12:00:00+09:00';
function normalize(context,event){return context.petHealthNormalizeRecordRequest_(baseRecord(event),new Date(fixedNow),{});}
function invalid(context,event){assert.throws(()=>normalize(context,event),(error)=>error.code==='INVALID_INPUT');}
function record(context,body,now=fixedNow){return context.petHealthRecord_(body,{now:()=>new Date(now)});}
function correct(context,body,now=fixedNow){return context.petHealthCorrect_(body,{now:()=>new Date(now)});}
function voidEvent(context,body,now=fixedNow){return context.petHealthVoid_(body,{now:()=>new Date(now)});}
function summary(context,localDate,homeId='home-main'){
  const body={operation:'pet.health.getDailySummary',homeId,actorUserId:'father',petId:'popio'};
  if(localDate!==undefined)body.localDate=localDate;
  return context.petHealthSummary_(body,{now:()=>new Date('2026-08-22T12:00:00+09:00')});
}
function recent(context,days=7,homeId='home-main',now='2026-08-21T12:00:00+09:00'){
  return context.petHealthRecentEvents_({operation:'pet.health.listRecentEvents',homeId,actorUserId:'father',petId:'popio',days},{now:()=>new Date(now)});
}
function dashboard(context,localDate='2026-08-21',homeId='home-main'){
  return context.petHealthDashboard_({operation:'pet.health.getDashboard',homeId,actorUserId:'father',petId:'popio',localDate},{now:()=>new Date(localDate+'T12:00:00+09:00')});
}

{
  const {context,spreadsheet}=createHarness();
  assert.deepStrictEqual(spreadsheet.sheets.Pet_Health_Events.values[0],['eventId','homeId','petId','eventType','occurredAt','occurredAtSource','localDate','mealSlot','amountG','completion','amountMl','stoolForm','stoolAmount','coprophagy','urineStatus','weightKg','energy','appetite','flagsJson','note','source','recordedBy','recordedAt','clientRequestId','requestHash','remainingMl','newFillMl','correctionType','correctionOfEventId']);
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
  assert.deepStrictEqual(plain(normalize(context,{eventType:'water_bottle',newFillMl:400}).event.eventData),{newFillMl:400},'PH-W01 first bottle set payload');
  assert.deepStrictEqual(plain(normalize(context,{eventType:'water_bottle',newFillMl:400,remainingMl:130}).event.eventData),{newFillMl:400,remainingMl:130},'PH-W02 exchange payload');
  invalid(context,{eventType:'water_bottle',newFillMl:400.5});
  invalid(context,{eventType:'water_bottle',newFillMl:0});
  invalid(context,{eventType:'water_bottle',newFillMl:5001});
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
  const {context,spreadsheet}=createHarness(),body=baseRecord({eventType:'meal',mealSlot:'breakfast',amountG:20,completion:'finished'},requestId(49)),events=spreadsheet.sheets.Pet_Health_Events,logs=spreadsheet.sheets.Pet_Health_Request_Log;
  record(context,body);
  const table=context.healthMap_(events),localDateIndex=table.map.localDate,stringRow=events.values[1].slice(),dateRow=events.values[1].slice();
  dateRow[localDateIndex]=new Date('2026-08-18T15:00:00.000Z');
  assert.deepStrictEqual(plain(context.petHealthStoredEvent_(table,dateRow)),plain(context.petHealthStoredEvent_(table,stringRow)),'PH-I14 Date and string stored Events canonicalize identically');
  events.values[1][localDateIndex]=dateRow[localDateIndex];
  const replayed=record(context,body,'2026-08-19T14:00:00+09:00');
  assert.strictEqual(replayed.data.idempotency.replayed,true,'PH-I14 legacy Date localDate replays');
  assert.strictEqual(replayed.data.event.localDate,'2026-08-19','PH-I14 response localDate is canonical string');
  assert.strictEqual(events.getLastRow(),2,'PH-I14 Event remains single');
  assert.strictEqual(logs.getLastRow(),2,'PH-I14 Request Log remains single');
}

{
  const {context,spreadsheet}=createHarness(),body=baseRecord({eventType:'meal',mealSlot:'breakfast',amountG:20,completion:'finished'},requestId(50)),events=spreadsheet.sheets.Pet_Health_Events,logs=spreadsheet.sheets.Pet_Health_Request_Log;
  record(context,body);
  const replayed=record(context,body,'2026-08-19T14:00:00+09:00');
  assert.strictEqual(replayed.data.idempotency.replayed,true,'PH-I15 canonical string localDate replays');
  assert.strictEqual(replayed.data.event.localDate,'2026-08-19','PH-I15 response localDate remains canonical string');
  assert.strictEqual(events.getLastRow(),2,'PH-I15 Event remains single');
  assert.strictEqual(logs.getLastRow(),2,'PH-I15 Request Log remains single');
}

{
  const {context,spreadsheet}=createHarness(),body=baseRecord({eventType:'meal',mealSlot:'breakfast',amountG:20,completion:'finished'},requestId(51)),events=spreadsheet.sheets.Pet_Health_Events,logs=spreadsheet.sheets.Pet_Health_Request_Log;
  record(context,body);
  events.values[1][events.values[0].indexOf('localDate')]='2026/08/19';
  assert.throws(()=>record(context,body,'2026-08-19T14:00:00+09:00'),(error)=>error.code==='DATA_INTEGRITY_ERROR','PH-I16 invalid stored localDate fails closed');
  assert.strictEqual(events.getLastRow(),2,'PH-I16 Event remains single');
  assert.strictEqual(logs.getLastRow(),2,'PH-I16 Request Log remains single');
}

{
  const {context,spreadsheet}=createHarness();
  assert.throws(()=>record(context,baseRecord({eventType:'water_bottle',occurredAt:'2026-08-19T07:00:00+09:00',remainingMl:130,newFillMl:400},requestId(59)),'2026-08-22T12:00:00+09:00'),(error)=>error.code==='INVALID_INPUT','first bottle set must omit remaining');
  const first=baseRecord({eventType:'water_bottle',occurredAt:'2026-08-19T08:00:00+09:00',newFillMl:400},requestId(60));
  const firstResponse=record(context,first,'2026-08-22T12:00:00+09:00');
  assert.strictEqual(firstResponse.data.event.eventType,'water_bottle','PH-W01 first set event type');
  assert.strictEqual(firstResponse.data.event.newFillMl,400,'PH-W01 first set new fill');
  assert.strictEqual(Object.hasOwn(firstResponse.data.event,'remainingMl'),false,'PH-W01 first set must omit remaining');

  const second=baseRecord({eventType:'water_bottle',occurredAt:'2026-08-20T02:00:00+09:00',remainingMl:130,newFillMl:400},requestId(61));
  const secondResponse=record(context,second,'2026-08-22T12:00:00+09:00');
  assert.strictEqual(secondResponse.data.event.remainingMl,130,'PH-W02 second exchange remaining');
  assert.throws(()=>record(context,baseRecord({eventType:'water_bottle',occurredAt:'2026-08-20T03:00:00+09:00',newFillMl:400},requestId(62)),'2026-08-22T12:00:00+09:00'),(error)=>error.code==='INVALID_INPUT','subsequent bottle exchange requires remaining');
  assert.throws(()=>record(context,baseRecord({eventType:'water_bottle',occurredAt:'2026-08-20T03:00:00+09:00',remainingMl:401,newFillMl:400},requestId(63)),'2026-08-22T12:00:00+09:00'),(error)=>error.code==='INVALID_INPUT','PH-W03 remaining cannot exceed previous fill');
  assert.throws(()=>record(context,baseRecord({eventType:'water_bottle',occurredAt:'2026-08-20T02:00:00+09:00',remainingMl:130,newFillMl:400},requestId(64)),'2026-08-22T12:00:00+09:00'),(error)=>error.code==='INVALID_INPUT','PH-W04 equal occurredAt must fail');
  assert.throws(()=>record(context,baseRecord({eventType:'water_bottle',occurredAt:'2026-08-19T23:00:00+09:00',remainingMl:130,newFillMl:400},requestId(65)),'2026-08-22T12:00:00+09:00'),(error)=>error.code==='INVALID_INPUT','PH-W09 old-date append must fail');

  const interval=summary(context,'2026-08-20').data.waterBottle.latestInterval;
  assert.strictEqual(interval.bottleDecreaseMl,270,'PH-W05 bottle decrease');
  assert.strictEqual(interval.elapsedHours,18,'PH-W06 elapsed hours');
  assert.strictEqual(interval.normalized24hMl,360,'PH-W07 normalized 24h');
  const direct=record(context,baseRecord({eventType:'water',occurredAt:'2026-08-20T04:00:00+09:00',amountMl:150},requestId(66)),'2026-08-22T12:00:00+09:00');
  assert.strictEqual(direct.data.event.amountMl,150,'PH-W08 legacy direct water records unchanged');
  assert.strictEqual(summary(context,'2026-08-20').data.water.totalAmountMl,150,'PH-W08 legacy water summary unchanged');
  const replay=record(context,second,'2026-08-22T13:00:00+09:00');
  assert.strictEqual(replay.data.idempotency.replayed,true,'PH-W10 bottle retry replays');
  assert.strictEqual(spreadsheet.sheets.Pet_Health_Events.getLastRow(),4,'PH-W10 retry must not append Event');
  assert.strictEqual(spreadsheet.sheets.Pet_Health_Request_Log.getLastRow(),4,'PH-W10 retry must not append Request Log');
}

{
  const {context}=createHarness();
  let next=70;
  const add=(event)=>record(context,baseRecord(event,requestId(next++)),'2026-08-22T12:00:00+09:00');
  const none=summary(context,'2026-08-19').data.waterBottle;
  assert.deepStrictEqual(plain(none),{eventCount:0,latest:null,latestInterval:null},'PH-WS01 no bottle events');
  add({eventType:'water_bottle',occurredAt:'2026-08-19T08:00:00+09:00',newFillMl:400});
  const firstOnly=summary(context,'2026-08-19').data.waterBottle;
  assert.deepStrictEqual(plain(firstOnly),{eventCount:1,latest:{eventId:firstOnly.latest.eventId,occurredAt:'2026-08-19T08:00:00+09:00',newFillMl:400},latestInterval:null},'PH-WS02 first set only');
  add({eventType:'water_bottle',occurredAt:'2026-08-20T02:00:00+09:00',remainingMl:130,newFillMl:400});
  const latest=summary(context,'2026-08-20').data.waterBottle;
  assert.strictEqual(latest.eventCount,1,'PH-WS03 daily event count');
  assert.strictEqual(latest.latest.newFillMl,400,'PH-WS03 latest fill');
  assert.deepStrictEqual(plain(latest.latestInterval),{bottleDecreaseMl:270,elapsedHours:18,normalized24hMl:360},'PH-WS03 latest interval');
  add({eventType:'water_bottle',occurredAt:'2026-08-21T02:00:00+09:00',remainingMl:100,newFillMl:350});
  const latestOfMany=summary(context,'2026-08-21').data.waterBottle;
  assert.strictEqual(latestOfMany.latest.newFillMl,350,'PH-WS04 newest bottle selected');
  assert.deepStrictEqual(plain(latestOfMany.latestInterval),{bottleDecreaseMl:300,elapsedHours:24,normalized24hMl:300},'PH-WS04 newest interval selected');
  add({eventType:'water',occurredAt:'2026-08-21T03:00:00+09:00',amountMl:150});
  assert.deepStrictEqual(plain(summary(context,'2026-08-21').data.water),{eventCount:1,totalAmountMl:150,amountStatus:'complete'},'PH-WS05 legacy water summary unchanged');
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
  const recentApi=JSON.parse(context.doPost({postData:{contents:JSON.stringify({operation:'pet.health.listRecentEvents',serviceToken:'test-token',homeId:'home-main',actorUserId:'father',petId:'popio',days:7})}}).getContent());
  assert.strictEqual(recentApi.success,true,'Recent Event doPost dispatch');
  assert.strictEqual(recentApi.operation,'pet.health.listRecentEvents','Recent Event operation response');
  const dashboardApi=JSON.parse(context.doPost({postData:{contents:JSON.stringify({operation:'pet.health.getDashboard',serviceToken:'test-token',homeId:'home-main',actorUserId:'father',petId:'popio',localDate:'2026-08-19'})}}).getContent());
  assert.strictEqual(dashboardApi.success,true,'Dashboard doPost dispatch');
  assert.strictEqual(dashboardApi.operation,'pet.health.getDashboard','Dashboard operation response');
}

{
  const {context,spreadsheet}=createHarness();
  let next=1200;
  const add=(event,homeId='home-main')=>record(context,baseRecord(event,requestId(next++),homeId),'2026-08-21T23:00:00+09:00');
  add({eventType:'water_bottle',occurredAt:'2026-08-14T08:00:00+09:00',newFillMl:400});
  add({eventType:'water_bottle',occurredAt:'2026-08-15T08:00:00+09:00',remainingMl:130,newFillMl:400,note:'交換'});
  add({eventType:'observation',occurredAt:'2026-08-16T09:00:00+09:00',energy:'normal',flags:['vomiting'],note:'観察'});
  add({eventType:'weight',occurredAt:'2026-08-17T10:00:00+09:00',weightKg:2.3});
  add({eventType:'urine',occurredAt:'2026-08-18T11:00:00+09:00',urineStatus:'concern'});
  add({eventType:'water',occurredAt:'2026-08-19T12:00:00+09:00',amountMl:150});
  add({eventType:'stool',occurredAt:'2026-08-20T13:00:00+09:00',stoolForm:'banana',stoolAmount:'normal',coprophagy:false});
  add({eventType:'meal',occurredAt:'2026-08-21T14:00:00+09:00',mealSlot:'breakfast',amountG:20,completion:'finished',note:'朝'});
  add({eventType:'meal',occurredAt:'2026-08-21T15:00:00+09:00',mealSlot:'dinner',amountG:999,completion:'finished'},'other-home');
  const eventSheet=spreadsheet.sheets.Pet_Health_Events,petIdColumn=eventSheet.values[0].indexOf('petId'),otherPet=eventSheet.values[eventSheet.values.length-2].slice();
  otherPet[petIdColumn]='other-pet';
  eventSheet.values.push(otherPet);

  const value=recent(context).data;
  assert.strictEqual(value.days,7,'PH-R01 fixed seven-day response');
  assert.strictEqual(value.fromLocalDate,'2026-08-15','PH-R01 from boundary');
  assert.strictEqual(value.toLocalDate,'2026-08-21','PH-R01 inclusive today');
  assert.strictEqual(value.events.length,7,'PH-R01 latest seven local dates');
  assert.strictEqual(value.events.some((event)=>event.localDate==='2026-08-14'),false,'PH-R02 older event included');
  assert.strictEqual(value.events.some((event)=>event.amountG===999),false,'PH-R03 other home leaked');
  assert.strictEqual(value.events.some((event)=>event.petId==='other-pet'),false,'PH-R04 other pet leaked');
  assert.deepStrictEqual(plain(value.events.map((event)=>event.localDate)),['2026-08-21','2026-08-20','2026-08-19','2026-08-18','2026-08-17','2026-08-16','2026-08-15'],'PH-R05 occurredAt DESC');
  const meal=value.events[0];
  assert.deepStrictEqual(plain(meal),{eventId:meal.eventId,eventType:'meal',occurredAt:'2026-08-21T14:00:00+09:00',localDate:'2026-08-21',recordedAt:meal.recordedAt,mealSlot:'breakfast',amountG:20,completion:'finished',note:'朝'},'PH-R06 sanitized meal shape');
  ['homeId','actorUserId','recordedBy','clientRequestId','requestHash','source'].forEach((field)=>assert.strictEqual(Object.hasOwn(meal,field),false,`PH-R06 leaked ${field}`));
  assert.deepStrictEqual(Array.from(new Set(value.events.map((event)=>event.eventType))).sort(),['meal','observation','stool','urine','water','water_bottle','weight'],'PH-R07 all event types');
  assert.strictEqual(value.events.find((event)=>event.eventType==='water').amountMl,150,'PH-R08 legacy water');
  const bottle=value.events.find((event)=>event.eventType==='water_bottle');
  assert.deepStrictEqual({bottleDecreaseMl:bottle.bottleDecreaseMl,elapsedHours:bottle.elapsedHours,normalized24hMl:bottle.normalized24hMl},{bottleDecreaseMl:270,elapsedHours:24,normalized24hMl:270},'PH-R09 water bottle interval');
  let snapshotReads=0;
  const originalScopedEvents=context.petHealthScopedEvents_;
  context.petHealthScopedEvents_=function(homeId,petId){snapshotReads+=1;return originalScopedEvents(homeId,petId);};
  const dashboardValue=dashboard(context).data;
  assert.strictEqual(snapshotReads,1,'PH-DASH02 Dashboard reads the Pet Event Sheet once');
  assert.strictEqual(dashboardValue.petId,'popio','PH-DASH01 Dashboard pet');
  assert.strictEqual(dashboardValue.localDate,'2026-08-21','PH-DASH01 Dashboard local date');
  assert.strictEqual(dashboardValue.summary.meal.eventCount,1,'PH-DASH01 Dashboard summary');
  assert.deepStrictEqual(plain(dashboardValue.recentEvents),plain(value.events),'PH-DASH01 Dashboard recent events use the same snapshot');
  assert.strictEqual(dashboardValue.summary.waterBottle.latest.newFillMl,400,'PH-DASH05 Dashboard water bottle state');
  assert.strictEqual(dashboardValue.summary.latestWeight.weightKg,2.3,'PH-DASH06 Dashboard latest weight');
  assert.strictEqual(dashboardValue.recentEvents.some((event)=>event.amountG===999),false,'PH-DASH03 Dashboard home isolation');
  assert.strictEqual(dashboardValue.recentEvents.some((event)=>event.petId==='other-pet'),false,'PH-DASH04 Dashboard pet isolation');
  assert.throws(()=>recent(context,6),(error)=>error.code==='INVALID_INPUT','Recent days must be fixed at seven');
  assert.throws(()=>recent(context,'7'),(error)=>error.code==='INVALID_INPUT','Recent days must be JSON number');
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

{
  const {context,spreadsheet}=createHarness(),now='2026-08-22T12:00:00+09:00';
  const original=record(context,baseRecord({eventType:'meal',occurredAt:'2026-08-20T08:00:00+09:00',mealSlot:'breakfast',amountG:20,completion:'finished'},requestId(200)),now);
  const originalId=original.data.event.eventId;
  assert.throws(()=>correct(context,baseCorrect({eventType:'meal',mealSlot:'breakfast',amountG:18,completion:'finished'},originalId,requestId(200)),now),(error)=>error.code==='IDEMPOTENCY_CONFLICT','PH-C11 reused request ID with a different correction request conflicts');
  const firstCorrection=correct(context,baseCorrect({eventType:'meal',occurredAt:'2026-08-20T08:00:00+09:00',mealSlot:'breakfast',amountG:18,completion:'finished'},originalId,requestId(201)),now);
  assert.strictEqual(firstCorrection.operation,'pet.health.correct','PH-C02 correction operation');
  assert.strictEqual(firstCorrection.data.event.amountG,18,'PH-C02 corrected meal amount');
  assert.strictEqual(firstCorrection.data.event.occurredAt,'2026-08-20T08:00:00+09:00','PH-C03 corrected occurredAt');
  assert.strictEqual(spreadsheet.sheets.Pet_Health_Events.getLastRow(),3,'PH-C01/02 append-only correction');
  assert.strictEqual(summary(context,'2026-08-20').data.meal.totalAmountG,18,'PH-C04/CR01 original excluded from effective summary');
  assert.strictEqual(recent(context,7,'home-main','2026-08-21T12:00:00+09:00').data.events[0].eventId,firstCorrection.data.event.eventId,'PH-CR02 recent returns the effective correction');
  const secondCorrection=correct(context,baseCorrect({eventType:'meal',occurredAt:'2026-08-20T09:00:00+09:00',mealSlot:'breakfast',amountG:17,completion:'finished'},firstCorrection.data.event.eventId,requestId(202)),now);
  assert.strictEqual(summary(context,'2026-08-20').data.meal.totalAmountG,17,'PH-C05 second correction wins');
  const correctionReplay=correct(context,baseCorrect({eventType:'meal',occurredAt:'2026-08-20T09:00:00+09:00',mealSlot:'breakfast',amountG:17,completion:'finished'},firstCorrection.data.event.eventId,requestId(202)),now);
  assert.strictEqual(correctionReplay.data.idempotency.replayed,true,'PH-C11 correction retry replays');
  assert.strictEqual(spreadsheet.sheets.Pet_Health_Events.getLastRow(),4,'PH-C11 correction retry does not append');
  const voidResponse=voidEvent(context,baseVoid(secondCorrection.data.event.eventId,requestId(203)),now);
  assert.strictEqual(voidResponse.operation,'pet.health.void','PH-C07 void corrected event');
  assert.strictEqual(summary(context,'2026-08-20').data.meal.eventCount,0,'PH-C07/CR03 void hides effective event');
  assert.strictEqual(recent(context,7,'home-main','2026-08-21T12:00:00+09:00').data.events.length,0,'PH-CR03 void hidden from recent history');
  assert.throws(()=>correct(context,baseCorrect({eventType:'meal',mealSlot:'breakfast',completion:'finished'},requestId(299),requestId(204)),now),(error)=>error.code==='INVALID_INPUT','PH-C08 nonexistent target rejects');
  assert.throws(()=>correct(context,baseCorrect({eventType:'water',amountMl:150},originalId,requestId(205)),now),(error)=>error.code==='INVALID_INPUT','PH-C10 event type mismatch rejects');
  const rawCycle=[
    {eventId:requestId(210),eventType:'stool',correctionType:'correction',correctionOfEventId:requestId(211),instantMs:1},
    {eventId:requestId(211),eventType:'stool',correctionType:'correction',correctionOfEventId:requestId(210),instantMs:2},
  ];
  assert.throws(()=>context.petHealthResolveEffectiveEvents_(rawCycle),(error)=>error.code==='DATA_INTEGRITY_ERROR','PH-C09/C12 self or cycle fails closed');
}

{
  const {context}=createHarness(),now='2026-08-22T12:00:00+09:00';
  const original=record(context,baseRecord({eventType:'meal',occurredAt:'2026-08-20T08:00:00+09:00',mealSlot:'breakfast',amountG:20,completion:'finished'},requestId(220)),now);
  const voidResponse=voidEvent(context,baseVoid(original.data.event.eventId,requestId(221)),now);
  assert.strictEqual(voidResponse.data.event.eventType,'meal','PH-C06 void event keeps only target type');
  assert.deepStrictEqual(Object.keys(voidResponse.data.event).filter((key)=>['mealSlot','amountG','completion','note'].indexOf(key)>=0),[],'PH-C06 void has no meal business payload');
  assert.strictEqual(summary(context,'2026-08-20').data.meal.bySlot.breakfast.eventCount,0,'PH-CR05 voided breakfast is missing for reminder data');
}

{
  const {context}=createHarness(),now='2026-08-22T12:00:00+09:00';
  const original=record(context,baseRecord({eventType:'weight',occurredAt:'2026-08-20T08:00:00+09:00',weightKg:2.3},requestId(225)),now);
  const corrected=correct(context,baseCorrect({eventType:'weight',occurredAt:'2026-08-20T09:00:00+09:00',weightKg:2.2},original.data.event.eventId,requestId(226)),now);
  const value=summary(context,'2026-08-20').data;
  assert.strictEqual(value.latestWeight.eventId,corrected.data.event.eventId,'PH-CR04 latest weight uses the effective correction');
  assert.strictEqual(value.latestWeight.weightKg,2.2,'PH-CR04 corrected latest weight value');
}

{
  const {context}=createHarness(),now='2026-08-22T12:00:00+09:00';
  const first=record(context,baseRecord({eventType:'water_bottle',occurredAt:'2026-08-19T08:00:00+09:00',newFillMl:400},requestId(230)),now);
  const second=record(context,baseRecord({eventType:'water_bottle',occurredAt:'2026-08-20T08:00:00+09:00',remainingMl:100,newFillMl:400},requestId(231)),now);
  assert.strictEqual(summary(context,'2026-08-20').data.waterBottle.latestInterval.bottleDecreaseMl,300,'PH-C13 baseline bottle interval');
  const correction=correct(context,baseCorrect({eventType:'water_bottle',occurredAt:'2026-08-20T08:00:00+09:00',remainingMl:130,newFillMl:400},second.data.event.eventId,requestId(232)),now);
  assert.strictEqual(summary(context,'2026-08-20').data.waterBottle.latestInterval.bottleDecreaseMl,270,'PH-C13 bottle correction recalculates interval');
  voidEvent(context,baseVoid(correction.data.event.eventId,requestId(233)),now);
  const bottle=summary(context,'2026-08-20').data.waterBottle;
  assert.strictEqual(bottle.latest.eventId,first.data.event.eventId,'PH-C14 bottle void restores the effective predecessor');
  assert.strictEqual(bottle.latestInterval,null,'PH-C14 bottle void removes the derived interval');
}

console.log('PASS Pet Health PH-D01..15, PH-T01..04, PH-I01..16, PH-S01..10, PH-W01..10, PH-WS01..05, PH-R01..09, PH-DASH01..06, schema, token, and dispatch');

'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const vm = require('vm');

class Range { constructor(sheet,row,column,rowCount,columnCount){this.sheet=sheet;this.row=row;this.column=column;this.rowCount=rowCount;this.columnCount=columnCount;} getValues(){return Array.from({length:this.rowCount},(_,i)=>Array.from({length:this.columnCount},(_,j)=>this.sheet.values[this.row-1+i]?.[this.column-1+j]??''));} setValues(values){values.forEach((row,i)=>row.forEach((value,j)=>{(this.sheet.values[this.row-1+i]||=[])[this.column-1+j]=value;}));} }
class Sheet { constructor(){this.values=[];} getLastColumn(){return Math.max(0,...this.values.map((row)=>row.length));} getLastRow(){return this.values.length;} getRange(...args){return new Range(this,...args);} getDataRange(){return new Range(this,1,1,Math.max(1,this.getLastRow()),Math.max(1,this.getLastColumn()));} appendRow(row){this.values.push(row);} setFrozenRows(){} }
class Spreadsheet { constructor(){this.sheets={};} getSheetByName(name){return this.sheets[name]||null;} insertSheet(name){return this.sheets[name]=new Sheet();} }

const spreadsheet = new Spreadsheet();
const context = {
  JSON, Number, String, Object, Array, Date, Math, RegExp,
  Utilities: { getUuid: () => crypto.randomUUID(), formatDate: (_date,_zone,format) => format === 'yyyy-MM-dd' ? '2026-07-29' : '2026-07-29T12:00:00+09:00', base64Encode: (value) => Buffer.from(value).toString('base64'), computeDigest: (_algorithm,value) => crypto.createHash('sha256').update(value).digest(), DigestAlgorithm:{SHA_256:'sha256'}, Charset:{UTF_8:'utf8'} },
  PropertiesService:{getScriptProperties:()=>({getProperty:(key)=>key==='HEALTH_SPREADSHEET_ID'?'sheet':key==='HEALTH_SERVICE_TOKEN'?'test-token':''})},
  SpreadsheetApp:{openById:()=>spreadsheet}, LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
  ContentService:{MimeType:{JSON:'application/json'},createTextOutput:(text)=>({text,setMimeType(){return this;},getContent(){return this.text;}})},
};
vm.createContext(context);
['HealthSetup.js','HealthSecurity.js','HealthRuleService.js','HealthDataService.js'].forEach((file)=>vm.runInContext(fs.readFileSync(`gas-health/${file}`,'utf8'),context));
vm.runInContext(fs.readFileSync('gas-health/Code.js','utf8'),context);
context.setupHealthSchema_();

const base = { homeId:'home', actorUserId:'self', targetUserId:'self', localDate:'2026-07-29' };
function save(slot, payload) { return context.dailyRecord_(Object.assign({}, base, { slot, payload, clientRequestId:crypto.randomUUID() })); }
function daily() { return context.dailyGet_(base); }

const initialDaily = daily();
assert.deepStrictEqual(JSON.parse(JSON.stringify(initialDaily.slots)),{},'header-only Health_Daily must return an empty slots object');
assert(initialDaily.ruleCodes.includes('morning_not_recorded'),'initial daily rules must treat every slot as unrecorded');
assert.strictEqual(spreadsheet.sheets.Health_Daily.getLastRow(),1,'daily get must not create an initial Health_Daily row');
const initialResponse=JSON.parse(context.doPost({postData:{contents:JSON.stringify(Object.assign({operation:'health.daily.get',serviceToken:'test-token'},base))}}).getContent());
assert.strictEqual(initialResponse.success,true,'header-only Health_Daily must be a successful health.daily.get response');
assert.deepStrictEqual(JSON.parse(JSON.stringify(initialResponse.data.slots)),{},'initial API response must contain empty slots');

let value = save('morning',{morningStaple:'small',morningProteinSource:'egg',morningWater:true,morningMedication:true,morningCondition:true,morningMealType:'banana_1',morningWaterType:'milk_glass_1',morningConditionType:'good'});
assert.strictEqual(spreadsheet.sheets.Health_Daily.getLastRow(),2,'first slot save must create the initial Health_Daily row');
assert.deepStrictEqual(JSON.parse(JSON.stringify(value.slots.morning)),{morningStaple:'small',morningProteinSource:'egg',morningWater:true,morningMedication:true,morningCondition:true,morningMealType:'banana_1',morningMealOther:'',morningWaterType:'milk_glass_1',morningWaterOther:'',morningConditionType:'good',morningConditionOther:'',recordedAt:'2026-07-29T12:00:00+09:00',recordedBy:'self'});
value = save('lunch',{lunchAmount:'all',lunchProteinSource:'included',lunchWater:true,lunchCondition:false,lunchMealType:'bento',lunchWaterType:'sports_drink_bottle_1'});
assert.strictEqual(daily().slots.lunch.lunchWater,true,'school water did not survive reload');
value = save('post_training',{postTrainingStatus:'recorded',postTrainingOnigiriCount:1,postTrainingProteinSource:'protein',postTrainingWater:false,postTrainingCondition:false,postTrainingSnackType:'onigiri_1',postTrainingProteinAmount:'30'});
assert.strictEqual(daily().slots.post_training.postTrainingProteinSource,'protein');
assert.strictEqual(daily().slots.post_training.postTrainingOnigiriCount,1,'club snack was lost when protein was saved');
value = save('dinner',{dinnerRiceBowls:1,dinnerNattoPacks:2,dinnerExtraProteinSource:'fish',dinnerMedication:true,bedtime:true,dinnerMealType:'rice_2_fish'});
assert.deepStrictEqual(JSON.parse(JSON.stringify(daily().slots.dinner)),{dinnerRiceBowls:1,dinnerNattoPacks:2,dinnerExtraProteinSource:'fish',dinnerMedication:true,bedtime:true,dinnerMealType:'rice_2_fish',dinnerMealOther:'',recordedAt:'2026-07-29T12:00:00+09:00',recordedBy:'self'});

value = save('morning',{morningStaple:'none',morningProteinSource:'egg',morningWater:false,morningMedication:true,morningCondition:false});
assert.strictEqual(daily().slots.morning.morningMealType,'banana_1','unchecked meal erased stored detail');
value = save('morning',{morningStaple:'normal',morningProteinSource:'egg',morningWater:true,morningMedication:true,morningCondition:true,morningMealType:'other',morningMealOther:'焼きそばパン',morningWaterType:'milk_glass_1',morningConditionType:'good'});
assert.strictEqual(daily().slots.morning.morningMealOther,'焼きそばパン','other text did not survive reload');
assert.throws(()=>save('morning',{morningStaple:'normal',morningProteinSource:'none',morningWater:false,morningMedication:false,morningCondition:false,morningMealType:'other'}),(error)=>error.code==='INVALID_INPUT','other without text was accepted');

assert.throws(()=>save('morning',{morningStaple:'normal',morningProteinSource:'none',morningWater:'true',morningMedication:false,morningCondition:false}),(error)=>error.code==='INVALID_INPUT','boolean validation accepted string input');
const headers = spreadsheet.sheets.Health_Daily.values[0];
['morningWater','morningMedication','morningCondition','lunchWater','lunchCondition','postTrainingWater','postTrainingCondition','dinnerMedication','bedtime','morningMealType','morningMealOther','morningWaterType','morningWaterOther','morningConditionType','morningConditionOther','lunchMealType','lunchMealOther','lunchWaterType','lunchWaterOther','lunchConditionType','lunchConditionOther','postTrainingSnackType','postTrainingSnackOther','postTrainingWaterType','postTrainingWaterOther','postTrainingProteinAmount','postTrainingProteinOther','postTrainingConditionType','postTrainingConditionOther','dinnerMealType','dinnerMealOther'].forEach((header)=>assert(headers.includes(header),`${header} header missing`));
const legacy = new Array(headers.length).fill('');
const index = headers.reduce((out,header,position)=>(out[header]=position,out),{});
Object.assign(legacy,{[index.recordId]:'legacy',[index.homeId]:'home',[index.targetUserId]:'legacy-user',[index.localDate]:'2026-07-29',[index.morningStaple]:'normal',[index.morningProteinSource]:'egg',[index.morningRecordedAt]:'2026-07-29T07:00:00+09:00',[index.morningRecordedBy]:'legacy'});
spreadsheet.sheets.Health_Daily.appendRow(legacy);
const legacyDaily = context.dailyGet_({homeId:'home',targetUserId:'legacy-user',localDate:'2026-07-29'});
assert.strictEqual(legacyDaily.slots.morning.morningWater,false,'legacy blank water was not read as unchecked');
assert.strictEqual(legacyDaily.slots.morning.morningMedication,false,'legacy blank medication was not read as unchecked');
assert.strictEqual(legacyDaily.slots.morning.morningStaple,'normal','legacy detailed value changed');
console.log('PASS Health_Daily checkbox persistence, validation, reload, and legacy blanks');

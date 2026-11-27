'use strict';
const fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
class Range {
  constructor(sheet,r,c,rs,cs){Object.assign(this,{sheet,r,c,rs,cs});}
  getValues(){return Array.from({length:this.rs},(_,i)=>Array.from({length:this.cs},(_,j)=>this.sheet.values[this.r-1+i]?.[this.c-1+j]??''));}
  setValues(values){values.forEach((row,i)=>row.forEach((value,j)=>{(this.sheet.values[this.r-1+i]||=[])[this.c-1+j]=value;}));}
}
class Sheet {
  constructor(){this.values=[];this.loseResponse=false;}
  getLastRow(){return this.values.length;} getLastColumn(){return this.values[0]?.length||0;}
  getRange(r,c,rs,cs){return new Range(this,r,c,rs,cs);}
  getDataRange(){return this.getRange(1,1,Math.max(1,this.getLastRow()),Math.max(1,this.getLastColumn()));}
  appendRow(row){this.values.push(row);if(this.loseResponse){this.loseResponse=false;throw Error('synthetic lost response');}}
  setFrozenRows(){}
}
function fixture(){
  const sheets={},ss={getSheetByName:name=>sheets[name]||null,insertSheet:name=>sheets[name]=new Sheet()};
  const service={Date,JSON,Number,String,Object,Array,Math,RegExp,Error,
    SpreadsheetApp:{openById:()=>ss},PropertiesService:{getScriptProperties:()=>({getProperty:()=> 'synthetic-store'})},
    LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
    Utilities:{getUuid:()=>crypto.randomUUID()},healthMap_(sheet){const values=sheet.getDataRange().getValues(),map={};values[0].forEach((h,i)=>map[h]=i);return {values,map};},
    healthObject_(table,row){return Object.fromEntries(Object.entries(table.map).map(([k,i])=>[k,row[i]]));},
    healthRequestHash_(body,payload){return crypto.createHash('sha256').update(JSON.stringify({operation:body.operation,home:body.homeId,actor:body.actorUserId,target:body.targetUserId,payload})).digest('hex');}
  };
  vm.createContext(service);
  ['MedicationRoutineDomain.js','MedicationRoutineService.js','Code.js'].forEach(name=>vm.runInContext(fs.readFileSync('gas-health/'+name,'utf8'),service));
  service.healthToken_=body=>{if(body.serviceToken!=='synthetic-service'){const e=Error('UNAUTHORIZED');e.code='UNAUTHORIZED';throw e;}};
  service.healthJson_=value=>value;
  let now='2030-04-03T11:00:00Z';service.medicationNow_=()=>now;
  const members={guardian:{homeId:'synthetic-home',memberUserId:'guardian',role:'guardian',status:'active'},
    self:{homeId:'synthetic-home',memberUserId:'self',role:'self_record',status:'active'},
    baseline:{homeId:'synthetic-home',memberUserId:'baseline',role:'',status:'active'},
    peer:{homeId:'synthetic-home',memberUserId:'peer',role:'guardian',status:'active'},
    disabled:{homeId:'synthetic-home',memberUserId:'disabled',role:'self_record',status:'disabled'},
    other:{homeId:'other-synthetic-home',memberUserId:'other',role:'self_record',status:'active'}};
  let reached=0;
  const mini={Date,JSON,String,Object,Array,Error,Number,RegExp,
    resolveFirebaseAuthenticatedActor_:body=>{const member=members[body.auth?.idToken];if(!member||member.status!=='active'){const e=Error('AUTH_TOKEN_INVALID');e.code='AUTH_TOKEN_INVALID';throw e;}return member;},
    getActiveSelfRecordMembers_:()=>[{userId:'self',displayName:'対象A'},{userId:'baseline',displayName:'対象B'}],
    PropertiesService:{getScriptProperties:()=>({getProperty:()=> 'https://script.google.com/macros/s/synthetic/exec'})},
    getServiceSecret_:()=> 'synthetic-service',retireLegacyServiceSecret_:()=>{},json_:value=>value,
    UrlFetchApp:{fetch:(_url,options)=>{reached++;const out=service.doPost({postData:{contents:options.payload}});return {getResponseCode:()=>200,getContentText:()=>JSON.stringify(out)};}}
  };
  vm.createContext(mini);vm.runInContext(fs.readFileSync('gas/HomeMembershipService.js','utf8'),mini);
  mini.getHomeMember_=(home,id)=>members[id]?.homeId===home?members[id]:null;
  mini.getActiveSelfRecordMembers_=()=>[{userId:'self',displayName:'対象A'},{userId:'baseline',displayName:'対象B'}];
  mini.isHomeMemberPolicyMatch_=()=>true;
  mini.homeMembershipError_=code=>{const e=Error(code);e.code=code;return e;};
  vm.runInContext(fs.readFileSync('gas/HealthGatewayService.js','utf8'),mini);
  const api=(action,payload={},actor='guardian')=>mini.healthGateway_({auth:{idToken:actor},action,targetMemberUserId:'self',...payload});
  return {service,mini,sheets,setup:()=>service.setupMedicationRoutineSchema(),api,reached:()=>reached,setNow:value=>now=value,
    planId:'11111111-1111-4111-8111-111111111111',uuid:()=>crypto.randomUUID(),date:'2030-04-03',
    plan:{label:'項目A',doseText:'設定内容A',startDate:'2030-04-01',enabled:true,times:{morning:'08:10',evening:'19:20'},weekdayOverrides:{'3':{evening:'20:10'}},timers:{sublingualSeconds:30,foodDrinkMinutes:5,observationMinutes:10,exerciseBathMinutes:15},futureChange:{date:'2030-04-10',note:'設定者が確認する予定'},reminders:{enabled:false,repeatMinutes:0}}};
}
module.exports={fixture};

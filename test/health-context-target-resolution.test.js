'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const forwarded=[];
const ctx={
  JSON,Error,String,Object,
  PropertiesService:{getScriptProperties:()=>({getProperty:key=>key==='HEALTH_WEBAPP_URL'?'https://script.google.com/macros/s/abc/exec':'service-token'})},
  resolveAuthenticatedActor_:()=>({homeId:'home-1',memberUserId:'father',role:'admin'}),
  hasRoleCapability_:()=>true,
  getHomeMember_:(_homeId,userId)=>({memberUserId:userId,displayName:userId}),
  getActiveSelfRecordMembers_:()=>[{userId:'son-a',displayName:'長男'},{userId:'son-b',displayName:'次男'}],
  authorizeTargetOperation_:(actor,target)=>{if(target==='father'||target==='son-a'||target==='son-b')return true;const error=new Error('FORBIDDEN');error.code='FORBIDDEN';throw error;},
  UrlFetchApp:{fetch:(_url,options)=>{forwarded.push(JSON.parse(options.payload));return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({success:true,data:{ok:true}})};}},
  json_:value=>value,
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('gas/HealthGatewayService.js','utf8'),ctx);
let result=ctx.healthGateway_({action:'health.context.get',deviceId:'admin-device',pairingToken:'pair'});
assert.strictEqual(result.success,true,'admin context must succeed without selecting the first target');
assert.strictEqual(forwarded.length,0,'admin context without a target must not fall back to an upstream actor target');
assert.deepStrictEqual(JSON.parse(JSON.stringify(result.data.targets)),[{userId:'son-a',displayName:'長男'},{userId:'son-b',displayName:'次男'}]);
result=ctx.healthGateway_({action:'health.daily.get',deviceId:'admin-device',pairingToken:'pair',targetMemberUserId:'outside'});
assert.strictEqual(result.success,false,'unauthorized target must not be accepted');
assert.strictEqual(result.error.code,'FORBIDDEN');
console.log('PASS Health context target resolution and target authorization');

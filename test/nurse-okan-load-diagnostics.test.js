'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const errors=[];
const ctx={
  console:{error:(...args)=>errors.push(args),info:(...args)=>errors.push(args),log:()=>{}},JSON,Error,Object,String,Array,Number,Promise,
  module:{exports:{}},exports:{},crypto:{randomUUID:()=> '11111111-1111-4111-8111-111111111111'},
  document:{addEventListener:()=>{}},localStorage:{getItem:()=>''},navigator:{onLine:true},location:{hostname:'localhost'}
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('features/nurse-okan/nurse-okan.js','utf8'),ctx);
const api=ctx.module.exports;
assert(api.isHealthDevelopmentMode_(),'localhost must enable Health load diagnostics');
ctx.location.hostname='app.example.test';
assert(!api.isHealthDevelopmentMode_(),'production host must not enable Health load diagnostics');
ctx.location.hostname='localhost';
assert.strictEqual(api.healthInitialLoadFailureMessage_('health.summary.get',new Error('gateway failed')),'Health summary.get取得失敗: gateway failed');
const source=fs.readFileSync('features/nurse-okan/nurse-okan.js','utf8');
assert(source.includes("console.error('[Nurse Okan] Health initial load failed'"),'initial Health load failures must use console.error');
['api:api','code:','message:','stack:','response:'].forEach(fragment=>assert(source.includes(fragment),'Health diagnostic field missing: '+fragment));
api.logHealthContextResponse_(true,'','son-b',[{userId:'son-a'},{userId:'son-b'}],'son-b',{actor:{role:'admin'}},null);
const contextLog=errors.pop();assert.strictEqual(contextLog[0],'[Nurse Okan] health.context.get response');assert.deepStrictEqual(JSON.parse(JSON.stringify(contextLog[1])),{success:true,code:'',targetUserId:'son-b',candidateUsers:[{userId:'son-a'},{userId:'son-b'}],resolvedTargetUserId:'son-b',response:{actor:{role:'admin'}},message:'',stack:''});
assert(source.includes("callInitialHealth_('health.daily.get'"),'daily initial load must be wrapped for diagnostics');
assert(source.includes("logHealthInitialLoadError_('resolveNextHealthTask'"),'routine resolver must be wrapped for diagnostics');
console.log('PASS Nurse Okan initial-load diagnostics');

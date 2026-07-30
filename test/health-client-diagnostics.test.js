'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const source=fs.readFileSync('app.js','utf8');
const start=source.indexOf('async function callHomeControlApi(payload)');
const end=source.indexOf('function getHomeControlPending()',start);
assert(start>=0&&end>start,'health client diagnostic source boundary missing');
const ctx={GAS_WEB_APP_URL:'https://example.invalid/exec',JSON,Error,String,Object,Number,Promise,fetch:async()=>({ok:true,status:200,json:async()=>({success:false,error:{code:'INVALID_INPUT'},message:'target is required'})})};
vm.createContext(ctx);
vm.runInContext(source.slice(start,end),ctx);
(async()=>{
  await assert.rejects(()=>ctx.callHomeControlApi({action:'health.context.get'}),error=>error.code==='INVALID_INPUT'&&error.httpStatus===200&&error.response&&error.response.message==='target is required');
  ctx.fetch=async()=>({ok:false,status:503,clone:()=>({json:async()=>({success:false,error:{code:'HEALTH_UNAVAILABLE'}})})});
  await assert.rejects(()=>ctx.callHomeControlApi({action:'health.daily.get'}),error=>error.code==='HOME_CONTROL_UNAVAILABLE'&&error.httpStatus===503&&error.response&&error.response.error.code==='HEALTH_UNAVAILABLE');
  ctx.fetch=async()=>{throw new Error('network down');};
  await assert.rejects(()=>ctx.callHomeControlApi({action:'health.daily.get'}),error=>error.code==='HOME_CONTROL_UNAVAILABLE'&&error.cause&&error.cause.message==='network down');
  console.log('PASS Health client diagnostics preserve code and response');
})().catch(error=>{console.error(error);process.exitCode=1;});

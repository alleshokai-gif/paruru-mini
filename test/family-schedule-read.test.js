'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
const start=source.indexOf('async function callAuthenticatedFamilySchedule_(');
const end=source.indexOf('\nasync function ',start+10);
const calls=[];
const context={appAuthenticationState:'active_member',activeMembershipContext:{role:'admin'},
  firebaseAuthService:{getAuthEnvelope:async()=>({provider:'firebase',idToken:'synthetic-only'})},
  PALURU_READ_TRANSPORT_V2_CONFIG:{familySchedulesBaseUrl:'https://synthetic.invalid'},
  crypto:require('node:crypto'),AbortController,setTimeout,clearTimeout,
  createHomeControlError:code=>Object.assign(new Error(code),{code}),
  fetch:async(url,opts)=>{calls.push({url,opts});return{ok:true,json:async()=>({schemaVersion:'synthetic'})};}};
context.globalThis=context;vm.createContext(context);vm.runInContext(source.slice(start,end),context);
(async()=>{
  await context.callAuthenticatedFamilySchedule_({period:'2026-11',memberId:'synthetic-child'});
  assert.equal(calls.length,1);assert.equal(calls[0].url,'https://synthetic.invalid/v2/read/family-schedules');
  assert.equal(calls[0].opts.cache,'no-store');assert.equal(calls[0].opts.headers.Authorization,'Bearer synthetic-only');
  assert.equal(JSON.parse(calls[0].opts.body).memberId,'synthetic-child');
  context.activeMembershipContext.role='';
  await assert.rejects(()=>context.callAuthenticatedFamilySchedule_({period:'2026-11'}),{code:'FORBIDDEN'});
  assert.equal(calls.length,1);
  context.activeMembershipContext.role='admin';context.fetch=async()=>({ok:false});
  await assert.rejects(()=>context.callAuthenticatedFamilySchedule_({period:'2026-11'}),{code:'FAMILY_SCHEDULE_UNAVAILABLE'});
  console.log('PASS family snapshot direct auth, no GAS, role gate, no-store and no fallback');
})().catch(e=>{console.error(e);process.exitCode=1;});

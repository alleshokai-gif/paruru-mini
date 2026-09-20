'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createHarness} = require('./fixtures/kaz-progress-harness');
const root=process.env.PALURU_TEST_ROOT || path.resolve(__dirname,'..'), baseRoot=process.env.PALURU_BASE_ROOT;

const snapshot=()=>({
  origin:'notion_official_api',mode:'read_only',fixture_only:false,
  sources:{work_items:{status:'ok',fetch_status:'SUCCESS',complete:true,fetched_at:new Date().toISOString(),
    valid_until:new Date(Date.now()+900000).toISOString(),source_revision:'observation-sha256:work',
    projects_source_revision:'observation-sha256:projects',snapshot_ref:'observation-sha256:work',
    scope:'Notion Work Items · read-only',record_count:2}},
  work_items:[
    {id:'00000000-0000-0000-0000-000000000101',work_id:'WI-14',title:'Synthetic Doing',state:'DOING',
      project_id:'00000000-0000-0000-0000-000000000001',project_name:'PALURU',priority:'HIGH',estimate_min:null,
      deadline:null,scheduled:null,action_type:'ACTION',next_action:'Continue safely',blocker:'',source:'CHATGPT',
      source_revision:new Date().toISOString()},
    {id:'00000000-0000-0000-0000-000000000102',work_id:'WI-18',title:'Synthetic Ready',state:'READY',
      project_id:'00000000-0000-0000-0000-000000000002',project_name:'Kaz OS',priority:'CRITICAL',estimate_min:30,
      deadline:{start:'2026-09-21',end:null,time_zone:null},scheduled:null,action_type:'ACTION',
      next_action:'Read production Work Items',blocker:'',source:'CHATGPT',source_revision:new Date().toISOString()}
  ],
  writes:{notion:0,calendar:0,context:0}
});

let data=snapshot(), fail=false, checks=0;
const h=createHarness({root,baseRoot,provider:()=>{throw Error('UNRELATED_SOURCE');},
  workProvider:()=>{if(fail)throw Error('PRIVATE ERROR');return data;}});
const call=(device='admin-local', extra={})=>h.call(h.body(device,{action:'kazOs.work.get',...extra}));
function test(name,fn){fn();checks++;}

test('owner receives bounded Work fields only',()=>{
  data=snapshot();data.work_items[0].raw_instruction='PRIVATE';data.raw_conversation='PRIVATE';
  const r=call();assert(r.success);assert.equal(r.data.work_items.length,2);
  assert.equal(r.data.work_items[0].work_id,'WI-14');assert(!JSON.stringify(r).includes('PRIVATE'));
  assert.deepEqual(r.data.writes,{notion:0,calendar:0,context:0});
});

test('non-owner and role spoof cannot read Work source',()=>{
  for(const device of ['child-local','guardian-local','other-local']){
    const before=h.stats().reads,r=call(device,{role:'admin',homeId:'local-home',memberUserId:'father'});
    assert.equal(r.success,false);assert.equal(r.data,null);assert.equal(h.stats().reads,before);
  }
});

test('kill switch denies before Work read',()=>{
  h.props.KAZ_OS_LIVE_ENABLED='false';const before=h.stats().reads,r=call();
  assert.equal(r.error.code,'KAZ_NOT_CONNECTED');assert.equal(h.stats().reads,before);
  h.props.KAZ_OS_LIVE_ENABLED='true';
});

test('failed read is not empty and hides raw exception',()=>{
  fail=true;const r=call();assert.equal(r.data,null);assert.equal(r.error.code,'KAZ_SOURCE_FAILED');
  assert(!JSON.stringify(r).includes('PRIVATE'));fail=false;
});

test('unhealthy Work source suppresses records',()=>{
  for(const [status,fetch] of [['failed','FAILED'],['partial','PARTIAL'],['stale','STALE'],['not_connected','NOT_CONNECTED']]){
    data=snapshot();data.sources.work_items.status=status;data.sources.work_items.fetch_status=fetch;
    const r=call();assert(r.success);assert.equal(r.data.work_items,null);assert.equal(r.data.sources.work_items.record_count,null);
  }
});

test('successful empty Work source is explicit zero',()=>{
  data=snapshot();data.work_items=[];data.sources.work_items.record_count=0;data.sources.work_items.fetch_status='EMPTY';
  assert.deepEqual(call().data.work_items,[]);
});

test('duplicates invalid enums and writes fail closed',()=>{
  data=snapshot();data.work_items.push(data.work_items[0]);data.sources.work_items.record_count=3;assert.equal(call().success,false);
  data=snapshot();data.work_items[0].priority='MAGIC';assert.equal(call().success,false);
  data=snapshot();data.writes.notion=1;assert.equal(call().success,false);
});

test('gateway derives /v1/work from existing Projects URL and performs GET only',()=>{
  data=snapshot();
  h.props.KAZ_OS_PROJECTS_READ_URL='https://reader.invalid/v1/projects';
  h.props.KAZ_OS_PROGRESS_READ_TOKEN='synthetic-reader-token-01234567890123456789';
  let calls=0;h.ctx.UrlFetchApp.fetch=(url,options)=>{calls++;assert.equal(url,'https://reader.invalid/v1/work');
    assert.equal(options.method,'get');assert.equal(options.followRedirects,false);
    return {getResponseCode:()=>200,getContentText:()=>JSON.stringify(snapshot())};};
  vm.runInContext(fs.readFileSync(path.join(root,'gas/KazOsWork.js'),'utf8'),h.ctx);
  assert(call().success);assert.equal(calls,1);assert.equal(h.stats().writes,0);
});

test('dispatcher explicitly exposes Work read but no generic Kaz write path',()=>{
  const source=fs.readFileSync(path.join(root,'gas/Code.js'),'utf8');
  assert(source.includes("action === 'kazOs.work.get'"));
  assert(!source.includes("String(action).indexOf('kazOs.') === 0) {\n      return kazOsProgress_(body);"));
});

console.log(`kaz-work: ${checks}/${checks} PASS`);

'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const {createHarness} = require('./fixtures/kaz-progress-harness');
const root=process.env.PALURU_TEST_ROOT || path.resolve(__dirname,'..'), baseRoot=process.env.PALURU_BASE_ROOT;
const snapshot=()=>({origin:'notion_official_api',mode:'read_only',fixture_only:false,
  sources:{projects:{status:'ok',fetch_status:'SUCCESS',complete:true,fetched_at:new Date().toISOString(),valid_until:new Date(Date.now()+900000).toISOString(),source_revision:'synthetic-observation',snapshot_ref:'synthetic-observation',scope:'synthetic test',record_count:1}},
  projects:[{id:'00000000-0000-0000-0000-000000000001',title:'Synthetic Project',status:'ACTIVE',current_focus:'Synthetic Focus',next_action:'Synthetic Next',blocker:'',milestones_done:null,milestones_total:null,source_revision:new Date().toISOString()}]});
let data=snapshot(), fail=false, checks=0;
const h=createHarness({root,baseRoot,provider:()=>{throw Error('UNRELATED_SOURCE');},projectsProvider:()=>{if(fail)throw Error('PRIVATE ERROR');return data;}});
const call=(device='admin-local', extra={})=>h.call(h.body(device,{action:'kazOs.projects.get',...extra}));
function test(name,fn){fn();checks++;}
test('owner receives selected fields only',()=>{
  data.projects[0].instruction='PRIVATE';data.raw_conversation='PRIVATE';data.token='PRIVATE';
  const r=call();assert(r.success);assert.equal(r.data.projects[0].title,'Synthetic Project');assert(!JSON.stringify(r).includes('PRIVATE'));
});
test('non-owner, role spoof, unpaired and duplicate membership cannot read source',()=>{
  for(const device of ['child-local','guardian-local','other-local']){
    const before=h.stats().reads,r=call(device,{role:'admin',homeId:'local-home',memberUserId:'father'});
    assert.equal(r.success,false);assert.equal(r.data,null);assert.equal(h.stats().reads,before);
  }
  assert.equal(call('admin-local',{pairingToken:'wrong'}).error.code,'UNAUTHORIZED_DEVICE');
  h.rows.Device_Memberships.push(h.rows.Device_Memberships[1].slice());
  assert.equal(call().error.code,'MEMBERSHIP_NOT_FOUND');h.rows.Device_Memberships.pop();
});
test('revoked device and missing owner fail closed',()=>{
  const saved=h.props.PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1,reg=JSON.parse(saved);reg.devices['admin-local'].status='revoked';
  h.props.PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1=JSON.stringify(reg);assert.equal(call().error.code,'UNAUTHORIZED_DEVICE');h.props.PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1=saved;
  delete h.props.KAZ_OS_PROGRESS_OWNER_HOME_ID;assert.equal(call().error.code,'KAZ_NOT_CONNECTED');h.props.KAZ_OS_PROGRESS_OWNER_HOME_ID='local-home';
});
test('live kill switch denies before source read',()=>{
  h.props.KAZ_OS_LIVE_ENABLED='false';const before=h.stats().reads,r=call();
  assert.equal(r.error.code,'KAZ_NOT_CONNECTED');assert.equal(r.data,null);assert.equal(h.stats().reads,before);
  h.props.KAZ_OS_LIVE_ENABLED='true';
});
test('arbitrary mutation denied and auth registry is never written',()=>{assert.equal(call('admin-local',{action:'kazOs.projects.update'}).error.code,'KAZ_READ_ONLY');assert.equal(h.stats().writes,0);});
test('failed read does not become empty or expose raw exception',()=>{fail=true;const r=call();assert.equal(r.data,null);assert.equal(r.error.code,'KAZ_SOURCE_FAILED');assert(!JSON.stringify(r).includes('PRIVATE'));fail=false;});
test('all unhealthy states suppress records',()=>{
  for(const [status,fetch] of [['failed','FAILED'],['partial','PARTIAL'],['stale','STALE'],['not_connected','NOT_CONNECTED']]){
    data=snapshot();data.sources.projects.status=status;data.sources.projects.fetch_status=fetch;
    const r=call();assert(r.success);assert.equal(r.data.projects,null);assert.equal(r.data.sources.projects.record_count,null);
  }
});
test('expired successful snapshot becomes stale',()=>{data=snapshot();data.sources.projects.fetched_at='2020-01-01T00:00:00Z';data.sources.projects.valid_until='2020-01-01T00:15:00Z';const r=call();assert.equal(r.data.sources.projects.status,'stale');assert.equal(r.data.projects,null);});
test('empty is an explicit successful zero',()=>{data=snapshot();data.projects=[];data.sources.projects.record_count=0;data.sources.projects.fetch_status='EMPTY';assert.deepEqual(call().data.projects,[]);});
test('null milestone not fabricated, valid counts kept, bad counts refused',()=>{
  data=snapshot();assert.equal(call().data.projects[0].milestones_done,null);
  Object.assign(data.projects[0],{milestones_done:2,milestones_total:4});assert.equal(call().data.projects[0].milestones_done,2);
  data.projects[0].milestones_done=5;assert.equal(call().success,false);
});
test('fixture, duplicates and missing fields fail closed',()=>{
  data=snapshot();data.fixture_only=true;assert.equal(call().success,false);
  data=snapshot();data.projects.push(data.projects[0]);data.sources.projects.record_count=2;assert.equal(call().success,false);
  data=snapshot();delete data.projects[0].next_action;assert.equal(call().success,false);
});
test('gateway source client is only GET with no redirects',()=>{
  h.props.KAZ_OS_PROJECTS_READ_URL='https://reader.invalid/v1/projects';h.props.KAZ_OS_PROGRESS_READ_TOKEN='synthetic-reader-token-01234567890123456789';
  let calls=0;h.ctx.UrlFetchApp.fetch=(url,options)=>{calls++;assert.equal(url,h.props.KAZ_OS_PROJECTS_READ_URL);assert.equal(options.method,'get');assert.equal(options.followRedirects,false);return {getResponseCode:()=>200,getContentText:()=>JSON.stringify(snapshot())};};
  // Restore the original source function so this test covers the configured transport.
  const fs=require('node:fs'),vm=require('node:vm');vm.runInContext(fs.readFileSync(path.join(root,'gas/KazOsProjects.js'),'utf8'),h.ctx);
  assert(call().success);assert.equal(calls,1);assert.equal(h.stats().writes,0);
});
console.log(`kaz-projects: ${checks}/${checks} PASS`);

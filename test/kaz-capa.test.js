'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createHarness} = require('./fixtures/kaz-progress-harness');
const root=process.env.PALURU_TEST_ROOT || path.resolve(__dirname,'..'), baseRoot=process.env.PALURU_BASE_ROOT;

const snapshot=()=>({
  origin:'notion_official_api',mode:'read_only',fixture_only:false,
  sources:{capa:{status:'ok',fetch_status:'SUCCESS',complete:true,fetched_at:new Date().toISOString(),
    valid_until:new Date(Date.now()+900000).toISOString(),source_revision:'observation-sha256:capa',
    snapshot_ref:'observation-sha256:capa',scope:'Notion CAPA · read-only',record_count:2}},
  capa_items:[
    {id:'00000000-0000-0000-0000-000000000301',title:'Synthetic CAPA A',status:'Reopen',project:'PALURU',
      failure_classes:['Transport reliability'],created:'2026-09-22',trigger:'reloadで直る',
      corrective_action:'TransportとAuthを分離',preventive_action:'Two-Strikeで見直す',
      effectiveness:'Fail',context_path:'inbox/a.md',source_url:'https://example.invalid/a',last_reviewed:null},
    {id:'00000000-0000-0000-0000-000000000302',title:'Synthetic CAPA B',status:'Captured',project:'Kaz OS',
      failure_classes:['Contract regression'],created:'2026-09-20',trigger:'DTO変更',
      corrective_action:'producer/consumerを同時確認',preventive_action:'Contract Matrix',
      effectiveness:'Not evaluated',context_path:'inbox/b.md',source_url:null,last_reviewed:null}
  ],
  writes:{notion:0,calendar:0,context:0}
});

let data=snapshot(), fail=false, checks=0;
const h=createHarness({root,baseRoot,provider:()=>{throw Error('UNRELATED_SOURCE');},
  capaProvider:()=>{if(fail)throw Error('PRIVATE ERROR');return data;}});
const call=(device='admin-local', extra={})=>h.call(h.body(device,{action:'kazOs.capa.get',...extra}));
function test(name,fn){fn();checks++;}

test('owner receives bounded CAPA fields only',()=>{
  data=snapshot();data.capa_items[0].raw_page='PRIVATE';data.raw_payload='PRIVATE';
  const r=call();assert(r.success);assert.equal(r.data.capa_items.length,2);
  assert.equal(r.data.capa_items[0].status,'Reopen');assert(!JSON.stringify(r).includes('PRIVATE'));
  assert.deepEqual(r.data.writes,{notion:0,calendar:0,context:0});
});

test('non-owner and role spoof cannot read CAPA source',()=>{
  for(const device of ['child-local','guardian-local','other-local']){
    const before=h.stats().reads,r=call(device,{role:'admin',homeId:'local-home',memberUserId:'father'});
    assert.equal(r.success,false);assert.equal(r.data,null);assert.equal(h.stats().reads,before);
  }
});

test('failed read is not empty and hides raw exception',()=>{
  fail=true;const r=call();assert.equal(r.data,null);assert.equal(r.error.code,'KAZ_SOURCE_FAILED');
  assert(!JSON.stringify(r).includes('PRIVATE'));fail=false;
});

test('unhealthy CAPA source suppresses records',()=>{
  for(const [status,fetch] of [['failed','FAILED'],['partial','PARTIAL'],['stale','STALE'],['not_connected','NOT_CONNECTED']]){
    data=snapshot();data.sources.capa.status=status;data.sources.capa.fetch_status=fetch;
    const r=call();assert(r.success);assert.equal(r.data.capa_items,null);assert.equal(r.data.sources.capa.record_count,null);
  }
});

test('successful empty CAPA source is explicit zero',()=>{
  data=snapshot();data.capa_items=[];data.sources.capa.record_count=0;data.sources.capa.fetch_status='EMPTY';
  assert.deepEqual(call().data.capa_items,[]);
});

test('duplicates invalid enums and writes fail closed',()=>{
  data=snapshot();data.capa_items.push(data.capa_items[0]);data.sources.capa.record_count=3;assert.equal(call().success,false);
  data=snapshot();data.capa_items[0].status='MAGIC';assert.equal(call().success,false);
  data=snapshot();data.writes.notion=1;assert.equal(call().success,false);
});

test('gateway derives /v1/capa from existing Projects URL and performs GET only',()=>{
  data=snapshot();
  h.props.KAZ_OS_PROJECTS_READ_URL='https://reader.invalid/v1/projects';
  h.props.KAZ_OS_PROGRESS_READ_TOKEN='synthetic-reader-token-01234567890123456789';
  let calls=0;h.ctx.UrlFetchApp.fetch=(url,options)=>{calls++;assert.equal(url,'https://reader.invalid/v1/capa');
    assert.equal(options.method,'get');assert.equal(options.followRedirects,false);
    return {getResponseCode:()=>200,getContentText:()=>JSON.stringify(snapshot())};};
  vm.runInContext(fs.readFileSync(path.join(root,'gas/KazOsCapa.js'),'utf8'),h.ctx);
  h.ctx.readKazOsCapa_ = h.ctx.readKazOsCapa_;
  assert(call().success);assert.equal(calls,1);assert.equal(h.stats().writes,0);
});

test('dispatcher explicitly exposes CAPA read but no generic Kaz write path',()=>{
  const source=fs.readFileSync(path.join(root,'gas/Code.js'),'utf8');
  assert(source.includes("action === 'kazOs.capa.get'"));
  assert(!source.includes("String(action).indexOf('kazOs.') === 0) {\n      return kazOsProgress_(body);"));
});

console.log(`kaz-capa: ${checks}/${checks} PASS`);

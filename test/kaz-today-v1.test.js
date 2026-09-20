'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createHarness} = require('./fixtures/kaz-progress-harness');

const root=process.env.PALURU_TEST_ROOT || path.resolve(__dirname,'..'), baseRoot=process.env.PALURU_BASE_ROOT;

const item=(id,workId,title,state,priority,projectName)=>({
  id,
  work_id:workId,
  title,
  state,
  project_id: projectName === 'PALURU'
    ? '00000000-0000-0000-0000-000000000001'
    : '00000000-0000-0000-0000-000000000002',
  project_name:projectName,
  priority,
  estimate_min:null,
  deadline:null,
  scheduled:null,
  action_type:'ACTION',
  next_action:'Next action',
  blocker:'',
  source:'CHATGPT',
  source_revision:new Date().toISOString(),
});

const snapshot=()=>({
  schema_version:'kaz-today-work-v1',
  origin:'notion_official_api',
  mode:'read_only',
  fixture_only:false,
  policy:{
    version:'today-work-v1',
    dynamic_daily_planning:false,
    calendar_used:false,
    energy_used:false,
    availability_used:false,
    ui_scoring_allowed:false,
  },
  sources:{work_items:{
    status:'ok',fetch_status:'SUCCESS',complete:true,
    fetched_at:new Date().toISOString(),
    valid_until:new Date(Date.now()+900000).toISOString(),
    source_revision:'observation-sha256:work',
    projects_source_revision:'observation-sha256:projects',
    snapshot_ref:'observation-sha256:work',
    scope:'Notion Work Items · read-only',
    record_count:3,
  }},
  today:{
    now:{kind:'single',items:[item('00000000-0000-0000-0000-000000000101','WI-14','Current work','DOING','HIGH','PALURU')],basis:['state=DOING','explicit_priority']},
    next:{kind:'multiple',items:[
      item('00000000-0000-0000-0000-000000000102','WI-18','Next A','READY','CRITICAL','Kaz OS'),
      item('00000000-0000-0000-0000-000000000103','WI-19','Next B','READY','CRITICAL','Kaz OS'),
    ],basis:['explicit_deadline','review_or_acceptance','explicit_priority']},
    waiting:[],
    waiting_count:0,
    active_count:3,
    done_count:0,
    cancelled_count:0,
    needs_choice:true,
    limitations:[
      'dynamic_daily_planning_not_connected',
      'calendar_not_used',
      'availability_not_used',
      'energy_not_used',
      'missing_estimate_not_inferred',
    ],
  },
  writes:{notion:0,calendar:0,context:0},
});

let data=snapshot(), fail=false, checks=0;
const h=createHarness({
  root,baseRoot,
  provider:()=>{throw Error('UNRELATED_SOURCE');},
  todayProvider:()=>{if(fail)throw Error('PRIVATE ERROR');return data;},
});
const call=(device='admin-local',extra={})=>h.call(h.body(device,{action:'kazOs.today.get',...extra}));
function test(name,fn){fn();checks++;}

test('owner receives TODAY v1 and no invented planner fields',()=>{
  data=snapshot();data.raw_private='PRIVATE';data.today.now.items[0].raw_instruction='PRIVATE';
  const r=call();
  assert(r.success);
  assert.equal(r.data.schema_version,'kaz-today-work-v1');
  assert.equal(r.data.today.now.kind,'single');
  assert.equal(r.data.today.next.kind,'multiple');
  assert.equal(r.data.policy.dynamic_daily_planning,false);
  assert.equal(r.data.policy.calendar_used,false);
  assert.equal(r.data.policy.ui_scoring_allowed,false);
  assert.deepEqual(r.data.writes,{notion:0,calendar:0,context:0});
  assert(!JSON.stringify(r).includes('PRIVATE'));
  assert(!JSON.stringify(r).includes('"score"'));
});

test('non-owner and role spoof cannot read TODAY source',()=>{
  for(const device of ['child-local','guardian-local','other-local']){
    const before=h.stats().reads;
    const r=call(device,{role:'admin',homeId:'local-home',memberUserId:'father'});
    assert.equal(r.success,false);
    assert.equal(r.data,null);
    assert.equal(h.stats().reads,before);
  }
});

test('kill switch denies before TODAY read',()=>{
  h.props.KAZ_OS_LIVE_ENABLED='false';
  const before=h.stats().reads,r=call();
  assert.equal(r.error.code,'KAZ_NOT_CONNECTED');
  assert.equal(h.stats().reads,before);
  h.props.KAZ_OS_LIVE_ENABLED='true';
});

test('failed TODAY read is not empty and hides raw exception',()=>{
  fail=true;
  const r=call();
  assert.equal(r.data,null);
  assert.equal(r.error.code,'KAZ_SOURCE_FAILED');
  assert(!JSON.stringify(r).includes('PRIVATE'));
  fail=false;
});

test('TODAY sanitizer rejects write claims and malformed selection cardinality',()=>{
  data=snapshot();data.writes.notion=1;assert.equal(call().success,false);
  data=snapshot();data.today.now.kind='single';data.today.now.items=[];assert.equal(call().success,false);
  data=snapshot();data.today.next.kind='multiple';data.today.next.items=[data.today.next.items[0]];assert.equal(call().success,false);
});

test('gateway derives /v1/today from existing Projects URL and performs GET only',()=>{
  data=snapshot();
  h.props.KAZ_OS_PROJECTS_READ_URL='https://reader.invalid/v1/projects';
  h.props.KAZ_OS_PROGRESS_READ_TOKEN='synthetic-reader-token-01234567890123456789';
  let calls=0;
  h.ctx.UrlFetchApp.fetch=(url,options)=>{
    calls++;
    assert.equal(url,'https://reader.invalid/v1/today');
    assert.equal(options.method,'get');
    assert.equal(options.followRedirects,false);
    return {getResponseCode:()=>200,getContentText:()=>JSON.stringify(snapshot())};
  };
  vm.runInContext(fs.readFileSync(path.join(root,'gas/KazOsToday.js'),'utf8'),h.ctx);
  assert(call().success);
  assert.equal(calls,1);
  assert.equal(h.stats().writes,0);
});

test('dispatcher explicitly exposes TODAY read and keeps generic Kaz writes denied',()=>{
  const source=fs.readFileSync(path.join(root,'gas/Code.js'),'utf8');
  assert(source.includes("action === 'kazOs.today.get'"));
  assert(!source.includes("String(action).indexOf('kazOs.') === 0) {\n      return kazOsProgress_(body);"));
});

test('PWA exposes canonical TODAY WORK PROJECTS INBOX order and authenticated TODAY API',()=>{
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
  const nav=fs.readFileSync(path.join(root,'features/kaz-os/navigation.js'),'utf8');
  const personal=fs.readFileSync(path.join(root,'features/kaz-os/personal.js'),'utf8');
  const order=['data-kaz-page="today"','data-kaz-page="work"','data-kaz-page="projects"','data-kaz-page="inbox"'].map(x=>html.indexOf(x));
  assert(order.every(i=>i>=0));
  assert(order.every((v,i)=>i===0||order[i-1]<v));
  assert(app.includes('buildMemoCredentialPayload("kazOs.today.get")'));
  assert(app.includes('kazOsTodayApi: callAuthenticatedKazOsToday_'));
  assert(nav.includes("location.hash !== '#kaz-os/today'"));
  assert(personal.includes("selection.page === 'today'"));
  assert(personal.includes('Calendar・空き時間・Energy・AI scoreはまだ使っていません。'));
});

console.log(`kaz-today-v1: ${checks}/${checks} PASS`);

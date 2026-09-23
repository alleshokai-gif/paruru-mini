'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createHarness} = require('./fixtures/kaz-progress-harness');

const root=process.env.PALURU_TEST_ROOT || path.resolve(__dirname,'..'), baseRoot=process.env.PALURU_BASE_ROOT;

const item=(id,workId,title,state,priority,projectName,planStart=null,planEnd=null,placement=null)=>({
  id,
  work_id:workId,
  title,
  state,
  project_id: projectName === 'PALURU'
    ? '00000000-0000-0000-0000-000000000001'
    : '00000000-0000-0000-0000-000000000002',
  project_name:projectName,
  priority,
  estimate_min:30,
  deadline:null,
  scheduled:null,
  action_type:'ACTION',
  next_action:'Next action',
  blocker:'',
  source:'CHATGPT',
  source_revision:new Date().toISOString(),
  plan_start:planStart,
  plan_end:planEnd,
  placement,
});

const snapshot=()=>({
  schema_version:'kaz-today-plan-v1',
  origin:'real_operational_sources',
  mode:'read_only',
  fixture_only:false,
  policy:{
    version:'dynamic-daily-planning-v1',
    dynamic_daily_planning:true,
    calendar_used:true,
    availability_used:true,
    energy_used:false,
    ui_scoring_allowed:false,
  },
  sources:{
    work_items:{
      status:'ok',fetch_status:'SUCCESS',complete:true,
      fetched_at:new Date().toISOString(),
      valid_until:new Date(Date.now()+900000).toISOString(),
      source_revision:'observation-sha256:work',
      projects_source_revision:'observation-sha256:projects',
      snapshot_ref:'observation-sha256:work',
      scope:'Notion Work Items · read-only',
      record_count:3,
    },
    calendar:{
      status:'ok',complete:true,
      fetched_at:new Date().toISOString(),
      valid_until:new Date(Date.now()+900000).toISOString(),
      source_revision:'observation-sha256:calendar',
      scope:'Family Calendar · transient read-only planning input',
    }
  },
  today:{
    now:{kind:'single',items:[item('00000000-0000-0000-0000-000000000101','WI-14','Current work','DOING','HIGH','PALURU',
      new Date(Date.now()+60000).toISOString(),new Date(Date.now()+1860000).toISOString(),'POLICY_ORDER')],
      basis:['state=DOING','explicit_priority','availability']},
    next:{kind:'single',items:[
      item('00000000-0000-0000-0000-000000000102','WI-18','Next A','READY','CRITICAL','Kaz OS',
        new Date(Date.now()+3600000).toISOString(),new Date(Date.now()+5400000).toISOString(),'POLICY_ORDER'),
    ],basis:['availability','explicit_deadline','review_or_acceptance','explicit_priority']},
    waiting:[],
    waiting_count:0,
    availability:[{start:new Date().toISOString(),end:new Date(Date.now()+7200000).toISOString()}],
    calendar_state:{classification_revision_current:true,unknown_count:1,known_none_count:1,
      unknown:[{event_ref:'event-abc',reason:'UNANSWERED'}]},
    unplaced_explicit_estimate_count:0,
    missing_estimate_count:1,
    active_count:3,
    done_count:0,
    cancelled_count:0,
    needs_choice:false,
    limitations:['energy_not_used','missing_estimate_not_inferred','ui_scoring_not_used','unknown_calendar_not_treated_as_free'],
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

test('owner receives Dynamic Daily Planning and no invented score or energy',()=>{
  data=snapshot();data.raw_private='PRIVATE';data.today.now.items[0].raw_instruction='PRIVATE';
  const r=call();
  assert(r.success);
  assert.equal(r.data.schema_version,'kaz-today-plan-v1');
  assert.equal(r.data.origin,'real_operational_sources');
  assert.equal(r.data.today.now.kind,'single');
  assert.equal(r.data.today.next.kind,'single');
  assert.equal(r.data.policy.dynamic_daily_planning,true);
  assert.equal(r.data.policy.calendar_used,true);
  assert.equal(r.data.policy.availability_used,true);
  assert.equal(r.data.policy.energy_used,false);
  assert.equal(r.data.policy.ui_scoring_allowed,false);
  assert.equal(r.data.today.calendar_state.unknown_count,1);
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

test('TODAY sanitizer rejects write claims malformed planning slots and unsafe calendar state',()=>{
  data=snapshot();data.writes.notion=1;assert.equal(call().success,false);
  data=snapshot();data.today.now.kind='single';data.today.now.items=[];assert.equal(call().success,false);
  data=snapshot();data.today.availability[0].end=data.today.availability[0].start;assert.equal(call().success,false);
  data=snapshot();data.today.calendar_state.unknown[0].reason='FREE_BY_AI';assert.equal(call().success,false);
});

test('gateway derives /v1/today and POSTs bounded transient planning input',()=>{
  data=snapshot();
  h.props.KAZ_OS_PROJECTS_READ_URL='https://reader.invalid/v1/projects';
  h.props.KAZ_OS_PROGRESS_READ_TOKEN='synthetic-reader-token-01234567890123456789';
  let calls=0,observedPayload=null;
  h.ctx.UrlFetchApp.fetch=(url,options)=>{
    calls++;
    assert.equal(url,'https://reader.invalid/v1/today');
    assert.equal(options.method,'post');
    assert.equal(options.contentType,'application/json');
    assert.equal(options.followRedirects,false);
    observedPayload=JSON.parse(options.payload);
    return {getResponseCode:()=>200,getContentText:()=>JSON.stringify(snapshot())};
  };
  vm.runInContext(fs.readFileSync(path.join(root,'gas/KazOsToday.js'),'utf8'),h.ctx);
  h.ctx.buildKazOsCalendarCapture_=()=>({selection:{},horizon:{},fetched_at:'x',response:{events:[]},connector_receipt:{}});
  const result=h.ctx.sanitizeKazOsToday_(h.ctx.readKazOsToday_());
  assert.equal(result.schema_version,'kaz-today-plan-v1');
  assert.deepEqual(Object.keys(observedPayload).sort(),['calendar_capture','classifications','planning']);
  assert.deepEqual(observedPayload.classifications,{items:[]});
  assert.equal(observedPayload.planning.timezone,'Asia/Tokyo');
  assert(/^\\d{4}-\\d{2}-\\d{2}$/.test(observedPayload.planning.planning_date));
  assert.deepEqual(observedPayload.planning.preferences,[]);
  assert.deepEqual(observedPayload.planning.daily_estimates,[]);
  assert.equal(calls,1);
  assert.equal(h.stats().writes,0);
});

test('TODAY sanitizer keeps V1 readable during rolling V2 deploy',()=>{
  data=snapshot();
  const result=h.ctx.sanitizeKazOsToday_(data);
  assert.equal(result.schema_version,'kaz-today-plan-v1');
});

test('dispatcher explicitly exposes TODAY read and keeps generic Kaz writes denied',()=>{
  const source=fs.readFileSync(path.join(root,'gas/Code.js'),'utf8');
  assert(source.includes("action === 'kazOs.today.get'"));
  assert(!source.includes("String(action).indexOf('kazOs.') === 0) {\n      return kazOsProgress_(body);"));
});

test('PWA exposes Dynamic TODAY time context without UI score',()=>{
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
  assert(personal.includes('Family Calendarから、いま使える時間'));
  assert(personal.includes('Dynamic Daily Planning v1の判定範囲'));
  assert(!personal.includes('UI scoreはまだ使っていません'));
});

console.log(`kaz-today-v1: ${checks}/${checks} PASS`);

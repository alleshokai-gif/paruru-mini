'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createHarness}=require('./fixtures/kaz-progress-harness');
const root=process.env.PALURU_TEST_ROOT||path.resolve(__dirname,'..');

function iso(offset){return new Date(Date.now()+offset).toISOString();}
function snapshot(){
  const projectRevision=iso(-1000),workRevision=iso(-900),calendarRevision='observation-sha256:'+'c'.repeat(64);
  const source=(revision,scope)=>({status:'ok',complete:true,fetched_at:iso(-500),valid_until:iso(600000),source_revision:revision,scope});
  const refs={projects:'observation-sha256:'+'a'.repeat(64),work_items:'observation-sha256:'+'b'.repeat(64),calendar:calendarRevision};
  const question='Quality Questを今日の先頭候補にする？';
  const decision={id:'decision-'+'d'.repeat(24),kind:'today_focus',contract:'secretary-question-0.1',owner:'kaz',decision_requested:true,decision_status:'pending',write_allowed:false,
    title:'Acceptance・次運用方針',question,reason:'REVIEW中Projectの判断を確認',impact:'Today candidate',estimate_min:null,affects_today:true,urgent_today:true,
    decision_date:new Date().toISOString().slice(0,10),due_at:iso(600000),project_id:'00000000-0000-4000-8000-000000000001',entity_ref:'WI-10',source_label:'Notion Work Items',entity_revision:workRevision,
    question_revision:'question-sha256:'+'e'.repeat(64),source_revision_references:refs,answer_contract:{inbox_item_id:'decision-'+'d'.repeat(24),question_revision:'question-sha256:'+'e'.repeat(64),question,choices:[
      {value:'today',label:'今日',effect:'Today candidate'},{value:'this_week',label:'今週',effect:'今週候補'},{value:'later',label:'あとで',effect:'後日候補'}]},
    selection_mode:null,selection_options:null,recommended_option:'today',recommendation_basis:['Project REVIEW']};
  return{schema_version:'kaz-secretary-inbox-0.1',origin:'real_operational_sources',mode:'read_only_display',fixture_only:false,fixture_fallback:false,as_of:iso(-400),timezone:'Asia/Tokyo',
    sources:{inbox:source('question-set-sha256:'+'f'.repeat(64),'fresh Secretary Questions / live read-only'),projects:source(refs.projects,'Notion Projects read-only'),tasks:source(refs.work_items,'Notion Work Items read-only'),calendar:source(refs.calendar,'Family Calendar read-only'),resolution:source(refs.calendar,'Human classification pending')},
    projects:[{id:decision.project_id,title:'Quality Quest',status:'REVIEW',source_revision:projectRevision}],work_items:[{id:'WI-10',title:decision.title,state:'READY',project_id:decision.project_id,revision:workRevision,source_revision:workRevision,estimate_min:null,next_actor:'kaz',blocker:'',action_instruction:decision.title,dependencies:[]}],calendar_events:[],inbox_items:[decision],decision_priority_evidence:{},feedback:null,persistence:{kind:'none',status:'disabled',answers:0,proposals:0,followups:0},writes:{notion:0,calendar:0,context:0}};
}
let value=snapshot(),fail=false,checks=0;
const h=createHarness({root,provider:()=>{throw Error('OUT_OF_SCOPE');},projectsProvider:()=>{throw Error('OUT_OF_SCOPE');},inboxProvider:()=>{if(fail)throw Error('PRIVATE DETAIL');return value;}});
const requestId='123e4567-e89b-42d3-a456-426614174000';
const call=(device='admin-local',extra={})=>h.call(h.body(device,{action:'kazOs.inbox.get',request_id:requestId,...extra}));
function test(name,fn){fn();checks++;}

test('owner receives only live read-only Secretary Questions',()=>{value.private_payload='SECRET';const r=call();assert(r.success);assert.equal(r.data.mode,'read_only_display');assert.equal(r.data.inbox_items.length,1);assert.equal(r.data.inbox_items[0].write_allowed,false);assert(!JSON.stringify(r).includes('SECRET'));});
test('shared Kaz OS live gate controls INBOX and deprecated INBOX read flag is ignored',()=>{
  value=snapshot();h.props.KAZ_OS_INBOX_LIVE_ENABLED='false';
  const deprecatedFlagRead=call();assert(deprecatedFlagRead.success);assert.equal(deprecatedFlagRead.data.mode,'read_only_display');
  const before=h.stats().reads;h.props.KAZ_OS_LIVE_ENABLED='false';const globallyDisabled=call();
  assert.equal(globallyDisabled.error.code,'KAZ_NOT_CONNECTED');assert.equal(globallyDisabled.data,null);assert.equal(h.stats().reads,before);
  h.props.KAZ_OS_LIVE_ENABLED='true';delete h.props.KAZ_OS_INBOX_LIVE_ENABLED;
});
test('non-owner denial happens before source read',()=>{for(const device of ['child-local','guardian-local','other-local']){const before=h.stats().reads,r=call(device,{role:'admin',memberUserId:'father'});assert.equal(r.error.code,'FORBIDDEN');assert.equal(r.data,null);assert.equal(h.stats().reads,before);}});
test('answer gate defaults disabled and mutation remains denied',()=>{assert.equal(call('admin-local',{action:'kazOs.inbox.answer'}).error.code,'KAZ_ANSWER_DISABLED');assert.equal(call('admin-local',{action:'kazOs.inbox.update'}).error.code,'KAZ_READ_ONLY');assert.equal(h.stats().writes,0);});
test('missing or malformed request id is rejected before source read',()=>{
  const before=h.stats().reads;
  for(const request_id of [undefined,'not-a-uuid','123e4567-e89b-12d3-a456-426614174000']){
    const r=h.call(h.body('admin-local',{action:'kazOs.inbox.get',request_id}));
    assert.equal(r.error.code,'KAZ_REQUEST_ID_INVALID');assert.equal(r.data,null);
  }
  assert.equal(h.stats().reads,before);
});
test('failed or stale source never becomes an empty queue',()=>{fail=true;let r=call();assert.equal(r.error.code,'KAZ_SOURCE_FAILED');assert.equal(r.data,null);fail=false;value=snapshot();value.sources.inbox.valid_until=iso(-1);r=call();assert.equal(r.error.code,'KAZ_SOURCE_FAILED');assert.equal(r.data,null);});
test('missing explicit owner member fails closed',()=>{value=snapshot();delete h.props.KAZ_OS_PROGRESS_OWNER_MEMBER_ID;const before=h.stats().reads,r=call();assert.equal(r.error.code,'KAZ_NOT_CONNECTED');assert.equal(h.stats().reads,before);h.props.KAZ_OS_PROGRESS_OWNER_MEMBER_ID='father';});
test('GAS calendar read sends one transient bounded capture and no raw IDs',()=>{
  value=snapshot();h.props.KAZ_OS_INBOX_READ_URL='https://reader.invalid/v1/inbox';h.props.KAZ_OS_PROGRESS_READ_TOKEN='synthetic-reader-token-01234567890123456789';
  const start=new Date(),end=new Date(start.getTime()+3600000),event={getId:()=> 'raw-event-id',getTitle:()=> '家族予定',getStartTime:()=>start,getEndTime:()=>end,getTransparency:()=> 'OPAQUE',isAllDayEvent:()=>false};
  h.ctx.CalendarApp={EventTransparency:{TRANSPARENT:'TRANSPARENT'}};
  h.ctx.getCalendarConfig_=()=>({calendarId:'private-calendar-id'});
  h.ctx.getCalendarByConfig_=()=>({getName:()=> 'ファミリー',getEvents:()=>[event]});
  h.ctx.Utilities.formatDate=(date,_zone,format)=>format==='yyyy-MM-dd'?new Date(date).toISOString().slice(0,10):new Date(date).toISOString();
  const logs=[];h.ctx.Logger={log:line=>logs.push(line)};
  let request=null;h.ctx.UrlFetchApp.fetch=(url,options)=>{request={url,options};return{getResponseCode:()=>200,getContentText:()=>JSON.stringify(value)}};
  vm.runInContext(fs.readFileSync(path.join(root,'gas/KazOsInbox.js'),'utf8'),h.ctx,{filename:'gas/KazOsInbox.js'});
  const r=call();assert(r.success);assert.equal(request.url,h.props.KAZ_OS_INBOX_READ_URL);assert.equal(request.options.method,'post');assert.equal(request.options.followRedirects,false);
  assert.equal(request.options.headers['X-Kaz-Request-Id'],requestId);
  const capture=JSON.parse(request.options.payload);assert.equal(capture.connector_receipt.calendar_write_requests,0);assert.equal(capture.connector_receipt.event_read_requests,1);assert.equal(capture.response.events.length,1);
  const encoded=JSON.stringify(capture);assert(!encoded.includes('raw-event-id'));assert(!encoded.includes('private-calendar-id'));assert(!encoded.includes(h.props.KAZ_OS_PROGRESS_READ_TOKEN));
  assert(!Object.hasOwn(capture,'request_id'),'request id must not alter the Calendar capture contract');
  const entries=logs.map(line=>JSON.parse(line.replace(/^\[KAZ_OS_INBOX_TRACE\] /,'')));
  assert.deepEqual(entries.map(entry=>entry.stage),['REQUEST_RECEIVED','ROUTER_MATCHED','AUTH_PASSED','INBOX_READ_STARTED','CALENDAR_CAPTURE_OK','GATEWAY_POST_STARTED','GATEWAY_RESPONSE','SANITIZER_OK','RESPONSE_SENT']);
  const allowed=['elapsed_ms','error_code','event_count','gas_version','http_status','question_count','request_id','stage','timestamp'].sort();
  for(const entry of entries){assert.deepEqual(Object.keys(entry).sort(),allowed);assert.equal(entry.request_id,requestId);}
  const traceText=JSON.stringify(entries);for(const forbidden of ['raw-event-id','private-calendar-id','家族予定',h.props.KAZ_OS_PROGRESS_READ_TOKEN,h.props.KAZ_OS_INBOX_READ_URL])assert(!traceText.includes(forbidden));
});

test('Calendar failure records only the safe failed stage and never calls the gateway',()=>{
  const logs=[];h.ctx.Logger={log:line=>logs.push(line)};let gatewayCalls=0;
  h.ctx.getCalendarByConfig_=()=>({getName:()=> 'ファミリー',getEvents:()=>{throw Error('PRIVATE CALENDAR FAILURE');}});
  h.ctx.UrlFetchApp.fetch=()=>{gatewayCalls++;throw Error('MUST_NOT_RUN');};
  const r=call();assert.equal(r.error.code,'KAZ_SOURCE_FAILED');assert.equal(gatewayCalls,0);
  const entries=logs.map(line=>JSON.parse(line.replace(/^\[KAZ_OS_INBOX_TRACE\] /,'')));
  assert(entries.some(entry=>entry.stage==='CALENDAR_CAPTURE_FAILED'&&entry.error_code==='KAZ_SOURCE_FAILED'));
  assert.equal(entries.at(-1).stage,'RESPONSE_SENT');assert.equal(entries.at(-1).error_code,'KAZ_SOURCE_FAILED');
  assert(!JSON.stringify(entries).includes('PRIVATE CALENDAR FAILURE'));
});
console.log(`kaz-inbox-live: ${checks}/${checks} PASS`);

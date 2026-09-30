'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
const { createHarness } = require('./fixtures/kaz-progress-harness');
const root = path.resolve(__dirname, '..');

function iso(offset) { return new Date(Date.now() + offset).toISOString(); }
function snapshot() {
  const refs = { projects: 'observation-sha256:' + 'a'.repeat(64), work_items: 'observation-sha256:' + 'b'.repeat(64), calendar: 'observation-sha256:' + 'c'.repeat(64) };
  const source = (revision, scope) => ({ status: 'ok', complete: true, fetched_at: iso(-500), valid_until: iso(600000), source_revision: revision, scope });
  const projectId = '00000000-0000-4000-8000-000000000001', workRevision = iso(-900);
  const make = (id, kind, question, choices, extra = {}) => ({
    id, kind, contract: 'secretary-question-0.1', owner: 'kaz', decision_requested: true,
    decision_status: 'pending', write_allowed: false, title: extra.title || '判断項目', question,
    reason: '本人判断が必要', impact: 'Planning proposalだけを更新', estimate_min: null,
    affects_today: true, urgent_today: true, decision_date: new Date().toISOString().slice(0, 10),
    due_at: iso(600000), project_id: extra.project_id ?? null, entity_ref: extra.entity_ref ?? null,
    source_label: extra.source_label || 'Operational source', entity_revision: extra.entity_revision ?? null,
    question_revision: 'question-sha256:' + id.slice(-1).repeat(64), source_revision_references: refs,
    answer_contract: { inbox_item_id: id, question_revision: 'question-sha256:' + id.slice(-1).repeat(64), question, choices },
    recommended_option: null, recommendation_basis: null,
    expires_at: iso(600000),
  });
  const today = make('decision-' + 'd'.repeat(24), 'today_focus', '今日の先頭候補にする？', [
    { value: 'today', label: '今日', effect: 'Today candidate' },
    { value: 'this_week', label: '今週', effect: '今週候補' },
    { value: 'later', label: 'あとで', effect: '後日候補' },
  ], { title: 'Acceptance方針', project_id: projectId, entity_ref: 'WI-10', entity_revision: workRevision, source_label: 'Notion Work Items' });
  const choiceSeed = today.answer_contract.choices.map(choice => choice.value).join(',');
  const planningSeed = today.entity_ref + '\\u0000' + today.entity_revision + '\\u0000' + today.decision_date + '\\u0000' + choiceSeed;
  const sha = value => crypto.createHash('sha256').update(value).digest('hex');
  today.id = 'decision-' + sha('daily-planning-preference\\u0000' + planningSeed).slice(0, 24);
  today.question_revision = 'question-sha256:' + sha('daily-planning-preference-question\\u0000' + planningSeed);
  today.answer_contract.inbox_item_id = today.id;
  today.answer_contract.question_revision = today.question_revision;
  const event = { id: 'event-sha256:' + '1'.repeat(64), title: 'sanitized event', start: iso(300000), end: iso(360000), all_day: false };
  const calendar = make('decision-' + 'e'.repeat(24), 'calendar_event_impact', 'この予定で、Kaz本人の時間はどれだけ拘束される？', [
    { value: 'all', label: '全部拘束', effect: 'full event proposal' },
    { value: 'partial', label: '一部拘束', effect: 'time range follow-up' },
    { value: 'none', label: '拘束なし', effect: 'none proposal' },
    { value: 'unknown', label: '不明', effect: 'unknown維持' },
  ], { title: event.title, entity_ref: event.id, source_label: 'Family Calendar' });
  calendar.calendar_event = { ref: event.id, title: event.title, start: event.start, end: event.end, all_day: event.all_day };
  return { schema_version: 'kaz-secretary-inbox-0.1', origin: 'real_operational_sources', mode: 'read_only_display', fixture_only: false, fixture_fallback: false,
    as_of: iso(-400), timezone: 'Asia/Tokyo', sources: { inbox: source('question-set-sha256:' + 'f'.repeat(64), 'Secretary Questions'), projects: source(refs.projects, 'Projects'), tasks: source(refs.work_items, 'Work Items'), calendar: source(refs.calendar, 'Family Calendar'), resolution: source(refs.calendar, 'Classification') },
    projects: [{ id: projectId, title: 'Project', status: 'REVIEW', source_revision: iso(-1000) }],
    work_items: [{ id: 'WI-10', title: 'Acceptance方針', state: 'READY', project_id: projectId, revision: workRevision, source_revision: workRevision, estimate_min: null, next_actor: 'kaz', blocker: '', action_instruction: '確認', dependencies: [] }],
    calendar_events: [{ ...event, precision: 'offset_datetime', classification: 'unconfirmed', source_revision: refs.calendar }],
    inbox_items: [today, calendar], decision_priority_evidence: {}, feedback: null,
    persistence: { kind: 'none', status: 'disabled', answers: 0, proposals: 0, followups: 0 }, writes: { notion: 0, calendar: 0, context: 0 } };
}

function estimateSnapshot() {
  const value = snapshot(), target = value.work_items[0];
  const expires = nextJstDayBoundary(new Date().toISOString());
  value.inbox_items = [{
    id: 'decision-' + '7'.repeat(24), kind: 'daily_estimate', contract: 'secretary-question-0.1',
    owner: 'kaz', decision_requested: true, decision_status: 'pending', write_allowed: false,
    title: target.title, question: 'これ何分くらい？',
    reason: 'TODAY candidateをCalendar空き時間へ配置するため', impact: '当日だけ使うDaily Estimate',
    estimate_min: null, affects_today: true, urgent_today: true,
    decision_date: new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10),
    due_at: expires, project_id: target.project_id, entity_ref: target.id,
    source_label: 'Notion Work Items', entity_revision: target.source_revision,
    question_revision: 'question-sha256:' + '7'.repeat(64),
    source_revision_references: {
      projects: value.sources.projects.source_revision,
      work_items: value.sources.tasks.source_revision,
      calendar: value.sources.calendar.source_revision,
    },
    answer_contract: { inbox_item_id: 'decision-' + '7'.repeat(24),
      question_revision: 'question-sha256:' + '7'.repeat(64), question: 'これ何分くらい？', choices: [] },
    calendar_event: null,
    input_contract: { type: 'integer_minutes', min: 1, max: 100000, unit: 'minutes' },
    recommended_option: null, recommendation_basis: null, expires_at: expires,
  }];
  value.calendar_events = [];
  return value;
}
function planningEstimateSnapshot() {
  const value = estimateSnapshot(), question = value.inbox_items[0];
  question.question = '今日やる？';
  question.answer_contract.question = question.question;
  question.answer_contract.choices = ['today','this_week','later'].map((choice,index) => ({
    value: choice, label: ['今日','今週','あとで'][index], effect: 'Work planning preference',
  }));
  question.input_contract.type = 'planning_estimate';
  return value;
}
function candidateSnapshot() {
  const value=snapshot(),commit='a'.repeat(40),blob='b'.repeat(40),revision=commit+':'+blob,
    candidateRef='github://alleshokai-gif/kaz-context/inbox/candidate.md@'+commit,
    choices=[{value:'CONTEXT',label:'CONTEXT',effect:'Context候補として記録する'},{value:'WORK',label:'WORK',effect:'CREATE_WORK proposalを作る'},
      {value:'PROJECT',label:'PROJECT',effect:'Project候補として保留する'},{value:'HOLD',label:'HOLD',effect:'保留する'},
      {value:'REJECT',label:'REJECT',effect:'候補から外す'},{value:'MERGE',label:'MERGE',effect:'既存項目との統合候補にする'}],
    sha=s=>crypto.createHash('sha256').update(s).digest('hex'),stable=v=>Array.isArray(v)?'['+v.map(stable).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v),
    id='candidate-review-'+sha(candidateRef+'\u0000'+revision).slice(0,24),title='Candidate title',question='このCandidateの扱いを決めてな。',
    questionRevision='question-sha256:'+sha(stable({id,candidate_ref:candidateRef,candidate_revision:revision,candidate_origin:'CHATGPT',title,choices}));
  value.sources.github_candidates={status:'ok',complete:true,fetched_at:iso(-500),valid_until:iso(600000),source_revision:commit,scope:'candidate source'};
  value.inbox_items=[{id,kind:'generic_candidate_review',contract:'generic-candidate-review-0.1',owner:'kaz',decision_requested:true,decision_status:'pending',write_allowed:false,
    title,question,reason:'Human decision',impact:'WORK choice produces read-only proposal',estimate_min:null,affects_today:false,urgent_today:false,decision_date:null,due_at:null,project_id:null,
    entity_ref:candidateRef,candidate_ref:candidateRef,candidate_revision:revision,candidate_commit:commit,candidate_blob_sha:blob,candidate_origin:'CHATGPT',candidate_source:'Source: ChatGPT',candidate_content:'# Candidate title',
    source_label:'GitHub Candidate',entity_revision:revision,question_revision:questionRevision,expires_at:null,
    source_revision_references:{projects:value.sources.projects.source_revision,work_items:value.sources.tasks.source_revision,calendar:value.sources.calendar.source_revision},
    answer_contract:{inbox_item_id:id,question_revision:questionRevision,question,choices},calendar_event:null,input_contract:null,selection_mode:null,selection_options:null,recommended_option:null,recommendation_basis:null}];
  return value;
}

let value = snapshot();
function harness(rows) {
  const h = createHarness({ root, answerEnabled: true, decisionLedgerRows: rows,
    provider: () => { throw Error('OUT_OF_SCOPE'); }, projectsProvider: () => { throw Error('OUT_OF_SCOPE'); }, inboxProvider: () => value });
  if (!rows) h.setupDecisionLedger();
  h.resetStats();
  return h;
}
const requestId = () => require('node:crypto').randomUUID();
function nextJstDayBoundary(value) {
  const jst = new Date(Date.parse(value) + 9 * 3600000);
  return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate() + 1) - 9 * 3600000).toISOString();
}
function nextJstWeekBoundary(value) {
  const jst = new Date(Date.parse(value) + 9 * 3600000), day = jst.getUTCDay();
  const daysUntilMonday = day === 0 ? 1 : 8 - day;
  return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate() + daysUntilMonday) - 9 * 3600000).toISOString();
}
function request(h, item, selected, key = 'paluru-test-00000001') {
  return h.call(h.body('admin-local', { action: 'kazOs.inbox.answer', request_id: requestId(),
    decision_id: item.id, question_revision: item.question_revision,
    source_revision_references: item.source_revision_references, selected_option: selected,
    reason: null, idempotency_key: key }));
}
let checks = 0; const test = (name, fn) => { fn(); checks++; };

const h = harness();
test('non-Kaz is denied before source and persistence', () => {
  const item = value.inbox_items[0], before = h.stats();
  const result = h.call(h.body('child-local', { action: 'kazOs.inbox.answer', request_id: requestId(), decision_id: item.id,
    question_revision: item.question_revision, source_revision_references: item.source_revision_references,
    selected_option: 'today', idempotency_key: 'paluru-denied-0001' }));
  assert.equal(result.error.code, 'FORBIDDEN'); assert.deepEqual(h.stats(), before);
});
test('answer persists one first-class Answer and one controlled proposal', () => {
  const preflight = h.call(h.body('admin-local', { action: 'kazOs.inbox.get', request_id: requestId() }));
  assert(preflight.success, JSON.stringify(preflight));
  const result = request(h, value.inbox_items[0], 'today');
  assert(result.success, JSON.stringify(result)); assert.equal(result.data.answer.actor, 'Kaz');
  assert.equal(result.data.answer.persistence_status, 'DURABLE_PERSISTED');
  assert.equal(result.data.proposal.status, 'PROPOSED'); assert.equal(result.data.proposal.write_allowed, false);
  assert.equal(result.data.proposal.requires_separate_write_approval, true);
  assert.equal(result.data.proposal.change.kind, 'DAILY_PLANNING_PREFERENCE');
  assert.equal(result.data.proposal.change.preference, 'today');
  assert.equal(result.data.proposal.change.timezone, 'Asia/Tokyo');
  assert.equal(result.data.proposal.change.source, 'human');
  assert.equal(result.data.proposal.change.work_item_id, value.work_items[0].id);
  assert.equal(result.data.proposal.change.work_item_source_revision, value.work_items[0].source_revision);
  assert.equal(result.data.proposal.change.planning_date, value.inbox_items[0].decision_date);
  assert.equal(result.data.proposal.change.valid_from, result.data.answer.answered_at);
  assert.equal(result.data.proposal.change.expires_at, nextJstDayBoundary(result.data.proposal.change.valid_from));
  assert.equal(result.data.proposal.change.permanent_priority_change, false);
  assert.equal(result.data.proposal.change.permanent_status_change, false);
  assert.deepEqual([result.data.proposal.notion_write, result.data.proposal.calendar_write, result.data.proposal.context_write], [0, 0, 0]);
  assert.equal(result.data.inbox.inbox_items.length, 1); assert.equal(h.rows.Kaz_OS_Decision_Ledger.length, 2);
});
test('Generic Candidate WORK stores one answer and a read-only CREATE_WORK proposal after exact revision checks',()=>{
  const candidate=candidateSnapshot(),harness=createHarness({root,answerEnabled:true,decisionLedgerRows:null,inboxProvider:()=>candidate});
  harness.setupDecisionLedger();harness.resetStats();harness.props.KAZ_OS_INBOX_READ_URL='https://gateway.example/v1/inbox';harness.props.KAZ_OS_PROGRESS_READ_TOKEN='x'.repeat(40);
  let proposalCalls=0;harness.ctx.UrlFetchApp.fetch=(url,options)=>{proposalCalls++;assert.equal(url,'https://gateway.example/v1/candidate-work-proposal');const sent=JSON.parse(options.payload);assert.equal(sent.candidate_revision,candidate.inbox_items[0].candidate_revision);assert.equal(sent.work_fields.project_id,candidate.projects[0].id);const proposal={kind:'CREATE_WORK',status:'PROPOSED',write_allowed:false,requires_separate_write_approval:true,notion_write:0,target:{project_id:sent.work_fields.project_id},proposed:{title:sent.work_fields.title,status:'READY',action_type:'ACTION',source:'CHATGPT',estimate_min:60}};return{getResponseCode:()=>200,getContentText:()=>JSON.stringify({candidate_ref:sent.candidate_ref,candidate_revision:sent.candidate_revision,candidate_origin:'CHATGPT',proposal,writes:{notion:0}})};};
  const item=candidate.inbox_items[0],result=harness.call(harness.body('admin-local',{action:'kazOs.inbox.answer',request_id:requestId(),decision_id:item.id,question_revision:item.question_revision,source_revision_references:item.source_revision_references,selected_option:'WORK',candidate_ref:item.candidate_ref,candidate_revision:item.candidate_revision,work_fields:{project_id:candidate.projects[0].id,title:item.title,status:'READY',action_type:'ACTION',source:'CHATGPT',estimate_min:60},reason:null,idempotency_key:'candidate-work-e2e-0001'}));
  assert(result.success,JSON.stringify(result));assert.equal(proposalCalls,1);assert.equal(result.data.proposal.change.kind,'GENERIC_CANDIDATE_REVIEW');assert.equal(result.data.proposal.change.apply_status,'CREATE_WORK_PROPOSAL_READY');assert.equal(result.data.proposal.change.create_work_proposal.kind,'CREATE_WORK');assert.equal(result.data.proposal.change.create_work_proposal.write_allowed,false);assert.equal(result.data.proposal.change.create_work_proposal.notion_write,0);assert.equal(result.data.answer.candidate_revision,item.candidate_revision);assert.equal(result.data.inbox.inbox_items.length,0);assert.equal(harness.rows.Kaz_OS_Decision_Ledger.length,2);
});
test('Generic Candidate non-WORK answer is recorded as PENDING_APPLY without calling proposal builder',()=>{
  const candidate=candidateSnapshot(),harness=createHarness({root,answerEnabled:true,decisionLedgerRows:null,inboxProvider:()=>candidate});
  harness.setupDecisionLedger();harness.resetStats();let calls=0;harness.ctx.UrlFetchApp.fetch=()=>{calls++;throw Error('WORK_PROPOSAL_MUST_NOT_RUN');};
  const item=candidate.inbox_items[0],result=harness.call(harness.body('admin-local',{action:'kazOs.inbox.answer',request_id:requestId(),decision_id:item.id,question_revision:item.question_revision,source_revision_references:item.source_revision_references,selected_option:'CONTEXT',candidate_ref:item.candidate_ref,candidate_revision:item.candidate_revision,reason:null,idempotency_key:'candidate-context-e2e-0001'}));
  assert(result.success,JSON.stringify(result));assert.equal(calls,0);assert.equal(result.data.proposal.change.apply_status,'PENDING_APPLY');assert.equal(result.data.proposal.change.create_work_proposal,null);assert.equal(result.data.inbox.inbox_items.length,0);assert.equal(harness.rows.Kaz_OS_Decision_Ledger.length,2);
});
test('PALURU Inbox inputs from createWithAI and PWA are projected, while unrelated sources stay excluded',()=>{
  const base=snapshot(),gateway=candidateSnapshot(),githubCandidate=gateway.inbox_items[0],row={id:'00000000-0000-4000-8000-000000000123',title:'PALURU入力からWorkへ',memo:'Human ReviewからWork proposalまで確認する',source:'ai',status:'Inbox',ownerUserId:'father',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  base.sources.github_candidates=gateway.sources.github_candidates;base.inbox_items.push(githubCandidate);
  const directPwa={...row,id:'00000000-0000-4000-8000-000000000124',title:'PWA直接入力',source:'PWA'};
  const unrelated={...row,id:'00000000-0000-4000-8000-000000000125',title:'別Source入力',source:'paluru-agent'};
  const foreign={...row,id:'00000000-0000-4000-8000-000000000999',ownerUserId:'second_son',title:'別ユーザーの入力'};
  const harness=createHarness({root,answerEnabled:true,decisionLedgerRows:null,inboxProvider:()=>base});
  harness.setupDecisionLedger();harness.resetStats();harness.ctx.readOwnedInboxItems_=()=>[row,directPwa,unrelated,foreign];
  harness.props.KAZ_OS_INBOX_READ_URL='https://gateway.example/v1/inbox';harness.props.KAZ_OS_PROGRESS_READ_TOKEN='x'.repeat(40);
  const read=harness.call(harness.body('admin-local',{action:'kazOs.inbox.get',request_id:requestId()}));
  assert(read.success,JSON.stringify(read));
  const paluruCandidates=read.data.inbox_items.filter(entry=>entry.kind==='generic_candidate_review'&&entry.candidate_origin==='PALURU');
  assert.equal(paluruCandidates.length,2);
  const item=paluruCandidates.find(entry=>entry.title==='PALURU入力からWorkへ');
  assert(item);assert.equal(item.candidate_origin,'PALURU');assert.equal(item.candidate_source,'PALURU INBOX');
  assert.equal(read.data.inbox_items.find(entry=>entry.id===githubCandidate.id)?.candidate_origin,'CHATGPT');
  assert.equal(read.data.inbox_items.some(entry=>entry.title==='別ユーザーの入力'),false);
  assert.equal(read.data.inbox_items.some(entry=>entry.title==='別Source入力'),false);
  assert.match(item.candidate_revision,/^paluru-inbox-sha256:[a-f0-9]{64}$/);
  assert.equal(item.source_revision_references.projects,base.sources.projects.source_revision);
  let proposalCalls=0;
  harness.ctx.UrlFetchApp.fetch=(url,options)=>{proposalCalls++;assert.equal(url,'https://gateway.example/v1/candidate-work-proposal');const sent=JSON.parse(options.payload);
    assert.equal(sent.candidate_ref,item.candidate_ref);assert.equal(sent.candidate_revision,item.candidate_revision);assert.equal(sent.work_fields.source,'PALURU');
    const proposal={kind:'CREATE_WORK',status:'PROPOSED',write_allowed:false,requires_separate_write_approval:true,notion_write:0,target:{project_id:base.projects[0].id},proposed:{title:'PALURU入力からWorkへ',status:'READY',action_type:'ACTION',source:'PALURU',estimate_min:null}};
    return{getResponseCode:()=>200,getContentText:()=>JSON.stringify({candidate_ref:sent.candidate_ref,candidate_revision:sent.candidate_revision,candidate_origin:'PALURU',proposal,writes:{notion:0}})};};
  const answered=harness.call(harness.body('admin-local',{action:'kazOs.inbox.answer',request_id:requestId(),decision_id:item.id,
    question_revision:item.question_revision,source_revision_references:item.source_revision_references,selected_option:'WORK',
    candidate_ref:item.candidate_ref,candidate_revision:item.candidate_revision,work_fields:{project_id:base.projects[0].id,
      title:'PALURU入力からWorkへ',status:'READY',action_type:'ACTION',source:'PALURU',estimate_min:null},reason:null,
    idempotency_key:'paluru-candidate-work-0001'}));
  assert(answered.success,JSON.stringify(answered));assert.equal(proposalCalls,1);
  assert.equal(answered.data.answer.candidate_revision,item.candidate_revision);
  assert.equal(answered.data.proposal.change.create_work_proposal.write_allowed,false);
  assert.equal(answered.data.proposal.change.create_work_proposal.notion_write,0);
  assert.equal(answered.data.proposal.notion_write,0);assert.equal(answered.data.inbox.inbox_items.some(entry=>entry.id===item.id),false);
  assert.equal(harness.rows.Kaz_OS_Decision_Ledger.length,2);
});
test('PALURU createWithAI candidate revision is rechecked against the current owner Inbox row before answer persistence',()=>{
  const base=snapshot(),row={id:'00000000-0000-4000-8000-000000000124',title:'Original title',memo:'Original memo',source:'ai',status:'Inbox',ownerUserId:'father',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  const harness=createHarness({root,answerEnabled:true,decisionLedgerRows:null,inboxProvider:()=>base});
  harness.setupDecisionLedger();harness.resetStats();harness.ctx.readOwnedInboxItems_=()=>[row];
  const read=harness.call(harness.body('admin-local',{action:'kazOs.inbox.get',request_id:requestId()})),item=read.data.inbox_items.find(entry=>entry.kind==='generic_candidate_review');
  row.memo='Changed before answer';let proposalCalls=0;harness.ctx.UrlFetchApp.fetch=()=>{proposalCalls++;throw Error('STALE_CANDIDATE_MUST_NOT_PROPOSE');};
  const result=harness.call(harness.body('admin-local',{action:'kazOs.inbox.answer',request_id:requestId(),decision_id:item.id,
    question_revision:item.question_revision,source_revision_references:item.source_revision_references,selected_option:'WORK',
    candidate_ref:item.candidate_ref,candidate_revision:item.candidate_revision,work_fields:{project_id:base.projects[0].id,
      title:'Original title',status:'READY',action_type:'ACTION',source:'PALURU',estimate_min:null},reason:null,
    idempotency_key:'paluru-candidate-work-0002'}));
  assert.equal(result.error.code,'REVALIDATION_REQUIRED');assert.equal(proposalCalls,0);
  assert.equal(harness.rows.Kaz_OS_Decision_Ledger.length,1);
});
test('controlled INBOX exposes bounded persisted-answer receipt for response-loss reconciliation', () => {
  const item = value.inbox_items[0];
  const result = request(h, item, 'today', 'paluru-reconcile-receipt-0001');
  assert(result.success, JSON.stringify(result));
  const receipts = result.data.inbox.persistence.confirmed_answers;
  assert(Array.isArray(receipts));
  const receipt = receipts.find(entry => entry.decision_id === item.id && entry.question_revision === item.question_revision);
  assert(receipt);
  assert.equal(receipt.persistence_status, 'DURABLE_PERSISTED');
  assert.equal(result.data.inbox.feedback.decision_id, item.id);
  assert.equal(result.data.inbox.feedback.question_revision, item.question_revision);
});
test('same idempotency key and request creates no duplicate', () => {
  const before = h.stats().writes, result = request(h, value.inbox_items[0], 'today');
  assert(result.success, JSON.stringify(result)); assert.equal(result.data.replayed, true); assert.equal(h.stats().writes, before);
  assert.equal(h.rows.Kaz_OS_Decision_Ledger.length, 2);
});
test('same decision with a different answer is rejected', () => {
  const result = request(h, value.inbox_items[0], 'later', 'paluru-test-00000002');
  assert.equal(result.error.code, 'ANSWER_ALREADY_RECORDED'); assert.equal(h.rows.Kaz_OS_Decision_Ledger.length, 2);
});
test('reload and process restart restore the answered state', () => {
  const ledger = structuredClone(h.rows.Kaz_OS_Decision_Ledger), restarted = harness(ledger);
  const result = restarted.call(restarted.body('admin-local', { action: 'kazOs.inbox.get', request_id: requestId() }));
  assert(result.success); assert.equal(result.data.mode, 'controlled_proposal');
  assert.equal(result.data.persistence.answers, 1); assert.equal(result.data.inbox_items.length, 1);
});
test('today preference survives unrelated Calendar revision change', () => {
  const localValue = snapshot();
  const local = createHarness({ root, answerEnabled: true, provider: () => { throw Error('OUT_OF_SCOPE'); },
    projectsProvider: () => { throw Error('OUT_OF_SCOPE'); }, inboxProvider: () => localValue });
  local.setupDecisionLedger(); local.resetStats();
  const original = structuredClone(localValue.inbox_items[0]);
  localValue.sources.calendar.source_revision = 'observation-sha256:' + '8'.repeat(64);
  localValue.sources.resolution.source_revision = localValue.sources.calendar.source_revision;
  localValue.inbox_items.forEach(item => {
    item.source_revision_references = {
      projects: localValue.sources.projects.source_revision,
      work_items: localValue.sources.tasks.source_revision,
      calendar: localValue.sources.calendar.source_revision,
    };
  });
  const result = request(local, original, 'today', 'paluru-planning-calendar-scope-0001');
  assert(result.success, JSON.stringify(result));
  assert.equal(result.data.proposal.change.kind, 'DAILY_PLANNING_PREFERENCE');
});

test('today focus identity ignores unrelated Calendar revision changes', () => {
  let localValue = snapshot();
  const local = createHarness({ root, provider: () => { throw Error('OUT_OF_SCOPE'); },
    projectsProvider: () => { throw Error('OUT_OF_SCOPE'); }, inboxProvider: () => localValue });
  const first = local.call(local.body('admin-local', { action: 'kazOs.inbox.get', request_id: requestId() }));
  assert(first.success, JSON.stringify(first));
  const before = first.data.inbox_items.find(item => item.kind === 'today_focus');
  localValue = structuredClone(localValue);
  localValue.sources.calendar.source_revision = 'observation-sha256:' + '8'.repeat(64);
  localValue.sources.resolution.source_revision = localValue.sources.calendar.source_revision;
  localValue.inbox_items.forEach(item => {
    item.source_revision_references = { ...item.source_revision_references,
      calendar: localValue.sources.calendar.source_revision };
  });
  const second = local.call(local.body('admin-local', { action: 'kazOs.inbox.get', request_id: requestId() }));
  assert(second.success, JSON.stringify(second));
  const after = second.data.inbox_items.find(item => item.kind === 'today_focus');
  assert.equal(after.id, before.id);
  assert.equal(after.question_revision, before.question_revision);
});

test('today preference rejects changed target Work Item revision', () => {
  const localValue = snapshot();
  const local = createHarness({ root, answerEnabled: true, provider: () => { throw Error('OUT_OF_SCOPE'); },
    projectsProvider: () => { throw Error('OUT_OF_SCOPE'); }, inboxProvider: () => localValue });
  local.setupDecisionLedger(); local.resetStats();
  const original = structuredClone(localValue.inbox_items[0]);
  const changedRevision = iso(-100);
  localValue.work_items[0].revision = changedRevision;
  localValue.work_items[0].source_revision = changedRevision;
  localValue.inbox_items[0].entity_revision = changedRevision;
  const result = request(local, original, 'today', 'paluru-planning-work-scope-0001');
  assert.equal(result.error.code, 'REVALIDATION_REQUIRED');
  assert.equal(local.rows.Kaz_OS_Decision_Ledger.length, 1);
});

test('this_week and later expire at next Monday 00:00 JST without permanent mutation', () => {
  for (const preference of ['this_week', 'later']) {
    const localValue = snapshot();
    const local = createHarness({ root, answerEnabled: true, provider: () => { throw Error('OUT_OF_SCOPE'); },
      projectsProvider: () => { throw Error('OUT_OF_SCOPE'); }, inboxProvider: () => localValue });
    local.setupDecisionLedger(); local.resetStats();
    const result = request(local, localValue.inbox_items[0], preference, 'paluru-planning-' + preference + '-0001');
    assert(result.success, JSON.stringify(result));
    const change = result.data.proposal.change;
    assert.equal(change.kind, 'DAILY_PLANNING_PREFERENCE');
    assert.equal(change.preference, preference);
    assert.equal(change.expires_at, nextJstWeekBoundary(change.valid_from));
    assert.equal(change.permanent_priority_change, false);
    assert.equal(change.permanent_status_change, false);
  }
});

test('daily estimate identity ignores unrelated Calendar revision changes', () => {
  let localValue = estimateSnapshot();
  const local = createHarness({ root, answerEnabled: true, provider: () => { throw Error('OUT_OF_SCOPE'); },
    projectsProvider: () => { throw Error('OUT_OF_SCOPE'); }, inboxProvider: () => localValue });
  local.setupDecisionLedger(); local.resetStats();
  const first = local.call(local.body('admin-local', { action: 'kazOs.inbox.get', request_id: requestId() }));
  assert(first.success, JSON.stringify(first));
  const before = first.data.inbox_items.find(item => item.kind === 'daily_estimate');
  localValue = structuredClone(localValue);
  localValue.sources.calendar.source_revision = 'observation-sha256:' + '2'.repeat(64);
  localValue.sources.resolution.source_revision = localValue.sources.calendar.source_revision;
  localValue.inbox_items[0].source_revision_references.calendar = localValue.sources.calendar.source_revision;
  const second = local.call(local.body('admin-local', { action: 'kazOs.inbox.get', request_id: requestId() }));
  const after = second.data.inbox_items.find(item => item.kind === 'daily_estimate');
  assert.equal(after.id, before.id);
  assert.equal(after.question_revision, before.question_revision);
});

test('daily estimate rejects an answer after the target Work Item revision changes', () => {
  let localValue = estimateSnapshot();
  const local = createHarness({ root, answerEnabled: true, provider: () => { throw Error('OUT_OF_SCOPE'); },
    projectsProvider: () => { throw Error('OUT_OF_SCOPE'); }, inboxProvider: () => localValue });
  local.setupDecisionLedger(); local.resetStats();
  const read = local.call(local.body('admin-local', { action: 'kazOs.inbox.get', request_id: requestId() }));
  const original = read.data.inbox_items.find(item => item.kind === 'daily_estimate');
  localValue = structuredClone(localValue);
  const changedRevision = iso(-50);
  localValue.work_items[0].revision = changedRevision;
  localValue.work_items[0].source_revision = changedRevision;
  localValue.inbox_items[0].entity_revision = changedRevision;
  const result = request(local, original, 30, 'paluru-estimate-work-revision-0001');
  assert.equal(result.error.code, 'REVALIDATION_REQUIRED');
  assert.equal(local.rows.Kaz_OS_Decision_Ledger.length, 1);
});

test('stale daily estimate questions disappear after target closure or revision change', () => {
  for (const mode of ['DONE', 'CANCELLED', 'revision']) {
    const localValue = estimateSnapshot();
    if (mode === 'revision') {
      const changedRevision = iso(-50);
      localValue.work_items[0].revision = changedRevision;
      localValue.work_items[0].source_revision = changedRevision;
    } else {
      localValue.work_items[0].state = mode;
    }
    const local = createHarness({ root, answerEnabled: true, provider: () => { throw Error('OUT_OF_SCOPE'); },
      projectsProvider: () => { throw Error('OUT_OF_SCOPE'); }, inboxProvider: () => localValue });
    local.setupDecisionLedger(); local.resetStats();
    const read = local.call(local.body('admin-local', { action: 'kazOs.inbox.get', request_id: requestId() }));
    assert(read.success, JSON.stringify(read));
    assert.equal(read.data.inbox_items.some(item => item.kind === 'daily_estimate'), false, mode);
  }
});

test('daily estimate persists integer minutes only as date-scoped planning evidence', () => {
  const localValue = estimateSnapshot();
  const local = createHarness({ root, answerEnabled: true, provider: () => { throw Error('OUT_OF_SCOPE'); },
    projectsProvider: () => { throw Error('OUT_OF_SCOPE'); }, inboxProvider: () => localValue });
  local.setupDecisionLedger(); local.resetStats();
  const read = local.call(local.body('admin-local', { action: 'kazOs.inbox.get', request_id: requestId() }));
  const question = read.data.inbox_items.find(item => item.kind === 'daily_estimate');
  const result = request(local, question, 30, 'paluru-estimate-0001');
  assert(result.success, JSON.stringify(result));
  const change = result.data.proposal.change;
  assert.equal(change.kind, 'DAILY_ESTIMATE');
  assert.equal(change.estimate_min, 30);
  assert.equal(change.source, 'human');
  assert.equal(change.timezone, 'Asia/Tokyo');
  assert.equal(change.work_item_id, question.entity_ref);
  assert.equal(change.work_item_source_revision, question.entity_revision);
  assert.equal(change.planning_date, question.decision_date);
  assert.equal(change.valid_from, result.data.answer.answered_at);
  assert.equal(change.expires_at, question.expires_at);
  assert.equal(change.permanent_estimate_change, false);
  assert.deepEqual([result.data.proposal.notion_write, result.data.proposal.calendar_write, result.data.proposal.context_write], [0, 0, 0]);
});

test('Work planning Today stores preference and estimate in one revision-bound answer', () => {
  const value = planningEstimateSnapshot();
  const local = createHarness({ root, answerEnabled: true, provider: () => { throw Error('OUT_OF_SCOPE'); },
    projectsProvider: () => { throw Error('OUT_OF_SCOPE'); }, inboxProvider: () => value });
  local.setupDecisionLedger(); local.resetStats();
  const read = local.call(local.body('admin-local', { action: 'kazOs.inbox.get', request_id: requestId() }));
  const question = read.data.inbox_items.find(item => item.kind === 'daily_estimate');
  assert.equal(question.input_contract.type, 'planning_estimate');
  const result = request(local, question, { preference: 'today', estimate_min: 30 }, 'paluru-work-planning-today-0001');
  assert(result.success, JSON.stringify(result));
  const change = result.data.proposal.change;
  assert.equal(change.kind, 'DAILY_PLANNING_PREFERENCE');
  assert.equal(change.work_item_id, question.entity_ref);
  assert.equal(change.preference, 'today');
  assert.equal(change.estimate_min, 30);
  assert.equal(change.expires_at, nextJstDayBoundary(result.data.answer.answered_at));
  assert.equal(change.permanent_estimate_change, false);
  assert.equal(result.data.inbox.inbox_items.some(item => item.id === question.id), false);
  local.ctx.Utilities.formatDate = date => new Date(Date.parse(date.toISOString()) + 9 * 3600000).toISOString().slice(0, 10);
  const evidence = local.ctx.buildKazOsTodayPlanningEvidence_();
  assert.equal(evidence.preferences[0].work_item_id, question.entity_ref);
  assert.equal(evidence.preferences[0].preference, 'today');
  assert.equal(evidence.daily_estimates[0].estimate_min, 30);
  assert.equal(local.rows.Kaz_OS_Decision_Ledger.length, 2);
});

test('Work planning This Week expires tomorrow and Later expires next Monday', () => {
  for (const [preference, suffix] of [['this_week','week'],['later','later']]) {
    const value = planningEstimateSnapshot();
    const local = createHarness({ root, answerEnabled: true, provider: () => { throw Error('OUT_OF_SCOPE'); },
      projectsProvider: () => { throw Error('OUT_OF_SCOPE'); }, inboxProvider: () => value });
    local.setupDecisionLedger(); local.resetStats();
    const read = local.call(local.body('admin-local', { action: 'kazOs.inbox.get', request_id: requestId() }));
    const question = read.data.inbox_items.find(item => item.kind === 'daily_estimate');
    const result = request(local, question, { preference }, 'paluru-work-planning-' + suffix + '-0001');
    assert(result.success, JSON.stringify(result));
    const change = result.data.proposal.change;
    assert.equal(change.work_item_id, question.entity_ref);
    assert.equal(change.preference, preference);
    assert.equal(change.estimate_min, null);
    assert.equal(change.expires_at, preference === 'this_week'
      ? nextJstDayBoundary(result.data.answer.answered_at) : nextJstWeekBoundary(result.data.answer.answered_at));
    assert.equal(result.data.inbox.inbox_items.some(item => item.id === question.id), false);
    assert.equal(local.rows.Kaz_OS_Decision_Ledger.length, 2);
  }
});

test('a Work planning answer suppresses the overlapping Today focus question without allowing a second answer', () => {
  const value = planningEstimateSnapshot(), focus = snapshot().inbox_items[0], target = value.work_items[0];
  focus.entity_ref = target.id;
  focus.entity_revision = target.source_revision;
  focus.project_id = target.project_id;
  focus.source_revision_references = value.inbox_items[0].source_revision_references;
  value.inbox_items.push(focus);
  const local = createHarness({ root, answerEnabled: true, provider: () => { throw Error('OUT_OF_SCOPE'); },
    projectsProvider: () => { throw Error('OUT_OF_SCOPE'); }, inboxProvider: () => value });
  local.setupDecisionLedger(); local.resetStats();
  const read = local.call(local.body('admin-local', { action: 'kazOs.inbox.get', request_id: requestId() }));
  const planning = read.data.inbox_items.find(item => item.kind === 'daily_estimate');
  const oldFocus = read.data.inbox_items.find(item => item.kind === 'today_focus');
  const saved = request(local, planning, { preference: 'this_week' }, 'paluru-work-overlap-0001');
  assert(saved.success, JSON.stringify(saved));
  assert.equal(saved.data.inbox.inbox_items.some(item => item.kind === 'today_focus'), false);
  const stale = request(local, oldFocus, 'today', 'paluru-work-overlap-0002');
  assert.equal(stale.error.code, 'REVALIDATION_REQUIRED');
  assert.equal(local.rows.Kaz_OS_Decision_Ledger.length, 2);
});

test('Work planning rejects Today without valid minutes and deferred choices with minutes', () => {
  for (const [selected, suffix] of [[{preference:'today'},'missing'],
    [{preference:'today',estimate_min:0},'zero'],[{preference:'this_week',estimate_min:30},'week-minutes'],
    [{preference:'later',estimate_min:30},'later-minutes']]) {
    const value = planningEstimateSnapshot();
    const local = createHarness({ root, answerEnabled: true, provider: () => { throw Error('OUT_OF_SCOPE'); },
      projectsProvider: () => { throw Error('OUT_OF_SCOPE'); }, inboxProvider: () => value });
    local.setupDecisionLedger(); local.resetStats();
    const read = local.call(local.body('admin-local', { action: 'kazOs.inbox.get', request_id: requestId() }));
    const question = read.data.inbox_items.find(item => item.kind === 'daily_estimate');
    const result = request(local, question, selected, 'paluru-work-planning-invalid-' + suffix);
    assert.equal(result.error.code, 'KAZ_ANSWER_INVALID');
    assert.equal(local.rows.Kaz_OS_Decision_Ledger.length, 1);
  }
});

test('TODAY does not treat an unavailable active planning ledger as empty evidence', () => {
  const local = createHarness({ root, answerEnabled: true, provider: () => { throw Error('OUT_OF_SCOPE'); },
    projectsProvider: () => { throw Error('OUT_OF_SCOPE'); }, inboxProvider: () => planningEstimateSnapshot() });
  local.ctx.Utilities.formatDate = date => new Date(Date.parse(date.toISOString()) + 9 * 3600000).toISOString().slice(0, 10);
  local.ctx.readKazOsDecisionLedger_ = () => { throw Object.assign(Error('ledger unavailable'), { code: 'KAZ_PERSISTENCE_FAILED' }); };
  assert.throws(() => local.ctx.buildKazOsTodayPlanningEvidence_(), error => error.code === 'KAZ_PERSISTENCE_FAILED');
});

test('daily estimate rejects zero non-integer and text', () => {
  for (const [selected, suffix] of [[0,'zero'],[1.5,'fraction'],['30','text']]) {
    const localValue = estimateSnapshot();
    const local = createHarness({ root, answerEnabled: true, provider: () => { throw Error('OUT_OF_SCOPE'); },
      projectsProvider: () => { throw Error('OUT_OF_SCOPE'); }, inboxProvider: () => localValue });
    local.setupDecisionLedger(); local.resetStats();
    const read = local.call(local.body('admin-local', { action: 'kazOs.inbox.get', request_id: requestId() }));
    const question = read.data.inbox_items.find(item => item.kind === 'daily_estimate');
    const result = request(local, question, selected, 'paluru-estimate-invalid-' + suffix);
    assert.equal(result.error.code, 'KAZ_ANSWER_INVALID');
    assert.equal(local.rows.Kaz_OS_Decision_Ledger.length, 1);
  }
});

test('daily estimate receipt survives question disappearance for response-loss reconcile', () => {
  let localValue = estimateSnapshot();
  const local = createHarness({ root, answerEnabled: true, provider: () => { throw Error('OUT_OF_SCOPE'); },
    projectsProvider: () => { throw Error('OUT_OF_SCOPE'); }, inboxProvider: () => localValue });
  local.setupDecisionLedger(); local.resetStats();
  const read = local.call(local.body('admin-local', { action: 'kazOs.inbox.get', request_id: requestId() }));
  const question = read.data.inbox_items.find(item => item.kind === 'daily_estimate');
  const saved = request(local, question, 45, 'paluru-estimate-reconcile-0001');
  assert(saved.success, JSON.stringify(saved));
  localValue = structuredClone(localValue);
  localValue.inbox_items = [];
  localValue.work_items = [];
  const refreshed = local.call(local.body('admin-local', { action: 'kazOs.inbox.get', request_id: requestId() }));
  const receipt = refreshed.data.persistence.confirmed_answers.find(entry =>
    entry.decision_id === question.id && entry.question_revision === question.question_revision);
  assert(receipt);
  assert.equal(receipt.persistence_status, 'DURABLE_PERSISTED');
});

test('expired planning evidence stays append-only in the Decision Ledger', () => {
  const localValue = estimateSnapshot();
  const local = createHarness({ root, answerEnabled: true, provider: () => { throw Error('OUT_OF_SCOPE'); },
    projectsProvider: () => { throw Error('OUT_OF_SCOPE'); }, inboxProvider: () => localValue });
  local.setupDecisionLedger(); local.resetStats();
  const read = local.call(local.body('admin-local', { action: 'kazOs.inbox.get', request_id: requestId() }));
  const question = read.data.inbox_items.find(item => item.kind === 'daily_estimate');
  const saved = request(local, question, 45, 'paluru-estimate-expired-ledger-0001');
  assert(saved.success, JSON.stringify(saved));
  const rows = local.rows.Kaz_OS_Decision_Ledger;
  const proposalIndex = rows[0].indexOf('proposalJson');
  const proposal = JSON.parse(rows[1][proposalIndex]);
  proposal.change.expires_at = iso(-1);
  rows[1][proposalIndex] = JSON.stringify(proposal);
  const rowCount = rows.length;
  const refreshed = local.call(local.body('admin-local', { action: 'kazOs.inbox.get', request_id: requestId() }));
  assert(refreshed.success, JSON.stringify(refreshed));
  assert.equal(rows.length, rowCount);
  assert.equal(refreshed.data.persistence.answers, 1);
  assert.equal(refreshed.data.persistence.confirmed_answers.length, 0);
});

test('changed source revision rejects stale answer without persistence', () => {
  const original = value, changed = snapshot(), item = changed.inbox_items[1];
  changed.sources.tasks.source_revision = 'observation-sha256:' + '9'.repeat(64); value = changed;
  const before = h.rows.Kaz_OS_Decision_Ledger.length, result = request(h, item, 'none', 'paluru-stale-0001');
  assert.equal(result.error.code, 'REVALIDATION_REQUIRED'); assert.equal(h.rows.Kaz_OS_Decision_Ledger.length, before); value = original;
});
test('Calendar partial creates only an event-bound time-range follow-up', () => {
  const result = request(h, value.inbox_items[1], 'partial', 'paluru-calendar-0001');
  assert(result.success); assert.equal(result.data.proposal.change.kind, 'FOLLOWUP_REQUIRED');
  const followup = result.data.inbox.inbox_items.find(item => item.kind === 'calendar_partial_window');
  assert(followup); assert.equal(followup.entity_ref, value.calendar_events[0].id);
  assert.equal(followup.input_contract.type, 'time_range'); assert.equal(result.data.proposal.change.constraint_creation, false);
  assert.equal(followup.expires_at, new Date(Date.parse(value.calendar_events[0].end)).toISOString());
});
test('Calendar partial follow-up disappears at event end even if source remains fresh', () => {
  const localValue = snapshot();
  const local = createHarness({ root, answerEnabled: true, provider: () => { throw Error('OUT_OF_SCOPE'); },
    projectsProvider: () => { throw Error('OUT_OF_SCOPE'); }, inboxProvider: () => localValue });
  local.setupDecisionLedger(); local.resetStats();
  const first = request(local, localValue.inbox_items[1], 'partial', 'paluru-calendar-expiry-0001');
  assert(first.success, JSON.stringify(first));
  assert(first.data.inbox.inbox_items.some(item => item.kind === 'calendar_partial_window'));
  localValue.calendar_events[0].end = iso(-1);
  localValue.inbox_items[1].calendar_event.end = localValue.calendar_events[0].end;
  const refreshed = local.call(local.body('admin-local', { action: 'kazOs.inbox.get', request_id: requestId() }));
  assert(refreshed.success, JSON.stringify(refreshed));
  assert.equal(refreshed.data.inbox_items.some(item => item.kind === 'calendar_partial_window'), false);
});

test('Calendar partial follow-up survives unrelated Project and Work source revision changes', () => {
  const localValue = snapshot();
  const local = createHarness({ root, answerEnabled: true, provider: () => { throw Error('OUT_OF_SCOPE'); },
    projectsProvider: () => { throw Error('OUT_OF_SCOPE'); }, inboxProvider: () => localValue });
  local.setupDecisionLedger(); local.resetStats();
  const first = request(local, localValue.inbox_items[1], 'partial', 'paluru-calendar-scope-0001');
  assert(first.success, JSON.stringify(first));

  localValue.sources.projects.source_revision = 'observation-sha256:' + '7'.repeat(64);
  localValue.sources.tasks.source_revision = 'observation-sha256:' + '8'.repeat(64);
  localValue.inbox_items.forEach(item => {
    item.source_revision_references = {
      projects: localValue.sources.projects.source_revision,
      work_items: localValue.sources.tasks.source_revision,
      calendar: localValue.sources.calendar.source_revision,
    };
  });

  const refreshed = local.call(local.body('admin-local', { action: 'kazOs.inbox.get', request_id: requestId() }));
  assert(refreshed.success, JSON.stringify(refreshed));
  const followup = refreshed.data.inbox_items.find(item => item.kind === 'calendar_partial_window');
  assert(followup, 'calendar follow-up disappeared after unrelated source revision change');
  assert.equal(followup.source_revision_references.projects, localValue.sources.projects.source_revision);
  assert.equal(followup.source_revision_references.work_items, localValue.sources.tasks.source_revision);

  const start = new Date(Date.parse(localValue.calendar_events[0].start) + 10000).toISOString();
  const end = new Date(Date.parse(localValue.calendar_events[0].end) - 10000).toISOString();
  const second = request(local, followup, { start, end }, 'paluru-calendar-scope-0002');
  assert(second.success, JSON.stringify(second));
  assert.equal(second.data.proposal.change.coverage, 'partial_event');
});
test('INBOX read rebuilds Calendar follow-up without the old parent Decision being present', () => {
  const localValue = snapshot();
  const local = createHarness({ root, answerEnabled: true, provider: () => { throw Error('OUT_OF_SCOPE'); },
    projectsProvider: () => { throw Error('OUT_OF_SCOPE'); }, inboxProvider: () => localValue });
  local.setupDecisionLedger(); local.resetStats();
  const first = request(local, localValue.inbox_items[1], 'partial', 'paluru-calendar-rebuild-0001');
  assert(first.success, JSON.stringify(first));

  localValue.inbox_items = localValue.inbox_items.filter(item => item.kind !== 'calendar_event_impact');
  localValue.sources.projects.source_revision = 'observation-sha256:' + '3'.repeat(64);
  localValue.sources.tasks.source_revision = 'observation-sha256:' + '4'.repeat(64);
  localValue.inbox_items.forEach(item => {
    item.source_revision_references = {
      projects: localValue.sources.projects.source_revision,
      work_items: localValue.sources.tasks.source_revision,
      calendar: localValue.sources.calendar.source_revision,
    };
  });

  const refreshed = local.call(local.body('admin-local', { action: 'kazOs.inbox.get', request_id: requestId() }));
  assert(refreshed.success, JSON.stringify(refreshed));
  const followup = refreshed.data.inbox_items.find(item => item.kind === 'calendar_partial_window');
  assert(followup);
  assert.equal(followup.entity_ref, localValue.calendar_events[0].id);
});
test('missing follow-up target is isolated while unrelated valid Decisions remain available', () => {
  const localValue = snapshot();
  const local = createHarness({ root, answerEnabled: true, provider: () => { throw Error('OUT_OF_SCOPE'); },
    projectsProvider: () => { throw Error('OUT_OF_SCOPE'); }, inboxProvider: () => localValue });
  local.setupDecisionLedger(); local.resetStats();
  const first = request(local, localValue.inbox_items[1], 'partial', 'paluru-calendar-isolation-0001');
  assert(first.success, JSON.stringify(first));

  localValue.calendar_events = [];
  localValue.inbox_items = localValue.inbox_items.filter(item => item.kind === 'today_focus');
  const refreshed = local.call(local.body('admin-local', { action: 'kazOs.inbox.get', request_id: requestId() }));
  assert(refreshed.success, JSON.stringify(refreshed));
  assert.equal(refreshed.data.inbox_items.length, 1);
  assert.equal(refreshed.data.inbox_items[0].kind, 'today_focus');
  assert.equal(refreshed.data.inbox_items.some(item => item.kind === 'calendar_partial_window'), false);
});
test('Calendar partial follow-up question revision ignores unrelated Project and Work revisions', () => {
  const localValue = snapshot();
  const local = createHarness({ root, answerEnabled: true, provider: () => { throw Error('OUT_OF_SCOPE'); },
    projectsProvider: () => { throw Error('OUT_OF_SCOPE'); }, inboxProvider: () => localValue });
  local.setupDecisionLedger(); local.resetStats();
  const first = request(local, localValue.inbox_items[1], 'partial', 'paluru-calendar-qrev-0001');
  assert(first.success, JSON.stringify(first));
  const before = first.data.inbox.inbox_items.find(item => item.kind === 'calendar_partial_window');
  assert(before);

  localValue.sources.projects.source_revision = 'observation-sha256:' + '5'.repeat(64);
  localValue.sources.tasks.source_revision = 'observation-sha256:' + '6'.repeat(64);
  localValue.inbox_items.forEach(item => {
    item.source_revision_references = {
      projects: localValue.sources.projects.source_revision,
      work_items: localValue.sources.tasks.source_revision,
      calendar: localValue.sources.calendar.source_revision,
    };
  });

  const refreshed = local.call(local.body('admin-local', { action: 'kazOs.inbox.get', request_id: requestId() }));
  assert(refreshed.success, JSON.stringify(refreshed));
  const after = refreshed.data.inbox_items.find(item => item.kind === 'calendar_partial_window');
  assert(after);
  assert.equal(after.question_revision, before.question_revision);
});
test('follow-up stores only opaque event reference and no raw Calendar body', () => {
  const get = h.call(h.body('admin-local', { action: 'kazOs.inbox.get', request_id: requestId() }));
  const followup = get.data.inbox_items.find(item => item.kind === 'calendar_partial_window');
  const result = request(h, followup, { start: iso(315000), end: iso(345000) }, 'paluru-calendar-0002');
  assert(result.success, JSON.stringify(result)); assert.equal(result.data.proposal.change.kind, 'CALENDAR_CLASSIFICATION_PROPOSAL');
  assert.equal(result.data.proposal.change.coverage, 'partial_event');
  assert.equal(result.data.inbox.inbox_items.some(item => item.kind === 'calendar_partial_window'), false);
  const persisted = JSON.stringify(h.rows.Kaz_OS_Decision_Ledger);
  assert(!persisted.includes('sanitized event')); assert(!persisted.includes('raw Calendar'));
});
test('missing durable schema fails closed and does not affect Projects', () => {
  const missing = createHarness({ root, answerEnabled: true, provider: () => { throw Error('OUT_OF_SCOPE'); },
    projectsProvider: () => ({ schema_version: 'kaz-projects-0.1', origin: 'notion_official_api' }), inboxProvider: () => snapshot() });
  const result = request(missing, value.inbox_items[1], 'unknown', 'paluru-missing-0001');
  assert.equal(result.error.code, 'KAZ_PERSISTENCE_NOT_CONFIGURED');
  const before = missing.stats().reads; missing.call(missing.body('admin-local', { action: 'kazOs.projects.get' }));
  assert.equal(missing.stats().reads, before + 1);
});
test('source and persistence failures never become a saved answer', () => {
  const failedSource = createHarness({ root, answerEnabled: true, decisionLedgerRows: structuredClone(h.rows.Kaz_OS_Decision_Ledger),
    provider: () => { throw Error('OUT_OF_SCOPE'); }, projectsProvider: () => { throw Error('OUT_OF_SCOPE'); }, inboxProvider: () => { throw Error('SOURCE_DOWN'); } });
  const sourceResult = request(failedSource, value.inbox_items[1], 'unknown', 'paluru-source-0001');
  assert.equal(sourceResult.error.code, 'KAZ_SOURCE_FAILED');
  const failedWrite = createHarness({ root, answerEnabled: true, failDecisionLedgerWrite: true,
    provider: () => { throw Error('OUT_OF_SCOPE'); }, projectsProvider: () => { throw Error('OUT_OF_SCOPE'); }, inboxProvider: () => snapshot() });
  failedWrite.setupDecisionLedger(); failedWrite.resetStats();
  const writeResult = request(failedWrite, value.inbox_items[1], 'unknown', 'paluru-write-0001');
  assert.equal(writeResult.error.code, 'KAZ_PERSISTENCE_FAILED');
  assert.equal(failedWrite.rows.Kaz_OS_Decision_Ledger.length, 1);
});
test('Calendar none is revision-bound classification proposal for opaque refs only', () => {
  const noneValue = snapshot();
  const noneHarness = createHarness({ root, answerEnabled: true, provider: () => { throw Error('OUT_OF_SCOPE'); },
    projectsProvider: () => { throw Error('OUT_OF_SCOPE'); }, inboxProvider: () => noneValue });
  noneHarness.setupDecisionLedger(); noneHarness.resetStats();
  const result = request(noneHarness, noneValue.inbox_items[1], 'none', 'paluru-none-0001');
  assert(result.success); assert.equal(result.data.proposal.change.kind, 'CALENDAR_CLASSIFICATION_PROPOSAL');
  assert.equal(result.data.proposal.change.target_event_ref, noneValue.calendar_events[0].id);
  assert.equal(result.data.proposal.change.impact_on_kaz, 'none'); assert.equal(result.data.proposal.write_allowed, false);
  assert(!JSON.stringify(noneHarness.rows.Kaz_OS_Decision_Ledger).includes('sanitized event'));
});
test('expired or partial sources reject before persistence', () => {
  for (const mode of ['expired', 'partial']) {
    const guarded = snapshot();
    if (mode === 'expired') guarded.inbox_items[1].expires_at = iso(-1);
    else { guarded.sources.calendar.status = 'partial'; guarded.sources.calendar.complete = false; }
    const guardedHarness = createHarness({ root, answerEnabled: true, provider: () => { throw Error('OUT_OF_SCOPE'); },
      projectsProvider: () => { throw Error('OUT_OF_SCOPE'); }, inboxProvider: () => guarded });
    guardedHarness.setupDecisionLedger(); guardedHarness.resetStats();
    const result = request(guardedHarness, guarded.inbox_items[1], 'unknown', 'paluru-guard-' + mode);
    assert.equal(result.error.code, 'REVALIDATION_REQUIRED');
    assert.equal(guardedHarness.rows.Kaz_OS_Decision_Ledger.length, 1);
  }
});
console.log(`kaz-inbox-answer: ${checks}/${checks} PASS`);

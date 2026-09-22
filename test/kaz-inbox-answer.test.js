'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
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

let value = snapshot();
function harness(rows) {
  const h = createHarness({ root, answerEnabled: true, decisionLedgerRows: rows,
    provider: () => { throw Error('OUT_OF_SCOPE'); }, projectsProvider: () => { throw Error('OUT_OF_SCOPE'); }, inboxProvider: () => value });
  if (!rows) h.setupDecisionLedger();
  h.resetStats();
  return h;
}
const requestId = () => require('node:crypto').randomUUID();
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
  assert.deepEqual([result.data.proposal.notion_write, result.data.proposal.calendar_write, result.data.proposal.context_write], [0, 0, 0]);
  assert.equal(result.data.inbox.inbox_items.length, 1); assert.equal(h.rows.Kaz_OS_Decision_Ledger.length, 2);
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

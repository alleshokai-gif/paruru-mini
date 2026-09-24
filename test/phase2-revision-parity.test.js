'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createHarness } = require('./fixtures/kaz-progress-harness');

const root = path.resolve(__dirname, '..');
const vector = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'fixtures', 'phase2_revision_vectors.json'), 'utf8'));
const headers = [
  'answerId', 'proposalId', 'decisionId', 'questionRevision', 'sourceRevisionsJson',
  'actor', 'selectedOptionJson', 'reason', 'answeredAt', 'retainUntil',
  'idempotencyKey', 'requestHash', 'answerJson', 'proposalJson', 'persistenceStatus'
];

function sha(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function inboxDto() {
  const refs = vector.ledger.current_refs;
  const fetchedAt = new Date(Date.now() - 1000).toISOString();
  const validUntil = new Date(Date.now() + 3600000).toISOString();
  const source = (revision, scope) => ({ status: 'ok', complete: true,
    fetched_at: fetchedAt, valid_until: validUntil,
    source_revision: revision, scope });
  const event = { ...vector.ledger.calendar_event, precision: 'offset_datetime',
    classification: 'unconfirmed', source_revision: refs.calendar };
  return { schema_version: 'kaz-secretary-inbox-0.1', origin: 'real_operational_sources',
    mode: 'read_only_display', fixture_only: false, fixture_fallback: false,
    as_of: fetchedAt, timezone: 'Asia/Tokyo',
    sources: { inbox: source('question-set-sha256:vector', 'Secretary Questions'),
      projects: source(refs.projects, 'Notion Projects read-only'),
      tasks: source(refs.work_items, 'Notion Work Items read-only'),
      calendar: source(refs.calendar, 'Family Calendar read-only'),
      resolution: source(refs.calendar, 'Human classification pending') },
    projects: [], work_items: [], calendar_events: [event], inbox_items: [],
    decision_priority_evidence: {}, feedback: null,
    persistence: { kind: 'none', status: 'disabled', answers: 0, proposals: 0, followups: 0 },
    writes: { notion: 0, calendar: 0, context: 0 } };
}

function ledgerRow() {
  const answer = vector.ledger.answer;
  const proposal = vector.ledger.proposal;
  return [answer.answer_id, proposal.proposal_id, answer.decision_id,
    answer.question_revision, JSON.stringify(answer.source_revision_references), 'Kaz',
    JSON.stringify(answer.selected_option), '', answer.answered_at,
    '2027-09-24T08:30:00.000Z', answer.idempotency_key, 'request-vector',
    JSON.stringify(answer), JSON.stringify(proposal), 'PERSISTED'];
}

const calendar = vector.calendar;
const event = calendar.event;
const startMs = Date.parse(event.start);
const endMs = Date.parse(event.end);
assert.equal('calendar-sha256:' + sha(calendar.calendar_id), calendar.expected_selection_id);
assert.equal('event-sha256:' + sha(event.raw_id + '\0' + startMs + '\0' + endMs),
  calendar.expected_capture_event_id);

const current = inboxDto();
const h = createHarness({ root, answerEnabled: true,
  decisionLedgerRows: [headers, ledgerRow()],
  provider: () => { throw Error('OUT_OF_SCOPE'); },
  projectsProvider: () => { throw Error('OUT_OF_SCOPE'); },
  inboxProvider: () => current });
const projected = h.ctx.applyKazOsDecisionLedger_(structuredClone(current));
const followup = projected.inbox_items.find(item => item.id === vector.ledger.expected_followup_id);
assert(followup, 'GAS did not reconstruct the Direct-compatible follow-up');
assert.equal(followup.question_revision, vector.ledger.expected_followup_revision);
assert.equal(followup.answer_contract.question_revision, followup.question_revision);
assert.equal(projected.persistence.confirmed_answers[0].decision_id, vector.ledger.answer.decision_id);

const result = h.call(h.body('admin-local', {
  action: 'kazOs.inbox.answer',
  request_id: crypto.randomUUID(),
  decision_id: followup.id,
  question_revision: followup.question_revision,
  source_revision_references: followup.source_revision_references,
  selected_option: {
    start: '2026-09-24T10:15:00+09:00',
    end: '2026-09-24T11:00:00+09:00'
  },
  reason: null,
  idempotency_key: 'phase2-followup-answer-0001'
}));
assert.equal(result.success, true, JSON.stringify(result));
assert.equal(result.data.answer.decision_id, followup.id);
assert.equal(result.data.answer.question_revision, followup.question_revision);
assert.equal(result.data.proposal.change.kind, 'CALENDAR_CLASSIFICATION_PROPOSAL');
assert.equal(result.data.proposal.write_allowed, false);
assert.deepEqual([
  result.data.proposal.notion_write,
  result.data.proposal.calendar_write,
  result.data.proposal.context_write
], [0, 0, 0]);
assert.equal(h.rows.Kaz_OS_Decision_Ledger.length, 3,
  'GAS Answer fixture must append exactly one compatible ledger row');

console.log('PASS Phase 2 Calendar/Ledger revision vectors and GAS Answer compatibility');

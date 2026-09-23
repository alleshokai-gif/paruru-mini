// Durable Kaz-only Human Answer ledger. This never writes Notion, Calendar or Context.
const KAZ_OS_DECISION_LEDGER_SHEET_ = 'Kaz_OS_Decision_Ledger';
const KAZ_OS_DECISION_LEDGER_HEADERS_ = [
  'answerId', 'proposalId', 'decisionId', 'questionRevision', 'sourceRevisionsJson',
  'actor', 'selectedOptionJson', 'reason', 'answeredAt', 'retainUntil',
  'idempotencyKey', 'requestHash', 'answerJson', 'proposalJson', 'persistenceStatus'
];
const KAZ_OS_ANSWER_RETENTION_DAYS_ = 365;

function isKazOsInboxAnswerEnabled_() {
  try {
    return String(PropertiesService.getScriptProperties().getProperty('KAZ_OS_INBOX_ANSWER_ENABLED') || '').toLowerCase() === 'true';
  } catch (_) {
    return false;
  }
}

// Manual, separately approved production setup only. Runtime answer handling never creates schema.
function setupKazOsDecisionLedger() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw homeMembershipError_('KAZ_PERSISTENCE_NOT_CONFIGURED');
  let sheet = spreadsheet.getSheetByName(KAZ_OS_DECISION_LEDGER_SHEET_);
  if (!sheet) sheet = spreadsheet.insertSheet(KAZ_OS_DECISION_LEDGER_SHEET_);
  const width = Math.max(sheet.getLastColumn(), 1);
  const current = sheet.getRange(1, 1, 1, width).getValues()[0].map(String).filter(Boolean);
  if (current.length && JSON.stringify(current) !== JSON.stringify(KAZ_OS_DECISION_LEDGER_HEADERS_)) {
    throw homeMembershipError_('KAZ_PERSISTENCE_SCHEMA_MISMATCH');
  }
  if (!current.length) sheet.getRange(1, 1, 1, KAZ_OS_DECISION_LEDGER_HEADERS_.length).setValues([KAZ_OS_DECISION_LEDGER_HEADERS_]);
  sheet.setFrozenRows(1);
  return { sheet: KAZ_OS_DECISION_LEDGER_SHEET_, headers: KAZ_OS_DECISION_LEDGER_HEADERS_.length };
}

function answerKazOsInbox_(body, transportTrace) {
  try {
    const input = body || {};
    if (input.action !== 'kazOs.inbox.answer') throw homeMembershipError_('KAZ_READ_ONLY');
    if (!isKazOsLiveEnabled_()) throw homeMembershipError_('KAZ_NOT_CONNECTED');
    const actor = resolveFirebaseAuthenticatedActor_(input);
    authorizeKazOsOwner_(actor);
    recordKazOsAnswerTransport_(transportTrace, 'ACTOR_AUTHORIZED', { outcome: 'success' });
    if (!isKazOsInboxAnswerEnabled_()) throw homeMembershipError_('KAZ_ANSWER_DISABLED');
    const request = validateKazOsAnswerRequest_(input);

    // Re-read every source at answer time. Sanitization enforces completeness and freshness.
    let current, observed;
    try {
      recordKazOsAnswerTransport_(transportTrace, 'SOURCE_REVALIDATION_STARTED', { outcome: 'success' });
      observed = readKazOsInbox_(createKazOsInboxTrace_(request.request_id));
    } catch (_) {
      throw homeMembershipError_('KAZ_SOURCE_FAILED');
    }
    try {
      current = sanitizeKazOsInbox_(observed);
    } catch (_) {
      throw homeMembershipError_('REVALIDATION_REQUIRED');
    }
    const currentQuestions = current.inbox_items.slice();
    const view = applyKazOsDecisionLedger_(JSON.parse(JSON.stringify(current)));
    const question = view.inbox_items.find(function(item) { return item.id === request.decision_id; })
      || currentQuestions.find(function(item) { return item.id === request.decision_id; });
    if (!question || question.question_revision !== request.question_revision
        || !sameKazOsQuestionSourceRevisions_(question, question.source_revision_references, request.source_revision_references)
        || !sameKazOsQuestionSourceRevisions_(question, currentSourceRevisions_(current), request.source_revision_references)
        || (question.expires_at && (!Number.isFinite(Date.parse(question.expires_at)) || Date.parse(question.expires_at) <= Date.now()))) {
      throw homeMembershipError_('REVALIDATION_REQUIRED');
    }
    if (question.kind === 'stale_state_confirmation') {
      const workItem = current.work_items.find(function(item) { return item.id === question.entity_ref; });
      if (!workItem) throw homeMembershipError_('REVALIDATION_REQUIRED');
      question.current_state = workItem.state;
    }
    validateKazOsAnswerSelection_(question, request.selected_option);

    const persisted = persistKazOsAnswer_(question, request, actor);
    recordKazOsAnswerTransport_(transportTrace, 'DURABLE_PERSISTED', { outcome: 'success' });
    const refreshed = applyKazOsDecisionLedger_(current);
    refreshed.feedback = { message: '✓ 回答したで。Operational Sourceはまだ変更してへん',
      answer_id: persisted.answer.answer_id, decision_id: persisted.answer.decision_id,
      question_revision: persisted.answer.question_revision,
      persistence_status: persisted.answer.persistence_status,
      answered_at: persisted.answer.answered_at };
    return json_({ success: true, data: { answer: persisted.answer, proposal: persisted.proposal,
      replayed: persisted.replayed, inbox: refreshed }, message: persisted.replayed ? 'already persisted' : 'persisted' });
  } catch (error) {
    const allowed = ['FORBIDDEN', 'UNAUTHORIZED_DEVICE', 'MEMBERSHIP_NOT_FOUND', 'KAZ_NOT_CONNECTED',
      'KAZ_READ_ONLY', 'KAZ_ANSWER_DISABLED', 'KAZ_ANSWER_INVALID', 'REVALIDATION_REQUIRED',
      'IDEMPOTENCY_CONFLICT', 'ANSWER_ALREADY_RECORDED', 'KAZ_PERSISTENCE_NOT_CONFIGURED',
      'KAZ_PERSISTENCE_SCHEMA_MISMATCH', 'KAZ_PERSISTENCE_FAILED', 'KAZ_SOURCE_FAILED'];
    const code = allowed.indexOf(error && error.code) >= 0 ? error.code : 'KAZ_PERSISTENCE_FAILED';
    recordKazOsAnswerTransport_(transportTrace, 'ANSWER_FAILED', {
      classification: 'business', outcome: 'unresolved', errorCode: code
    });
    return json_({ success: false, data: null, error: { code: code }, message: code });
  }
}

function recordKazOsAnswerTransport_(trace, stage, values) {
  if (typeof recordMiniTransportTrace_ === 'function') recordMiniTransportTrace_(trace, stage, values);
}

function validateKazOsAnswerRequest_(input) {
  const text = function(value, limit) {
    const result = String(value == null ? '' : value).trim();
    if (!result || result.length > limit || /[\u0000-\u001F\u007F]/.test(result)) throw homeMembershipError_('KAZ_ANSWER_INVALID');
    return result;
  };
  const requestId = text(input.request_id, 64).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestId)) throw homeMembershipError_('KAZ_ANSWER_INVALID');
  const idempotencyKey = text(input.idempotency_key, 160);
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(idempotencyKey)) throw homeMembershipError_('KAZ_ANSWER_INVALID');
  const refs = input.source_revision_references;
  if (!refs || ['projects', 'work_items', 'calendar'].some(function(key) {
    return typeof refs[key] !== 'string' || !refs[key] || refs[key].length > 160;
  })) throw homeMembershipError_('KAZ_ANSWER_INVALID');
  let selected = input.selected_option;
  if (Number.isInteger(selected)) {
    if (selected <= 0 || selected > 100000) throw homeMembershipError_('KAZ_ANSWER_INVALID');
  } else if (selected && typeof selected === 'object' && !Array.isArray(selected)) {
    if (Object.keys(selected).sort().join(',') !== 'end,start') throw homeMembershipError_('KAZ_ANSWER_INVALID');
    selected = { start: text(selected.start, 80), end: text(selected.end, 80) };
  } else {
    selected = text(selected, 80);
  }
  const reason = input.reason == null || input.reason === '' ? null : kazOsText_(input.reason, 1000);
  return { request_id: requestId, decision_id: text(input.decision_id, 100),
    question_revision: text(input.question_revision, 100), source_revision_references: {
      projects: refs.projects, work_items: refs.work_items, calendar: refs.calendar },
    selected_option: selected, reason: reason, idempotency_key: idempotencyKey };
}

function validateKazOsAnswerSelection_(question, selected) {
  if (question.kind === 'daily_estimate') {
    const contract = question.input_contract;
    if (!contract || contract.type !== 'integer_minutes' || !Number.isInteger(selected)
        || selected < contract.min || selected > contract.max) throw homeMembershipError_('KAZ_ANSWER_INVALID');
    return;
  }
  if (question.kind === 'calendar_partial_window') {
    const start = selected && Date.parse(selected.start), end = selected && Date.parse(selected.end);
    const allDay = question.calendar_event && question.calendar_event.all_day === true;
    const eventStart = Date.parse(question.calendar_event && question.calendar_event.start + (allDay ? 'T00:00:00+09:00' : ''));
    const eventEnd = Date.parse(question.calendar_event && question.calendar_event.end + (allDay ? 'T00:00:00+09:00' : ''));
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end
        || (Number.isFinite(eventStart) && start < eventStart)
        || (Number.isFinite(eventEnd) && end > eventEnd)
        || (Number.isFinite(eventStart) && Number.isFinite(eventEnd) && start === eventStart && end === eventEnd)) throw homeMembershipError_('KAZ_ANSWER_INVALID');
    return;
  }
  if (selected && typeof selected === 'object' || !question.answer_contract.choices.some(function(choice) { return choice.value === selected; })) {
    throw homeMembershipError_('KAZ_ANSWER_INVALID');
  }
}

function currentSourceRevisions_(inbox) {
  return { projects: inbox.sources.projects.source_revision, work_items: inbox.sources.tasks.source_revision,
    calendar: inbox.sources.calendar.source_revision };
}

function sameKazOsSourceRevisions_(left, right) {
  return Boolean(left && right && ['projects', 'work_items', 'calendar'].every(function(key) { return left[key] === right[key]; }));
}

function sameKazOsQuestionSourceRevisions_(question, left, right) {
  if (!question || !left || !right) return false;
  if (question.kind === 'today_focus' || question.kind === 'daily_estimate') return true;
  const keys = ['calendar_event_impact', 'calendar_partial_window'].indexOf(question.kind) >= 0
    ? ['calendar']
    : ['projects', 'work_items', 'calendar'];
  return keys.every(function(key) { return left[key] === right[key]; });
}

function sameKazOsLedgerSourceRevisions_(row, inbox) {
  const change = row && row.proposal && row.proposal.change;
  const refs = row && row.answer && row.answer.source_revision_references;
  if (!change || !refs || !inbox) return false;
  const currentRefs = currentSourceRevisions_(inbox);
  if (['FOLLOWUP_REQUIRED', 'CALENDAR_CLASSIFICATION_PROPOSAL'].indexOf(change.kind) >= 0) {
    return refs.calendar === currentRefs.calendar;
  }
  if (change.kind === 'DAILY_PLANNING_PREFERENCE' || change.kind === 'DAILY_ESTIMATE') {
    const item = inbox.work_items.find(function(value) { return value.id === change.work_item_id; });
    return Boolean(item && item.source_revision === change.work_item_source_revision);
  }
  return sameKazOsSourceRevisions_(refs, currentRefs);
}

function getKazOsDecisionLedger_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet && spreadsheet.getSheetByName(KAZ_OS_DECISION_LEDGER_SHEET_);
  if (!sheet) throw homeMembershipError_('KAZ_PERSISTENCE_NOT_CONFIGURED');
  const width = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, width).getValues()[0].map(String);
  if (JSON.stringify(headers) !== JSON.stringify(KAZ_OS_DECISION_LEDGER_HEADERS_)) throw homeMembershipError_('KAZ_PERSISTENCE_SCHEMA_MISMATCH');
  return sheet;
}

function readKazOsDecisionLedger_() {
  const sheet = getKazOsDecisionLedger_();
  const values = sheet.getDataRange().getValues();
  const index = Object.fromEntries(KAZ_OS_DECISION_LEDGER_HEADERS_.map(function(name, position) { return [name, position]; }));
  return values.slice(1).filter(function(row) { return String(row[index.answerId] || ''); }).map(function(row) {
    try {
      return { answer: JSON.parse(String(row[index.answerJson])), proposal: JSON.parse(String(row[index.proposalJson])),
        idempotency_key: String(row[index.idempotencyKey]), request_hash: String(row[index.requestHash]) };
    } catch (_) {
      throw homeMembershipError_('KAZ_PERSISTENCE_FAILED');
    }
  });
}

function persistKazOsAnswer_(question, request, actor) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const rows = readKazOsDecisionLedger_();
    const requestValue = { decision_id: request.decision_id, question_revision: request.question_revision,
      source_revision_references: request.source_revision_references, actor: 'Kaz',
      selected_option: request.selected_option, reason: request.reason };
    const requestHash = 'request-sha256:' + kazOsSha256_(stableKazOsJson_(requestValue));
    const byKey = rows.find(function(row) { return row.idempotency_key === request.idempotency_key; });
    if (byKey) {
      if (byKey.request_hash !== requestHash) throw homeMembershipError_('IDEMPOTENCY_CONFLICT');
      return { answer: byKey.answer, proposal: byKey.proposal, replayed: true };
    }
    const existing = rows.find(function(row) {
      return row.answer.decision_id === request.decision_id && row.answer.question_revision === request.question_revision;
    });
    if (existing) {
      if (existing.request_hash !== requestHash) throw homeMembershipError_('ANSWER_ALREADY_RECORDED');
      return { answer: existing.answer, proposal: existing.proposal, replayed: true };
    }
    const answeredAt = new Date().toISOString();
    const retainUntil = new Date(Date.parse(answeredAt) + KAZ_OS_ANSWER_RETENTION_DAYS_ * 86400000).toISOString();
    const seed = request.decision_id + '\u0000' + request.question_revision + '\u0000' + stableKazOsJson_(request.selected_option) + '\u0000Kaz';
    const answerId = 'answer-sha256:' + kazOsSha256_(seed);
    const proposalId = 'proposal-sha256:' + kazOsSha256_(answerId + '\u0000controlled-proposal');
    const answer = { answer_id: answerId, decision_id: request.decision_id,
      question_revision: request.question_revision, source_revision_references: request.source_revision_references,
      actor: 'Kaz', selected_option: request.selected_option, reason: request.reason,
      answered_at: answeredAt, resulting_proposal_id: proposalId,
      persistence_status: 'DURABLE_PERSISTED', idempotency_key: request.idempotency_key };
    const proposal = buildKazOsControlledProposal_(question, answer, proposalId);
    const row = [answerId, proposalId, request.decision_id, request.question_revision,
      stableKazOsJson_(request.source_revision_references), 'Kaz', stableKazOsJson_(request.selected_option),
      request.reason || '', answeredAt, retainUntil, request.idempotency_key, requestHash,
      stableKazOsJson_(answer), stableKazOsJson_(proposal), 'PERSISTED'];
    const sheet = getKazOsDecisionLedger_();
    const rowNumber = sheet.getLastRow() + 1;
    sheet.getRange(rowNumber, 1, 1, KAZ_OS_DECISION_LEDGER_HEADERS_.length).setValues([row]);
    if (typeof SpreadsheetApp.flush === 'function') SpreadsheetApp.flush();
    const saved = sheet.getRange(rowNumber, 1, 1, KAZ_OS_DECISION_LEDGER_HEADERS_.length).getValues()[0];
    if (String(saved[0]) !== answerId || String(saved[1]) !== proposalId || String(saved[14]) !== 'PERSISTED') {
      throw homeMembershipError_('KAZ_PERSISTENCE_FAILED');
    }
    return { answer: answer, proposal: proposal, replayed: false };
  } finally {
    lock.releaseLock();
  }
}

function buildKazOsControlledProposal_(question, answer, proposalId) {
  const selected = answer.selected_option;
  let change;
  if (question.kind === 'calendar_event_impact') {
    const eventRef = question.calendar_event && question.calendar_event.ref;
    if (!eventRef) throw homeMembershipError_('KAZ_ANSWER_INVALID');
    if (selected === 'partial') change = { kind: 'FOLLOWUP_REQUIRED', follow_up: 'calendar_partial_window',
      target_event_ref: eventRef, constraint_creation: false };
    else if (selected === 'all') change = { kind: 'CALENDAR_CLASSIFICATION_PROPOSAL', target_event_ref: eventRef,
      impact_on_kaz: 'hard_constraint', coverage: 'full_event', classification_source: 'user', constraint_creation: false };
    else if (selected === 'none') change = { kind: 'CALENDAR_CLASSIFICATION_PROPOSAL',
      target_event_ref: eventRef, impact_on_kaz: 'none', classification_source: 'user', constraint_creation: false };
    else change = { kind: 'NO_OPERATIONAL_CHANGE', unknown_window_maintained: true };
  } else if (question.kind === 'today_focus') {
    if (!question.entity_ref || !question.entity_revision || !question.decision_date) throw homeMembershipError_('KAZ_ANSWER_INVALID');
    const preference = selected === 'today' ? 'today' : selected === 'this_week' ? 'this_week' : 'later';
    const validFrom = answer.answered_at;
    const answeredJst = new Date(Date.parse(answer.answered_at) + 9 * 60 * 60 * 1000);
    let expires;
    if (preference === 'today') {
      expires = new Date(Date.UTC(answeredJst.getUTCFullYear(), answeredJst.getUTCMonth(), answeredJst.getUTCDate() + 1) - 9 * 60 * 60 * 1000);
    } else {
      const day = answeredJst.getUTCDay();
      const daysUntilMonday = day === 0 ? 1 : 8 - day;
      expires = new Date(Date.UTC(answeredJst.getUTCFullYear(), answeredJst.getUTCMonth(), answeredJst.getUTCDate() + daysUntilMonday) - 9 * 60 * 60 * 1000);
    }
    change = { kind: 'DAILY_PLANNING_PREFERENCE', work_item_id: question.entity_ref,
      planning_date: question.decision_date, timezone: 'Asia/Tokyo', preference: preference, source: 'human',
      work_item_source_revision: question.entity_revision, project_source_revision: null,
      valid_from: validFrom, expires_at: expires.toISOString(),
      permanent_priority_change: false, permanent_status_change: false };
  } else if (question.kind === 'daily_estimate') {
    if (!question.entity_ref || !question.entity_revision || !question.decision_date
        || !Number.isInteger(selected) || selected <= 0) throw homeMembershipError_('KAZ_ANSWER_INVALID');
    change = { kind: 'DAILY_ESTIMATE', work_item_id: question.entity_ref,
      planning_date: question.decision_date, timezone: 'Asia/Tokyo', estimate_min: selected, source: 'human',
      work_item_source_revision: question.entity_revision, valid_from: answer.answered_at,
      expires_at: question.expires_at, permanent_estimate_change: false };
  } else if (question.kind === 'stale_state_confirmation') {
    change = selected === 'complete' ? { kind: 'WORK_ITEM_STATE_CHANGE', work_item_id: question.entity_ref,
      expected_before: question.current_state, desired_after: 'DONE' } : { kind: 'NO_OPERATIONAL_CHANGE', state_maintained: true };
  } else if (question.kind === 'calendar_partial_window') {
    change = { kind: 'CALENDAR_CLASSIFICATION_PROPOSAL', target_event_ref: question.calendar_event.ref,
      impact_on_kaz: 'hard_constraint', coverage: 'partial_event', constraint_window: selected,
      classification_source: 'user', constraint_creation: false };
  } else {
    throw homeMembershipError_('KAZ_ANSWER_INVALID');
  }
  return { proposal_id: proposalId, answer_id: answer.answer_id, decision_id: answer.decision_id,
    question_revision: answer.question_revision, source_revision_references: answer.source_revision_references,
    created_at: answer.answered_at, status: 'PROPOSED', write_allowed: false,
    requires_separate_write_approval: true, notion_write: 0, calendar_write: 0, context_write: 0,
    change: change };
}

function applyKazOsDecisionLedger_(inbox) {
  if (!isKazOsInboxAnswerEnabled_()) return inbox;
  const rows = readKazOsDecisionLedger_();
  const currentAnswers = rows.filter(function(row) {
    return sameKazOsLedgerSourceRevisions_(row, inbox);
  });
  const answered = new Set(currentAnswers.map(function(row) { return row.answer.decision_id + '\u0000' + row.answer.question_revision; }));
  const pending = inbox.inbox_items.filter(function(item) { return !answered.has(item.id + '\u0000' + item.question_revision); });
  currentAnswers.forEach(function(row) {
    if (row.proposal.change.kind === 'FOLLOWUP_REQUIRED') {
      const followup = buildKazOsCalendarFollowup_(row, inbox);
      if (followup && !answered.has(followup.id + '\u0000' + followup.question_revision)) pending.push(followup);
    }
  });
  const orderedAnswers = currentAnswers.slice().sort(function(a, b) { return a.answer.answered_at.localeCompare(b.answer.answered_at); });
  const latest = orderedAnswers[orderedAnswers.length - 1];
  inbox.mode = 'controlled_proposal';
  inbox.inbox_items = pending;
  inbox.feedback = latest ? { message: '✓ 回答したで。Operational Sourceはまだ変更してへん',
    answer_id: latest.answer.answer_id, decision_id: latest.answer.decision_id,
    question_revision: latest.answer.question_revision,
    persistence_status: latest.answer.persistence_status,
    answered_at: latest.answer.answered_at } : null;
  inbox.persistence = { kind: 'paluru_spreadsheet_append_only', status: 'enabled',
    answers: rows.length, proposals: rows.length, followups: currentAnswers.filter(function(row) {
      return row.proposal.change.kind === 'FOLLOWUP_REQUIRED'; }).length,
    confirmed_answers: orderedAnswers.slice(Math.max(0, orderedAnswers.length - 20)).map(function(row) {
      return { decision_id: row.answer.decision_id, question_revision: row.answer.question_revision,
        persistence_status: row.answer.persistence_status };
    }) };
  return inbox;
}

function buildKazOsCalendarFollowup_(row, inbox) {
  const answer = row && row.answer;
  const change = row && row.proposal && row.proposal.change;
  const eventRef = String(change && change.target_event_ref || '');
  const event = eventRef && inbox.calendar_events.find(function(item) { return item.id === eventRef; });
  if (!answer || !event || change.kind !== 'FOLLOWUP_REQUIRED' || change.follow_up !== 'calendar_partial_window') return null;
  const currentRefs = currentSourceRevisions_(inbox);
  const id = 'decision-' + kazOsSha256_(answer.decision_id + '\u0000' + event.id + '\u0000' + currentRefs.calendar).slice(0, 24);
  const base = { id: id, kind: 'calendar_partial_window', contract: 'secretary-question-0.1', owner: 'kaz',
    decision_requested: true, decision_status: 'pending', write_allowed: false,
    title: event.title, question: 'この予定のうち、Kaz本人が拘束される開始と終了を指定してな。',
    reason: '一部拘束の時間帯を、このeventだけに束縛して確定するため',
    impact: 'このeventだけの部分拘束proposalを作る', estimate_min: null,
    affects_today: true, urgent_today: true, decision_date: inbox.as_of.slice(0, 10), due_at: null,
    project_id: null, entity_ref: event.id, source_label: 'Family Calendar', entity_revision: null,
    source_revision_references: currentRefs,
    answer_contract: { inbox_item_id: id, question_revision: null,
      question: 'この予定のうち、Kaz本人が拘束される開始と終了を指定してな。',
      choices: [{ value: 'time_range', label: '拘束時間を指定', effect: 'event単位の部分拘束proposalを作る' }] },
    calendar_event: { ref: event.id, title: event.title, start: event.start, end: event.end, all_day: event.all_day },
    input_contract: { type: 'time_range', timezone: 'Asia/Tokyo', start_required: true, end_required: true, within_event: true },
    recommended_option: null, recommendation_basis: null,
    expires_at: inbox.sources.calendar.valid_until };
  const revisionSeed = {
    id: base.id,
    kind: base.kind,
    contract: base.contract,
    entity_ref: base.entity_ref,
    calendar_event: base.calendar_event,
    input_contract: base.input_contract,
    answer_contract: { question: base.answer_contract.question, choices: base.answer_contract.choices },
    calendar_source_revision: currentRefs.calendar
  };
  base.question_revision = 'question-sha256:' + kazOsSha256_(stableKazOsJson_(revisionSeed));
  base.answer_contract.question_revision = base.question_revision;
  return base;
}

function stableKazOsJson_(value) {
  if (Array.isArray(value)) return '[' + value.map(stableKazOsJson_).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(function(key) {
    return JSON.stringify(key) + ':' + stableKazOsJson_(value[key]);
  }).join(',') + '}';
  return JSON.stringify(value);
}

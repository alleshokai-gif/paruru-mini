// Fresh Secretary Questions for the authorized Kaz owner. No answer or writer exists here.
var KAZ_OS_INBOX_TRACE_RELEASE_ = 'phase4c3-redacted-trace-v1';
var KAZ_OS_INBOX_TRACE_STAGES_ = ['REQUEST_RECEIVED', 'ROUTER_MATCHED', 'AUTH_PASSED', 'INBOX_READ_STARTED',
  'CALENDAR_CAPTURE_OK', 'CALENDAR_CAPTURE_FAILED', 'GATEWAY_POST_STARTED', 'GATEWAY_RESPONSE', 'SANITIZER_OK', 'RESPONSE_SENT'];
var KAZ_OS_INBOX_TRACE_ERROR_CODES_ = ['FORBIDDEN', 'UNAUTHORIZED_DEVICE', 'MEMBERSHIP_NOT_FOUND', 'KAZ_NOT_CONNECTED',
  'KAZ_READ_ONLY', 'KAZ_REQUEST_ID_INVALID', 'KAZ_SOURCE_FAILED'];

function createKazOsInboxTrace_(requestId) {
  const normalized = String(requestId || '').trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)) return null;
  return { request_id: normalized, started_at_ms: Date.now() };
}

function recordKazOsInboxTrace_(trace, stage, values) {
  if (!trace || KAZ_OS_INBOX_TRACE_STAGES_.indexOf(stage) < 0) return;
  const input = values || {};
  const safeNumber = function(value, upper) {
    return Number.isInteger(value) && value >= 0 && value <= upper ? value : null;
  };
  const requestedCode = String(input.error_code || '');
  const entry = {
    request_id: trace.request_id,
    timestamp: new Date().toISOString(),
    stage: stage,
    error_code: requestedCode ? (KAZ_OS_INBOX_TRACE_ERROR_CODES_.indexOf(requestedCode) >= 0 ? requestedCode : 'KAZ_SOURCE_FAILED') : null,
    event_count: safeNumber(input.event_count, 200),
    http_status: safeNumber(input.http_status, 599),
    question_count: safeNumber(input.question_count, 20),
    elapsed_ms: safeNumber(Math.max(0, Date.now() - trace.started_at_ms), 600000),
    gas_version: KAZ_OS_INBOX_TRACE_RELEASE_
  };
  if (typeof Logger !== 'undefined' && typeof Logger.log === 'function') {
    Logger.log('[KAZ_OS_INBOX_TRACE] ' + JSON.stringify(entry));
  }
}

function safeKazOsInboxTraceErrorCode_(error) {
  const code = String(error && error.code || '');
  return KAZ_OS_INBOX_TRACE_ERROR_CODES_.indexOf(code) >= 0 ? code : 'KAZ_SOURCE_FAILED';
}

function readKazOsInbox_(trace, transportTrace) {
  const props = PropertiesService.getScriptProperties();
  const url = String(props.getProperty('KAZ_OS_INBOX_READ_URL') || '');
  const token = String(props.getProperty('KAZ_OS_PROGRESS_READ_TOKEN') || '');
  if (!/^https:\/\/[^\s?#]+\/v1\/inbox$/.test(url) || token.length < 32) throw homeMembershipError_('KAZ_NOT_CONNECTED');
  let capture;
  recordKazOsTransport_(transportTrace, 'CALENDAR_CAPTURE_START', { outcome: 'progress' });
  try {
    capture = buildKazOsCalendarCapture_();
    recordKazOsTransport_(transportTrace, 'CALENDAR_CAPTURE_END', { outcome: 'progress' });
    recordKazOsInboxTrace_(trace, 'CALENDAR_CAPTURE_OK', { event_count: capture.response.events.length });
  } catch (error) {
    recordKazOsTransport_(transportTrace, 'CALENDAR_CAPTURE_END', {
      classification: 'business', outcome: 'unresolved', errorCode: 'KAZ_SOURCE_FAILED'
    });
    recordKazOsInboxTrace_(trace, 'CALENDAR_CAPTURE_FAILED', { error_code: safeKazOsInboxTraceErrorCode_(error) });
    throw error;
  }
  const eventCount = capture.response.events.length;
  recordKazOsInboxTrace_(trace, 'GATEWAY_POST_STARTED', { event_count: eventCount });
  recordKazOsTransport_(transportTrace, 'CLOUD_RUN_START', { outcome: 'progress' });
  let response;
  try {
    const classifications = typeof buildKazOsTodayPlanningClassifications_ === 'function'
      ? buildKazOsTodayPlanningClassifications_() : [];
    const planning = typeof buildKazOsTodayPlanningEvidence_ === 'function'
      ? buildKazOsTodayPlanningEvidence_() : { timezone: 'Asia/Tokyo',
        planning_date: Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd'),
        preferences: [], daily_estimates: [] };
    response = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify({ calendar_capture: capture, classifications: { items: classifications }, planning: planning }),
      headers: { Authorization: 'Bearer ' + token, 'X-Kaz-Request-Id': trace.request_id }, muteHttpExceptions: true,
      followRedirects: false, validateHttpsCertificates: true
    });
  } catch (_) {
    recordKazOsTransport_(transportTrace, 'CLOUD_RUN_END', {
      classification: 'unknown', outcome: 'unresolved', errorCode: 'KAZ_SOURCE_FAILED'
    });
    recordKazOsInboxTrace_(trace, 'GATEWAY_RESPONSE', { event_count: eventCount, error_code: 'KAZ_SOURCE_FAILED' });
    throw homeMembershipError_('KAZ_SOURCE_FAILED');
  }
  const httpStatus = response.getResponseCode();
  recordKazOsTransport_(transportTrace, 'CLOUD_RUN_END', {
    classification: httpStatus === 200 ? 'none' : 'http',
    outcome: httpStatus === 200 ? 'progress' : 'unresolved',
    httpStatus: httpStatus,
    errorCode: httpStatus === 200 ? null : 'KAZ_SOURCE_FAILED'
  });
  recordKazOsInboxTrace_(trace, 'GATEWAY_RESPONSE', { event_count: eventCount, http_status: httpStatus,
    error_code: httpStatus === 200 ? null : 'KAZ_SOURCE_FAILED' });
  if (httpStatus !== 200) throw homeMembershipError_('KAZ_SOURCE_FAILED');
  const text = response.getContentText();
  if (text.length > 524288) throw homeMembershipError_('KAZ_SOURCE_FAILED');
  return JSON.parse(text);
}

function buildKazOsInboxWithPaluruCandidates_(data, actor) {
  if (!data || !Array.isArray(data.inbox_items) || !actor || typeof readOwnedInboxItems_ !== 'function') {
    throw homeMembershipError_('KAZ_SOURCE_FAILED');
  }
  const choices = [
    { value: 'CONTEXT', label: 'CONTEXT', effect: 'Context候補として記録する' },
    { value: 'WORK', label: 'WORK', effect: 'CREATE_WORK proposalを作る' },
    { value: 'PROJECT', label: 'PROJECT', effect: 'Project候補として保留する' },
    { value: 'HOLD', label: 'HOLD', effect: '保留する' },
    { value: 'REJECT', label: 'REJECT', effect: '候補から外す' },
    { value: 'MERGE', label: 'MERGE', effect: '既存項目との統合候補にする' }
  ];
  const rows = readOwnedInboxItems_(actor).filter(function(item) {
    return item && String(item.source || '').trim() === 'PWA'
      && String(item.status || '').trim().toLowerCase() === 'inbox'
      && String(item.ownerUserId || '') === String(actor.memberUserId || '')
      && /^[0-9a-f-]{36}$/i.test(String(item.id || ''));
  }).sort(function(left, right) {
    return Date.parse(right.createdAt || '') - Date.parse(left.createdAt || '');
  }).slice(0, 10);
  if (!rows.length) return data;
  const references = { projects: data.sources.projects.source_revision,
    work_items: data.sources.tasks.source_revision, calendar: data.sources.calendar.source_revision };
  const candidates = rows.map(function(item) {
    const snapshot = { id: String(item.id), title: kazOsText_(item.title || item.memo || 'PALURU入力', 200),
      memo: String(item.memo || ''), source: String(item.source || ''), status: String(item.status || ''),
      created_at: String(item.createdAt || ''), updated_at: String(item.updatedAt || '') };
    const digest = kazOsSha256_(stableKazOsJson_(snapshot));
    const revision = 'paluru-inbox-sha256:' + digest;
    const candidateRef = 'paluru-inbox://' + snapshot.id.toLowerCase() + '@sha256:' + digest;
    const id = 'candidate-review-' + kazOsSha256_(candidateRef + '\u0000' + revision).slice(0, 24);
    const question = 'このPALURU入力をどう扱う？';
    const seed = { id: id, candidate_ref: candidateRef, candidate_revision: revision,
      candidate_origin: 'PALURU', title: snapshot.title, choices: choices };
    const questionRevision = 'question-sha256:' + kazOsSha256_(stableKazOsJson_(seed));
    const content = (snapshot.title + (snapshot.memo ? '\n\n' + snapshot.memo : '')).slice(0, 16384);
    return { id: id, kind: 'generic_candidate_review', contract: 'generic-candidate-review-0.1',
      owner: 'kaz', decision_requested: true, decision_status: 'pending', write_allowed: false,
      title: snapshot.title, question: question, reason: 'PALURUで本人が入力した未処理Inbox項目',
      impact: 'WORK選択時はCREATE_WORK proposalだけを作成する', entity_ref: candidateRef,
      candidate_ref: candidateRef, candidate_revision: revision, candidate_origin: 'PALURU',
      candidate_source: 'PALURU INBOX', candidate_content: content, source_label: 'PALURU INBOX',
      question_revision: questionRevision, source_revision_references: references,
      answer_contract: { inbox_item_id: id, question_revision: questionRevision,
        question: question, choices: choices } };
  });
  const otherItems = data.inbox_items.filter(function(item) {
    return !(item && item.contract === 'generic-candidate-review-0.1');
  });
  const githubItems = data.inbox_items.filter(function(item) {
    return item && item.contract === 'generic-candidate-review-0.1' && item.candidate_origin !== 'PALURU';
  });
  const candidateLimit = Math.max(0, 10 - candidates.length);
  const inboxLimit = Math.max(0, 40 - otherItems.length - candidates.length);
  const selectedCandidates = candidates.slice(0, 10).concat(githubItems.slice(0, Math.min(candidateLimit, inboxLimit)));
  const now = new Date().toISOString();
  const indexRevision = 'paluru-inbox-index-sha256:' + kazOsSha256_(rows.map(function(item) {
    return String(item.id) + '\u0000' + String(item.updatedAt || '');
  }).join('\n'));
  const result = Object.assign({}, data, { sources: Object.assign({}, data.sources, {
    paluru_candidates: { status: 'ok', complete: true, fetched_at: now,
      valid_until: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      source_revision: indexRevision, scope: 'Authenticated owner PWA Inbox' }
  }), inbox_items: otherItems.concat(selectedCandidates) });
  return result;
}

function buildKazOsCalendarCapture_() {
  const timezone = 'Asia/Tokyo';
  const config = getCalendarConfig_('family');
  const calendar = getCalendarByConfig_(config);
  if (String(calendar.getName ? calendar.getName() : '') !== 'ファミリー') throw homeMembershipError_('KAZ_SOURCE_FAILED');
  const day = Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd');
  const start = new Date(day + 'T00:00:00+09:00');
  const end = new Date(start.getTime() + 36 * 60 * 60 * 1000);
  const raw = calendar.getEvents(start, end);
  if (!Array.isArray(raw) || raw.length > 200) throw homeMembershipError_('KAZ_SOURCE_FAILED');
  const seen = {};
  const events = raw.map(function(event) {
    if (!event || typeof event.getId !== 'function' || typeof event.getTitle !== 'function'
        || typeof event.getStartTime !== 'function' || typeof event.getEndTime !== 'function'
        || typeof event.getTransparency !== 'function') throw homeMembershipError_('KAZ_SOURCE_FAILED');
    const left = event.getStartTime(), right = event.getEndTime();
    if (!(left instanceof Date) || !(right instanceof Date) || right.getTime() <= left.getTime()) throw homeMembershipError_('KAZ_SOURCE_FAILED');
    const id = 'event-sha256:' + kazOsSha256_(String(event.getId()) + '\u0000' + left.getTime() + '\u0000' + right.getTime());
    if (seen[id]) throw homeMembershipError_('KAZ_SOURCE_FAILED');
    seen[id] = true;
    const allDay = Boolean(event.isAllDayEvent && event.isAllDayEvent());
    const eventStart = allDay && event.getAllDayStartDate ? event.getAllDayStartDate() : left;
    const eventEnd = allDay && event.getAllDayEndDate ? event.getAllDayEndDate() : right;
    const transparency = String(event.getTransparency()) === String(CalendarApp.EventTransparency.TRANSPARENT)
      ? 'transparent' : 'opaque';
    return { id: id, summary: kazOsText_(event.getTitle(), 200),
      start: Utilities.formatDate(eventStart, timezone, allDay ? 'yyyy-MM-dd' : "yyyy-MM-dd'T'HH:mm:ssXXX"),
      end: Utilities.formatDate(eventEnd, timezone, allDay ? 'yyyy-MM-dd' : "yyyy-MM-dd'T'HH:mm:ssXXX"),
      transparency: transparency };
  });
  return { selection: { id: 'calendar-sha256:' + kazOsSha256_(config.calendarId), summary: 'ファミリー', primary: false },
    horizon: { start: Utilities.formatDate(start, timezone, "yyyy-MM-dd'T'HH:mm:ssXXX"),
      end: Utilities.formatDate(end, timezone, "yyyy-MM-dd'T'HH:mm:ssXXX") },
    fetched_at: Utilities.formatDate(new Date(), timezone, "yyyy-MM-dd'T'HH:mm:ssXXX"),
    response: { events: events, next_page_token: null },
    connector_receipt: { configured_calendar_reads: 1, event_read_requests: 1,
      calendar_write_requests: 0, other_calendar_event_reads: 0,
      status: 'SUCCESS', complete: true, transport: 'paluru_gas' } };
}

function kazOsSha256_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value), Utilities.Charset.UTF_8)
    .map(function(byte) { const n = byte < 0 ? byte + 256 : byte; return ('0' + n.toString(16)).slice(-2); }).join('');
}

function kazOsText_(value, limit) {
  return Array.from(String(value == null ? '' : value).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim())
    .slice(0, limit || 200).join('');
}

function sanitizeKazOsInbox_(data) {
  const fail = function() { throw homeMembershipError_('KAZ_SOURCE_FAILED'); };
  const text = function(value, limit, nullable) {
    if (nullable && value == null) return null;
    if (typeof value !== 'string' || value.length > (limit || 300)) fail();
    return value;
  };
  const boolean = function(value) { if (typeof value !== 'boolean') fail(); return value; };
  const number = function(value, nullable) { if (nullable && value == null) return null; if (!Number.isInteger(value) || value < 0 || value > 100000) fail(); return value; };
  const list = function(value, limit, mapper) { if (!Array.isArray(value) || value.length > limit) fail(); return value.map(mapper); };
  const states = ['IDEA','BACKLOG','READY','SCHEDULED','DOING','WAITING','BLOCKED','CODEX_RUNNING','HUMAN_REVIEW','ACCEPTANCE','DONE','CANCELLED'];
  const kinds = ['stale_state_confirmation','calendar_event_impact','today_focus','calendar_partial_window','daily_estimate'];
  const gardenerKinds = ['CONTEXT_CANDIDATE','CONFLICT_RESOLUTION'];
  const candidateChoices = ['CONTEXT','WORK','PROJECT','HOLD','REJECT','MERGE'];
  const source = function(value) {
    if (!value || value.status !== 'ok' || value.complete !== true) fail();
    const fetched = Date.parse(value.fetched_at), until = Date.parse(value.valid_until);
    if (!Number.isFinite(fetched) || !Number.isFinite(until) || fetched > Date.now() + 60000 || until <= Date.now()) fail();
    return { status: 'ok', complete: true, fetched_at: text(value.fetched_at, 80),
      valid_until: text(value.valid_until, 80), source_revision: text(value.source_revision, 120),
      scope: text(value.scope, 160) };
  };
  if (!data || data.schema_version !== 'kaz-secretary-inbox-0.1'
      || data.origin !== 'real_operational_sources' || data.mode !== 'read_only_display'
      || data.fixture_only !== false || data.fixture_fallback !== false) fail();
  const sources = {};
  ['inbox','projects','tasks','calendar','resolution'].forEach(function(key) { sources[key] = source(data.sources && data.sources[key]); });
  let gardener = null;
  if (data.sources && data.sources.context_gardener != null) {
    const value = data.sources.context_gardener;
    if (!value || ['ok','blocked'].indexOf(value.status) < 0 || typeof value.complete !== 'boolean') fail();
    if (value.status === 'ok' && value.complete !== true) fail();
    if (value.status === 'blocked' && value.complete !== false) fail();
    gardener = {
      status: value.status, complete: value.complete,
      fetched_at: text(value.fetched_at, 80, true), valid_until: text(value.valid_until, 80, true),
      source_revision: text(value.source_revision, 120, true), scope: text(value.scope, 160)
    };
    sources.context_gardener = gardener;
  }
  let githubCandidates = null;
  if (data.sources && data.sources.github_candidates != null) {
    const value = data.sources.github_candidates;
    if (!value || ['ok','blocked'].indexOf(value.status) < 0 || typeof value.complete !== 'boolean'
        || (value.status === 'ok' && value.complete !== true)
        || (value.status === 'blocked' && value.complete !== false)) fail();
    if (value.status === 'ok') {
      const fetched = Date.parse(value.fetched_at), until = Date.parse(value.valid_until);
      if (!Number.isFinite(fetched) || !Number.isFinite(until) || fetched > Date.now() + 60000 || until <= Date.now()) fail();
    } else if (value.fetched_at != null || value.valid_until != null || value.source_revision != null) fail();
    githubCandidates = { status: value.status, complete: value.complete,
      fetched_at: text(value.fetched_at, 80, true), valid_until: text(value.valid_until, 80, true),
      source_revision: text(value.source_revision, 120, true), scope: text(value.scope, 240) };
    sources.github_candidates = githubCandidates;
  }
  let paluruCandidates = null;
  if (data.sources && data.sources.paluru_candidates != null) {
    const value = data.sources.paluru_candidates;
    if (!value || value.status !== 'ok' || value.complete !== true) fail();
    const fetched = Date.parse(value.fetched_at), until = Date.parse(value.valid_until);
    if (!Number.isFinite(fetched) || !Number.isFinite(until) || fetched > Date.now() + 60000 || until <= Date.now()) fail();
    paluruCandidates = { status: 'ok', complete: true, fetched_at: text(value.fetched_at, 80),
      valid_until: text(value.valid_until, 80), source_revision: text(value.source_revision, 120),
      scope: text(value.scope, 160) };
    sources.paluru_candidates = paluruCandidates;
  }
  if (!data.writes || data.writes.notion !== 0 || data.writes.calendar !== 0 || data.writes.context !== 0
      || !data.persistence || data.persistence.kind !== 'none' || data.persistence.status !== 'disabled') fail();
  const projects = list(data.projects, 20, function(value) {
    if (!value || ['ACTIVE','REVIEW','BLOCKED','BACKLOG','DONE'].indexOf(value.status) < 0) fail();
    return { id: text(value.id, 80), title: text(value.title, 200), status: value.status,
      source_revision: text(value.source_revision, 80) };
  });
  const workItems = list(data.work_items, 50, function(value) {
    if (!value || states.indexOf(value.state) < 0 || value.next_actor !== 'kaz') fail();
    return { id: text(value.id, 80), title: text(value.title, 200), state: value.state,
      project_id: text(value.project_id, 80), revision: text(value.revision, 80),
      source_revision: text(value.source_revision, 80), estimate_min: number(value.estimate_min, true),
      next_actor: 'kaz', blocker: text(value.blocker, 300), action_instruction: text(value.action_instruction, 300),
      dependencies: list(value.dependencies, 20, function(item) { return text(item, 80); }) };
  });
  const calendarEvents = list(data.calendar_events, 200, function(value) {
    if (!value || ['offset_datetime','date_only','unresolved'].indexOf(value.precision) < 0 || value.classification !== 'unconfirmed') fail();
    return { id: text(value.id, 90), title: text(value.title, 200), start: text(value.start, 80, true),
      end: text(value.end, 80, true), precision: value.precision, all_day: boolean(value.all_day), classification: 'unconfirmed',
      source_revision: text(value.source_revision, 120) };
  });
  let secretaryItemCount = 0, gardenerItemCount = 0, candidateReviewCount = 0;
  const inboxItems = list(data.inbox_items, 40, function(value) {
    if (!value || value.owner !== 'kaz' || value.decision_requested !== true || value.decision_status !== 'pending'
        || value.write_allowed !== false) fail();
    if (value.contract === 'generic-candidate-review-0.1') {
      candidateReviewCount++;
      const isPaluruCandidate = value.candidate_origin === 'PALURU';
      const revisionMatch = typeof value.candidate_revision === 'string'
        ? /^([a-f0-9]{40}):([a-f0-9]{40})$/.exec(value.candidate_revision) : null;
      const paluruMatch = typeof value.candidate_revision === 'string'
        ? /^paluru-inbox-sha256:([a-f0-9]{64})$/.exec(value.candidate_revision) : null;
      if (candidateReviewCount > 10 || value.kind !== 'generic_candidate_review'
          || (isPaluruCandidate
            ? !paluruCandidates || paluruCandidates.status !== 'ok' || !paluruMatch
              || !/^paluru-inbox:\/\/[0-9a-f-]{36}@sha256:[a-f0-9]{64}$/.test(String(value.candidate_ref || ''))
              || !String(value.candidate_ref).endsWith('@sha256:' + paluruMatch[1])
            : !githubCandidates || githubCandidates.status !== 'ok' || githubCandidates.complete !== true
              || !revisionMatch || value.candidate_commit !== revisionMatch[1]
              || value.candidate_blob_sha !== revisionMatch[2]
              || githubCandidates.source_revision !== value.candidate_commit
              || (value.candidate_origin != null && ['CHATGPT','PALURU'].indexOf(value.candidate_origin) < 0))
          || !value.source_revision_references
          || value.source_revision_references.projects !== sources.projects.source_revision
          || value.source_revision_references.work_items !== sources.tasks.source_revision
          || value.source_revision_references.calendar !== sources.calendar.source_revision) fail();
      const candidateRef = text(value.candidate_ref, 200);
      if ((!isPaluruCandidate && (!candidateRef.startsWith('github://') || !candidateRef.endsWith('@' + value.candidate_commit)))
          || value.entity_ref !== candidateRef) fail();
      const choices = list(value.answer_contract && value.answer_contract.choices, 6, function(choice) {
        return { value: text(choice.value, 20), label: text(choice.label, 40), effect: text(choice.effect, 160) };
      });
      if (choices.length !== candidateChoices.length
          || choices.some(function(choice, index) { return choice.value !== candidateChoices[index] || choice.label !== candidateChoices[index]; })) fail();
      const id = text(value.id, 80);
      const questionRevision = text(value.question_revision, 100);
      const seed = { id: id, candidate_ref: candidateRef, candidate_revision: value.candidate_revision,
        candidate_origin: value.candidate_origin == null ? null : value.candidate_origin,
        title: text(value.title, 200), choices: choices };
      if (id !== 'candidate-review-' + kazOsSha256_(candidateRef + '\u0000' + value.candidate_revision).slice(0, 24)
          || !/^question-sha256:[a-f0-9]{64}$/.test(questionRevision)
          || questionRevision !== 'question-sha256:' + kazOsSha256_(stableKazOsJson_(seed))
          || value.answer_contract.question_revision !== questionRevision) fail();
      return { id: id, kind: value.kind, contract: value.contract, owner: 'kaz',
        decision_requested: true, decision_status: 'pending', write_allowed: false,
        title: seed.title, question: text(value.question, 500), reason: text(value.reason, 500),
        impact: text(value.impact, 500), estimate_min: null, affects_today: false, urgent_today: false,
        decision_date: null, due_at: null, project_id: null, entity_ref: candidateRef,
        candidate_ref: candidateRef, candidate_revision: value.candidate_revision,
        candidate_commit: value.candidate_commit || null, candidate_blob_sha: value.candidate_blob_sha || null,
        candidate_origin: seed.candidate_origin, candidate_source: text(value.candidate_source, 300),
        candidate_content: text(value.candidate_content, 16384),
        source_label: isPaluruCandidate ? 'PALURU INBOX' : 'GitHub Candidate', entity_revision: value.candidate_revision,
        question_revision: questionRevision, expires_at: null,
        source_revision_references: { projects: value.source_revision_references.projects,
          work_items: value.source_revision_references.work_items,
          calendar: value.source_revision_references.calendar },
        answer_contract: { inbox_item_id: id, question_revision: questionRevision,
          question: text(value.answer_contract.question, 500), choices: choices },
        calendar_event: null, input_contract: null, selection_mode: null, selection_options: null,
        recommended_option: null, recommendation_basis: null };
    }
    const isGardener = value.contract === 'context-gardener-decision-0.1';
    if (isGardener) {
      gardenerItemCount++;
      if (gardenerItemCount > 10) fail();
      if (!gardener || gardener.status !== 'ok' || gardener.complete !== true
          || gardenerKinds.indexOf(value.kind) < 0) fail();
      const refs = value.source_revision_references;
      if (!Array.isArray(refs) || refs.length !== 1 || refs[0].source_revision !== gardener.source_revision
          || !Array.isArray(refs[0].paths) || !refs[0].paths.length) fail();
      const choices = list(value.answer_contract && value.answer_contract.choices, 4, function(choice) {
        return { value: text(choice.value, 80), label: text(choice.label, 80), effect: text(choice.effect, 300) };
      });
      if (choices.length < 2) fail();
      return { id: text(value.id, 80), kind: value.kind, contract: value.contract,
        owner: 'kaz', decision_requested: true, decision_status: 'pending', write_allowed: false,
        title: text(value.title, 200), question: text(value.answer_contract.question, 500),
        reason: text(value.reason, 500), impact: text(value.impact, 500), estimate_min: number(value.estimate_min, true),
        affects_today: boolean(value.affects_today), urgent_today: boolean(value.urgent_today),
        decision_date: text(value.decision_date, 20, true), due_at: text(value.due_at, 80, true),
        project_id: text(value.project_id, 80, true), entity_ref: text(value.entity_ref, 160, true),
        source_label: text(value.source_label, 100), entity_revision: text(value.entity_revision, 120, true),
        question_revision: text(value.question_revision, 100), expires_at: null,
        source_revision_references: refs.map(function(ref) { return {
          repository: text(ref.repository, 160), source_revision: text(ref.source_revision, 120),
          paths: list(ref.paths, 20, function(path) { return text(path, 240); }), finding_id: text(ref.finding_id, 120)
        }; }),
        answer_contract: { inbox_item_id: text(value.answer_contract.inbox_item_id, 80),
          question_revision: text(value.answer_contract.question_revision, 100),
          question: text(value.answer_contract.question, 500), choices: choices },
        calendar_event: null, input_contract: null, selection_mode: null, selection_options: null,
        recommended_option: null, recommendation_basis: null };
    }
    secretaryItemCount++;
    if (secretaryItemCount > 20) fail();
    if (kinds.indexOf(value.kind) < 0 || value.contract !== 'secretary-question-0.1') fail();
    const refs = value.source_revision_references;
    if (!refs || refs.projects !== sources.projects.source_revision
        || refs.work_items !== sources.tasks.source_revision || refs.calendar !== sources.calendar.source_revision) fail();
    const choices = list(value.answer_contract && value.answer_contract.choices, 4, function(choice) {
      return { value: text(choice.value, 80), label: text(choice.label, 80), effect: text(choice.effect, 300) };
    });
    if (value.kind === 'calendar_partial_window') {
      if (choices.length !== 1 || choices[0].value !== 'time_range'
          || !value.input_contract || value.input_contract.type !== 'time_range'
          || value.input_contract.timezone !== 'Asia/Tokyo'
          || value.input_contract.start_required !== true || value.input_contract.end_required !== true
          || value.input_contract.within_event !== true) fail();
    } else if (value.kind === 'daily_estimate') {
      const inputType = value.input_contract && value.input_contract.type;
      const planningChoices = choices.map(function(choice) { return choice.value; }).join(',') === 'today,this_week,later';
      if (!(inputType === 'integer_minutes' && choices.length === 0
            || inputType === 'planning_estimate' && choices.length === 3 && planningChoices)
          || value.input_contract.unit !== 'minutes' || value.input_contract.min !== 1
          || !Number.isInteger(value.input_contract.max) || value.input_contract.max < 1
          || value.input_contract.max > 100000) fail();
    } else if (choices.length < 2) fail();
    let calendarEvent = null;
    if (value.kind === 'calendar_event_impact' || value.kind === 'calendar_partial_window') {
      const candidate = value.calendar_event;
      calendarEvent = candidate && calendarEvents.find(function(event) { return event.id === candidate.ref; });
      if (!calendarEvent || candidate.title !== calendarEvent.title || candidate.start !== calendarEvent.start
          || candidate.end !== calendarEvent.end || candidate.all_day !== calendarEvent.all_day
          || value.entity_ref !== calendarEvent.id) fail();
      calendarEvent = { ref: calendarEvent.id, title: calendarEvent.title, start: calendarEvent.start,
        end: calendarEvent.end, all_day: calendarEvent.all_day };
    }
    const decisionDate = text(value.decision_date, 20, true);
    const entityRef = text(value.entity_ref, 80, true);
    const entityRevision = text(value.entity_revision, 80, true);
    let decisionId = text(value.id, 80);
    let questionRevision = text(value.question_revision, 90);
    if (value.kind === 'today_focus') {
      if (!entityRef || !entityRevision || !decisionDate) fail();
      const choiceSeed = choices.map(function(choice) { return choice.value; }).join(',');
      const seed = entityRef + '\\u0000' + entityRevision + '\\u0000' + decisionDate + '\\u0000' + choiceSeed;
      decisionId = 'decision-' + kazOsSha256_('daily-planning-preference\\u0000' + seed).slice(0, 24);
      questionRevision = 'question-sha256:' + kazOsSha256_('daily-planning-preference-question\\u0000' + seed);
    } else if (value.kind === 'daily_estimate') {
      if (!entityRef || !entityRevision || !decisionDate) fail();
      const inputSeed = value.input_contract.type + ':' + value.input_contract.min + ':' + value.input_contract.max
        + (value.input_contract.type === 'planning_estimate' ? ':' + choices.map(function(choice) { return choice.value; }).join(',') : '');
      const seed = entityRef + '\\u0000' + entityRevision + '\\u0000' + decisionDate + '\\u0000' + inputSeed;
      decisionId = 'decision-' + kazOsSha256_('daily-estimate\\u0000' + seed).slice(0, 24);
      questionRevision = 'question-sha256:' + kazOsSha256_('daily-estimate-question\\u0000' + seed);
    }
    return { id: decisionId, kind: value.kind, contract: value.contract,
      owner: 'kaz', decision_requested: true, decision_status: 'pending', write_allowed: false,
      title: text(value.title, 200), question: text(value.question, 500), reason: text(value.reason, 500),
      impact: text(value.impact, 500), estimate_min: number(value.estimate_min, true),
      affects_today: boolean(value.affects_today), urgent_today: boolean(value.urgent_today),
      decision_date: decisionDate, due_at: text(value.due_at, 80, true),
      project_id: text(value.project_id, 80, true), entity_ref: entityRef,
      source_label: text(value.source_label, 100), entity_revision: entityRevision,
      question_revision: questionRevision,
      expires_at: text(value.expires_at, 80, true),
      source_revision_references: { projects: refs.projects, work_items: refs.work_items, calendar: refs.calendar },
      answer_contract: { inbox_item_id: decisionId,
        question_revision: questionRevision,
        question: text(value.answer_contract.question, 500), choices: choices },
       calendar_event: calendarEvent,
       input_contract: value.kind === 'calendar_partial_window' ? { type: 'time_range', timezone: 'Asia/Tokyo',
         start_required: true, end_required: true, within_event: true }
         : value.kind === 'daily_estimate' ? { type: value.input_contract.type, min: value.input_contract.min,
           max: value.input_contract.max, unit: 'minutes' } : null,
      recommended_option: text(value.recommended_option, 80, true),
      recommendation_basis: value.recommendation_basis == null ? null : list(value.recommendation_basis, 8, function(item) { return text(item, 300); }) };
  });
  const activeInboxItems = inboxItems.filter(function(item) {
    if (item.kind === 'daily_estimate') {
      const target = workItems.find(function(workItem) { return workItem.id === item.entity_ref; });
      if (!target || target.source_revision !== item.entity_revision
          || ['BACKLOG','READY','SCHEDULED','DOING'].indexOf(target.state) < 0
          || (Number.isInteger(target.estimate_min) && target.estimate_min > 0)) return false;
    }
    if (item.expires_at == null) return true;
    const expires = Date.parse(item.expires_at);
    if (!Number.isFinite(expires) || expires <= Date.now()) return false;
    return true;
  });
  return { schema_version: data.schema_version, origin: data.origin, mode: data.mode,
    fixture_only: false, fixture_fallback: false, as_of: text(data.as_of, 80), timezone: 'Asia/Tokyo',
    sources: sources, projects: projects, work_items: workItems, calendar_events: calendarEvents,
    inbox_items: activeInboxItems, decision_priority_evidence: {}, feedback: null,
    gardener: gardener && data.gardener ? {
      status: text(data.gardener.status, 20), complete: boolean(data.gardener.complete),
      source_revision: text(data.gardener.source_revision, 120, true),
      decision_count: number(data.gardener.decision_count, true),
      warning: text(data.gardener.warning, 120, true)
    } : null,
    persistence: { kind: 'none', status: 'disabled', answers: 0, proposals: 0, followups: 0 },
    writes: { notion: 0, calendar: 0, context: 0 } };
}

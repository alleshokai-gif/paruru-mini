// Fresh Secretary Questions for the authorized Kaz owner. No answer or writer exists here.
function readKazOsInbox_() {
  const props = PropertiesService.getScriptProperties();
  const url = String(props.getProperty('KAZ_OS_INBOX_READ_URL') || '');
  const token = String(props.getProperty('KAZ_OS_PROGRESS_READ_TOKEN') || '');
  if (!/^https:\/\/[^\s?#]+\/v1\/inbox$/.test(url) || token.length < 32) throw homeMembershipError_('KAZ_NOT_CONNECTED');
  const capture = buildKazOsCalendarCapture_();
  const response = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(capture),
    headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true,
    followRedirects: false, validateHttpsCertificates: true
  });
  if (response.getResponseCode() !== 200) throw homeMembershipError_('KAZ_SOURCE_FAILED');
  const text = response.getContentText();
  if (text.length > 524288) throw homeMembershipError_('KAZ_SOURCE_FAILED');
  return JSON.parse(text);
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
  const kinds = ['stale_state_confirmation','calendar_impact_triage','today_focus','calendar_event_selection'];
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
      end: text(value.end, 80, true), precision: value.precision, classification: 'unconfirmed',
      source_revision: text(value.source_revision, 120) };
  });
  const inboxItems = list(data.inbox_items, 20, function(value) {
    if (!value || kinds.indexOf(value.kind) < 0 || value.contract !== 'secretary-question-0.1'
        || value.owner !== 'kaz' || value.decision_requested !== true || value.decision_status !== 'pending'
        || value.write_allowed !== false) fail();
    const refs = value.source_revision_references;
    if (!refs || refs.projects !== sources.projects.source_revision
        || refs.work_items !== sources.tasks.source_revision || refs.calendar !== sources.calendar.source_revision) fail();
    const choices = list(value.answer_contract && value.answer_contract.choices, 3, function(choice) {
      return { value: text(choice.value, 80), label: text(choice.label, 80), effect: text(choice.effect, 300) };
    });
    if (choices.length < 2) fail();
    return { id: text(value.id, 80), kind: value.kind, contract: value.contract,
      owner: 'kaz', decision_requested: true, decision_status: 'pending', write_allowed: false,
      title: text(value.title, 200), question: text(value.question, 500), reason: text(value.reason, 500),
      impact: text(value.impact, 500), estimate_min: number(value.estimate_min, true),
      affects_today: boolean(value.affects_today), urgent_today: boolean(value.urgent_today),
      decision_date: text(value.decision_date, 20, true), due_at: text(value.due_at, 80, true),
      project_id: text(value.project_id, 80, true), entity_ref: text(value.entity_ref, 80, true),
      source_label: text(value.source_label, 100), entity_revision: text(value.entity_revision, 80, true),
      question_revision: text(value.question_revision, 90),
      source_revision_references: { projects: refs.projects, work_items: refs.work_items, calendar: refs.calendar },
      answer_contract: { inbox_item_id: text(value.answer_contract.inbox_item_id, 80),
        question_revision: text(value.answer_contract.question_revision, 90),
        question: text(value.answer_contract.question, 500), choices: choices },
      selection_mode: text(value.selection_mode, 30, true), selection_options: value.selection_options == null ? null : [],
      recommended_option: text(value.recommended_option, 80, true),
      recommendation_basis: value.recommendation_basis == null ? null : list(value.recommendation_basis, 8, function(item) { return text(item, 300); }) };
  });
  return { schema_version: data.schema_version, origin: data.origin, mode: data.mode,
    fixture_only: false, fixture_fallback: false, as_of: text(data.as_of, 80), timezone: 'Asia/Tokyo',
    sources: sources, projects: projects, work_items: workItems, calendar_events: calendarEvents,
    inbox_items: inboxItems, decision_priority_evidence: {}, feedback: null,
    persistence: { kind: 'none', status: 'disabled', answers: 0, proposals: 0, followups: 0 },
    writes: { notion: 0, calendar: 0, context: 0 } };
}

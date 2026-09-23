// Dynamic Daily Planning v1 client. Reads real Work Items plus transient Family Calendar context.
// No Notion, Calendar or Context writer is introduced here.

function readKazOsToday_(transportTrace) {
  const props = PropertiesService.getScriptProperties();
  const projectsUrl = String(props.getProperty('KAZ_OS_PROJECTS_READ_URL') || '');
  const token = String(props.getProperty('KAZ_OS_PROGRESS_READ_TOKEN') || '');
  if (!/^https:\/\/[^\s?#]+\/v1\/projects$/.test(projectsUrl) || token.length < 32) throw homeMembershipError_('KAZ_NOT_CONNECTED');
  const url = projectsUrl.replace(/\/v1\/projects$/, '/v1/today');
  recordKazOsTransport_(transportTrace, 'CALENDAR_CAPTURE_START', { outcome: 'progress' });
  let capture;
  try {
    capture = buildKazOsCalendarCapture_();
    recordKazOsTransport_(transportTrace, 'CALENDAR_CAPTURE_END', { outcome: 'progress' });
  } catch (error) {
    recordKazOsTransport_(transportTrace, 'CALENDAR_CAPTURE_END', {
      classification: 'business', outcome: 'unresolved', errorCode: 'KAZ_SOURCE_FAILED'
    });
    throw error;
  }
  recordKazOsTransport_(transportTrace, 'DECISION_LEDGER_READ_START', { outcome: 'progress' });
  const classifications = buildKazOsTodayPlanningClassifications_();
  recordKazOsTransport_(transportTrace, 'DECISION_LEDGER_READ_END', { outcome: 'progress' });
  recordKazOsTransport_(transportTrace, 'CLOUD_RUN_START', { outcome: 'progress' });
  let response;
  try {
    response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ calendar_capture: capture, classifications: { items: classifications } }),
      headers: {
        Authorization: 'Bearer ' + token,
        'X-Kaz-Request-Id-Suffix': transportTrace ? transportTrace.requestIdSuffix : ''
      },
      muteHttpExceptions: true,
      followRedirects: false,
      validateHttpsCertificates: true
    });
  } catch (error) {
    recordKazOsTransport_(transportTrace, 'CLOUD_RUN_END', {
      classification: 'unknown', outcome: 'unresolved', errorCode: 'KAZ_SOURCE_FAILED'
    });
    throw error;
  }
  const httpStatus = response.getResponseCode();
  recordKazOsTransport_(transportTrace, 'CLOUD_RUN_END', {
    classification: httpStatus === 200 ? 'none' : 'http',
    outcome: httpStatus === 200 ? 'progress' : 'unresolved',
    httpStatus: httpStatus,
    errorCode: httpStatus === 200 ? null : 'KAZ_SOURCE_FAILED'
  });
  if (httpStatus !== 200) throw homeMembershipError_('KAZ_SOURCE_FAILED');
  const text = response.getContentText();
  if (text.length > 262144) throw homeMembershipError_('KAZ_SOURCE_FAILED');
  return JSON.parse(text);
}

function buildKazOsTodayPlanningClassifications_() {
  if (typeof isKazOsInboxAnswerEnabled_ === 'function' && !isKazOsInboxAnswerEnabled_()) return [];
  if (typeof readKazOsDecisionLedger_ !== 'function') return [];
  let rows;
  try {
    rows = readKazOsDecisionLedger_();
  } catch (_) {
    // Missing/unavailable ledger means "no current human classification evidence".
    // Backend will fail safe and will not treat unanswered Calendar time as free.
    return [];
  }
  if (!Array.isArray(rows)) return [];
  const bounded = rows.slice(Math.max(0, rows.length - 200));
  const byKey = {};
  bounded.forEach(function(row) {
    const answer = row && row.answer;
    const proposal = row && row.proposal;
    const change = proposal && proposal.change;
    const refs = answer && answer.source_revision_references;
    if (!answer || !change || !refs || typeof refs.calendar !== 'string' || !refs.calendar) return;
    if (change.kind !== 'CALENDAR_CLASSIFICATION_PROPOSAL') return;
    const eventRef = String(change.target_event_ref || '');
    const impact = String(change.impact_on_kaz || '');
    if (!eventRef || ['hard_constraint','none'].indexOf(impact) < 0) return;
    const coverage = impact === 'hard_constraint' ? String(change.coverage || '') : null;
    if (impact === 'hard_constraint' && ['full_event','partial_event'].indexOf(coverage) < 0) return;
    let window = null;
    if (coverage === 'partial_event') {
      const input = change.constraint_window;
      if (!input || typeof input.start !== 'string' || typeof input.end !== 'string') return;
      window = { start: input.start, end: input.end };
    }
    const key = refs.calendar + '\u0000' + eventRef;
    byKey[key] = {
      event_ref: eventRef,
      calendar_source_revision: refs.calendar,
      impact_on_kaz: impact,
      coverage: coverage,
      constraint_window: window
    };
  });
  return Object.keys(byKey).sort().map(function(key) { return byKey[key]; });
}

function sanitizeKazOsToday_(data) {
  const fail = function() { throw homeMembershipError_('KAZ_SOURCE_FAILED'); };
  const str = function(v, limit) { if (typeof v !== 'string' || v.length > (limit || 2000)) fail(); return v; };
  const nullable = function(v, limit) { return v == null ? null : str(v, limit); };
  const enumeration = function(v, allowed) { if (allowed.indexOf(v) < 0) fail(); return v; };
  const array = function(v, limit, mapper) { if (!Array.isArray(v) || v.length > limit) fail(); return v.map(mapper); };
  const count = function(v) { if (!Number.isInteger(v) || v < 0 || v > 100000) fail(); return v; };
  const states = ['IDEA','BACKLOG','READY','SCHEDULED','DOING','WAITING','BLOCKED','CODEX_RUNNING','HUMAN_REVIEW','ACCEPTANCE','DONE','CANCELLED'];
  const priorities = ['CRITICAL','HIGH','MEDIUM','LOW'];
  const actionTypes = ['ACTION','HUMAN_REVIEW','ACCEPTANCE','BLOCKER','QUICK_WIN'];
  const sources = ['MANUAL','CHATGPT','CODEX','PALURU','NOTION','CALENDAR'];
  const placements = ['ADOPTED_SCHEDULE','REVIEW_LEVERAGE','POLICY_ORDER','ESTIMATE_REQUIRED','NO_AVAILABLE_SLOT'];

  const dateValue = function(v) {
    if (v == null) return null;
    if (!v || typeof v !== 'object') fail();
    return {start:str(v.start,80),end:v.end == null ? null : str(v.end,80),time_zone:v.time_zone == null ? null : str(v.time_zone,80)};
  };
  const item = function(w) {
    const id=str(w.id,80),projectId=str(w.project_id,80),state=enumeration(w.state,states);
    if (!/^[a-f0-9-]{36}$/i.test(id) || !/^[a-f0-9-]{36}$/i.test(projectId)) fail();
    const priority=w.priority == null ? null : enumeration(w.priority,priorities);
    const estimate=w.estimate_min;
    if (estimate !== null && (!Number.isInteger(estimate) || estimate < 0 || estimate > 100000)) fail();
    const actionType=enumeration(w.action_type,actionTypes),sourceName=enumeration(w.source,sources);
    if (!Number.isFinite(Date.parse(w.source_revision))) fail();
    const planStart=nullable(w.plan_start,80),planEnd=nullable(w.plan_end,80);
    if ((planStart === null) !== (planEnd === null)) fail();
    if (planStart !== null && (!Number.isFinite(Date.parse(planStart)) || !Number.isFinite(Date.parse(planEnd)) || Date.parse(planEnd) <= Date.parse(planStart))) fail();
    const placement=w.placement == null ? null : enumeration(w.placement,placements);
    return {id:id,work_id:str(w.work_id,80),title:str(w.title),state:state,project_id:projectId,project_name:str(w.project_name),
      priority:priority,estimate_min:estimate,deadline:dateValue(w.deadline),scheduled:dateValue(w.scheduled),
      action_type:actionType,next_action:str(w.next_action),blocker:str(w.blocker),source:sourceName,source_revision:str(w.source_revision,80),
      plan_start:planStart,plan_end:planEnd,placement:placement};
  };
  const selection = function(v) {
    if (!v || typeof v !== 'object') fail();
    const result={kind:enumeration(v.kind,['none','single','multiple']),items:array(v.items,100,item),
      basis:array(v.basis,8,function(x){return str(x,80);})};
    if ((result.kind === 'none') !== (result.items.length === 0)) fail();
    if (result.kind === 'single' && result.items.length !== 1) fail();
    if (result.kind === 'multiple' && result.items.length < 2) fail();
    return result;
  };
  const health = function(v, name) {
    if (!v || v.status !== 'ok' || v.complete !== true) fail();
    const fetched=Date.parse(v.fetched_at),until=Date.parse(v.valid_until);
    if (!Number.isFinite(fetched) || !Number.isFinite(until) || fetched > Date.now()+60000 || until <= Date.now()) fail();
    return {status:'ok',complete:true,fetched_at:str(v.fetched_at,80),valid_until:str(v.valid_until,80),
      source_revision:str(v.source_revision,160),scope:str(v.scope,240),
      ...(name === 'work_items' ? {
        projects_source_revision:str(v.projects_source_revision,160),
        fetch_status:enumeration(v.fetch_status,['SUCCESS','EMPTY']),
        snapshot_ref:str(v.snapshot_ref,160),
        record_count:count(v.record_count)
      } : {})};
  };

  if (!data || data.schema_version !== 'kaz-today-plan-v1' || data.origin !== 'real_operational_sources' ||
      data.mode !== 'read_only' || data.fixture_only !== false) fail();
  if (!data.policy || data.policy.version !== 'dynamic-daily-planning-v1' ||
      data.policy.dynamic_daily_planning !== true || data.policy.calendar_used !== true ||
      data.policy.availability_used !== true || data.policy.energy_used !== false ||
      data.policy.ui_scoring_allowed !== false) fail();
  if (!data.writes || data.writes.notion !== 0 || data.writes.calendar !== 0 || data.writes.context !== 0) fail();

  const workSource=health(data.sources && data.sources.work_items,'work_items');
  const calendarSource=health(data.sources && data.sources.calendar,'calendar');
  const now=selection(data.today && data.today.now),next=selection(data.today && data.today.next);
  const waiting=array(data.today && data.today.waiting,100,item);
  const availability=array(data.today && data.today.availability,64,function(v){
    if (!v || typeof v.start !== 'string' || typeof v.end !== 'string') fail();
    const start=Date.parse(v.start),end=Date.parse(v.end);
    if (!Number.isFinite(start)||!Number.isFinite(end)||end<=start) fail();
    return {start:str(v.start,80),end:str(v.end,80)};
  });
  const state=data.today && data.today.calendar_state;
  if (!state || typeof state.classification_revision_current !== 'boolean') fail();
  const unknown=array(state.unknown,200,function(v){
    if (!v || ['UNANSWERED','HUMAN_UNKNOWN','TIME_UNRESOLVED'].indexOf(v.reason)<0) fail();
    return {event_ref:str(v.event_ref,100),reason:v.reason};
  });
  const limitations=array(data.today.limitations,20,function(x){return str(x,100);});
  if (typeof data.today.needs_choice !== 'boolean') fail();

  return {schema_version:'kaz-today-plan-v1',origin:'real_operational_sources',mode:'read_only',fixture_only:false,
    policy:{version:'dynamic-daily-planning-v1',dynamic_daily_planning:true,calendar_used:true,availability_used:true,energy_used:false,ui_scoring_allowed:false},
    sources:{work_items:workSource,calendar:calendarSource},
    today:{now:now,next:next,waiting:waiting,waiting_count:count(data.today.waiting_count),
      availability:availability,calendar_state:{classification_revision_current:state.classification_revision_current,
        unknown_count:count(state.unknown_count),known_none_count:count(state.known_none_count),unknown:unknown},
      unplaced_explicit_estimate_count:count(data.today.unplaced_explicit_estimate_count),
      missing_estimate_count:count(data.today.missing_estimate_count),
      active_count:count(data.today.active_count),done_count:count(data.today.done_count),
      cancelled_count:count(data.today.cancelled_count),needs_choice:data.today.needs_choice,limitations:limitations},
    writes:{notion:0,calendar:0,context:0}};
}

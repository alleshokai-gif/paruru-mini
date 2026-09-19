// Summary-only Kaz OS read endpoint. This file contains no operational writer.
function verifyHomeControlDevicePairingReadOnly_(deviceId, pairingToken) {
  const deps = getHomeControlPairingDependencies_();
  const registry = JSON.parse(JSON.stringify(loadHomeControlRegistry_(deps)));
  // Same status/hash/constant-time checks, but lastUsedAt changes only this copy.
  verifyHomeControlRegistryDevice_(deviceId, pairingToken, registry, deps, deps.now());
  return { handled: true, authorized: true };
}

function kazOsProgress_(body, inboxTrace) {
  try {
    const input = body || {};
    if (['kazOs.progress.get', 'kazOs.projects.get', 'kazOs.inbox.get'].indexOf(input.action) < 0) throw homeMembershipError_('KAZ_READ_ONLY');
    if (!isKazOsLiveEnabled_()) throw homeMembershipError_('KAZ_NOT_CONNECTED');
    const actor = resolveFirebaseAuthenticatedActor_(input);
    authorizeKazOsOwner_(actor);
    if (input.action === 'kazOs.inbox.get') recordKazOsInboxTrace_(inboxTrace, 'AUTH_PASSED');
    if (input.action === 'kazOs.projects.get') return json_({ success: true, data: sanitizeKazOsProjects_(readKazOsProjects_()), message: 'read only' });
    if (input.action === 'kazOs.inbox.get') {
      recordKazOsInboxTrace_(inboxTrace, 'INBOX_READ_STARTED');
      const sanitized = sanitizeKazOsInbox_(readKazOsInbox_(inboxTrace));
      const projected = typeof applyKazOsDecisionLedger_ === 'function' ? applyKazOsDecisionLedger_(sanitized) : sanitized;
      const questionCount = Array.isArray(projected.inbox_items) ? projected.inbox_items.length : null;
      recordKazOsInboxTrace_(inboxTrace, 'SANITIZER_OK', { question_count: questionCount });
      recordKazOsInboxTrace_(inboxTrace, 'RESPONSE_SENT', { question_count: questionCount });
      return json_({ success: true, data: projected, message: projected.mode === 'controlled_proposal' ? 'controlled proposal' : 'read only' });
    }
    return json_({ success: true, data: sanitizeKazOsProgress_(readKazOsProgress_()), message: 'read only' });
  } catch (error) {
    const allowed = ['FORBIDDEN', 'UNAUTHORIZED_DEVICE', 'MEMBERSHIP_NOT_FOUND', 'KAZ_NOT_CONNECTED', 'KAZ_READ_ONLY', 'KAZ_REQUEST_ID_INVALID'];
    const code = allowed.indexOf(error && error.code) >= 0 ? error.code : 'KAZ_SOURCE_FAILED';
    if (inboxTrace) recordKazOsInboxTrace_(inboxTrace, 'RESPONSE_SENT', { error_code: code });
    return json_({ success: false, data: null, error: { code: code }, message: code });
  }
}

function authorizeKazOsOwner_(actor) {
  if (!actor || actor.role !== 'admin') throw homeMembershipError_('FORBIDDEN');
  const props = PropertiesService.getScriptProperties();
  const ownerHome = String(props.getProperty('KAZ_OS_PROGRESS_OWNER_HOME_ID') || '');
  const ownerMember = String(props.getProperty('KAZ_OS_PROGRESS_OWNER_MEMBER_ID') || '');
  if (!ownerHome || !ownerMember) throw homeMembershipError_('KAZ_NOT_CONNECTED');
  if (actor.homeId !== ownerHome || actor.memberUserId !== ownerMember) throw homeMembershipError_('FORBIDDEN');
  return actor;
}

function readKazOsProgress_() {
  const props = PropertiesService.getScriptProperties();
  const url = String(props.getProperty('KAZ_OS_PROGRESS_READ_URL') || '');
  const token = String(props.getProperty('KAZ_OS_PROGRESS_READ_TOKEN') || '');
  if (!/^https:\/\/[^\s?#]+\/v1\/progress$/.test(url) || token.length < 32) throw homeMembershipError_('KAZ_NOT_CONNECTED');
  const response = UrlFetchApp.fetch(url, { method: 'get', headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true, followRedirects: false, validateHttpsCertificates: true });
  if (response.getResponseCode() !== 200) throw homeMembershipError_('KAZ_SOURCE_FAILED');
  const text = response.getContentText();
  if (text.length > 65536) throw homeMembershipError_('KAZ_SOURCE_FAILED');
  return JSON.parse(text);
}

function sanitizeKazOsProgress_(data) {
  const fail = function() { throw homeMembershipError_('KAZ_SOURCE_FAILED'); };
  const str = function(value, limit) { if (typeof value !== 'string' || value.length > (limit || 200)) fail(); return value; };
  const nullable = function(value) { return value == null ? null : str(value); };
  const enumeration = function(value, allowed) { if (allowed.indexOf(value) < 0) fail(); return value; };
  const number = function(value) { if (!Number.isInteger(value) || value < 0 || value > 100000) fail(); return value; };
  const array = function(value, limit, mapper) { if (!Array.isArray(value) || value.length > limit) fail(); return value.map(mapper); };
  const health = function(value) {
    if (!value || typeof value.complete !== 'boolean') fail();
    return { status: enumeration(value.status, ['ok','stale','partial','failed','not_connected']), complete: value.complete,
      fetched_at: nullable(value.fetched_at), source_revision: nullable(value.source_revision), scope: str(value.scope) };
  };
  const run = function(value) {
    return { run_id: str(value.run_id, 80), project: str(value.project, 100), work_item: str(value.work_item, 120),
      execution_status: enumeration(value.execution_status, ['completed','failed','running','launch_failed','unknown']),
      capture_status: enumeration(value.capture_status, ['complete','partial','failed']),
      started_at: nullable(value.started_at), finished_at: nullable(value.finished_at),
      tests: value.tests == null ? null : { passed: number(value.tests.passed), total: number(value.tests.total) },
      human_review: enumeration(value.human_review, ['ACCEPTED','REWORK_REQUIRED','REJECTED','pending']),
      acceptance: enumeration(value.acceptance, ['ACCEPTED','pending']) };
  };
  const item = function(value) {
    return { work_item_id: str(value.work_item_id, 80), title: str(value.title, 120),
      state: enumeration(value.state, ['IDEA','BACKLOG','READY','SCHEDULED','DOING','WAITING','BLOCKED','CODEX_RUNNING','HUMAN_REVIEW','ACCEPTANCE','DONE','CANCELLED']),
      revision: number(value.revision), updated_at: str(value.updated_at), evidence_count: number(value.evidence_count),
      history: array(value.history, 12, function(h) { return { state: str(h.state, 40), at: str(h.at) }; }),
      run: value.run == null ? null : run(value.run) };
  };
  if (!data || data.schema_version !== 'kaz-progress-0.1' || data.mode !== 'read_only') fail();
  const source = health(data.source);
  if (source.status === 'ok' && (!source.complete || !source.fetched_at || !source.source_revision)) fail();
  const output = { schema_version: data.schema_version, generated_at: str(data.generated_at), mode: 'read_only',
    origin: enumeration(data.origin, ['observed_managed_run']), scope_label: str(data.scope_label), source: source,
    system_status: array(data.system_status, 9, function(s) { return { id: str(s.id, 30), label: str(s.label, 60),
      state: enumeration(s.state, ['LIVE','GO','PoC','BUILDING','READ-ONLY','NOT CONNECTED','BLOCKED']), basis: str(s.basis) }; }),
    recent_wins: data.recent_wins == null ? null : array(data.recent_wins, 5, item),
    recent_runs: data.recent_runs == null ? null : array(data.recent_runs, 5, run),
    waiting_for_review: data.waiting_for_review == null ? null : array(data.waiting_for_review, 5, item),
    next: { status: enumeration(data.next.status, ['NEXT UNDEFINED']), milestones: [] },
    source_health: array(data.source_health, 8, function(s) { return Object.assign({ name: str(s.name, 60) }, health(s)); }),
    overview: data.overview == null ? null : { stage: str(data.overview.stage, 80), scope: str(data.overview.scope, 100), source_ref: str(data.overview.source_ref) },
    achievements: data.achievements == null ? null : array(data.achievements, 8, function(a) {
      return { id: str(a.id, 120), label: str(a.label, 120), occurred_at: str(a.occurred_at), evidence_ref: str(a.evidence_ref),
        target_kind: enumeration(a.target_kind, ['work_item','source']), target_id: str(a.target_id, 80) };
    }),
    roadmap: data.roadmap == null ? null : { status: enumeration(data.roadmap.status, ['draft']), source: enumeration(data.roadmap.source, ['user']),
      source_ref: str(data.roadmap.source_ref), lanes: array(data.roadmap.lanes, 3, function(lane) {
        return { phase: enumeration(lane.phase, ['NOW','NEXT','LATER']), items: array(lane.items, 4, function(label) { return str(label, 120); }) };
      }) } };
  if (output.roadmap && output.roadmap.lanes.map(function(lane) { return lane.phase; }).join(',') !== 'NOW,NEXT,LATER') fail();
  // A source that is incomplete or expired must never advertise a current GO.
  const age = Date.now() - Date.parse(output.source.fetched_at);
  if (!Number.isFinite(age) || age < -60000) fail();
  if (age > 900000 && output.source.status === 'ok') output.source.status = 'stale';
  if (output.source.status !== 'ok' || !output.source.complete) {
    output.system_status.forEach(function(s) { if (s.state === 'GO' || s.state === 'LIVE') { s.state = 'PoC'; s.basis = 'source未確定・現在の完了判定は保留'; } });
    output.waiting_for_review = null;
    output.achievements = null;
  }
  if (output.source.status === 'failed') { output.recent_wins = null; output.recent_runs = null; }
  if (output.source.status === 'ok' && (output.recent_wins === null || output.recent_runs === null || output.waiting_for_review === null)) fail();
  return output; // Only allowlisted scalars; raw payload and unknown fields never cross this boundary.
}

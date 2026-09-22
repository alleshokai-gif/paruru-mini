// Read-only Kaz OS Work Items projection. Reuses the approved private gateway/token.
function readKazOsWork_(transportTrace) {
  const props = PropertiesService.getScriptProperties();
  const projectsUrl = String(props.getProperty('KAZ_OS_PROJECTS_READ_URL') || '');
  const token = String(props.getProperty('KAZ_OS_PROGRESS_READ_TOKEN') || '');
  if (!/^https:\/\/[^\s?#]+\/v1\/projects$/.test(projectsUrl) || token.length < 32) throw homeMembershipError_('KAZ_NOT_CONNECTED');
  const url = projectsUrl.replace(/\/v1\/projects$/, '/v1/work');
  const response = UrlFetchApp.fetch(url, { method: 'get', headers: {
    Authorization: 'Bearer ' + token,
    'X-Kaz-Request-Id-Suffix': transportTrace ? transportTrace.requestIdSuffix : ''
  },
    muteHttpExceptions: true, followRedirects: false, validateHttpsCertificates: true });
  if (response.getResponseCode() !== 200) throw homeMembershipError_('KAZ_SOURCE_FAILED');
  const text = response.getContentText();
  if (text.length > 262144) throw homeMembershipError_('KAZ_SOURCE_FAILED');
  return JSON.parse(text);
}

function sanitizeKazOsWork_(data) {
  const fail = function() { throw homeMembershipError_('KAZ_SOURCE_FAILED'); };
  const str = function(v, limit) { if (typeof v !== 'string' || v.length > (limit || 2000)) fail(); return v; };
  const nullable = function(v, limit) { return v == null ? null : str(v, limit); };
  const states = ['IDEA','BACKLOG','READY','SCHEDULED','DOING','WAITING','BLOCKED','CODEX_RUNNING','HUMAN_REVIEW','ACCEPTANCE','DONE','CANCELLED'];
  const priorities = ['CRITICAL','HIGH','MEDIUM','LOW'];
  const actionTypes = ['ACTION','HUMAN_REVIEW','ACCEPTANCE','BLOCKER','QUICK_WIN'];
  const sources = ['MANUAL','CHATGPT','CODEX','PALURU','NOTION','CALENDAR'];
  if (!data || data.origin !== 'notion_official_api' || data.mode !== 'read_only' || data.fixture_only !== false) fail();
  if (!data.writes || data.writes.notion !== 0 || data.writes.calendar !== 0 || data.writes.context !== 0) fail();
  const s = data.sources && data.sources.work_items;
  const statuses = {ok:['SUCCESS','EMPTY'],partial:['PARTIAL'],stale:['STALE'],failed:['FAILED'],not_connected:['NOT_CONNECTED']};
  if (!s || !statuses[s.status] || statuses[s.status].indexOf(s.fetch_status) < 0 || typeof s.complete !== 'boolean') fail();
  const source = {status:s.status,complete:s.complete,fetched_at:nullable(s.fetched_at),valid_until:nullable(s.valid_until),
    source_revision:nullable(s.source_revision),projects_source_revision:nullable(s.projects_source_revision),scope:str(s.scope,200),
    fetch_status:s.fetch_status,snapshot_ref:nullable(s.snapshot_ref),record_count:null};
  const output = {origin:'notion_official_api',mode:'read_only',fixture_only:false,sources:{work_items:source},work_items:null,
    writes:{notion:0,calendar:0,context:0}};
  if (s.status !== 'ok') return output;
  const fetched = Date.parse(s.fetched_at), until = Date.parse(s.valid_until);
  if (!s.complete || !s.source_revision || !s.projects_source_revision || !s.snapshot_ref || !Number.isFinite(fetched) ||
      !Number.isFinite(until) || until <= fetched || fetched > Date.now() + 60000) fail();
  if (until <= Date.now()) { source.status='stale';source.fetch_status='STALE';return output; }
  if (!Array.isArray(data.work_items) || data.work_items.length > 100 || s.record_count !== data.work_items.length ||
      (s.fetch_status === 'EMPTY') !== (data.work_items.length === 0)) fail();

  const seen = {}, seenWork = {};
  const dateValue = function(v) {
    if (v == null) return null;
    if (!v || typeof v !== 'object') fail();
    const start = str(v.start, 80);
    const end = v.end == null ? null : str(v.end, 80);
    const zone = v.time_zone == null ? null : str(v.time_zone, 80);
    return {start:start,end:end,time_zone:zone};
  };
  output.work_items = data.work_items.map(function(w) {
    const id = str(w.id,80), workId = str(w.work_id,80), state = str(w.state,40);
    if (!/^[a-f0-9-]{36}$/i.test(id) || seen[id] || seenWork[workId] || states.indexOf(state) < 0) fail();
    seen[id]=true;seenWork[workId]=true;
    const projectId = str(w.project_id,80);
    if (!/^[a-f0-9-]{36}$/i.test(projectId)) fail();
    const priority = w.priority == null ? null : str(w.priority,40);
    if (priority !== null && priorities.indexOf(priority) < 0) fail();
    const estimate = w.estimate_min;
    if (estimate !== null && (!Number.isInteger(estimate) || estimate < 0 || estimate > 100000)) fail();
    const actionType = str(w.action_type,40), sourceName = str(w.source,40);
    if (actionTypes.indexOf(actionType) < 0 || sources.indexOf(sourceName) < 0 || !Number.isFinite(Date.parse(w.source_revision))) fail();
    return {id:id,work_id:workId,title:str(w.title),state:state,project_id:projectId,project_name:str(w.project_name),
      priority:priority,estimate_min:estimate,deadline:dateValue(w.deadline),scheduled:dateValue(w.scheduled),
      action_type:actionType,next_action:str(w.next_action),blocker:str(w.blocker),source:sourceName,
      source_revision:str(w.source_revision,80)};
  });
  source.record_count=output.work_items.length;
  return output;
}

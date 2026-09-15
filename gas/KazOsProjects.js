// Invoked only after the existing Kaz OS pairing/admin/owner authorization gate.
function readKazOsProjects_() {
  const props = PropertiesService.getScriptProperties();
  const url = String(props.getProperty('KAZ_OS_PROJECTS_READ_URL') || '');
  const token = String(props.getProperty('KAZ_OS_PROGRESS_READ_TOKEN') || '');
  if (!/^https:\/\/[^\s?#]+\/v1\/projects$/.test(url) || token.length < 32) throw homeMembershipError_('KAZ_NOT_CONNECTED');
  const response = UrlFetchApp.fetch(url, { method: 'get', headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true, followRedirects: false, validateHttpsCertificates: true });
  if (response.getResponseCode() !== 200) throw homeMembershipError_('KAZ_SOURCE_FAILED');
  const text = response.getContentText();
  if (text.length > 262144) throw homeMembershipError_('KAZ_SOURCE_FAILED');
  return JSON.parse(text);
}

function sanitizeKazOsProjects_(data) {
  const fail = function() { throw homeMembershipError_('KAZ_SOURCE_FAILED'); };
  const str = function(v, limit) { if (typeof v !== 'string' || v.length > (limit || 2000)) fail(); return v; };
  const nullable = function(v) { return v == null ? null : str(v); };
  const states = ['ACTIVE','REVIEW','BLOCKED','BACKLOG','DONE'];
  if (!data || data.origin !== 'notion_official_api' || data.mode !== 'read_only' || data.fixture_only !== false) fail();
  const s = data.sources && data.sources.projects;
  const statuses = {ok:['SUCCESS','EMPTY'],partial:['PARTIAL'],stale:['STALE'],failed:['FAILED'],not_connected:['NOT_CONNECTED']};
  if (!s || !statuses[s.status] || statuses[s.status].indexOf(s.fetch_status) < 0 || typeof s.complete !== 'boolean') fail();
  const source = {status:s.status,complete:s.complete,fetched_at:nullable(s.fetched_at),valid_until:nullable(s.valid_until),
    source_revision:nullable(s.source_revision),scope:str(s.scope,200),fetch_status:s.fetch_status,
    snapshot_ref:nullable(s.snapshot_ref),record_count:null};
  const output = {origin:'notion_official_api',mode:'read_only',fixture_only:false,sources:{projects:source},projects:null};
  if (s.status !== 'ok') return output;
  const fetched = Date.parse(s.fetched_at), until = Date.parse(s.valid_until);
  if (!s.complete || !s.source_revision || !s.snapshot_ref || !Number.isFinite(fetched) || !Number.isFinite(until) || until <= fetched || fetched > Date.now() + 60000) fail();
  if (until <= Date.now()) { source.status='stale';source.fetch_status='STALE';return output; }
  if (!Array.isArray(data.projects) || data.projects.length > 100 || s.record_count !== data.projects.length || (s.fetch_status === 'EMPTY') !== (data.projects.length === 0)) fail();
  const seen = {};
  output.projects = data.projects.map(function(p) {
    const id = str(p.id,80);
    if (!/^[a-f0-9-]{36}$/i.test(id) || seen[id] || states.indexOf(p.status) < 0) fail();
    seen[id] = true;
    const done=p.milestones_done,total=p.milestones_total;
    if (!(done === null && total === null) && !(Number.isInteger(done) && Number.isInteger(total) && 0 <= done && done <= total && total > 0 && total <= 100000)) fail();
    if (!Number.isFinite(Date.parse(p.source_revision))) fail();
    return {id:id,title:str(p.title),status:p.status,current_focus:str(p.current_focus),next_action:str(p.next_action),blocker:str(p.blocker),
      milestones_done:done,milestones_total:total,source_revision:str(p.source_revision,80)};
  });
  output.projects.sort(function(a,b) { return states.indexOf(a.status)-states.indexOf(b.status); });
  source.record_count=output.projects.length;
  return output; // No raw properties, instruction, token, relation or Work Item payload.
}

// Read-only Kaz OS CAPA projection. Reuses the approved private gateway/token.
function readKazOsCapa_(transportTrace) {
  const props = PropertiesService.getScriptProperties();
  const projectsUrl = String(props.getProperty('KAZ_OS_PROJECTS_READ_URL') || '');
  const token = String(props.getProperty('KAZ_OS_PROGRESS_READ_TOKEN') || '');
  if (!/^https:\/\/[^\s?#]+\/v1\/projects$/.test(projectsUrl) || token.length < 32) throw homeMembershipError_('KAZ_NOT_CONNECTED');
  const url = projectsUrl.replace(/\/v1\/projects$/, '/v1/capa');
  recordKazOsTransport_(transportTrace, 'CLOUD_RUN_START', { outcome: 'progress' });
  let response;
  try {
    response = UrlFetchApp.fetch(url, { method: 'get', headers: {
      Authorization: 'Bearer ' + token,
      'X-Kaz-Request-Id-Suffix': transportTrace ? transportTrace.requestIdSuffix : ''
    },
      muteHttpExceptions: true, followRedirects: false, validateHttpsCertificates: true });
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

function sanitizeKazOsCapa_(data) {
  const fail = function() { throw homeMembershipError_('KAZ_SOURCE_FAILED'); };
  const str = function(v, limit) { if (typeof v !== 'string' || v.length > (limit || 2000)) fail(); return v; };
  const nullable = function(v, limit) { return v == null ? null : str(v, limit); };
  const statuses = ['Captured','Corrective Action','Preventive Action','Monitoring','Effective','Reopen'];
  const projects = ['PALURU','Kaz OS','Cross-project'];
  const effects = ['Not evaluated','Pending','Pass','Fail'];
  if (!data || data.origin !== 'notion_official_api' || data.mode !== 'read_only' || data.fixture_only !== false) fail();
  if (!data.writes || data.writes.notion !== 0 || data.writes.calendar !== 0 || data.writes.context !== 0) fail();
  const s = data.sources && data.sources.capa;
  const sourceStatuses = {ok:['SUCCESS','EMPTY'],partial:['PARTIAL'],stale:['STALE'],failed:['FAILED'],not_connected:['NOT_CONNECTED']};
  if (!s || !sourceStatuses[s.status] || sourceStatuses[s.status].indexOf(s.fetch_status) < 0 || typeof s.complete !== 'boolean') fail();
  const source = {status:s.status,complete:s.complete,fetched_at:nullable(s.fetched_at),valid_until:nullable(s.valid_until),
    source_revision:nullable(s.source_revision),scope:str(s.scope,200),fetch_status:s.fetch_status,
    snapshot_ref:nullable(s.snapshot_ref),record_count:null};
  const output = {origin:'notion_official_api',mode:'read_only',fixture_only:false,sources:{capa:source},capa_items:null,
    writes:{notion:0,calendar:0,context:0}};
  if (s.status !== 'ok') return output;
  const fetched = Date.parse(s.fetched_at), until = Date.parse(s.valid_until);
  if (!s.complete || !s.source_revision || !s.snapshot_ref || !Number.isFinite(fetched) ||
      !Number.isFinite(until) || until <= fetched || fetched > Date.now() + 60000) fail();
  if (until <= Date.now()) { source.status='stale';source.fetch_status='STALE';return output; }
  if (!Array.isArray(data.capa_items) || data.capa_items.length > 100 || s.record_count !== data.capa_items.length ||
      (s.fetch_status === 'EMPTY') !== (data.capa_items.length === 0)) fail();
  const seen = {};
  output.capa_items = data.capa_items.map(function(item) {
    const id = str(item.id,80);
    if (!/^[a-f0-9-]{36}$/i.test(id) || seen[id]) fail();
    seen[id] = true;
    const status = str(item.status,40), project = str(item.project,40), effectiveness = str(item.effectiveness,40);
    if (statuses.indexOf(status) < 0 || projects.indexOf(project) < 0 || effects.indexOf(effectiveness) < 0) fail();
    if (!Array.isArray(item.failure_classes) || item.failure_classes.length > 12 || item.failure_classes.some(function(v){return typeof v !== 'string' || !v || v.length > 80;})) fail();
    const created = str(item.created,40);
    if (!Number.isFinite(Date.parse(created + (created.length === 10 ? 'T00:00:00Z' : '')))) fail();
    return {id:id,title:str(item.title,200),status:status,project:project,
      failure_classes:item.failure_classes.slice(),created:created,trigger:str(item.trigger,2000),
      corrective_action:str(item.corrective_action,4000),preventive_action:str(item.preventive_action,4000),
      effectiveness:effectiveness,context_path:str(item.context_path,400),
      source_url:nullable(item.source_url,500),last_reviewed:nullable(item.last_reviewed,80)};
  });
  output.capa_items.sort(function(a,b) {
    const rank = {Reopen:0,'Corrective Action':1,'Preventive Action':2,Monitoring:3,Captured:4,Effective:5};
    return rank[a.status]-rank[b.status] || String(b.created).localeCompare(String(a.created)) || a.title.localeCompare(b.title);
  });
  source.record_count=output.capa_items.length;
  return output;
}

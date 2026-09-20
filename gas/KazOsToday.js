// Read-only Kaz OS TODAY v1 client. Uses the same private gateway and bearer as WORK.
function readKazOsToday_() {
  const props = PropertiesService.getScriptProperties();
  const projectsUrl = String(props.getProperty('KAZ_OS_PROJECTS_READ_URL') || '');
  const token = String(props.getProperty('KAZ_OS_PROGRESS_READ_TOKEN') || '');
  if (!/^https:\/\/[^\s?#]+\/v1\/projects$/.test(projectsUrl) || token.length < 32) throw homeMembershipError_('KAZ_NOT_CONNECTED');
  const url = projectsUrl.replace(/\/v1\/projects$/, '/v1/today');
  const response = UrlFetchApp.fetch(url, { method: 'get', headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true, followRedirects: false, validateHttpsCertificates: true });
  if (response.getResponseCode() !== 200) throw homeMembershipError_('KAZ_SOURCE_FAILED');
  const text = response.getContentText();
  if (text.length > 262144) throw homeMembershipError_('KAZ_SOURCE_FAILED');
  return JSON.parse(text);
}

function sanitizeKazOsToday_(data) {
  const fail = function() { throw homeMembershipError_('KAZ_SOURCE_FAILED'); };
  const str = function(v, limit) { if (typeof v !== 'string' || v.length > (limit || 2000)) fail(); return v; };
  const nullable = function(v, limit) { return v == null ? null : str(v, limit); };
  const enumeration = function(v, allowed) { if (allowed.indexOf(v) < 0) fail(); return v; };
  const array = function(v, limit, mapper) { if (!Array.isArray(v) || v.length > limit) fail(); return v.map(mapper); };
  const states = ['IDEA','BACKLOG','READY','SCHEDULED','DOING','WAITING','BLOCKED','CODEX_RUNNING','HUMAN_REVIEW','ACCEPTANCE','DONE','CANCELLED'];
  const priorities = ['CRITICAL','HIGH','MEDIUM','LOW'];
  const actionTypes = ['ACTION','HUMAN_REVIEW','ACCEPTANCE','BLOCKER','QUICK_WIN'];
  const sources = ['MANUAL','CHATGPT','CODEX','PALURU','NOTION','CALENDAR'];

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
    return {id:id,work_id:str(w.work_id,80),title:str(w.title),state:state,project_id:projectId,project_name:str(w.project_name),
      priority:priority,estimate_min:estimate,deadline:dateValue(w.deadline),scheduled:dateValue(w.scheduled),
      action_type:actionType,next_action:str(w.next_action),blocker:str(w.blocker),source:sourceName,source_revision:str(w.source_revision,80)};
  };
  const selection = function(v) {
    if (!v || typeof v !== 'object') fail();
    return {kind:enumeration(v.kind,['none','single','multiple']),items:array(v.items,100,item),
      basis:array(v.basis,8,function(x){return str(x,80);})};
  };

  if (!data || data.schema_version !== 'kaz-today-work-v1' || data.origin !== 'notion_official_api' ||
      data.mode !== 'read_only' || data.fixture_only !== false) fail();
  if (!data.policy || data.policy.version !== 'today-work-v1' || data.policy.dynamic_daily_planning !== false ||
      data.policy.calendar_used !== false || data.policy.energy_used !== false || data.policy.availability_used !== false ||
      data.policy.ui_scoring_allowed !== false) fail();
  if (!data.writes || data.writes.notion !== 0 || data.writes.calendar !== 0 || data.writes.context !== 0) fail();

  const s=data.sources && data.sources.work_items;
  if (!s || s.status !== 'ok' || s.complete !== true || s.fetch_status !== 'SUCCESS' && s.fetch_status !== 'EMPTY') fail();
  const fetched=Date.parse(s.fetched_at),until=Date.parse(s.valid_until);
  if (!s.source_revision || !s.projects_source_revision || !s.snapshot_ref || !Number.isFinite(fetched) || !Number.isFinite(until) ||
      until <= fetched || fetched > Date.now() + 60000 || until <= Date.now()) fail();

  const now=selection(data.today && data.today.now),next=selection(data.today && data.today.next);
  const waiting=array(data.today && data.today.waiting,100,item);
  const count=function(v){if(!Number.isInteger(v)||v<0||v>100000)fail();return v;};
  const limitations=array(data.today.limitations,20,function(x){return str(x,100);});
  if (typeof data.today.needs_choice !== 'boolean') fail();
  if ((now.kind === 'none') !== (now.items.length === 0) || (next.kind === 'none') !== (next.items.length === 0)) fail();
  if (now.kind === 'single' && now.items.length !== 1 || next.kind === 'single' && next.items.length !== 1) fail();
  if (now.kind === 'multiple' && now.items.length < 2 || next.kind === 'multiple' && next.items.length < 2) fail();

  return {schema_version:'kaz-today-work-v1',origin:'notion_official_api',mode:'read_only',fixture_only:false,
    policy:{version:'today-work-v1',dynamic_daily_planning:false,calendar_used:false,energy_used:false,availability_used:false,ui_scoring_allowed:false},
    sources:{work_items:{status:'ok',complete:true,fetched_at:str(s.fetched_at,80),valid_until:str(s.valid_until,80),
      source_revision:str(s.source_revision),projects_source_revision:str(s.projects_source_revision),scope:str(s.scope,200),
      fetch_status:s.fetch_status,snapshot_ref:str(s.snapshot_ref),record_count:count(s.record_count)}},
    today:{now:now,next:next,waiting:waiting,waiting_count:count(data.today.waiting_count),active_count:count(data.today.active_count),
      done_count:count(data.today.done_count),cancelled_count:count(data.today.cancelled_count),
      needs_choice:data.today.needs_choice,limitations:limitations},
    writes:{notion:0,calendar:0,context:0}};
}

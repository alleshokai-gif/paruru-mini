const PALURU_CALENDAR_API_TOKEN_PROPERTY = 'PALURU_CALENDAR_API_TOKEN';
const PALURU_CALENDAR_SERVICE_HOME_SECRET = 'KAZ_OS_PROGRESS_OWNER_HOME_ID';
const PALURU_CALENDAR_INTERNAL_SCHEMA_VERSION = 'calendar-context-internal-1.0';
const PALURU_KUROBE_CALENDAR_SNAPSHOT_SCHEMA = 'kurobe-family-calendar-snapshot-v1';

function calendarContextInternal_(body, method, dependencies) {
  try {
    if (method !== 'POST') throw internalCalendarError_('METHOD_NOT_ALLOWED');
    if (!body || body.action !== 'calendarContextInternal') throw internalCalendarError_('INVALID_INPUT');
    authenticateInternalCalendar_(body.internalToken);
    const input = validateInternalCalendarInput_(body);
    const service = dependencies && dependencies.calendarReadService || CalendarReadService;
    if (input.snapshot) return json_(buildKurobeCalendarSnapshot_(service, input.now));
    const result = service.readContext(input);
    return json_({
      success: true,
      schemaVersion: PALURU_CALENDAR_INTERNAL_SCHEMA_VERSION,
      data: result.data,
      warnings: sanitizeInternalCalendarWarnings_(result.warnings)
    });
  } catch (error) {
    const code = normalizeInternalCalendarError_(error && error.code);
    return json_({
      success: false,
      schemaVersion: PALURU_CALENDAR_INTERNAL_SCHEMA_VERSION,
      error: { code: code, message: internalCalendarErrorMessage_(code) }
    });
  }
}

// Single source of truth: GCP Secret Manager. Do not inspect old GAS token properties.
function loadInternalCalendarSecret_(secretName) {
  const name = secretName || PALURU_CALENDAR_API_TOKEN_PROPERTY;
  if ([PALURU_CALENDAR_API_TOKEN_PROPERTY, PALURU_CALENDAR_SERVICE_HOME_SECRET].indexOf(name) < 0) {
    throw internalCalendarError_('UNAUTHORIZED');
  }
  const url = 'https://secretmanager.googleapis.com/v1/projects/paluru-bus/secrets/'
    + name + '/versions/latest:access';
  let response;
  try {
    response = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
  } catch (_) {
    throw internalCalendarError_('UNAUTHORIZED');
  }
  if (response.getResponseCode() !== 200) throw internalCalendarError_('UNAUTHORIZED');
  let encoded;
  try {
    const body = JSON.parse(response.getContentText());
    encoded = body && body.payload && body.payload.data;
    if (typeof encoded !== 'string' || !encoded) throw new Error('invalid payload');
    const rawValue = Utilities.newBlob(Utilities.base64Decode(encoded)).getDataAsString();
    const value = name === PALURU_CALENDAR_SERVICE_HOME_SECRET ? rawValue.trim() : rawValue;
    if (name === PALURU_CALENDAR_API_TOKEN_PROPERTY ? value.length < 32
        : !/^[a-zA-Z0-9_-]{1,200}$/.test(value)) throw new Error('invalid secret');
    return value;
  } catch (_) {
    throw internalCalendarError_('UNAUTHORIZED');
  }
}

function authenticateInternalCalendar_(providedToken) {
  const expected = loadInternalCalendarSecret_();
  const actual = typeof providedToken === 'string' ? providedToken : '';
  if (!expected || !actual || !constantTimeEqualsCalendar_(expected, actual)) {
    throw internalCalendarError_('UNAUTHORIZED');
  }
}

function validateInternalCalendarInput_(body) {
  // Existing token authentication already ran. See the scoped design review and
  // the six-roster + signed-ingress regressions; app enrollment is not LINE identity.
  if (body.service !== undefined || body.requesterMemberId !== undefined) {
    return validateLineCalendarServiceInput_(body);
  }
  const allowedKeys = ['action', 'internalToken', 'period', 'scope', 'actor', 'snapshot', 'audience', 'targetMemberId'];
  if (Object.keys(body).some(function(key) { return allowedKeys.indexOf(key) < 0; })) throw internalCalendarError_('INVALID_INPUT');
  if (body.snapshot !== undefined && body.snapshot !== true) throw internalCalendarError_('INVALID_INPUT');
  const snapshot = body.snapshot === true;
  const lineAudience = body.audience === 'line_group';
  if ((body.audience !== undefined && !lineAudience) || (snapshot && lineAudience)
      || (body.targetMemberId !== undefined && !lineAudience)) throw internalCalendarError_('INVALID_INPUT');
  const periods = { today: true, tomorrow: true, this_week: true, next_7_days: true };
  const scopes = { mine: true, family: true };
  const actor = body.actor;
  if (!periods[body.period] || !scopes[body.scope] || !actor || Array.isArray(actor) || typeof actor !== 'object') {
    throw internalCalendarError_('INVALID_INPUT');
  }
  const allowedActorKeys = ['homeId', 'memberUserId', 'displayName', 'role', 'capabilities', 'deviceId'];
  if (Object.keys(actor).some(function(key) { return allowedActorKeys.indexOf(key) < 0; })) throw internalCalendarError_('INVALID_INPUT');
  const homeId = String(actor.homeId || (snapshot
    ? PropertiesService.getScriptProperties().getProperty('PALURU_HOME_ID') : '') || '').trim();
  const memberUserId = String(actor.memberUserId || '').trim();
  if (snapshot && (body.period !== 'today' || body.scope !== 'family')) {
    throw internalCalendarError_('INVALID_INPUT');
  }
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(homeId) || !/^[a-zA-Z0-9_-]{1,100}$/.test(memberUserId)) {
    throw internalCalendarError_('INVALID_INPUT');
  }
  const member = getHomeMember_(homeId, memberUserId);
  if (!member || member.status !== 'active' || !isHomeMemberPolicyMatch_(member)) throw internalCalendarError_('UNAUTHORIZED');
  const target = body.targetMemberId || '';
  if (target && !/^(father|mother|eldest_son|eldest_daughter|second_son|youngest_daughter)$/.test(target)) throw internalCalendarError_('INVALID_INPUT');
  if (body.scope === 'mine' && target && target !== memberUserId) throw internalCalendarError_('UNAUTHORIZED');
  return {
    period: body.period, scope: body.scope,
    actor: { memberUserId: memberUserId },
    snapshot: snapshot,
    now: new Date(),
    audience: lineAudience ? 'line_group' : '',
    targetMemberId: target
  };
}

// Shared-only service contract. Retains canonical home binding, token auth,
// roster validation and safe projection. HomeMemberPolicy is the fixed SIX-person
// roster; unlike getHomeMember_, it never queries app enrollment or device state.
function validateLineCalendarServiceInput_(body) {
  const allowed = ['action', 'internalToken', 'service', 'homeId', 'audience', 'period', 'scope', 'requesterMemberId', 'targetMemberId'];
  if (Object.keys(body).some(function(key) { return allowed.indexOf(key) < 0; })
      || body.service !== 'kurobe_line' || body.audience !== 'line_group'
      || ['today', 'tomorrow', 'this_week'].indexOf(body.period) < 0
      || ['mine', 'family'].indexOf(body.scope) < 0) throw internalCalendarError_('INVALID_INPUT');
  if (typeof body.homeId !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(body.homeId)
      || !constantTimeEqualsCalendar_(body.homeId, loadInternalCalendarSecret_(PALURU_CALENDAR_SERVICE_HOME_SECRET))) {
    throw internalCalendarError_('UNAUTHORIZED');
  }
  const requester = typeof body.requesterMemberId === 'string' ? body.requesterMemberId : '';
  const target = body.targetMemberId === undefined ? '' : body.targetMemberId;
  const requesterPolicy = findHomeMemberPolicy_(requester);
  const targetPolicy = typeof target === 'string' && target ? findHomeMemberPolicy_(target) : null;
  if (!requesterPolicy || requesterPolicy.memberUserId !== requester || (target !== '' &&
      (!targetPolicy || targetPolicy.memberUserId !== target))) throw internalCalendarError_('UNAUTHORIZED');
  if (body.scope === 'mine' && target && target !== requester) throw internalCalendarError_('UNAUTHORIZED');
  return {
    serviceId: 'kurobe_line', requesterMemberId: requester,
    period: body.period, scope: body.scope, audience: 'line_group',
    targetMemberId: target, snapshot: false, now: new Date()
  };
}

// Only the existing shared family calendar is read. Never expose its raw title,
// private/confidential occurrences, sensitive details or unclassified events to LINE.
function projectLineCalendarEvent_(event) {
  if (!event || ['default', 'public'].indexOf(String(event.visibility || '').toLowerCase()) < 0
      || !/^(father|mother|eldest_son|eldest_daughter|second_son|youngest_daughter)$/.test(event.memberKey || '')) return null;
  const title = String(event.legacyRawTitle || event.rawTitle || event.title || '');
  if (/非公開|内緒|秘密|機密|社外秘|顧客|契約|会議|面談|人事|医療|通院|病院|診察|検査|治療|受診|精神|カウンセリング|private|confidential|secret/i.test(title)) return null;
  const category = classifyKurobeCalendarCategory_(event.title);
  if (['work', 'school', 'club', 'cram'].indexOf(category) < 0) return null;
  return {
    memberId: event.memberKey, category: category,
    startAt: Utilities.formatDate(event.start, 'Asia/Tokyo', event.allDay ? 'yyyy-MM-dd' : "yyyy-MM-dd'T'HH:mm:ssXXX"),
    endAt: Utilities.formatDate(event.end, 'Asia/Tokyo', event.allDay ? 'yyyy-MM-dd' : "yyyy-MM-dd'T'HH:mm:ssXXX"),
    allDay: event.allDay === true
  };
}

function buildKurobeCalendarSnapshot_(service, now) {
  const date = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd');
  const sourceEvents = service.readNormalizedDay(date);
  if (!Array.isArray(sourceEvents) || sourceEvents.length > 200) {
    throw internalCalendarError_('UPSTREAM_ERROR');
  }
  const events = sourceEvents.reduce(function(result, event) {
    const memberId = event && event.memberKey;
    const start = event && event.start;
    const end = event && event.end;
    if (!event || event.allDay || !/^(father|mother|eldest_son|eldest_daughter|second_son|youngest_daughter)$/.test(memberId || '')
        || !(start instanceof Date) || !(end instanceof Date) || end.getTime() <= start.getTime()) {
      return result;
    }
    const category = classifyKurobeCalendarCategory_(event.title);
    result.push({
      member_id: memberId, category: category,
      // Authenticated internal response only; Snapshot Worker classifies and drops this before GCS.
      title: String(event.title || '').slice(0, 512),
      start_ms: start.getTime(), end_ms: end.getTime()
    });
    return result;
  }, []);
  return {
    success: true,
    schemaVersion: PALURU_KUROBE_CALENDAR_SNAPSHOT_SCHEMA,
    data: { date: date, events: events, fetched_at_ms: now.getTime() }
  };
}

function classifyKurobeCalendarCategory_(title) {
  const value = String(title || '');
  const patterns = {
    work: /仕事|勤務|出勤|残業|バイト|職場|日比谷|登戸|新橋|田町|薬局|アンコンディション|カプリ/,
    school: /学校|授業|登校|下校|大学|高校|中学|小学校/,
    club: /部活|クラブ|練習|試合/,
    cram: /塾|予備校|補習/
  };
  const matches = Object.keys(patterns).filter(function(category) {
    return patterns[category].test(value);
  });
  if (matches.length > 1) return null;
  return matches[0] || 'other';
}

function constantTimeEqualsCalendar_(leftValue, rightValue) {
  const left = String(leftValue || '');
  const right = String(rightValue || '');
  const maxLength = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < maxLength; index += 1) {
    difference |= (left.charCodeAt(index % Math.max(left.length, 1)) || 0)
      ^ (right.charCodeAt(index % Math.max(right.length, 1)) || 0);
  }
  return difference === 0;
}

function sanitizeInternalCalendarWarnings_(warnings) {
  return (Array.isArray(warnings) ? warnings : []).map(function(value) {
    return String(value || '').replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
  }).filter(Boolean);
}

function normalizeInternalCalendarError_(code) {
  const allowed = { METHOD_NOT_ALLOWED: true, INVALID_INPUT: true, UNAUTHORIZED: true, UPSTREAM_ERROR: true };
  return allowed[code] ? code : 'INTERNAL_ERROR';
}

function internalCalendarErrorMessage_(code) {
  const messages = {
    METHOD_NOT_ALLOWED: 'POST is required',
    INVALID_INPUT: 'calendar context input is invalid',
    UNAUTHORIZED: 'authentication failed',
    UPSTREAM_ERROR: 'calendar is unavailable',
    INTERNAL_ERROR: 'request failed'
  };
  return messages[code] || messages.INTERNAL_ERROR;
}

function internalCalendarError_(code) {
  const error = new Error(String(code || 'INTERNAL_ERROR'));
  error.code = String(code || 'INTERNAL_ERROR');
  return error;
}

const PALURU_CALENDAR_API_TOKEN_PROPERTY = 'PALURU_CALENDAR_API_TOKEN';
const PALURU_CALENDAR_INTERNAL_SCHEMA_VERSION = 'calendar-context-internal-1.0';

function calendarContextInternal_(body, method, dependencies) {
  try {
    if (method !== 'POST') throw internalCalendarError_('METHOD_NOT_ALLOWED');
    if (!body || body.action !== 'calendarContextInternal') throw internalCalendarError_('INVALID_INPUT');
    authenticateInternalCalendar_(body.internalToken);
    const input = validateInternalCalendarInput_(body);
    const service = dependencies && dependencies.calendarReadService || CalendarReadService;
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

function authenticateInternalCalendar_(providedToken) {
  const expected = String(PropertiesService.getScriptProperties().getProperty(PALURU_CALENDAR_API_TOKEN_PROPERTY) || '');
  const actual = typeof providedToken === 'string' ? providedToken : '';
  if (!expected || !actual || !constantTimeEqualsCalendar_(expected, actual)) {
    throw internalCalendarError_('UNAUTHORIZED');
  }
}

function validateInternalCalendarInput_(body) {
  const allowedKeys = ['action', 'internalToken', 'period', 'scope', 'actor'];
  if (Object.keys(body).some(function(key) { return allowedKeys.indexOf(key) < 0; })) throw internalCalendarError_('INVALID_INPUT');
  const periods = { today: true, tomorrow: true, this_week: true, next_7_days: true };
  const scopes = { mine: true, family: true };
  const actor = body.actor;
  if (!periods[body.period] || !scopes[body.scope] || !actor || Array.isArray(actor) || typeof actor !== 'object') {
    throw internalCalendarError_('INVALID_INPUT');
  }
  if (Object.keys(actor).some(function(key) { return key !== 'userId'; })) throw internalCalendarError_('INVALID_INPUT');
  const userId = String(actor.userId || '').trim();
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(userId)) throw internalCalendarError_('INVALID_INPUT');
  return { period: body.period, scope: body.scope, actor: { userId: userId } };
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

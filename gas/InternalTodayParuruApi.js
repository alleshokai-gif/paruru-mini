const PALURU_TODAY_PARURU_INTERNAL_SCHEMA_VERSION = 'today-paruru-context-internal-1.0';

// This is the Agent-only read channel to the exact same aggregator used by
// the Home card.  It never accepts a browser device token.
function todayParuruContextInternal_(body, method, dependencies) {
  try {
    if (method !== 'POST') throw internalTodayParuruError_('METHOD_NOT_ALLOWED');
    if (!body || body.action !== 'todayParuruContextInternal') throw internalTodayParuruError_('INVALID_INPUT');
    authenticateInternalCalendar_(body.internalToken);
    const input = validateInternalTodayParuruInput_(body);
    const result = buildTodayParuruContextData_({
      selectedMemberKeys: input.selectedMemberKeys.join(','),
      includeUnknown: input.includeUnknown ? 'true' : 'false',
      tomorrowScheduleStartTime: input.tomorrowScheduleStartTime,
      scope: input.scope
    }, input.actor, dependencies);
    return json_({
      success: true,
      schemaVersion: PALURU_TODAY_PARURU_INTERNAL_SCHEMA_VERSION,
      data: result,
      warnings: result.warnings
    });
  } catch (error) {
    const code = normalizeInternalTodayParuruError_(error && error.code);
    return json_({
      success: false,
      schemaVersion: PALURU_TODAY_PARURU_INTERNAL_SCHEMA_VERSION,
      error: { code: code, message: internalTodayParuruErrorMessage_(code) }
    });
  }
}

function validateInternalTodayParuruInput_(body) {
  const allowed = ['action', 'internalToken', 'actor', 'todayParuruSettings'];
  if (Object.keys(body).some(function(key) { return allowed.indexOf(key) < 0; })) throw internalTodayParuruError_('INVALID_INPUT');
  const actor = body.actor;
  const allowedActor = ['homeId', 'memberUserId', 'displayName', 'role', 'capabilities', 'deviceId'];
  if (!actor || Array.isArray(actor) || typeof actor !== 'object'
      || Object.keys(actor).some(function(key) { return allowedActor.indexOf(key) < 0; })) {
    throw internalTodayParuruError_('INVALID_INPUT');
  }
  const homeId = String(actor.homeId || '').trim();
  const memberUserId = String(actor.memberUserId || '').trim();
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(homeId) || !/^[A-Za-z0-9_-]{1,100}$/.test(memberUserId)) {
    throw internalTodayParuruError_('INVALID_INPUT');
  }
  const member = getHomeMember_(homeId, memberUserId);
  if (!member || member.status !== 'active' || !isHomeMemberPolicyMatch_(member)) throw internalTodayParuruError_('UNAUTHORIZED');
  const settings = resolveTodayParuruSettings_(body.todayParuruSettings || {}, {
    homeId: homeId,
    memberUserId: memberUserId
  });
  return {
    actor: {
      homeId: homeId,
      memberUserId: memberUserId,
      displayName: String(actor.displayName || '').trim(),
      role: String(actor.role || '').trim(),
      capabilities: Array.isArray(actor.capabilities) ? actor.capabilities.slice() : [],
      deviceId: String(actor.deviceId || '').trim()
    },
    selectedMemberKeys: settings.selectedMemberKeys,
    includeUnknown: settings.includeUnknown,
    tomorrowScheduleStartTime: settings.tomorrowScheduleStartTime,
    scope: settings.scope
  };
}

function normalizeInternalTodayParuruError_(code) {
  const allowed = { METHOD_NOT_ALLOWED: true, INVALID_INPUT: true, UNAUTHORIZED: true };
  return allowed[code] ? code : 'TODAY_PARURU_UNAVAILABLE';
}

function internalTodayParuruErrorMessage_(code) {
  const messages = {
    METHOD_NOT_ALLOWED: 'POST is required',
    INVALID_INPUT: 'today context input is invalid',
    UNAUTHORIZED: 'authentication failed',
    TODAY_PARURU_UNAVAILABLE: 'today context is unavailable'
  };
  return messages[code] || messages.TODAY_PARURU_UNAVAILABLE;
}

function internalTodayParuruError_(code) {
  const error = new Error(String(code || 'TODAY_PARURU_UNAVAILABLE'));
  error.code = String(code || 'TODAY_PARURU_UNAVAILABLE');
  return error;
}

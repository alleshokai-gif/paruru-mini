const PALURU_AGENT_SCHEMA_VERSION = 'agent-chat-1.0';
const PALURU_AGENT_MAX_MESSAGE_CHARACTERS = 1000;
const PALURU_AGENT_URL_PROPERTY = 'PALURU_AGENT_URL';
const PALURU_AGENT_TOKEN_PROPERTY = 'PALURU_AGENT_TOKEN';
const PALURU_AGENT_DIAGNOSTICS_PROPERTY = 'PALURU_AGENT_DIAGNOSTICS_ENABLED';

function agentChat_(body) {
  const trace = createMiniAgentTrace_(body, 'agentChat');
  logMiniAgentTrace_('REQUEST_RECEIVED', trace, { stage: 'REQUEST_RECEIVED' });
  try {
    let actor;
    try {
      actor = resolveHomeAgentReadActor_(body || {});
    } catch (error) {
      setMiniAgentTraceStage_(error, trace, 'ACTOR_RESOLUTION');
      logMiniAgentTrace_('ACTOR_RESOLUTION_FAILED', trace, { stage: 'ACTOR_RESOLUTION', errorCode: error && error.code, reason: 'ACTOR_RESOLUTION_FAILED' });
      throw annotateAgentGatewayError_(error, 'HOME_CONTEXT_FAILED', 'ACTOR_RESOLUTION_FAILED');
    }
    logMiniAgentTrace_('ACTOR_RESOLVED', trace, { stage: 'ACTOR_RESOLUTION' });
    let input;
    try {
      input = validateAgentChatInput_(body || {}, actor);
      trace.clientRequestId = input.clientRequestId;
    } catch (error) {
      setMiniAgentTraceStage_(error, trace, 'INPUT_VALIDATION');
      throw annotateAgentGatewayError_(error, 'REQUEST_INVALID', 'INPUT_VALIDATION_FAILED');
    }
    let config;
    try {
      config = getPaluruAgentConfig_();
    } catch (error) {
      setMiniAgentTraceStage_(error, trace, 'AGENT_CONFIGURATION');
      throw annotateAgentGatewayError_(error, 'PROMPT_BUILD_FAILED', 'AGENT_CONFIGURATION_UNAVAILABLE');
    }
    const response = callPaluruAgent_(config, input, trace);
    try {
      const result = buildAgentChatSuccess_(response, input);
      logMiniAgentTrace_('RESPONSE_SENT', trace, { stage: 'RESPONSE_SENT', httpStatus: 200, intent: result.intent, agentPerformance: response && response.diagnostics });
      const output = json_(result);
      persistAgentTrace_(trace);
      return output;
    } catch (error) {
      setMiniAgentTraceStage_(error, trace, 'AGENT_RESPONSE');
      throw annotateAgentGatewayError_(error, 'RESPONSE_PARSE_FAILED', 'RESPONSE_BUILD_FAILED');
    }
  } catch (error) {
    const stage = String(error && error.agentTrace && error.agentTrace.stage || error && error.agentTraceStage || 'UNHANDLED_ERROR');
    setMiniAgentTraceStage_(error, trace, stage);
    if (stage === 'UNHANDLED_ERROR') {
      logMiniAgentTrace_('UNHANDLED_ERROR', trace, { stage: stage, errorCode: error && error.code });
    }
    const result = buildAgentChatError_(error);
    logMiniAgentTrace_('RESPONSE_SENT', trace, { stage: stage, httpStatus: 200, errorCode: result && result.error && result.error.code, reason: error && error.agentDiagnostics && error.agentDiagnostics.reason, agentPerformance: error && error.agentPerformance });
    const output = json_(result);
    persistAgentTrace_(trace);
    return output;
  }
}

function agentActionConfirm_(body) {
  const trace = createMiniAgentTrace_(body, 'agentActionConfirm');
  logMiniAgentTrace_('REQUEST_RECEIVED', trace, { stage: 'REQUEST_RECEIVED' });
  try {
    let actor;
    try {
      actor = resolveHomeAgentControlActor_(body || {});
      logMiniAgentTrace_('ACTOR_RESOLVED', trace, { stage: 'ACTOR_RESOLUTION' });
    } catch (error) {
      setMiniAgentTraceStage_(error, trace, 'ACTOR_RESOLUTION');
      throw error;
    }
    const input = validateAgentActionConfirmInput_(body || {}, actor);
    assertAgentActionsEnabled_();
    enforceAgentActionRateLimit_(actor.deviceId, input.clientRequestId);
    const config = getPaluruAgentConfig_();
    assertSameHomeAgentControlActor_(actor, resolveHomeAgentControlActor_(body || {}));
    const response = callPaluruAgentActionConfirm_(config, input, trace);
    const result = buildAgentActionConfirmSuccess_(response);
    logMiniAgentTrace_('RESPONSE_SENT', trace, { stage: 'RESPONSE_SENT', httpStatus: 200, agentPerformance: response && response.diagnostics });
    const output = json_(result);
    persistAgentTrace_(trace);
    return output;
  } catch (error) {
    const stage = String(error && error.agentTrace && error.agentTrace.stage || error && error.agentTraceStage || 'UNHANDLED_ERROR');
    setMiniAgentTraceStage_(error, trace, stage);
    if (stage === 'UNHANDLED_ERROR') {
      logMiniAgentTrace_('UNHANDLED_ERROR', trace, { stage: stage, errorCode: error && error.code });
    }
    const result = buildAgentActionConfirmError_(error);
    logMiniAgentTrace_('RESPONSE_SENT', trace, { stage: stage, httpStatus: 200, errorCode: result && result.error && result.error.code });
    const output = json_(result);
    persistAgentTrace_(trace);
    return output;
  }
}

function agentActionCancel_(body) {
  try {
    const actor = resolveHomeAgentControlActor_(body || {});
    const input = validateAgentActionConfirmInput_(body || {}, actor);
    assertAgentActionsEnabled_();
    const config = getPaluruAgentConfig_();
    assertSameHomeAgentControlActor_(actor, resolveHomeAgentControlActor_(body || {}));
    const response = callPaluruAgentActionCancel_(config, input);
    return json_(buildAgentActionCancelSuccess_(response));
  } catch (error) {
    return json_(buildAgentActionConfirmError_(error));
  }
}

function validateAgentChatInput_(body, actor) {
  const message = String(body.message || '').trim();
  const sessionId = String(body.sessionId || '').trim();
  const clientRequestId = String(body.clientRequestId || '').trim();

  if (!message || Array.from(message).length > PALURU_AGENT_MAX_MESSAGE_CHARACTERS) {
    throw createAgentGatewayError_('INVALID_INPUT');
  }
  if (!isUuid_(sessionId) || !isUuid_(clientRequestId)) {
    throw createAgentGatewayError_('INVALID_INPUT');
  }

  return {
    message: message,
    sessionId: sessionId,
    clientRequestId: clientRequestId,
    actor: {
      memberUserId: String(actor && actor.memberUserId || '').trim().slice(0, 100),
      displayName: String(actor && actor.displayName || '').trim().slice(0, 100),
      role: String(actor && actor.role || '').trim().slice(0, 100),
      capabilities: Array.isArray(actor && actor.capabilities) ? actor.capabilities.slice() : [],
      homeId: String(actor && actor.homeId || '').trim().slice(0, 200),
      deviceId: String(actor && actor.deviceId || '').trim().slice(0, 200),
    },
    requestMetadata: sanitizeAgentRequestMetadata_(body.requestMetadata, sessionId, clientRequestId, actor),
  };
}

function sanitizeAgentRequestMetadata_(value, sessionId, clientRequestId, actor) {
  const source = value && !Array.isArray(value) && typeof value === 'object' ? value : {};
  const memoSource = source.memoAttributes && !Array.isArray(source.memoAttributes) && typeof source.memoAttributes === 'object'
    ? source.memoAttributes : {};
  const roomHint = String(source.roomHint || '').trim();
  const calendarScopeHint = String(source.calendarScopeHint || '').trim();
  const allowedRooms = { living: true, bedroom: true, kids_room: true, study: true };
  const allowedScopes = { mine: true, family: true };
  const todaySettings = sanitizeTodayParuruSettings_(source.todayParuruSettings, actor, calendarScopeHint);
  return {
    sessionId: sessionId,
    clientRequestId: clientRequestId,
    purpose: String(source.purpose || '').trim().slice(0, 80),
    intent: String(source.intent || '').trim().slice(0, 80),
    roomHint: allowedRooms[roomHint] ? roomHint : null,
    calendarScopeHint: allowedScopes[calendarScopeHint] ? calendarScopeHint : null,
    todayParuruSettings: todaySettings,
    memoAttributes: {
      visibility: String(memoSource.visibility || '').trim().slice(0, 40),
      category: String(memoSource.category || '').trim().slice(0, 80),
      priority: String(memoSource.priority || '').trim().slice(0, 40),
    },
  };
}

function sanitizeTodayParuruSettings_(value, actor, calendarScopeHint) {
  const source = value && !Array.isArray(value) && typeof value === 'object' ? value : {};
  const aliases = {
    father: 'father', mother: 'mother', son1: 'eldest_son', eldest_son: 'eldest_son',
    daughter1: 'eldest_daughter', eldest_daughter: 'eldest_daughter', son2: 'second_son', second_son: 'second_son',
    daughter2: 'youngest_daughter', youngest_daughter: 'youngest_daughter', family: 'family'
  };
  const seen = {};
  const raw = Array.isArray(source.selectedMemberKeys) ? source.selectedMemberKeys : String(source.selectedMemberKeys || '').split(',');
  const selected = raw.map(function(value) { return aliases[String(value || '').trim()] || ''; }).filter(function(value) {
    if (!value || seen[value]) return false;
    seen[value] = true;
    return true;
  });
  const actorMember = aliases[String(actor && actor.memberUserId || '').trim()] || '';
  if (!selected.length) {
    if (actorMember) selected.push(actorMember);
    selected.push('family');
  }
  const startTime = String(source.tomorrowScheduleStartTime || '').trim();
  const normalizedStart = /^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) ? startTime : '18:00';
  const scope = selected.length === 1 && selected[0] === actorMember ? 'mine' : 'family';
  return {
    selectedMemberKeys: selected,
    includeUnknown: source.includeUnknown === true || String(source.includeUnknown || '').toLowerCase() === 'true',
    tomorrowScheduleStartTime: normalizedStart,
    scope: scope
  };
}

function isUuid_(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function getPaluruAgentConfig_() {
  const properties = PropertiesService.getScriptProperties();
  const url = String(properties.getProperty(PALURU_AGENT_URL_PROPERTY) || '').trim();
  const token = String(properties.getProperty(PALURU_AGENT_TOKEN_PROPERTY) || '').trim();

  if (!url || !token) {
    throw createAgentGatewayError_('CONFIGURATION_ERROR');
  }
  return { url: url, token: token };
}

function callPaluruAgent_(config, input, trace) {
  const requestPayload = {
    action: 'agent.chat',
    message: input.message,
    sessionId: input.sessionId,
    clientRequestId: input.clientRequestId,
    actor: input.actor,
    requestMetadata: input.requestMetadata,
    authToken: config.token,
  };
  if (requestPayload.clientRequestId !== input.clientRequestId) {
    throw createAgentGatewayError_('AGENT_ERROR', 'AGENT_REQUEST', 'CLIENT_REQUEST_ID_MISMATCH');
  }
  logMiniAgentTrace_('AGENT_REQUEST_START', trace, { stage: 'AGENT_REQUEST' });
  let response;
  try {
    response = UrlFetchApp.fetch(config.url, {
      method: 'post',
      contentType: 'text/plain;charset=utf-8',
      payload: JSON.stringify(requestPayload),
      muteHttpExceptions: true,
    });
  } catch (error) {
    logMiniAgentTrace_('AGENT_FETCH_FAILED', trace, { stage: 'AGENT_REQUEST', errorCode: 'AGENT_UNAVAILABLE', reason: 'URLFETCH_FAILED' });
    const gatewayError = createAgentGatewayError_('AGENT_UNAVAILABLE', 'MODEL_FAILED', 'URLFETCH_FAILED', error);
    setMiniAgentTraceStage_(gatewayError, trace, 'AGENT_REQUEST');
    throw gatewayError;
  }

  const status = response.getResponseCode();
  logMiniAgentTrace_('AGENT_HTTP_RESPONSE', trace, { stage: 'AGENT_REQUEST', httpStatus: status });
  let responseText = '';
  try {
    responseText = response.getContentText();
  } catch (error) {
    const gatewayError = createAgentGatewayError_('AGENT_UNAVAILABLE', 'RESPONSE_PARSE_FAILED', 'UPSTREAM_BODY_READ_FAILED', error);
    setMiniAgentTraceStage_(gatewayError, trace, 'AGENT_RESPONSE');
    throw gatewayError;
  }
  if (status < 200 || status >= 300) {
    const gatewayError = createAgentGatewayError_('AGENT_UNAVAILABLE', 'MODEL_FAILED', 'UPSTREAM_HTTP_' + status);
    setMiniAgentTraceStage_(gatewayError, trace, 'AGENT_REQUEST');
    throw gatewayError;
  }

  let parsed;
  try {
    parsed = JSON.parse(responseText);
  } catch (error) {
    const gatewayError = createAgentGatewayError_('AGENT_UNAVAILABLE', 'RESPONSE_PARSE_FAILED', 'UPSTREAM_JSON_PARSE_FAILED', error);
    setMiniAgentTraceStage_(gatewayError, trace, 'AGENT_RESPONSE');
    throw gatewayError;
  }
  appendAgentTraceEntries_(trace, parsed && parsed.traceEvents);

  if (!parsed || parsed.success !== true) {
    const error = createAgentGatewayError_(safeUpstreamAgentErrorCode_(parsed), 'UPSTREAM_AGENT_FAILED', String(parsed && parsed.error && parsed.error.code || parsed && parsed.code || 'UPSTREAM_SUCCESS_FALSE'));
    if (parsed && parsed.diagnostics) error.agentPerformance = sanitizeAgentPerformanceDiagnostics_(parsed.diagnostics);
    const upstreamTrace = parsed && parsed.trace;
    setMiniAgentTraceStage_(error, trace, String(upstreamTrace && upstreamTrace.stage || 'AGENT_RESPONSE'));
    throw error;
  }
  if (parsed.schemaVersion !== PALURU_AGENT_SCHEMA_VERSION) {
    const gatewayError = createAgentGatewayError_('AGENT_ERROR', 'RESPONSE_PARSE_FAILED', 'SCHEMA_VERSION_MISMATCH');
    setMiniAgentTraceStage_(gatewayError, trace, 'AGENT_RESPONSE');
    throw gatewayError;
  }
  return parsed;
}

function safeUpstreamAgentErrorCode_(payload) {
  const sourceCode = String(payload && payload.error && payload.error.code || payload && payload.code || 'AGENT_ERROR');
  const allowed = {
    ACTOR_CONTRACT_INVALID: true,
    TOOL_DISABLED: true,
    CLIMATE_UNAVAILABLE: true,
    WEATHER_UNAVAILABLE: true,
    CALENDAR_UNAVAILABLE: true,
    TODAY_PARURU_UNAVAILABLE: true,
    ROOM_NOT_FOUND: true,
    FOLLOWUP_REQUIRED: true,
    ACTION_NOT_ALLOWED: true,
    CONFIRMATION_EXPIRED: true,
    CONFIRMATION_ACTOR_MISMATCH: true,
    AUTOMATION_UPSTREAM_ERROR: true,
    UPSTREAM_ERROR: true,
    UPSTREAM_ERROR: true,
    AGENT_UNAVAILABLE: true,
    INVALID_INPUT: true,
  };
  return allowed[sourceCode] ? sourceCode : 'AGENT_ERROR';
}

function buildAgentChatSuccess_(response, input) {
  const data = response.data || {};
  const reply = String(data.reply || '').trim();
  if (!reply) {
    throw createAgentGatewayError_('AGENT_ERROR', 'RESPONSE_PARSE_FAILED', 'REPLY_MISSING');
  }

  const result = {
    success: true,
    reply: reply,
    sessionId: input.sessionId,
    clientRequestId: input.clientRequestId,
    serviceExecutions: sanitizeServiceExecutions_(data.serviceExecutions),
    usage: sanitizeAgentUsage_(data.usage),
  };
  if (isAgentGatewayDiagnosticsEnabled_() && data.diagnostics) {
    result.diagnostics = sanitizeAgentPerformanceDiagnostics_(data.diagnostics);
  }
  if (Object.prototype.hasOwnProperty.call(data, 'followup')) {
    result.followup = sanitizeAgentFollowup_(data.followup);
  }
  if (Object.prototype.hasOwnProperty.call(data, 'actionConfirmation')) {
    result.actionConfirmation = sanitizeAgentActionConfirmation_(data.actionConfirmation);
  }
  return result;
}

function validateAgentActionConfirmInput_(body, actor) {
  const confirmationId = String(body.confirmationId || '').trim();
  const clientRequestId = String(body.clientRequestId || '').trim();
  if (!isUuid_(confirmationId) || !isUuid_(clientRequestId) || !actor || !actor.deviceId) {
    throw createAgentGatewayError_('INVALID_INPUT');
  }
  return {
    confirmationId: confirmationId,
    clientRequestId: clientRequestId,
    actor: {
      homeId: String(actor.homeId || '').trim().slice(0, 200),
      memberUserId: String(actor.memberUserId || '').trim().slice(0, 100),
      displayName: String(actor.displayName || '').trim().slice(0, 100),
      role: String(actor.role || '').trim().slice(0, 100),
      capabilities: Array.isArray(actor.capabilities) ? actor.capabilities.slice() : [],
      deviceId: String(actor.deviceId || '').trim().slice(0, 200),
    },
  };
}

function assertAgentActionsEnabled_() {
  const deps = getHomeAgentActionDependencies_();
  assertHomeAgentActionsEnabled_(deps);
}

function assertSameHomeAgentControlActor_(expected, actual) {
  if (!expected || !actual
      || String(expected.homeId || '') !== String(actual.homeId || '')
      || String(expected.memberUserId || '') !== String(actual.memberUserId || '')
      || String(expected.deviceId || '') !== String(actual.deviceId || '')) {
    throw createAgentGatewayError_('UNAUTHORIZED_DEVICE');
  }
}

function enforceAgentActionRateLimit_(deviceId, clientRequestId) {
  const key = 'agentActionRate:' + String(deviceId || '').replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 80);
  try {
    const cache = CacheService.getScriptCache();
    const previousClientRequestId = cache.get(key);
    if (previousClientRequestId && previousClientRequestId !== clientRequestId) throw createAgentGatewayError_('AGENT_ACTION_RATE_LIMITED');
    cache.put(key, clientRequestId, 2);
  } catch (error) {
    if (error && error.code === 'AGENT_ACTION_RATE_LIMITED') throw error;
  }
}

function callPaluruAgentActionConfirm_(config, input, trace) {
  logMiniAgentTrace_('AGENT_CONFIRM_REQUEST_START', trace, { stage: 'AGENT_CONFIRM_REQUEST' });
  let response;
  try {
    response = UrlFetchApp.fetch(config.url, {
      method: 'post',
      contentType: 'text/plain;charset=utf-8',
      payload: JSON.stringify({
        action: 'agent.confirmAction',
        confirmationId: input.confirmationId,
        clientRequestId: input.clientRequestId,
        actor: input.actor,
        authToken: config.token,
      }),
      muteHttpExceptions: true,
    });
  } catch (error) {
    logMiniAgentTrace_('AGENT_FETCH_FAILED', trace, { stage: 'AGENT_CONFIRM_REQUEST', errorCode: 'AGENT_UNAVAILABLE', reason: 'URLFETCH_FAILED' });
    const gatewayError = createAgentGatewayError_('AGENT_UNAVAILABLE', 'AGENT_CONFIRM_REQUEST', 'URLFETCH_FAILED', error);
    setMiniAgentTraceStage_(gatewayError, trace, 'AGENT_CONFIRM_REQUEST');
    throw gatewayError;
  }
  const status = response.getResponseCode();
  logMiniAgentTrace_('AGENT_HTTP_RESPONSE', trace, { stage: 'AGENT_CONFIRM_REQUEST', httpStatus: status });
  if (status < 200 || status >= 300) {
    const gatewayError = createAgentGatewayError_('AGENT_UNAVAILABLE', 'AGENT_CONFIRM_REQUEST', 'UPSTREAM_HTTP_' + status);
    setMiniAgentTraceStage_(gatewayError, trace, 'AGENT_CONFIRM_REQUEST');
    throw gatewayError;
  }
  let parsed;
  try {
    parsed = JSON.parse(response.getContentText());
  } catch (error) {
    const gatewayError = createAgentGatewayError_('AGENT_UNAVAILABLE', 'AGENT_CONFIRM_RESPONSE', 'UPSTREAM_JSON_PARSE_FAILED', error);
    setMiniAgentTraceStage_(gatewayError, trace, 'AGENT_CONFIRM_RESPONSE');
    throw gatewayError;
  }
  appendAgentTraceEntries_(trace, parsed && parsed.traceEvents);
  if (!parsed || parsed.success !== true || parsed.schemaVersion !== PALURU_AGENT_SCHEMA_VERSION) {
    const gatewayError = createAgentGatewayError_(safeUpstreamAgentErrorCode_(parsed), 'AGENT_CONFIRM_RESPONSE', String(parsed && parsed.error && parsed.error.code || parsed && parsed.code || 'UPSTREAM_SUCCESS_FALSE'));
    setMiniAgentTraceStage_(gatewayError, trace, 'AGENT_CONFIRM_RESPONSE');
    throw gatewayError;
  }
  return parsed;
}

function callPaluruAgentActionCancel_(config, input) {
  let response;
  try {
    response = UrlFetchApp.fetch(config.url, {
      method: 'post',
      contentType: 'text/plain;charset=utf-8',
      payload: JSON.stringify({
        action: 'agent.cancelAction',
        confirmationId: input.confirmationId,
        clientRequestId: input.clientRequestId,
        actor: input.actor,
        authToken: config.token,
      }),
      muteHttpExceptions: true,
    });
  } catch (error) {
    throw createAgentGatewayError_('AGENT_UNAVAILABLE');
  }
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    throw createAgentGatewayError_('AGENT_UNAVAILABLE');
  }
  let parsed;
  try {
    parsed = JSON.parse(response.getContentText());
  } catch (error) {
    throw createAgentGatewayError_('AGENT_UNAVAILABLE');
  }
  if (!parsed || parsed.success !== true || parsed.schemaVersion !== PALURU_AGENT_SCHEMA_VERSION) {
    throw createAgentGatewayError_(safeUpstreamAgentErrorCode_(parsed));
  }
  return parsed;
}

function sanitizeAgentFollowup_(followup) {
  if (!followup || Array.isArray(followup) || typeof followup !== 'object') {
    throw createAgentGatewayError_('AGENT_ERROR', 'RESPONSE_PARSE_FAILED', 'FOLLOWUP_INVALID');
  }
  const itemId = String(followup.itemId || '').trim();
  const question = String(followup.question || '').trim();
  const inputType = String(followup.inputType || '').trim();
  const allowedTypes = { date: true, datetime: true, time: true, text: true, yesno: true };
  if (followup.required !== true || !isUuid_(itemId) || !question
      || Array.from(question).length > 300 || !allowedTypes[inputType]) {
    throw createAgentGatewayError_('AGENT_ERROR', 'RESPONSE_PARSE_FAILED', 'FOLLOWUP_INVALID');
  }
  return {
    required: true,
    itemId: itemId,
    question: question,
    inputType: inputType,
  };
}

function sanitizeAgentActionConfirmation_(confirmation) {
  if (!confirmation || Array.isArray(confirmation) || typeof confirmation !== 'object') {
    throw createAgentGatewayError_('AGENT_ERROR', 'RESPONSE_PARSE_FAILED', 'ACTION_CONFIRMATION_INVALID');
  }
  const confirmationId = String(confirmation.confirmationId || '').trim();
  const command = String(confirmation.command || '').trim();
  const roomLabel = String(confirmation.roomLabel || '').trim();
  const summary = String(confirmation.summary || '').trim();
  const expiresAt = String(confirmation.expiresAt || '').trim();
  const allowedCommands = { 'automation.pause': true, 'automation.resume': true, 'aircon.power': true, 'aircon.applySettings': true };
  if (confirmation.required !== true || !isUuid_(confirmationId) || !allowedCommands[command]
      || !roomLabel || Array.from(roomLabel).length > 40
      || !summary || Array.from(summary).length > 200
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/.test(expiresAt)) {
    throw createAgentGatewayError_('AGENT_ERROR', 'RESPONSE_PARSE_FAILED', 'ACTION_CONFIRMATION_INVALID');
  }
  return {
    required: true,
    confirmationId: confirmationId,
    command: command,
    roomLabel: roomLabel,
    summary: summary,
    expiresAt: expiresAt,
  };
}

function buildAgentActionConfirmSuccess_(response) {
  const data = response.data || {};
  const allowedStatus = { completed: true, failed: true, unknown: true };
  const allowedCommands = { 'automation.pause': true, 'automation.resume': true, 'aircon.power': true, 'aircon.applySettings': true };
  const command = String(data.command || '').trim();
  const status = String(data.status || '').trim();
  if (!allowedCommands[command] || !allowedStatus[status]) throw createAgentGatewayError_('AGENT_ERROR');
  const result = data.observed || {};
  return {
    success: status === 'completed',
    operation: data.operation === 'resume' ? 'resume' : 'pause',
    status: status,
    roomLabel: String(data.roomLabel || '').trim().slice(0, 40),
    result: {
      activePause: result.pause ? {
        status: String(result.pause.status || ''),
        expiresAt: String(result.pause.pausedUntil || ''),
      } : null,
    },
    error: status === 'completed' ? null : { code: String(data.error && data.error.code || 'AGENT_ACTION_FAILED') },
  };
}

function buildAgentActionCancelSuccess_(response) {
  const data = response.data || {};
  const allowedCommands = { 'automation.pause': true, 'automation.resume': true, 'aircon.power': true, 'aircon.applySettings': true };
  const command = String(data.command || '').trim();
  if (!allowedCommands[command] || data.status !== 'cancelled' || data.cancelled !== true) {
    throw createAgentGatewayError_('AGENT_ERROR');
  }
  return {
    success: true,
    operation: data.operation === 'resume' ? 'resume' : 'pause',
    status: 'cancelled',
    roomLabel: String(data.roomLabel || '').trim().slice(0, 40),
  };
}

function buildAgentActionConfirmError_(error) {
  const allowedCodes = {
    INVALID_INPUT: true,
    CONFIGURATION_ERROR: true,
    AGENT_UNAVAILABLE: true,
    AGENT_ERROR: true,
    UNAUTHORIZED_DEVICE: true,
    FORBIDDEN: true,
    MEMBERSHIP_NOT_FOUND: true,
    HOME_AGENT_ACTIONS_DISABLED: true,
    AGENT_ACTION_RATE_LIMITED: true,
    ACTION_NOT_ALLOWED: true,
    CONFIRMATION_EXPIRED: true,
    CONFIRMATION_ACTOR_MISMATCH: true,
  };
  const code = error && allowedCodes[error.code] ? error.code : 'INTERNAL_ERROR';
  return { success: false, error: { code: code, message: getAgentActionPublicErrorMessage_(code) } };
}

function getAgentActionPublicErrorMessage_(code) {
  if (code === 'HOME_AGENT_ACTIONS_DISABLED') return 'home agent operations are disabled';
  if (code === 'UNAUTHORIZED_DEVICE' || code === 'FORBIDDEN' || code === 'MEMBERSHIP_NOT_FOUND') return 'device authentication failed';
  if (code === 'AGENT_ACTION_RATE_LIMITED') return 'too many action requests';
  if (code === 'CONFIGURATION_ERROR') return 'Agent connection is not configured';
  if (code === 'AGENT_UNAVAILABLE') return 'Agent is unavailable';
  if (code === 'ACTION_NOT_ALLOWED') return 'この端末では操作を実行できません';
  if (code === 'CONFIRMATION_EXPIRED') return '確認の有効期限が切れました。もう一度相談してください';
  if (code === 'CONFIRMATION_ACTOR_MISMATCH') return '確認を作成した端末と一致しません';
  return 'action confirmation failed';
}

function sanitizeServiceExecutions_(executions) {
  if (!Array.isArray(executions)) return [];
  return executions.map(function(execution) {
    return {
      service: String(execution && execution.service || ''),
      status: String(execution && execution.status || ''),
      durationMs: normalizeNullableNumber_(execution && execution.durationMs),
    };
  });
}

function sanitizeAgentUsage_(usage) {
  const source = usage || {};
  return {
    inputTokens: normalizeNullableNumber_(source.inputTokens),
    outputTokens: normalizeNullableNumber_(source.outputTokens),
    totalTokens: normalizeNullableNumber_(source.totalTokens),
  };
}

function normalizeNullableNumber_(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function buildAgentChatError_(error) {
  const allowedCodes = {
    INVALID_INPUT: true,
    CONFIGURATION_ERROR: true,
    AGENT_UNAVAILABLE: true,
    AGENT_ERROR: true,
    ACTOR_CONTRACT_INVALID: true,
    TOOL_DISABLED: true,
    CLIMATE_UNAVAILABLE: true,
    WEATHER_UNAVAILABLE: true,
    CALENDAR_UNAVAILABLE: true,
    TODAY_PARURU_UNAVAILABLE: true,
    ROOM_NOT_FOUND: true,
    FOLLOWUP_REQUIRED: true,
    ACTION_NOT_ALLOWED: true,
    CONFIRMATION_EXPIRED: true,
    CONFIRMATION_ACTOR_MISMATCH: true,
    AUTOMATION_UPSTREAM_ERROR: true,
    UPSTREAM_ERROR: true,
  };
  const code = error && allowedCodes[error.code] ? error.code : 'INTERNAL_ERROR';
  const messages = {
    INVALID_INPUT: '入力内容を確認してください。',
    CONFIGURATION_ERROR: 'Agent接続設定が未完了です。',
    AGENT_UNAVAILABLE: '現在Agentへ接続できません。',
    AGENT_ERROR: 'Agentの処理を完了できませんでした。',
    ACTOR_CONTRACT_INVALID: '端末の利用情報を確認できませんでした。',
    TOOL_DISABLED: 'この相談機能は現在利用できません。',
    CLIMATE_UNAVAILABLE: '室温・湿度を取得できませんでした。',
    WEATHER_UNAVAILABLE: '外の天気を取得できませんでした。',
    CALENDAR_UNAVAILABLE: '予定を取得できませんでした。',
    TODAY_PARURU_UNAVAILABLE: '今日の予定とタスクを取得できませんでした。',
    ROOM_NOT_FOUND: '指定された部屋を見つけられませんでした。',
    FOLLOWUP_REQUIRED: '確認に必要な情報が足りません。',
    ACTION_NOT_ALLOWED: 'この端末では操作を実行できません。',
    CONFIRMATION_EXPIRED: '確認の有効期限が切れました。もう一度相談してください。',
    CONFIRMATION_ACTOR_MISMATCH: '確認を作成した端末と一致しません。',
    AUTOMATION_UPSTREAM_ERROR: '家電・自動制御の確認先へつながりませんでした。',
    UPSTREAM_ERROR: '確認先のサービスへつながりませんでした。',
    INTERNAL_ERROR: '内部エラーが発生しました。',
  };
  const result = { success: false, error: { code: code, message: messages[code] } };
  const trace = publicMiniAgentTrace_(error && error.agentTrace);
  if (trace) result.trace = trace;
  if (isAgentGatewayDiagnosticsEnabled_()) {
    const diagnostic = error && error.agentDiagnostics || {};
    result.diagnostics = {
      stage: String(diagnostic.stage || 'AGENT_CHAT_UNHANDLED'),
      reason: String(diagnostic.reason || error && error.code || 'UNKNOWN'),
    };
    if (error && error.agentPerformance) result.diagnostics.performance = sanitizeAgentPerformanceDiagnostics_(error.agentPerformance);
  }
  return result;
}

function isAgentGatewayDiagnosticsEnabled_() {
  return String(PropertiesService.getScriptProperties().getProperty(PALURU_AGENT_DIAGNOSTICS_PROPERTY) || '').trim().toLowerCase() === 'true';
}

function createMiniAgentTrace_(body, action) {
  return {
    clientRequestId: String(body && body.clientRequestId || '').trim(),
    action: String(action || 'agentChat'),
    startedAtMs: Date.now(),
    stage: 'REQUEST_RECEIVED',
    entries: [],
    agentEntries: []
  };
}

function setMiniAgentTraceStage_(error, trace, stage) {
  const safeStage = safeMiniAgentTraceText_(stage || 'UNHANDLED_ERROR');
  if (trace) trace.stage = safeStage;
  if (error && typeof error === 'object') {
    error.agentTraceStage = safeStage;
    error.agentTrace = {
      clientRequestId: String(trace && trace.clientRequestId || '').trim(),
      stage: safeStage
    };
  }
  return error;
}

function publicMiniAgentTrace_(trace) {
  const clientRequestId = String(trace && trace.clientRequestId || '').trim();
  if (!isUuid_(clientRequestId)) return null;
  return {
    clientRequestId: clientRequestId,
    stage: safeMiniAgentTraceText_(trace && trace.stage || 'UNHANDLED_ERROR')
  };
}

function logMiniAgentTrace_(event, trace, details) {
  const source = details || {};
  const performance = source.agentPerformance && typeof source.agentPerformance === 'object' ? source.agentPerformance : {};
  const entry = {
    timestamp: new Date().toISOString(),
    event: safeMiniAgentTraceText_(event),
    clientRequestIdSuffix: String(trace && trace.clientRequestId || '').slice(-8),
    deploymentId: miniAgentTraceDeploymentSuffix_(),
    version: null,
    miniDeploymentSuffix: miniAgentTraceDeploymentSuffix_(),
    miniVersion: null,
    agentDeploymentSuffix: sanitizeAgentDeploymentSuffix_(source.agentDeploymentSuffix),
    agentVersion: null,
    osDeploymentSuffix: sanitizeAgentDeploymentSuffix_(source.osDeploymentSuffix),
    osVersion: null,
    action: safeMiniAgentTraceText_(trace && trace.action || 'agentChat'),
    httpStatus: Number.isFinite(Number(source.httpStatus)) ? Number(source.httpStatus) : null,
    errorCode: safeMiniAgentTraceText_(source.errorCode || '' ) || null,
    stage: safeMiniAgentTraceText_(source.stage || trace && trace.stage || ''),
    reason: safeMiniAgentTraceText_(source.reason || '') || null,
    elapsedMs: Math.max(0, Date.now() - Number(trace && trace.startedAtMs || Date.now())),
    openAiCallCount: traceMetricNumber_(performance.openAiCallCount),
    serviceCallCount: traceMetricNumber_(performance.serviceCallCount),
    intent: safeMiniAgentTraceText_(source.intent || '') || null,
    service: safeMiniAgentTraceText_(source.service || '') || null
  };
  if (trace && Array.isArray(trace.entries)) trace.entries.push(entry);
  if (typeof Logger !== 'undefined' && typeof Logger.log === 'function') {
    Logger.log('[PALURU_TRACE] ' + JSON.stringify(entry));
  }
}

function appendAgentTraceEntries_(trace, entries) {
  if (!trace || !Array.isArray(trace.agentEntries) || !Array.isArray(entries)) return;
  const allowed = [
    'event', 'clientRequestIdSuffix', 'deploymentId', 'version', 'action', 'httpStatus',
    'errorCode', 'stage', 'reason', 'elapsedMs', 'openAiCallCount', 'serviceCallCount',
    'intent', 'service', 'openAiErrorType', 'openAiErrorCode', 'openAiErrorMessage',
    'validationField', 'validationReason', 'period', 'scope', 'roomId', 'operation', 'state',
    'boundary', 'boundaryHash', 'from', 'field', 'value', 'before', 'after',
    'sourceType', 'sourceSystem', 'sourceReason', 'freshness', 'sourceSelected',
    'sourceFallbackUsed', 'sourceObservedAt', 'sourceRecordCount', 'sourceSelectedCount',
    'calendarRecordCount', 'inboxRecordCount', 'sourceHttpStatus', 'sourceResultCode'
    ,'actionSource', 'actionResult', 'stateBefore', 'stateAfter',
    'confirmationRoomLabelPresent', 'confirmationSummaryPresent',
    'confirmationRoomLabelValid', 'confirmationSummaryValid',
    'hasActionConfirmation', 'confirmationRequired', 'hasSourceTrace', 'hasActionTrace',
    'osResponseHasActionConfirmation', 'sanitizedHasActionConfirmation', 'returnedHasActionConfirmation',
    'preparedHasFollowupRequired', 'preparedHasActionConfirmation', 'preparedHasSourceTrace', 'preparedHasActionTrace',
    'preparedStatus', 'preparedKeysHash',
    'miniDeploymentSuffix', 'miniVersion', 'agentDeploymentSuffix', 'agentVersion',
    'osDeploymentSuffix', 'osVersion'
  ];
  entries.slice(0, 32).forEach(function(entry) {
    if (!entry || Array.isArray(entry) || typeof entry !== 'object') return;
    const safe = {};
    allowed.forEach(function(key) {
      if (!Object.prototype.hasOwnProperty.call(entry, key)) return;
      if (key === 'validationField') {
        safe[key] = sanitizeIncomingAgentTraceValidationField_(entry[key]);
        return;
      }
      if (key === 'validationReason') {
        safe[key] = sanitizeIncomingAgentTraceValidationReason_(entry[key]);
        return;
      }
      if (key === 'period' || key === 'scope' || key === 'roomId' || key === 'operation'
          || key === 'value' || key === 'before' || key === 'after') {
        safe[key] = sanitizeAgentTraceBoundaryValue_(key, entry[key]);
        return;
      }
      if (key === 'state') {
        safe[key] = { OFF: true, ON: true, COOL: true, HEAT: true, AUTO: true, UNKNOWN: true }[String(entry[key] || '')] ? String(entry[key]) : '';
        return;
      }
      if (key === 'boundary') {
        safe[key] = sanitizeAgentTraceBoundary_(entry[key]);
        return;
      }
      if (key === 'from') {
        safe[key] = sanitizeAgentTraceBoundary_(entry[key]);
        return;
      }
      if (key === 'boundaryHash') {
        safe[key] = /^[a-f0-9]{8}$/i.test(String(entry[key] || '')) ? String(entry[key]).toLowerCase() : '';
        return;
      }
      if (key === 'field') {
        safe[key] = { period: true, scope: true, roomId: true, operation: true }[String(entry[key] || '')] ? String(entry[key]) : '';
        return;
      }
      if (key.indexOf('source') === 0 || key === 'freshness') {
        safe[key] = sanitizeAgentSourceTraceValue_(key, entry[key]);
        return;
      }
      if (key === 'actionSource' || key === 'actionResult' || key === 'stateBefore' || key === 'stateAfter') {
        safe[key] = sanitizeAgentActionTraceValue_(key, entry[key]);
        return;
      }
      if (key === 'confirmationRoomLabelPresent' || key === 'confirmationSummaryPresent'
          || key === 'confirmationRoomLabelValid' || key === 'confirmationSummaryValid'
          || key === 'hasActionConfirmation' || key === 'confirmationRequired'
          || key === 'hasSourceTrace' || key === 'hasActionTrace'
          || key === 'osResponseHasActionConfirmation' || key === 'sanitizedHasActionConfirmation'
          || key === 'returnedHasActionConfirmation') {
        safe[key] = typeof entry[key] === 'boolean' ? entry[key] : '';
        return;
      }
      if (key === 'preparedHasFollowupRequired' || key === 'preparedHasActionConfirmation'
          || key === 'preparedHasSourceTrace' || key === 'preparedHasActionTrace') {
        safe[key] = typeof entry[key] === 'boolean' ? entry[key] : '';
        return;
      }
      if (key === 'preparedStatus') {
        safe[key] = { FOLLOWUP_REQUIRED: true, CONFIRMATION_READY: true, TRACE_ONLY: true, EMPTY: true, INVALID: true }[String(entry[key] || '')] ? String(entry[key]) : '';
        return;
      }
      if (key === 'preparedKeysHash') {
        safe[key] = /^[a-f0-9]{8}$/i.test(String(entry[key] || '')) ? String(entry[key]).toLowerCase() : '';
        return;
      }
      if (key === 'agentDeploymentSuffix' || key === 'osDeploymentSuffix') {
        safe[key] = sanitizeAgentDeploymentSuffix_(entry[key]);
        return;
      }
      if (key === 'deploymentId') {
        // Legacy column remains, but it may store only the same safe suffix.
        safe[key] = sanitizeAgentDeploymentSuffix_(entry[key]);
        return;
      }
      if (key === 'version') {
        safe[key] = null;
        return;
      }
      if (key === 'miniDeploymentSuffix') {
        // The Mini runtime is the only authority for its own deployment marker.
        safe[key] = miniAgentTraceDeploymentSuffix_() || '';
        return;
      }
      if (key === 'miniVersion' || key === 'agentVersion' || key === 'osVersion') {
        safe[key] = null;
        return;
      }
      safe[key] = entry[key];
    });
    // Chain ownership is explicit: Mini stamps itself; Agent/OS markers only
    // arrive through their strict suffix allowlists above.
    safe.miniDeploymentSuffix = miniAgentTraceDeploymentSuffix_() || '';
    safe.miniVersion = null;
    safe.agentVersion = null;
    safe.osVersion = null;
    if (String(safe.clientRequestIdSuffix || '') !== String(trace.clientRequestId || '').slice(-8)) return;
    trace.agentEntries.push(safe);
  });
}

function sanitizeIncomingAgentTraceValidationField_(value) {
  const normalized = String(value || '').trim();
  // Mirrors PALURU_VALIDATION_FIELDS in paluru-agent/gas/Code.js.  These are
  // fixed field names, never caller-provided paths.
  return {
    intent: true, confidence: true, roomId: true, period: true, scope: true, operation: true,
    settings: true, 'settings.power': true, 'settings.mode': true, 'settings.fan': true,
    'settings.setpointC': true, 'settings.durationMinutes': true, overrideMinutes: true,
    needsFollowup: true, followupQuestion: true, reply: true
  }[normalized] ? normalized : '';
}

function sanitizeIncomingAgentTraceValidationReason_(value) {
  const normalized = String(value || '').trim();
  return {
    TODAY_PARURU_PERIOD_UNSUPPORTED: true,
    TODAY_PARURU_SCOPE_REQUIRED: true,
    CONTRACT_OBJECT_INVALID: true,
    CONTRACT_FIELDS_INVALID: true,
    INTENT_INVALID: true,
    CONFIDENCE_INVALID: true,
    ENUM_INVALID: true,
    TEXT_INVALID: true,
    NEEDS_FOLLOWUP_INVALID: true,
    FOLLOWUP_CONTRACT_INVALID: true,
    SETTINGS_OBJECT_INVALID: true,
    SETTINGS_FIELDS_INVALID: true,
    SETTINGS_VALUE_INVALID: true,
    UNUSED_FIELD_NOT_NULL: true,
    WEATHER_PERIOD_UNSUPPORTED: true,
    WEATHER_ROOM_REQUIRED: true,
    ROOM_REQUIRED: true,
    OPERATION_REQUIRED: true,
    SETTINGS_REQUIRED: true,
    OUTSIDE_NOT_ALLOWED: true,
    OPERATION_UNSUPPORTED: true,
    ROOM_NOT_FOUND: true,
    OVERRIDE_MINUTES_INVALID: true,
    POWER_REQUIRED: true,
    POWER_SETTINGS_CONFLICT: true,
    MODE_INVALID: true,
    FAN_INVALID: true,
    SETPOINT_REQUIRED: true,
    SETPOINT_NOT_ALLOWED: true,
    DURATION_REQUIRED: true,
    DURATION_NOT_ALLOWED: true
  }[normalized] ? normalized : '';
}

function sanitizeAgentActionTraceValue_(key, value) {
  const normalized = String(value || '').trim();
  const allowed = {
    actionSource: { confirmation_created: true, confirmation_executed: true, confirmation_rejected: true, followup_required: true, room_not_found: true, outside_not_allowed: true },
    actionResult: { OK: true, ACTION_NOT_ALLOWED: true, FOLLOWUP_REQUIRED: true, CONFIRMATION_EXPIRED: true, CONFIRMATION_ACTOR_MISMATCH: true },
    stateBefore: { OFF: true, ON: true, COOL: true, HEAT: true, AUTO: true, UNKNOWN: true },
    stateAfter: { OFF: true, ON: true, COOL: true, HEAT: true, AUTO: true, UNKNOWN: true }
  };
  return allowed[key] && allowed[key][normalized] ? normalized : '';
}

function sanitizeAgentSourceTraceValue_(key, value) {
  const text = String(value || '').trim();
  const enums = {
    sourceType: { observed: true, forecast: true, calendar: true, inbox: true, calendar_inbox: true, device_state: true, generated: true, none: true },
    sourceSystem: { switchbot: true, mini_weather: true, google_calendar: true, mini_inbox: true, automation: true, paluru_agent: true, unknown: true },
    sourceReason: { primary: true, fallback: true, unavailable: true, stale: true, invalid: true, not_applicable: true },
    freshness: { current: true, stale: true, unknown: true, not_applicable: true },
    sourceSelected: { switchbot_observed: true, forecast_fallback: true, forecast: true, weather_unavailable: true, room_climate: true, room_not_found: true, climate_invalid_response: true, today_paruru_aggregate: true, aircon_status: true, confirmation_created: true, followup_required: true, outside_not_allowed: true, confirmation_executed: true, confirmation_rejected: true },
    sourceResultCode: { OK: true, WEATHER_UNAVAILABLE: true, ROOM_NOT_FOUND: true, UPSTREAM_INVALID_RESPONSE: true, CLIMATE_UNAVAILABLE: true, ACTION_NOT_ALLOWED: true, FOLLOWUP_REQUIRED: true, CONFIRMATION_EXPIRED: true, CONFIRMATION_ACTOR_MISMATCH: true }
  };
  if (key === 'sourceFallbackUsed') return value === true;
  if (key === 'sourceObservedAt') return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/.test(text) ? text : '';
  if (key === 'sourceRecordCount' || key === 'sourceSelectedCount' || key === 'calendarRecordCount'
      || key === 'inboxRecordCount' || key === 'sourceHttpStatus') {
    const number = Number(value);
    return Number.isInteger(number) && number >= 0 ? number : '';
  }
  return enums[key] && enums[key][text] ? text : '';
}

function sanitizeAgentTraceBoundary_(value) {
  const normalized = String(value || '').trim();
  return { OpenAI: true, Canonical: true, Router: true, Service: true, Adapter: true }[normalized] ? normalized : '';
}

function sanitizeAgentTraceBoundaryValue_(field, value) {
  const normalized = String(value || '').trim();
  const allowed = {
    period: { today: true, tomorrow: true, this_week: true, next_7_days: true },
    scope: { mine: true, family: true },
    roomId: { living: true, bedroom: true, kids_room: true, outside: true },
    operation: { power: true, apply_settings: true, pause: true, resume: true }
  };
  if (field === 'value' || field === 'before' || field === 'after') {
    return Object.keys(allowed).some(function(key) { return allowed[key][normalized] === true; }) ? normalized : '';
  }
  return allowed[field] && allowed[field][normalized] ? normalized : '';
}

function miniAgentTraceDeploymentSuffix_() {
  try {
    if (typeof ScriptApp === 'undefined' || !ScriptApp.getService) return null;
    const url = String(ScriptApp.getService().getUrl() || '');
    const match = url.match(/\/s\/([^/?]+)\//);
    return sanitizeAgentDeploymentSuffix_(match ? match[1] : null) || null;
  } catch (error) {
    return null;
  }
}

function sanitizeAgentDeploymentSuffix_(value) {
  const deploymentId = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{4,}$/.test(deploymentId)) return '';
  return deploymentId.slice(-4);
}

function traceMetricNumber_(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function safeMiniAgentTraceText_(value) {
  return String(value || '').replace(/[^A-Z0-9_.-]/gi, '').slice(0, 100);
}

function sanitizeAgentPerformanceDiagnostics_(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  function number(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
  }
  return {
    routerMs: number(source.routerMs),
    serviceMs: number(source.serviceMs),
    totalMs: number(source.totalMs),
    openAiCallCount: number(source.openAiCallCount),
    serviceCallCount: number(source.serviceCallCount)
  };
}

function redactPaluruAgentUrl_(value) {
  const text = String(value || '');
  const queryIndex = text.indexOf('?');
  if (queryIndex < 0) return text;
  return text.slice(0, queryIndex) + '?[redacted]';
}

function redactPaluruAgentResponseBody_(body) {
  const text = String(body || '');
  try {
    return redactPaluruAgentTransportValue_(JSON.parse(text));
  } catch (error) {
    return '[non_json_response_omitted:length=' + text.length + ']';
  }
}

function redactPaluruAgentTransportValue_(value, keyName) {
  const key = String(keyName || '').toLowerCase();
  if (/(token|secret|authorization|api[_-]?key|password|message|memo|reply|question|summary)/.test(key)) return '[redacted]';
  if (Array.isArray(value)) return value.map(function(item) { return redactPaluruAgentTransportValue_(item); });
  if (value && typeof value === 'object') {
    return Object.keys(value).reduce(function(result, property) {
      result[property] = redactPaluruAgentTransportValue_(value[property], property);
      return result;
    }, {});
  }
  return typeof value === 'string' && value.length > 1000 ? value.slice(0, 1000) + '…' : value;
}

function annotateAgentGatewayError_(error, stage, reason) {
  const source = error instanceof Error ? error : new Error(String(error || 'Agent Gateway error'));
  if (!source.code) source.code = 'AGENT_ERROR';
  if (!source.agentDiagnostics) {
    source.agentDiagnostics = { stage: String(stage || 'AGENT_CHAT_UNHANDLED'), reason: String(reason || source.code || 'UNKNOWN') };
  }
  return source;
}

function createAgentGatewayError_(code, stage, reason, cause) {
  const error = new Error(code);
  error.code = code;
  error.agentDiagnostics = {
    stage: String(stage || 'AGENT_CHAT_UNHANDLED'),
    reason: String(reason || code || 'UNKNOWN'),
  };
  if (cause) {
    error.cause = cause;
    error.message = String(cause.message || code);
    if (cause.stack) error.stack = String(cause.stack);
  }
  return error;
}

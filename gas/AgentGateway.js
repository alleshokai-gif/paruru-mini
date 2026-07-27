const PALURU_AGENT_SCHEMA_VERSION = 'agent-chat-1.0';
const PALURU_AGENT_MAX_MESSAGE_CHARACTERS = 1000;
const PALURU_AGENT_URL_PROPERTY = 'PALURU_AGENT_URL';
const PALURU_AGENT_TOKEN_PROPERTY = 'PALURU_AGENT_TOKEN';

function agentChat_(body) {
  try {
    const actor = resolveHomeAgentReadActor_(body || {});
    const input = validateAgentChatInput_(body || {}, actor);
    const config = getPaluruAgentConfig_();
    const response = callPaluruAgent_(config, input);
    return json_(buildAgentChatSuccess_(response, input));
  } catch (error) {
    return json_(buildAgentChatError_(error));
  }
}

function agentActionConfirm_(body) {
  try {
    const input = validateAgentActionConfirmInput_(body || {});
    verifyAgentActionDevice_(input.deviceId, input.pairingToken);
    enforceAgentActionRateLimit_(input.deviceId, input.clientRequestId);
    const config = getPaluruAgentConfig_();
    const response = callPaluruAgentActionConfirm_(config, input);
    return json_(buildAgentActionConfirmSuccess_(response));
  } catch (error) {
    return json_(buildAgentActionConfirmError_(error));
  }
}

function agentActionCancel_(body) {
  try {
    const input = validateAgentActionConfirmInput_(body || {});
    verifyAgentActionDevice_(input.deviceId, input.pairingToken);
    const config = getPaluruAgentConfig_();
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

function callPaluruAgent_(config, input) {
  let response;
  try {
    response = UrlFetchApp.fetch(config.url, {
      method: 'post',
      contentType: 'text/plain;charset=utf-8',
      payload: JSON.stringify({
        action: 'agent.chat',
        message: input.message,
        sessionId: input.sessionId,
        clientRequestId: input.clientRequestId,
        actor: input.actor,
        authToken: config.token,
      }),
      muteHttpExceptions: true,
    });
  } catch (error) {
    throw createAgentGatewayError_('AGENT_UNAVAILABLE');
  }

  const status = response.getResponseCode();
  if (status < 200 || status >= 300) {
    throw createAgentGatewayError_('AGENT_UNAVAILABLE');
  }

  let parsed;
  try {
    parsed = JSON.parse(response.getContentText());
  } catch (error) {
    throw createAgentGatewayError_('AGENT_UNAVAILABLE');
  }

  if (!parsed || parsed.success !== true) {
    throw createAgentGatewayError_('AGENT_ERROR');
  }
  if (parsed.schemaVersion !== PALURU_AGENT_SCHEMA_VERSION) {
    throw createAgentGatewayError_('AGENT_ERROR');
  }
  return parsed;
}

function buildAgentChatSuccess_(response, input) {
  const data = response.data || {};
  const reply = String(data.reply || '').trim();
  if (!reply) {
    throw createAgentGatewayError_('AGENT_ERROR');
  }

  const result = {
    success: true,
    reply: reply,
    sessionId: input.sessionId,
    clientRequestId: input.clientRequestId,
    toolExecutions: sanitizeToolExecutions_(data.toolExecutions),
    usage: sanitizeAgentUsage_(data.usage),
  };
  if (Object.prototype.hasOwnProperty.call(data, 'followup')) {
    result.followup = sanitizeAgentFollowup_(data.followup);
  }
  if (Object.prototype.hasOwnProperty.call(data, 'actionConfirmation')) {
    result.actionConfirmation = sanitizeAgentActionConfirmation_(data.actionConfirmation);
  }
  return result;
}

function validateAgentActionConfirmInput_(body) {
  const confirmationId = String(body.confirmationId || '').trim();
  const clientRequestId = String(body.clientRequestId || '').trim();
  const deviceId = String(body.deviceId || '').trim().slice(0, 200);
  const pairingToken = String(body.pairingToken || '');
  if (!isUuid_(confirmationId) || !isUuid_(clientRequestId) || !deviceId) {
    throw createAgentGatewayError_('INVALID_INPUT');
  }
  return {
    confirmationId: confirmationId,
    clientRequestId: clientRequestId,
    deviceId: deviceId,
    pairingToken: pairingToken
  };
}

function verifyAgentActionDevice_(deviceId, pairingToken) {
  const deps = getHomeAgentActionDependencies_();
  assertHomeAgentActionsEnabled_(deps);
  verifyHomeAgentDevicePairing_(deviceId, pairingToken, deps);
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

function callPaluruAgentActionConfirm_(config, input) {
  let response;
  try {
    response = UrlFetchApp.fetch(config.url, {
      method: 'post',
      contentType: 'text/plain;charset=utf-8',
      payload: JSON.stringify({
        action: 'agent.confirmAction',
        confirmationId: input.confirmationId,
        clientRequestId: input.clientRequestId,
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
    throw createAgentGatewayError_('AGENT_ERROR');
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
    throw createAgentGatewayError_('AGENT_ERROR');
  }
  return parsed;
}

function sanitizeAgentFollowup_(followup) {
  if (!followup || Array.isArray(followup) || typeof followup !== 'object') {
    throw createAgentGatewayError_('AGENT_ERROR');
  }
  const itemId = String(followup.itemId || '').trim();
  const question = String(followup.question || '').trim();
  const inputType = String(followup.inputType || '').trim();
  const allowedTypes = { date: true, datetime: true, time: true, text: true, yesno: true };
  if (followup.required !== true || !isUuid_(itemId) || !question
      || Array.from(question).length > 300 || !allowedTypes[inputType]) {
    throw createAgentGatewayError_('AGENT_ERROR');
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
    throw createAgentGatewayError_('AGENT_ERROR');
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
    throw createAgentGatewayError_('AGENT_ERROR');
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
    HOME_AGENT_ACTIONS_DISABLED: true,
    AGENT_ACTION_RATE_LIMITED: true,
  };
  const code = error && allowedCodes[error.code] ? error.code : 'INTERNAL_ERROR';
  return { success: false, error: { code: code, message: getAgentActionPublicErrorMessage_(code) } };
}

function getAgentActionPublicErrorMessage_(code) {
  if (code === 'HOME_AGENT_ACTIONS_DISABLED') return 'home agent operations are disabled';
  if (code === 'UNAUTHORIZED_DEVICE') return 'device authentication failed';
  if (code === 'AGENT_ACTION_RATE_LIMITED') return 'too many action requests';
  if (code === 'CONFIGURATION_ERROR') return 'Agent connection is not configured';
  if (code === 'AGENT_UNAVAILABLE') return 'Agent is unavailable';
  return 'action confirmation failed';
}

function sanitizeToolExecutions_(executions) {
  if (!Array.isArray(executions)) return [];
  return executions.map(function(execution) {
    return {
      tool: String(execution && execution.tool || ''),
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
  };
  const code = error && allowedCodes[error.code] ? error.code : 'INTERNAL_ERROR';
  const messages = {
    INVALID_INPUT: '入力内容を確認してください。',
    CONFIGURATION_ERROR: 'Agent接続設定が未完了です。',
    AGENT_UNAVAILABLE: '現在Agentへ接続できません。',
    AGENT_ERROR: 'Agentの処理を完了できませんでした。',
    INTERNAL_ERROR: '内部エラーが発生しました。',
  };
  return { success: false, error: { code: code, message: messages[code] } };
}

function createAgentGatewayError_(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

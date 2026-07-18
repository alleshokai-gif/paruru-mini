const PALURU_AGENT_SCHEMA_VERSION = 'agent-chat-1.0';
const PALURU_AGENT_MAX_MESSAGE_CHARACTERS = 1000;
const PALURU_AGENT_URL_PROPERTY = 'PALURU_AGENT_URL';
const PALURU_AGENT_TOKEN_PROPERTY = 'PALURU_AGENT_TOKEN';

function agentChat_(body) {
  try {
    const input = validateAgentChatInput_(body || {});
    const config = getPaluruAgentConfig_();
    const response = callPaluruAgent_(config, input);
    return json_(buildAgentChatSuccess_(response, input));
  } catch (error) {
    return json_(buildAgentChatError_(error));
  }
}

function validateAgentChatInput_(body) {
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

  return {
    success: true,
    reply: reply,
    sessionId: input.sessionId,
    clientRequestId: input.clientRequestId,
    toolExecutions: sanitizeToolExecutions_(data.toolExecutions),
    usage: sanitizeAgentUsage_(data.usage),
  };
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

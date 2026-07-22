'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const gasDir = path.join(root, 'gas');
const files = ['Code.js', 'AgentGateway.js'];
const properties = {};
const logs = [];
let fetchImpl = () => { throw new Error('live network forbidden'); };

const context = {
  console: { log: (...args) => logs.push(args.join(' ')) },
  Date, JSON, Math, Number, Object, Array, String, RegExp, Error,
  PropertiesService: {
    getScriptProperties: () => ({ getProperty: (name) => properties[name] || '' }),
  },
  UrlFetchApp: { fetch: (...args) => fetchImpl(...args) },
  ContentService: {
    MimeType: { JSON: 'application/json' },
    createTextOutput: (text) => ({
      text,
      setMimeType() { return this; },
      getContent() { return this.text; },
    }),
  },
};
vm.createContext(context);
new vm.Script(files.map((name) => fs.readFileSync(path.join(gasDir, name), 'utf8')).join('\n')).runInContext(context);

const sessionId = '550e8400-e29b-41d4-a716-446655440000';
const clientRequestId = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';
const secretUrl = 'https://agent.example.invalid/private';
const secretToken = 'SECRET_AGENT_TOKEN';
const secretMessage = '書斎暑い？';

function output(response) { return JSON.parse(response.getContent()); }
function post(body) {
  return output(context.doPost({ postData: { contents: JSON.stringify(body) } }));
}
function valid(overrides) {
  return Object.assign({ action: 'agentChat', message: secretMessage, sessionId, clientRequestId }, overrides || {});
}
function agentResponse(reply, toolExecutions) {
  return {
    success: true,
    schemaVersion: 'agent-chat-1.0',
    requestId: 'internal-agent-request-id',
    data: {
      reply,
      toolExecutions: toolExecutions || [],
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      rawToolData: { temperature: 28.3 },
    },
  };
}
function mockFetch(status, body, onCall) {
  fetchImpl = (url, options) => {
    if (onCall) onCall(url, options);
    return { getResponseCode: () => status, getContentText: () => typeof body === 'string' ? body : JSON.stringify(body) };
  };
}
function configure() { properties.PALURU_AGENT_URL = secretUrl; properties.PALURU_AGENT_TOKEN = secretToken; }
function reset() { Object.keys(properties).forEach((key) => delete properties[key]); logs.length = 0; fetchImpl = () => { throw new Error('live network forbidden'); }; }
function assert(value, message) { if (!value) throw new Error(message); }

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('tool-free response', () => {
  configure();
  mockFetch(200, agentResponse('今日は土曜日やで。'), (url, options) => {
    const sent = JSON.parse(options.payload);
    assert(url === secretUrl && sent.authToken === secretToken, 'server credentials not used');
    assert(options.contentType === 'text/plain;charset=utf-8', 'wrong content type');
    assert(!('userId' in sent) && sent.action === 'agent.chat', 'wrong upstream contract');
    assert(sent.actor.userId === 'father' && sent.actor.deviceId === 'device', 'actor not forwarded');
  });
  const result = post(valid({ userId: 'father', userDisplayName: '父', deviceId: 'device' }));
  assert(result.success && result.reply && result.toolExecutions.length === 0, 'tool-free response failed');
});

test('climate tool response is sanitized', () => {
  configure();
  mockFetch(200, agentResponse('書斎はちょい暑いで。', [{ tool: 'get_home_climate_context', status: 'success', durationMs: 9451, raw: { temperature: 28.3 } }]));
  const result = post(valid());
  assert(result.toolExecutions[0].durationMs === 9451, 'tool audit missing');
  assert(!JSON.stringify(result).includes('28.3') && !JSON.stringify(result).includes('internal-agent-request-id'), 'internal data leaked');
  assert(!Object.prototype.hasOwnProperty.call(result, 'followup'), 'climate response contract changed');
});

test('structured followup is allowlisted for PWA', () => {
  configure();
  const response = agentResponse('覚えたで。締切はいつ？', [{ tool: 'create_memo', status: 'success', durationMs: 20 }]);
  response.data.followup = {
    required: true,
    itemId: '77777777-7777-4777-8777-777777777777',
    question: '締切はいつ？',
    inputType: 'date',
    actor: { userId: 'father' },
    source: 'paluru-agent',
    rawToolResult: { secret: secretToken }
  };
  mockFetch(200, response);
  const result = post(valid());
  assert(JSON.stringify(result.followup) === JSON.stringify({ required: true, itemId: '77777777-7777-4777-8777-777777777777', question: '締切はいつ？', inputType: 'date' }), 'followup allowlist failed');
  assert(!JSON.stringify(result).includes(secretToken) && !JSON.stringify(result).includes('rawToolResult'), 'followup leaked internal fields');
});

test('malformed followup is rejected safely', () => {
  configure();
  const cases = [
    { required: true, itemId: 'bad', question: 'いつ？', inputType: 'date' },
    { required: true, itemId: '77777777-7777-4777-8777-777777777777', question: '', inputType: 'date' },
    { required: true, itemId: '77777777-7777-4777-8777-777777777777', question: 'いつ？', inputType: 'html' }
  ];
  cases.forEach((followup) => {
    const response = agentResponse('reply'); response.data.followup = followup; mockFetch(200, response);
    assert(post(valid()).error.code === 'AGENT_ERROR', 'malformed followup accepted');
  });
});

test('tool-free response remains without followup field', () => {
  configure(); mockFetch(200, agentResponse('こんにちは。'));
  const result = post(valid());
  assert(!Object.prototype.hasOwnProperty.call(result, 'followup'), 'tool-free response contract changed');
});

test('missing URL and token', () => {
  let result = post(valid());
  assert(result.error.code === 'CONFIGURATION_ERROR', 'missing URL accepted');
  properties.PALURU_AGENT_URL = secretUrl;
  result = post(valid());
  assert(result.error.code === 'CONFIGURATION_ERROR', 'missing token accepted');
});

test('HTTP and invalid JSON map to unavailable', () => {
  configure();
  fetchImpl = () => { throw new Error('network details must stay internal'); };
  assert(post(valid()).error.code === 'AGENT_UNAVAILABLE', 'fetch failure leaked');
  mockFetch(503, 'down');
  assert(post(valid()).error.code === 'AGENT_UNAVAILABLE', 'HTTP error leaked');
  mockFetch(200, 'not-json');
  assert(post(valid()).error.code === 'AGENT_UNAVAILABLE', 'invalid JSON leaked');
});

test('Agent error and schema mismatch are hidden', () => {
  configure();
  mockFetch(200, { success: false, error: { code: 'UNAUTHORIZED', message: secretToken } });
  assert(post(valid()).error.code === 'AGENT_ERROR', 'Agent error exposed');
  const wrongSchema = agentResponse('reply'); wrongSchema.schemaVersion = 'unexpected';
  mockFetch(200, wrongSchema);
  assert(post(valid()).error.code === 'AGENT_ERROR', 'schema mismatch accepted');
});

test('invalid input', () => {
  [valid({ message: '   ' }), valid({ message: 'あ'.repeat(1001) }), valid({ sessionId: 'bad' }), valid({ clientRequestId: 'bad' })].forEach((body) => {
    assert(post(body).error.code === 'INVALID_INPUT', 'invalid input accepted');
  });
});

test('no secret, URL, message, or raw data in logs and response', () => {
  configure();
  mockFetch(200, { success: false, error: { message: secretMessage + secretToken + secretUrl } });
  const result = post(valid());
  const exposed = JSON.stringify(result) + logs.join('\n');
  assert(!exposed.includes(secretToken) && !exposed.includes(secretUrl) && !exposed.includes(secretMessage), 'sensitive data leaked');
});

test('agentChat never falls through to memo creation', () => {
  let createCalls = 0;
  context.createItem_ = () => { createCalls += 1; throw new Error('unexpected create'); };
  const result = post(valid());
  assert(result.error.code === 'CONFIGURATION_ERROR' && createCalls === 0, 'agentChat fell through');
});

test('existing action routing regression', () => {
  context.createItemWithAI_ = () => context.json_({ route: 'createWithAI' });
  context.answerFollowup_ = () => context.json_({ route: 'answerFollowup' });
  context.listInboxItems_ = () => ['item'];
  context.notificationCandidates_ = () => context.json_({ route: 'notificationCandidates' });
  assert(post({ action: 'createWithAI', memo: 'x' }).route === 'createWithAI', 'createWithAI route changed');
  assert(post({ action: 'answerFollowup', id: 'x', answer: 'y' }).route === 'answerFollowup', 'answerFollowup route changed');
  assert(output(context.doGet({ parameter: { action: 'list' } })).data[0] === 'item', 'list route changed');
  assert(output(context.doGet({ parameter: { action: 'notificationCandidates' } })).route === 'notificationCandidates', 'notification route changed');
});

test('unknown device pairing action never falls through to memo creation', () => {
  const result = post({ action: 'devicePairingUnexpected', memo: secretMessage });
  assert(result.success === false && result.error.code === 'UNSUPPORTED_DEVICE_PAIRING_ACTION', 'device pairing action fell through to memo creation');
});

test('agentChat forwards structured actionConfirmation only', () => {
  configure();
  const response = agentResponse('寝室の自動制御を1時間停止するで。実行してええ？');
  response.data.actionConfirmation = {
    required: true,
    confirmationId: '88888888-8888-4888-8888-888888888888',
    command: 'automation.pause',
    roomLabel: '寝室',
    summary: '寝室の自動制御を60分停止します',
    expiresAt: '2026-07-19T21:05:00+09:00',
    payload: { roomId: 'bedroom', durationMinutes: 60 },
    token: secretToken,
  };
  mockFetch(200, response);
  const result = post(valid());
  assert(result.success && result.actionConfirmation.required === true, 'action confirmation missing');
  assert(!JSON.stringify(result).includes('bedroom') && !JSON.stringify(result).includes(secretToken), 'raw confirmation leaked');
});

test('aircon actionConfirmation uses the same allowlist without exposing command internals', () => {
  configure();
  const response = agentResponse('確認するで。');
  response.data.actionConfirmation = {
    required: true,
    confirmationId: '88888888-8888-4888-8888-888888888888',
    command: 'aircon.applySettings',
    roomLabel: 'リビング',
    summary: 'リビングを冷房25℃に変更します',
    expiresAt: '2026-07-19T21:05:00+09:00',
    commandId: 'private-command', currentState: { deviceId: 'private-device' }
  };
  mockFetch(200, response);
  const result = post(valid());
  assert(result.success && result.actionConfirmation.command === 'aircon.applySettings', 'aircon confirmation rejected');
  const exposed = JSON.stringify(result);
  assert(!exposed.includes('private-command') && !exposed.includes('private-device'), 'aircon internals leaked');
});

test('agentActionConfirm verifies pairing before calling Agent', () => {
  configure();
  let agentCalls = 0;
  context.getHomeAgentActionDependencies_ = () => ({});
  context.assertHomeAgentActionsEnabled_ = () => {};
  context.verifyHomeAgentDevicePairing_ = (deviceId, pairingToken) => {
    assert(deviceId === 'device-1' && pairingToken === 'pairing-token-placeholder-000000000001', 'pairing input changed');
  };
  context.CacheService = { getScriptCache: () => ({ get: () => null, put: () => {} }) };
  mockFetch(200, {
    success: true,
    schemaVersion: 'agent-chat-1.0',
    data: {
      status: 'completed',
      command: 'automation.pause',
      operation: 'pause',
      roomLabel: '寝室',
      observed: { pause: { status: 'paused', pausedUntil: '2026-07-19T22:00:00+09:00' } }
    }
  }, (url, options) => {
    agentCalls += 1;
    const sent = JSON.parse(options.payload);
    assert(sent.action === 'agent.confirmAction', 'wrong Agent action');
    assert(!Object.prototype.hasOwnProperty.call(sent, 'pairingToken'), 'pairing token sent to Agent');
    assert(!Object.prototype.hasOwnProperty.call(sent, 'operation'), 'operation sent from browser to Agent');
  });
  const result = post({
    action: 'agentActionConfirm',
    confirmationId: '88888888-8888-4888-8888-888888888888',
    clientRequestId,
    deviceId: 'device-1',
    pairingToken: 'pairing-token-placeholder-000000000001',
  });
  assert(result.success && agentCalls === 1 && result.operation === 'pause', 'confirm failed');
});

test('agentActionConfirm kill switch and pairing failures short-circuit Agent', () => {
  configure();
  let agentCalls = 0;
  mockFetch(200, agentResponse('not used'), () => { agentCalls += 1; });
  context.getHomeAgentActionDependencies_ = () => ({});
  context.assertHomeAgentActionsEnabled_ = () => { const error = new Error('disabled'); error.code = 'HOME_AGENT_ACTIONS_DISABLED'; throw error; };
  context.verifyHomeAgentDevicePairing_ = () => {};
  let result = post({
    action: 'agentActionConfirm',
    confirmationId: '88888888-8888-4888-8888-888888888888',
    clientRequestId,
    deviceId: 'device-1',
    pairingToken: 'pairing-token-placeholder-000000000001',
  });
  assert(result.error.code === 'HOME_AGENT_ACTIONS_DISABLED' && agentCalls === 0, 'kill switch did not short-circuit');
  context.assertHomeAgentActionsEnabled_ = () => {};
  context.verifyHomeAgentDevicePairing_ = () => { const error = new Error('bad'); error.code = 'UNAUTHORIZED_DEVICE'; throw error; };
  result = post({
    action: 'agentActionConfirm',
    confirmationId: '88888888-8888-4888-8888-888888888888',
    clientRequestId,
    deviceId: 'device-1',
    pairingToken: 'bad-token',
  });
  assert(result.error.code === 'UNAUTHORIZED_DEVICE' && agentCalls === 0, 'pairing failure reached Agent');
});

test('agentActionCancel verifies pairing and sends only confirmation identifiers', () => {
  configure();
  let agentCalls = 0;
  context.getHomeAgentActionDependencies_ = () => ({});
  context.assertHomeAgentActionsEnabled_ = () => {};
  context.verifyHomeAgentDevicePairing_ = (deviceId, pairingToken) => {
    assert(deviceId === 'device-1' && pairingToken === 'pairing-token-placeholder-000000000001', 'pairing input changed');
  };
  mockFetch(200, {
    success: true,
    schemaVersion: 'agent-chat-1.0',
    data: {
      status: 'cancelled',
      command: 'automation.pause',
      operation: 'pause',
      roomLabel: '寝室',
      cancelled: true,
    },
  }, (url, options) => {
    agentCalls += 1;
    const sent = JSON.parse(options.payload);
    assert(sent.action === 'agent.cancelAction', 'wrong Agent action');
    assert(sent.confirmationId === '88888888-8888-4888-8888-888888888888', 'confirmation id missing');
    assert(sent.clientRequestId === clientRequestId, 'clientRequestId missing');
    assert(!Object.prototype.hasOwnProperty.call(sent, 'pairingToken'), 'pairing token sent to Agent');
    ['operation', 'skill', 'roomId', 'duration', 'durationMinutes', 'confirmed', 'payload'].forEach((field) => {
      assert(!Object.prototype.hasOwnProperty.call(sent, field), field + ' leaked to Agent cancel');
    });
  });
  const result = post({
    action: 'agentActionCancel',
    confirmationId: '88888888-8888-4888-8888-888888888888',
    clientRequestId,
    deviceId: 'device-1',
    pairingToken: 'pairing-token-placeholder-000000000001',
    operation: 'resume',
    roomId: 'living',
    durationMinutes: 1,
    confirmed: true,
  });
  assert(result.success && result.status === 'cancelled' && agentCalls === 1, 'cancel failed');
});

test('agentActionCancel kill switch short-circuits Agent', () => {
  configure();
  let agentCalls = 0;
  mockFetch(200, agentResponse('not used'), () => { agentCalls += 1; });
  context.getHomeAgentActionDependencies_ = () => ({});
  context.assertHomeAgentActionsEnabled_ = () => { const error = new Error('disabled'); error.code = 'HOME_AGENT_ACTIONS_DISABLED'; throw error; };
  context.verifyHomeAgentDevicePairing_ = () => {};
  const result = post({
    action: 'agentActionCancel',
    confirmationId: '88888888-8888-4888-8888-888888888888',
    clientRequestId,
    deviceId: 'device-1',
    pairingToken: 'pairing-token-placeholder-000000000001',
  });
  assert(result.error.code === 'HOME_AGENT_ACTIONS_DISABLED' && agentCalls === 0, 'cancel kill switch did not short-circuit');
});

test('JavaScript and manifest parse', () => {
  fs.readdirSync(gasDir).filter((name) => name.endsWith('.js')).forEach((name) => new vm.Script(fs.readFileSync(path.join(gasDir, name), 'utf8'), { filename: name }));
  const manifest = JSON.parse(fs.readFileSync(path.join(gasDir, 'appsscript.json'), 'utf8'));
  assert(manifest.timeZone === 'Asia/Tokyo' && manifest.runtimeVersion === 'V8', 'manifest invalid');
});

let failures = 0;
tests.forEach((item) => {
  reset();
  try { item.fn(); console.log('PASS ' + item.name); }
  catch (error) { failures += 1; console.error('FAIL ' + item.name + ': ' + error.message); }
});
if (failures) process.exitCode = 1;
else console.log('PASS all ' + tests.length + ' tests');

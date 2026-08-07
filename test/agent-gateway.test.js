'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const gasDir = path.join(root, 'gas');
const files = ['Code.js', 'AgentTraceLogService.js', 'AgentGateway.js'];
const properties = {};
const logs = [];
let traceSheet = null;
let fetchImpl = () => { throw new Error('live network forbidden'); };
let readActor = null;
let readActorError = null;
let readActorCalls = 0;
let controlActor = null;
let controlActorError = null;
let controlActorCalls = 0;

function createTraceSheet() {
  const sheet = {
    headers: [],
    rows: [],
    getLastColumn() { return this.headers.length; },
    getLastRow() { return this.headers.length ? this.rows.length + 1 : 0; },
    getRange(row, column, numRows, numColumns) {
      return {
        getValues: () => {
          if (row === 1) return [Array.from({ length: numColumns }, (_, index) => sheet.headers[column - 1 + index] || '')];
          return [];
        },
        setValues: (values) => {
          if (row === 1) {
            values[0].forEach((value, index) => { sheet.headers[column - 1 + index] = value; });
          } else {
            values.forEach((value) => sheet.rows.push(value.slice()));
          }
        }
      };
    },
    setFrozenRows() {}
  };
  return sheet;
}

const context = {
  console: { log: (...args) => logs.push(args.join(' ')) },
  Logger: { log: (...args) => logs.push(args.join(' ')) },
  Date, JSON, Math, Number, Object, Array, String, RegExp, Error,
  PropertiesService: {
    getScriptProperties: () => ({ getProperty: (name) => properties[name] || '' }),
  },
  UrlFetchApp: { fetch: (...args) => fetchImpl(...args) },
  SpreadsheetApp: {
    getActiveSpreadsheet: () => ({
      getSheetByName: () => traceSheet,
      insertSheet: () => { traceSheet = createTraceSheet(); return traceSheet; }
    })
  },
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
context.resolveHomeAgentReadActor_ = () => {
  readActorCalls += 1;
  if (readActorError) throw Object.assign(new Error(readActorError), { code: readActorError });
  return readActor || {
    homeId: 'home-a', memberUserId: 'father', displayName: '父', role: 'admin',
    capabilities: ['home.read', 'home.control'], deviceId: 'server-device',
  };
};
context.resolveHomeAgentControlActor_ = () => {
  controlActorCalls += 1;
  if (controlActorError) throw Object.assign(new Error(controlActorError), { code: controlActorError });
  if (typeof controlActor === 'function') return controlActor(controlActorCalls);
  return controlActor || {
    homeId: 'home-a', memberUserId: 'father', displayName: '父', role: 'admin',
    capabilities: ['home.read', 'home.control'], deviceId: 'server-control-device',
  };
};

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
function agentResponse(reply, serviceExecutions) {
  return {
    success: true,
    schemaVersion: 'agent-chat-1.0',
    requestId: 'internal-agent-request-id',
    data: {
      reply,
      serviceExecutions: serviceExecutions || [],
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
function reset() { Object.keys(properties).forEach((key) => delete properties[key]); logs.length = 0; traceSheet = null; fetchImpl = () => { throw new Error('live network forbidden'); }; readActor = null; readActorError = null; readActorCalls = 0; controlActor = null; controlActorError = null; controlActorCalls = 0; }
function assert(value, message) { if (!value) throw new Error(message); }

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('tool-free response', () => {
  configure();
  mockFetch(200, agentResponse('今日は土曜日やで。'), (url, options) => {
    const sent = JSON.parse(options.payload);
    assert(url === secretUrl && sent.authToken === secretToken, 'server credentials not used');
    assert(options.contentType === 'text/plain;charset=utf-8', 'wrong content type');
    assert(sent.clientRequestId === clientRequestId, 'clientRequestId did not reach Agent unchanged');
    assert(!('userId' in sent) && sent.action === 'agent.chat', 'wrong upstream contract');
    assert(sent.actor.memberUserId === 'father' && sent.actor.displayName === '父' && sent.actor.deviceId === 'server-device', 'server actor not forwarded');
    assert(!Object.prototype.hasOwnProperty.call(sent.actor, 'userId') && !Object.prototype.hasOwnProperty.call(sent, 'pairingToken'), 'client actor or pairing token leaked downstream');
  });
  const result = post(valid({ userId: 'father', userDisplayName: '父', deviceId: 'device' }));
  assert(result.success && result.reply && result.serviceExecutions.length === 0, 'service-free response failed');
});

test('Mini persists a safe combined trace ledger without exposing it to PWA', () => {
  configure();
  const upstream = agentResponse('private-agent-reply');
  upstream.traceEvents = [{
    event: 'OPENAI_REQUEST_FAILED', clientRequestIdSuffix: clientRequestId.slice(-8),
    deploymentId: 'agent-deployment', version: 'v1', action: 'agent.chat', httpStatus: 503,
    errorCode: 'AGENT_UNAVAILABLE', stage: 'OPENAI_REQUEST', reason: 'UPSTREAM_HTTP_503',
    elapsedMs: 12, openAiCallCount: 1, serviceCallCount: 0, intent: '', service: '',
    openAiErrorType: 'invalid_request_error', openAiErrorCode: 'invalid_json_schema',
    openAiErrorMessage: 'Invalid schema; sk-test-secret-123456789 must not be logged.',
    validationField: 'period', validationReason: 'TODAY_PARURU_PERIOD_UNSUPPORTED'
  }];
  mockFetch(200, upstream);
  const result = post(valid());
  assert(result.success && !Object.prototype.hasOwnProperty.call(result, 'traceEvents'), 'internal Agent trace leaked to PWA');
  assert(traceSheet && traceSheet.headers[0] === 'recordedAt', 'trace ledger header was not created');
  const sourceColumn = traceSheet.headers.indexOf('source');
  const suffixColumn = traceSheet.headers.indexOf('clientRequestIdSuffix');
  assert(traceSheet.rows.some((row) => row[sourceColumn] === 'mini'), 'Mini trace rows were not stored');
  assert(traceSheet.rows.some((row) => row[sourceColumn] === 'agent'), 'Agent trace rows were not stored');
  assert(traceSheet.rows.every((row) => row[suffixColumn] === clientRequestId.slice(-8)), 'trace ledger request suffix changed');
  const openAiTypeColumn = traceSheet.headers.indexOf('openAiErrorType');
  const openAiCodeColumn = traceSheet.headers.indexOf('openAiErrorCode');
  const openAiMessageColumn = traceSheet.headers.indexOf('openAiErrorMessage');
  const openAi400Row = traceSheet.rows.find((row) => row[sourceColumn] === 'agent');
  assert(openAiTypeColumn >= 0 && openAiCodeColumn >= 0 && openAiMessageColumn >= 0, 'OpenAI 400 trace columns were not created');
  assert(openAi400Row[openAiTypeColumn] === 'invalid_request_error' && openAi400Row[openAiCodeColumn] === 'invalid_json_schema', 'OpenAI 400 type/code were not persisted');
  assert(openAi400Row[openAiMessageColumn] === 'Invalid schema; [REDACTED] must not be logged.', 'OpenAI 400 message was not safely persisted');
  const validationFieldColumn = traceSheet.headers.indexOf('validationField');
  const validationReasonColumn = traceSheet.headers.indexOf('validationReason');
  assert(validationFieldColumn >= 0 && validationReasonColumn >= 0, 'validation trace columns were not created');
  assert(openAi400Row[validationFieldColumn] === 'period' && openAi400Row[validationReasonColumn] === 'TODAY_PARURU_PERIOD_UNSUPPORTED', 'validation trace values were not persisted');
  const serialized = JSON.stringify(traceSheet.rows);
  assert(!serialized.includes(secretMessage) && !serialized.includes('private-agent-reply') && !serialized.includes(secretToken) && !serialized.includes('server-device') && !serialized.includes('sk-test-secret-123456789'), 'trace ledger stored private data');
});

test('Mini appends validation trace headers without changing existing trace rows', () => {
  reset();
  traceSheet = createTraceSheet();
  const legacyHeaders = vm.runInContext('PALURU_AGENT_TRACE_HEADERS.slice(0, -2)', context);
  traceSheet.headers = Array.from(legacyHeaders);
  traceSheet.rows = [legacyHeaders.map(() => 'prior-row')];
  context.__legacyTrace = {
    entries: [{ event: 'REQUEST_RECEIVED', clientRequestIdSuffix: clientRequestId.slice(-8), action: 'agentChat' }],
    agentEntries: []
  };
  vm.runInContext('persistAgentTrace_(__legacyTrace)', context);
  const expectedHeaders = vm.runInContext('PALURU_AGENT_TRACE_HEADERS', context);
  assert(JSON.stringify(traceSheet.headers) === JSON.stringify(expectedHeaders), 'new trace headers were not appended in order');
  assert(traceSheet.rows[0][0] === 'prior-row', 'existing trace row was changed');
  assert(traceSheet.rows.length === 2, 'new trace row was not appended after the existing row');
});

test('Mini does not duplicate existing validation trace headers', () => {
  reset();
  traceSheet = createTraceSheet();
  const expectedHeaders = vm.runInContext('PALURU_AGENT_TRACE_HEADERS', context);
  traceSheet.headers = Array.from(expectedHeaders);
  traceSheet.rows = [expectedHeaders.map(() => 'prior-row')];
  context.__existingHeaderTrace = {
    entries: [{ event: 'REQUEST_RECEIVED', clientRequestIdSuffix: clientRequestId.slice(-8), action: 'agentChat' }],
    agentEntries: []
  };
  vm.runInContext('persistAgentTrace_(__existingHeaderTrace)', context);
  assert(JSON.stringify(traceSheet.headers) === JSON.stringify(expectedHeaders), 'existing trace headers were duplicated or reordered');
  assert(traceSheet.rows[0][0] === 'prior-row', 'existing trace row was changed');
});

test('Mini keeps only allowlisted validation trace values', () => {
  reset();
  const trace = { clientRequestId, agentEntries: [] };
  vm.runInContext(`appendAgentTraceEntries_(__validationTrace, [{
    event: 'INTENT_VALIDATION_FAILED', clientRequestIdSuffix: '${clientRequestId.slice(-8)}',
    validationField: 'period', validationReason: 'TODAY_PARURU_PERIOD_UNSUPPORTED'
  }, {
    event: 'INTENT_VALIDATION_FAILED', clientRequestIdSuffix: '${clientRequestId.slice(-8)}',
    validationField: 'private-user-input', validationReason: 'private reply text'
  }])`, Object.assign(context, { __validationTrace: trace }));
  assert(trace.agentEntries[0].validationField === 'period', 'allowlisted validation field was dropped');
  assert(trace.agentEntries[0].validationReason === 'TODAY_PARURU_PERIOD_UNSUPPORTED', 'allowlisted validation reason was dropped');
  assert(trace.agentEntries[1].validationField === '' && trace.agentEntries[1].validationReason === '', 'free-form validation data was retained');
});

test('Mini retains allowlisted Aircon validation trace values at ingress and persistence', () => {
  reset();
  const trace = { clientRequestId, agentEntries: [] };
  vm.runInContext(`appendAgentTraceEntries_(__airconValidationTrace, [{
    event: 'INTENT_VALIDATION_FAILED', clientRequestIdSuffix: '${clientRequestId.slice(-8)}',
    validationField: 'settings', validationReason: 'SETTINGS_REQUIRED'
  }, {
    event: 'INTENT_VALIDATION_FAILED', clientRequestIdSuffix: '${clientRequestId.slice(-8)}',
    validationField: 'private-field', validationReason: 'private reason text'
  }])`, Object.assign(context, { __airconValidationTrace: trace }));
  assert(trace.agentEntries[0].validationField === 'settings', 'Aircon validation field was dropped at Mini ingress');
  assert(trace.agentEntries[0].validationReason === 'SETTINGS_REQUIRED', 'Aircon validation reason was dropped at Mini ingress');
  assert(trace.agentEntries[1].validationField === '' && trace.agentEntries[1].validationReason === '', 'unsafe validation values were retained');
  traceSheet = createTraceSheet();
  context.__airconValidationPersistTrace = { entries: [], agentEntries: trace.agentEntries };
  vm.runInContext('persistAgentTrace_(__airconValidationPersistTrace)', context);
  const fieldColumn = traceSheet.headers.indexOf('validationField');
  const reasonColumn = traceSheet.headers.indexOf('validationReason');
  assert(traceSheet.rows[0][fieldColumn] === 'settings' && traceSheet.rows[0][reasonColumn] === 'SETTINGS_REQUIRED', 'Aircon validation values were not persisted');
});

test('Mini persists only allowlisted boundary trace fields and the append-only header tail', () => {
  reset();
  const trace = { clientRequestId, agentEntries: [] };
  vm.runInContext(`appendAgentTraceEntries_(__boundaryTrace, [{
    event: 'BOUNDARY_TRACE', clientRequestIdSuffix: '${clientRequestId.slice(-8)}',
    boundary: 'Adapter', boundaryHash: '87f263e1', period: 'tomorrow', scope: 'mine', roomId: 'living', operation: 'power',
    field: 'roomId', value: 'living', before: 'living', after: 'living', privateText: 'must-not-persist'
  }])`, Object.assign(context, { __boundaryTrace: trace }));
  assert(trace.agentEntries.length === 1, 'boundary trace was dropped');
  const entry = trace.agentEntries[0];
  assert(entry.boundary === 'Adapter' && entry.boundaryHash === '87f263e1', 'boundary identity was not retained');
  assert(entry.period === 'tomorrow' && entry.scope === 'mine' && entry.roomId === 'living' && entry.operation === 'power', 'safe boundary fields were not retained');
  assert(!Object.prototype.hasOwnProperty.call(entry, 'privateText'), 'free text was retained in boundary trace');
  traceSheet = createTraceSheet();
  context.__boundaryPersistTrace = { entries: [], agentEntries: trace.agentEntries };
  vm.runInContext('persistAgentTrace_(__boundaryPersistTrace)', context);
  ['period', 'scope', 'roomId', 'operation', 'boundary', 'boundaryHash', 'from', 'field', 'value', 'before', 'after'].forEach((header) => {
    assert(traceSheet.headers.indexOf(header) >= 0, 'missing trace header: ' + header);
  });
  const roomColumn = traceSheet.headers.indexOf('roomId');
  assert(traceSheet.rows[0][roomColumn] === 'living', 'roomId was not persisted');
});

test('Mini preserves only allowlisted Source Trace fields in the append-only header tail', () => {
  reset();
  const trace = { clientRequestId, agentEntries: [] };
  vm.runInContext(`appendAgentTraceEntries_(__sourceTrace, [{
    event: 'SOURCE_SELECTED', clientRequestIdSuffix: '${clientRequestId.slice(-8)}',
    sourceType: 'observed', sourceSystem: 'switchbot', sourceReason: 'primary', freshness: 'current',
    sourceSelected: 'room_climate', sourceFallbackUsed: false, sourceObservedAt: '2026-08-05T09:00:00+09:00',
    sourceRecordCount: 3, sourceSelectedCount: 1, calendarRecordCount: 2, inboxRecordCount: 1, sourceHttpStatus: 200, sourceResultCode: 'OK',
    privateText: 'must-not-persist', sourceUrl: 'https://private.example'
  }, {
    event: 'SOURCE_SELECTED', clientRequestIdSuffix: '${clientRequestId.slice(-8)}',
    sourceSelected: 'private free text', sourceResultCode: 'private_error', sourceObservedAt: 'not-a-date'
  }])`, Object.assign(context, { __sourceTrace: trace }));
  assert(trace.agentEntries[0].sourceSelected === 'room_climate', 'allowlisted Source Trace value was dropped');
  assert(trace.agentEntries[1].sourceSelected === '' && trace.agentEntries[1].sourceResultCode === '', 'free-form Source Trace value was retained');
  assert(!Object.prototype.hasOwnProperty.call(trace.agentEntries[0], 'privateText'), 'free text leaked into Source Trace');
  traceSheet = createTraceSheet();
  context.__sourcePersistTrace = { entries: [], agentEntries: trace.agentEntries };
  vm.runInContext('persistAgentTrace_(__sourcePersistTrace)', context);
  const selected = traceSheet.headers.indexOf('sourceSelected');
  const count = traceSheet.headers.indexOf('sourceRecordCount');
  const calendarCount = traceSheet.headers.indexOf('calendarRecordCount');
  assert(traceSheet.rows[0][selected] === 'room_climate' && traceSheet.rows[0][count] === 3 && traceSheet.rows[0][calendarCount] === 2, 'Source Trace was not persisted');
});

test('Mini persists only allowlisted Aircon Action and State Trace values', () => {
  reset();
  const trace = { clientRequestId, agentEntries: [] };
  vm.runInContext(`appendAgentTraceEntries_(__actionTrace, [{
    event: 'ACTION_TRACE', clientRequestIdSuffix: '${clientRequestId.slice(-8)}',
    actionSource: 'confirmation_created', actionResult: 'OK', stateBefore: 'OFF', stateAfter: 'ON', privateText: 'must-not-persist'
  }, {
    event: 'ACTION_TRACE', clientRequestIdSuffix: '${clientRequestId.slice(-8)}',
    actionSource: 'free text', actionResult: 'private', stateBefore: '25', stateAfter: 'secret'
  }])`, Object.assign(context, { __actionTrace: trace }));
  assert(trace.agentEntries[0].actionSource === 'confirmation_created' && trace.agentEntries[0].stateAfter === 'ON', 'allowlisted Action Trace was dropped');
  assert(trace.agentEntries[1].actionSource === '' && trace.agentEntries[1].stateBefore === '', 'unsafe Action Trace was retained');
  traceSheet = createTraceSheet();
  context.__actionPersistTrace = { entries: [], agentEntries: trace.agentEntries };
  vm.runInContext('persistAgentTrace_(__actionPersistTrace)', context);
  assert(traceSheet.rows[0][traceSheet.headers.indexOf('actionSource')] === 'confirmation_created', 'Action Trace was not persisted');
  assert(traceSheet.rows[0][traceSheet.headers.indexOf('stateAfter')] === 'ON', 'State Trace was not persisted');
});

test('Mini persists Agent failure trace events before returning a safe error', () => {
  configure();
  mockFetch(200, {
    success: false,
    error: { code: 'AGENT_UNAVAILABLE', message: 'private upstream reason' },
    traceEvents: [{
      event: 'OPENAI_REQUEST_FAILED', clientRequestIdSuffix: clientRequestId.slice(-8),
      stage: 'OPENAI_REQUEST', errorCode: 'AGENT_UNAVAILABLE', reason: 'UPSTREAM_HTTP_503',
      elapsedMs: 25, openAiCallCount: 1, serviceCallCount: 0
    }]
  });
  const result = post(valid());
  assert(!result.success && result.error.code === 'AGENT_UNAVAILABLE', 'safe Agent failure changed');
  const sourceColumn = traceSheet.headers.indexOf('source');
  const eventColumn = traceSheet.headers.indexOf('event');
  assert(traceSheet.rows.some((row) => row[sourceColumn] === 'agent' && row[eventColumn] === 'OPENAI_REQUEST_FAILED'), 'Agent failure trace was not persisted');
  assert(!JSON.stringify(traceSheet.rows).includes('private upstream reason'), 'Agent failure detail leaked to ledger');
});

test('request metadata is allowlisted separately from the server-resolved actor', () => {
  configure();
  mockFetch(200, agentResponse('ok'), (url, options) => {
    const sent = JSON.parse(options.payload);
    assert(sent.requestMetadata.purpose === 'weather' && sent.requestMetadata.roomHint === 'living', 'advisory routing metadata was not forwarded');
    assert(sent.requestMetadata.sessionId === sessionId && sent.requestMetadata.clientRequestId === clientRequestId, 'request identifiers were not server normalized');
    assert(JSON.stringify(sent.requestMetadata.todayParuruSettings) === JSON.stringify({
      selectedMemberKeys: ['mother', 'family'], includeUnknown: true, tomorrowScheduleStartTime: '18:00', scope: 'family'
    }), 'Today Paruru settings were not server normalized');
    assert(!Object.prototype.hasOwnProperty.call(sent.requestMetadata, 'role') && !Object.prototype.hasOwnProperty.call(sent.requestMetadata, 'actor'), 'identity was mixed into request metadata');
    assert(sent.actor.memberUserId === 'father' && sent.actor.role === 'admin', 'server actor changed');
  });
  const result = post(valid({
    requestMetadata: {
      purpose: 'weather', roomHint: 'living', calendarScopeHint: 'family',
      todayParuruSettings: { selectedMemberKeys: ['mother', 'family', 'invalid'], includeUnknown: true, tomorrowScheduleStartTime: '18:00', scope: 'family' },
      sessionId: 'spoofed-session', clientRequestId: 'spoofed-request',
      actor: { role: 'admin' }, role: 'admin', arbitrary: 'drop-me'
    }
  }));
  assert(result.success, 'metadata request failed');
});

test('Today Paruru scope is derived from the server actor and selected members, not the client scope hint', () => {
  const mine = context.sanitizeAgentRequestMetadata_({
    todayParuruSettings: { selectedMemberKeys: ['father'], scope: 'family' }
  }, sessionId, clientRequestId, { memberUserId: 'father' });
  const family = context.sanitizeAgentRequestMetadata_({
    todayParuruSettings: { selectedMemberKeys: ['father', 'family'], scope: 'mine' }
  }, sessionId, clientRequestId, { memberUserId: 'father' });
  assert(mine.todayParuruSettings.scope === 'mine', 'single actor selection was not resolved as mine');
  assert(family.todayParuruSettings.scope === 'family', 'family selection trusted a spoofed mine scope');
});

test('safe upstream weather failure remains distinguishable to PWA', () => {
  configure();
  mockFetch(200, { success: false, error: { code: 'WEATHER_UNAVAILABLE', message: 'private upstream detail' } });
  const result = post(valid());
  assert(!result.success && result.error.code === 'WEATHER_UNAVAILABLE', 'weather failure was collapsed to AGENT_ERROR');
  assert(!JSON.stringify(result).includes('private upstream detail'), 'upstream detail leaked');
});

test('automation and Today Paruru failures retain their safe source codes', () => {
  configure();
  mockFetch(200, { success: false, error: { code: 'AUTOMATION_UPSTREAM_ERROR', message: 'private adapter detail' } });
  let result = post(valid());
  assert(!result.success && result.error.code === 'AUTOMATION_UPSTREAM_ERROR', 'automation failure was collapsed');
  mockFetch(200, { success: false, error: { code: 'TODAY_PARURU_UNAVAILABLE', message: 'private aggregate detail' } });
  result = post(valid({ requestMetadata: { purpose: 'today-paruru' } }));
  assert(!result.success && result.error.code === 'TODAY_PARURU_UNAVAILABLE', 'Today Paruru failure was collapsed');
  assert(!JSON.stringify(result).includes('private aggregate detail'), 'private upstream detail leaked');
  mockFetch(200, { success: false, error: { code: 'UPSTREAM_ERROR', message: 'private route detail' } });
  result = post(valid());
  assert(!result.success && result.error.code === 'UPSTREAM_ERROR', 'generic upstream failure was collapsed');
  assert(!JSON.stringify(result).includes('private route detail'), 'generic upstream detail leaked');
});

test('read authorization rejects before Agent call and ignores client actor spoofing', () => {
  configure();
  let calls = 0;
  mockFetch(200, agentResponse('ok'), () => { calls += 1; });
  readActor = { homeId: 'home-a', memberUserId: 'second_son', displayName: '次男', role: 'self_record', capabilities: ['home.read'], deviceId: 'son-device' };
  const allowed = post(valid({ userId: 'father', userDisplayName: '父', role: 'admin', capabilities: ['home.control'], homeId: 'spoofed', pairingToken: 'spoofed-token' }));
  assert(allowed.success && calls === 1 && readActorCalls === 1, 'self_record home.read was not accepted');

  reset(); configure();
  mockFetch(200, agentResponse('must not be called'), () => { calls += 1; });
  readActorError = 'UNAUTHORIZED_DEVICE';
  const rejected = post(valid({ pairingToken: '' }));
  assert(!rejected.success && calls === 1 && readActorCalls === 1, 'unauthorized request reached Agent');
});

test('climate service response is sanitized', () => {
  configure();
  mockFetch(200, agentResponse('書斎はちょい暑いで。', [{ service: 'home-climate-context', status: 'success', durationMs: 9451, raw: { temperature: 28.3 } }]));
  const result = post(valid());
  assert(result.serviceExecutions[0].durationMs === 9451, 'service audit missing');
  assert(!JSON.stringify(result).includes('28.3') && !JSON.stringify(result).includes('internal-agent-request-id'), 'internal data leaked');
  assert(!Object.prototype.hasOwnProperty.call(result, 'followup'), 'climate response contract changed');
});

test('structured followup is allowlisted for PWA', () => {
  configure();
  const response = agentResponse('覚えたで。締切はいつ？', [{ service: 'registration-guidance', status: 'success', durationMs: 20 }]);
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

test('development diagnostics identify the Agent Gateway failure stage without changing public codes', () => {
  configure();
  properties.PALURU_AGENT_DIAGNOSTICS_ENABLED = 'true';
  mockFetch(200, { success: false, error: { code: 'TOOL_FAILED', message: 'internal tool failed' } });
  let result = post(valid());
  assert(result.error.code === 'AGENT_ERROR', 'upstream Agent code changed');
  assert(result.diagnostics.stage === 'UPSTREAM_AGENT_FAILED' && result.diagnostics.reason === 'TOOL_FAILED', 'upstream Agent diagnostic missing');
  assert(!Object.prototype.hasOwnProperty.call(result.diagnostics, 'exception'), 'development diagnostics exposed exception details');

  fetchImpl = () => { throw new Error('transport unavailable'); };
  result = post(valid());
  assert(result.error.code === 'AGENT_UNAVAILABLE', 'transport code changed');
  assert(result.diagnostics.stage === 'MODEL_FAILED' && result.diagnostics.reason === 'URLFETCH_FAILED', 'transport diagnostic missing');
  assert(!Object.prototype.hasOwnProperty.call(result.diagnostics, 'exception'), 'transport exception details leaked');

  reset(); configure(); properties.PALURU_AGENT_DIAGNOSTICS_ENABLED = 'true';
  readActorError = 'MEMBERSHIP_NOT_FOUND';
  result = post(valid());
  assert(result.diagnostics.stage === 'HOME_CONTEXT_FAILED' && result.diagnostics.reason === 'ACTOR_RESOLUTION_FAILED', 'home context diagnostic missing');
});

test('Agent Gateway diagnostics are absent unless development mode is explicitly enabled', () => {
  configure();
  mockFetch(200, { success: false, error: { code: 'TOOL_FAILED' } });
  const result = post(valid());
  assert(!Object.prototype.hasOwnProperty.call(result, 'diagnostics'), 'production response exposed diagnostics');
});

test('Mini emits structured request tracing without sensitive payload fields', () => {
  configure();
  mockFetch(200, agentResponse('private reply'));
  const result = post(valid());
  assert(result.success, 'Agent response failed');
  const transportLogs = logs.filter((line) => line.includes('[PALURU_TRACE]'));
  assert(transportLogs.length >= 5, 'Mini trace lifecycle logs missing');
  const combined = transportLogs.join('\n');
  ['REQUEST_RECEIVED', 'ACTOR_RESOLVED', 'AGENT_REQUEST_START', 'AGENT_HTTP_RESPONSE', 'RESPONSE_SENT'].forEach((event) => {
    assert(combined.includes('"event":"' + event + '"'), 'trace event missing: ' + event);
  });
  assert(combined.includes('"clientRequestIdSuffix":"4fd430c8"'), 'trace request suffix missing');
  assert(combined.includes('"httpStatus":200'), 'HTTP status missing');
  assert(!combined.includes('requestPayload') && !combined.includes('responseBody') && !combined.includes('exception'), 'trace retained body or exception fields');
  assert(!combined.includes(secretToken) && !combined.includes(secretMessage) && !combined.includes('private reply') && !combined.includes('server-device'), 'trace logs leaked sensitive content');
});

test('Mini preserves Agent trace stage on a public failure response', () => {
  configure();
  mockFetch(200, { success: false, error: { code: 'AGENT_UNAVAILABLE' }, trace: { clientRequestId, stage: 'OPENAI_REQUEST' } });
  const result = post(valid());
  assert(result.trace && result.trace.clientRequestId === clientRequestId, 'clientRequestId trace was not preserved');
  assert(result.trace.stage === 'OPENAI_REQUEST', 'Agent trace stage was not preserved');
});

test('Mini records connection failures at AGENT_REQUEST and returns a safe trace', () => {
  configure();
  fetchImpl = () => { throw new Error('network details must stay internal'); };
  const result = post(valid());
  assert(result.error.code === 'AGENT_UNAVAILABLE', 'connection failure code changed');
  assert(result.trace && result.trace.clientRequestId === clientRequestId && result.trace.stage === 'AGENT_REQUEST', 'connection failure trace is incomplete');
  const combined = logs.join('\n');
  assert(combined.includes('"event":"AGENT_FETCH_FAILED"') && combined.includes('"stage":"AGENT_REQUEST"'), 'connection failure was not traced at Agent request stage');
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
  context.resolveMemoActor_ = () => ({ memberUserId: 'father' });
  context.listInboxItems_ = () => ['item'];
  context.notificationCandidates_ = () => context.json_({ route: 'notificationCandidates' });
  assert(post({ action: 'createWithAI', memo: 'x' }).route === 'createWithAI', 'createWithAI route changed');
  assert(post({ action: 'answerFollowup', id: 'x', answer: 'y' }).route === 'answerFollowup', 'answerFollowup route changed');
  assert(output(context.doPost({ postData: { contents: JSON.stringify({ action: 'list', deviceId: 'device', pairingToken: 'credential' }) } })).data[0] === 'item', 'list route changed');
  assert(output(context.doPost({ postData: { contents: JSON.stringify({ action: 'notificationCandidates', deviceId: 'device', pairingToken: 'credential' }) } })).route === 'notificationCandidates', 'notification route changed');
  assert(output(context.doGet({ parameter: { action: 'list' } })).success === false, 'legacy GET list was accepted');
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

test('agentActionConfirm resolves control actor twice before calling Agent', () => {
  configure();
  let agentCalls = 0;
  context.getHomeAgentActionDependencies_ = () => ({});
  context.assertHomeAgentActionsEnabled_ = () => {};
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
    assert(sent.actor && sent.actor.homeId === 'home-a' && sent.actor.memberUserId === 'father'
      && sent.actor.deviceId === 'server-control-device' && sent.actor.capabilities.includes('home.control'), 'server actor was not sent to Agent');
    assert(!JSON.stringify(sent.actor).includes('spoofed'), 'client actor spoof reached Agent');
  });
  const result = post({
    action: 'agentActionConfirm',
    confirmationId: '88888888-8888-4888-8888-888888888888',
    clientRequestId,
    deviceId: 'spoofed-device',
    pairingToken: 'pairing-token-placeholder-000000000001',
    userId: 'spoofed-user', role: 'self_record', capabilities: [], homeId: 'spoofed-home', _authenticatedActor: { deviceId: 'spoofed' },
  });
  assert(result.success && agentCalls === 1 && controlActorCalls === 2 && result.operation === 'pause', 'confirm failed');
});

test('agentActionConfirm kill switch and control authorization failures short-circuit Agent', () => {
  configure();
  let agentCalls = 0;
  mockFetch(200, agentResponse('not used'), () => { agentCalls += 1; });
  context.getHomeAgentActionDependencies_ = () => ({});
  context.assertHomeAgentActionsEnabled_ = () => { const error = new Error('disabled'); error.code = 'HOME_AGENT_ACTIONS_DISABLED'; throw error; };
  let result = post({
    action: 'agentActionConfirm',
    confirmationId: '88888888-8888-4888-8888-888888888888',
    clientRequestId,
    deviceId: 'device-1',
    pairingToken: 'pairing-token-placeholder-000000000001',
  });
  assert(result.error.code === 'HOME_AGENT_ACTIONS_DISABLED' && agentCalls === 0, 'kill switch did not short-circuit');
  context.assertHomeAgentActionsEnabled_ = () => {};
  controlActorError = 'FORBIDDEN';
  result = post({
    action: 'agentActionConfirm',
    confirmationId: '88888888-8888-4888-8888-888888888888',
    clientRequestId,
    deviceId: 'device-1',
    pairingToken: 'bad-token',
  });
  assert(result.error.code === 'FORBIDDEN' && agentCalls === 0, 'control authorization failure reached Agent');
});

test('agentActionConfirm rechecks membership immediately before Agent call', () => {
  configure();
  let agentCalls = 0;
  context.getHomeAgentActionDependencies_ = () => ({});
  context.assertHomeAgentActionsEnabled_ = () => {};
  context.CacheService = { getScriptCache: () => ({ get: () => null, put: () => {} }) };
  controlActor = (call) => {
    if (call === 1) return { homeId: 'home-a', memberUserId: 'father', displayName: '父', role: 'admin', capabilities: ['home.control'], deviceId: 'server-control-device' };
    throw Object.assign(new Error('MEMBERSHIP_NOT_FOUND'), { code: 'MEMBERSHIP_NOT_FOUND' });
  };
  mockFetch(200, agentResponse('must not be called'), () => { agentCalls += 1; });
  const result = post({ action: 'agentActionConfirm', confirmationId: '88888888-8888-4888-8888-888888888888', clientRequestId, deviceId: 'spoofed', pairingToken: 'credential' });
  assert(result.error.code === 'MEMBERSHIP_NOT_FOUND' && controlActorCalls === 2 && agentCalls === 0, 'membership change reached Agent');
});

test('agentActionCancel resolves control actor and sends only confirmation identifiers', () => {
  configure();
  let agentCalls = 0;
  context.getHomeAgentActionDependencies_ = () => ({});
  context.assertHomeAgentActionsEnabled_ = () => {};
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
    assert(sent.actor && sent.actor.homeId === 'home-a' && sent.actor.memberUserId === 'father'
      && sent.actor.deviceId === 'server-control-device' && sent.actor.capabilities.includes('home.control'), 'server actor was not sent to Agent cancel');
    assert(!Object.prototype.hasOwnProperty.call(sent, 'pairingToken'), 'pairing token sent to Agent');
    ['operation', 'skill', 'roomId', 'duration', 'durationMinutes', 'confirmed', 'payload'].forEach((field) => {
      assert(!Object.prototype.hasOwnProperty.call(sent, field), field + ' leaked to Agent cancel');
    });
  });
  const result = post({
    action: 'agentActionCancel',
    confirmationId: '88888888-8888-4888-8888-888888888888',
    clientRequestId,
    deviceId: 'spoofed-device',
    pairingToken: 'pairing-token-placeholder-000000000001',
    operation: 'resume',
    roomId: 'living',
    durationMinutes: 1,
    confirmed: true,
  });
  assert(result.success && result.status === 'cancelled' && agentCalls === 1 && controlActorCalls === 2, 'cancel failed');
});

test('agentActionCancel kill switch short-circuits Agent', () => {
  configure();
  let agentCalls = 0;
  mockFetch(200, agentResponse('not used'), () => { agentCalls += 1; });
  context.getHomeAgentActionDependencies_ = () => ({});
  context.assertHomeAgentActionsEnabled_ = () => { const error = new Error('disabled'); error.code = 'HOME_AGENT_ACTIONS_DISABLED'; throw error; };
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

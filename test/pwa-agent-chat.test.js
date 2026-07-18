'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

function createClassList(initial) {
  const values = new Set(initial || []);
  return {
    add: (...names) => names.forEach((name) => values.add(name)),
    remove: (...names) => names.forEach((name) => values.delete(name)),
    contains: (name) => values.has(name),
    toggle: (name, force) => {
      if (force === true) values.add(name);
      else if (force === false) values.delete(name);
      else if (values.has(name)) values.delete(name);
      else values.add(name);
      return values.has(name);
    },
  };
}

function createHarness() {
  const elements = new Map();
  const handlers = new Map();
  const storage = new Map();
  const requests = [];
  let uuidIndex = 0;
  let responder = (payload) => ({
    success: true,
    reply: '家の様子を見てきたで。',
    sessionId: payload.sessionId,
    clientRequestId: payload.clientRequestId,
  });

  function element(selector) {
    if (elements.has(selector)) return elements.get(selector);
    const hidden = ['#homeAgentCard', '#homeAgentRetryButton'].includes(selector) ? ['is-hidden'] : [];
    const value = {
      value: '',
      textContent: '',
      innerHTML: '',
      className: '',
      dataset: {},
      disabled: false,
      checked: false,
      src: '',
      classList: createClassList(hidden),
      addEventListener(type, handler) { handlers.set(selector + ':' + type, handler); },
      setAttribute() {},
      getAttribute() { return ''; },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      closest() { return null; },
      insertAdjacentHTML(position, html) { this.innerHTML += html; },
      scrollIntoView() {},
      getBoundingClientRect() { return { top: 0, bottom: 200, height: 200 }; },
      focus() {},
      reset() { this.value = ''; },
      showModal() {},
      close() {},
    };
    elements.set(selector, value);
    return value;
  }

  const uuidValues = [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
    '44444444-4444-4444-8444-444444444444',
    '55555555-5555-4555-8555-555555555555',
  ];

  const context = {
    console,
    Date,
    JSON,
    Math,
    Number,
    Object,
    Array,
    String,
    RegExp,
    Error,
    Uint8Array,
    URL,
    Promise,
    crypto: {
      randomUUID: () => uuidValues[uuidIndex++],
      getRandomValues: (bytes) => bytes.fill(7),
    },
    localStorage: {
      getItem: (key) => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(key, String(value)),
    },
    navigator: {},
    location: { reload() {} },
    window: {
      innerHeight: 800,
      addEventListener() {},
      setTimeout: (fn) => { fn(); return 1; },
      clearTimeout() {},
    },
    document: {
      documentElement: { clientHeight: 800 },
      querySelector: element,
      querySelectorAll: () => [],
    },
    requestAnimationFrame: (fn) => fn(),
    FormData: function() { return { get: () => 'Normal' }; },
    fetch: async (url, options = {}) => {
      const payload = options.body ? JSON.parse(options.body) : null;
      requests.push({ url, options, payload });
      const body = payload
        ? (payload.action === 'agentChat' ? responder(payload) : { success: true, item: {} })
        : { success: true, data: [], message: 'listed' };
      return { ok: true, status: 200, json: async () => body };
    },
  };
  vm.createContext(context);
  new vm.Script(appSource, { filename: 'app.js' }).runInContext(context);
  return {
    context,
    elements,
    handlers,
    storage,
    requests,
    setResponder(fn) { responder = fn; },
    run(expression) { return vm.runInContext(expression, context); },
    submit(message) {
      element('#memo').value = message;
      return handlers.get('#inboxForm:submit')({ preventDefault() {} });
    },
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('A climate question routes only to agentChat and renders reply', async () => {
  const harness = createHarness();
  harness.setResponder((payload) => ({
    success: true,
    reply: '書斎は28.9℃で蒸し暑いで。',
    sessionId: payload.sessionId,
    clientRequestId: payload.clientRequestId,
  }));
  await harness.submit('書斎暑い？');
  const actions = harness.requests.filter((entry) => entry.payload).map((entry) => entry.payload.action);
  assert(JSON.stringify(actions) === JSON.stringify(['agentChat']), 'wrong climate route: ' + actions.join(','));
  assert(harness.elements.get('#homeAgentContent').innerHTML.includes('書斎は28.9℃'), 'reply not rendered');
});

test('B normal memo stays on createWithAI', async () => {
  const harness = createHarness();
  await harness.submit('牛乳買う');
  const actions = harness.requests.filter((entry) => entry.payload).map((entry) => entry.payload.action);
  assert(actions.includes('createWithAI'), 'createWithAI not called');
  assert(!actions.includes('agentChat'), 'normal memo reached agentChat');
});

test('B2 non-climate question stays on legacy homeAgent', async () => {
  const harness = createHarness();
  await harness.submit('今日の給食は？');
  const actions = harness.requests.filter((entry) => entry.payload).map((entry) => entry.payload.action);
  assert(actions.includes('homeAgent'), 'legacy homeAgent was not called');
  assert(!actions.includes('agentChat') && !actions.includes('createWithAI'), 'legacy question was misrouted');
});

test('C Agent error keeps input and enables retry without fallback', async () => {
  const harness = createHarness();
  harness.setResponder(() => ({ success: false, error: { code: 'AGENT_ERROR' } }));
  await harness.submit('書斎暑い？');
  assert(harness.elements.get('#memo').value === '書斎暑い？', 'input was cleared on error');
  assert(!harness.elements.get('#homeAgentRetryButton').classList.contains('is-hidden'), 'retry not shown');
  const actions = harness.requests.filter((entry) => entry.payload).map((entry) => entry.payload.action);
  assert(JSON.stringify(actions) === JSON.stringify(['agentChat']), 'error silently fell back');
});

test('D retry reuses clientRequestId and double submit is blocked', async () => {
  const harness = createHarness();
  harness.setResponder(() => ({ success: false, error: { code: 'AGENT_ERROR' } }));
  await harness.submit('書斎暑い？');
  const first = harness.requests[0].payload;
  harness.setResponder((payload) => ({ success: true, reply: '確認できたで。', sessionId: payload.sessionId, clientRequestId: payload.clientRequestId }));
  await harness.run('submitAgentChatQuery(pendingHomeAgentRetry.message, { request: pendingHomeAgentRetry })');
  const second = harness.requests[1].payload;
  assert(first.clientRequestId === second.clientRequestId, 'retry changed clientRequestId');

  const duplicateHarness = createHarness();
  const firstSubmit = duplicateHarness.submit('書斎暑い？');
  const secondSubmit = duplicateHarness.submit('書斎暑い？');
  await Promise.all([firstSubmit, secondSubmit]);
  assert(duplicateHarness.requests.filter((entry) => entry.payload?.action === 'agentChat').length === 1, 'double submit was not blocked');
});

test('E new submission gets new request ID and reuses session', async () => {
  const harness = createHarness();
  await harness.submit('書斎暑い？');
  await harness.submit('寝室寒い？');
  const calls = harness.requests.filter((entry) => entry.payload?.action === 'agentChat').map((entry) => entry.payload);
  assert(calls.length === 2, 'two Agent calls expected');
  assert(calls[0].sessionId === calls[1].sessionId, 'sessionId was not reused');
  assert(calls[0].clientRequestId !== calls[1].clientRequestId, 'new submission reused clientRequestId');
});

test('E2 invalid stored session is regenerated and UUID fallback works', () => {
  const harness = createHarness();
  harness.storage.set('paruru-mini-agent-chat-session-v1', 'invalid-session');
  const payload = harness.run('buildAgentChatPayload("書斎暑い？")');
  assert(/^[0-9a-f-]{36}$/i.test(payload.sessionId), 'invalid session was not regenerated');
  assert(harness.storage.get('paruru-mini-agent-chat-session-v1') === payload.sessionId, 'new session was not stored');
  harness.context.crypto.randomUUID = undefined;
  const fallback = harness.run('createUuid()');
  assert(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(fallback), 'UUID fallback is invalid');
});

test('F invalid Agent responses are handled safely', async () => {
  const cases = [
    (payload) => ({ success: true, sessionId: payload.sessionId, clientRequestId: payload.clientRequestId }),
    (payload) => ({ success: true, reply: 'x', sessionId: '99999999-9999-4999-8999-999999999999', clientRequestId: payload.clientRequestId }),
    (payload) => ({ success: true, reply: 'x', sessionId: payload.sessionId, clientRequestId: '99999999-9999-4999-8999-999999999999' }),
  ];
  for (const response of cases) {
    const harness = createHarness();
    harness.setResponder(response);
    await harness.submit('書斎暑い？');
    assert(harness.elements.get('#memo').value === '書斎暑い？', 'invalid response cleared input');
    assert(harness.elements.get('#message').textContent.includes('もう一回'), 'safe error missing');
  }
});

test('G frontend contains no Agent secret or Agent URL', () => {
  const frontend = ['app.js', 'index.html', 'sw.js'].map((name) => fs.readFileSync(path.join(root, name), 'utf8')).join('\n');
  assert(!/PALURU_AGENT_TOKEN|PALURU_AGENT_URL|authToken/.test(frontend), 'Agent credential contract leaked to frontend');
});

test('H existing feature routes remain present', () => {
  ['createWithAI', 'answerFollowup', 'notificationCandidates', 'syncCalendar', 'updateCalendar', 'homeAgentAction'].forEach((action) => {
    assert(appSource.includes(action), action + ' route disappeared');
  });
});

test('I JavaScript syntax and J cache versions', () => {
  new vm.Script(appSource, { filename: 'app.js' });
  new vm.Script(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), { filename: 'sw.js' });
  const expected = 'v20260718-01';
  assert(appSource.includes('const ASSET_VERSION = "' + expected + '"'), 'app version mismatch');
  assert(fs.readFileSync(path.join(root, 'sw.js'), 'utf8').includes('const ASSET_VERSION = "' + expected + '"'), 'SW version mismatch');
  assert(fs.readFileSync(path.join(root, 'index.html'), 'utf8').includes('app.js?v=20260718-01'), 'HTML app version mismatch');
  assert(appSource.includes('updateViaCache: "none"'), 'service worker updateViaCache changed');
  const swSource = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert(swSource.includes('self.skipWaiting()') && swSource.includes('self.clients.claim()'), 'service worker activation safeguards changed');
  JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8').replace(/^\uFEFF/, ''));
});

(async () => {
  let failures = 0;
  for (const item of tests) {
    try { await item.fn(); console.log('PASS ' + item.name); }
    catch (error) { failures += 1; console.error('FAIL ' + item.name + ': ' + error.message); }
  }
  if (failures) process.exitCode = 1;
  else console.log('PASS all ' + tests.length + ' tests');
})();

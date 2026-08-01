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
  const logs = [];
  let uuidIndex = 0;
  let responder = (payload) => ({
    success: true,
    reply: '家の様子を見てきたで。',
    sessionId: payload.sessionId,
    clientRequestId: payload.clientRequestId,
  });
  let actionResponder = () => ({ success: true, item: {} });
  let agentResponseFactory = null;

  function makeResponse(body, options = {}) {
    const rawBody = Object.prototype.hasOwnProperty.call(options, 'rawBody')
      ? String(options.rawBody)
      : JSON.stringify(body);
    const headerValues = options.headers || { 'content-type': 'application/json; charset=utf-8' };
    const headers = {
      forEach(callback) {
        Object.entries(headerValues).forEach(([key, value]) => callback(value, key));
      },
      get(name) {
        const found = Object.entries(headerValues).find(([key]) => key.toLowerCase() === String(name).toLowerCase());
        return found ? found[1] : null;
      },
    };
    return {
      ok: options.ok !== false,
      status: options.status || 200,
      url: options.url || 'https://script.googleusercontent.com/macros/echo',
      redirected: options.redirected === true,
      type: options.type || 'cors',
      headers,
      clone: () => ({ text: async () => rawBody }),
      json: async () => JSON.parse(rawBody),
    };
  }

  function element(selector) {
    if (elements.has(selector)) return elements.get(selector);
    const hidden = ['#homeAgentCard', '#homeAgentRetryButton', '#homeFollowup', '#detailFollowup', '#homeIntentConfirm'].includes(selector) ? ['is-hidden'] : [];
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
      reset() {
        this.value = '';
        if (selector === '#inboxForm') {
          element('#category').value = '';
          ['Low', 'Normal', 'High'].forEach((priority) => {
            element(`input[name="priority"][value="${priority}"]`).checked = false;
          });
          element('input[name="priority"][value=""]').checked = true;
        }
      },
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
    console: {
      info: (...args) => logs.push({ level: 'info', args }),
      error: (...args) => logs.push({ level: 'error', args }),
      warn: (...args) => logs.push({ level: 'warn', args }),
      log: (...args) => logs.push({ level: 'log', args }),
    },
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
      body: { classList: createClassList() },
      querySelector: element,
      querySelectorAll: () => [],
    },
    requestAnimationFrame: (fn) => fn(),
    FormData: function() {
      return {
        get: (name) => {
          if (name !== 'priority') return null;
          const selected = ['Low', 'Normal', 'High', ''].find((priority) => {
            const input = element(`input[name="priority"][value="${priority}"]`);
            return input.checked;
          });
          return selected === undefined ? '' : selected;
        }
      };
    },
    fetch: async (url, options = {}) => {
      const payload = options.body ? JSON.parse(options.body) : null;
      requests.push({ url, options, payload });
      const body = payload
        ? (payload.action === 'agentChat' ? responder(payload) : actionResponder(payload))
        : { success: true, data: [], message: 'listed' };
      if (payload?.action === 'agentChat' && agentResponseFactory) {
        return agentResponseFactory(payload, body, makeResponse);
      }
      return makeResponse(body);
    },
  };
  vm.createContext(context);
  new vm.Script(appSource, { filename: 'app.js' }).runInContext(context);
  vm.runInContext('appAuthenticationState = "active_member"; activeMembershipContext = { capabilities: ["home.control"] };', context);
  return {
    context,
    elements,
    handlers,
    storage,
    requests,
    logs,
    element,
    setResponder(fn) { responder = fn; },
    setActionResponder(fn) { actionResponder = fn; },
    setAgentResponseFactory(fn) { agentResponseFactory = fn; },
    run(expression) { return vm.runInContext(expression, context); },
    ask(message) {
      element('#memo').value = message;
      return handlers.get('#askPaluruButton:click')();
    },
    save(message) {
      element('#memo').value = message;
      return handlers.get('#saveToPaluruButton:click')();
    },
    submit(message) {
      return this.ask(message);
    },
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function expectReject(promise, code) {
  try {
    await promise;
  } catch (error) {
    assert(error && error.code === code, `unexpected rejection: ${error && error.code}`);
    return;
  }
  throw new Error(`expected rejection: ${code}`);
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
  assert(!harness.elements.get('#homeAgentCard').classList.contains('is-hidden'), 'non-followup Agent reply was auto-closed');
});

test('B save button always sends a normal memo to createWithAI', async () => {
  const harness = createHarness();
  await harness.save('牛乳買う');
  const actions = harness.requests.filter((entry) => entry.payload).map((entry) => entry.payload.action);
  assert(actions.includes('createWithAI'), 'createWithAI not called');
  assert(!actions.includes('agentChat'), 'normal memo reached agentChat');
});

test('B1 explicit save request routes to agentChat', async () => {
  const harness = createHarness();
  await harness.submit('牛乳買うの覚えといて');
  const actions = harness.requests.filter((entry) => entry.payload).map((entry) => entry.payload.action);
  assert(JSON.stringify(actions) === JSON.stringify(['agentChat']), 'explicit save request route changed');
});

test('B1b explicit record wording routes to agentChat', async () => {
  const harness = createHarness();
  await harness.submit('これ記録しといて');
  const actions = harness.requests.filter((entry) => entry.payload).map((entry) => entry.payload.action);
  assert(JSON.stringify(actions) === JSON.stringify(['agentChat']), 'record request did not reach Agent');
});

test('B2 non-climate question stays on legacy homeAgent', async () => {
  const harness = createHarness();
  await harness.submit('今日の給食は？');
  const actions = harness.requests.filter((entry) => entry.payload).map((entry) => entry.payload.action);
  assert(actions.includes('homeAgent'), 'legacy homeAgent was not called');
  assert(!actions.includes('agentChat') && !actions.includes('createWithAI'), 'legacy question was misrouted');
});

test('B3 lunch priority stays on legacy homeAgent even with save wording', async () => {
  const harness = createHarness();
  await harness.submit('今日の給食を覚えといて');
  const actions = harness.requests.filter((entry) => entry.payload).map((entry) => entry.payload.action);
  assert(actions.includes('homeAgent') && !actions.includes('agentChat'), 'lunch priority was stolen by memo Agent');
});

test('B3b operation request stays on legacy homeAgent', async () => {
  const harness = createHarness();
  await harness.submit('冷房を弱めて');
  const actions = harness.requests.filter((entry) => entry.payload).map((entry) => entry.payload.action);
  assert(actions.includes('homeAgent') && !actions.includes('agentChat'), 'operation route changed');
});

test('P1.5 aircon state reads route only to the new Agent', async () => {
  const cases = [
    'リビングのエアコンどうなってる？',
    '冷房ついてる？',
    'エアコン動いてる？',
    '何度設定？',
    '今どのモード？',
    '自動制御は一時停止中？',
    '冷房効いてる？',
  ];
  for (const message of cases) {
    const harness = createHarness();
    await harness.submit(message);
    const actions = harness.requests.filter((entry) => entry.payload).map((entry) => entry.payload.action);
    assert(JSON.stringify(actions) === JSON.stringify(['agentChat']), message + ' route: ' + actions.join(','));
    assert(harness.run('pendingHomeAgentRetry') === null, message + ' did not complete Agent request');
  }
});

test('EVA-03I-2B aircon device commands and automation controls route to Agent', async () => {
  const cases = [
    'エアコンつけて',
    'エアコン消して',
    '1度下げて',
    '除湿にして',
    '風量を強くして',
    '自動制御を止めて',
    '自動制御を再開して',
  ];
  for (const message of cases) {
    const harness = createHarness();
    await harness.submit(message);
    const actions = harness.requests.filter((entry) => entry.payload).map((entry) => entry.payload.action);
    const expected = 'agentChat';
    assert(JSON.stringify(actions) === JSON.stringify([expected]), message + ' escaped operation route');
  }
});

test('P1.5 aircon read uses dedicated loading state', async () => {
  const harness = createHarness();
  let resolveResponse;
  harness.setResponder((payload) => new Promise((resolve) => {
    resolveResponse = () => resolve({
      success: true, reply: '記録上は冷房やで。',
      sessionId: payload.sessionId, clientRequestId: payload.clientRequestId,
    });
  }));
  const pending = harness.submit('リビングのエアコンどうなってる？');
  await Promise.resolve();
  assert(harness.elements.get('#homeAgentContent').innerHTML.includes('エアコンの状態を確認中'), 'aircon loading text missing');
  assert(harness.run('pendingHomeAgentRetry.purpose') === 'aircon-status', 'aircon retry purpose missing');
  resolveResponse();
  await pending;
});

test('EVA-03F Calendar read questions route only to agentChat', async () => {
  const cases = [
    '今日の予定は？',
    '明日何かある？',
    '今週忙しい？',
    'これから7日間',
    '家族みんなの予定は？',
    '歯医者は何時から？',
  ];
  for (const message of cases) {
    const harness = createHarness();
    await harness.submit(message);
    const actions = harness.requests.filter((entry) => entry.payload).map((entry) => entry.payload.action);
    assert(JSON.stringify(actions) === JSON.stringify(['agentChat']), message + ' route: ' + actions.join(','));
  }
});

test('consult button asks before redirecting calendar-write input and never reaches the read Tool', async () => {
  const cases = [
    '明日10時に歯医者を登録して',
    'カレンダーに追加して',
    '予定を変更して',
    '予定を削除して',
    '予定をキャンセルして',
  ];
  for (const message of cases) {
    const harness = createHarness();
    await harness.submit(message);
    const actions = harness.requests.filter((entry) => entry.payload).map((entry) => entry.payload.action);
    assert(!actions.includes('agentChat'), message + ' reached Calendar Agent route');
    assert(actions.length === 0, message + ' sent an API request before intent confirmation');
    assert(!harness.elements.get('#homeIntentConfirm').classList.contains('is-hidden'), message + ' did not show intent confirmation');
  }
});

test('EVA-03F explicit memo and Home Agent priorities beat Calendar read', async () => {
  const cases = [
    { message: '明日の予定を覚えといて', action: 'agentChat' },
    { message: '今日の給食を覚えといて', action: 'homeAgent' },
    { message: '明日の学校予定は？', action: 'homeAgent' },
    { message: '書斎の自動制御を止めて', action: 'homeAgent' },
    { message: '冷房を弱めて', action: 'homeAgent' },
  ];
  for (const item of cases) {
    const harness = createHarness();
    await harness.submit(item.message);
    const actions = harness.requests.filter((entry) => entry.payload).map((entry) => entry.payload.action);
    const expected = /自動制御|閾ｪ蜍募宛蠕｡/.test(item.message) ? 'agentChat' : item.action;
    assert(JSON.stringify(actions) === JSON.stringify([expected]), item.message + ' priority changed');
  }
});

test('EVA-03J ambiguous questions use the general Agent without becoming Calendar reads', async () => {
  for (const message of ['何時？', '母の予定は？']) {
    const harness = createHarness();
    await harness.submit(message);
    const actions = harness.requests.filter((entry) => entry.payload).map((entry) => entry.payload.action);
    assert(JSON.stringify(actions) === JSON.stringify(['agentChat']), message + ' did not use the general Agent route');
  }
});

test('EVA-03F Calendar loading, failure and retry preserve request identity', async () => {
  const harness = createHarness();
  let resolveResponse;
  harness.setResponder((payload) => new Promise((resolve) => {
    resolveResponse = () => resolve({
      success: true, reply: '今日は予定なしやで。',
      sessionId: payload.sessionId, clientRequestId: payload.clientRequestId,
    });
  }));
  const pending = harness.submit('今日の予定は？');
  await Promise.resolve();
  assert(harness.elements.get('#homeAgentContent').innerHTML.includes('ぱるるが予定を確認中…'), 'Calendar loading message missing');
  assert(harness.run('pendingHomeAgentRetry.purpose') === 'calendar', 'Calendar retry purpose missing');
  resolveResponse();
  await pending;

  const failed = createHarness();
  failed.setResponder(() => ({ success: false, error: { code: 'AGENT_ERROR' } }));
  await failed.submit('明日何かある？');
  const first = failed.requests[0].payload;
  assert(failed.elements.get('#memo').value === '明日何かある？', 'Calendar failure cleared input');
  failed.setResponder((payload) => ({ success: true, reply: '明日は予定なしやで。', sessionId: payload.sessionId, clientRequestId: payload.clientRequestId }));
  await failed.run('submitAgentChatQuery(pendingHomeAgentRetry.message, { request: pendingHomeAgentRetry })');
  assert(first.clientRequestId === failed.requests[1].payload.clientRequestId, 'Calendar retry changed clientRequestId');
});

test('B4 Agent followup renders existing UI and answer updates same item', async () => {
  const harness = createHarness();
  const itemId = '77777777-7777-4777-8777-777777777777';
  harness.setResponder((payload) => ({
    success: true,
    reply: '覚えたで。締切はいつ？',
    sessionId: payload.sessionId,
    clientRequestId: payload.clientRequestId,
    followup: { required: true, itemId, question: '締切はいつ？', inputType: 'date' }
  }));
  await harness.submit('病院の予定をメモして');
  const panel = harness.elements.get('#homeFollowup');
  assert(!panel.classList.contains('is-hidden') && panel.dataset.itemId === itemId, 'existing followup UI not shown');
  assert(harness.elements.get('#homeFollowupQuestion').textContent === '締切はいつ？', 'question not rendered');

  const fields = harness.elements.get('#homeFollowupFields');
  fields.querySelector = (selector) => selector === '[data-followup-answer-text]' ? { value: '明日' } : null;
  await harness.run('submitFollowupAnswer("home")');
  const actions = harness.requests.filter((entry) => entry.payload).map((entry) => entry.payload.action);
  const answer = harness.requests.find((entry) => entry.payload?.action === 'answerFollowup').payload;
  assert(answer.id === itemId, 'answerFollowup used another item');
  assert(actions.filter((action) => action === 'agentChat').length === 1, 'followup answer reran Agent create');
  assert(!actions.includes('createWithAI'), 'followup answer created a new memo');
  assert(panel.classList.contains('is-hidden') && panel.dataset.itemId === '', 'pending followup was not cleared');
  assert(harness.elements.get('#homeAgentCard').classList.contains('is-hidden'), 'Agent message card remained after success');
});

test('B5 malformed followup keeps input without suggesting a futile retry', async () => {
  const harness = createHarness();
  harness.setResponder((payload) => ({ success: true, reply: 'reply', sessionId: payload.sessionId, clientRequestId: payload.clientRequestId, followup: { required: true, itemId: 'bad', question: 'いつ？', inputType: 'date' } }));
  await harness.submit('これ覚えといて');
  assert(harness.elements.get('#memo').value === 'これ覚えといて', 'malformed followup cleared input');
  assert(harness.elements.get('#homeAgentRetryButton').classList.contains('is-hidden'), 'malformed response was presented as transient');
});

test('B6 answerFollowup failure keeps the existing answer and row target', async () => {
  const harness = createHarness();
  const itemId = '77777777-7777-4777-8777-777777777777';
  harness.setResponder((payload) => ({ success: true, reply: 'いつにする？', sessionId: payload.sessionId, clientRequestId: payload.clientRequestId, followup: { required: true, itemId, question: 'いつにする？', inputType: 'text' } }));
  await harness.submit('予定を覚えといて');
  const answerInput = { value: '来週' };
  harness.elements.get('#homeFollowupFields').querySelector = (selector) => selector === '[data-followup-answer-text]' ? answerInput : null;
  harness.setActionResponder((payload) => payload.action === 'answerFollowup' ? { success: false, error: { code: 'FAILED' } } : { success: true, item: {} });
  await harness.run('submitFollowupAnswer("home")');
  assert(answerInput.value === '来週', 'failed followup cleared the answer');
  assert(harness.elements.get('#homeFollowup').dataset.itemId === itemId, 'failed followup lost the row target');
  assert(!harness.elements.get('#homeFollowup').classList.contains('is-hidden'), 'failed followup panel closed');
  assert(!harness.elements.get('#homeAgentCard').classList.contains('is-hidden'), 'failed followup closed Agent message');
});

test('B7 existing createWithAI followup closes panel but not unrelated Home Agent card', async () => {
  const harness = createHarness();
  const itemId = '88888888-8888-4888-8888-888888888888';
  harness.run(`renderFollowupPanel("home", ${JSON.stringify({ id: itemId, needsFollowup: true, followupQuestion: '締切はいつ？', followupInputType: 'date' })})`);
  harness.elements.get('#homeAgentCard').classList.remove('is-hidden');
  const fields = harness.elements.get('#homeFollowupFields');
  fields.querySelector = (selector) => selector === '[data-followup-answer-text]' ? { value: '明日' } : null;
  await harness.run('submitFollowupAnswer("home")');
  assert(harness.elements.get('#homeFollowup').classList.contains('is-hidden'), 'legacy followup panel remained');
  assert(!harness.elements.get('#homeAgentCard').classList.contains('is-hidden'), 'unrelated Home Agent answer was closed');
});

test('B8 manual close button behavior remains', () => {
  const harness = createHarness();
  harness.elements.get('#homeAgentCard').classList.remove('is-hidden');
  harness.elements.get('#message').textContent = 'old Agent error';
  harness.elements.get('#message').className = 'message error';
  harness.handlers.get('#homeAgentCloseButton:click')();
  assert(harness.elements.get('#homeAgentCard').classList.contains('is-hidden'), 'manual close stopped working');
  assert(harness.elements.get('#message').textContent === '', 'manual close left Agent form message');
});

test('register button asks before redirecting a consultation-like input', async () => {
  const harness = createHarness();
  harness.elements.get('#category').value = '開発';
  await harness.run('categoryExplicitlySelected = true');
  harness.element('input[name="priority"][value="High"]').checked = true;
  await harness.run('priorityExplicitlySelected = true');
  await harness.save('今日の予定は？');
  assert(harness.requests.length === 0, 'register sent an API request before intent confirmation');
  assert(!harness.elements.get('#homeIntentConfirm').classList.contains('is-hidden'), 'register confirmation was not shown');
});

test('EVA-03J ask button sends an otherwise normal request to Agent without save overrides', async () => {
  const harness = createHarness();
  harness.elements.get('#category').value = '開発';
  await harness.run('categoryExplicitlySelected = true');
  await harness.ask('予定表示を改行する');
  const payload = harness.requests.find((entry) => entry.payload)?.payload;
  assert(payload.action === 'agentChat', 'ask did not use the general Agent route');
  assert(!Object.prototype.hasOwnProperty.call(payload, 'category') && !Object.prototype.hasOwnProperty.call(payload, 'priority'), 'ask leaked save overrides');
  assert(harness.elements.get('#category').value === '開発', 'ask success reset category');
});

test('EVA-03J buttons disable together while retaining fixed labels', async () => {
  const harness = createHarness();
  let release;
  harness.setResponder((payload) => new Promise((resolve) => { release = () => resolve({ success: true, reply: '確認したで。', sessionId: payload.sessionId, clientRequestId: payload.clientRequestId }); }));
  const pending = harness.ask('書斎暑い？');
  await Promise.resolve();
  assert(harness.elements.get('#askPaluruButton').disabled && harness.elements.get('#saveToPaluruButton').disabled, 'both buttons were not disabled');
  assert(harness.elements.get('#askPaluruButton').textContent === '💬 確認中…', 'consult button loading label changed');
  assert(harness.elements.get('#saveToPaluruButton').textContent === '📝 登録する', 'register button label changed while consult is processing');
  assert(!appSource.includes('ぱるるに頼' + 'む'), 'legacy consult-button label remains');
  release();
  await pending;
  assert(!harness.elements.get('#askPaluruButton').disabled && !harness.elements.get('#saveToPaluruButton').disabled, 'buttons remained disabled');
  assert(harness.elements.get('#askPaluruButton').textContent === '💬 相談する', 'consult button did not restore after loading');
  assert(harness.elements.get('#saveToPaluruButton').textContent === '📝 登録する', 'register button did not restore after loading');
});

test('EVA-03J save success resets only save overrides while ask success keeps them', async () => {
  const ask = createHarness();
  ask.elements.get('#category').value = '開発';
  await ask.run('categoryExplicitlySelected = true');
  await ask.ask('予定表示を改行する');
  assert(ask.elements.get('#category').value === '開発', 'ask success reset the category override');

  const save = createHarness();
  save.elements.get('#category').value = '開発';
  await save.run('categoryExplicitlySelected = true');
  save.element('input[name="priority"][value="High"]').checked = true;
  await save.run('priorityExplicitlySelected = true');
  await save.save('普通のメモ');
  assert(save.elements.get('#category').value === '', 'save success did not reset category to AI selection');
  assert(save.element('input[name="priority"][value=""]').checked, 'save success did not reset priority to AI selection');
});

test('C non-transient Agent error keeps input without fallback or retry prompt', async () => {
  const harness = createHarness();
  harness.setResponder(() => ({ success: false, error: { code: 'AGENT_ERROR' } }));
  await harness.submit('書斎暑い？');
  assert(harness.elements.get('#memo').value === '書斎暑い？', 'input was cleared on error');
  assert(harness.elements.get('#homeAgentRetryButton').classList.contains('is-hidden'), 'non-transient error showed retry');
  assert(harness.elements.get('#homeAgentContent').innerHTML.includes('home-agent-error'), 'Agent error was not rendered in card');
  assert(harness.elements.get('#message').textContent === '', 'Agent error leaked to form message');
  assert(harness.run('pendingHomeAgentRetry.clientRequestId') === harness.requests[0].payload.clientRequestId, 'failed request identity was lost');
  const actions = harness.requests.filter((entry) => entry.payload).map((entry) => entry.payload.action);
  assert(JSON.stringify(actions) === JSON.stringify(['agentChat']), 'error silently fell back');
});

test('D retry reuses clientRequestId and double submit is blocked', async () => {
  const harness = createHarness();
  harness.setResponder(() => ({ success: false, error: { code: 'AGENT_UNAVAILABLE' } }));
  await harness.submit('書斎暑い？');
  const first = harness.requests[0].payload;
  assert(harness.elements.get('#message').textContent === '', 'transient Agent error leaked to form message');
  assert(!harness.elements.get('#homeAgentRetryButton').classList.contains('is-hidden'), 'transient failure did not offer retry');
  harness.setResponder((payload) => ({ success: true, reply: '確認できたで。', sessionId: payload.sessionId, clientRequestId: payload.clientRequestId }));
  await harness.run('submitAgentChatQuery(pendingHomeAgentRetry.message, { request: pendingHomeAgentRetry })');
  const second = harness.requests[1].payload;
  assert(first.clientRequestId === second.clientRequestId, 'retry changed clientRequestId');
  assert(harness.elements.get('#message').textContent === '', 'retry success left old form message');

  const duplicateHarness = createHarness();
  const firstSubmit = duplicateHarness.submit('書斎暑い？');
  const secondSubmit = duplicateHarness.submit('書斎暑い？');
  await Promise.all([firstSubmit, secondSubmit]);
  assert(duplicateHarness.requests.filter((entry) => entry.payload?.action === 'agentChat').length === 1, 'double submit was not blocked');
});

test('D2 Agent start and later Climate success clear stale form errors', async () => {
  const harness = createHarness();
  harness.elements.get('#message').textContent = 'stale red error';
  harness.elements.get('#message').className = 'message error';
  await harness.submit('書斎暑い？');
  assert(harness.elements.get('#message').textContent === '', 'Agent success left stale form error');
  harness.elements.get('#message').textContent = 'stale red error';
  harness.elements.get('#message').className = 'message error';
  await harness.submit('リビングのエアコンどうなってる？');
  assert(harness.elements.get('#message').textContent === '', 'next Climate success left stale form error');
});

test('D3 legacy Home Agent error stays in Agent card only', async () => {
  const harness = createHarness();
  harness.setActionResponder((payload) => payload.action === 'homeAgent' ? { success: false, error: { code: 'FAILED' } } : { success: true, item: {} });
  await harness.submit('今日の給食は？');
  assert(harness.elements.get('#homeAgentContent').innerHTML.includes('home-agent-error'), 'Home Agent error was not rendered in card');
  assert(harness.elements.get('#message').textContent === '', 'Home Agent error leaked to form message');
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
  harness.storage.set('paruru-mini-home-agent-pairing-v1', 'pairing-token-placeholder-000000000001');
  const payload = harness.run('buildAgentChatPayload("書斎暑い？")');
  assert(/^[0-9a-f-]{36}$/i.test(payload.sessionId), 'invalid session was not regenerated');
  assert(harness.storage.get('paruru-mini-agent-chat-session-v1') === payload.sessionId, 'new session was not stored');
  assert(payload.pairingToken === 'pairing-token-placeholder-000000000001', 'agentChat pairing token was not attached');
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
    assert(harness.elements.get('#homeAgentRetryButton').classList.contains('is-hidden'), 'malformed response was presented as transient');
    assert(harness.elements.get('#homeAgentContent').innerHTML.includes('home-agent-error'), 'safe non-transient error missing');
    assert(harness.elements.get('#message').textContent === '', 'malformed Agent response leaked to form message');
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

test('EVA-03I-2B automation and aircon operation requests route to Agent', async () => {
  const cases = [
    { message: '寝室の自動制御を1時間止めて', expected: 'agentChat' },
    { message: '寝室の自動制御を再開して', expected: 'agentChat' },
    { message: '寝室を通常運転に戻して', expected: 'agentChat' },
    { message: 'エアコンつけて', expected: 'agentChat' },
    { message: '1度下げて', expected: 'agentChat' },
    { message: '除湿にして', expected: 'agentChat' },
  ];
  for (const item of cases) {
    const harness = createHarness();
    await harness.submit(item.message);
    const actions = harness.requests.map((entry) => entry.payload?.action).filter(Boolean);
    assert(actions[0] === item.expected, item.message + ' routed to ' + actions.join(','));
  }
});

test('EVA-03I-2B aircon confirmation uses the existing safe card and immutable confirm body', async () => {
  const harness = createHarness();
  harness.setResponder((payload) => ({
    success: true, reply: '実行前に確認するで。', sessionId: payload.sessionId, clientRequestId: payload.clientRequestId,
    actionConfirmation: {
      required: true, confirmationId: '88888888-8888-4888-8888-888888888888', command: 'aircon.applySettings',
      roomLabel: 'リビング', summary: 'リビングを冷房25℃・風量自動に変更し、自動制御による上書きを60分間抑止します', expiresAt: '2026-07-19T21:05:00+09:00'
    }
  }));
  await harness.ask('リビングを冷房25℃、風量自動にして');
  const html = harness.elements.get('#homeAgentContent').innerHTML;
  assert(html.includes('冷房25℃・風量自動') && html.includes('data-home-agent-action-execute'), 'aircon confirmation card missing');
  harness.storage.set('paruru-mini-home-agent-pairing-v1', 'pairing-token-placeholder-000000000001');
  await harness.run(`executeAgentActionConfirmation({ type: 'agentActionConfirmation', confirmationId: '88888888-8888-4888-8888-888888888888', clientRequestId: '6ba7b810-9dad-41d1-80b4-00c04fd430c8', command: 'aircon.applySettings', confirmationMessage: 'safe' })`);
  const sent = harness.requests[harness.requests.length - 1].payload;
  ['command', 'operation', 'roomId', 'mode', 'setpointC', 'fan', 'overrideMinutes', 'confirmed'].forEach((field) => assert(!Object.prototype.hasOwnProperty.call(sent, field), field + ' leaked from PWA confirm'));
});

test('EVA-03G Agent confirmation card is rendered from structured field', async () => {
  const harness = createHarness();
  harness.setResponder((payload) => ({
    success: true,
    reply: '寝室の自動制御を1時間停止するで。実行してええ？',
    sessionId: payload.sessionId,
    clientRequestId: payload.clientRequestId,
    actionConfirmation: {
      required: true,
      confirmationId: '88888888-8888-4888-8888-888888888888',
      command: 'automation.pause',
      roomLabel: '寝室',
      summary: '寝室の自動制御を60分停止します',
      expiresAt: '2026-07-19T21:05:00+09:00',
      payload: { roomId: 'bedroom', durationMinutes: 60 },
    },
  }));
  await harness.submit('寝室の自動制御を1時間止めて');
  const html = harness.elements.get('#homeAgentContent').innerHTML;
  assert(html.includes('data-home-agent-action-execute'), 'execute button missing');
  assert(html.includes('寝室の自動制御を60分停止します'), 'confirmation summary missing');
  assert(!html.includes('bedroom') && !html.includes('durationMinutes'), 'raw operation payload leaked');
});

test('EVA-03G confirm sends only confirmation identifiers and pairing token to Mini GAS', async () => {
  const harness = createHarness();
  harness.storage.set('paruru-mini-home-agent-pairing-v1', 'pairing-token-placeholder-000000000001');
  await harness.run(`executeAgentActionConfirmation({
    type: "agentActionConfirmation",
    confirmationId: "88888888-8888-4888-8888-888888888888",
    clientRequestId: "6ba7b810-9dad-41d1-80b4-00c04fd430c8",
    command: "automation.pause",
    confirmationMessage: "寝室の自動制御を60分停止します",
    payload: { roomId: "bedroom", durationMinutes: 60 }
  })`);
  const sent = harness.requests[harness.requests.length - 1].payload;
  assert(sent.action === 'agentActionConfirm', 'wrong confirm action');
  assert(sent.confirmationId && sent.clientRequestId && sent.pairingToken, 'required confirm identifiers missing');
  ['operation', 'skill', 'roomId', 'duration', 'durationMinutes', 'confirmed', 'payload'].forEach((field) => {
    assert(!Object.prototype.hasOwnProperty.call(sent, field), field + ' leaked from PWA confirm');
  });
});

test('EVA-03I-2B cancel closes only the operation card and keeps the draft', async () => {
  const harness = createHarness();
  harness.storage.set('paruru-mini-home-agent-pairing-v1', 'pairing-token-placeholder-000000000001');
  harness.elements.get('#memo').value = '子ども部屋を冷房24℃、風量自動にして';
  harness.elements.get('#category').value = '家';
  harness.element('input[name="priority"][value="High"]').checked = true;
  harness.setActionResponder((payload) => ({ success: true, status: 'cancelled', operation: 'pause' }));
  await harness.run(`renderHomeAgentActionConfirmation({
    type: 'agentActionConfirmation',
    confirmationId: '88888888-8888-4888-8888-888888888888',
    clientRequestId: '6ba7b810-9dad-41d1-80b4-00c04fd430c8',
    command: 'aircon.applySettings', roomLabel: '子ども部屋', confirmationMessage: 'prepare marker'
  }); cancelPendingHomeAgentAction()`);
  assert(harness.elements.get('#homeAgentCard').classList.contains('is-hidden'), 'cancel left the Agent card visible');
  assert(harness.elements.get('#homeAgentContent').innerHTML === '', 'cancel left the confirmation content');
  assert(harness.run('pendingHomeAgentActionCandidate') === null, 'cancel retained the confirmation id');
  assert(harness.elements.get('#memo').value === '子ども部屋を冷房24℃、風量自動にして', 'cancel cleared the user draft');
  assert(harness.elements.get('#category').value === '家' && harness.element('input[name="priority"][value="High"]').checked, 'cancel changed save overrides');
  assert(harness.requests.filter((entry) => entry.payload?.action === 'agentActionCancel').length === 1, 'cancel request count changed');
});

test('EVA-03I-2B cancel failure retains the operation card and confirmation', async () => {
  const harness = createHarness();
  harness.elements.get('#homeAgentCard').classList.remove('is-hidden');
  harness.storage.set('paruru-mini-home-agent-pairing-v1', 'pairing-token-placeholder-000000000001');
  harness.elements.get('#memo').value = '操作依頼';
  harness.setActionResponder(() => ({ success: false, error: { code: 'AGENT_ACTION_FAILED' } }));
  await harness.run(`renderHomeAgentActionConfirmation({
    type: 'agentActionConfirmation',
    confirmationId: '88888888-8888-4888-8888-888888888888',
    clientRequestId: '6ba7b810-9dad-41d1-80b4-00c04fd430c8',
    command: 'aircon.applySettings', roomLabel: '子ども部屋', confirmationMessage: 'prepare marker'
  }); cancelPendingHomeAgentAction()`);
  assert(!harness.elements.get('#homeAgentCard').classList.contains('is-hidden'), 'cancel failure hid the Agent card');
  assert(harness.run('pendingHomeAgentActionCandidate.confirmationId') === '88888888-8888-4888-8888-888888888888', 'cancel failure cleared the confirmation');
  assert(harness.elements.get('#memo').value === '操作依頼', 'cancel failure cleared the draft');
});

test('EVA-03I-2B confirm replaces prepare text with command-specific safe result', async () => {
  const harness = createHarness();
  harness.storage.set('paruru-mini-home-agent-pairing-v1', 'pairing-token-placeholder-000000000001');
  harness.elements.get('#memo').value = '子ども部屋を冷房24℃、風量自動にして';
  harness.setActionResponder(() => ({ success: true, status: 'completed', operation: 'pause', result: {} }));
  await harness.run(`renderHomeAgentActionConfirmation({
    type: 'agentActionConfirmation',
    confirmationId: '88888888-8888-4888-8888-888888888888',
    clientRequestId: '6ba7b810-9dad-41d1-80b4-00c04fd430c8',
    command: 'aircon.applySettings', roomLabel: '子ども部屋', confirmationMessage: 'prepare marker'
  }); executePendingHomeAgentAction()`);
  const html = harness.elements.get('#homeAgentContent').innerHTML;
  assert(html.includes('子ども部屋のエアコン設定の変更操作を受け付けました'), 'aircon result used the pause message');
  assert(!html.includes('prepare marker') && !html.includes('一時停止しました'), 'prepare text was appended instead of replaced');
  assert(!html.includes('完了しました') && !html.includes('反映しました'), 'result overclaimed verification');
  assert(harness.elements.get('#memo').value === '', 'completed action did not clear the draft');
  assert(harness.run('pendingHomeAgentActionCandidate') === null, 'completed action retained confirmation state');
  await harness.run('executePendingHomeAgentAction()');
  assert(harness.requests.filter((entry) => entry.payload?.action === 'agentActionConfirm').length === 1, 'completed action could execute twice');
});

test('EVA-03I-2B command result labels never fall back to pause', () => {
  const harness = createHarness();
  const pause = harness.run(`formatAgentActionResult({ status: 'completed' }, {}, { command: 'automation.pause' })`);
  const resume = harness.run(`formatAgentActionResult({ status: 'completed' }, {}, { command: 'automation.resume' })`);
  const unknown = harness.run(`formatAgentActionResult({ status: 'completed' }, {}, { command: 'other.command' })`);
  const legacyPause = harness.run(`formatAgentActionResult({ status: 'completed', operation: 'pause' }, {}, { type: 'homeAgentActionConfirmation' })`);
  const failed = harness.run(`formatAgentActionResult({ status: 'failed' }, {}, { command: 'aircon.applySettings' })`);
  const resultUnknown = harness.run(`formatAgentActionResult({ status: 'unknown' }, {}, { command: 'aircon.applySettings' })`);
  assert(pause === '自動制御を一時停止しました', 'pause result label changed');
  assert(resume === '自動制御を再開しました', 'resume result label changed');
  assert(unknown === '操作を受け付けました', 'unknown command became a pause result');
  assert(legacyPause.includes('自動制御を一時停止'), 'legacy pause result regressed');
  assert(failed.includes('受け付けられませんでした') && !failed.includes('prepare'), 'failed action did not replace prepare text safely');
  assert(resultUnknown.includes('操作結果を確認できませんでした') && resultUnknown.includes('最初から頼んでな'), 'unknown action did not require a new prepare');
});

test('EVA-03G cancel sends only confirmation identifiers and pairing token to Mini GAS', async () => {
  const harness = createHarness();
  harness.storage.set('paruru-mini-home-agent-pairing-v1', 'pairing-token-placeholder-000000000001');
  harness.setActionResponder((payload) => {
    assert(payload.action === 'agentActionCancel', 'wrong cancel action');
    assert(payload.confirmationId === '88888888-8888-4888-8888-888888888888', 'confirmation id missing');
    assert(payload.clientRequestId === '6ba7b810-9dad-41d1-80b4-00c04fd430c8', 'clientRequestId missing');
    assert(payload.deviceId && payload.pairingToken, 'device or pairing token missing');
    ['operation', 'skill', 'roomId', 'duration', 'durationMinutes', 'confirmed', 'payload'].forEach((field) => {
      assert(!Object.prototype.hasOwnProperty.call(payload, field), field + ' leaked from PWA cancel');
    });
    return { success: true, status: 'cancelled', operation: 'pause', roomLabel: '寝室' };
  });
  await harness.run(`cancelAgentActionConfirmation({
    confirmationId: "88888888-8888-4888-8888-888888888888",
    clientRequestId: "6ba7b810-9dad-41d1-80b4-00c04fd430c8"
  })`);
  const sent = harness.requests[harness.requests.length - 1].payload;
  assert(sent.action === 'agentActionCancel', 'cancel was not sent');
});

test('EVA-03G legacy confirmation close does not call cancel endpoint', async () => {
  const harness = createHarness();
  await harness.run(`renderHomeAgentActionConfirmation({
    type: "homeAgentActionConfirmation",
    skill: "pauseRoomAutomation",
    confirmationId: "88888888-8888-4888-8888-888888888888",
    clientRequestId: "6ba7b810-9dad-41d1-80b4-00c04fd430c8",
    confirmationMessage: "legacy"
  });
  cancelPendingHomeAgentAction()`);
  assert(harness.requests.length === 0, 'legacy close called cancel endpoint');
});

test('home.control capability gates action UI and direct action transports', async () => {
  const harness = createHarness();
  harness.run('activeMembershipContext = { role: "admin", capabilities: ["home.read"] }; userProfile = { role: "admin", capabilities: ["home.control"] };');
  harness.run(`renderHomeAgentResult({
    summary: "家の状態は確認できたよ。",
    actionCandidates: [{ type: "homeAgentActionConfirmation", confirmationId: "88888888-8888-4888-8888-888888888888", clientRequestId: "6ba7b810-9dad-41d1-80b4-00c04fd430c8", skill: "pauseRoomAutomation" }]
  });`);
  const html = harness.elements.get('#homeAgentContent').innerHTML;
  assert(html.includes('家の状態は確認できたよ。'), 'read response was hidden without home.control');
  assert(html.includes('この端末では家の状態確認だけ利用できます。'), 'control-unavailable guidance missing');
  assert(!html.includes('data-home-agent-action') && !html.includes('data-home-agent-action-execute'), 'control UI rendered without capability');
  await expectReject(harness.run('executeHomeAgentAction({})'), 'HOME_CONTROL_FORBIDDEN');
  await expectReject(harness.run('executeAgentActionConfirmation({})'), 'HOME_CONTROL_FORBIDDEN');
  await expectReject(harness.run('cancelAgentActionConfirmation({})'), 'HOME_CONTROL_FORBIDDEN');
  await harness.run(`renderHomeAgentActionConfirmation({ type: 'agentActionConfirmation', confirmationId: '88888888-8888-4888-8888-888888888888', clientRequestId: '6ba7b810-9dad-41d1-80b4-00c04fd430c8' }); executePendingHomeAgentAction(); cancelPendingHomeAgentAction();`);
  assert(harness.requests.length === 0, 'direct action path sent a request without home.control');
  harness.run('activeMembershipContext = { capabilities: ["home.control"] }; showAuthenticationState("locked", "revoked_error");');
  assert(harness.run('canUseHomeControl_()') === false, 'authentication release retained home.control');
});

test('admin membership context retains Home Agent action controls', () => {
  const harness = createHarness();
  harness.run('activeMembershipContext = { role: "self_record", capabilities: ["home.control"] }; userProfile = { role: "self_record", capabilities: [] };');
  harness.run(`renderHomeAgentResult({ actionCandidates: [{ type: "homeAgentActionConfirmation", confirmationId: "88888888-8888-4888-8888-888888888888", clientRequestId: "6ba7b810-9dad-41d1-80b4-00c04fd430c8", skill: "pauseRoomAutomation" }] });`);
  assert(harness.elements.get('#homeAgentContent').innerHTML.includes('data-home-agent-action'), 'server capability did not retain action candidate');
});

test('Inbox list keeps legacy active rows without date user or visibility filtering', () => {
  const harness = createHarness();
  harness.context.__items = [
    { status: 'Inbox', createdAt: '2025-01-01', userId: '', visibility: '' },
    { status: 'inbox', createdAt: '2024-01-01', userId: '', visibility: '' },
    { status: '', createdAt: '2023-01-01', userId: '', visibility: '' },
    { status: 'Pending', createdAt: '2022-01-01', userId: '', visibility: '' },
    { status: 'Done', createdAt: '2026-07-19', userId: 'father', visibility: 'private' },
    { status: 'completed', createdAt: '2026-07-19', userId: 'father', visibility: 'private' },
    { status: 'deleted', createdAt: '2026-07-19', userId: 'father', visibility: 'private' },
  ];
  const visible = harness.run('__items.filter(isInboxItem)');
  assert(visible.length === 4, 'legacy active Inbox rows were filtered');
  assert(harness.run('normalizeInboxStatus("Inbox")') === 'inbox', 'Inbox case normalization failed');
  assert(harness.run('normalizeInboxStatus("inbox")') === 'inbox', 'lowercase inbox normalization failed');
});

test('Inbox API failure is distinct from a successful empty list and offers retry', async () => {
  const empty = createHarness();
  empty.run('fetchInboxItems = async function() { return []; }');
  await empty.run('loadInbox()');
  assert(empty.elements.get('#inboxList').innerHTML.includes('今日はまだ何も預かってないよ'), 'successful zero was not rendered as empty');
  assert(!empty.elements.get('#inboxList').innerHTML.includes('data-inbox-retry'), 'successful zero showed retry');

  const failed = createHarness();
  failed.run('fetchInboxItems = async function() { throw new Error("failed"); }');
  await failed.run('loadInbox()');
  const html = failed.elements.get('#inboxList').innerHTML;
  assert(html.includes('Inboxを読み込めませんでした'), 'failure was rendered as empty');
  assert(html.includes('data-inbox-retry'), 'failure retry is missing');
  failed.context.__retryCalls = 0;
  failed.run('loadInbox = async function() { __retryCalls += 1; }');
  failed.handlers.get('#inboxList:click')({
    target: { closest: (selector) => selector === '[data-inbox-retry]' ? {} : null }
  });
  await Promise.resolve();
  assert(failed.context.__retryCalls === 1, 'Inbox retry did not call loadInbox');
});

test('EVA-03H1 pairing UI uses explicit onboarding actions and has no manual token field', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert(!html.includes('profileHomeAgentPairingToken'), 'manual pairing token input remains in the normal UI');
  assert(html.includes('homeControlEnableButton') && html.includes('homeControlApproveButton'), 'pairing onboarding controls are missing');
  ['devicePairingBegin', 'devicePairingApprove', 'devicePairingStatus', 'devicePairingRevoke'].forEach((action) => {
    assert(appSource.includes(`action: "${action}"`), `missing explicit onboarding action: ${action}`);
  });
  assert(appSource.includes('crypto?.getRandomValues') && appSource.includes('crypto?.subtle') && appSource.includes('crypto.subtle.digest'), 'PWA token generation is not Web Crypto based');
});

test('home action labels are centralized in JavaScript and mobile grid stays two-column', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const style = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
  const legacyLabels = [
    ['ぱるるに頼', 'む'].join(''),
    ['ぱるるに預け', 'る'].join(''),
  ];
  legacyLabels.forEach((legacy) => assert(!html.includes(legacy) && !style.includes(legacy) && !appSource.includes(legacy), legacy + ' remains in UI source'));
  assert(appSource.includes('label: "💬 相談する"') && appSource.includes('label: "📝 登録する"'), 'new action labels missing');
  assert(style.includes('grid-template-columns: repeat(2, minmax(0, 1fr))') && style.includes('white-space: nowrap;'), 'two-button mobile overflow guard changed');
});

test('home input asks before changing a consultation into registration, and switching does not loop', async () => {
  const harness = createHarness();
  const memo = '牛乳を買う';
  await harness.ask(memo);
  assert(harness.requests.length === 0, 'consult sent an API request before registration confirmation');
  assert(!harness.elements.get('#homeIntentConfirm').classList.contains('is-hidden'), 'consult-to-register confirmation was not shown');
  assert(harness.elements.get('#homeIntentConfirmMessage').textContent.includes('登録する内容っぽいで'), 'consult-to-register message changed');
  assert(harness.elements.get('#homeIntentConfirmSwitch').textContent === '📝 登録する', 'switch action label is wrong');

  await harness.handlers.get('#homeIntentConfirmSwitch:click')();
  const actions = harness.requests.filter((entry) => entry.payload).map((entry) => entry.payload.action);
  assert(actions.includes('createWithAI') && !actions.includes('agentChat'), 'confirmed register switch did not use the existing registration path');
  assert(harness.elements.get('#homeIntentConfirm').classList.contains('is-hidden'), 'confirmation stayed open after switching');
});

test('home input asks before changing registration into consultation', async () => {
  const harness = createHarness();
  await harness.save('今日の気温を教えて');
  assert(harness.requests.length === 0, 'register sent an API request before consultation confirmation');
  assert(!harness.elements.get('#homeIntentConfirm').classList.contains('is-hidden'), 'register-to-consult confirmation was not shown');
  assert(harness.elements.get('#homeIntentConfirmMessage').textContent.includes('相談したら'), 'register-to-consult message changed');
  assert(harness.elements.get('#homeIntentConfirmKeep').textContent === '📝 登録のまま進む', 'keep-registration label is wrong');

  await harness.handlers.get('#homeIntentConfirmSwitch:click')();
  assert(harness.requests.some((entry) => entry.payload?.action === 'agentChat'), 'confirmed consult switch did not use the existing consultation path');
  assert(harness.elements.get('#homeIntentConfirm').classList.contains('is-hidden'), 'consult confirmation looped after switching');
});

test('ambiguous input preserves the selected route and cancel sends nothing', async () => {
  const consult = createHarness();
  await consult.ask('メロンパン');
  assert(consult.requests.some((entry) => entry.payload?.action === 'agentChat'), 'ambiguous consult input did not stay on consult');

  const register = createHarness();
  await register.save('メロンパン');
  assert(register.requests.some((entry) => entry.payload?.action === 'createWithAI'), 'ambiguous register input did not stay on register');

  const cancel = createHarness();
  await cancel.ask('牛乳を買う');
  await cancel.handlers.get('#homeIntentConfirmCancel:click')();
  assert(cancel.requests.length === 0, 'cancel sent an API request');
  assert(cancel.elements.get('#homeIntentConfirm').classList.contains('is-hidden'), 'cancel did not close confirmation');
});

test('agentChat diagnostics correlate the final echo response with clientRequestId', async () => {
  const harness = createHarness();
  await harness.run('callAgentChat({ action: "agentChat", message: "test", sessionId: "11111111-1111-4111-8111-111111111111", clientRequestId: "22222222-2222-4222-8222-222222222222" })');
  const fetchLog = harness.logs.find((entry) => entry.level === 'info' && entry.args[1]?.reason === 'FETCH_RESPONSE');
  const rawLog = harness.logs.find((entry) => entry.level === 'info' && entry.args[1]?.reason === 'RAW_RESPONSE');
  const jsonLog = harness.logs.find((entry) => entry.level === 'info' && entry.args[1]?.reason === 'JSON_RESPONSE');
  assert(fetchLog?.args[1]?.clientRequestId === '22222222-2222-4222-8222-222222222222', 'response log lost clientRequestId');
  assert(fetchLog?.args[1]?.responseUrl.includes('script.googleusercontent.com'), 'final echo URL was not logged');
  assert(fetchLog?.args[1]?.status === 200 && fetchLog.args[1]?.ok === true, 'HTTP response metadata missing');
  assert(rawLog?.args[1]?.bodyFormat === 'json' && rawLog.args[1]?.bodyLength > 0, 'raw body diagnostics missing');
  assert(jsonLog?.args[1]?.success === true && jsonLog.args[1]?.expectedFields.reply, 'parsed JSON diagnostics missing');
});

test('agentChat logs EMPTY_RESPONSE and JSON_PARSE_FAILED without calling response.json', async () => {
  const empty = createHarness();
  empty.setAgentResponseFactory((payload, body, makeResponse) => makeResponse(body, { rawBody: '' }));
  try {
    await empty.run('callAgentChat({ action: "agentChat", sessionId: "11111111-1111-4111-8111-111111111111", clientRequestId: "22222222-2222-4222-8222-222222222222" })');
    throw new Error('empty response unexpectedly succeeded');
  } catch (error) {
    assert(error.agentChatReason === 'EMPTY_RESPONSE', 'empty response reason was not preserved');
  }
  assert(empty.logs.some((entry) => entry.args[1]?.reason === 'EMPTY_RESPONSE'), 'empty response was not logged');

  const invalid = createHarness();
  invalid.setAgentResponseFactory((payload, body, makeResponse) => makeResponse(body, { rawBody: '<html>gateway error</html>', headers: { 'content-type': 'text/html' } }));
  try {
    await invalid.run('callAgentChat({ action: "agentChat", sessionId: "11111111-1111-4111-8111-111111111111", clientRequestId: "22222222-2222-4222-8222-222222222222" })');
    throw new Error('HTML response unexpectedly succeeded');
  } catch (error) {
    assert(error.agentChatReason === 'JSON_PARSE_FAILED', 'parse failure reason was not preserved');
  }
  const parseLog = invalid.logs.find((entry) => entry.args[1]?.reason === 'JSON_PARSE_FAILED');
  assert(parseLog?.args[1]?.rawResponse.includes('<html>'), 'parse log omitted raw response preview');
  assert(parseLog?.args[1]?.responseUrl.includes('script.googleusercontent.com'), 'parse log omitted final URL');
});

test('agentChat logs API_SUCCESS_FALSE and fetch rejection with the same request context', async () => {
  const apiFailure = createHarness();
  apiFailure.setResponder(() => ({ success: false, error: { code: 'INVALID_INPUT', message: 'bad request' } }));
  try {
    await apiFailure.run('callAgentChat({ action: "agentChat", sessionId: "11111111-1111-4111-8111-111111111111", clientRequestId: "22222222-2222-4222-822222222222" })');
  } catch (_) {}
  const apiLog = apiFailure.logs.find((entry) => entry.args[1]?.reason === 'API_SUCCESS_FALSE');
  assert(apiLog?.args[1]?.code === 'INVALID_INPUT', 'API error code was not logged');

  const rejected = createHarness();
  rejected.setAgentResponseFactory(() => Promise.reject(new Error('CORS blocked final echo')));
  try {
    await rejected.run('callAgentChat({ action: "agentChat", sessionId: "11111111-1111-4111-8111-111111111111", clientRequestId: "22222222-2222-4222-8222-222222222222" })');
    throw new Error('fetch rejection unexpectedly succeeded');
  } catch (error) {
    assert(error.agentChatReason === 'FETCH_FAILED', 'fetch failure reason was not preserved');
  }
  const fetchFailure = rejected.logs.find((entry) => entry.args[1]?.reason === 'FETCH_FAILED');
  assert(fetchFailure?.args[1]?.action === 'agentChat' && fetchFailure.args[1]?.clientRequestId, 'fetch failure was not correlated');
});

test('I JavaScript syntax and J cache versions', () => {
  new vm.Script(appSource, { filename: 'app.js' });
  new vm.Script(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), { filename: 'sw.js' });
  const expected = 'v20260801-pwa-update-1';
  const buildSource = fs.readFileSync(path.join(root, 'build.js'), 'utf8');
  assert((buildSource.match(/globalThis\.BUILD_ID\s*=/g) || []).length === 1 && buildSource.includes('globalThis.BUILD_ID = "' + expected + '"'), 'BUILD_ID must have one definition');
  assert(appSource.includes('Build: ${globalThis.BUILD_ID}') && !/const\s+(?:ASSET_VERSION|BUILD_VERSION|BUILD_ID)\s*=/.test(appSource), 'app does not use BUILD_ID as the only Build display source');
  assert(fs.readFileSync(path.join(root, 'sw.js'), 'utf8').includes('importScripts("./build.js")') && fs.readFileSync(path.join(root, 'sw.js'), 'utf8').includes('const CACHE_NAME = `paruru-mini-${globalThis.BUILD_ID}`') && !/const\s+ASSET_VERSION\s*=/.test(fs.readFileSync(path.join(root, 'sw.js'), 'utf8')), 'SW does not use BUILD_ID for CACHE_NAME');
  assert(fs.readFileSync(path.join(root, 'index.html'), 'utf8').includes('<script src="./build.js" defer></script>'), 'HTML does not load BUILD_ID');
  assert(appSource.includes('updateViaCache: "none"'), 'service worker updateViaCache changed');
  const swSource = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert(swSource.includes('self.skipWaiting()') && swSource.includes('self.clients.claim()'), 'service worker activation safeguards changed');
  const manifestSource = fs.readFileSync(path.join(root, 'manifest.json'), 'utf8').replace(/^\uFEFF/, '');
  const manifest = JSON.parse(manifestSource);
  assert(manifest.icons.every((icon) => !icon.src.includes('?v=')), 'manifest duplicates BUILD_ID');
  const versionedAssets = [buildSource, appSource, swSource, fs.readFileSync(path.join(root, 'index.html'), 'utf8'), manifestSource].join('\n');
  assert(!versionedAssets.includes('20260718-04'), 'old PWA build reference remains');
  assert(!/v=20260719-0[0-3]/.test(versionedAssets), 'older July PWA asset reference remains');
  assert(!versionedAssets.includes('20260719-10'), 'previous PWA asset reference remains');
  assert(!versionedAssets.includes('v20260727-pwa-hotfix'), 'old Build value remains in PWA runtime');
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

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const build = fs.readFileSync(path.join(root, 'build.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const navigation = fs.readFileSync(path.join(root, 'features', 'kaz-os', 'navigation.js'), 'utf8');
const personal = fs.readFileSync(path.join(root, 'features', 'kaz-os', 'personal.js'), 'utf8');
const serviceWorker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const gasCode = fs.readFileSync(path.join(root, 'gas', 'Code.js'), 'utf8');
const gasProgress = fs.readFileSync(path.join(root, 'gas', 'KazOsProgress.js'), 'utf8');
const gasInbox = fs.readFileSync(path.join(root, 'gas', 'KazOsInbox.js'), 'utf8');
const gasAnswer = fs.readFileSync(path.join(root, 'gas', 'KazOsInboxAnswer.js'), 'utf8');

const buildMatch = /globalThis\.BUILD_ID\s*=\s*"([^"]+)"/.exec(build);
assert(buildMatch, 'PWA BUILD_ID missing');
assert(serviceWorker.includes(`importScripts("./build.js?v=${buildMatch[1]}")`), 'Service Worker build import is out of sync');
assert(personal.includes('MAX_SOURCE_CLOCK_SKEW_MS = 60_000'), '60 second source clock skew contract regressed');

assert(app.includes('kazOsInboxApi: callAuthenticatedKazOsInbox_'), 'authenticated event omits INBOX read API');
assert(app.includes('buildMemoCredentialPayload("kazOs.inbox.get")'), 'INBOX read action missing');
assert(app.includes('request_id: requestId'), 'opaque INBOX request id missing');
assert(app.includes('typeof cryptoApi.randomUUID !== "function"'), 'request id generation must fail closed');
assert(app.includes('buildMemoCredentialPayload("kazOs.inbox.answer")'), 'answer action missing');
assert(app.includes('const KAZ_OS_READ_TIMEOUT_MS = 8000'), 'Kaz OS read timeout missing');
assert(app.includes('return callDirectKazOsRead_("projects")') && app.includes('callHomeControlReadOnlyApi_(buildMemoCredentialPayload("kazOs.projects.get"))'), 'Projects transport switch missing');
assert(app.includes('return callDirectKazOsRead_("work")') && app.includes('callHomeControlReadOnlyApi_(buildMemoCredentialPayload("kazOs.work.get"))'), 'Work transport switch missing');
assert(app.includes('callHomeControlReadOnlyApi_(buildMemoCredentialPayload("kazOs.today.get"))'), 'TODAY read retry wrapper missing');
assert(app.includes(': await callHomeControlReadOnlyApi_({') && app.includes('buildMemoCredentialPayload("kazOs.inbox.get")'), 'INBOX read retry wrapper missing');
assert(app.includes('if (attempt > 0 || !isKazOsReadRetryable_(error)) throw error;'), 'Kaz OS read retry must be bounded to one retry');
const answerStart = app.indexOf('async function callAuthenticatedKazOsInboxAnswer_');
const answerEnd = app.indexOf('function applyMembershipCapabilityVisibility_', answerStart);
const answerSource = answerStart >= 0 && answerEnd > answerStart ? app.slice(answerStart, answerEnd) : '';
assert(answerSource.includes('await callHomeControlApi({') && answerSource.includes('buildMemoCredentialPayload("kazOs.inbox.answer")')
  && !answerSource.includes('callHomeControlReadOnlyApi_'), 'INBOX answer must remain on non-retrying write path');
assert(!app.includes('buildMemoCredentialPayload("kazOs.inbox.update")'), 'mutation action must remain disabled');
for (const [name, source] of [['app.js', app], ['gas/Code.js', gasCode], ['gas/KazOsProgress.js', gasProgress], ['gas/KazOsInbox.js', gasInbox], ['gas/KazOsInboxAnswer.js', gasAnswer]]) {
  assert(!source.includes('KAZ_OS_INBOX_LIVE_ENABLED'), `${name} must not revive the deprecated INBOX read flag`);
}

assert(html.includes('href="#kaz-os/inbox"'), 'INBOX navigation missing');
assert(html.includes('features/kaz-os/inbox.js'), 'INBOX renderer not loaded');
assert(html.includes('href="#kaz-os/today"'), 'TODAY navigation missing');
assert(!html.includes('data-kaz-page="diagnostics"'), 'Diagnostics must remain outside this release');
assert(serviceWorker.includes('versioned("features/kaz-os/inbox.js")'), 'INBOX renderer missing from app shell');

assert(navigation.includes("context?.role === 'admin' && context.allowedViews?.includes('kaz-os')"), 'Kaz-only client gate missing');
assert(navigation.includes("data?.mode === 'read_only_display'"), 'read-only mode gate missing');
assert(navigation.includes("data?.persistence?.status === 'disabled'"), 'disabled persistence gate missing');
assert(navigation.includes("data?.writes?.notion === 0"), 'Notion write gate missing');
assert(navigation.includes("data?.writes?.calendar === 0"), 'Calendar write gate missing');
assert(navigation.includes("data?.writes?.context === 0"), 'Context write gate missing');
assert(navigation.includes("data?.mode === 'controlled_proposal'"), 'controlled proposal mode gate missing');
assert(navigation.includes('kazOsInboxAnswerApi'), 'answer API must be wired through authenticated event');
assert(!navigation.includes('localStorage'), 'INBOX response must not be persisted locally');
assert(!navigation.includes('kaz-personal-scale'), 'fixture fallback must not be wired');

const inboxScript = html.indexOf('features/kaz-os/inbox.js');
const personalScript = html.indexOf('features/kaz-os/personal.js');
assert(inboxScript >= 0 && inboxScript < personalScript, 'INBOX renderer must load before personal shell');

function navigationHarness() {
  const listeners = {};
  const anchors = ['today', 'work', 'projects', 'inbox'].map(page => ({
    dataset: { kazPage: page },
    setAttribute(name, value) { this[name] = value; },
    removeAttribute(name) { delete this[name]; },
  }));
  const elements = {
    kazOsView: { classList: { contains: name => name === 'is-active' }, setAttribute() {} },
    kazPersonalContent: { textContent: '', replaceChildren() {} },
    kazOsEntry: { hidden: true },
    kazOsEntryStatus: { textContent: '' },
  };
  const renders = [];
  const context = {
    console,
    Date,
    Error,
    Object,
    Number,
    Math,
    Promise,
    location: { hash: '#kaz-os/inbox' },
    document: {
      hidden: false,
      getElementById: id => elements[id] || null,
      querySelectorAll: selector => selector === '#kazOsNav a' ? anchors : [],
      addEventListener: (name, handler) => { listeners[name] = handler; },
      dispatchEvent: event => listeners[event.type]?.(event),
    },
    window: {
      addEventListener() {},
      scrollTo() {},
    },
    CustomEvent: class CustomEvent { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } },
    setTimeout: () => 1,
    clearTimeout() {},
    KazInboxView: { dispose() {} },
    KazPersonalView: {
      route: () => ({ page: 'inbox', id: null }),
      render: (...args) => renders.push(args),
    },
  };
  vm.createContext(context);
  vm.runInContext(navigation, context, { filename: 'features/kaz-os/navigation.js' });
  return { context, elements, listeners, renders };
}

const freshInbox = () => ({
  mode: 'read_only_display',
  origin: 'real_operational_sources',
  fixture_only: false,
  persistence: { status: 'disabled' },
  writes: { notion: 0, calendar: 0, context: 0 },
  sources: { inbox: { status: 'ok', complete: true, valid_until: new Date(Date.now() + 600000).toISOString() } },
  inbox_items: [],
});
const controlledInbox = (confirmedAnswers = []) => ({ ...freshInbox(), mode: 'controlled_proposal',
  persistence: { kind: 'paluru_spreadsheet_append_only', status: 'enabled', confirmed_answers: confirmedAnswers } });

(async () => {
  const denied = navigationHarness();
  let deniedReads = 0;
  denied.listeners['paruru:authenticated']({ detail: {
    context: { role: 'member', allowedViews: ['home'] },
    kazOsProjectsApi: async () => null,
    kazOsInboxApi: async () => { deniedReads++; return freshInbox(); },
  } });
  await new Promise(setImmediate);
  assert.equal(deniedReads, 0, 'non-Kaz must be denied before source fetch');
  assert.equal(denied.elements.kazOsEntry.hidden, true, 'non-Kaz entry must remain hidden');

  const allowed = navigationHarness();
  let allowedReads = 0;
  allowed.listeners['paruru:authenticated']({ detail: {
    context: { role: 'admin', allowedViews: ['home', 'kaz-os'] },
    kazOsProjectsApi: async () => null,
    kazOsInboxApi: async () => { allowedReads++; return freshInbox(); },
  } });
  await new Promise(setImmediate);
  assert.equal(allowedReads, 1, 'Kaz INBOX must make one read request');
  assert.equal(allowed.elements.kazOsEntry.hidden, false, 'Kaz entry must be visible');
  const rendered = allowed.renders.find(args => args[2]?.mode === 'read_only_display');
  assert(rendered, 'fresh read-only INBOX was not rendered');
  assert.equal(rendered[4].answerApi, null, 'answer API must remain disabled');

  const controlled = navigationHarness();
  let answerCalls = 0;
  controlled.listeners['paruru:authenticated']({ detail: {
    context: { role: 'admin', allowedViews: ['home', 'kaz-os'] },
    kazOsProjectsApi: async () => null,
    kazOsInboxApi: async () => controlledInbox(),
    kazOsInboxAnswerApi: async () => { answerCalls++; return { inbox: controlledInbox() }; },
  } });
  await new Promise(setImmediate);
  const controlledRender = controlled.renders.find(args => args[2]?.mode === 'controlled_proposal');
  assert.equal(typeof controlledRender[4].answerApi, 'function', 'controlled mode answer API missing');
  await controlledRender[4].answerApi({ decision_id: 'd' });
  assert.equal(answerCalls, 1, 'answer API was not called exactly once');

  const reconciled = navigationHarness();
  let reconcileReads = 0;
  const decision = { decision_id: 'decision-response-lost', question_revision: 'question-sha256:response-lost' };
  reconciled.listeners['paruru:authenticated']({ detail: {
    context: { role: 'admin', allowedViews: ['home', 'kaz-os'] },
    kazOsProjectsApi: async () => null,
    kazOsInboxApi: async () => {
      reconcileReads++;
      if (reconcileReads === 1) return controlledInbox();
      return controlledInbox([{ ...decision, persistence_status: 'DURABLE_PERSISTED' }]);
    },
    kazOsInboxAnswerApi: async () => { throw Object.assign(new Error('response lost'), { code: 'HOME_CONTROL_UNAVAILABLE' }); },
  } });
  await new Promise(setImmediate);
  const reconcileRender = reconciled.renders.find(args => args[2]?.mode === 'controlled_proposal');
  const reconcileResult = await reconcileRender[4].answerApi(decision);
  assert.equal(reconcileResult.reconciled, true, 'ambiguous write response must reconcile by readback');
  assert.equal(reconcileResult.inbox.feedback.message, '✓ 保存済みを再確認したで。Operational Sourceはまだ変更してへん');
  assert.equal(reconcileReads, 2, 'reconciliation must perform exactly one readback');

  const uncertain = navigationHarness();
  let uncertainReads = 0;
  uncertain.listeners['paruru:authenticated']({ detail: {
    context: { role: 'admin', allowedViews: ['home', 'kaz-os'] },
    kazOsProjectsApi: async () => null,
    kazOsInboxApi: async () => { uncertainReads++; return controlledInbox(); },
    kazOsInboxAnswerApi: async () => { throw Object.assign(new Error('response lost'), { code: 'HOME_CONTROL_UNAVAILABLE' }); },
  } });
  await new Promise(setImmediate);
  const uncertainRender = uncertain.renders.find(args => args[2]?.mode === 'controlled_proposal');
  await assert.rejects(() => uncertainRender[4].answerApi(decision), error => error.code === 'HOME_CONTROL_UNAVAILABLE');
  assert.equal(uncertainReads, 2, 'unconfirmed ambiguous write must read back once and remain failed');

  const unsafe = navigationHarness();
  unsafe.listeners['paruru:authenticated']({ detail: {
    context: { role: 'admin', allowedViews: ['kaz-os'] },
    kazOsProjectsApi: async () => null,
    kazOsInboxApi: async () => ({ ...freshInbox(), mode: 'local_controlled_proposal' }),
  } });
  await new Promise(setImmediate);
  const failed = unsafe.renders.find(args => args[2]?.sources?.inbox?.status === 'failed');
  assert(failed, 'non-read-only payload must fail closed');
  assert.equal(failed[2].inbox_items, null, 'failed source must not become an empty queue');

  console.log('PASS Kaz OS INBOX PWA read-only release contract');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

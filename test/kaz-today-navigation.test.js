'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'features', 'kaz-os', 'navigation.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const readStart = appSource.indexOf('async function callHomeControlReadOnlyApi_');
const readEnd = appSource.indexOf('async function readHomeControlErrorResponse_', readStart);
assert(readStart >= 0 && readEnd > readStart, 'Kaz read retry helper was not found');
const readTransportSource = appSource.slice(readStart, readEnd);

function createHarness(options = {}) {
  const documentListeners = new Map();
  const windowListeners = new Map();
  const pendingReads = [];
  const rendered = [];
  const diagnosticRecords = [];
  let active = false;
  let todayCalls = 0;

  const add = (map, name, handler) => {
    const handlers = map.get(name) || [];
    handlers.push(handler);
    map.set(name, handlers);
  };
  const emit = (map, name, event = {}) => {
    for (const handler of map.get(name) || []) handler(event);
  };

  const targetButton = {
    dataset: { targetView: 'kaz-os' },
    listeners: [],
    addEventListener(name, handler, capture) {
      this.listeners.push({ name, handler, capture: capture === true });
    },
  };
  const otherButton = {
    dataset: { targetView: 'home' },
    addEventListener() {},
  };
  const anchors = ['today', 'work', 'projects', 'inbox'].map(page => ({
    dataset: { kazPage: page },
    setAttribute() {},
    removeAttribute() {},
  }));
  const content = { textContent: '', replaceChildren() {} };
  const elements = {
    kazOsView: {
      classList: { contains: name => name === 'is-active' && active },
      setAttribute() {},
    },
    kazPersonalContent: content,
    kazOsEntry: { hidden: true },
    kazOsEntryStatus: { textContent: '' },
  };

  const context = {
    console,
    Date,
    Error,
    Object,
    Number,
    Math,
    Promise,
    location: { hash: '#home' },
    document: {
      hidden: false,
      getElementById: id => elements[id] || null,
      querySelectorAll(selector) {
        if (selector === '#kazOsNav a') return anchors;
        if (selector === '[data-target-view="kaz-os"]') return [targetButton];
        if (selector === '[data-target-view]') return [targetButton, otherButton];
        return [];
      },
      addEventListener: (name, handler) => add(documentListeners, name, handler),
      dispatchEvent(event) {
        emit(documentListeners, event.type, event);
        return true;
      },
    },
    window: {
      addEventListener: (name, handler) => add(windowListeners, name, handler),
      scrollTo() {},
    },
    CustomEvent: class CustomEvent {
      constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
    },
    AbortController,
    setTimeout,
    clearTimeout,
    KAZ_OS_READ_TIMEOUT_MS: 8000,
    KAZ_OS_READ_RETRY_DELAY_MS: 0,
    callHomeControlApi: async () => ({}),
    createHomeControlError(code) { return Object.assign(new Error(code), { code }); },
    transportDiagnostics_() {
      return {
        requestId: () => '123e4567-e89b-42d3-a456-426614174000',
        start: (requestClass, action, requestId) => ({ requestClass, action, requestId }),
        classifyError: error => error.transportClassification || 'unknown',
        record: (_diagnostic, entry) => diagnosticRecords.push({ ...entry }),
      };
    },
    KazInboxView: { dispose() {} },
    KazPersonalView: {
      route(hash) {
        if (hash === '#kaz-os/work') return { page: 'work', id: null };
        return { page: 'today', id: null };
      },
      render(host, selection, data) { rendered.push({ host, selection, data }); },
    },
  };

  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'features/kaz-os/navigation.js' });

  context.document.addEventListener('paruru:view-request', event => {
    if (event?.detail?.viewName !== 'kaz-os') return;
    active = true;
    context.document.dispatchEvent(new context.CustomEvent('kaz-os:opened', {
      detail: {
        waitUntil(promise) { pendingReads.push(Promise.resolve(promise)); },
      },
    }));
  });

  const authenticate = () => context.document.dispatchEvent(new context.CustomEvent('paruru:authenticated', {
    detail: {
      context: { role: 'admin', allowedViews: ['home', 'kaz-os'] },
      kazOsProjectsApi: async () => ({ sources: { projects: {} }, projects: [] }),
      kazOsWorkApi: async () => ({ sources: { work_items: {} }, work_items: [] }),
      kazOsTodayApi: async () => {
        todayCalls++;
        if (typeof options.todayApi === 'function') return options.todayApi();
        return { sources: {}, today: {}, writes: { notion: 0, calendar: 0, context: 0 } };
      },
    },
  }));

  const clickTargetCapture = () => {
    for (const item of targetButton.listeners.filter(item => item.name === 'click' && item.capture)) item.handler({});
  };

  return {
    context,
    rendered,
    diagnosticRecords,
    authenticate,
    clickTargetCapture,
    emitHashChange: () => emit(windowListeners, 'hashchange', {}),
    openFromDrawer() {
      clickTargetCapture();
      context.document.dispatchEvent(new context.CustomEvent('paruru:view-request', { detail: { viewName: 'kaz-os' } }));
    },
    setActive(value) { active = Boolean(value); },
    calls: () => todayCalls,
    settle: async () => {
      await Promise.allSettled(pendingReads.splice(0));
      await new Promise(resolve => setImmediate(resolve));
    },
  };
}

(async () => {
  const drawer = createHarness();
  drawer.authenticate();
  drawer.openFromDrawer();
  drawer.emitHashChange();
  await drawer.settle();
  assert.equal(drawer.context.location.hash, '#kaz-os/today');
  assert.equal(drawer.calls(), 1, 'one drawer navigation must make exactly one TODAY network read');

  const homeEntry = createHarness();
  homeEntry.authenticate();
  homeEntry.clickTargetCapture();
  homeEntry.emitHashChange();
  await homeEntry.settle();
  assert.equal(homeEntry.calls(), 1, 'Kaz home entry must still open TODAY through hashchange');

  const internalRoute = createHarness();
  internalRoute.authenticate();
  internalRoute.setActive(true);
  internalRoute.context.location.hash = '#kaz-os/today';
  internalRoute.emitHashChange();
  await internalRoute.settle();
  assert.equal(internalRoute.calls(), 1, 'internal Kaz hash navigation must still make one TODAY read');

  const recoveredPayload = {
    schema_version: 'kaz-today-plan-v1',
    origin: 'real_operational_sources',
    mode: 'read_only',
    fixture_only: false,
    sources: { work_items: { status: 'ok' }, calendar: { status: 'ok' } },
    today: { now: { kind: 'single', items: [{ id: 'recovered-work' }], basis: ['fixture'] } },
    writes: { notion: 0, calendar: 0, context: 0 },
  };
  let transportCalls = 0;
  const recovered = createHarness({
    todayApi: () => recovered.context.callHomeControlReadOnlyApi_({ action: 'kazOs.today.get' }),
  });
  recovered.context.KAZ_OS_READ_TIMEOUT_MS = 10;
  recovered.context.callHomeControlApi = (_payload, options) => {
    transportCalls++;
    if (transportCalls === 1) {
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(Object.assign(new Error('fixture timeout'), {
          code: 'HOME_CONTROL_UNAVAILABLE',
          cause: { name: 'AbortError' },
        })), { once: true });
      });
    }
    return Promise.resolve(recoveredPayload);
  };
  vm.runInContext(readTransportSource, recovered.context, { filename: 'app.js#kaz-read-transport' });
  recovered.authenticate();
  recovered.openFromDrawer();
  await recovered.settle();
  assert.equal(transportCalls, 2, 'timeout must be followed by exactly one existing retry');
  assert.deepEqual(recovered.diagnosticRecords.map(item => item.outcome), ['retry', 'success'],
    'the timeout remains a retry diagnostic and the second attempt is successful');
  assert.equal(recovered.rendered.length, 1, 'renderToday must render one final result');
  assert.equal(recovered.rendered[0].data, recoveredPayload,
    'renderToday must render the second-attempt success payload');

  console.log('PASS Kaz TODAY navigation performs one logical read');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

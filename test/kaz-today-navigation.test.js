'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'features', 'kaz-os', 'navigation.js'), 'utf8');

function createHarness() {
  const documentListeners = new Map();
  const windowListeners = new Map();
  const pendingReads = [];
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
    setTimeout: () => 1,
    clearTimeout() {},
    KazInboxView: { dispose() {} },
    KazPersonalView: {
      route(hash) {
        if (hash === '#kaz-os/work') return { page: 'work', id: null };
        return { page: 'today', id: null };
      },
      render() {},
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
        return { sources: {}, today: {}, writes: { notion: 0, calendar: 0, context: 0 } };
      },
    },
  }));

  const clickTargetCapture = () => {
    for (const item of targetButton.listeners.filter(item => item.name === 'click' && item.capture)) item.handler({});
  };

  return {
    context,
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

  console.log('PASS Kaz TODAY navigation performs one logical read');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

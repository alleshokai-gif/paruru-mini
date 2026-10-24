const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const componentData = require('../features/kaz-os/v3-component-data');
const { create } = require('./fixtures/kaz-v3-component-parity');

async function main() {
  const pair = create();
  const listeners = new Map();
  const rendered = [];
  const aiSections = [];
  const calls = { dashboard: 0, inbox: 0, v2: 0, context: 0, answer: 0, metrics: 0 };
  const on = (name, fn) => listeners.set(name, [...(listeners.get(name) || []), fn]);
  const emit = (name, detail) => (listeners.get(name) || []).forEach(fn => fn({ detail }));
  const nav = { hidden: true };
  const host = { textContent: '', replaceChildren(...nodes) { this.children = nodes; }, children: [],
    appendChild(node) { this.children.push(node); aiSections.push(node); },
    prepend(node) { this.children.unshift(node); aiSections.push(node); },
    append(...nodes) { this.children.push(...nodes); aiSections.push(...nodes); },
    querySelector() { return null; } };
  const anchors = ['today', 'work', 'projects', 'capa', 'context', 'inbox'].map(page => ({
    dataset: { kazPage: page }, setAttribute() {}, removeAttribute() {},
  }));
  const elements = {
    kazOsView: { classList: { contains: name => name === 'is-active' },
      setAttribute() {}, addEventListener() {} },
    kazOsNav: nav, kazPersonalContent: host,
    kazOsEntry: { hidden: true }, kazOsEntryStatus: { textContent: '' },
    kazOsV3PreviewLink: { hidden: true },
  };
  const context = vm.createContext({
    location: { hash: '#kaz-os/v3' },
    document: { hidden: false, getElementById: id => elements[id] || null,
      createElement: tag => ({ tag, textContent: '', className: '', children: [], dataset: {}, open: false,
        appendChild(node) { this.children.push(node); aiSections.push(node); },
        append(...nodes) { this.children.push(...nodes); aiSections.push(...nodes); },
        prepend(node) { this.children.unshift(node); aiSections.push(node); },
        querySelector() { return null; }, querySelectorAll() { return []; },
        addEventListener() {}, setAttribute() {},
        replaceChildren(...nodes) { this.children = nodes; },
        after(node) { aiSections.push(node); } }),
      querySelectorAll: selector => selector === '#kazOsNav a' ? anchors : [],
      addEventListener: on },
    window: { addEventListener() {}, scrollTo() {} },
    clearTimeout, setTimeout,
    Date: class FixtureDate extends Date {
      constructor(...args) { super(...(args.length ? args : [pair.dashboard.generated_at])); }
      static now() { return Date.parse(pair.dashboard.generated_at); }
    },
    KazV3ComponentData: componentData,
    PALURU_KAZ_OS_V3_PREVIEW_ENABLED: true,
    KazInboxView: { dispose() {} },
    KazPersonalView: { route() {
      throw Error('normal five-tab navigation must not use v2 routing');
    },
      render(_host, selection, data, _now, options) { rendered.push({ selection, data, options }); } },
  });
  vm.runInContext(fs.readFileSync('features/kaz-os/navigation.js', 'utf8'), context);
  emit('paruru:authenticated', {
    context: { role: 'admin', allowedViews: ['kaz-os'] },
    kazOsTodayApi: async () => { calls.v2++; return pair.dashboard.component_data.today; },
    kazOsV3DashboardApi: async () => { calls.dashboard++; return pair.dashboard; },
    kazOsV3InboxApi: async () => { calls.inbox++; return pair.inbox; },
    kazOsDevelopmentMetricsApi: async () => { calls.metrics++; return { source: { status: 'empty' }, totals: {}, models: [] }; },
    kazOsContextApi: async () => { calls.context++; return { schema_version: 'kaz-context-observatory-v1', mode: 'read_only', totals: { raw: 1 }, source: { status: 'ok', complete: true } }; },
    kazOsAiEngineApi: async () => ({ judgments: [{ feature: 'daily_planner',
      judgment: 'FOCUS_REVIEW', status: 'review_pending' }] }),
    kazOsInboxAnswerApi: async answer => { calls.answer++; return { answer, inbox: pair.inbox }; },
  });
  const pending = [];
  emit('kaz-os:opened', { waitUntil: promise => pending.push(promise) });
  await Promise.all(pending);
  assert.equal(nav.hidden, false);
  assert.equal(calls.v2, 2, 'TODAY loads the separate planning projection on each open');
  assert.equal(calls.inbox, 0);
  assert.equal(calls.dashboard, 2); // Authentication render plus opened render.
  assert.equal(rendered.at(-1).selection.page, 'today');
  assert.equal(typeof rendered.at(-1).options.answerApi, 'function');
  assert(aiSections.some(section => section.className === 'kp-card kai-action-brief'
    && JSON.stringify(section).includes('今、何をする？')));
  assert.deepEqual(rendered.at(-1).data, pair.dashboard.component_data.today,
    'TODAY uses the existing deterministic daily-plan projection rather than re-deriving it in the UI');
  assert.deepEqual(anchors.filter(anchor => !anchor.hidden).map(anchor => anchor.dataset.kazPage),
    ['today', 'work', 'projects', 'capa', 'context']);
  for (const page of ['work', 'projects', 'capa', 'context']) {
    context.location.hash = `#kaz-os/v3/${page}`;
    const reads = [];
    emit('kaz-os:opened', { waitUntil: promise => reads.push(promise) });
    await Promise.all(reads);
    assert.equal(rendered.at(-1).selection.page, page);
  }
  assert.equal(calls.context, 1);
  for (const page of ['today', 'work', 'projects', 'capa', 'context']) {
    context.location.hash = `#kaz-os/${page}`;
    const normalReads = [];
    emit('kaz-os:opened', { waitUntil: promise => normalReads.push(promise) });
    await Promise.all(normalReads);
    assert.equal(rendered.at(-1).selection.page, page);
  }
  assert.equal(rendered.at(-5).data.schema_version, pair.dashboard.component_data.today.schema_version,
    'normal TODAY route keeps the daily planning contract after navigation');
  assert.deepEqual(anchors.filter(anchor => !anchor.hidden).map(anchor => anchor.dataset.kazPage),
    ['today', 'work', 'projects', 'capa', 'context']);
  assert.deepEqual(anchors.filter(anchor => !anchor.hidden).map(anchor => anchor.href),
    ['today', 'work', 'projects', 'capa', 'context'].map(page => `#kaz-os/${page}`));
  context.location.hash = '#kaz-os/v3/metrics';
  const metricsReads = [];
  emit('kaz-os:opened', { waitUntil: promise => metricsReads.push(promise) });
  await Promise.all(metricsReads);
  assert.equal(calls.metrics, 1);
  assert.deepEqual(anchors.filter(anchor => !anchor.hidden).map(anchor => anchor.href),
    ['today', 'work', 'projects', 'capa', 'context'].map(page => `#kaz-os/${page}`),
    'development metrics must leave the five-tab navigation on normal routes');
  assert.equal(host.children[0].tag, 'h2', 'metrics share the Kaz OS page heading');
  assert.equal(host.children[1].className, 'development-metrics-dashboard');
  assert.equal(host.children[2].className, 'development-metrics-details');
  assert.equal(host.children[2].open, false, 'technical details start collapsed');
  assert.equal(anchors.some(anchor => anchor.className === 'development-metrics-return'), false,
    'the shared five-tab navigation replaces the standalone return link');
  assert.equal(calls.context, 2);
  console.log('PASS hidden and normal five-tab routes keep Snapshot pages and Context projection separate');
}

main().catch(error => { console.error(error); process.exitCode = 1; });

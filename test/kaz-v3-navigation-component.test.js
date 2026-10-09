const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const componentData = require('../features/kaz-os/v3-component-data');
const { create } = require('./fixtures/kaz-v3-component-parity');

async function main() {
  const pair = create();
  const listeners = new Map();
  const rendered = [];
  const calls = { dashboard: 0, inbox: 0, v2: 0 };
  const on = (name, fn) => listeners.set(name, [...(listeners.get(name) || []), fn]);
  const emit = (name, detail) => (listeners.get(name) || []).forEach(fn => fn({ detail }));
  const nav = { hidden: true };
  const host = { textContent: '', replaceChildren() {} };
  const anchors = ['today', 'work', 'projects', 'capa', 'inbox'].map(page => ({
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
      querySelectorAll: selector => selector === '#kazOsNav a' ? anchors : [],
      addEventListener: on },
    window: { addEventListener() {}, scrollTo() {} },
    clearTimeout, setTimeout,
    KazV3ComponentData: componentData,
    PALURU_KAZ_OS_V3_PREVIEW_ENABLED: true,
    KazInboxView: { dispose() {} },
    KazPersonalView: { route() { throw Error('v2 route must not parse hidden preview'); },
      render(_host, selection, data) { rendered.push({ selection, data }); } },
  });
  vm.runInContext(fs.readFileSync('features/kaz-os/navigation.js', 'utf8'), context);
  emit('paruru:authenticated', {
    context: { role: 'admin', allowedViews: ['kaz-os'] },
    kazOsTodayApi: async () => { calls.v2++; throw Error('v2 read on preview'); },
    kazOsV3DashboardApi: async () => { calls.dashboard++; return pair.dashboard; },
    kazOsV3InboxApi: async () => { calls.inbox++; return pair.inbox; },
  });
  const pending = [];
  emit('kaz-os:opened', { waitUntil: promise => pending.push(promise) });
  await Promise.all(pending);
  assert.equal(nav.hidden, false);
  assert.equal(calls.v2, 0);
  assert.equal(calls.inbox, 0);
  assert.equal(calls.dashboard, 2); // Authentication render plus opened render.
  assert.equal(rendered.at(-1).selection.page, 'today');
  assert.equal(rendered.at(-1).data.today, pair.dashboard.component_data.today.today);
  for (const page of ['work', 'projects', 'capa', 'inbox']) {
    context.location.hash = `#kaz-os/v3/${page}`;
    const reads = [];
    emit('kaz-os:opened', { waitUntil: promise => reads.push(promise) });
    await Promise.all(reads);
    assert.equal(rendered.at(-1).selection.page, page);
  }
  assert.deepEqual(calls, { dashboard: 5, inbox: 1, v2: 0 });
  console.log('PASS hidden route reuses current Kaz OS component and Snapshot GET only');
}

main().catch(error => { console.error(error); process.exitCode = 1; });

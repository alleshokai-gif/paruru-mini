const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ui = require('../features/bus/bus.js');
function fixture() {
  return { success: true, generatedAt: '2026-09-10T07:50:00+09:00', positionUiEnabled: false, directions:
    ['home_to_noborito', 'home_to_mizonokuchi', 'noborito_to_home', 'mizonokuchi_to_home'].map((id, i) => ({
      id, from: '出発', to: '到着', group: i < 2 ? 'outbound' : 'inbound', dataAgeSec: 10, state: 'realtime',
      arrivals: [{ scheduledAt: '2026-09-10T07:49:00+09:00', scheduledTime: '07:49', estimatedAt: '2026-09-10T07:50:20+09:00',
        realtime: true, dataAgeSec: 20, delayMinutes: 1, delaySeconds: 80, state: 'realtime' }]
    })) };
}
function clock() {
  let time = 0, id = 0; const jobs = new Map();
  return { now: () => time, setTimeout(fn, ms) { jobs.set(++id, { fn, at: time + ms }); return id; }, clearTimeout(id) { jobs.delete(id); },
    async advance(ms) { const target = time + ms; while (true) {
      const next = [...jobs.entries()].filter(([, v]) => v.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break; time = next[1].at; jobs.delete(next[0]); next[1].fn(); await Promise.resolve(); await Promise.resolve();
    } time = target; await Promise.resolve(); } };
}
test('Bus polling runs at 30 seconds only while active and visible; resume refreshes immediately', async () => {
  const timers = clock(); let calls = 0, hidden = false;
  const controller = ui.createController({ timers, now: timers.now, hidden: () => hidden, render() {}, async fetchData() { calls++; return fixture(); } });
  controller.setActive(true); await timers.advance(0); assert.equal(calls, 1);
  await timers.advance(29999); assert.equal(calls, 1); await timers.advance(1); assert.equal(calls, 2);
  hidden = true; controller.visibilityChanged(); await timers.advance(90000); assert.equal(calls, 2);
  hidden = false; controller.visibilityChanged(); await timers.advance(0); assert.equal(calls, 3);
  controller.setActive(false); await timers.advance(90000); assert.equal(calls, 3);
  controller.setActive(true); await timers.advance(0); assert.equal(calls, 4); controller.destroy();
});
test('Bus retains last success on error and rejects obsolete responses after leave', async () => {
  const timers = clock(); let last, reject = false;
  const controller = ui.createController({ timers, now: timers.now, hidden: () => false, render(state) { last = state; }, async fetchData() { if (reject) throw Error(); return fixture(); } });
  controller.setActive(true); await timers.advance(0); const previous = last.data; reject = true;
  await timers.advance(30000); assert.equal(last.error, true); assert.equal(last.data, previous); controller.destroy();
  let resolve;
  const delayed = ui.createController({ timers, now: timers.now, hidden: () => false, render(state) { last = state; }, fetchData: () => new Promise((r) => { resolve = r; }) });
  delayed.setActive(true); delayed.setActive(false); resolve(fixture()); await timers.advance(0); assert.equal(last.data, null); delayed.destroy();
});
test('UI never displays past or stale ETA, respects source order and gate OFF', () => {
  const data = fixture(), direction = data.directions[0], row = direction.arrivals[0];
  assert.equal(ui.displayRow(row, direction, data, 0, false).eta, 1);
  assert.equal(ui.displayRow(row, direction, data, 21000, false).eta, null);
  assert.equal(ui.displayRow(row, direction, data, 0, true).eta, null);
  assert.equal(ui.BUS_POSITION_UI_ENABLED, false);
  const utcRow = { ...row, scheduledAt: new Date(row.scheduledAt).toISOString() };
  assert.equal(ui.displayRow(utcRow, direction, data, 0, false).timeLabel, '07:49便');
  assert.equal(ui.validate(data).directions[0], direction);
  assert.throws(() => ui.validate({ ...data, directions: [direction, direction, direction, direction] }));
});
test('421 seconds of internal delay are displayed as 7 minutes, never raw seconds', () => {
  const data = fixture(), direction = data.directions[0];
  const row = { ...direction.arrivals[0], delaySeconds: 421, delayMinutes: 7 };
  const display = ui.displayRow(row, direction, data, 0, false);
  assert.equal(display.delay, '+7分遅れ'); assert(!display.delay.includes('421'));
});

test('PWA Bus switching cannot interrupt another view even if the feature fails', async () => {
  const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
  const fn = source.slice(source.indexOf('async function switchView(viewName)'), source.indexOf('async function loadInbox(options = {})'));
  let loaded = false;
  const context = { normalizeAllowedView_: (v) => v, isViewAllowed_: () => true, activeView: '', views: [], navItems: [],
    PALURUBus: { setActive() { throw Error('Bus isolated'); } }, showMessage() {}, setParuruState() {}, async loadInboxView_() { loaded = true; } };
  vm.createContext(context); vm.runInContext(fn, context); await context.switchView('inbox'); assert(loaded);
});
test('SW bypasses cache for Bus API; feature assets remain in existing app-shell lifecycle', async () => {
  const source = fs.readFileSync(require.resolve('../sw.js'), 'utf8'); const listeners = {}; let fetches = 0, cached = 0;
  const context = { URL, BUILD_ID: 'synthetic', importScripts() {}, console, self: { location: { origin: 'https://paluru.example', href: 'https://paluru.example/sw.js' }, addEventListener(name, fn) { listeners[name] = fn; } },
    fetch: async () => { fetches++; return {}; }, caches: { async open() { cached++; throw Error('Must not cache Bus API'); } } };
  vm.createContext(context); vm.runInContext(source, context); let result;
  listeners.fetch({ request: { method: 'GET', url: 'https://bus.example/api/bus/arrivals' }, respondWith(promise) { result = promise; } });
  await result; assert.equal(fetches, 1); assert.equal(cached, 0);
  assert(source.includes('versioned("features/bus/bus.js")')); assert(source.includes('clients.claim()'));
});

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const elements = new Map();
const documentHandlers = {};
const windowHandlers = {};
const requests = [];
const scheduled = [];

function classList() {
  const values = new Set();
  return {
    add: (...names) => names.forEach((name) => values.add(name)),
    remove: (...names) => names.forEach((name) => values.delete(name)),
    contains: (name) => values.has(name),
    toggle: (name, force) => force === undefined ? !values.has(name) : force,
  };
}

function element(selector) {
  if (elements.has(selector)) return elements.get(selector);
  const value = {
    value: '', textContent: '', innerHTML: '', dataset: {}, checked: false, disabled: false,
    classList: classList(),
    addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    closest() { return null; }, setAttribute() {}, getAttribute() { return ''; },
    focus() {}, reset() {}, showModal() {}, close() {}, scrollIntoView() {},
    getBoundingClientRect() { return { top: 0, bottom: 100, height: 100 }; },
  };
  elements.set(selector, value);
  return value;
}

const storage = new Map();
const context = {
  console, Date, Intl, JSON, Math, Number, Object, Array, String, RegExp, Error,
  Uint8Array, URL, Promise,
  crypto: { randomUUID: () => '11111111-1111-4111-8111-111111111111', getRandomValues: (bytes) => bytes.fill(1) },
  localStorage: {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, String(value)),
  },
  navigator: {},
  location: { reload() {} },
  window: {
    innerHeight: 800,
    addEventListener: (type, handler) => { windowHandlers[type] = handler; },
    setTimeout: (handler, delay) => { scheduled.push({ handler, delay }); return scheduled.length; },
    clearTimeout() {},
  },
  document: {
    visibilityState: 'hidden',
    documentElement: { clientHeight: 800 },
    querySelector: element,
    querySelectorAll: () => [],
    addEventListener: (type, handler) => { documentHandlers[type] = handler; },
  },
  requestAnimationFrame: (handler) => handler(),
  FormData: function() { return { get: () => 'Normal' }; },
  fetch: async (url) => {
    requests.push(String(url));
    return { ok: true, status: 200, json: async () => ({ success: true, items: [], count: 0, warnings: [] }) };
  },
};
vm.createContext(context);
new vm.Script(appSource, { filename: 'app.js' }).runInContext(context);

function at(value) { return Date.parse(value); }
function call(name, ...args) { return context[name](...args); }
function assert(condition, message) { if (!condition) throw new Error(message); }
function timed(id, start, end) {
  return { id, sourceType: 'google_calendar', allDay: false, startAt: start, endAt: end, eventStartTime: start.slice(11, 16), reasons: ['calendar_event_today_timed'] };
}
function allDay(id, start, exclusiveEnd) {
  return { id, sourceType: 'google_calendar', allDay: true, eventStart: start, eventEnd: exclusiveEnd, startAt: start, endAt: exclusiveEnd, reasons: ['calendar_event_today'] };
}
function result(items) { return { success: true, items, count: items.length, warnings: [] }; }

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('17:59 shows only unfinished today calendar and keeps non-calendar candidates', () => {
  const now = at('2026-07-18T17:59:00+09:00');
  const plan = call('getRollingCalendarRequestPlan', now, '18:00');
  const output = call('buildRollingNotificationResult', result([
    { id: 'task', sourceType: 'paluru', endAt: '2026-07-18 10:00' },
    timed('ended', '2026-07-18 16:00', '2026-07-18 17:59'),
    timed('active', '2026-07-18 17:30', '2026-07-18 18:30'),
  ]), result([timed('tomorrow', '2026-07-19 09:00', '2026-07-19 10:00')]), plan, now);
  assert(!plan.includeTomorrow, 'tomorrow enabled before threshold');
  assert(output.items.some((item) => item.id === 'task'), 'non-calendar candidate was filtered');
  assert(!output.items.some((item) => item.id === 'ended'), 'endDateTime=now remained visible');
  assert(output.items.some((item) => item.id === 'active'), 'active event disappeared');
  assert(!output.items.some((item) => item.id === 'tomorrow'), 'tomorrow event appeared early');
});

test('18:00 and 23:59 include tomorrow; 20:00 filters only ended calendar', () => {
  ['2026-07-18T18:00:00+09:00', '2026-07-18T23:59:00+09:00'].forEach((value) => {
    assert(call('getRollingCalendarRequestPlan', at(value), '18:00').includeTomorrow, 'tomorrow missing at ' + value);
  });
  const now = at('2026-07-18T20:00:00+09:00');
  const plan = call('getRollingCalendarRequestPlan', now, '18:00');
  const output = call('buildRollingNotificationResult', result([
    timed('past', '2026-07-18 18:00', '2026-07-18 19:00'),
    timed('current', '2026-07-18 19:30', '2026-07-18 20:30'),
  ]), result([timed('next', '2026-07-19 08:00', '2026-07-19 09:00')]), plan, now);
  assert(!output.items.some((item) => item.id === 'past'), 'finished event remained');
  assert(output.items.some((item) => item.id === 'current'), 'current event missing');
  assert(output.items.some((item) => item.id === 'next'), 'tomorrow event missing');
});

test('midnight rolls former tomorrow into today and hides the new tomorrow until threshold', () => {
  const plan = call('getRollingCalendarRequestPlan', at('2026-07-19T00:00:00+09:00'), '18:00');
  assert(plan.today === '2026-07-19' && plan.tomorrow === '2026-07-20', 'date did not roll');
  assert(plan.includeTomorrow === false, 'new tomorrow remained visible at midnight');
});

test('all-day exclusive end and multi-day end are respected; missing end stays with warning', () => {
  const now = at('2026-07-18T20:00:00+09:00');
  const plan = call('getRollingCalendarRequestPlan', now, '18:00');
  const missing = { id: 'missing', sourceType: 'google_calendar', allDay: false, startAt: '2026-07-18 10:00' };
  const output = call('buildRollingNotificationResult', result([
    allDay('today', '2026-07-18', '2026-07-19'),
    allDay('expired-all-day', '2026-07-17', '2026-07-18'),
    timed('multi', '2026-07-17 09:00', '2026-07-19 09:00'),
    missing,
  ]), null, plan, now);
  assert(output.items.some((item) => item.id === 'today'), 'all-day event disappeared before 24:00');
  assert(!output.items.some((item) => item.id === 'expired-all-day'), 'exclusive all-day end ignored');
  assert(output.items.some((item) => item.id === 'multi'), 'multi-day event disappeared early');
  assert(output.items.some((item) => item.id === 'missing'), 'missing-end event was silently hidden');
  assert(output.warnings.includes('calendar_end_missing'), 'missing-end warning absent');
});

test('calendar groups order all-day first and omit empty today heading', () => {
  const now = at('2026-07-18T20:00:00+09:00');
  const plan = call('getRollingCalendarRequestPlan', now, '18:00');
  const output = call('buildRollingNotificationResult', result([]), result([
    timed('late', '2026-07-19 11:00', '2026-07-19 12:00'),
    allDay('all-day', '2026-07-19', '2026-07-20'),
    timed('early', '2026-07-19 08:00', '2026-07-19 09:00'),
  ]), plan, now);
  assert(output.items.map((item) => item.id).join(',') === 'all-day,early,late', 'day ordering wrong');
  const html = call('renderRollingNotificationItems', output.items, true);
  assert(!html.includes('今日の残り') && html.includes('明日の予定'), 'empty today group heading rendered');
});

test('display limit preserves non-calendar order and reserves today and tomorrow groups', () => {
  const items = [1, 2, 3, 4, 5].map((id) => ({ id: 'task-' + id, sourceType: 'paluru' }));
  items.push({ id: 'today', sourceType: 'google_calendar', rollingDay: 'today' });
  items.push({ id: 'tomorrow', sourceType: 'google_calendar', rollingDay: 'tomorrow' });
  const selected = call('selectRollingNotificationItems', items, 5, true);
  assert(selected.filter((item) => item.sourceType === 'paluru').map((item) => item.id).join(',') === 'task-1,task-2,task-3', 'non-calendar order changed');
  assert(selected.some((item) => item.id === 'today') && selected.some((item) => item.id === 'tomorrow'), 'calendar group was hidden by display limit');
});

test('setting time changes threshold and profile default is centralized', () => {
  const now = at('2026-07-18T17:59:00+09:00');
  assert(call('getRollingCalendarRequestPlan', now, '17:00').includeTomorrow, 'custom threshold ignored');
  assert(call('getTomorrowScheduleStartTime', {}).toString() === '18:00', 'default threshold changed');
});

test('nearest boundary is event end, then threshold, then midnight', () => {
  const now = at('2026-07-18T17:00:00+09:00');
  const eventEnd = at('2026-07-18T17:30:00+09:00');
  assert(call('getNextNotificationBoundaryAt', [timed('next', '2026-07-18 17:10', '2026-07-18 17:30')], now, '18:00') === eventEnd, 'nearest event end not selected');
  assert(call('getNextNotificationBoundaryAt', [], now, '18:00') === at('2026-07-18T18:00:00+09:00'), 'threshold boundary not selected');
  assert(call('getNextNotificationBoundaryAt', [], at('2026-07-18T20:00:00+09:00'), '18:00') === at('2026-07-19T00:00:00+09:00'), 'midnight boundary not selected');
});

test('boundary scheduler uses one-shot timeout for the nearest boundary', () => {
  scheduled.length = 0;
  vm.runInContext('notificationBoundaryTimerEnabled = true', context);
  const realNow = Date.now();
  const plan = call('getRollingCalendarRequestPlan', realNow, '18:00');
  const end = call('addRollingDays', plan.today, 1) + ' 00:00';
  call('scheduleNotificationBoundary', [timed('boundary', end, end)]);
  assert(scheduled.length === 1 && scheduled[0].delay > 0, 'one-shot boundary timer was not scheduled');
});

test('visibility resume forces a refetch and request dates never exceed today plus tomorrow', async () => {
  assert(typeof documentHandlers.visibilitychange === 'function', 'visibilitychange handler absent');
  context.document.visibilityState = 'visible';
  documentHandlers.visibilitychange();
  await new Promise((resolve) => setImmediate(resolve));
  assert(requests.length >= 1, 'resume did not refetch');
  requests.forEach((requestUrl) => {
    const date = new URL(requestUrl).searchParams.get('date');
    assert(/^\d{4}-\d{2}-\d{2}$/.test(date), 'request date missing');
  });
  assert(requests.length <= 2, 'more than today plus tomorrow was requested');
});

test('static regressions retain Inbox, Follow-up, Agent routing, Calendar sync and PWA lifecycle', () => {
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert(appSource.includes('action: "answerFollowup"') && appSource.includes('action: "agentChat"'), 'existing action route removed');
  assert(appSource.includes('action: "syncCalendar"') && appSource.includes('fetchInboxItems'), 'Calendar or Inbox route removed');
  assert(appSource.includes('updateViaCache: "none"'), 'updateViaCache changed');
  assert(sw.includes('self.skipWaiting()') && sw.includes('self.clients.claim()') && sw.includes('networkFirst'), 'Service Worker lifecycle changed');
});

let failures = 0;
(async () => {
  for (const item of tests) {
    try {
      await item.fn();
      console.log('PASS ' + item.name);
    } catch (error) {
      failures += 1;
      console.error('FAIL ' + item.name + ': ' + error.message);
    }
  }
  if (failures) process.exit(1);
  console.log('PASS all ' + tests.length + ' tests');
})();

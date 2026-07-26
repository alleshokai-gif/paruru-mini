'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'app.js'), 'utf8');
const elements = new Map();
const handlers = new Map();
const requests = [];

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
    value: '', textContent: '', innerHTML: '', dataset: {}, checked: false, disabled: false, hidden: false,
    classList: classList(),
    addEventListener(type, handler) { handlers.set(selector + ':' + type, handler); },
    querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; },
    setAttribute() {}, getAttribute() { return ''; }, insertAdjacentHTML(position, html) { this.innerHTML += html; },
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
  localStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, String(value)) },
  navigator: {}, location: { reload() {} },
  window: { innerHeight: 800, addEventListener() {}, setTimeout: () => 1, clearTimeout() {} },
  document: { documentElement: { clientHeight: 800 }, querySelector: element, querySelectorAll: () => [] },
  requestAnimationFrame: (handler) => handler(),
  FormData: function() { return { get: () => 'Normal' }; },
  fetch: async (url, options = {}) => {
    const payload = options.body ? JSON.parse(options.body) : null;
    requests.push({ url: String(url), payload });
    const body = payload ? { success: true, item: {} } : (String(url).includes('notificationCandidates')
      ? { success: true, items: [], count: 0, warnings: [] }
      : { success: true, data: [] });
    return { ok: true, status: 200, json: async () => body };
  },
};
vm.createContext(context);
new vm.Script(source, { filename: 'app.js' }).runInContext(context);

function run(expression) { return vm.runInContext(expression, context); }
function assert(value, message) { if (!value) throw new Error(message); }
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('shopping timing maps a rolling seven days independently of weekday', () => {
  const monday = { year: 2026, month: 7, day: 20 };
  assert(context.getShoppingDueDate('today', '', monday) === '2026-07-20', 'today mapping wrong');
  assert(context.getShoppingDueDate('tomorrow', '', monday) === '2026-07-21', 'tomorrow mapping wrong');
  assert(context.getShoppingDueDate('within_7_days', '', { year: 2026, month: 7, day: 19 }) === '2026-07-26', 'Sunday rolling date wrong');
  assert(context.getShoppingDueDate('within_7_days', '', monday) === '2026-07-27', 'Monday rolling date wrong');
  assert(context.getShoppingDueDate('within_7_days', '', { year: 2026, month: 7, day: 25 }) === '2026-08-01', 'Saturday rolling date wrong');
  assert(context.classifyShoppingTiming('2026-07-22', monday) === 'within_7_days', 'two-day classification wrong');
  assert(context.classifyShoppingTiming('2026-07-27', monday) === 'within_7_days', 'seven-day classification wrong');
  assert(context.classifyShoppingTiming('2026-07-28', monday) === 'custom', 'eight-day classification wrong');
  assert(context.classifyShoppingTiming('2026-07-19', monday) === 'custom', 'past date was not preserved as custom');
  assert(context.classifyShoppingTiming('', monday) === 'none', 'no deadline classification wrong');
});

test('type-specific form only shows its normal datetime fields', () => {
  run('editType.value="shopping"; editShoppingTiming.value="today"; updateEditFormVisibility()');
  assert(!element('#editShoppingPanel').hidden, 'shopping timing hidden');
  assert(element('#editDuePanel').hidden && element('#editEventPanel').hidden && element('#editReminderPanel').hidden, 'shopping showed unrelated datetime fields');
  run('editType.value="task"; updateEditFormVisibility()');
  assert(!element('#editDuePanel').hidden && !element('#editDueTimeField').hidden, 'task deadline hidden');
  run('editType.value="event"; updateEditFormVisibility()');
  assert(!element('#editEventPanel').hidden && element('#editDuePanel').hidden, 'event fields wrong');
  run('editType.value="reminder"; updateEditFormVisibility()');
  assert(!element('#editReminderPanel').hidden && element('#editEventPanel').hidden, 'reminder fields wrong');
  run('editType.value="note"; updateEditFormVisibility()');
  assert(element('#editDuePanel').hidden && element('#editEventPanel').hidden && element('#editReminderPanel').hidden, 'memo showed datetime fields');
});

test('hidden values are omitted and explicit no-deadline alone clears shopping due values', () => {
  run('editType.value="shopping"; editDueDate.value="2026-07-25"; editDueTime.value="13:00"; shoppingTimingTouched=false');
  const untouched = context.buildEditUpdatePayload({ type: 'shopping' });
  assert(!Object.prototype.hasOwnProperty.call(untouched, 'dueDate') && !Object.prototype.hasOwnProperty.call(untouched, 'dueTime'), 'hidden values were overwritten');
  run('getTodayTokyoParts=()=>({year:2026,month:7,day:20}); editShoppingTiming.value="within_7_days"; shoppingTimingTouched=true');
  const rolling = context.buildEditUpdatePayload({ type: 'shopping' });
  assert(rolling.dueDate === '2026-07-27', 'explicit rolling selection did not write today plus seven days');
  run('editShoppingTiming.value="none"; shoppingTimingTouched=true');
  const cleared = context.buildEditUpdatePayload({ type: 'shopping' });
  assert(cleared.dueDate === '' && cleared.dueTime === '', 'explicit no-deadline did not clear both fields');
});

test('shopping display uses clear deadline labels', () => {
  assert(context.buildTodayDisplayLine({ type: 'shopping', title: '牛乳', reasons: ['due_today'] }).startsWith('今日まで'), 'today label wrong');
  assert(context.buildTodayDisplayLine({ type: 'shopping', title: '卵', reasons: ['due_tomorrow'] }).startsWith('明日まで'), 'tomorrow label wrong');
  assert(context.buildTodayDisplayLine({ type: 'shopping', title: 'パン', reasons: ['overdue'] }).startsWith('期限超過'), 'overdue label wrong');
  assert(context.buildTodayDisplayLine({ type: 'shopping', title: '米', reasons: ['due_within_7_days'] }).startsWith('1週間以内'), 'rolling seven-day label wrong');
});

test('shopping UI contains no calendar-week wording and keeps the current build', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
  const shoppingPanel = html.match(/id="editShoppingPanel"[\s\S]*?<\/section>/)?.[0] || '';
  assert(shoppingPanel.includes('1&#36913;&#38291;&#20197;&#20869;'), 'rolling seven-day option missing');
  assert(!shoppingPanel.includes('&#20170;&#36913;') && !shoppingPanel.includes('今週'), 'calendar-week wording remains in shopping UI');
assert(source.includes('const ASSET_VERSION = "v20260726-nurse-okan-page-2"'), 'build version mismatch');
});

test('successful edit refreshes Inbox and notification candidates', async () => {
  run('editId.value="item-1"; editMemo.value="牛乳"; editTitle.value="牛乳"; editCategory.value="買い物"; editPriority.value="Normal"; editType.value="shopping"; editStatus.value="inbox"; editShoppingTiming.value="today"; shoppingTimingTouched=true');
  await handlers.get('#editForm:submit')({ preventDefault() {} });
  assert(requests.some((entry) => entry.payload && entry.payload.action === 'update'), 'update missing');
  assert(requests.some((entry) => entry.payload && entry.payload.action === 'list'), 'Inbox was not refreshed');
  assert(requests.some((entry) => entry.payload && entry.payload.action === 'notificationCandidates'), 'notifications were not refreshed');
});

let failures = 0;
(async () => {
  for (const item of tests) {
    try { await item.fn(); console.log('PASS ' + item.name); }
    catch (error) { failures += 1; console.error('FAIL ' + item.name + ': ' + error.message); }
  }
  if (failures) process.exit(1); else console.log('PASS all ' + tests.length + ' tests');
})();

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const context = {
  console, Date, JSON, Math, Number, Object, Array, String, RegExp, Error,
  Utilities: {
    formatDate: () => '2026-07-20',
    getUuid: () => '11111111-1111-4111-8111-111111111111',
  },
  ContentService: {
    MimeType: { JSON: 'application/json' },
    createTextOutput: (text) => ({ text, setMimeType() { return this; }, getContent() { return this.text; } }),
  },
};
vm.createContext(context);
new vm.Script(fs.readFileSync(path.resolve(__dirname, '..', 'gas', 'Code.js'), 'utf8'), { filename: 'Code.js' }).runInContext(context);

function assert(value, message) { if (!value) throw new Error(message); }
function candidates(items, date = '2026-07-20') {
  return context.buildNotificationCandidates_(items, { targetDate: date, limit: 50 });
}
function shopping(id, dueDate, extra = {}) {
  return Object.assign({ id, status: 'inbox', type: 'shopping', title: id, priority: 'Normal', dueDate }, extra);
}
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('shopping today, tomorrow and two through seven days are candidates at Normal priority', () => {
  const output = candidates([
    shopping('today', '2026-07-20'),
    shopping('tomorrow', '2026-07-21'),
    shopping('two-days', '2026-07-22'),
    shopping('seven-days', '2026-07-27'),
  ]);
  assert(output.find((item) => item.id === 'today').reasons.includes('due_today'), 'today reason missing');
  assert(output.find((item) => item.id === 'tomorrow').reasons.includes('due_tomorrow'), 'tomorrow reason missing');
  assert(output.find((item) => item.id === 'two-days').reasons.includes('due_within_7_days'), 'two-day reason missing');
  assert(output.find((item) => item.id === 'seven-days').reasons.includes('due_within_7_days'), 'seven-day reason missing');
});

test('eight days, no due date and completed shopping are excluded', () => {
  const output = candidates([
    shopping('eight-days', '2026-07-28'),
    shopping('none', ''),
    shopping('done', '2026-07-20', { status: 'Done' }),
  ]);
  assert(output.length === 0, 'excluded shopping remained');
});

test('shopping aliases normalize without changing stored data', () => {
  const output = candidates([shopping('jp', '2026-07-21', { type: '買い物' })]);
  assert(output.length === 1 && output[0].reasons.includes('due_tomorrow'), 'normalized shopping type missing');
});

test('task and reminder candidate behavior is preserved', () => {
  const output = candidates([
    { id: 'task', status: 'inbox', type: 'task', title: 'task', dueDate: '2026-07-20', dueTime: '10:00' },
    { id: 'reminder', status: 'inbox', type: 'reminder', title: 'reminder', remindAt: '2026-07-20 08:00' },
    { id: 'future-task', status: 'inbox', type: 'task', title: 'future', dueDate: '2026-07-21' },
  ]);
  assert(output.find((item) => item.id === 'task').reasons.includes('due_today_timed'), 'task regression');
  assert(output.find((item) => item.id === 'reminder').reasons.includes('reminder_today'), 'reminder regression');
  assert(!output.some((item) => item.id === 'future-task'), 'future task behavior changed');
});

test('shopping reasons follow requested priority without displacing earlier task reasons', () => {
  const output = candidates([
    shopping('within-seven', '2026-07-27'),
    shopping('tomorrow', '2026-07-21'),
    { id: 'followup', status: 'inbox', type: 'note', title: 'followup', needsFollowup: true },
    { id: 'urgent', status: 'inbox', type: 'note', title: 'urgent', priority: 'Urgent', needsFollowup: true },
    { id: 'today-task', status: 'inbox', type: 'task', title: 'task', dueDate: '2026-07-20' },
  ]);
  assert(output.map((item) => item.id).join(',') === 'today-task,urgent,followup,tomorrow,within-seven', 'priority order changed: ' + output.map((item) => item.id));
});

test('display limit keeps earlier task and reminder candidates ahead of rolling shopping', () => {
  const output = context.buildNotificationCandidates_([
    shopping('within-seven', '2026-07-27'),
    { id: 'overdue', status: 'inbox', type: 'task', title: 'overdue', dueDate: '2026-07-19' },
    { id: 'today', status: 'inbox', type: 'task', title: 'today', dueDate: '2026-07-20' },
    { id: 'reminder', status: 'inbox', type: 'reminder', title: 'reminder', remindAt: '2026-07-20 09:00' },
    { id: 'urgent', status: 'inbox', type: 'note', title: 'urgent', priority: 'Urgent', needsFollowup: true },
    { id: 'followup', status: 'inbox', type: 'note', title: 'followup', needsFollowup: true },
  ], { targetDate: '2026-07-20', limit: 5 });
  assert(output.length === 5 && !output.some((item) => item.id === 'within-seven'), 'rolling shopping displaced an earlier important candidate');
});

test('rolling seven-day boundary is identical on Sunday Monday and Saturday', () => {
  [
    ['2026-07-19', '2026-07-26', '2026-07-27'],
    ['2026-07-20', '2026-07-27', '2026-07-28'],
    ['2026-07-25', '2026-08-01', '2026-08-02'],
  ].forEach(([today, daySeven, dayEight]) => {
    const output = candidates([shopping('seven', daySeven), shopping('eight', dayEight)], today);
    assert(output.some((item) => item.id === 'seven'), 'seven-day item missing for ' + today);
    assert(!output.some((item) => item.id === 'eight'), 'eight-day item included for ' + today);
  });
});

let failures = 0;
for (const item of tests) {
  try { item.fn(); console.log('PASS ' + item.name); }
  catch (error) { failures += 1; console.error('FAIL ' + item.name + ': ' + error.message); }
}
if (failures) process.exit(1); else console.log('PASS all ' + tests.length + ' tests');

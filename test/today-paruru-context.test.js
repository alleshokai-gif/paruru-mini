'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = ['gas/Code.js', 'gas/TodayParuruContextService.js', 'gas/InternalTodayParuruApi.js']
  .map((name) => fs.readFileSync(path.join(root, name), 'utf8')).join('\n');
const context = {
  Date, JSON, Math, Number, Object, Array, String, RegExp, Error,
  Utilities: {
    formatDate(date, timezone, pattern) {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone === 'UTC' ? 'UTC' : 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
      }).formatToParts(date).reduce((all, part) => Object.assign(all, { [part.type]: part.value }), {});
      if (pattern === 'yyyy-MM-dd') return `${parts.year}-${parts.month}-${parts.day}`;
      if (pattern === 'HH:mm') return `${parts.hour}:${parts.minute}`;
      throw new Error('unexpected date format');
    }
  },
  ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: (text) => ({ text, setMimeType() { return this; }, getContent() { return this.text; } }) }
};
vm.createContext(context);
new vm.Script(source, { filename: 'today-paruru-context.js' }).runInContext(context);

const actor = { homeId: 'home_test', memberUserId: 'father', displayName: 'father', role: 'admin', capabilities: ['home.read'], deviceId: 'device-1' };
let inboxReads = 0;
let calendarReads = 0;
let calendarRanges = [];
let aggregateCalls = [];
let aggregateParams = [];
let sourceByDate = {};
context.readOwnedInboxItems_ = () => { inboxReads += 1; return [{ id: 'inbox-source' }]; };
context.CalendarReadService = {
  readNormalizedDateRange(start, end) {
    calendarReads += 1;
    calendarRanges.push([start, end]);
    return [];
  }
};
context.buildNotificationCandidatesResponse_ = (params, receivedActor, options) => {
  assert(receivedActor.memberUserId === actor.memberUserId, 'actor changed before aggregation');
  assert(Array.isArray(options.items) && options.items.length === 1, 'Inbox read was not shared');
  aggregateCalls.push(params.date);
  aggregateParams.push(params);
  const items = sourceByDate[params.date] || [];
  return { success: true, targetDate: params.date, count: items.length, items, warnings: [] };
};

function assert(value, message) { if (!value) throw new Error(message); }
function calendar(id, start, end) { return { id, sourceId: id, sourceType: 'google_calendar', title: id, allDay: false, startAt: start, endAt: end }; }
function inbox(id) { return { id, sourceType: 'paluru', title: id, reasons: ['due_today'] }; }
function run(now, data, params) {
  inboxReads = 0;
  calendarReads = 0;
  calendarRanges = [];
  aggregateCalls = [];
  aggregateParams = [];
  sourceByDate = data;
  return context.buildTodayParuruContextData_(params || {}, actor, { now: new Date(now) });
}
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('Calendar 0 and one due Inbox task returns the Inbox task', () => {
  const result = run('2026-07-18T17:59:00+09:00', { '2026-07-18': [inbox('milk')] });
  assert(result.count === 1 && result.sourceSummary.calendarCount === 0 && result.sourceSummary.inboxCount === 1, 'Inbox-only aggregate was not returned');
});

test('Calendar and Inbox are returned together and remain distinguishable', () => {
  const result = run('2026-07-18T17:59:00+09:00', { '2026-07-18': [calendar('dentist', '2026-07-18 18:00', '2026-07-18 18:30'), inbox('milk')] });
  assert(result.count === 2 && result.sourceSummary.calendarCount === 1 && result.sourceSummary.inboxCount === 1, 'Calendar and Inbox were not combined');
  assert(result.items.map((item) => item.sourceType).sort().join(',') === 'google_calendar,paluru', 'sources were collapsed');
});

test('zero is returned only after the common aggregate has both sources', () => {
  const result = run('2026-07-18T17:59:00+09:00', { '2026-07-18': [] });
  assert(result.count === 0 && result.sourceSummary.calendarCount === 0 && result.sourceSummary.inboxCount === 0, 'zero aggregate is wrong');
  assert(aggregateCalls.length === 1, 'unexpected extra fetch before evening switch');
});

test('17:59 is today and 18:00 adds the existing tomorrow calendar window', () => {
  const at1759 = run('2026-07-18T17:59:00+09:00', { '2026-07-18': [inbox('today')] });
  assert(at1759.includeTomorrow === false && aggregateCalls.join(',') === '2026-07-18', '17:59 did not remain today');
  const at1800 = run('2026-07-18T18:00:00+09:00', {
    '2026-07-18': [inbox('today')],
    '2026-07-19': [calendar('tomorrow-event', '2026-07-19 09:00', '2026-07-19 10:00')]
  });
  assert(at1800.includeTomorrow === true && aggregateCalls.join(',') === '2026-07-18,2026-07-19', '18:00 did not use the existing rollover');
  assert(calendarReads === 1 && calendarRanges[0].join(',') === '2026-07-18,2026-07-20', 'Calendar was not read once for the shared rollover range');
  assert(at1800.items.some((item) => item.id === 'tomorrow-event'), 'tomorrow calendar was omitted');
});

test('Home and Agent consume the same aggregate settings and sources without duplicate reads', () => {
  const result = run('2026-07-18T18:00:00+09:00', {
    '2026-07-18': [inbox('today')],
    '2026-07-19': [calendar('tomorrow-event', '2026-07-19 09:00', '2026-07-19 10:00')]
  });
  const homeCount = result.count;
  const agentContext = { count: result.items.length, calendar: result.sourceSummary.calendarCount, inbox: result.sourceSummary.inboxCount };
  assert(homeCount === agentContext.count && agentContext.calendar === 1 && agentContext.inbox === 1, 'Home and Agent would observe different aggregates');
  assert(inboxReads === 1, 'Inbox was read more than once for one aggregate');
  assert(calendarReads === 1, 'Calendar was read more than once for one aggregate');
});

test('server-normalized selection and includeUnknown are identical for Home and Agent internal requests', () => {
  const settings = { selectedMemberKeys: ['mother', 'family'], includeUnknown: true, tomorrowScheduleStartTime: '18:00', scope: 'family' };
  const home = run('2026-07-18T17:59:00+09:00', { '2026-07-18': [inbox('milk')] }, settings);
  const homeParams = aggregateParams[0];
  context.authenticateInternalCalendar_ = () => {};
  context.getHomeMember_ = () => ({ status: 'active' });
  context.isHomeMemberPolicyMatch_ = () => true;
  inboxReads = 0; calendarReads = 0; aggregateCalls = []; aggregateParams = [];
  const internal = JSON.parse(context.todayParuruContextInternal_({
    action: 'todayParuruContextInternal', internalToken: 'test', actor, todayParuruSettings: settings
  }, 'POST', { now: new Date('2026-07-18T17:59:00+09:00'), inboxItems: [{ id: 'inbox-source' }], calendarCandidates: [] }).getContent()).data;
  assert(internal.count === home.count, 'Home and Agent internal contexts differ in count');
  assert(aggregateParams[0].selectedMemberKeys === 'mother,family' && aggregateParams[0].includeUnknown === 'true', 'Agent internal settings were not normalized identically');
  assert(homeParams.selectedMemberKeys === 'mother,family' && homeParams.includeUnknown === 'true', 'Home settings were not normalized identically');
});

let failures = 0;
tests.forEach((item) => {
  try { item.fn(); console.log('PASS ' + item.name); }
  catch (error) { failures += 1; console.error('FAIL ' + item.name + ': ' + error.message); }
});
if (failures) process.exitCode = 1;
else console.log('PASS all ' + tests.length + ' Today Paruru aggregation tests');

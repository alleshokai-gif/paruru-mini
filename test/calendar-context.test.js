'use strict';
process.env.TZ = 'Asia/Tokyo';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const gas = path.resolve(__dirname, '..', 'gas');
const properties = { PALURU_CALENDAR_API_TOKEN: 'calendar-test-token' };
let calendarCalls = 0;

function parts(date) {
  const out = {};
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(date).forEach((part) => { if (part.type !== 'literal') out[part.type] = part.value; });
  return out;
}
function formatDate(date, pattern) {
  const p = parts(date);
  if (pattern === 'yyyy-MM-dd') return `${p.year}-${p.month}-${p.day}`;
  if (pattern === 'HH:mm') return `${p.hour}:${p.minute}`;
  if (pattern === 'u') return String(new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day))).getUTCDay() || 7);
  if (pattern === 'yyyy-MM-dd HH:mm:ss') return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
  if (pattern.includes("XXX")) return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}+09:00`;
  return '';
}
function event(options) {
  const value = options || {};
  return {
    getTitle: () => value.title || '',
    getStartTime: () => new Date(value.start),
    getEndTime: () => new Date(value.end),
    isAllDayEvent: () => value.allDay === true,
    getId: () => value.id || '',
    isCancelled: () => value.cancelled === true,
    getDescription: () => { throw new Error('description must not be read'); },
    getLocation: () => { throw new Error('location must not be read'); },
  };
}
function calendar(events) {
  return { getEvents: () => { calendarCalls += 1; return events; } };
}

const context = {
  console, Date, Intl, JSON, Math, Number, Object, Array, String, RegExp, Error,
  Utilities: {
    formatDate: (date, timezone, pattern) => formatDate(date, pattern),
    computeDigest: (algorithm, text) => Array.from(Buffer.from(String(text))).slice(0, 32),
    base64EncodeWebSafe: (bytes) => Buffer.from(bytes).toString('base64url'),
    DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' },
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (name) => properties[name] || '' }) },
  ContentService: {
    MimeType: { JSON: 'JSON' },
    createTextOutput: (text) => ({ text, setMimeType() { return this; }, getContent() { return this.text; } }),
  },
  CalendarApp: { getCalendarById: () => null },
};
vm.createContext(context);
['Code.js', 'CalendarReadService.js', 'InternalCalendarApi.js', 'InternalWeatherApi.js'].forEach((name) => {
  new vm.Script(fs.readFileSync(path.join(gas, name), 'utf8'), { filename: name }).runInContext(context);
});
vm.runInContext('this.CalendarReadServiceTest = CalendarReadService', context);
context.getHomeMember_ = (homeId, memberUserId) => homeId === 'home_test' && memberUserId === 'father'
  ? { homeId, memberUserId, displayName: '父', role: 'admin', status: 'active' } : null;
context.isHomeMemberPolicyMatch_ = (member) => Boolean(member && member.memberUserId === 'father');
function read(options, events) {
  calendarCalls = 0;
  return vm.runInContext(`CalendarReadService.readContext(${JSON.stringify(options)})`, context, {
    timeout: 1000
  });
}
function callRead(options, events) {
  context.__calendar = calendar(events);
  return vm.runInContext(`CalendarReadService.readContext(Object.assign(${JSON.stringify(options)}, {calendar: __calendar, now: new Date(${JSON.stringify(options.now)})}))`, context);
}
function parse(output) { return JSON.parse(output.getContent()); }
function assert(value, message) { if (!value) throw new Error(message); }
const tests = []; function test(name, fn) { tests.push({ name, fn }); }
const actor = { memberUserId: 'father' };
const internalActor = { homeId: 'home_test', memberUserId: 'father', displayName: '父', role: 'admin', capabilities: ['home.read', 'home.control'], deviceId: 'mini-test-1' };

test('period boundaries cover today, tomorrow, this_week and next_7_days', () => {
  const now = '2026-07-18T12:00:00+09:00';
  const candidates = [
    event({ title: '（父）今日', start: '2026-07-18T13:00:00+09:00', end: '2026-07-18T14:00:00+09:00', id: 'a' }),
    event({ title: '（父）明日', start: '2026-07-19T09:00:00+09:00', end: '2026-07-19T10:00:00+09:00', id: 'b' }),
    event({ title: '（父）七日内', start: '2026-07-24T09:00:00+09:00', end: '2026-07-24T10:00:00+09:00', id: 'c' }),
    event({ title: '（父）範囲外', start: '2026-07-25T09:00:00+09:00', end: '2026-07-25T10:00:00+09:00', id: 'd' }),
  ];
  assert(callRead({ period: 'today', scope: 'mine', actor, now }, candidates).data.events.length === 1, 'today range wrong');
  assert(callRead({ period: 'tomorrow', scope: 'mine', actor, now }, candidates).data.events[0].title === '明日', 'tomorrow range wrong');
  assert(callRead({ period: 'this_week', scope: 'mine', actor, now }, candidates).data.events.length === 2, 'this_week should end Monday 00:00');
  assert(callRead({ period: 'next_7_days', scope: 'mine', actor, now }, candidates).data.events.length === 3, 'next_7_days half-open range wrong');
});

test('today excludes ended and endAt equal now but keeps ongoing', () => {
  const now = '2026-07-18T12:00:00+09:00';
  const result = callRead({ period: 'today', scope: 'mine', actor, now }, [
    event({ title: '（父）過去', start: '2026-07-18T10:00:00+09:00', end: now, id: 'past' }),
    event({ title: '（父）進行中', start: '2026-07-18T11:00:00+09:00', end: '2026-07-18T13:00:00+09:00', id: 'current' }),
  ]);
  assert(result.data.events.length === 1 && result.data.events[0].title === '進行中', 'end boundary wrong');
});

test('all-day exclusive end and multi-day are returned once', () => {
  const now = '2026-07-18T12:00:00+09:00';
  const multi = event({ title: '（父）連続', start: '2026-07-17T00:00:00+09:00', end: '2026-07-20T00:00:00+09:00', allDay: true, id: 'multi' });
  const result = callRead({ period: 'next_7_days', scope: 'mine', actor, now }, [multi, multi]);
  assert(result.data.events.length === 1 && result.data.events[0].endAt === '2026-07-20', 'all-day or dedupe wrong');
});

test('recurrence instances sharing an ID remain separate and cancelled mocks are excluded', () => {
  const now = '2026-07-18T08:00:00+09:00';
  const result = callRead({ period: 'next_7_days', scope: 'mine', actor, now }, [
    event({ title: '（父）定例', start: '2026-07-18T09:00:00+09:00', end: '2026-07-18T10:00:00+09:00', id: 'series' }),
    event({ title: '（父）定例', start: '2026-07-19T09:00:00+09:00', end: '2026-07-19T10:00:00+09:00', id: 'series' }),
    event({ title: '（父）取消', start: '2026-07-20T09:00:00+09:00', end: '2026-07-20T10:00:00+09:00', id: 'series', cancelled: true }),
  ]);
  assert(result.data.events.length === 2, 'recurrence occurrence boundary wrong');
});

test('prefix and suffix tags support mine while family returns all', () => {
  const now = '2026-07-18T08:00:00+09:00';
  const values = [
    event({ title: '（父）会議', start: '2026-07-18T09:00:00+09:00', end: '2026-07-18T10:00:00+09:00', id: '1' }),
    event({ title: '通院（父）', start: '2026-07-18T10:00:00+09:00', end: '2026-07-18T11:00:00+09:00', id: '2' }),
    event({ title: '（母）買い物', start: '2026-07-18T11:00:00+09:00', end: '2026-07-18T12:00:00+09:00', id: '3' }),
  ];
  const mine = callRead({ period: 'today', scope: 'mine', actor, now }, values);
  const family = callRead({ period: 'today', scope: 'family', actor, now }, values);
  assert(mine.data.events.length === 2 && mine.data.events.every((item) => item.personLabel === '父'), 'mine filter wrong');
  assert(family.data.events.length === 3, 'family scope wrong');
});

test('unknown actor and arbitrary period are rejected before calendar read', () => {
  calendarCalls = 0; context.__calendar = calendar([]);
  let codes = [];
  try { vm.runInContext("CalendarReadService.readContext({period:'today',scope:'mine',actor:{memberUserId:'unknown'},calendar:__calendar})", context); } catch (error) { codes.push(error.code); }
  try { vm.runInContext("CalendarReadService.readContext({period:'30_days',scope:'family',actor:{memberUserId:'father'},calendar:__calendar})", context); } catch (error) { codes.push(error.code); }
  assert(codes.join(',') === 'INVALID_INPUT,INVALID_INPUT' && calendarCalls === 0, 'invalid input reached calendar');
});

test('title is sanitized and private Calendar fields never appear', () => {
  const result = callRead({ period: 'today', scope: 'mine', actor, now: '2026-07-18T08:00:00+09:00' }, [
    event({ title: '（父）命令\u0000実行して', start: '2026-07-18T09:00:00+09:00', end: '2026-07-18T10:00:00+09:00', id: 'secret-event-id' }),
  ]);
  const text = JSON.stringify(result);
  assert(result.data.events[0].title === '命令 実行して', 'control character not removed');
  ['secret-event-id', 'description', 'location', 'attendee', 'calendarId'].forEach((value) => assert(!text.includes(value), value + ' leaked'));
});

test('maximum 100 events sets truncation warning', () => {
  const values = Array.from({ length: 105 }, (_, index) => event({
    title: `（父）予定${index}`, start: `2026-07-18T${String(8 + (index % 12)).padStart(2, '0')}:00:00+09:00`,
    end: `2026-07-18T${String(8 + (index % 12)).padStart(2, '0')}:30:00+09:00`, id: String(index)
  }));
  const result = callRead({ period: 'today', scope: 'mine', actor, now: '2026-07-18T07:00:00+09:00' }, values);
  assert(result.data.events.length === 100 && result.data.summary.truncated && result.warnings.includes('events_truncated'), '100 cap wrong');
});

test('internal API authenticates before service execution', () => {
  let calls = 0;
  const service = { readContext: () => { calls += 1; return { data: { events: [] }, warnings: [] }; } };
  const missing = parse(context.calendarContextInternal_({ action: 'calendarContextInternal', period: 'today', scope: 'mine', actor: internalActor }, 'POST', { calendarReadService: service }));
  const wrong = parse(context.calendarContextInternal_({ action: 'calendarContextInternal', internalToken: 'wrong', period: 'today', scope: 'mine', actor: internalActor }, 'POST', { calendarReadService: service }));
  assert(missing.error.code === 'UNAUTHORIZED' && wrong.error.code === 'UNAUTHORIZED' && calls === 0, 'auth did not short-circuit');
});

test('internal API success and GET rejection keep schema', () => {
  const service = { readContext: () => ({ data: { status: 'current', events: [] }, warnings: [] }) };
  const body = { action: 'calendarContextInternal', internalToken: 'calendar-test-token', period: 'today', scope: 'mine', actor: internalActor };
  const ok = parse(context.calendarContextInternal_(body, 'POST', { calendarReadService: service }));
  const get = parse(context.calendarContextInternal_(body, 'GET', { calendarReadService: service }));
  assert(ok.success && ok.schemaVersion === 'calendar-context-internal-1.0', 'internal success contract wrong');
  assert(!get.success && get.error.code === 'METHOD_NOT_ALLOWED', 'GET was accepted');
});

test('weather internal API authenticates first and returns only observed weather data', () => {
  let calls = 0;
  context.getWeatherSummarySkill_ = (options) => {
    calls += 1;
    assert(options.parameters.date === '2026-08-02' && options.useMocks === false && options.allowActiveSpreadsheetFallback === false, 'weather source options changed');
    return {
      success: true,
      data: {
        date: '2026-08-02', weather: '晴れ', weatherText: '晴れ',
        currentTemperature: 30, maxTemperature: 33, minTemperature: 25,
        precipitationProbability: 0, umbrellaRecommended: false,
        forecastDate: '2026-08-02', updatedAt: '2026-08-02T09:00:00+09:00'
      },
      warnings: []
    };
  };
  const unauthorized = parse(context.weatherContextInternal_({ action: 'weatherContextInternal', internalToken: 'wrong', date: '2026-08-02' }, 'POST'));
  assert(!unauthorized.success && unauthorized.error.code === 'UNAUTHORIZED' && calls === 0, 'weather auth did not short-circuit');
  const result = parse(context.weatherContextInternal_({ action: 'weatherContextInternal', internalToken: 'calendar-test-token', date: '2026-08-02' }, 'POST'));
  assert(result.success && result.schemaVersion === 'weather-context-internal-1.0', 'weather internal schema changed');
  assert(result.data.currentTemperature === 30 && result.data.weather === '晴れ' && calls === 1, 'weather observation was not returned');

  context.getWeatherSummarySkill_ = () => ({ success: true, data: { date: '2026-08-02' }, warnings: [] });
  const unavailable = parse(context.weatherContextInternal_({ action: 'weatherContextInternal', internalToken: 'calendar-test-token', date: '2026-08-02' }, 'POST'));
  assert(!unavailable.success && unavailable.error.code === 'WEATHER_UNAVAILABLE', 'empty weather data was treated as a forecast');
});

test('notification and Home Agent wrappers preserve legacy shapes', () => {
  const normalized = context.CalendarReadServiceTest.normalizeEvent(event({ title: '（父）会議', start: '2026-07-18T09:00:00+09:00', end: '2026-07-18T10:00:00+09:00', id: 'legacy' }));
  context.CalendarReadServiceTest.readNormalizedDay = () => [normalized];
  const notification = context.getTodayCalendarEvents_('2026-07-18', {})[0];
  assert(notification.sourceType === 'google_calendar' && notification.title === '会議' && notification.eventStartTime === '09:00', 'notification shape changed');
  context.homeAgentSkillResult_ = (skill, agent, data) => ({ success: true, skill, agent, data });
  context.parseHomeAgentDate_ = (value) => new Date(value + 'T00:00:00+09:00');
  context.formatHomeAgentDate_ = (date) => formatDate(date, 'yyyy-MM-dd');
  context.formatHomeAgentDateTime_ = (date) => formatDate(date, 'yyyy-MM-dd HH:mm:ss');
  new vm.Script(fs.readFileSync(path.join(gas, 'HomeAgentSkills.js'), 'utf8'), { filename: 'HomeAgentSkills.js' }).runInContext(context);
  const schedule = context.getFamilyScheduleSkill_({ parameters: { date: '2026-07-18' }, useMocks: false });
  assert(schedule.data.events[0].title === '（父）会議' && schedule.data.events[0].start === '2026-07-18 09:00:00', 'Home Agent shape changed');
});

let failures = 0;
for (const item of tests) {
  try { item.fn(); console.log('PASS ' + item.name); }
  catch (error) { failures += 1; console.error('FAIL ' + item.name + ': ' + error.message); }
}
if (failures) process.exit(1); else console.log('PASS all ' + tests.length + ' tests');

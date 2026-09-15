import assert from 'node:assert/strict';
import { readLocalToken } from './local-secret.js';
import { fetchOdptStatic, normalizeTokyuStatic, buildTokyuArrivals } from '../providers/tokyu/static.js';
import { CALENDARS, TOKYU_HUB_DIRECTIONS } from '../providers/tokyu/config.js';
import { resolveTokyuServiceCalendar } from '../providers/tokyu/calendar.js';

const OFFICIAL_TIMETABLES = Object.freeze({
  kibukihoncho_to_kajigaya:
    'https://transfer.navitime.biz/tokyubus/pc/diagram/BusDiagram?course=0004600073&orvCode=00240751&stopNo=10',
  kibukihoncho_to_mukougaoka:
    'https://transfer.navitime.biz/tokyubus/pc/diagram/BusDiagram?course=0004600232&orvCode=00240751&stopNo=8',
  mukougaoka_to_kibukihoncho:
    'https://transfer.navitime.biz/tokyubus/pc/diagram/BusDiagram?course=0004600073&orvCode=00240650&stopNo=1'
});
const COLUMN = Object.freeze({
  [CALENDARS.weekday]: 'wkd',
  [CALENDARS.saturday]: 'std',
  [CALENDARS.sunday]: 'snd'
});
const MAX_OFFICIAL_BYTES = 256 * 1024;

async function officialHtml(url) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  assert.equal(response.ok, true);
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.ok(bytes.length > 0 && bytes.length <= MAX_OFFICIAL_BYTES);
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function officialColumns(html) {
  assert.match(html, /<th class="wkd">\s*平日\s*<\/th>/);
  assert.match(html, /<th class="std">\s*土曜\s*<\/th>/);
  assert.match(html, /<th class="snd">\s*休日\s*<\/th>/);
  const values = { wkd: [], std: [], snd: [] };
  for (const row of html.matchAll(/<tr class="l2">([\s\S]*?)<\/tr>/g)) {
    const hour = /<th class="hour">\s*(\d{2})\s*<\/th>/.exec(row[1])?.[1];
    if (!hour) continue;
    for (const className of Object.keys(values)) {
      const cell = new RegExp(`<td class="${className}">([\\s\\S]*?)<\\/td>`).exec(row[1])?.[1] || '';
      for (const minute of cell.matchAll(/<span aria-hidden="true">\s*(\d{2})\s*<\/span>/g))
        values[className].push(`${hour}:${minute[1]}`);
    }
  }
  assert.ok(Object.values(values).every((rows) => rows.length > 0));
  return values;
}

function odptColumns(data) {
  return Object.fromEntries(Object.values(CALENDARS).map((calendar) => [calendar,
    data.calendars[calendar].map((seconds) => `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(seconds % 3600 / 60).padStart(2, '0')}`)]));
}

async function directionData(query, token) {
  const [stops, patterns, timetables, html] = await Promise.all([
    fetchOdptStatic('odpt:BusstopPole', { 'owl:sameAs': query.fromStopId }, token),
    fetchOdptStatic('odpt:BusroutePattern', { 'owl:sameAs': query.routePatternId }, token),
    fetchOdptStatic('odpt:BusstopPoleTimetable', { 'odpt:operator': query.operatorId,
      'odpt:busstopPole': query.fromStopId }, token),
    officialHtml(OFFICIAL_TIMETABLES[query.sourceId])
  ]);
  const data = normalizeTokyuStatic({ query, stops, patterns, timetables, fetchedAt: Date.now() / 1000 });
  const odpt = odptColumns(data), official = officialColumns(html);
  for (const calendar of Object.values(CALENDARS)) assert.deepEqual(odpt[calendar], official[COLUMN[calendar]]);
  return { data, counts: {
    weekday: odpt[CALENDARS.weekday].length,
    saturday: odpt[CALENDARS.saturday].length,
    sunday: odpt[CALENDARS.sunday].length,
    officialHoliday: official.snd.length
  } };
}

const token = readLocalToken();
const [calendarHoliday, calendarSunday, ...directions] = await Promise.all([
  fetchOdptStatic('odpt:Calendar', { 'owl:sameAs': 'odpt.Calendar:Holiday' }, token),
  fetchOdptStatic('odpt:Calendar', { 'owl:sameAs': 'odpt.Calendar:Sunday' }, token),
  ...TOKYU_HUB_DIRECTIONS.map((query) => directionData(query, token))
]);
assert.equal(calendarHoliday[0]?.['dc:title'], '休日');
assert.equal(calendarSunday[0]?.['dc:title'], '日曜日');

const dateCases = [
  ['weekday', '2026-09-14T06:00:00+09:00'],
  ['saturday', '2026-09-19T06:00:00+09:00'],
  ['sunday', '2026-09-20T06:00:00+09:00'],
  ['holiday', '2026-09-21T06:00:00+09:00']
];
const resolved = [];
for (const [expectedType, iso] of dateCases) {
  const now = Date.parse(iso) / 1000, service = resolveTokyuServiceCalendar(now);
  assert.equal(service?.serviceDayType, expectedType);
  for (const value of directions) assert.equal(buildTokyuArrivals(value.data, now).length, 3);
  resolved.push({ date: iso.slice(0, 10), serviceDayType: service.serviceDayType, calendar: service.calendar });
}

console.log(JSON.stringify({ status: 'TOKYU_CALENDAR_LIVE_PASS',
  directions: TOKYU_HUB_DIRECTIONS.map((query, index) => ({ sourceId: query.sourceId,
    platform: query.platform, destination: query.destinationName, counts: directions[index].counts,
    allOfficialColumnsMatched: true })),
  calendarDefinitions: { holiday: '休日', sunday: '日曜日' }, resolved,
  holidayMappingEvidence: 'odpt_sunday_equals_official_holiday_all_entries', secretLeak: false }));

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildOdakyuStatic, extractOdakyuDetail,
  extractOdakyuDetailLinks } from '../rail/odakyu-static.js';
import { listRailTrains } from '../rail/static-provider.js';

const object = (departureTime, destination = 'Shinjuku') => ({
  'odpt:trainType': 'odpt.TrainType:Odakyu.Local',
  'odpt:departureTime': departureTime,
  'odpt:destinationStation': [`odpt.Station:Odakyu.Odawara.${destination}`]
});
const row = (calendar, entries) => ({
  'odpt:operator': 'odpt.Operator:Odakyu',
  'odpt:railway': 'odpt.Railway:Odakyu.Odawara',
  'odpt:station': 'odpt.Station:Odakyu.Odawara.TamagawagakuenMae',
  'odpt:railDirection': 'odpt.RailDirection:Inbound',
  'odpt:calendar': `odpt.Calendar:${calendar}`,
  'odpt:stationTimetableObject': entries
});
const rows = () => [row('Weekday', [object('12:06')]),
  row('SaturdayHoliday', [object('12:07')])];
const detail = (calendarType, sourceDeparture, mukougaoka, noborito) => ({
  calendarType, sourceDeparture, destination: '新宿',
  mukougaoka: { stationTime: mukougaoka, stationTimeSource: 'arrival' },
  noborito: { stationTime: noborito, stationTimeSource: 'arrival' }
});
const details = () => [detail('weekday', '12:06', '12:23', '12:25'),
  detail('weekend', '12:07', '12:23', '12:25')];

test('public timetable links retain calendar and source time without guessing train identity', () => {
  const html = ['2026-09-28T12%3A06%3A00', '2026-10-04T12%3A07%3A00']
    .map((dateTime) => `window.open("/odakyu-transit/smart/diagram/StopListDiagram?tCode=abc&amp;datetime=${dateTime}&amp;posType=1","WindowName");`)
    .join('');
  const links = extractOdakyuDetailLinks(html);
  assert.deepEqual(links.map(({ calendarType, sourceDeparture }) =>
    [calendarType, sourceDeparture]), [['weekday', '12:06'], ['weekend', '12:07']]);
  assert.equal(extractOdakyuDetailLinks(html + html).length, 2);
  assert.throws(() => extractOdakyuDetailLinks(html + html.replace('tCode=abc', 'tCode=other')),
    /ODAKYU_STATIC_INVALID/);
});

test('official stop detail preserves displayed arrival/departure type', () => {
  const html = `12:06発 新宿行
    <div class="name">向ヶ丘遊園</div><div class="time">12:23<span class="landing">着</span>
    <div class="name">登戸</div><div class="time">12:25<span class="landing">発</span>`;
  const parsed = extractOdakyuDetail(html, { calendarType: 'weekday', sourceDeparture: '12:06' });
  assert.deepEqual(parsed.mukougaoka, { stationTime: '12:23', stationTimeSource: 'arrival' });
  assert.deepEqual(parsed.noborito, { stationTime: '12:25', stationTimeSource: 'departure' });
  assert.throws(() => extractOdakyuDetail(html, { calendarType: 'weekday', sourceDeparture: '12:15' }),
    /ODAKYU_STATIC_INVALID/);
});

test('Challenge departure joins confirmed same-train stop times for both calendars', () => {
  const artifact = buildOdakyuStatic(rows(), details());
  assert.equal(artifact.sample, false);
  assert.equal(artifact.trains.length, 2);
  assert.deepEqual(artifact.trains[0].candidateStations.map((stop) => stop.stationTimeSource),
    ['arrival', 'arrival']);
  const weekday = listRailTrains({ artifact, journeyId: 'university',
    now: Date.parse('2026-09-28T12:10:00+09:00') / 1000 });
  const weekend = listRailTrains({ artifact, journeyId: 'university',
    now: Date.parse('2026-10-04T12:10:00+09:00') / 1000 });
  assert.equal(weekday.trains[0].sourceDeparture, '12:06');
  assert.equal(weekend.trains[0].sourceDeparture, '12:07');
  assert.match(weekday.trains[0].label, /向ヶ丘遊園12:23着／登戸12:25着/);
});

test('unmatched, duplicate and contradicted source data fail closed', () => {
  assert.throws(() => buildOdakyuStatic(rows(), details().slice(0, 1)), /ODAKYU_STATIC_INVALID/);
  assert.throws(() => buildOdakyuStatic(rows(), [...details(), details()[0]]), /ODAKYU_STATIC_INVALID/);
  const wrong = details(); wrong[0].destination = '成城学園前';
  assert.throws(() => buildOdakyuStatic(rows(), wrong), /ODAKYU_STATIC_INVALID/);
  const reverse = details(); reverse[0].noborito.stationTime = '12:20';
  assert.throws(() => buildOdakyuStatic(rows(), reverse), /RAIL_STATIC_INVALID/);
});

test('normal product Preview uses generated Odakyu Static rather than fictional sample', async () => {
  const source = await readFile(new URL('../scripts/preview-product-acceptance.js', import.meta.url), 'utf8');
  assert.match(source, /\.\.\/generated\/rail-odakyu-static\.json/);
  assert.doesNotMatch(source, /\.\.\/rail\/rail-static\.example\.json/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractOdptLegs, extractOfficialStops, officialLeg, validateKazuStatic } from '../rail/kazu-commute.js';
import { createKazuRouteService } from '../rail/kazu-route-service.js';
import { mergeKawasakiStatic } from '../providers/kawasaki/journey-static.js';
import { getFutureBuses } from '../journey/future-bus.js';
import { KAWASAKI_CONTEXT } from '../providers/kawasaki/context.js';
import { P0_QUERIES } from '../config/queries.js';
import { KAWASAKI_JOURNEY_QUERIES } from '../providers/kawasaki/journey-config.js';

const DAY = Date.parse('2026-09-30T00:00:00+09:00') / 1000;
const make = (segment, dep, arrival, trainId, type = '各停') => ({ segment,
  calendarType: 'weekday', departure: dep, stationTime: arrival,
  stationTimeSource: 'arrival', trainId, trainType: type,
  destination: '登戸', source: 'test' });
const legs = [
  make('chiyoda', '17:34', '17:57', 'metro-1'),
  make('odakyu_uehara_noborito', '18:02', '18:24', 'odakyu-local'),
  make('odakyu_uehara_seijo', '18:02', '18:10', 'odakyu-local'),
  make('odakyu_seijo_noborito', '18:14', '18:20', 'odakyu-express', '急行'),
  make('mita_jimbocho', '17:35', '17:43', 'toei-1'),
  make('hanzomon', '17:48', '18:04', 'metro-h-1'),
  make('denentoshi', '18:09', '18:35', 'tokyu-d-1'),
  make('mita_meguro', '17:37', '18:00', 'toei-2'),
  make('meguro', '18:05', '18:13', 'tokyu-m-1'),
  make('oimachi_from_ookayama', '18:18', '18:40', 'tokyu-o-1'),
  make('keihin_tohoku', '17:35', '17:48', 'jr-1'),
  make('oimachi_from_oimachi', '17:55', '18:25', 'tokyu-o-2')
];
const artifact = { schemaVersion: 1, timezone: 'Asia/Tokyo', sample: false,
  sourceCheckedAt: '2026-09-30T00:00:00Z', calendarOverrides: {}, legs };
const at = (time) => DAY + Number(time.slice(0, 2)) * 3600 + Number(time.slice(3)) * 60;

test('official rows keep same-train stop times and reject missing stops', () => {
  const html = '<div class="stop-info"><div class="name">大井町</div>'
    + '<span aria-hidden="true">17:00</span><span class="landing" aria-hidden="true">発</span>'
    + '</div><div class="stop-info"><div class="name">溝の口〔東急線〕</div>'
    + '<span aria-hidden="true">17:20</span><span class="landing" aria-hidden="true">着</span></div>';
  const stops = extractOfficialStops(html);
  assert.equal(officialLeg({ segment: 'oimachi_from_oimachi', calendarType: 'weekday',
    trainId: 't1', trainType: '急行', destination: '溝の口', stops,
    fromName: '大井町', toName: '溝の口〔東急線〕', source: 'official' }).stationTime, '17:20');
  assert.equal(officialLeg({ segment: 'oimachi_from_oimachi', calendarType: 'weekday',
    trainId: 't1', trainType: '急行', destination: '溝の口', stops,
    fromName: '大井町', toName: '登戸', source: 'official' }), null);
});

test('ODPT train timetable requires ordered stops of the same train', () => {
  const rows = [{ 'odpt:calendar': 'odpt.Calendar:Weekday',
    'odpt:operator': 'odpt.Operator:TokyoMetro', 'odpt:train': 'metro-1',
    'odpt:trainType': 'odpt.TrainType:Local',
    'odpt:destinationStation': ['odpt.Station:TokyoMetro.Chiyoda.YoyogiUehara'],
    'odpt:trainTimetableObject': [
      { 'odpt:departureStation': 'odpt.Station:TokyoMetro.Chiyoda.Hibiya',
        'odpt:departureTime': '17:34' },
      { 'odpt:arrivalStation': 'odpt.Station:TokyoMetro.Chiyoda.YoyogiUehara',
        'odpt:arrivalTime': '17:57' }]
  }];
  assert.equal(extractOdptLegs(rows, 'chiyoda')[0].stationTime, '17:57');
  assert.equal(extractOdptLegs(rows, 'hanzomon').length, 0);
});

test('Hibiya ranks by home arrival and Odakyu Seijo transfer can beat direct train', async () => {
  const service = createKazuRouteService({ artifact, clock: () => at('17:28'),
    loadBuses: async ({ terminal }) => [{ provider: 'kawasaki', routeLabel: terminal === 'noborito'
      ? '登05' : '溝18', platform: '1番', departureAt: at('18:48'),
    estimatedArrival: terminal === 'noborito' ? at('19:02') : at('19:10'),
    recommendable: true, timingQuality: 'static_only', delayMinutes: null }] });
  const result = await service.evaluate('hibiya');
  assert.equal(result.routes.length, 3);
  assert.equal(result.routes[0].id, 'chiyoda_odakyu');
  assert.equal(result.routes[0].stationTimeAt, at('18:20'));
  assert.equal(result.routes[0].steps.some((step) => step.type === 'transfer'
    && step.station === '成城学園前' && step.nextTrainType === '急行'), true);
  assert.equal(result.routes[0].homeArrivalAt, at('19:02'));
  assert.equal(result.routes[1].differenceMinutes, 8);
});

test('Tamachi is single corridor and pharmacy stops at Noborito without Bus', async () => {
  let busCalls = 0;
  const service = createKazuRouteService({ artifact, clock: () => at('17:28'),
    loadBuses: async () => { busCalls++; return []; } });
  const pharmacy = await service.evaluate('pharmacy');
  assert.equal(pharmacy.routes.length, 1);
  assert.equal(pharmacy.routes[0].stationTimeAt, at('18:20'));
  assert.equal(pharmacy.routes[0].steps.some((step) => step.type === 'bus'), false);
  assert.equal(busCalls, 0);
  const tamachi = await service.evaluate('tamachi');
  assert.equal(tamachi.routes.length, 1);
  assert.equal(tamachi.routes[0].status, 'partial');
  assert.equal(busCalls, 1);
});

test('corrupt timetable fails closed', () => {
  assert.throws(() => validateKazuStatic({ ...artifact, legs: [...legs, legs[0]] }),
    /KAZU_RAIL_STATIC_INVALID/);
});

test('released fixed-corridor Static resolves weekday and holiday Kazu journeys end to end', async () => {
  const json = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
  const released = validateKazuStatic(json('../release-static/kazu-commute-static.json'));
  const segments = new Set(released.legs.map((leg) => leg.segment));
  assert.equal(segments.size, 12);
  assert.ok([...segments].every((segment) => ['weekday', 'weekend'].every((calendarType) =>
    released.legs.some((leg) => leg.segment === segment && leg.calendarType === calendarType
      && leg.departure < '12:00'))));
  const index = mergeKawasakiStatic(json('../generated/p0-static.json'),
    json('../generated/kawasaki-p2-5-static.json'));
  const queries = [...P0_QUERIES, ...KAWASAKI_JOURNEY_QUERIES];
  for (const date of ['2026-09-30', '2026-10-04']) {
    const now = Date.parse(`${date}T17:30:00+09:00`) / 1000;
    const service = createKazuRouteService({ artifact: released, clock: () => now,
      loadBuses: ({ terminal, boardingAt }) => getFutureBuses({ index,
        queries: queries.filter((query) => (terminal === 'noborito'
          ? ['noborito_to_home', 'noborito_tamagawa_to_kibukihoncho']
          : ['mizonokuchi_to_home']).includes(query.id)),
        providerContext: KAWASAKI_CONTEXT, now, boardingAt, realtime: null
      }).results.flatMap((group) => group.arrivals) });
    for (const [mode, count] of [['hibiya', 3], ['tamachi', 1], ['pharmacy', 1]]) {
      const result = await service.evaluate(mode);
      assert.equal(result.status, 'available');
      assert.equal(result.routes.length, count);
      assert.ok(result.routes.every((route) => route.steps[0].type === 'train'));
      assert.ok(result.routes.every((route) => Number.isFinite(mode === 'pharmacy'
        ? route.stationTimeAt : route.homeArrivalAt)));
    }
  }
});

test('Tamagawa exit requires its own walking buffer before a bus is eligible', async () => {
  const service = createKazuRouteService({ artifact, clock: () => at('17:28'),
    loadBuses: async () => [{ queryId: 'noborito_tamagawa_to_kibukihoncho',
      provider: 'kawasaki', routeLabel: '登06', platform: '2番',
      departureAt: at('18:29'), estimatedArrival: at('18:45'), recommendable: true,
      timingQuality: 'static_only' }] });
  const result = await service.evaluate('hibiya');
  const noborito = result.routes.find((route) => route.id === 'chiyoda_odakyu');
  assert.equal(noborito.status, 'partial');
  assert.equal(noborito.reason, 'BUS_ARRIVAL_UNAVAILABLE');
  const catchable = createKazuRouteService({ artifact, clock: () => at('17:28'),
    loadBuses: async () => [{ queryId: 'noborito_tamagawa_to_kibukihoncho',
      provider: 'kawasaki', routeLabel: '登06', platform: '2番',
      departureAt: at('18:32'), estimatedArrival: at('18:48'), recommendable: true,
      timingQuality: 'static_only' }] });
  const route = (await catchable.evaluate('hibiya')).routes.find((item) => item.id === 'chiyoda_odakyu');
  assert.equal(route.steps.find((step) => step.type === 'walk').minutes, 11);
  assert.equal(route.steps.find((step) => step.type === 'bus').boardingPlace, '登戸駅多摩川口');
});

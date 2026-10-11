import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHttpHandler } from '../http/handler.js';
import { createRailHomeRouteService } from '../rail/home-route-service.js';
import { validateRailStatic, listRailTrains } from '../rail/static-provider.js';
import { KAWASAKI_CONTEXT } from '../providers/kawasaki/context.js';
import { P0_QUERIES } from '../config/queries.js';
import { KAWASAKI_JOURNEY_QUERIES } from '../providers/kawasaki/journey-config.js';
import { indexFixture } from './fixtures.js';
import { CALENDARS as TOKYU_CALENDARS, MUKOUGAOKA_TO_KIBUKIHONCHO,
  PROVIDER_ID as TOKYU_PROVIDER } from '../providers/tokyu/config.js';

const json = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const jrStatic = json('../release-static/rail-nambu-challenge-static.json');
const odakyuStatic = json('../release-static/rail-odakyu-static.json');
const now = Date.parse('2026-09-28T17:30:00+09:00') / 1000;
const futureQueries = [...P0_QUERIES, ...KAWASAKI_JOURNEY_QUERIES];
const queryById = new Map(futureQueries.map((query) => [query.id, query]));
const SOURCE_FIXTURES = Object.freeze([
  Object.freeze({ id: 'noborito_to_home', from: '362_1', to: '184_3', routeId: '10044',
    routeLabel: '登０５', departure: '18:30:00', fromName: '登戸', toName: '神木本町' }),
  Object.freeze({ id: 'noborito_tamagawa_to_kibukihoncho', from: '365_2', to: '184_3',
    routeId: '10045', routeLabel: '登０６', departure: '18:33:00',
    fromName: '登戸駅多摩川口', toName: '神木本町' }),
  Object.freeze({ id: 'mukougaoka_to_kibukihoncho', from: '474_5', to: '184_1', routeId: '10037',
    routeLabel: '溝１９', departure: '18:36:00', fromName: '向ヶ丘遊園駅南口', toName: '神木本町' }),
  Object.freeze({ id: 'mizonokuchi_to_home', from: '434_2', to: '184_3', routeId: '10032',
    routeLabel: '溝１１', departure: '18:39:00', fromName: '溝の口駅南口', toName: '神木本町' })
]);
const sourceFixtureById = new Map(SOURCE_FIXTURES.map((fixture) => [fixture.id, fixture]));
const seconds = (time) => {
  const [hours, minutes, remainder = '00'] = time.split(':');
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(remainder);
};
const dayStart = Math.floor((now + 9 * 3600) / 86400) * 86400 - 9 * 3600;

// Fixed synthetic GTFS rows are local test input only. They never enter released timetable artifacts.
function fixedBusIndex({ unknownSources = [], noCandidates = false } = {}) {
  const unknown = new Set(unknownSources), index = indexFixture();
  for (const fixture of SOURCE_FIXTURES) {
    const query = queryById.get(fixture.id);
    assert.ok(query, `missing fixed query ${fixture.id}`);
    index.stops[fixture.from] = { stopId: fixture.from, name: fixture.fromName };
    index.stops[fixture.to] = { stopId: fixture.to, name: fixture.toName };
    index.routes[fixture.routeId] = { routeId: fixture.routeId, label: fixture.routeLabel };
    const departure = noCandidates ? '23:59:00' : fixture.departure;
    const scheduledSeconds = seconds(departure);
    index.directions[fixture.id] = [{
      tripId: `home-route-${fixture.id}`, routeId: fixture.routeId,
      routeLabel: fixture.routeLabel, serviceId: 'weekday', directionId: '0',
      startTime: departure, fromStopId: fixture.from, toStopId: fixture.to,
      stopSequence: 1, alightSequence: 9, scheduledSeconds,
      scheduledArrivalSeconds: unknown.has(fixture.id) ? null : scheduledSeconds + 15 * 60,
      originStopId: fixture.from, originSequence: 1, isOrigin: true,
      headsign: fixture.toName
    }];
  }
  return index;
}

function fixedTokyuIndex(noCandidates = false) {
  const departureSeconds = noCandidates ? seconds('23:59:00') : seconds('18:45:00');
  const row = Object.freeze({ tripId: 'home-route-tokyu', departureSeconds,
    arrivalSeconds: departureSeconds + 15 * 60 });
  return {
    provider: TOKYU_PROVIDER, queryId: MUKOUGAOKA_TO_KIBUKIHONCHO.sourceId,
    calendars: {
      [TOKYU_CALENDARS.weekday]: [row], [TOKYU_CALENDARS.saturday]: [row],
      'odpt.Calendar:Holiday': [row]
    }
  };
}

function createRuntimeService({ futureIndex = null, unknownSources = [], unavailableTokyu = false,
  noCandidates = false, realtime = null, realtimeFailure = false } = {}) {
  futureIndex ??= fixedBusIndex({ unknownSources, noCandidates });
  return createRailHomeRouteService({ jrStatic, odakyuStatic, futureIndex, futureQueries,
    providerContext: KAWASAKI_CONTEXT,
    adapter: { getRealtime: async () => {
      if (realtimeFailure) throw Error('RT_DOWN');
      return realtime;
    } },
    odptToken: 'synthetic', challengeEnv: {}, clock: () => now,
    loadTokyuIndex: async () => {
      if (unavailableTokyu) throw Error('TOKYU_DOWN');
      return fixedTokyuIndex(noCandidates);
    }
  });
}

function realtimeForMukougaoka(index) {
  const fixture = sourceFixtureById.get('mukougaoka_to_kibukihoncho');
  const row = index.directions[fixture.id][0], scheduledDeparture = dayStart + row.scheduledSeconds;
  return { timestamp: now, updates: [{
    trip: { tripId: row.tripId, routeId: row.routeId, startDate: '20260928',
      startTime: row.startTime, relationship: 0 }, timestamp: now,
    stops: [
      { stopId: row.fromStopId, sequence: row.stopSequence, relationship: 0,
        departure: { time: scheduledDeparture + 60, delay: 60 } },
      { stopId: row.toStopId, sequence: row.alightSequence, relationship: 0,
        arrival: { time: scheduledDeparture + 18 * 60, delay: 0 } }
    ]
  }] };
}

async function evaluateUniversity(service) {
  const choices = await service.getTrainChoices('university');
  return service.evaluate({ journeyId: 'university', trainId: choices.trains[0].id });
}

test('production Rail Static artifacts retain exactly the accepted non-sample train counts', () => {
  for (const [artifact, weekday, weekend] of [[jrStatic, 83, 81], [odakyuStatic, 69, 71]]) {
    validateRailStatic(artifact);
    assert.equal(artifact.sample, false);
    assert.equal(artifact.trains.filter((train) => train.calendarType === 'weekday').length, weekday);
    assert.equal(artifact.trains.filter((train) => train.calendarType === 'weekend').length, weekend);
  }
});

test('production composition serves both Rail selectors and retains Static fallback', async () => {
  const service = createRuntimeService();
  const university = await service.getTrainChoices('university');
  const school = await service.getTrainChoices('high_school');
  assert.equal(university.trains.length, 5);
  assert.equal(school.trains.length, 5);
  assert.ok(university.trains.every((train) => train.provider === 'odakyu'));
  assert.ok(school.trains.every((train) => train.provider === 'jr_east'
    && train.railRealtimeState === 'static_fallback'));
});

test('departure-only Static options remain in the DTO but cannot create a recommendation', async () => {
  const service = createRuntimeService({ unknownSources: SOURCE_FIXTURES.map(({ id }) => id),
    unavailableTokyu: true });
  const result = await evaluateUniversity(service);
  assert.equal(result.status, 'insufficient_data');
  assert.equal(result.fastest, null);
  assert.ok(result.options.length >= 3);
  assert.ok(result.options.every((option) => option.homeArrivalAt === null
    && option.timingQuality === 'arrival_unknown' && option.recommendable === false));
  assert.ok(result.unavailableSources.includes('tokyu:mukougaoka_to_kibukihoncho'));
});

test('Static known and unknown arrivals coexist without changing the existing status contract', async () => {
  const service = createRuntimeService({ unknownSources: [
    'noborito_tamagawa_to_kibukihoncho', 'mukougaoka_to_kibukihoncho'
  ] });
  const result = await evaluateUniversity(service);
  assert.equal(result.status, 'available');
  assert.ok(result.fastest);
  assert.ok(result.options.some((option) => Number.isFinite(option.homeArrivalAt)));
  assert.ok(result.options.some((option) => option.homeArrivalAt === null
    && option.timingQuality === 'arrival_unknown' && option.recommendable === false));
});

test('a rankable Static candidate plus a failed source is partial', async () => {
  const service = createRuntimeService({ unknownSources: [
    'noborito_tamagawa_to_kibukihoncho', 'mukougaoka_to_kibukihoncho'
  ], unavailableTokyu: true });
  const result = await evaluateUniversity(service);
  assert.equal(result.status, 'partial');
  assert.ok(result.fastest && Number.isFinite(result.fastest.homeArrivalAt));
  assert.ok(result.unavailableSources.includes('tokyu:mukougaoka_to_kibukihoncho'));
});

test('available sources with no buses produce an empty candidate list', async () => {
  const result = await evaluateUniversity(createRuntimeService({ noCandidates: true }));
  assert.equal(result.status, 'insufficient_data');
  assert.equal(result.fastest, null);
  assert.deepEqual(result.options, []);
  assert.deepEqual(result.unavailableSources, []);
});

test('Realtime correction and Static rows keep their distinct timing quality in one result', async () => {
  const futureIndex = fixedBusIndex({ unknownSources: [
    'noborito_tamagawa_to_kibukihoncho', 'mukougaoka_to_kibukihoncho'
  ] });
  const service = createRuntimeService({ futureIndex, realtime: realtimeForMukougaoka(futureIndex) });
  const result = await evaluateUniversity(service);
  const qualities = new Set(result.options.map((option) => option.timingQuality));
  assert.equal(result.status, 'available');
  assert.ok(qualities.has('static_only'));
  assert.ok(qualities.has('realtime_arrival'));
  assert.ok(qualities.has('arrival_unknown'));
  assert.ok(result.options.some((option) => option.timingQuality === 'realtime_arrival'
    && option.recommendable && Number.isFinite(option.homeArrivalAt)));
});

test('Odakyu and Nambu both page backward into selectable past trains', async () => {
  const service = createRuntimeService();
  for (const [journeyId, artifact] of [['university', odakyuStatic], ['high_school', jrStatic]]) {
    const current = listRailTrains({ artifact, journeyId, now });
    const previous = listRailTrains({ artifact, journeyId, now, page: -1 });
    assert.equal(current.trains.length, 5);
    assert.equal(previous.trains.length, 5);
    assert.ok(previous.trains.every((train) => train.sourceDepartureAt < now));
    assert.ok(previous.trains.at(-1).sourceDepartureAt < current.trains[0].sourceDepartureAt);
    const evaluated = await service.evaluate({ journeyId, page: -1, trainId: previous.trains.at(-1).id });
    assert.ok(['available', 'partial', 'insufficient_data'].includes(evaluated.status));
    const earlier = listRailTrains({ artifact, journeyId, now, page: -3 });
    const historical = await service.evaluate({ journeyId, page: -3, trainId: earlier.trains[0].id });
    assert.ok(['available', 'partial', 'insufficient_data'].includes(historical.status));
  }
});

test('GET-only Rail endpoints retain CORS and reject malformed requests', async () => {
  const service = createRuntimeService();
  const handler = createHttpHandler(() => ({ getArrivals: async () => ({}) }), {
    health: true, railHomeRouteServiceFactory: () => service
  });
  const env = { ALLOWED_ORIGINS: 'https://alleshokai-gif.github.io', ODPT_ACCESS_TOKEN: 'synthetic' };
  const request = (path, origin = env.ALLOWED_ORIGINS, method = 'GET') =>
    handler.fetch(new Request(`https://bus.invalid${path}`, { method, headers: { Origin: origin } }), env);
  const trains = await request('/api/bus/trains?journeyId=high_school&page=0');
  assert.equal(trains.status, 200);
  assert.equal(trains.headers.get('access-control-allow-origin'), env.ALLOWED_ORIGINS);
  assert.equal((await trains.json()).trains.length, 5);
  assert.equal((await request('/api/bus/trains?journeyId=university', 'https://other.invalid')).status, 403);
  assert.equal((await request('/api/bus/trains?journeyId=university&trainId=foo')).status, 404);
  assert.equal((await request('/api/bus/trains?journeyId=university&page=-1')).status, 200);
  assert.equal((await request('/api/bus/trains?journeyId=university&page=-51')).status, 404);
  assert.equal((await request('/api/bus/trains?journeyId=university', env.ALLOWED_ORIGINS, 'POST')).status, 405);
});

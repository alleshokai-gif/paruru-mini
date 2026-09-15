import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { aggregateHub } from '../hub/aggregator.js';
import { HUBS, KIBUKIHONCHO_HUB, MIZONOKUCHI_MINAMIGUCHI_HUB, NOBORITO_EKI_HUB,
  MUKOUGAOKA_YUEN_MINAMIGUCHI_HUB } from '../hub/config.js';
import { normalizeHubArrival } from '../hub/model.js';
import { rankHubArrivals } from '../hub/ranking.js';
import { createHubService } from '../hub/service.js';
import { normalizeKawasakiHubResult } from '../providers/kawasaki/hub.js';
import { indexFixture, P0_INPUT } from './fixtures.js';
import { BUS_POSITION_UI_ENABLED } from '../config/policy.js';
import { DEPARTURE_PREDICTION_PUBLIC_ENABLED } from '../departure/engine.js';
import { KAWASAKI_JOURNEY_QUERIES } from '../providers/kawasaki/journey-config.js';

const NOW = 1_789_260_000;
const arrival = (changes = {}) => ({
  id: 'kawasaki-trip-1', sourceId: 'home_to_mizonokuchi', provider: 'kawasaki', routeId: '10032',
  routeLabel: '溝11', destination: '溝口駅南口',
  originStop: { id: '184_1', name: '神木本町' }, targetStop: { id: '184_1', name: '神木本町' },
  scheduledDeparture: NOW + 300, estimatedDeparture: NOW + 360, effectiveDeparture: null,
  etaMinutes: 6, delayMinutes: 1, platform: '1番', realtimeState: 'realtime', departureState: 'realtime',
  actionability: 'catchable', confidence: null,
  position: { supported: false, state: null, stopsAway: null, previousStop: null, nextStop: null, confidence: null },
  ...changes
});

test('Kibukihoncho config groups by travel decision instead of Provider or platform', () => {
  assert.deepEqual(KIBUKIHONCHO_HUB.decisionGroups.map(({ id }) => id),
    ['kibukihoncho_north', 'kibukihoncho_mizonokuchi', 'kibukihoncho_kajigaya',
      'kibukihoncho_miyamae_washigamine']);
  const north = KIBUKIHONCHO_HUB.decisionGroups[0];
  assert.deepEqual(north.providers, ['kawasaki', 'tokyu']);
  assert.deepEqual(north.destinations, ['登戸駅', '向ヶ丘遊園駅南口']);
  assert.ok(KIBUKIHONCHO_HUB.sources.some((row) => row.provider === 'kawasaki' && row.sourceId === 'home_to_noborito'));
  assert.ok(KIBUKIHONCHO_HUB.sources.some((row) => row.provider === 'tokyu' && row.sourceId === 'kibukihoncho_to_kajigaya'));
  assert.ok(KIBUKIHONCHO_HUB.sources.some((row) => row.provider === 'tokyu' && row.sourceId === 'kibukihoncho_to_mukougaoka'));
  assert.ok(!KIBUKIHONCHO_HUB.sources.some((row) => row.provider === 'tokyu'
    && row.decisionGroupId === 'kibukihoncho_mizonokuchi'));
  const westbound = KIBUKIHONCHO_HUB.decisionGroups.at(-1);
  assert.equal(westbound.label, '宮前平・鷲ヶ峰方面');
  assert.deepEqual(westbound.providers, ['kawasaki']);
  assert.ok(westbound.destinations.includes('宮前平駅'));
  assert.ok(westbound.destinations.includes('鷲ヶ峰営業所前'));
  assert.ok(KIBUKIHONCHO_HUB.sources.some((row) => row.provider === 'kawasaki'
    && row.sourceId === 'kibukihoncho_to_miyamae_washigamine'
    && row.decisionGroupId === westbound.id));
  assert.ok(KIBUKIHONCHO_HUB.sources.every((row) => !Object.hasOwn(row, 'purposeId')));
  assert.deepEqual(KIBUKIHONCHO_HUB.unresolved, []);
});

test('Kibukihoncho westbound decision group ranks mixed destinations together and keeps each headsign', () => {
  const sourceId = 'kibukihoncho_to_miyamae_washigamine';
  const hub = aggregateHub({ hub: KIBUKIHONCHO_HUB, generatedAt: NOW, providerResults: [{
    provider: 'kawasaki', arrivals: [
      arrival({ id: 'washigamine', sourceId, routeId: '10034', routeLabel: '溝１６',
        destination: '鷲ヶ峰営業所前(犬蔵)', platform: '3番', scheduledDeparture: NOW + 360,
        estimatedDeparture: NOW + 420, etaMinutes: 7 }),
      arrival({ id: 'miyamaedaira', sourceId, routeId: '10033', routeLabel: '溝１５',
        destination: '宮前平駅', platform: '3番', scheduledDeparture: NOW + 120,
        estimatedDeparture: NOW + 180, etaMinutes: 3 }),
      arrival({ id: 'sugaosoko', sourceId, routeId: '10035', routeLabel: '溝１７',
        destination: '菅生車庫(蔵敷)', platform: '3番', scheduledDeparture: NOW + 240,
        estimatedDeparture: NOW + 300, etaMinutes: 5 }),
      arrival({ id: 'fourth', sourceId, routeId: '10044', routeLabel: '登０５',
        destination: '向丘出張所', platform: '3番', scheduledDeparture: NOW + 480,
        estimatedDeparture: NOW + 540, etaMinutes: 9 })
    ]
  }] });
  const group = hub.decisionGroups.find((row) => row.id === 'kibukihoncho_miyamae_washigamine');
  assert.deepEqual(group.arrivals.map((row) => row.id), ['miyamaedaira', 'sugaosoko', 'washigamine']);
  assert.deepEqual(group.arrivals.map((row) => row.destination),
    ['宮前平駅', '菅生車庫(蔵敷)', '鷲ヶ峰営業所前(犬蔵)']);
  assert.ok(group.arrivals.every((row) => row.platform === '3番'));
});

test('Mizonokuchi south exit config combines the three verified platforms into one decision group', () => {
  assert.deepEqual(HUBS.map(({ id }) => id), ['kibukihoncho', 'mizonokuchi-minamiguchi',
    'tachikawa-ekikitaguchi', 'showa-daiichi-gakuen', 'noborito-eki', 'mukougaoka-yuen-minamiguchi']);
  assert.equal(MIZONOKUCHI_MINAMIGUCHI_HUB.label, '溝の口駅南口');
  assert.deepEqual(MIZONOKUCHI_MINAMIGUCHI_HUB.decisionGroups, [{
    id: 'mizonokuchi_minamiguchi_home', hubId: 'mizonokuchi-minamiguchi', label: '神木本町方面',
    destinations: ['神木本町'], providers: ['kawasaki'], displayLimit: 3
  }]);
  assert.deepEqual(MIZONOKUCHI_MINAMIGUCHI_HUB.sources, [{ provider: 'kawasaki',
    sourceId: 'mizonokuchi_to_home', decisionGroupId: 'mizonokuchi_minamiguchi_home', walkMinutes: null }]);
});

test('P2.5 child Hub configs bind only verified trips through Kibukihoncho', () => {
  assert.deepEqual(NOBORITO_EKI_HUB.decisionGroups, [{ id: 'noborito_kibukihoncho', hubId: 'noborito-eki',
    label: '神木本町方面', destinations: ['神木本町経由'], providers: ['kawasaki'], displayLimit: 3 }]);
  assert.deepEqual(NOBORITO_EKI_HUB.sources, [{ provider: 'kawasaki', sourceId: 'noborito_to_home',
    decisionGroupId: 'noborito_kibukihoncho', walkMinutes: null }]);
  assert.deepEqual(MUKOUGAOKA_YUEN_MINAMIGUCHI_HUB.decisionGroups[0].providers, ['kawasaki', 'tokyu']);
  assert.deepEqual(MUKOUGAOKA_YUEN_MINAMIGUCHI_HUB.sources.map((row) => `${row.provider}|${row.sourceId}`),
    ['kawasaki|mukougaoka_to_kibukihoncho', 'tokyu|mukougaoka_to_kibukihoncho']);
  assert.deepEqual(MUKOUGAOKA_YUEN_MINAMIGUCHI_HUB.unresolved, []);
});

test('normalized Hub model retains common fields and strips raw coordinates', () => {
  const normalized = normalizeHubArrival(arrival({
    position: { supported: true, state: 'between_stops', stopsAway: 2, previousStop: '平', nextStop: '堰下',
      confidence: 0.96, lat: 35.6, lon: 139.5 }, rawResponse: { token: 'never' }
  }), NOW);
  assert.equal(normalized.routeId, '10032');
  assert.equal(normalized.position.stopsAway, 2);
  assert.ok(!Object.hasOwn(normalized.position, 'lat'));
  assert.ok(!Object.hasOwn(normalized.position, 'lon'));
  assert.ok(!Object.hasOwn(normalized, 'rawResponse'));
});

test('normalized Hub model rejects contradictory ETA and malformed required values', () => {
  assert.throws(() => normalizeHubArrival(arrival({ estimatedDeparture: NOW + 600, etaMinutes: 2 }), NOW),
    /BUS_HUB_ETA_CONTRADICTION/);
  assert.throws(() => normalizeHubArrival(arrival({ routeId: '' }), NOW), /BUS_HUB_ARRIVAL_INVALID/);
  assert.throws(() => normalizeHubArrival(arrival({ position: { supported: false, lat: 0, lon: 0 } }), NaN),
    /BUS_HUB_TIME_INVALID/);
});

test('ranking uses effective departure then ETA and ignores position as a ranking signal', () => {
  const values = [
    arrival({ id: 'eta', sourceId: 'home_to_noborito', etaMinutes: 5, estimatedDeparture: NOW + 300,
      scheduledDeparture: NOW + 240, position: { supported: true, state: 'between_stops', stopsAway: 1,
        previousStop: 'A', nextStop: 'B', confidence: 1 } }),
    arrival({ id: 'effective', sourceId: 'home_to_noborito', effectiveDeparture: NOW + 240,
      etaMinutes: null, estimatedDeparture: null, scheduledDeparture: NOW + 180 }),
    arrival({ id: 'static', sourceId: 'home_to_noborito', etaMinutes: null, estimatedDeparture: null,
      scheduledDeparture: NOW + 360, realtimeState: 'static_only', departureState: 'scheduled', position: { supported: false } })
  ];
  const ranked = rankHubArrivals(values.map((value) => normalizeHubArrival(value, NOW)), NOW);
  assert.deepEqual(ranked.map(({ id }) => id), ['effective', 'eta', 'static']);
  assert.deepEqual(ranked.map(({ rankingBasis }) => rankingBasis), ['effective_departure', 'eta', 'scheduled_departure']);
});

test('static-only participates in chronological comparison while retaining lower information quality', () => {
  const ranked = rankHubArrivals([
    normalizeHubArrival(arrival({ id: 'static-first', provider: 'tokyu', sourceId: 'kibukihoncho_to_kajigaya',
      routeId: 'tokyu-route', scheduledDeparture: NOW + 60, estimatedDeparture: null, etaMinutes: null,
      delayMinutes: null, realtimeState: 'static_only', departureState: 'scheduled', actionability: null }), NOW),
    normalizeHubArrival(arrival({ id: 'live-later', scheduledDeparture: NOW + 240,
      estimatedDeparture: NOW + 300, etaMinutes: 5 }), NOW)
  ], NOW);
  assert.deepEqual(ranked.map(({ id }) => id), ['static-first', 'live-later']);
  assert.deepEqual(ranked.map(({ recommendationQuality }) => recommendationQuality), ['static_only', 'realtime']);
  assert.equal(ranked[0].rankingBasis, 'scheduled_departure');
});

test('low confidence is downranked and departure uncertain is never recommended', () => {
  const ranked = rankHubArrivals([
    normalizeHubArrival(arrival({ id: 'low', etaMinutes: 1, estimatedDeparture: NOW + 60, confidence: 0.2 }), NOW),
    normalizeHubArrival(arrival({ id: 'normal', etaMinutes: 4, estimatedDeparture: NOW + 240 }), NOW),
    normalizeHubArrival(arrival({ id: 'uncertain', etaMinutes: null, estimatedDeparture: null,
      scheduledDeparture: NOW + 30, departureState: 'departure_uncertain', actionability: 'do_not_recommend' }), NOW)
  ], NOW);
  assert.deepEqual(ranked.map(({ id }) => id), ['normal', 'low', 'uncertain']);
  assert.deepEqual(ranked.map(({ recommendable }) => recommendable), [true, false, false]);
});

test('Mizonokuchi ranking crosses platforms and only marks a sufficiently reliable fastest candidate', () => {
  const hub = aggregateHub({ hub: MIZONOKUCHI_MINAMIGUCHI_HUB, generatedAt: NOW,
    providerResults: [{ provider: 'kawasaki', arrivals: [
      arrival({ id: 'platform-2-uncertain', sourceId: 'mizonokuchi_to_home', destination: '神木本町',
        platform: '2番', scheduledDeparture: NOW + 30, estimatedDeparture: null, etaMinutes: null,
        departureState: 'departure_uncertain', actionability: 'do_not_recommend' }),
      arrival({ id: 'platform-3', sourceId: 'mizonokuchi_to_home', destination: '神木本町', platform: '3番',
        routeId: '10036', routeLabel: '溝１８', scheduledDeparture: NOW + 180,
        estimatedDeparture: NOW + 240, etaMinutes: 4, delayMinutes: 1 }),
      arrival({ id: 'platform-4', sourceId: 'mizonokuchi_to_home', destination: '神木本町', platform: '4番',
        routeId: '10032', routeLabel: '溝１１', scheduledDeparture: NOW + 300,
        estimatedDeparture: NOW + 360, etaMinutes: 6, delayMinutes: 1 })
    ] }] });
  const group = hub.decisionGroups[0];
  assert.deepEqual(group.arrivals.map((row) => row.platform), ['3番', '4番', '2番']);
  assert.equal(group.recommendedArrivalId, 'platform-3');
  assert.equal(group.arrivals.find((row) => row.id === 'platform-2-uncertain').recommendable, false);

  const staleOnly = aggregateHub({ hub: MIZONOKUCHI_MINAMIGUCHI_HUB, generatedAt: NOW,
    providerResults: [{ provider: 'kawasaki', arrivals: [arrival({ id: 'stale', sourceId: 'mizonokuchi_to_home',
      destination: '神木本町', platform: '2番', realtimeState: 'stale' })] }] });
  assert.equal(staleOnly.decisionGroups[0].recommendedArrivalId, null);
});

test('Kawasaki-only result remains available when Tokyu is missing', () => {
  const hub = aggregateHub({ hub: KIBUKIHONCHO_HUB, generatedAt: NOW,
    providerResults: [{ provider: 'kawasaki', arrivals: [arrival()] }] });
  assert.equal(hub.decisionGroups.find((group) => group.id === 'kibukihoncho_mizonokuchi').recommendedArrivalId,
    'kawasaki-trip-1');
  assert.equal(hub.providers.find((row) => row.provider === 'kawasaki').state, 'available');
  assert.deepEqual(hub.providers.find((row) => row.provider === 'tokyu'),
    { provider: 'tokyu', state: 'unavailable', code: 'RESULT_MISSING', invalidCount: 0 });
});

test('Hub aggregate and API model retain realtime delayMinutes and reject it for static-only', () => {
  const hub = aggregateHub({ hub: KIBUKIHONCHO_HUB, generatedAt: NOW, providerResults: [
    { provider: 'kawasaki', arrivals: [arrival({ delayMinutes: 7 })] },
    { provider: 'tokyu', arrivals: [arrival({ id: 'tokyu-static', provider: 'tokyu',
      sourceId: 'kibukihoncho_to_kajigaya', routeId: 'odpt.Busroute:TokyuBus.Kou01', routeLabel: '向０１',
      destination: '梶が谷駅', scheduledDeparture: NOW + 120, estimatedDeparture: null, etaMinutes: null,
      delayMinutes: null, platform: 'a', realtimeState: 'static_only', departureState: 'scheduled', actionability: null })] }
  ] });
  const live = hub.decisionGroups.find((group) => group.id === 'kibukihoncho_mizonokuchi').arrivals[0];
  const staticOnly = hub.decisionGroups.find((group) => group.id === 'kibukihoncho_kajigaya').arrivals[0];
  assert.equal(live.delayMinutes, 7);
  assert.equal(hub.arrivals.find((row) => row.id === live.id).delayMinutes, 7);
  assert.equal(staticOnly.delayMinutes, null);
});

test('Hub Provider status exposes safe static retrieval metadata', () => {
  const hub = aggregateHub({ hub: KIBUKIHONCHO_HUB, generatedAt: NOW, providerResults: [
    { provider: 'tokyu', arrivals: [], retrievedAt: NOW - 10, sourceUpdatedAt: NOW - 100 }
  ] });
  assert.deepEqual(hub.providers.find((row) => row.provider === 'tokyu'), {
    provider: 'tokyu', state: 'available', code: null, invalidCount: 0,
    retrievedAt: NOW - 10, sourceUpdatedAt: NOW - 100
  });
});

test('Tokyu failure and malformed rows do not fail the whole Hub', () => {
  const partial = aggregateHub({ hub: KIBUKIHONCHO_HUB, generatedAt: NOW, providerResults: [
    { provider: 'kawasaki', arrivals: [arrival(), arrival({ id: 'bad', routeId: '' })] },
    { provider: 'tokyu', error: { code: 'SOURCE_UNAVAILABLE', detail: 'not public' } }
  ] });
  assert.equal(partial.arrivals.length, 1);
  assert.deepEqual(partial.providers, [
    { provider: 'kawasaki', state: 'partial', code: 'ARRIVAL_INVALID', invalidCount: 1,
      retrievedAt: null, sourceUpdatedAt: null },
    { provider: 'tokyu', state: 'unavailable', code: 'SOURCE_UNAVAILABLE', invalidCount: 0 }
  ]);
});

test('uncertain arrival remains explanatory while the next actionable trip is recommended', () => {
  const hub = aggregateHub({ hub: KIBUKIHONCHO_HUB, generatedAt: NOW, providerResults: [{ provider: 'kawasaki', arrivals: [
    arrival({ id: 'overdue', scheduledDeparture: NOW - 60, estimatedDeparture: null, etaMinutes: null,
      departureState: 'departure_uncertain', actionability: 'do_not_recommend', realtimeState: 'realtime_stale' }),
    arrival({ id: 'next', scheduledDeparture: NOW + 600, estimatedDeparture: NOW + 660, etaMinutes: 11 })
  ] }] });
  const group = hub.decisionGroups.find((value) => value.id === 'kibukihoncho_mizonokuchi');
  assert.equal(group.recommendedArrivalId, 'next');
  assert.equal(group.arrivals.find((value) => value.id === 'overdue').recommendable, false);
});

test('Hub algorithms have no Provider dependency and public feature gates stay off', async () => {
  const code = await Promise.all(['aggregator.js', 'model.js', 'ranking.js'].map((name) =>
    readFile(new URL(`../hub/${name}`, import.meta.url), 'utf8')));
  for (const value of code) {
    assert.doesNotMatch(value, /providers\//);
    assert.doesNotMatch(value, /Kawasaki|Tokyu|川崎|東急/);
  }
  assert.equal(BUS_POSITION_UI_ENABLED, false);
  assert.equal(DEPARTURE_PREDICTION_PUBLIC_ENABLED, false);
});

test('Kawasaki Provider adapter resolves verified 2/3/4 platform stops without exposing GPS', () => {
  const index = indexFixture();
  const directions = P0_INPUT.queries.filter((query) => query.id.startsWith('home_to_')).map((query) => {
    const routeId = query.routeIds[0], row = index.directions[query.id][0];
    return { id: query.id, to: query.to, state: 'realtime', arrivals: [{
      tripId: `20260913:${row.tripId}`, routeLabel: index.routes[routeId].label, headsign: row.headsign,
      platform: 'synthetic-platform', scheduledAt: '2026-09-13T07:05:00+09:00',
      estimatedAt: '2026-09-13T07:06:00+09:00', etaMinutes: 6, delayMinutes: 1,
      realtime: true, state: 'realtime', position: { supported: false, lat: 35, lon: 139 }
    }] };
  });
  const inbound = P0_INPUT.queries.find((query) => query.id === 'mizonokuchi_to_home');
  directions.push({ id: inbound.id, to: inbound.to, state: 'realtime', arrivals: [
    ['2番', '10033'], ['3番', '10036'], ['4番', '10032']
  ].map(([platform, routeId], indexValue) => ({
    tripId: `20260913:mizo-${indexValue}`, routeLabel: index.routes[routeId].label, headsign: '神木本町経由', platform,
    scheduledAt: `2026-09-13T07:0${5 + indexValue}:00+09:00`, estimatedAt: `2026-09-13T07:0${6 + indexValue}:00+09:00`,
    etaMinutes: 6 + indexValue, delayMinutes: 1, realtime: true, state: 'realtime',
    position: { supported: false, lat: 35, lon: 139 }
  })) });
  const result = normalizeKawasakiHubResult({ success: true, fetchError: false, directions },
    { index, queries: P0_INPUT.queries });
  assert.equal(result.arrivals.length, 5);
  assert.deepEqual(result.arrivals.filter((row) => row.sourceId === 'mizonokuchi_to_home')
    .map((row) => [row.originStop.id, row.platform, row.routeId]), [
    ['434_2', '2番', '10033'], ['434_3', '3番', '10036'], ['434_4', '4番', '10032']
  ]);
  assert.ok(result.arrivals.every((row) => row.delayMinutes === 1));
  assert.ok(result.arrivals.every((row) => row.realtimeState === 'realtime' && row.position.supported === false));
  assert.doesNotMatch(JSON.stringify(result), /"lat"|"lon"/);
  assert.throws(() => normalizeKawasakiHubResult({ success: true, fetchError: false, directions: [{
    id: inbound.id, to: inbound.to, state: 'realtime', arrivals: [{ ...directions.at(-1).arrivals[0], platform: '未確認' }]
  }] }, { index, queries: P0_INPUT.queries }), /BUS_KAWASAKI_HUB_PLATFORM_INVALID/);
});

test('Kawasaki Hub normalization accepts only the injected Mukougaoka journey query', () => {
  const query = KAWASAKI_JOURNEY_QUERIES[0];
  const index = { ...indexFixture(), stops: { ...indexFixture().stops,
    '474_5': { stopId: '474_5', name: '向丘遊園駅南口' }, '184_1': { stopId: '184_1', name: '神木本町' } },
    routes: { ...indexFixture().routes, '10037': { routeId: '10037', label: '溝１９' } } };
  const response = { success: true, fetchError: false, directions: [{ id: query.id, to: query.to, state: 'realtime', arrivals: [{
    tripId: '20260914:official-trip', routeLabel: '溝１９', headsign: '溝口駅南口(おし沼)', platform: '5番',
    scheduledAt: '2026-09-14T07:00:00+09:00', estimatedAt: '2026-09-14T07:03:00+09:00',
    etaMinutes: 3, delayMinutes: 3, realtime: true, state: 'realtime', position: { supported: false }
  }] }] };
  const result = normalizeKawasakiHubResult(response, { index, queries: KAWASAKI_JOURNEY_QUERIES });
  assert.equal(result.arrivals.length, 1);
  assert.deepEqual([result.arrivals[0].sourceId, result.arrivals[0].originStop.id, result.arrivals[0].routeId,
    result.arrivals[0].platform], ['mukougaoka_to_kibukihoncho', '474_5', '10037', '5番']);
  assert.equal(result.arrivals[0].destination, '溝口駅南口(おし沼)');
});

test('Kawasaki Hub normalization preserves the westbound route, destination and platform', () => {
  const query = KAWASAKI_JOURNEY_QUERIES[1];
  const index = { ...indexFixture(), stops: { ...indexFixture().stops,
    '184_3': { stopId: '184_3', name: '神木本町' }, '469_2': { stopId: '469_2', name: '向丘中学校下' } },
    routes: { ...indexFixture().routes, '10033': { routeId: '10033', label: '溝１５' } } };
  const response = { success: true, fetchError: false, directions: [{ id: query.id, to: query.to,
    state: 'realtime', arrivals: [{ tripId: '20260915:westbound-trip', routeLabel: '溝１５', headsign: '宮前平駅',
      platform: '3番', scheduledAt: '2026-09-15T07:00:00+09:00', estimatedAt: '2026-09-15T07:02:00+09:00',
      etaMinutes: 2, delayMinutes: 2, realtime: true, state: 'realtime', position: { supported: false } }] }] };
  const result = normalizeKawasakiHubResult(response, { index, queries: KAWASAKI_JOURNEY_QUERIES });
  assert.equal(result.arrivals.length, 1);
  assert.deepEqual([result.arrivals[0].sourceId, result.arrivals[0].originStop.id, result.arrivals[0].routeId,
    result.arrivals[0].platform, result.arrivals[0].destination],
  ['kibukihoncho_to_miyamae_washigamine', '184_3', '10033', '3番', '宮前平駅']);
});

test('Hub service selects providers per Hub and isolates Provider failures', async () => {
  const tok = arrival({ id: 'tokyu-static-a', sourceId: 'kibukihoncho_to_kajigaya', provider: 'tokyu',
    routeId: 'odpt.Busroute:TokyuBus.Kou01', routeLabel: '向０１', destination: '梶が谷駅',
    scheduledDeparture: NOW + 120, estimatedDeparture: null, etaMinutes: null, delayMinutes: null,
    platform: 'a', realtimeState: 'static_only', departureState: 'scheduled', actionability: null });
  const tokReverse = arrival({ ...tok, id: 'tokyu-static-b', sourceId: 'kibukihoncho_to_mukougaoka',
    destination: '向ヶ丘遊園駅南口', platform: 'b' });
  let kawasakiCalls = 0, tokyuCalls = 0;
  const create = ({ kawasakiFails = false, tokyuFails = false } = {}) => createHubService({
    hubs: HUBS, now: () => NOW, providerLoaders: {
      async kawasaki() { kawasakiCalls++; if (kawasakiFails) throw Error(); return { provider: 'kawasaki', arrivals: [
        arrival({ sourceId: 'home_to_noborito' }), arrival(), arrival({ id: 'mizo-home',
          sourceId: 'mizonokuchi_to_home', destination: '神木本町', platform: '3番' }),
        arrival({ id: 'westbound', sourceId: 'kibukihoncho_to_miyamae_washigamine', routeId: '10033',
          routeLabel: '溝１５', destination: '宮前平駅', platform: '3番' })] }; },
      async tokyu() { tokyuCalls++; if (tokyuFails) throw Error(); return { provider: 'tokyu', arrivals: [tok, tokReverse] }; }
    }
  });
  const both = await create().getHub('kibukihoncho');
  assert.equal(both.success, true); assert.equal(both.decisionGroups.length, 4);
  const north = both.decisionGroups.find((group) => group.id === 'kibukihoncho_north');
  assert.deepEqual([...new Set(north.arrivals.map((row) => row.provider))].sort(), ['kawasaki', 'tokyu']);
  assert.ok(north.arrivals.some((row) => row.destination === '向ヶ丘遊園駅南口' && row.platform === 'b'));
  assert.equal(both.decisionGroups.find((group) => group.id === 'kibukihoncho_kajigaya').arrivals[0].realtimeState,
    'static_only');
  assert.equal(both.decisionGroups.find((group) => group.id === 'kibukihoncho_miyamae_washigamine')
    .arrivals[0].destination, '宮前平駅');
  assert.ok(!both.arrivals.some((row) => row.provider === 'tokyu'
    && row.decisionGroupId === 'kibukihoncho_mizonokuchi'));
  assert.equal(both.arrivals.find((row) => row.provider === 'kawasaki').delayMinutes, 1);
  const noTokyu = await create({ tokyuFails: true }).getHub('kibukihoncho');
  assert.equal(noTokyu.arrivals.filter((row) => row.provider === 'kawasaki').length, 3);
  const noKawasaki = await create({ kawasakiFails: true }).getHub('kibukihoncho');
  assert.equal(noKawasaki.arrivals.filter((row) => row.provider === 'tokyu').length, 2);
  assert.equal(noKawasaki.providers.find((row) => row.provider === 'kawasaki').state, 'unavailable');
  const beforeTokyu = tokyuCalls;
  const mizonokuchi = await create().getHub('mizonokuchi-minamiguchi');
  assert.equal(mizonokuchi.hubLabel, '溝の口駅南口');
  assert.equal(mizonokuchi.decisionGroups.length, 1);
  assert.equal(mizonokuchi.decisionGroups[0].arrivals[0].sourceId, 'mizonokuchi_to_home');
  assert.equal(tokyuCalls, beforeTokyu);
  assert.ok(kawasakiCalls > 0);
  const noMizonokuchi = await create({ kawasakiFails: true }).getHub('mizonokuchi-minamiguchi');
  assert.equal(noMizonokuchi.decisionGroups[0].arrivals.length, 0);
  assert.equal(noMizonokuchi.providers[0].state, 'unavailable');
  assert.equal(create().hasHub('unknown'), false);
  await assert.rejects(create().getHub('unknown'), /BUS_HUB_NOT_FOUND/);
});

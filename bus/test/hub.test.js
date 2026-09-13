import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { aggregateHub } from '../hub/aggregator.js';
import { KIBUKIHONCHO_HUB } from '../hub/config.js';
import { normalizeHubArrival } from '../hub/model.js';
import { rankHubArrivals } from '../hub/ranking.js';
import { createHubService } from '../hub/service.js';
import { normalizeKawasakiHubResult } from '../providers/kawasaki/hub.js';
import { indexFixture, P0_INPUT } from './fixtures.js';
import { BUS_POSITION_UI_ENABLED } from '../config/policy.js';
import { DEPARTURE_PREDICTION_PUBLIC_ENABLED } from '../departure/engine.js';

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

test('Kibukihoncho config binds both confirmed Tokyu directions and leaves Mizonokuchi unset', () => {
  assert.deepEqual(KIBUKIHONCHO_HUB.purposes.map(({ id }) => id),
    ['noborito', 'mizonokuchi', 'kajigaya', 'mukougaoka']);
  assert.ok(KIBUKIHONCHO_HUB.sources.some((row) => row.provider === 'kawasaki' && row.sourceId === 'home_to_noborito'));
  assert.ok(KIBUKIHONCHO_HUB.sources.some((row) => row.provider === 'tokyu' && row.sourceId === 'kibukihoncho_to_kajigaya'));
  assert.ok(KIBUKIHONCHO_HUB.sources.some((row) => row.provider === 'tokyu' && row.sourceId === 'kibukihoncho_to_mukougaoka'));
  assert.ok(!KIBUKIHONCHO_HUB.sources.some((row) => row.provider === 'tokyu' && row.purposeId === 'mizonokuchi'));
  assert.deepEqual(KIBUKIHONCHO_HUB.unresolved, []);
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

test('static-only schedule is explicitly lower quality than realtime even when scheduled earlier', () => {
  const ranked = rankHubArrivals([
    normalizeHubArrival(arrival({ id: 'static-first', provider: 'tokyu', sourceId: 'kibukihoncho_to_kajigaya',
      routeId: 'tokyu-route', scheduledDeparture: NOW + 60, estimatedDeparture: null, etaMinutes: null,
      delayMinutes: null, realtimeState: 'static_only', departureState: 'scheduled', actionability: null }), NOW),
    normalizeHubArrival(arrival({ id: 'live-later', scheduledDeparture: NOW + 240,
      estimatedDeparture: NOW + 300, etaMinutes: 5 }), NOW)
  ], NOW);
  assert.deepEqual(ranked.map(({ id }) => id), ['live-later', 'static-first']);
  assert.deepEqual(ranked.map(({ recommendationQuality }) => recommendationQuality), ['realtime', 'static_only']);
  assert.equal(ranked[1].rankingBasis, 'scheduled_departure');
});

test('low confidence is downranked and departure uncertain is never recommended', () => {
  const ranked = rankHubArrivals([
    normalizeHubArrival(arrival({ id: 'low', etaMinutes: 1, estimatedDeparture: NOW + 60, confidence: 0.2 }), NOW),
    normalizeHubArrival(arrival({ id: 'normal', etaMinutes: 4, estimatedDeparture: NOW + 240 }), NOW),
    normalizeHubArrival(arrival({ id: 'uncertain', etaMinutes: null, estimatedDeparture: null,
      scheduledDeparture: NOW + 30, departureState: 'departure_uncertain', actionability: 'do_not_recommend' }), NOW)
  ], NOW);
  assert.deepEqual(ranked.map(({ id }) => id), ['normal', 'low', 'uncertain']);
  assert.deepEqual(ranked.map(({ recommendable }) => recommendable), [true, true, false]);
});

test('Kawasaki-only result remains available when Tokyu is missing', () => {
  const hub = aggregateHub({ hub: KIBUKIHONCHO_HUB, generatedAt: NOW,
    providerResults: [{ provider: 'kawasaki', arrivals: [arrival()] }] });
  assert.equal(hub.groups.find((group) => group.id === 'mizonokuchi').recommendedArrivalId, 'kawasaki-trip-1');
  assert.equal(hub.providers.find((row) => row.provider === 'kawasaki').state, 'available');
  assert.deepEqual(hub.providers.find((row) => row.provider === 'tokyu'),
    { provider: 'tokyu', state: 'unavailable', code: 'RESULT_MISSING', invalidCount: 0 });
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
  const group = hub.groups.find((value) => value.id === 'mizonokuchi');
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

test('Kawasaki Provider adapter maps only the two Hub directions and preserves quality without exposing GPS', () => {
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
  const result = normalizeKawasakiHubResult({ success: true, fetchError: false, directions },
    { index, queries: P0_INPUT.queries });
  assert.equal(result.arrivals.length, 2);
  assert.deepEqual(result.arrivals.map((row) => row.sourceId).sort(), ['home_to_mizonokuchi', 'home_to_noborito']);
  assert.ok(result.arrivals.every((row) => row.realtimeState === 'realtime' && row.position.supported === false));
  assert.doesNotMatch(JSON.stringify(result), /"lat"|"lon"/);
});

test('Hub service combines Kawasaki realtime and Tokyu static; either Provider can fail independently', async () => {
  const tok = arrival({ id: 'tokyu-static-a', sourceId: 'kibukihoncho_to_kajigaya', provider: 'tokyu',
    routeId: 'odpt.Busroute:TokyuBus.Kou01', routeLabel: '向０１', destination: '梶が谷駅',
    scheduledDeparture: NOW + 120, estimatedDeparture: null, etaMinutes: null, delayMinutes: null,
    platform: 'a', realtimeState: 'static_only', departureState: 'scheduled', actionability: null });
  const tokReverse = arrival({ ...tok, id: 'tokyu-static-b', sourceId: 'kibukihoncho_to_mukougaoka',
    destination: '向ヶ丘遊園駅南口', platform: 'b' });
  const create = ({ kawasakiFails = false, tokyuFails = false } = {}) => createHubService({
    hub: KIBUKIHONCHO_HUB, now: () => NOW,
    kawasakiService: { async getArrivals() { if (kawasakiFails) throw Error(); return { marker: true }; } },
    normalizeKawasaki: () => ({ provider: 'kawasaki', arrivals: [arrival({ sourceId: 'home_to_noborito' }), arrival()] }),
    tokyuProvider: { async getArrivals() { if (tokyuFails) throw Error(); return { provider: 'tokyu', arrivals: [tok, tokReverse] }; } }
  });
  const both = await create().getHub('kibukihoncho');
  assert.equal(both.success, true); assert.equal(both.arrivals.length, 4);
  assert.equal(both.groups.find((group) => group.id === 'kajigaya').arrivals[0].realtimeState, 'static_only');
  assert.equal(both.groups.find((group) => group.id === 'mukougaoka').arrivals[0].platform, 'b');
  assert.ok(!both.arrivals.some((row) => row.provider === 'tokyu' && row.purposeId === 'mizonokuchi'));
  const noTokyu = await create({ tokyuFails: true }).getHub('kibukihoncho');
  assert.equal(noTokyu.arrivals.filter((row) => row.provider === 'kawasaki').length, 2);
  const noKawasaki = await create({ kawasakiFails: true }).getHub('kibukihoncho');
  assert.equal(noKawasaki.arrivals.filter((row) => row.provider === 'tokyu').length, 2);
  assert.equal(noKawasaki.providers.find((row) => row.provider === 'kawasaki').state, 'unavailable');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHttpHandler } from '../http/handler.js';
import { createRailHomeRouteService } from '../rail/home-route-service.js';
import { validateRailStatic } from '../rail/static-provider.js';
import { mergeKawasakiStatic } from '../providers/kawasaki/journey-static.js';
import { KAWASAKI_CONTEXT } from '../providers/kawasaki/context.js';
import { P0_QUERIES } from '../config/queries.js';
import { KAWASAKI_JOURNEY_QUERIES } from '../providers/kawasaki/journey-config.js';

const json = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const jrStatic = json('../release-static/rail-nambu-challenge-static.json');
const odakyuStatic = json('../release-static/rail-odakyu-static.json');
const futureIndex = mergeKawasakiStatic(json('../generated/p0-static.json'),
  json('../generated/kawasaki-p2-5-static.json'));
const now = Date.parse('2026-09-28T17:30:00+09:00') / 1000;
const service = createRailHomeRouteService({ jrStatic, odakyuStatic, futureIndex,
  futureQueries: [...P0_QUERIES, ...KAWASAKI_JOURNEY_QUERIES],
  providerContext: KAWASAKI_CONTEXT, adapter: { getRealtime: async () => { throw Error('RT_DOWN'); } },
  odptToken: 'synthetic', challengeEnv: {}, clock: () => now,
  loadTokyuIndex: async () => { throw Error('TOKYU_DOWN'); } });

test('production Rail Static artifacts retain exactly the accepted non-sample train counts', () => {
  for (const [artifact, weekday, weekend] of [[jrStatic, 83, 81], [odakyuStatic, 69, 71]]) {
    validateRailStatic(artifact);
    assert.equal(artifact.sample, false);
    assert.equal(artifact.trains.filter((train) => train.calendarType === 'weekday').length, weekday);
    assert.equal(artifact.trains.filter((train) => train.calendarType === 'weekend').length, weekend);
  }
});

test('production composition serves both Rail selectors and retains Static bus fallback', async () => {
  const university = await service.getTrainChoices('university');
  const school = await service.getTrainChoices('high_school');
  assert.equal(university.trains.length, 5);
  assert.equal(school.trains.length, 5);
  assert.ok(university.trains.every((train) => train.provider === 'odakyu'));
  assert.ok(school.trains.every((train) => train.provider === 'jr_east'
    && train.railRealtimeState === 'static_fallback'));
  const result = await service.evaluate({ journeyId: 'university', trainId: university.trains[0].id });
  assert.equal(result.status, 'partial');
  assert.ok(result.fastest?.homeArrivalAt >= result.fastest?.departureAt);
  assert.ok(result.unavailableSources.includes('tokyu:mukougaoka_to_kibukihoncho'));
  const schoolResult = await service.evaluate({ journeyId: 'high_school', trainId: school.trains[0].id });
  assert.equal(schoolResult.status, 'available');
  assert.ok(schoolResult.fastest?.homeArrivalAt >= schoolResult.fastest?.departureAt);
});

test('GET-only Rail endpoints retain CORS and reject malformed requests', async () => {
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
  assert.equal((await request('/api/bus/trains?journeyId=university', env.ALLOWED_ORIGINS, 'POST')).status, 405);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createBusService } from '../worker/service.js';
import { createWorker } from '../worker/index.js';
import { NOW, indexFixture, realtimeFixture } from './fixtures.js';

test('25 second cache and single flight; RT failure preserves static and reports error', async () => {
  let now = NOW, calls = 0, fail = false;
  const adapter = { async getStatic() { return indexFixture(); }, async getRealtime() { calls++; if (fail) throw Error('upstream'); return realtimeFixture(); } };
  const service = createBusService({ index: indexFixture(), adapter, now: () => now, version: 'synthetic' });
  await Promise.all([service.getArrivals(), service.getArrivals()]); assert.equal(calls, 1);
  now += 24; await service.getArrivals(); assert.equal(calls, 1);
  now += 2; fail = true;
  const stale = await service.getArrivals(); assert.equal(calls, 2); assert.equal(stale.fetchError, true);
  await service.getArrivals(); assert.equal(calls, 2);
  now += 130;
  const fallback = await service.getArrivals(); assert.equal(fallback.directions.length, 4);
  assert.equal(fallback.directions[0].arrivals[0].realtime, false); assert.equal(fallback.fetchError, true);
});
test('bundled static survives RT failures without static fetching; expiry still fails closed', async () => {
  let now = NOW;
  const index = indexFixture();
  const service = createBusService({ index, version: 'synthetic', now: () => now, adapter: {
    async getStatic() { assert.fail('Static must not be fetched'); }, async getRealtime() { throw Error(); }
  } });
  await service.getArrivals(); now += 86401;
  assert.equal((await service.getArrivals()).directions.length, 4);
  index.feedInfo.feed_end_date = '20260909';
  await assert.rejects(service.getArrivals(), /BUS_STATIC_OUT_OF_RANGE/);
});
test('fixed endpoint, method, CORS, missing config and sanitized fault response', async () => {
  const worker = createWorker(() => ({ async getArrivals() { throw Error('sensitive-upstream-url'); } }));
  const env = { ODPT_ACCESS_TOKEN: 'synthetic-only', ALLOWED_ORIGINS: 'https://paluru.example' };
  const call = (path, init = {}, settings = env) => worker.fetch(new Request(`https://bus.example${path}`, init), settings);
  assert.equal((await call('/api/bus/arrivals?url=x')).status, 404);
  assert.equal((await call('/api/bus/arrivals', { method: 'POST' })).status, 405);
  assert.equal((await call('/api/bus/arrivals', { headers: { Origin: 'https://wrong.example' } })).status, 403);
  assert.equal((await call('/api/bus/arrivals', {}, {})).status, 503);
  const response = await call('/api/bus/arrivals', { headers: { Origin: 'https://paluru.example' } });
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://paluru.example');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), { success: false, error: { code: 'BUS_UNAVAILABLE' } });
});

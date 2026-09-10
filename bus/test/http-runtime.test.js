import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createNodeServer } from '../runtime/server.js';
import { runtimeConfig, PRODUCTION_ORIGIN } from '../runtime/config.js';
import { createHttpHandler } from '../http/handler.js';
import { createBusService } from '../core/service.js';
import { recordStages } from '../runtime/metrics.js';
import { NOW, indexFixture, realtimeFixture } from './fixtures.js';

async function fixture(t) {
  let now = NOW, calls = 0, failure = false;
  const index = indexFixture(), logs = [];
  for (const [id, rows] of Object.entries(index.directions)) {
    index.directions[id] = [0, 1, 2].map((i) => ({ ...rows[0], tripId: i ? `${rows[0].tripId}-${i}` : rows[0].tripId,
      scheduledSeconds: rows[0].scheduledSeconds + i * 600 }));
  }
  const service = createBusService({ index, version: 'synthetic', now: () => now, measure: recordStages,
    adapter: { async getRealtime() { calls++; await new Promise((r) => setTimeout(r, 5));
      if (failure) throw Error('private-upstream-detail'); return realtimeFixture(); } } });
  const env = runtimeConfig({ ODPT_ACCESS_TOKEN: 'synthetic-config-only' }).env;
  const server = createNodeServer({ handler: createHttpHandler(() => service, { health: true }), env, measure: (v) => logs.push(v) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { logs, calls: () => calls, advance: (seconds) => { now += seconds; }, fail: () => { failure = true; },
    call: (path = '/api/bus/arrivals', init = {}) => fetch(`${base}${path}`, init) };
}

test('Node HTTP: health, four directions x three rows, RT fields and shared concurrent fetch', async (t) => {
  const f = await fixture(t);
  const health = await f.call('/health'); assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok', service: 'paluru-bus-api' }); assert.equal(f.calls(), 0);
  const responses = await Promise.all(Array.from({ length: 4 }, () => f.call()));
  assert.equal(f.calls(), 1);
  for (const r of responses) {
    assert.equal(r.status, 200); const data = await r.json();
    assert.equal(data.directions.length, 4); assert.equal(data.pollAfterSeconds, 30); assert.equal(data.positionUiEnabled, false);
    for (const direction of data.directions) {
      assert.equal(direction.arrivals.length, 3);
      const [first, next] = direction.arrivals;
      assert.equal(first.scheduledTime, '07:54'); assert.equal(first.estimatedTime, '07:57');
      assert.equal(first.delayMinutes, 3); assert.equal(first.etaMinutes, 7);
      assert.equal(first.realtime, true); assert.equal(first.position.supported, false);
      assert.equal(next.realtime, false); assert.equal(next.estimatedTime, null); assert.equal(next.etaMinutes, null);
    }
  }
  await f.call(); assert.equal(f.calls(), 1);
  assert.ok(f.logs.some((v) => Number.isFinite(v.stages.joinMs)));
  assert.ok(!JSON.stringify(f.logs).includes('synthetic-config-only'));
});

test('Node HTTP: stale fetch, expired RT, missing RT, and past ETA never presented as future', async (t) => {
  const f = await fixture(t); await f.call(); f.fail(); f.advance(26);
  let data = await (await f.call()).json(); assert.equal(data.fetchError, true); assert.equal(f.calls(), 2);
  assert.equal(data.directions[0].arrivals[0].realtime, true);
  // A refresh error is separate from RT age. This previous feed is still inside 120 seconds.
  assert.equal(data.directions[0].state, 'realtime');
  await f.call(); assert.equal(f.calls(), 2);
  f.advance(130); data = await (await f.call()).json();
  assert.equal(data.directions[0].arrivals[0].realtime, false);
  assert.equal(data.directions[0].arrivals[0].etaMinutes, null);
  assert.equal(data.directions[0].state, 'static_fallback');
  f.advance(600); data = await (await f.call()).json();
  assert.ok(data.directions.every((d) => d.arrivals.every((a) => a.etaMinutes === null || a.etaMinutes >= 0)));
  assert.ok(data.directions.every((d) => d.arrivals.every((a) => Date.parse(a.scheduledAt) / 1000 >= NOW + 756)));
});

test('Node HTTP: production CORS, read-only paths, secrets and metadata-only logging', async (t) => {
  const f = await fixture(t);
  const good = await f.call(undefined, { headers: { Origin: PRODUCTION_ORIGIN } });
  assert.equal(good.headers.get('Access-Control-Allow-Origin'), PRODUCTION_ORIGIN);
  assert.equal(good.headers.get('Cache-Control'), 'no-store'); assert.ok(good.headers.get('X-Request-Id'));
  for (const origin of ['http://localhost:8788', 'https://wrong.example', 'null']) {
    const response = await f.call(undefined, { headers: { Origin: origin } });
    assert.equal(response.status, 403); assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  }
  assert.equal((await f.call(undefined, { method: 'OPTIONS', headers: { Origin: PRODUCTION_ORIGIN } })).status, 204);
  assert.equal((await f.call(undefined, { method: 'POST', body: 'synthetic-private-body' })).status, 405);
  const bad = await f.call('/api/bus/arrivals?private=synthetic-private-query'); assert.equal(bad.status, 404);
  assert.equal((await f.call('/health?extra=1')).status, 404);
  assert.equal((await f.call('/health', { method: 'POST' })).status, 405);
  const text = JSON.stringify(f.logs) + await bad.text();
  for (const forbidden of ['synthetic-private', 'synthetic-config-only', 'private-upstream-detail']) assert.ok(!text.includes(forbidden));
});

test('Cloud Run startup configuration fails closed; localhost allowed only in development', () => {
  const base = { ODPT_ACCESS_TOKEN: 'synthetic-config-only' };
  assert.equal(runtimeConfig(base).port, 8080);
  assert.equal(runtimeConfig(base).host, '0.0.0.0');
  assert.equal(runtimeConfig(base).env.ALLOWED_ORIGINS, PRODUCTION_ORIGIN);
  for (const bad of [{}, { ...base, PORT: '0' }, { ...base, PORT: '65536' }, { ...base, ALLOWED_ORIGINS: '*' },
    { ...base, ALLOWED_ORIGINS: 'http://localhost:8788' }, { ...base, NODE_ENV: 'developmnt' }]) assert.throws(() => runtimeConfig(bad));
  assert.ok(runtimeConfig({ ...base, NODE_ENV: 'development' }).env.ALLOWED_ORIGINS.includes('localhost'));
  assert.equal(runtimeConfig({ ...base, NODE_ENV: 'development' }).host, '127.0.0.1');
});

test('shared cache keys isolate providers and versions without Cloudflare APIs', async () => {
  const stored = new Map(); let calls = 0;
  const cache = { async read(key) { return stored.get(key); }, async write(key, data) { stored.set(key, data); } };
  const adapter = { async getRealtime() { calls++; return realtimeFixture(); } };
  const run = (provider, version) => createBusService({ index: indexFixture(), adapter, cache, provider, version, now: () => NOW }).getArrivals();
  await run('kawasaki', 'v1'); await run('kawasaki', 'v1'); assert.equal(calls, 1);
  await run('synthetic-other', 'v1'); await run('kawasaki', 'v2'); assert.equal(calls, 3);
});

// Read-only acceptance through an IAM proxy or the deployed public Cloud Run URL.
// No credentials are sent by this script. The local ODPT token is only a leak-scan needle.
// Full API responses are never saved or printed. Runtime stages are joined from Cloud Logging separately.
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { readLocalToken } from './local-secret.js';
import { PRODUCTION_ORIGIN } from '../runtime/config.js';

let stage = 'arguments';
try {
  const base = new URL(process.argv[2]);
  const label = process.argv[3];
  assert.ok(['validation', 'production'].includes(label));
  assert.ok((base.protocol === 'https:' && base.hostname.endsWith('.run.app'))
    || (base.protocol === 'http:' && base.hostname === '127.0.0.1' && base.port === '8789'));
  assert.ok(!base.username && !base.password && !base.search && !base.hash && base.pathname === '/');
  const token = readLocalToken(), needles = [token, encodeURIComponent(token)];
  const ids = ['home_to_noborito', 'home_to_mizonokuchi', 'noborito_to_home', 'mizonokuchi_to_home'];
  const samples = [];
  const call = async (path, init = {}) => {
    const begin = performance.now();
    const response = await fetch(new URL(path, base), { ...init, redirect: 'error', signal: AbortSignal.timeout(30000) });
    const body = await response.text();
    assert.ok(!needles.some((value) => body.includes(value) || JSON.stringify([...response.headers]).includes(value)));
    return { response, body, responseMs: performance.now() - begin };
  };
  stage = 'health';
  const health = await call('/health');
  assert.equal(health.response.status, 200);
  assert.deepEqual(JSON.parse(health.body), { status: 'ok', service: 'paluru-bus-api' });
  for (const kind of ['first_observed_request', 'warm_hit', 'warm_hit', 'warm_refresh', 'warm_hit']) {
    stage = kind;
    if (kind === 'warm_refresh') await delay(26000);
    const { response, body, responseMs } = await call('/api/bus/arrivals', { headers: { Origin: PRODUCTION_ORIGIN } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), PRODUCTION_ORIGIN);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const data = JSON.parse(body), now = Date.parse(data.generatedAt) / 1000;
    assert.ok(Number.isFinite(now));
    assert.equal(data.success, true);
    assert.equal(data.positionUiEnabled, false);
    assert.equal(data.pollAfterSeconds, 30);
    assert.equal(data.fetchError, false);
    assert.deepEqual(data.directions.map((d) => d.id).sort(), [...ids].sort());
    assert.ok(!/"(?:lat|lon|latitude|longitude)"\s*:/.test(body));
    for (const direction of data.directions) {
      assert.equal(direction.arrivals.length, 3);
      for (const a of direction.arrivals) {
        const scheduled = Date.parse(a.scheduledAt) / 1000;
        assert.ok(Number.isFinite(scheduled) && /^\d{2}:\d{2}$/.test(a.scheduledTime));
        assert.deepEqual(a.position, { supported: false, status: null, stopsAway: null, previousStop: null, nextStop: null });
        if (a.realtime) {
          const estimated = Date.parse(a.estimatedAt) / 1000;
          assert.ok(Number.isFinite(estimated) && estimated >= now);
          assert.ok(/^\d{2}:\d{2}$/.test(a.estimatedTime));
          assert.equal(a.delaySeconds, estimated - scheduled);
          assert.equal(a.delayMinutes, Math.round((estimated - scheduled) / 60));
          assert.equal(a.etaMinutes, Math.max(0, Math.ceil((estimated - now) / 60)));
          assert.equal(a.state, 'realtime');
        } else {
          for (const key of ['estimatedAt', 'estimatedTime', 'etaMinutes', 'delayMinutes', 'delaySeconds']) assert.equal(a[key], null);
          assert.ok(scheduled >= now || a.state === 'prediction_pending');
        }
      }
    }
    samples.push({ kind, observedAt: data.generatedAt, requestId: response.headers.get('X-Request-Id'),
      status: response.status, responseMs, responseBytes: Buffer.byteLength(body),
      directions: data.directions.map((d) => ({ id: d.id, state: d.state, dataAgeSec: d.dataAgeSec,
        arrivals: d.arrivals.map((a) => ({ scheduled: a.scheduledTime, estimated: a.estimatedTime,
          etaMinutes: a.etaMinutes, delayMinutes: a.delayMinutes, realtime: a.realtime, state: a.state, platform: a.platform })) })) });
  }
  stage = 'cors_and_read_only';
  for (const origin of ['http://localhost:8788', 'https://invalid.example']) {
    const { response } = await call('/api/bus/arrivals', { headers: { Origin: origin } });
    assert.equal(response.status, 403); assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  }
  assert.equal((await call('/api/bus/arrivals', { method: 'OPTIONS', headers: { Origin: PRODUCTION_ORIGIN } })).response.status, 204);
  assert.equal((await call('/api/bus/arrivals', { method: 'POST' })).response.status, 405);
  assert.equal((await call('/.dev.vars')).response.status, 404);
  const summary = { status: 'CLOUD_RUN_HTTP_PASS', service: label, origin: base.origin,
    healthResponseMs: health.responseMs, samples, secretLeak: false, positionUiEnabled: false,
    limitations: ['First observed request is not automatically a platform cold start.',
      'Forced upstream failures and stale transitions are covered separately; this probe does not alter the live feed.'] };
  writeFileSync(new URL(`../.local/cloud-run-${label}-summary.json`, import.meta.url), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary));
} catch {
  console.log(JSON.stringify({ status: 'CLOUD_RUN_HTTP_FAILED', stage }));
  process.exitCode = 1;
}

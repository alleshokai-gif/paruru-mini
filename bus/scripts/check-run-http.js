// Local Node process + real HTTP + authenticated ODPT. This is not a Cloud Run measurement.
// Only bounded summaries and safe runtime metrics are printed; no raw upstream data is saved.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { readLocalToken } from './local-secret.js';
import { PRODUCTION_ORIGIN } from '../runtime/config.js';

let child;
try {
  const token = readLocalToken(), reservation = createServer();
  reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port; await new Promise((r) => reservation.close(r));
  const started = performance.now(), logs = []; let pending = '', unsafe = false;
  child = spawn(process.execPath, [fileURLToPath(new URL('../runtime/start.js', import.meta.url))], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), windowsHide: true,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port), ALLOWED_ORIGINS: PRODUCTION_ORIGIN, ODPT_ACCESS_TOKEN: token },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const consume = (chunk) => {
    pending += chunk.toString();
    if (pending.includes(token)) unsafe = true;
    const lines = pending.split(/\r?\n/); pending = lines.pop();
    for (const line of lines) if (line) { try { logs.push(JSON.parse(line)); } catch { unsafe = true; } }
  };
  child.stdout.on('data', consume); child.stderr.on('data', consume);
  const base = `http://127.0.0.1:${port}`; let ready = false;
  for (let i = 0; i < 100; i++) {
    try { ready = (await fetch(`${base}/health`, { signal: AbortSignal.timeout(500) })).ok; } catch { /* Startup only. */ }
    if (ready) break; if (child.exitCode !== null) break; await delay(50);
  }
  assert.ok(ready); const spawnToHealthMs = performance.now() - started;
  const samples = []; let last;
  for (const kind of ['cold_request', 'warm_hit', 'warm_hit', 'warm_refresh', 'warm_hit']) {
    if (kind === 'warm_refresh') await delay(26000);
    const begin = performance.now();
    const response = await fetch(`${base}/api/bus/arrivals`, { headers: { Origin: PRODUCTION_ORIGIN }, signal: AbortSignal.timeout(25000) });
    const body = await response.text(), responseMs = performance.now() - begin;
    assert.ok(!body.includes(token)); assert.equal(response.status, 200);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), PRODUCTION_ORIGIN);
    last = JSON.parse(body); assert.equal(last.success, true); assert.equal(last.positionUiEnabled, false);
    assert.equal(last.directions.length, 4); assert.equal(last.fetchError, false);
    for (const d of last.directions) {
      assert.equal(d.arrivals.length, 3);
      for (const a of d.arrivals) {
        assert.ok(a.scheduledAt && a.scheduledTime); assert.equal(a.position.supported, false);
        assert.ok(a.etaMinutes === null || a.etaMinutes >= 0);
        if (!a.realtime) { assert.equal(a.estimatedAt, null); assert.equal(a.delayMinutes, null); }
      }
    }
    await delay(10);
    const metric = logs.find((v) => v.requestId === response.headers.get('X-Request-Id'));
    assert.ok(metric);
    samples.push({ kind, http: response.status, responseMs, responseBytes: Buffer.byteLength(body),
      rssBytes: metric.rssBytes, stages: metric.stages, odptFetches: metric.stages.odptFetches || 0 });
  }
  assert.deepEqual(samples.map((s) => s.odptFetches), [1, 0, 0, 1, 0]);
  assert.equal((await fetch(`${base}/api/bus/arrivals`, { headers: { Origin: 'http://localhost:8788' } })).status, 403);
  assert.equal((await fetch(`${base}/.dev.vars`)).status, 404);
  assert.equal(unsafe, false);
  console.log(JSON.stringify({ status: 'NODE_HTTP_LIVE_PASS', observedAt: last.generatedAt,
    measurementEnvironment: 'Windows Node process, not Cloud Run/container', spawnToHealthMs,
    startup: logs.find((v) => v.event === 'bus_startup'), samples, secretLeak: false,
    directions: last.directions.map((d) => ({ id: d.id, state: d.state, arrivals: d.arrivals.map((a) => ({
      scheduled: a.scheduledTime, estimated: a.estimatedTime, delayMinutes: a.delayMinutes, etaMinutes: a.etaMinutes, realtime: a.realtime })) })) }));
} catch { console.log('{"status":"NODE_HTTP_LIVE_FAILED"}'); process.exitCode = 1; }
finally { child?.kill(); }

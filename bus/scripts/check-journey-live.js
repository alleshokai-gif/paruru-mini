// Local authenticated acceptance. Only normalized counts and public route metadata are printed.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { readLocalToken } from './local-secret.js';

let child, phase = 'startup', diagnostic = null;
try {
  const token = readLocalToken(), reservation = createServer();
  reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port; await new Promise((resolve) => reservation.close(resolve));
  let output = '', unsafe = false;
  child = spawn(process.execPath, [fileURLToPath(new URL('../runtime/start.js', import.meta.url))], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), windowsHide: true,
    env: { ...process.env, NODE_ENV: 'development', PORT: String(port), ALLOWED_ORIGINS: 'http://127.0.0.1:8788',
      ODPT_ACCESS_TOKEN: token }, stdio: ['ignore', 'pipe', 'pipe']
  });
  const consume = (chunk) => { output += chunk.toString(); if (output.includes(token)) unsafe = true; };
  child.stdout.on('data', consume); child.stderr.on('data', consume);
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let index = 0; index < 100; index++) {
    try { ready = (await fetch(`${base}/health`, { signal: AbortSignal.timeout(500) })).ok; } catch { /* startup */ }
    if (ready) break; if (child.exitCode !== null) break; await delay(50);
  }
  assert.ok(ready);
  const request = async (path) => {
    const response = await fetch(`${base}${path}`, { headers: { Origin: 'http://127.0.0.1:8788' },
      signal: AbortSignal.timeout(30000) });
    assert.equal(response.status, 200); assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'http://127.0.0.1:8788');
    const body = await response.text(); assert.ok(!body.includes(token)); return JSON.parse(body);
  };
  phase = 'p0'; const p0 = await request('/api/bus/arrivals');
  assert.equal(p0.directions.length, 4); assert.ok(p0.directions.every((row) => row.arrivals.length === 3));
  phase = 'existing_hubs';
  for (const [id, count] of [['kibukihoncho', 4], ['mizonokuchi-minamiguchi', 1],
    ['tachikawa-ekikitaguchi', 1], ['showa-daiichi-gakuen', 1]]) {
    const hub = await request(`/api/bus/hub?id=${id}`); assert.equal(hub.decisionGroups.length, count);
  }
  phase = 'journey'; const journey = await request('/api/bus/journey?id=noborito-mukougaoka');
  diagnostic = { journeyGroupId: journey.journeyGroupId,
    children: Array.isArray(journey.children) ? journey.children.map((value) => ({ id: value.id,
      state: value.state, arrivals: value.decisionGroup?.arrivals?.length ?? null,
      returnedProviders: Array.isArray(value.decisionGroup?.arrivals)
        ? [...new Set(value.decisionGroup.arrivals.map((row) => row.provider))] : [],
      providerStates: Array.isArray(value.providers)
        ? value.providers.map((row) => `${row.provider}:${row.state}:${row.code || 'none'}`) : [] })) : [] };
  assert.equal(journey.journeyGroupLabel, '登戸・遊園'); assert.equal(journey.children.length, 2);
  const [noborito, mukougaoka] = journey.children;
  assert.equal(noborito.label, '登戸駅'); assert.equal(mukougaoka.label, '向ヶ丘遊園駅南口');
  assert.equal(noborito.decisionGroup.arrivals.length, 3); assert.equal(mukougaoka.decisionGroup.arrivals.length, 3);
  assert.ok(noborito.decisionGroup.arrivals.every((row) => row.provider === 'kawasaki'
    && row.sourceId === 'noborito_to_home' && row.routeId === '10044'));
  assert.deepEqual(mukougaoka.providers.map((row) => [row.provider, row.state]),
    [['kawasaki', 'available'], ['tokyu', 'available']]);
  assert.ok(mukougaoka.decisionGroup.arrivals.every((row) => row.sourceId === 'mukougaoka_to_kibukihoncho'
    && (row.provider === 'kawasaki' ? row.routeId === '10037' && row.platform === '5番'
      : row.routeId === 'odpt.Busroute:TokyuBus.Kou01' && row.platform === '6')));
  assert.equal(Object.hasOwn(journey, 'recommendedChildId'), false);
  assert.ok(journey.children.flatMap((value) => value.decisionGroup.arrivals)
    .every((row) => row.position?.supported === false));
  assert.equal(p0.positionUiEnabled, false); assert.equal(unsafe, false);
  console.log(JSON.stringify({ status: 'P2_5_JOURNEY_LIVE_PASS', p0Directions: 4,
    children: journey.children.map((value) => ({ id: value.id, arrivals: value.decisionGroup.arrivals.length,
      returnedProviders: [...new Set(value.decisionGroup.arrivals.map((row) => row.provider))],
      providerStates: value.providers.map((row) => `${row.provider}:${row.state}`) })),
    positionUiEnabled: false, publicDeparturePredictionEnabled: false, secretLeak: false }));
} catch (error) {
  const code = /^[A-Z0-9_]+$/.test(error?.message || '') ? error.message
    : error?.name === 'AssertionError' ? 'ASSERTION_FAILED' : 'UNKNOWN';
  console.log(JSON.stringify({ status: 'P2_5_JOURNEY_LIVE_FAILED', phase, code, diagnostic })); process.exitCode = 1;
} finally { child?.kill(); }

// Local Node HTTP + authenticated ODPT static/realtime validation. Raw responses and token are never logged.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { readLocalToken } from './local-secret.js';
import { PRODUCTION_ORIGIN } from '../runtime/config.js';

let child, phase = 'startup', diagnostic = null;
try {
  const token = readLocalToken(), reservation = createServer();
  reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port; await new Promise((resolve) => reservation.close(resolve));
  let output = '', unsafe = false;
  child = spawn(process.execPath, [fileURLToPath(new URL('../runtime/start.js', import.meta.url))], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), windowsHide: true,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port), ALLOWED_ORIGINS: PRODUCTION_ORIGIN,
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
  assert.ok(ready); phase = 'http';
  const request = async (path) => {
    const response = await fetch(`${base}${path}`, { headers: { Origin: PRODUCTION_ORIGIN }, signal: AbortSignal.timeout(25000) });
    const body = await response.text(); assert.ok(!body.includes(token));
    if (response.status !== 200) throw Error(`HTTP_${response.status}`);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), PRODUCTION_ORIGIN); return JSON.parse(body);
  };
  phase = 'p0'; const p0 = await request('/api/bus/arrivals');
  assert.equal(p0.directions.length, 4); assert.ok(p0.directions.every((direction) => direction.arrivals.length === 3));
  phase = 'hub'; const hub = await request('/api/bus/hub?id=kibukihoncho');
  phase = 'hub_identity'; assert.equal(hub.success, true); assert.equal(hub.hubId, 'kibukihoncho');
  assert.equal(hub.hubLabel, '神木本町'); assert.equal(hub.decisionGroups.length, 3);
  const byGroup = Object.fromEntries(hub.decisionGroups.map((group) => [group.id, group]));
  diagnostic = { groups: hub.decisionGroups.map((group) => ({ id: group.id, count: group.arrivals.length,
    providers: [...new Set(group.arrivals.map((row) => row.provider))] })),
  providers: hub.providers.map((row) => ({ provider: row.provider, state: row.state, code: row.code })) };
  const groupIds = ['kibukihoncho_north', 'kibukihoncho_mizonokuchi', 'kibukihoncho_kajigaya'];
  phase = 'hub_group_presence'; for (const id of groupIds) assert.ok(byGroup[id]);
  phase = 'hub_group_counts'; for (const id of groupIds) assert.equal(byGroup[id].arrivals.length, 3);
  phase = 'north_contract';
  assert.deepEqual(byGroup.kibukihoncho_north.providers, ['kawasaki', 'tokyu']);
  assert.deepEqual(byGroup.kibukihoncho_north.destinations, ['登戸駅', '向ヶ丘遊園駅南口']);
  const tokyu = hub.arrivals.filter((row) => row.provider === 'tokyu');
  phase = 'tokyu_static_contract';
  assert.ok(tokyu.every((row) => row.provider === 'tokyu' && row.realtimeState === 'static_only'
    && row.estimatedDeparture === null && row.etaMinutes === null && row.delayMinutes === null
    && row.position.supported === false));
  assert.ok(byGroup.kibukihoncho_kajigaya.arrivals.every((row) => row.provider === 'tokyu' && row.platform === 'a'));
  phase = 'tokyu_mizonokuchi_absent'; assert.ok(!hub.arrivals.some((row) => row.provider === 'tokyu'
    && row.decisionGroupId === 'kibukihoncho_mizonokuchi'));
  phase = 'delay_contract'; assert.ok(hub.arrivals.filter((row) => row.provider === 'kawasaki')
    .every((row) => Object.hasOwn(row, 'delayMinutes')));
  assert.equal(unsafe, false);
  console.log(JSON.stringify({ status: 'P2_2_HUB_LIVE_PASS', p0Directions: p0.directions.length,
    groups: hub.decisionGroups.map((group) => ({ id: group.id, count: group.arrivals.length,
      providers: [...new Set(group.arrivals.map((row) => row.provider))],
      quality: [...new Set(group.arrivals.map((row) => row.realtimeState))] })),
    delayFieldPreserved: true, tokyuRealtimeFieldsNull: true, tokyuMizonokuchiAbsent: true, positionUiEnabled: p0.positionUiEnabled,
    secretLeak: false }));
} catch (error) {
  const code = /^[A-Z0-9_]+$/.test(error?.message || '') ? error.message : error?.name === 'AssertionError' ? 'ASSERTION_FAILED' : 'UNKNOWN';
  console.log(JSON.stringify({ status: 'P2_2_HUB_LIVE_FAILED', phase, code, diagnostic })); process.exitCode = 1;
} finally { child?.kill(); }

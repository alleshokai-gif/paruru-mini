// Read-only Cloud Run acceptance. It prints counts and timing only, never response bodies or secrets.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { PRODUCTION_ORIGIN } from '../runtime/config.js';

const base = String(process.env.BUS_REMOTE_URL || '').replace(/\/$/, '');
if (!/^https?:\/\/[^/]+(?::\d+)?$/.test(base)) {
  console.log(JSON.stringify({ status: 'P2_2_REMOTE_FAILED', phase: 'config', code: 'BUS_REMOTE_URL_INVALID' }));
  process.exit(1);
}

const measurements = [];
let phase = 'health';

async function request(path) {
  const started = performance.now();
  const response = await fetch(`${base}${path}`, { method: 'GET', headers: { Origin: PRODUCTION_ORIGIN },
    cache: 'no-store', signal: AbortSignal.timeout(30000) });
  const bytes = new Uint8Array(await response.arrayBuffer());
  measurements.push({ path, status: response.status, elapsedMs: Number((performance.now() - started).toFixed(1)), bytes: bytes.length });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), PRODUCTION_ORIGIN);
  const body = new TextDecoder().decode(bytes);
  assert.doesNotMatch(body, /acl:consumerKey|ODPT_ACCESS_TOKEN|"lat"|"lon"/i);
  return JSON.parse(body);
}

function validateP0(value) {
  assert.equal(value.success, true); assert.equal(value.positionUiEnabled, false);
  assert.equal(value.directions.length, 4);
  assert.ok(value.directions.every((direction) => direction.arrivals.length === 3));
}

function validateHub(value) {
  assert.equal(value.success, true); assert.equal(value.hubId, 'kibukihoncho'); assert.equal(value.hubLabel, '神木本町');
  const groups = Object.fromEntries(value.decisionGroups.map((group) => [group.id, group]));
  for (const id of ['kibukihoncho_north', 'kibukihoncho_mizonokuchi', 'kibukihoncho_kajigaya']) {
    assert.ok(groups[id]); assert.equal(groups[id].arrivals.length, 3);
  }
  assert.deepEqual(groups.kibukihoncho_north.providers, ['kawasaki', 'tokyu']);
  assert.deepEqual(groups.kibukihoncho_north.destinations, ['登戸駅', '向ヶ丘遊園駅南口']);
  const tokyu = value.arrivals.filter((row) => row.provider === 'tokyu');
  assert.ok(tokyu.every((row) => row.provider === 'tokyu' && row.realtimeState === 'static_only'
    && row.estimatedDeparture === null && row.etaMinutes === null && row.delayMinutes === null
    && row.position.supported === false));
  assert.ok(groups.kibukihoncho_kajigaya.arrivals.every((row) => row.provider === 'tokyu' && row.platform === 'a'));
  assert.ok(!value.arrivals.some((row) => row.provider === 'tokyu'
    && row.decisionGroupId === 'kibukihoncho_mizonokuchi'));
  assert.ok(value.arrivals.filter((row) => row.provider === 'kawasaki')
    .every((row) => Object.hasOwn(row, 'delayMinutes')));
  const provider = value.providers.find((row) => row.provider === 'tokyu');
  assert.equal(provider?.state, 'available'); assert.ok(Number.isFinite(provider?.retrievedAt));
  assert.ok(value.attributions.some((row) => row.provider === 'tokyu' && row.providerName === '東急バス'));
}

try {
  const health = await request('/health'); assert.equal(health.status, 'ok');
  phase = 'p0'; validateP0(await request('/api/bus/arrivals'));
  phase = 'hub';
  for (let index = 0; index < 3; index++) validateHub(await request('/api/bus/hub?id=kibukihoncho'));
  console.log(JSON.stringify({ status: 'P2_2_REMOTE_PASS', origin: PRODUCTION_ORIGIN,
    p0: { directions: 4, arrivalsEach: 3 }, hub: { decisionGroups: 3, arrivalsEach: 3 },
    delayFieldPreserved: true, positionUiEnabled: false, tokyuRealtime: false, tokyuMizonokuchi: false,
    secretLeak: false, measurements }));
} catch (error) {
  const code = error?.name === 'AssertionError' ? 'ASSERTION_FAILED'
    : /^[A-Z0-9_]+$/.test(error?.message || '') ? error.message : 'REMOTE_REQUEST_FAILED';
  console.log(JSON.stringify({ status: 'P2_2_REMOTE_FAILED', phase, code, measurements }));
  process.exitCode = 1;
}

// Read-only Cloud Run acceptance. It prints counts and timing only, never response bodies or secrets.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { PRODUCTION_ORIGIN } from '../runtime/config.js';

const base = String(process.env.BUS_REMOTE_URL || '').replace(/\/$/, '');
const idToken = String(process.env.BUS_REMOTE_ID_TOKEN || '');
if (!/^https?:\/\/[^/]+(?::\d+)?$/.test(base)) {
  console.log(JSON.stringify({ status: 'P2_5_REMOTE_FAILED', phase: 'config', code: 'BUS_REMOTE_URL_INVALID' }));
  process.exit(1);
}
if (/\s/.test(idToken)) {
  console.log(JSON.stringify({ status: 'P2_5_REMOTE_FAILED', phase: 'config', code: 'BUS_REMOTE_TOKEN_INVALID' }));
  process.exit(1);
}

const measurements = [];
let phase = 'health';

async function request(path) {
  const started = performance.now();
  const headers = { Origin: PRODUCTION_ORIGIN };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const response = await fetch(`${base}${path}`, { method: 'GET', headers,
    cache: 'no-store', signal: AbortSignal.timeout(30000) });
  const bytes = new Uint8Array(await response.arrayBuffer());
  measurements.push({ path, status: response.status, elapsedMs: Number((performance.now() - started).toFixed(1)), bytes: bytes.length });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), PRODUCTION_ORIGIN);
  const body = new TextDecoder().decode(bytes);
  assert.doesNotMatch(body, /acl:consumerKey|ODPT_ACCESS_TOKEN|"lat"|"lon"/i);
  return JSON.parse(body);
}

async function validateCorsDeny(path) {
  const started = performance.now();
  const headers = { Origin: 'https://example.invalid' };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const response = await fetch(`${base}${path}`, { method: 'GET', headers,
    cache: 'no-store', signal: AbortSignal.timeout(30000) });
  const bytes = new Uint8Array(await response.arrayBuffer());
  measurements.push({ path: `${path}#cors-deny`, status: response.status,
    elapsedMs: Number((performance.now() - started).toFixed(1)), bytes: bytes.length });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.doesNotMatch(new TextDecoder().decode(bytes), /acl:consumerKey|ODPT_ACCESS_TOKEN|"lat"|"lon"/i);
}

function validateP0(value) {
  assert.equal(value.success, true); assert.equal(value.positionUiEnabled, false);
  assert.equal(value.directions.length, 4);
  assert.ok(value.directions.every((direction) => direction.arrivals.length === 3));
}

function validateKibukihoncho(value) {
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

function validateMizonokuchi(value) {
  assert.equal(value.success, true); assert.equal(value.hubId, 'mizonokuchi-minamiguchi');
  assert.equal(value.hubLabel, '溝の口駅南口'); assert.equal(value.decisionGroups.length, 1);
  const group = value.decisionGroups[0];
  assert.equal(group.id, 'mizonokuchi_minamiguchi_home'); assert.equal(group.label, '神木本町方面');
  assert.deepEqual(group.providers, ['kawasaki']); assert.deepEqual(group.destinations, ['神木本町']);
  assert.equal(group.arrivals.length, 3);
  const allowedPlatforms = new Set(['2番', '3番', '4番']);
  assert.ok(group.arrivals.every((row) => row.provider === 'kawasaki' && typeof row.destination === 'string'
    && row.destination.length > 0
    && allowedPlatforms.has(row.platform) && Object.hasOwn(row, 'scheduledDeparture')
    && Object.hasOwn(row, 'estimatedDeparture') && Object.hasOwn(row, 'etaMinutes')
    && Object.hasOwn(row, 'delayMinutes') && row.position.supported === false));
  const recommended = group.arrivals.filter((row) => row.id === group.recommendedArrivalId);
  assert.ok(group.recommendedArrivalId === null || recommended.length === 1);
  if (recommended.length) {
    assert.notEqual(recommended[0].departureState, 'departure_uncertain');
    assert.notEqual(recommended[0].actionability, 'do_not_recommend');
    assert.ok(!['stale', 'realtime_stale'].includes(recommended[0].realtimeState));
  }
  assert.ok(value.providers.some((row) => row.provider === 'kawasaki' && row.state !== 'unavailable'));
  assert.ok(!value.providers.some((row) => row.provider === 'tokyu'));
}

function validateSeibuArrival(row) {
  assert.equal(row.provider, 'seibu');
  assert.equal(typeof row.routeId, 'string'); assert.ok(row.routeId.length > 0);
  assert.equal(typeof row.routeLabel, 'string'); assert.ok(row.routeLabel.length > 0);
  assert.equal(typeof row.destination, 'string'); assert.ok(row.destination.length > 0);
  assert.ok(Number.isFinite(row.scheduledDeparture));
  assert.ok(Object.hasOwn(row, 'estimatedDeparture') && Object.hasOwn(row, 'etaMinutes')
    && Object.hasOwn(row, 'delayMinutes') && Object.hasOwn(row, 'realtimeState'));
  assert.equal(row.position.supported, false);
  assert.equal(row.effectiveDeparture, null);
  if (row.realtimeState === 'realtime') {
    assert.ok(Number.isFinite(row.estimatedDeparture));
    assert.ok(Number.isInteger(row.etaMinutes) && row.etaMinutes >= 0);
    assert.ok(Number.isInteger(row.delayMinutes));
  } else {
    assert.ok(['static_only', 'static_fallback', 'realtime_stale'].includes(row.realtimeState));
    assert.equal(row.estimatedDeparture, null); assert.equal(row.etaMinutes, null); assert.equal(row.delayMinutes, null);
  }
}

function validateTachikawa(value) {
  assert.equal(value.success, true); assert.equal(value.hubId, 'tachikawa-ekikitaguchi');
  assert.equal(value.hubLabel, '立川駅北口'); assert.equal(value.decisionGroups.length, 1);
  const group = value.decisionGroups[0];
  assert.equal(group.id, 'tachikawa_showa_daiichi_gakuen'); assert.equal(group.label, '昭和第一学園方面');
  assert.deepEqual(group.providers, ['seibu']);
  assert.deepEqual(group.destinations, ['昭和第一学園', '昭和第一学園西門']);
  assert.equal(group.arrivals.length, 3);
  const allowedPlatforms = new Set(['6番', '7番', '8番', '9番']);
  for (const row of group.arrivals) {
    validateSeibuArrival(row); assert.ok(allowedPlatforms.has(row.platform));
  }
  const recommended = group.arrivals.filter((row) => row.id === group.recommendedArrivalId);
  assert.ok(group.recommendedArrivalId === null || recommended.length === 1);
  if (recommended.length) {
    assert.notEqual(recommended[0].departureState, 'departure_uncertain');
    assert.notEqual(recommended[0].actionability, 'do_not_recommend');
    assert.ok(!['static_only', 'static_fallback', 'realtime_stale'].includes(recommended[0].realtimeState));
  }
  assert.ok(value.providers.some((row) => row.provider === 'seibu' && row.state !== 'unavailable'));
  assert.ok(value.attributions.some((row) => row.provider === 'seibu' && row.providerName === '西武バス'));
}

function validateSchool(value) {
  assert.equal(value.success, true); assert.equal(value.hubId, 'showa-daiichi-gakuen');
  assert.equal(value.hubLabel, '昭和第一学園'); assert.equal(value.decisionGroups.length, 1);
  const group = value.decisionGroups[0];
  assert.equal(group.id, 'showa_daiichi_gakuen_tachikawa'); assert.equal(group.label, '立川駅方面');
  assert.deepEqual(group.providers, ['seibu']); assert.deepEqual(group.destinations, ['立川駅北口']);
  assert.equal(group.arrivals.length, 3);
  for (const row of group.arrivals) validateSeibuArrival(row);
  assert.ok(group.arrivals.every((row) => row.destination === '立川駅北口'));
  const allowedOrigins = new Set(['70191-02', '70181-02-15']);
  assert.ok(group.arrivals.every((row) => allowedOrigins.has(row.originStop.id)));
  assert.ok(value.providers.some((row) => row.provider === 'seibu' && row.state !== 'unavailable'));
}

function validateJourney(value) {
  assert.equal(value.success, true); assert.equal(value.journeyGroupId, 'noborito-mukougaoka');
  assert.equal(value.journeyGroupLabel, '登戸・遊園'); assert.equal(value.children.length, 2);
  assert.equal(Object.hasOwn(value, 'recommendedChildId'), false);
  const children = Object.fromEntries(value.children.map((child) => [child.id, child]));
  const noborito = children.noborito, mukougaoka = children.mukougaoka;
  assert.equal(noborito?.hubId, 'noborito-eki'); assert.equal(noborito?.state, 'available');
  assert.equal(mukougaoka?.hubId, 'mukougaoka-yuen-minamiguchi'); assert.equal(mukougaoka?.state, 'available');
  assert.equal(noborito.decisionGroup.arrivals.length, 3); assert.equal(mukougaoka.decisionGroup.arrivals.length, 3);
  assert.ok(noborito.decisionGroup.arrivals.every((row) => row.provider === 'kawasaki' && row.routeId === '10044'
    && row.originStop.id === '362_1' && Object.hasOwn(row, 'delayMinutes') && row.position.supported === false));
  const mukougaokaProviders = new Map(mukougaoka.providers.map((row) => [row.provider, row]));
  assert.notEqual(mukougaokaProviders.get('kawasaki')?.state, 'unavailable');
  assert.notEqual(mukougaokaProviders.get('tokyu')?.state, 'unavailable');
  assert.ok(mukougaoka.decisionGroup.arrivals.every((row) => ['kawasaki', 'tokyu'].includes(row.provider)
    && row.position.supported === false));
  for (const row of mukougaoka.decisionGroup.arrivals) {
    if (row.provider === 'kawasaki') {
      assert.equal(row.routeId, '10037'); assert.equal(row.originStop.id, '474_5');
      assert.equal(row.platform, '5番'); assert.ok(Object.hasOwn(row, 'delayMinutes'));
    } else {
      assert.equal(row.routeId, 'odpt.Busroute:TokyuBus.Kou01'); assert.equal(row.realtimeState, 'static_only');
      assert.equal(row.platform, '6'); assert.equal(row.estimatedDeparture, null);
      assert.equal(row.etaMinutes, null); assert.equal(row.delayMinutes, null);
    }
    assert.equal(row.effectiveDeparture, null);
  }
}

try {
  const health = await request('/health'); assert.equal(health.status, 'ok');
  phase = 'p0'; validateP0(await request('/api/bus/arrivals'));
  phase = 'hub_kibukihoncho';
  for (let index = 0; index < 3; index++) validateKibukihoncho(await request('/api/bus/hub?id=kibukihoncho'));
  phase = 'hub_mizonokuchi';
  for (let index = 0; index < 3; index++) validateMizonokuchi(await request('/api/bus/hub?id=mizonokuchi-minamiguchi'));
  phase = 'hub_tachikawa';
  const tachikawa = await request('/api/bus/hub?id=tachikawa-ekikitaguchi'); validateTachikawa(tachikawa);
  phase = 'hub_showa_daiichi_gakuen';
  const school = await request('/api/bus/hub?id=showa-daiichi-gakuen'); validateSchool(school);
  phase = 'journey_noborito_mukougaoka';
  const journey = await request('/api/bus/journey?id=noborito-mukougaoka'); validateJourney(journey);
  phase = 'cors_deny'; await validateCorsDeny('/api/bus/hub?id=tachikawa-ekikitaguchi');
  await validateCorsDeny('/api/bus/journey?id=noborito-mukougaoka');
  const journeyChildren = Object.fromEntries(journey.children.map((child) => [child.id, child]));
  console.log(JSON.stringify({ status: 'P2_5_REMOTE_PASS', origin: PRODUCTION_ORIGIN,
    p0: { directions: 4, arrivalsEach: 3 }, hubs: { kibukihonchoGroups: 3, mizonokuchiGroups: 1,
      tachikawaGroups: 1, showaDaiichiGakuenGroups: 1, arrivalsEach: 3 },
    seibu: { tachikawaPlatforms: [...new Set(tachikawa.arrivals.map((row) => row.platform))].sort(),
      schoolOriginStops: [...new Set(school.arrivals.map((row) => row.originStop.id))].sort(),
      tachikawaQuality: [...new Set(tachikawa.arrivals.map((row) => row.realtimeState))].sort(),
      schoolQuality: [...new Set(school.arrivals.map((row) => row.realtimeState))].sort(),
      realtimeRows: [...tachikawa.arrivals, ...school.arrivals].filter((row) => row.realtimeState === 'realtime').length,
      staticFallbackRows: [...tachikawa.arrivals, ...school.arrivals]
        .filter((row) => row.realtimeState === 'static_fallback').length,
      delayedRows: [...tachikawa.arrivals, ...school.arrivals]
        .filter((row) => row.realtimeState === 'realtime' && row.delayMinutes !== 0).length },
    journey: { id: journey.journeyGroupId, children: 2, arrivalsEach: 3,
      noboritoProviders: [...new Set(journeyChildren.noborito.decisionGroup.arrivals.map((row) => row.provider))],
      mukougaokaProviders: [...new Set(journeyChildren.mukougaoka.decisionGroup.arrivals.map((row) => row.provider))],
      mukougaokaProviderStates: journeyChildren.mukougaoka.providers
        .map((row) => `${row.provider}:${row.state}`).sort() },
    delayFieldPreserved: true, positionUiEnabled: false, publicDeparturePrediction: false,
    tokyuRealtime: false, tokyuMizonokuchi: false,
    secretLeak: false, measurements }));
} catch (error) {
  const code = error?.name === 'AssertionError' ? 'ASSERTION_FAILED'
    : /^[A-Z0-9_]+$/.test(error?.message || '') ? error.message : 'REMOTE_REQUEST_FAILED';
  console.log(JSON.stringify({ status: 'P2_5_REMOTE_FAILED', phase, code, measurements }));
  process.exitCode = 1;
}

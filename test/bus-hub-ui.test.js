const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const hub = require('../features/bus/hub.js');

const NOW = Date.parse('2026-09-13T07:00:00+09:00') / 1000;
const arrival = (changes = {}) => ({ id: 'synthetic', provider: 'tokyu', routeLabel: '向０１', destination: '梶が谷駅',
  scheduledDeparture: NOW + 300, estimatedDeparture: null, etaMinutes: null, delayMinutes: null,
  realtimeState: 'static_only', platform: 'a', ...changes });
const fixture = (row = arrival()) => ({ success: true, hubId: 'kibukihoncho', hubLabel: '神木本町', generatedAt: NOW,
  providers: [{ provider: 'tokyu', state: 'available', retrievedAt: NOW - 60, sourceUpdatedAt: NOW - 3600 }],
  attributions: [{ provider: 'tokyu', providerName: '東急バス', distributor: '公共交通オープンデータセンター',
    url: 'https://www.odpt.org/' }], decisionGroups: [{ id: 'kibukihoncho_kajigaya', hubId: 'kibukihoncho',
    label: '梶が谷方面', destinations: ['梶が谷駅'], providers: ['tokyu'], arrivals: [row] }] });

test('Hub module stays fail-closed while production config explicitly enables it', () => {
  assert.equal(hub.HUB_UI_DEFAULT_ENABLED, false);
  const config = fs.readFileSync(require.resolve('../features/bus/config.js'), 'utf8');
  assert.match(config, /PALURU_BUS_HUB_UI_ENABLED\s*=\s*true/);
  assert.match(config, /PALURU_BUS_LEGACY_UI_ENABLED\s*=\s*false/);
});

test('production shell loads the Hub mount, script and stylesheet without enabling Position UI', () => {
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  const sw = fs.readFileSync(require.resolve('../sw.js'), 'utf8');
  assert.match(html, /id="busHubMount"/);
  assert.match(html, /features\/bus\/hub\.js/);
  assert.match(html, /features\/bus\/hub\.css/);
  assert.match(sw, /versioned\("features\/bus\/hub\.js"\)/);
  assert.match(sw, /versioned\("features\/bus\/hub\.css"\)/);
  assert.match(sw, /"\/api\/bus\/hub"/);
  assert.doesNotMatch(html, /bus-position|latitude|longitude|stopsAway/);
});

test('Tokyu static-only UI never presents ETA or realtime wording', () => {
  const value = hub.validate(fixture()).decisionGroups[0].arrivals[0];
  const shown = hub.displayArrival(value);
  assert.deepEqual(shown, { time: '07:05予定', note: '時刻表のみ', kind: 'static', delay: '' });
  assert.doesNotMatch(`${shown.time}${shown.note}${shown.delay}`, /あと|リアルタイム|遅れ/);
  assert.throws(() => hub.validate(fixture(arrival({ etaMinutes: 5 }))), /BUS_HUB_STATIC_AS_REALTIME/);
  assert.throws(() => hub.validate(fixture(arrival({ estimatedDeparture: NOW + 360 }))), /BUS_HUB_STATIC_AS_REALTIME/);
  assert.throws(() => hub.validate(fixture(arrival({ delayMinutes: 3 }))), /BUS_HUB_STATIC_AS_REALTIME/);
});

test('Hub UI exposes Tokyu static retrieval time and attribution', () => {
  const data = hub.validate(fixture());
  assert.equal(hub.sourceSummary(data), '東急時刻表取得 2026-09-13 06:59 / 出典: 東急バス（公共交通オープンデータセンター）');
  assert.throws(() => hub.validate({ ...data, attributions: []
    .concat({ provider: 'tokyu', providerName: '', distributor: 'ODPT', url: 'https://www.odpt.org/' }) }),
  /BUS_HUB_RESPONSE_INVALID/);
});

test('Kawasaki realtime displays P0 delay wording while stale and pending states take priority', () => {
  assert.deepEqual(hub.displayArrival(arrival({ provider: 'kawasaki', realtimeState: 'realtime', etaMinutes: 4,
    estimatedDeparture: NOW + 240, delayMinutes: 7 })),
  { time: '07:05便', note: 'あと4分', kind: 'live', delay: '+7分遅れ' });
  assert.equal(hub.displayArrival(arrival({ provider: 'kawasaki', realtimeState: 'realtime', etaMinutes: 4,
    estimatedDeparture: NOW + 240, delayMinutes: 0 })).delay, '');
  assert.equal(hub.displayArrival(arrival({ provider: 'kawasaki', realtimeState: 'stale', delayMinutes: 7 })).delay, '');
  assert.equal(hub.displayArrival(arrival({ provider: 'kawasaki', realtimeState: 'realtime_stale', delayMinutes: 7 })).delay, '');
  assert.equal(hub.displayArrival(arrival({ provider: 'kawasaki', realtimeState: 'realtime',
    departureState: 'departure_pending', delayMinutes: 7 })).delay, '');
  assert.equal(hub.displayArrival(arrival({ provider: 'kawasaki', realtimeState: 'static_fallback' })).note,
    'リアルタイム予測なし');
  const source = fs.readFileSync(require.resolve('../features/bus/hub.js'), 'utf8');
  assert.doesNotMatch(source, /bus-position|latitude|longitude|stopsAway/);
});

test('decision-group UI uses three groups and keeps provider, route, destination and delay DOM hooks', () => {
  const source = fs.readFileSync(require.resolve('../features/bus/hub.js'), 'utf8');
  const css = fs.readFileSync(require.resolve('../features/bus/hub.css'), 'utf8');
  assert.match(source, /data\.decisionGroups/);
  assert.match(source, /bus-hub-provider/);
  assert.match(source, /bus-hub-route/);
  assert.match(source, /bus-hub-destination/);
  assert.match(source, /bus-hub-delay/);
  assert.match(css, /@media \(max-width: 420px\)/);
  assert.match(css, /overflow-wrap: anywhere/);
});

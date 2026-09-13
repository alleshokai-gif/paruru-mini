const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const hub = require('../features/bus/hub.js');

const NOW = Date.parse('2026-09-13T07:00:00+09:00') / 1000;
const arrival = (changes = {}) => ({ id: 'synthetic', provider: 'tokyu', routeLabel: '向０１', destination: '梶が谷駅',
  scheduledDeparture: NOW + 300, estimatedDeparture: null, etaMinutes: null, delayMinutes: null,
  realtimeState: 'static_only', platform: 'a', ...changes });
const fixture = (row = arrival()) => ({ success: true, hubId: 'kibukihoncho', generatedAt: NOW,
  providers: [{ provider: 'tokyu', state: 'available', retrievedAt: NOW - 60, sourceUpdatedAt: NOW - 3600 }],
  attributions: [{ provider: 'tokyu', providerName: '東急バス', distributor: '公共交通オープンデータセンター',
    url: 'https://www.odpt.org/' }], groups: [{ id: 'kajigaya', label: '梶が谷方面', arrivals: [row] }] });

test('Hub module stays fail-closed while production config explicitly enables it', () => {
  assert.equal(hub.HUB_UI_DEFAULT_ENABLED, false);
  const config = fs.readFileSync(require.resolve('../features/bus/config.js'), 'utf8');
  assert.match(config, /PALURU_BUS_HUB_UI_ENABLED\s*=\s*true/);
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
  const value = hub.validate(fixture()).groups[0].arrivals[0];
  const shown = hub.displayArrival(value);
  assert.equal(shown.time, '07:05予定'); assert.equal(shown.note, '時刻表のみ'); assert.equal(shown.kind, 'static');
  assert.doesNotMatch(`${shown.time}${shown.note}`, /あと|リアルタイム|遅れ/);
  assert.throws(() => hub.validate(fixture(arrival({ etaMinutes: 5 }))), /BUS_HUB_STATIC_AS_REALTIME/);
  assert.throws(() => hub.validate(fixture(arrival({ estimatedDeparture: NOW + 360 }))), /BUS_HUB_STATIC_AS_REALTIME/);
});

test('Hub UI exposes Tokyu static retrieval time and attribution', () => {
  const data = hub.validate(fixture());
  assert.equal(hub.sourceSummary(data), '東急時刻表取得 2026-09-13 06:59 / 出典: 東急バス（公共交通オープンデータセンター）');
  assert.throws(() => hub.validate({ ...data, attributions: []
    .concat({ provider: 'tokyu', providerName: '', distributor: 'ODPT', url: 'https://www.odpt.org/' }) }),
  /BUS_HUB_RESPONSE_INVALID/);
});

test('Kawasaki realtime and fallback retain distinct Hub labels; Position DOM stays absent', () => {
  assert.deepEqual(hub.displayArrival(arrival({ provider: 'kawasaki', realtimeState: 'realtime', etaMinutes: 4,
    estimatedDeparture: NOW + 240 })), { time: '07:05便', note: 'あと4分', kind: 'live' });
  assert.equal(hub.displayArrival(arrival({ provider: 'kawasaki', realtimeState: 'static_fallback' })).note,
    'リアルタイム予測なし');
  const source = fs.readFileSync(require.resolve('../features/bus/hub.js'), 'utf8');
  assert.doesNotMatch(source, /bus-position|latitude|longitude|stopsAway/);
});

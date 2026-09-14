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
  assert.match(config, /mizonokuchi-minamiguchi/);
  assert.match(config, /tachikawa-ekikitaguchi/);
  assert.match(config, /showa-daiichi-gakuen/);
  assert.deepEqual(hub.configuredHubs({ PALURU_BUS_HUBS: [
    { id: 'kibukihoncho', label: '神木本町' }, { id: 'mizonokuchi-minamiguchi', label: '溝の口駅南口' }
  ] }).map((value) => value.id), ['kibukihoncho', 'mizonokuchi-minamiguchi']);
  assert.throws(() => hub.configuredHubs({ PALURU_BUS_HUBS: [] }), /BUS_HUB_CONFIG_INVALID/);
});

test('Hub location selection restores a valid session choice and activates only the visible controller', () => {
  const specs = hub.configuredHubs({ PALURU_BUS_HUBS: [
    { id: 'kibukihoncho', label: '神木本町', selectorLabel: '神木本町' },
    { id: 'mizonokuchi-minamiguchi', label: '溝の口駅南口', selectorLabel: '溝の口' },
    { id: 'tachikawa-ekikitaguchi', label: '立川駅北口', selectorLabel: '立川駅' },
    { id: 'showa-daiichi-gakuen', label: '昭和第一学園', selectorLabel: '学校' }
  ] });
  assert.equal(hub.resolveSelectedHubId(specs, 'tachikawa-ekikitaguchi'), 'tachikawa-ekikitaguchi');
  assert.equal(hub.resolveSelectedHubId(specs, 'removed-hub'), 'kibukihoncho');
  assert.deepEqual(specs.map((spec) => spec.selectorLabel), ['神木本町', '溝の口', '立川駅', '学校']);
  const active = new Map(), persisted = [];
  const selection = hub.createSelection({ specs, initialHubId: 'mizonokuchi-minamiguchi',
    activate: (id, value) => active.set(id, value), persist: (id) => persisted.push(id) });
  selection.setActive(true);
  assert.deepEqual(specs.filter((spec) => active.get(spec.id)).map((spec) => spec.id), ['mizonokuchi-minamiguchi']);
  assert.equal(selection.select('showa-daiichi-gakuen'), true);
  assert.deepEqual(specs.filter((spec) => active.get(spec.id)).map((spec) => spec.id), ['showa-daiichi-gakuen']);
  assert.deepEqual(persisted, ['showa-daiichi-gakuen']);
  assert.equal(selection.select('showa-daiichi-gakuen'), false);
  selection.setActive(false);
  assert.equal(specs.some((spec) => active.get(spec.id)), false);
  assert.throws(() => selection.select('unknown-hub'), /BUS_HUB_SELECTION_INVALID/);
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
  assert.deepEqual(shown, { time: '07:05', timeSuffix: '予定', note: '時刻表のみ', kind: 'static', delay: '' });
  assert.doesNotMatch(`${shown.time}${shown.note}${shown.delay}`, /あと|リアルタイム|遅れ/);
  assert.throws(() => hub.validate(fixture(arrival({ etaMinutes: 5 }))), /BUS_HUB_STATIC_AS_REALTIME/);
  assert.throws(() => hub.validate(fixture(arrival({ estimatedDeparture: NOW + 360 }))), /BUS_HUB_STATIC_AS_REALTIME/);
  assert.throws(() => hub.validate(fixture(arrival({ delayMinutes: 3 }))), /BUS_HUB_STATIC_AS_REALTIME/);
});

test('Hub response identity and URL are resolved per configured location', () => {
  const mizo = { ...fixture(arrival({ provider: 'kawasaki', routeLabel: '溝１８', destination: '神木本町',
    realtimeState: 'realtime', platform: '3番', estimatedDeparture: NOW + 360, etaMinutes: 6, delayMinutes: 2 })),
    hubId: 'mizonokuchi-minamiguchi', hubLabel: '溝の口駅南口' };
  mizo.decisionGroups = mizo.decisionGroups.map((group) => ({ ...group, id: 'mizonokuchi_minamiguchi_home',
    hubId: mizo.hubId, label: '神木本町方面', destinations: ['神木本町'], providers: ['kawasaki'] }));
  assert.equal(hub.validate(mizo, 'mizonokuchi-minamiguchi').hubLabel, '溝の口駅南口');
  assert.throws(() => hub.validate(mizo, 'kibukihoncho'), /BUS_HUB_RESPONSE_INVALID/);
  assert.equal(hub.apiUrl({ PALURU_BUS_API_URL: 'https://bus.example/api/bus/arrivals',
    location: { href: 'https://paluru.example/' } }, 'mizonokuchi-minamiguchi').href,
  'https://bus.example/api/bus/hub?id=mizonokuchi-minamiguchi');
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
  { time: '07:05', timeSuffix: '便', note: 'あと4分', kind: 'live', delay: '+7分遅れ' });
  const observedExample = hub.displayArrival(arrival({ provider: 'kawasaki', realtimeState: 'realtime', etaMinutes: 22,
    estimatedDeparture: NOW + 1320, delayMinutes: 5 }));
  assert.equal(observedExample.note, 'あと22分');
  assert.equal(observedExample.delay, '+5分遅れ');
  assert.equal(hub.displayArrival(arrival({ provider: 'kawasaki', realtimeState: 'realtime', etaMinutes: 4,
    estimatedDeparture: NOW + 240, delayMinutes: 0 })).delay, '');
  assert.equal(hub.displayArrival(arrival({ provider: 'kawasaki', realtimeState: 'stale', delayMinutes: 7 })).delay, '');
  assert.equal(hub.displayArrival(arrival({ provider: 'kawasaki', realtimeState: 'realtime_stale', delayMinutes: 7 })).delay, '');
  assert.equal(hub.displayArrival(arrival({ provider: 'kawasaki', realtimeState: 'realtime',
    departureState: 'departure_pending', delayMinutes: 7 })).delay, '');
  assert.equal(hub.displayArrival(arrival({ provider: 'kawasaki', realtimeState: 'static_fallback' })).note,
    'リアルタイム予測なし');
  assert.equal(hub.displayArrival(arrival({ provider: 'kawasaki', realtimeState: 'realtime',
    departureState: 'departure_uncertain' })).note, '発車済みの可能性あり');
  const source = fs.readFileSync(require.resolve('../features/bus/hub.js'), 'utf8');
  assert.doesNotMatch(source, /bus-position|latitude|longitude|stopsAway/);
});

test('decision-group UI supports multiple locations and keeps provider, route, destination and delay DOM hooks', () => {
  const source = fs.readFileSync(require.resolve('../features/bus/hub.js'), 'utf8');
  const css = fs.readFileSync(require.resolve('../features/bus/hub.css'), 'utf8');
  assert.match(source, /data\.decisionGroups/);
  assert.match(source, /PALURU_BUS_HUBS/);
  assert.match(source, /bus-hub-location/);
  assert.match(source, /bus-hub-provider/);
  assert.match(source, /createElementNS\('http:\/\/www\.w3\.org\/2000\/svg', 'svg'\)/);
  assert.match(source, /setAttribute\('stroke', 'currentColor'\)/);
  assert.match(source, /setAttribute\('aria-hidden', 'true'\)/);
  assert.match(source, /bus-hub-provider-name/);
  assert.match(source, /bus-hub-route/);
  assert.match(source, /bus-hub-destination/);
  assert.match(source, /bus-hub-delay/);
  assert.match(source, /bus-hub-time-suffix/);
  assert.match(source, /seibu:\s*'西武バス'/);
  const local = fs.readFileSync(require.resolve('../bus/scripts/local-ui.js'), 'utf8');
  assert.match(local, /tachikawa-ekikitaguchi/);
  assert.match(local, /showa-daiichi-gakuen/);
  assert.match(css, /@media \(max-width: 420px\)/);
  assert.match(css, /overflow-wrap: anywhere/);
});

test('Hub selector uses accessible tabs, session state and four non-scrolling columns at 390px', () => {
  const source = fs.readFileSync(require.resolve('../features/bus/hub.js'), 'utf8');
  const css = fs.readFileSync(require.resolve('../features/bus/hub.css'), 'utf8');
  assert.match(source, /sessionStorage/);
  assert.match(source, /setAttribute\('role', 'tablist'\)/);
  assert.match(source, /setAttribute\('role', 'tab'\)/);
  assert.match(source, /setAttribute\('aria-selected'/);
  assert.match(source, /setAttribute\('role', 'tabpanel'\)/);
  assert.match(source, /locationPanels\.get\(id\)\.hidden = !selected/);
  assert.match(css, /\.bus-hub-selector \{[^}]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/s);
  assert.match(css, /\.bus-hub-selector-button[^}]*min-width: 0[^}]*min-height: 48px/s);
  assert.match(css, /\.bus-hub-selector-button[^}]*white-space: nowrap/s);
  assert.doesNotMatch(css, /@media \(max-width: 420px\)[\s\S]*grid-template-columns: repeat\(2/);
  assert.doesNotMatch(css, /\.bus-hub-selector[^}]*overflow-x\s*:\s*(?:auto|scroll)/s);
  assert.match(css, /\.bus-hub-row \{[^}]*padding: 10px 0/s);
  assert.match(css, /\.bus-hub-time-suffix \{[^}]*font-size: 0\.6em[^}]*vertical-align: baseline/s);
  assert.match(css, /\.bus-hub-provider\.is-kawasaki \.bus-hub-provider-icon \{ color: #1f6fb2; \}/);
  assert.match(css, /\.bus-hub-provider\.is-tokyu \.bus-hub-provider-icon \{ color: #c62828; \}/);
  assert.match(css, /\.bus-hub-provider\.is-seibu \.bus-hub-provider-icon \{ color: #238636; \}/);
});

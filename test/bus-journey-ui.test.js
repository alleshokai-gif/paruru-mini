const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const journey = require('../features/bus/journey.js');
const hub = require('../features/bus/hub.js');

const NOW = Date.parse('2026-09-14T07:00:00+09:00') / 1000;
const row = (id, provider) => ({ id, provider, routeLabel: provider === 'tokyu' ? '向０１' : '登０５',
  destination: provider === 'tokyu' ? '梶が谷駅' : '生田緑地入口', scheduledDeparture: NOW + 300,
  estimatedDeparture: provider === 'tokyu' ? null : NOW + 360, etaMinutes: provider === 'tokyu' ? null : 6,
  delayMinutes: null, realtimeState: provider === 'tokyu' ? 'static_only' : 'realtime', platform: provider === 'tokyu' ? '6' : '1番' });
const group = (id, rows) => ({ id, recommendedArrivalId: rows[0].id, arrivals: rows });
const fixture = () => ({ success: true, journeyGroupId: 'noborito-mukougaoka', journeyGroupLabel: '登戸・遊園',
  generatedAt: NOW, attributions: [], children: [
    { id: 'noborito', hubId: 'noborito-eki', label: '登戸駅', purposeLabel: '神木本町方面', state: 'available',
      providers: [], decisionGroup: group('noborito_kibukihoncho', [row('n1', 'kawasaki'), row('n2', 'kawasaki'), row('n3', 'kawasaki')]) },
    { id: 'mukougaoka', hubId: 'mukougaoka-yuen-minamiguchi', label: '向ヶ丘遊園駅南口', purposeLabel: '神木本町方面',
      state: 'available', providers: [], decisionGroup: group('mukougaoka_kibukihoncho',
        [row('m1', 'kawasaki'), row('m2', 'tokyu'), row('m3', 'kawasaki')]) }
  ] });

test('Journey UI stays fail-closed by default and production enables only the verified Journey', () => {
  assert.equal(journey.JOURNEY_UI_DEFAULT_ENABLED, false);
  const config = fs.readFileSync(require.resolve('../features/bus/config.js'), 'utf8');
  const local = fs.readFileSync(require.resolve('../bus/scripts/local-ui.js'), 'utf8');
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  const sw = fs.readFileSync(require.resolve('../sw.js'), 'utf8');
  assert.match(config, /PALURU_BUS_JOURNEY_UI_ENABLED\s*=\s*true/);
  assert.match(config, /PALURU_BUS_JOURNEYS\s*=\s*Object\.freeze\(\[/);
  assert.match(config, /id:\s*'noborito-mukougaoka'[\s\S]*label:\s*'登戸・遊園'/);
  assert.match(config, /id:\s*'noborito-mukougaoka'[\s\S]*kind:\s*'journey'/);
  assert.match(html, /features\/bus\/journey\.css/);
  assert.match(html, /features\/bus\/journey\.js/);
  assert.match(sw, /versioned\("features\/bus\/journey\.js"\)/);
  assert.match(sw, /versioned\("features\/bus\/journey\.css"\)/);
  assert.match(sw, /"\/api\/bus\/journey"/);
  assert.match(local, /PALURU_BUS_JOURNEY_UI_ENABLED=true/);
  assert.match(local, /noborito-mukougaoka/);
  assert.match(local, /kind:'journey'/);
  assert.doesNotMatch(local, /登戸・遊園連合/);
});

test('Journey UI validates two independent next-three cards including mixed Mukougaoka Providers', () => {
  const value = journey.validate(fixture(), 'noborito-mukougaoka');
  assert.equal(value.children.length, 2);
  assert.deepEqual(value.children.map((child) => child.decisionGroup.arrivals.length), [3, 3]);
  assert.deepEqual([...new Set(value.children[1].decisionGroup.arrivals.map((value) => value.provider))], ['kawasaki', 'tokyu']);
  assert.equal(Object.hasOwn(value, 'recommendedChildId'), false);
  assert.throws(() => journey.validate({ ...value, journeyGroupId: 'wrong' }, 'noborito-mukougaoka'),
    /BUS_JOURNEY_RESPONSE_INVALID/);
  assert.equal(journey.apiUrl({ PALURU_BUS_API_URL: 'https://bus.example/api/bus/arrivals',
    location: { href: 'https://paluru.example/' } }, 'noborito-mukougaoka').href,
  'https://bus.example/api/bus/journey?id=noborito-mukougaoka');
});

test('Journey reuses the Hub arrival renderer and keeps the 390px containment contract', () => {
  assert.equal(typeof hub.renderArrivalList, 'function');
  const source = fs.readFileSync(require.resolve('../features/bus/journey.js'), 'utf8');
  const css = fs.readFileSync(require.resolve('../features/bus/journey.css'), 'utf8');
  assert.match(source, /hubUi\.renderArrivalList/);
  assert.equal(typeof journey.createJourneyController, 'function');
  assert.match(source, /child\.purposeLabel/);
  assert.doesNotMatch(source, /recommendedChildId|compareChildren|bestHub/);
  assert.match(css, /@media \(max-width: 420px\)/);
  assert.match(css, /min-width: 0/); assert.match(css, /max-width: 100%/); assert.match(css, /overflow: hidden/);
  assert.match(css, /\.bus-journey-child-header \{[^}]*background: #334e68[^}]*color: #fff/s);
  assert.match(css, /\.bus-journey-child-header \{[^}]*display: flex[^}]*align-items: baseline[^}]*flex-wrap: nowrap/s);
  assert.match(css, /\.bus-journey-child-title \{[^}]*color: #fff/s);
  assert.match(css, /\.bus-journey-child-title \{[^}]*font-size: 16px[^}]*white-space: nowrap/s);
  assert.match(css, /\.bus-journey-child-purpose \{[^}]*color: #dbe7f1[^}]*font-size: 12px[^}]*white-space: nowrap/s);
  assert.match(css, /\.bus-journey-child \.bus-hub-row\.is-recommended \{ max-width: none; \}/);
  assert.doesNotMatch(source, /bus-position|latitude|longitude|stopsAway/);
});

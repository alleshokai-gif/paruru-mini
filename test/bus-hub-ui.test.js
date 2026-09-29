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

function fakeDocument() {
  const create = (tagName) => ({ tagName, className: '', textContent: '', children: [], attributes: {},
    classList: { add(value) { this.owner.className += ` ${value}`; } },
    setAttribute(name, value) { this.attributes[name] = value; },
    append(...children) { this.children.push(...children); } });
  return { createElement(tagName) { const value = create(tagName); value.classList.owner = value; return value; },
    createElementNS(_namespace, tagName) { const value = create(tagName); value.classList.owner = value; return value; } };
}

function descendants(node) { return [node, ...(node.children || []).filter((value) => typeof value === 'object').flatMap(descendants)]; }
function renderedText(node) { return descendants(node).map((value) => value.textContent).join(''); }
function renderOriginBadge(row, hubId = 'kibukihoncho') {
  const list = hub.renderArrivalList(fakeDocument(), { arrivals: [row], recommendedArrivalId: null }, hubId);
  return { list, nodes: descendants(list) };
}

test('Hub module stays fail-closed while production config explicitly enables it', () => {
  assert.equal(hub.HUB_UI_DEFAULT_ENABLED, false);
  assert.equal(typeof hub.selectHub, 'function');
  const config = fs.readFileSync(require.resolve('../features/bus/config.js'), 'utf8');
  assert.match(config, /PALURU_BUS_HUB_UI_ENABLED\s*=\s*true/);
  assert.match(config, /PALURU_BUS_POSITION_SHADOW_ENABLED\s*=\s*true/);
  assert.match(config, /PALURU_BUS_LEGACY_UI_ENABLED\s*=\s*false/);
  assert.match(config, /mizonokuchi-minamiguchi/);
  assert.match(config, /tachikawa-ekikitaguchi/);
  assert.match(config, /showa-daiichi-gakuen/);
  assert.deepEqual(hub.configuredHubs({ PALURU_BUS_HUBS: [
    { id: 'kibukihoncho', label: '神木本町' }, { id: 'mizonokuchi-minamiguchi', label: '溝の口駅南口' }
  ] }).map((value) => value.id), ['kibukihoncho', 'mizonokuchi-minamiguchi']);
  assert.throws(() => hub.configuredHubs({ PALURU_BUS_HUBS: [] }), /BUS_HUB_CONFIG_INVALID/);
});

test('Position shadow has an explicit local gate and safely waits for weak evidence', () => {
  const row = arrival({ provider: 'kawasaki', routeLabel: '登０５', destination: '登戸駅',
    realtimeState: 'realtime', position: { supported: true, shadowReady: true,
      state: 'between_stops', previousStop: '長尾橋', nextStop: '神木本町', stopsAway: 2,
      observedAt: Date.now() / 1000 } });
  const group = { arrivals: [row], recommendedArrivalId: null };
  assert.doesNotMatch(renderedText(hub.renderArrivalList(fakeDocument(), group, 'kibukihoncho')), /停留所|位置確認中/);
  assert.match(renderedText(hub.renderArrivalList(fakeDocument(), group, 'kibukihoncho', true)),
    /🚌 長尾橋〜神木本町を走行中・あと2停留所/);
  assert.equal(descendants(hub.renderArrivalList(fakeDocument(), group, 'kibukihoncho', true))
    .filter((node) => node.className === 'bus-hub-position-shadow').length, 1);
  assert.equal(hub.displayShadowPosition({ supported: false }), '位置確認中');
  assert.equal(hub.displayShadowPosition({ ...row.position, shadowReady: false }), '位置確認中');
  assert.equal(hub.displayShadowPosition(row.position, row.position.observedAt + 121), '位置確認中');
});

test('Seibu imminent ETA and coarse stop location use the shared Hub card without static quality', () => {
  const observedAt = Date.now() / 1000;
  const row = arrival({ provider: 'seibu', routeLabel: '立３４', destination: '立川駅北口',
    realtimeState: 'realtime', etaMinutes: 0, delayMinutes: 2,
    position: { supported: true, fidelity: 'stop_sequence', state: 'near_stop',
      nextStop: '昭和第一学園', stopsAway: 0, observedAt } });
  const shown = renderedText(hub.renderArrivalList(fakeDocument(),
    { arrivals: [row], recommendedArrivalId: row.id }, 'showa-daiichi-gakuen', true));
  assert.match(shown, /西武バス.*立３４.*まもなく.*\+2分遅れ.*🚌 昭和第一学園付近・あと0停留所/s);
  assert.doesNotMatch(shown, /時刻表のみ|位置確認中/);
});

test('official Tokyu approach adds one line only to the first Tokyu card without changing static time', () => {
  const tokyu = arrival({ id: 'tokyu-first', sourceId: 'kibukihoncho_to_mukougaoka', destination: '向ヶ丘遊園駅南口',
    originStop: { id: 'odpt:BusstopPole:TokyuBus.Shibokuhonchou.00240751.b', name: '神木本町' },
    officialApproach: { matchedTripId: null, uniqueNext: true, sourceId: 'kibukihoncho_to_mukougaoka', routeLabel: '向01',
      destination: '向ヶ丘遊園駅南口', boardingStopId: 'odpt:BusstopPole:TokyuBus.Shibokuhonchou.00240751.b',
      waitMinutes: 5, stopsAwayMin: 4, stopsAwayMax: 5, retrievedAt: Date.now() / 1000 } });
  const list = hub.renderArrivalList(fakeDocument(), { recommendedArrivalId: null, arrivals: [
    arrival({ id: 'kawasaki', provider: 'kawasaki', routeLabel: '登０５' }), tokyu,
    { ...tokyu, id: 'tokyu-second', scheduledDeparture: NOW + 1800 }
  ] }, 'kibukihoncho', true);
  assert.equal(list.children.length, 3);
  const firstTokyu = renderedText(list.children[1]);
  assert.match(firstTokyu, /07:05.*便.*あと5分.*🚌 次の向01　4〜5停留所手前/s);
  assert.doesNotMatch(firstTokyu, /時刻表のみ|公式接近/);
  assert.equal(descendants(list.children[1]).filter((node) => node.className === 'bus-hub-position-shadow').length, 1);
  assert.doesNotMatch(fs.readFileSync(require.resolve('../features/bus/hub.css'), 'utf8'),
    /bus-hub-official-approach/);
  assert.doesNotMatch(firstTokyu, /位置確認中|便未照合|取得/);
  assert.doesNotMatch(renderedText(list.children[2]), /次の向01/);
  assert.match(renderedText(list.children[2]), /位置確認中/);
  assert.doesNotMatch(renderedText(hub.renderArrivalList(fakeDocument(),
    { recommendedArrivalId: null, arrivals: [tokyu] }, 'kibukihoncho')), /次の向01|位置確認中/);
});

test('Tokyu official approach derives approximate delay and keeps ETA in the shared timing row', () => {
  const retrievedAt = NOW;
  const row = arrival({ scheduledDeparture: NOW + 6 * 60, sourceId: 'kibukihoncho_to_mukougaoka',
    destination: '向ヶ丘遊園駅南口',
    officialApproach: { matchedTripId: null, uniqueNext: true, sourceId: 'kibukihoncho_to_mukougaoka',
      routeLabel: '向01', destination: '向ヶ丘遊園駅南口', boardingStopId: 'tokyu-stop',
      waitMinutes: 12, stopsAwayMin: 7, stopsAwayMax: 9, retrievedAt } });
  const shown = renderedText(hub.renderArrivalList(fakeDocument(),
    { recommendedArrivalId: null, arrivals: [row] }, 'kibukihoncho', true));
  assert.match(shown, /07:06.*便.*あと12分.*約\+6分遅れ.*次の向01　約8停留所手前/s);
  const source = fs.readFileSync(require.resolve('../features/bus/hub.css'), 'utf8');
  assert.match(source, /grid-template-columns: minmax\(0, 1fr\) auto minmax\(0, 1fr\)/);
  assert.match(source, /bus-hub-quality \{ justify-self: center; \}/);
  assert.match(source, /bus-hub-delay \{ justify-self: end;/);
});

test('official ETA degrades to coarse approach while invalid source or stale data falls back', () => {
  const base = { matchedTripId: null, uniqueNext: true, sourceId: 'kibukihoncho_to_mukougaoka', routeLabel: '向01',
    destination: '向ヶ丘遊園駅南口', boardingStopId: 'tokyu-stop',
    waitMinutes: 5, stopsAwayMin: 4, stopsAwayMax: 5, retrievedAt: Date.now() / 1000 };
  for (const override of [
    { retrievedAt: base.retrievedAt - 181 }, { matchedTripId: 'unverified-trip' },
    { sourceId: 'other-direction' }
  ]) {
    const row = arrival({ destination: '向ヶ丘遊園駅南口', originStop: { id: 'tokyu-stop', name: '神木本町' },
      officialApproach: { ...base, ...override } });
    const shown = renderedText(hub.renderArrivalList(fakeDocument(),
      { recommendedArrivalId: null, arrivals: [row] }, 'kibukihoncho', true));
    assert.match(shown, /時刻表のみ.*位置確認中/s);
    assert.doesNotMatch(shown, /次の向01/);
  }
  const coarse = arrival({ destination: '向ヶ丘遊園駅南口', sourceId: base.sourceId,
    officialApproach: { ...base, uniqueNext: false, stopsAwayMin: null, stopsAwayMax: null } });
  assert.match(renderedText(hub.renderArrivalList(fakeDocument(),
    { recommendedArrivalId: null, arrivals: [coarse] }, 'kibukihoncho', true)),
  /あと5分.*次の向01　接近中/s);
  const imminent = arrival({ destination: '向ヶ丘遊園駅南口', sourceId: base.sourceId,
    officialApproach: { ...base, waitMinutes: 0 } });
  assert.match(renderedText(hub.renderArrivalList(fakeDocument(),
    { recommendedArrivalId: null, arrivals: [imminent] }, 'kibukihoncho', true)),
  /まもなく.*次の向01　4〜5停留所手前/s);
});

test('Kawasaki stop-sequence position displays approximate progress without geometry', () => {
  const observedAt = Date.now() / 1000;
  assert.equal(hub.displayShadowPosition({ supported: true, fidelity: 'stop_sequence',
    state: 'near_stop', nextStop: '蔵敷団地', previousStop: '前の停留所',
    stopsAway: 6, observedAt }), '蔵敷団地付近・あと6停留所');
  assert.equal(hub.displayShadowPosition({ supported: true, fidelity: 'stop_sequence',
    state: 'approaching', nextStop: '蔵敷団地', stopsAway: 6, observedAt }),
  '蔵敷団地に接近中・あと6停留所');
  assert.equal(hub.displayShadowPosition({ supported: true, fidelity: 'stop_sequence',
    state: 'near_stop', nextStop: '蔵敷団地', stopsAway: 6, observedAt: observedAt - 121 }),
  '位置確認中');
});

test('origin schedule and platform remain visible without vehicle evidence or turnaround', () => {
  const row = arrival({ provider: 'kawasaki', routeLabel: '溝17', isOrigin: true,
    originStop: { id: '434_2', name: '溝の口駅南口' }, platform: '2番',
    originNotice: 'vehicle_unconfirmed' });
  const shown = renderedText(hub.renderArrivalList(fakeDocument(),
    { arrivals: [row], recommendedArrivalId: null }, 'mizonokuchi-minamiguchi', true));
  assert.match(shown, /2番のりば.*07:05便.*始発予定・車両未確認/s);
  assert.match(shown, /位置確認中/);
  const candidate = renderedText(hub.renderArrivalList(fakeDocument(),
    { arrivals: [{ ...row, originNotice: 'turnaround_candidate' }], recommendedArrivalId: null },
    'mizonokuchi-minamiguchi', true));
  assert.match(candidate, /折返し候補/);
});

test('Tamagawa exit badge remains conspicuous without changing destination or platform', () => {
  const row = arrival({ provider: 'kawasaki', routeLabel: '登０６', destination: '鷲ヶ峰営業所前',
    platform: '多摩川口2番のりば', areaBadge: '多摩川口' });
  const nodes = descendants(hub.renderArrivalList(fakeDocument(),
    { arrivals: [row], recommendedArrivalId: null }, 'noborito-eki'));
  assert.equal(nodes.filter((node) => node.className === 'bus-hub-area-badge').length, 1);
  assert.match(nodes.map((node) => node.textContent).join(''), /多摩川口.*鷲ヶ峰営業所前/);
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
  assert.deepEqual(shown, { time: '07:05', timeSuffix: '便', note: '時刻表のみ', kind: 'static', delay: '' });
  assert.doesNotMatch(`${shown.time}${shown.note}${shown.delay}`, /あと|リアルタイム|遅れ/);
  assert.throws(() => hub.validate(fixture(arrival({ etaMinutes: 5 }))), /BUS_HUB_STATIC_AS_REALTIME/);
  assert.throws(() => hub.validate(fixture(arrival({ estimatedDeparture: NOW + 360 }))), /BUS_HUB_STATIC_AS_REALTIME/);
  assert.throws(() => hub.validate(fixture(arrival({ delayMinutes: 3 }))), /BUS_HUB_STATIC_AS_REALTIME/);
});

test('Hub scheduled time suffix is independent of provider and realtime quality', () => {
  for (const changes of [
    { provider: 'tokyu', realtimeState: 'static_only' },
    { provider: 'kawasaki', realtimeState: 'static_fallback' },
    { provider: 'kawasaki', realtimeState: 'realtime', etaMinutes: 4, delayMinutes: 7 },
    { provider: 'kawasaki', realtimeState: 'realtime_stale' }
  ]) {
    assert.equal(hub.displayArrival(arrival(changes)).timeSuffix, '便');
  }
  assert.equal(hub.displayArrival(arrival({ provider: 'tokyu', realtimeState: 'static_only' })).note, '時刻表のみ');
  assert.equal(hub.displayArrival(arrival({ provider: 'kawasaki', realtimeState: 'static_fallback' })).note,
    'リアルタイム予測なし');
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
  assert.match(source, /PALURU_BUS_POSITION_SHADOW_ENABLED === true/);
  assert.doesNotMatch(source, /latitude|longitude/);
});

test('Static origin badge is limited to Shinki Honcho boarding rows and coexists with overdue state', () => {
  const originRow = arrival({ provider: 'kawasaki', routeLabel: '溝１７', destination: '溝口駅南口',
    originStop: { id: '184_1', name: '神木本町' }, isOrigin: true,
    departureState: 'departure_overdue', realtimeState: 'static_fallback' });
  const origin = renderOriginBadge(originRow);
  assert.equal(origin.nodes.filter((node) => node.className === 'bus-hub-origin-badge').length, 1);
  assert.match(renderedText(origin.list), /始発/);
  assert.match(renderedText(origin.list), /遅延中・発車未確認/);

  const cases = [
    { label: 'mid-route Shinki Honcho row', row: { ...originRow, isOrigin: false }, hubId: 'kibukihoncho' },
    { label: 'Noborito origin', row: { ...originRow, originStop: { id: '362_1', name: '登戸駅' } }, hubId: 'noborito-eki' },
    { label: 'Mizonokuchi origin', row: { ...originRow, originStop: { id: '434_2', name: '溝口駅南口' } },
      hubId: 'mizonokuchi-minamiguchi' },
    { label: 'Shinki origin in another Hub', row: originRow, hubId: 'showa-daiichi-gakuen' }
  ];
  for (const value of cases) {
    const rendered = renderOriginBadge(value.row, value.hubId);
    assert.equal(rendered.nodes.filter((node) => node.className === 'bus-hub-origin-badge').length, 0, value.label);
  }
});

test('Hub response accepts only boolean Static origin metadata', () => {
  assert.equal(hub.validate(fixture(arrival({ isOrigin: true }))).decisionGroups[0].arrivals[0].isOrigin, true);
  assert.throws(() => hub.validate(fixture(arrival({ isOrigin: 'true' }))), /BUS_HUB_RESPONSE_INVALID/);
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
  assert.match(source, /\/のりば\$\/\.test\(row\.platform\)/);
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
  assert.match(css, /\.bus-hub-row\.is-recommended \{[^}]*width: calc\(100% \+ 16px\)[^}]*max-width: none[^}]*margin: 0 -8px[^}]*padding: 10px 8px/s);
  assert.match(css, /\.bus-hub-time-suffix \{[^}]*font-size: 0\.6em[^}]*vertical-align: baseline/s);
  assert.match(css, /\.bus-hub-row\.is-static \.bus-hub-quality,[\s\S]*grid-column: 3;[\s\S]*justify-self: end;/);
  assert.match(css, /\.bus-hub-row\.is-fallback \.bus-hub-quality/);
  assert.match(css, /\.bus-hub-row\.is-stale \.bus-hub-quality/);

  assert.match(css, /\.bus-hub-provider\.is-kawasaki \.bus-hub-provider-icon \{ color: #1f6fb2; \}/);
  assert.match(css, /\.bus-hub-provider\.is-tokyu \.bus-hub-provider-icon \{ color: #c62828; \}/);
  assert.match(css, /\.bus-hub-provider\.is-seibu \.bus-hub-provider-icon \{ color: #238636; \}/);
});

test('local P2.5 selector integrates Journey as a fifth tab in a balanced three-plus-two grid', () => {
  const source = fs.readFileSync(require.resolve('../features/bus/hub.js'), 'utf8');
  const css = fs.readFileSync(require.resolve('../features/bus/hub.css'), 'utf8');
  const local = fs.readFileSync(require.resolve('../bus/scripts/local-ui.js'), 'utf8');
  const specs = hub.configuredHubs({ PALURU_BUS_HUBS: [
    { id: 'kibukihoncho', label: '神木本町' },
    { id: 'mizonokuchi-minamiguchi', label: '溝の口駅南口' },
    { id: 'tachikawa-ekikitaguchi', label: '立川駅北口' },
    { id: 'showa-daiichi-gakuen', label: '昭和第一学園' },
    { id: 'noborito-mukougaoka', label: '登戸・遊園', kind: 'journey' }
  ] });
  assert.equal(specs.length, 5);
  assert.equal(specs[4].kind, 'journey');
  assert.match(source, /PALURUBusJourney\?\.createJourneyController/);
  assert.match(source, /classList\.toggle\('has-five', specs\.length === 5\)/);
  assert.match(css, /\.bus-hub-selector\.has-five \{[^}]*grid-template-columns: repeat\(6, minmax\(0, 1fr\)\)/s);
  assert.match(css, /\.bus-hub-selector\.has-five > \.bus-hub-selector-button \{ grid-column: span 2; \}/);
  assert.match(css, /\.bus-hub-selector\.has-five > \.bus-hub-selector-button:nth-child\(n \+ 4\) \{ grid-column: span 3; \}/);
  assert.match(local, /label:'登戸・遊園',selectorLabel:'登戸・遊園',kind:'journey'/);
  assert.doesNotMatch(local, /登戸・遊園連合/);
});

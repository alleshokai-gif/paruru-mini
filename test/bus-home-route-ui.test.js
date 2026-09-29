const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ui = require('../features/bus/home-route.js');

const epoch = (time) => Date.parse(`2026-09-28T${time}:00+09:00`) / 1000;
function fakeDocument() {
  return { createElement(tagName) { return { tagName, children: [], listeners: {},
    append(...children) { this.children.push(...children); },
    addEventListener(name, callback) { this.listeners[name] = callback; },
    replaceChildren(...children) { this.children = children; } }; } };
}
const renderedText = (node) => [node.textContent || '', ...(node.children || []).flatMap(renderedText)].join(' ');

test('train choice uses an explicit accessible dropdown rather than GPS inference', () => {
  const doc = fakeDocument(), mount = doc.createElement('div'), selected = [];
  ui.renderTrainChoices(doc, mount, [{ id: 'train-a', label: 'この電車 18:18 登戸着' }],
    (id) => selected.push(id));
  const select = mount.children[0].children[0];
  assert.equal(mount.children[0].tagName, 'label');
  assert.equal(select.tagName, 'select');
  assert.equal(select.children[1].value, 'train-a');
  select.value = 'train-a';
  select.listeners.change();
  assert.deepEqual(selected, ['train-a']);
  const css = fs.readFileSync(require.resolve('../features/bus/home-route.css'), 'utf8');
  assert.match(css, /min-height: 48px/);
  assert.match(css, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.bus-home-route-toggle\s*\{[^}]*text-align: center;/);
  const config = fs.readFileSync(require.resolve('../features/bus/config.js'), 'utf8');
  assert.match(config, /PALURU_BUS_HOME_ROUTE_ENABLED\s*=\s*true/);
  assert.match(config, /\/api\/bus\/trains/);
  assert.match(config, /\/api\/bus\/home-route/);
});

test('user rail choices show source departure and both comparison arrivals with paging', () => {
  const doc = fakeDocument(), mount = doc.createElement('div');
  const selected = [], pages = [];
  ui.renderTrainChoices(doc, mount, [{ id: 'rail-1',
    label: '18:00 玉川学園前発・各駅停車・向ヶ丘遊園18:18着／登戸18:21着',
    sourceStation: '玉川学園前', sourceDeparture: '18:00', trainType: '各駅停車',
    candidateStations: [{ label: '向ヶ丘遊園', stationTime: '18:18', stationTimeSource: 'arrival' },
      { label: '登戸', stationTime: '18:21', stationTimeSource: 'arrival' }] }], (id) => selected.push(id),
  { sample: true, hasPrevious: false, hasNext: true, onPage: (delta) => pages.push(delta) });
  const select = mount.children[1].children[0];
  assert.match(select.children[1].textContent, /玉川学園前 18:00発.*向ヶ丘遊園 18:18着.*登戸 18:21着/);
  select.value = 'rail-1'; select.listeners.change();
  assert.deepEqual(selected, ['rail-1']);
  assert.match(renderedText(mount), /玉川学園前 18:00発.*向ヶ丘遊園 18:18着.*登戸 18:21着/s);
  assert.match(renderedText(mount), /架空列車時刻/);
  mount.children[3].children[1].listeners.click();
  assert.deepEqual(pages, [1]);
});

test('route decision shows station, bus, home arrival and static quality without internal calculation detail', () => {
  const doc = fakeDocument(), mount = doc.createElement('div');
  const option = { stationId: 'mukougaoka', stationLabel: '向ヶ丘遊園駅南口', stationArrivalAt: epoch('18:21'),
    departureAt: epoch('18:27'), provider: 'tokyu', routeLabel: '向０１',
    homeArrivalAt: epoch('18:39'), timingQuality: 'static_only' };
  ui.renderDecision(doc, mount, { status: 'available', fastest: option,
    alternate: { ...option, stationId: 'noborito', stationLabel: '登戸駅', stationArrivalAt: epoch('18:18'),
      departureAt: epoch('18:31'), provider: 'kawasaki', routeLabel: '登０５',
      homeArrivalAt: epoch('18:44'), timingQuality: 'realtime_arrival' },
    differenceMinutes: 5, unavailablePlaces: [] });
  const text = renderedText(mount);
  assert.match(text, /時刻表上の最速候補/);
  assert.match(text, /向ヶ丘遊園で下車.*🚃 向ヶ丘遊園 18:21着.*↓.*🚌 18:27 東急バス 向０１.*乗り場：向ヶ丘遊園駅南口.*↓.*🏠 神木本町 18:39着/s);
  assert.match(text, /登戸で下車.*🚃 登戸 18:18着.*↓.*🚌 18:31 川崎市バス 登０５.*↓.*🏠 神木本町 18:44着/s);
  assert.match(text, /5分差/);
  assert.doesNotMatch(text, /confidence|GPS|lat|lon|sourceId|stationTimeSource|着時刻未提供/);
  const css = fs.readFileSync(require.resolve('../features/bus/home-route.css'), 'utf8');
  assert.match(css, /\.bus-home-route-station\s*\{[^}]*border-radius: 999px/);
  assert.match(css, /\.bus-home-route-option\.is-primary \.bus-home-route-station\s*\{[^}]*font-size: 21px/);
});

test('JR train choice presents station times as arrivals while preserving departure metadata', () => {
  const doc = fakeDocument(), choice = doc.createElement('div'), result = doc.createElement('div');
  const train = { id: 'jr-4554f',
    label: '15:54 立川発・快速・登戸16:15発／武蔵溝ノ口16:21発',
    sourceStation: '立川', sourceDeparture: '15:54', trainType: '快速',
    railRealtimeState: 'confirmed_delay', delaySeconds: 120,
    candidateStations: [{ label: '登戸', stationTime: '16:15', stationTimeSource: 'departure' },
      { label: '武蔵溝ノ口', stationTime: '16:21', stationTimeSource: 'departure' }] };
  ui.renderTrainChoices(doc, choice, [train], () => {});
  assert.match(choice.children[0].children[0].children[1].textContent,
    /立川 15:54発.*登戸 16:15着.*武蔵溝ノ口 16:21着/);
  choice.children[0].children[0].value = 'jr-4554f';
  choice.children[0].children[0].listeners.change();
  assert.match(renderedText(choice), /登戸 16:15着/);
  assert.match(renderedText(choice), /武蔵溝ノ口 16:21着/);
  assert.match(renderedText(choice), /列車遅延 \+2分・遅延に基づく見込み/);
  assert.doesNotMatch(renderedText(choice), /着時刻未提供|stationTimeSource/);
  assert.equal(train.candidateStations[0].stationTimeSource, 'departure');
  const option = { stationId: 'noborito', stationLabel: '登戸駅', stationTimeAt: epoch('16:17'),
    stationTimeSource: 'departure', railTimingQuality: 'delay_projection',
    departureAt: epoch('16:30'), provider: 'kawasaki', routeLabel: '登０５',
    homeArrivalAt: epoch('16:44'), timingQuality: 'static_only' };
  ui.renderDecision(doc, result, { status: 'available', fastest: option,
    alternate: null, differenceMinutes: null, unavailablePlaces: [] });
  assert.match(renderedText(result), /登戸で下車.*🚃 登戸 16:17着・遅延に基づく見込み/s);
  assert.doesNotMatch(renderedText(result), /着時刻未提供|stationTimeSource/);
  assert.equal(option.stationTimeSource, 'departure');
});

test('Musashi-Mizonokuchi decision keeps its rail station distinct from the bus stop', () => {
  const doc = fakeDocument(), mount = doc.createElement('div');
  ui.renderDecision(doc, mount, { status: 'available', fastest: {
    placeId: 'mizonokuchi', stationId: 'musashi_mizonokuchi', stationLabel: '溝の口駅南口',
    stationTimeAt: epoch('13:04'), stationTimeSource: 'departure',
    departureAt: epoch('13:10'), provider: 'kawasaki', routeLabel: '溝１８',
    homeArrivalAt: epoch('13:17'), timingQuality: 'static_only'
  }, alternate: null, differenceMinutes: null, unavailablePlaces: [] });
  const text = renderedText(mount);
  assert.match(text, /武蔵溝ノ口で下車.*🚃 武蔵溝ノ口 13:04着.*↓.*🚶 溝の口駅南口へ移動.*↓.*🚌 13:10 川崎市バス 溝１８.*乗り場：溝の口駅南口.*↓.*🏠 神木本町 13:17着/s);
});

test('Tamagawa route keeps Noborito as the rail station and highlights the separate walk', () => {
  const doc = fakeDocument(), mount = doc.createElement('div');
  ui.renderDecision(doc, mount, { status: 'available', fastest: {
    placeId: 'noborito-tamagawa', stationId: 'noborito', stationLabel: '登戸駅多摩川口',
    stationTimeAt: epoch('12:35'), stationTimeSource: 'departure',
    departureAt: epoch('12:48'), provider: 'kawasaki', routeLabel: '登０６',
    homeArrivalAt: epoch('12:59'), timingQuality: 'static_only'
  }, alternate: null, differenceMinutes: null, unavailablePlaces: [] });
  const text = renderedText(mount);
  assert.match(text, /登戸で下車.*多摩川口.*🚃 登戸 12:35着.*↓.*🚶 多摩川口側へ移動.*↓.*🚌 12:48 川崎市バス 登０６.*🏠 神木本町 12:59着/s);
  assert.doesNotMatch(text, /🚃 登戸駅多摩川口/);
});

test('partial source failure is visible even when its station still has buses', () => {
  const doc = fakeDocument(), mount = doc.createElement('div');
  ui.renderDecision(doc, mount, { status: 'partial', fastest: null, alternate: null,
    unavailablePlaces: [], unavailableSources: ['tokyu:mukougaoka_to_kibukihoncho'] });
  assert.match(renderedText(mount), /一部の経路情報を取得できませんでした/);
});

test('home route selects the related normal Bus location only from an exact station ID', () => {
  assert.equal(ui.hubForJourney('university'), 'noborito-mukougaoka');
  assert.equal(ui.hubForJourney('high_school', { fastest: { stationId: 'musashi_mizonokuchi' } }),
    'mizonokuchi-minamiguchi');
  assert.equal(ui.hubForJourney('high_school', { fastest: { stationId: 'noborito' } }),
    'noborito-mukougaoka');
  assert.equal(ui.hubForJourney('high_school', { fastest: { stationLabel: '溝の口駅南口' } }), null);
  assert.equal(ui.hubForJourney('high_school', { fastest: null }), null);
});

test('PALURU Bus view mounts the accepted manual train selector with a production source', () => {
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  const app = fs.readFileSync(require.resolve('../app.js'), 'utf8');
  const sw = fs.readFileSync(require.resolve('../sw.js'), 'utf8');
  const config = fs.readFileSync(require.resolve('../features/bus/config.js'), 'utf8');
  const hub = fs.readFileSync(require.resolve('../features/bus/hub.js'), 'utf8');
  const preview = fs.readFileSync(require.resolve('../bus/scripts/preview-product-acceptance.js'), 'utf8');
  assert.match(html, /id="busHomeRouteMount"[^>]*hidden/);
  assert.match(html, /features\/bus\/home-route\.js/);
  assert.match(html, /features\/bus\/home-route\.css/);
  assert.match(app, /PALURUBusHomeRoute\?\.setActive\(resolvedView === "bus"\)/);
  assert.match(sw, /versioned\("features\/bus\/home-route\.js"\)/);
  assert.match(sw, /versioned\("features\/bus\/home-route\.css"\)/);
  assert.match(config, /PALURU_BUS_HOME_ROUTE_ENABLED\s*=\s*true/);
  assert.match(config, /PALURU_BUS_POSITION_SHADOW_ENABLED\s*=\s*true/);
  assert.match(hub, /replaceChildren\(rootHeading,.*homeRoute.*locations\)/);
  assert.match(preview, /window\.PALURUBusHomeRoute\?\.setActive\(true\)/);
  assert.doesNotMatch(preview, /nav\.innerHTML/);
});

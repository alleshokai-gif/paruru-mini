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
  assert.match(config, /PALURU_BUS_HOME_ROUTE_ENABLED\s*=\s*false/);
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
  assert.match(select.children[1].textContent, /18:00 玉川学園前発.*向ヶ丘遊園18:18着.*登戸18:21着/);
  select.value = 'rail-1'; select.listeners.change();
  assert.deepEqual(selected, ['rail-1']);
  assert.match(renderedText(mount), /玉川学園前 18:00発.*向ヶ丘遊園 18:18着.*登戸 18:21着/s);
  assert.match(renderedText(mount), /架空列車時刻/);
  mount.children[3].children[1].listeners.click();
  assert.deepEqual(pages, [1]);
});

test('route decision shows station, bus, home arrival and static quality without internal calculation detail', () => {
  const doc = fakeDocument(), mount = doc.createElement('div');
  const option = { stationLabel: '向ヶ丘遊園駅南口', stationArrivalAt: epoch('18:21'),
    departureAt: epoch('18:27'), provider: 'tokyu', routeLabel: '向０１',
    homeArrivalAt: epoch('18:39'), timingQuality: 'static_only' };
  ui.renderDecision(doc, mount, { status: 'available', fastest: option,
    alternate: { ...option, stationLabel: '登戸駅', stationArrivalAt: epoch('18:18'),
      departureAt: epoch('18:31'), provider: 'kawasaki', routeLabel: '登０５',
      homeArrivalAt: epoch('18:44'), timingQuality: 'realtime_arrival' },
    differenceMinutes: 5, unavailablePlaces: [] });
  const text = renderedText(mount);
  assert.match(text, /時刻表上の最速候補/);
  assert.match(text, /向ヶ丘遊園駅南口.*18:21.*18:27.*向０１.*18:39/s);
  assert.match(text, /登戸駅.*18:18.*登０５.*18:44/s);
  assert.match(text, /5分差/);
  assert.doesNotMatch(text, /confidence|GPS|lat|lon|sourceId/);
});

test('JR train choice and route result identify departure markers and confirmed delay', () => {
  const doc = fakeDocument(), choice = doc.createElement('div'), result = doc.createElement('div');
  ui.renderTrainChoices(doc, choice, [{ id: 'jr-4554f',
    label: '15:54 立川発・快速・登戸16:15発／武蔵溝ノ口16:21発',
    sourceStation: '立川', sourceDeparture: '15:54', trainType: '快速',
    railRealtimeState: 'confirmed_delay', delaySeconds: 120,
    candidateStations: [{ label: '登戸', stationTime: '16:15', stationTimeSource: 'departure' },
      { label: '武蔵溝ノ口', stationTime: '16:21', stationTimeSource: 'departure' }] }], () => {});
  choice.children[0].children[0].value = 'jr-4554f';
  choice.children[0].children[0].listeners.change();
  assert.match(renderedText(choice), /登戸 16:15発（着時刻未提供）/);
  assert.match(renderedText(choice), /列車遅延 \+2分・遅延に基づく見込み/);
  const option = { stationLabel: '登戸駅', stationTimeAt: epoch('16:17'),
    stationTimeSource: 'departure', railTimingQuality: 'delay_projection',
    departureAt: epoch('16:30'), provider: 'kawasaki', routeLabel: '登０５',
    homeArrivalAt: epoch('16:44'), timingQuality: 'static_only' };
  ui.renderDecision(doc, result, { status: 'available', fastest: option,
    alternate: null, differenceMinutes: null, unavailablePlaces: [] });
  assert.match(renderedText(result), /列車 16:17発（着時刻未提供）・遅延に基づく見込み/);
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

test('PALURU Bus view mounts manual train selection behind the disabled production gate', () => {
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
  assert.match(config, /PALURU_BUS_HOME_ROUTE_ENABLED\s*=\s*false/);
  assert.match(config, /PALURU_BUS_POSITION_SHADOW_ENABLED\s*=\s*true/);
  assert.match(hub, /replaceChildren\(rootHeading,.*homeRoute.*locations\)/);
  assert.match(preview, /window\.PALURUBusHomeRoute\?\.setActive\(true\)/);
  assert.doesNotMatch(preview, /nav\.innerHTML/);
});

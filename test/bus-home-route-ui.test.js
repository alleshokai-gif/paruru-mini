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
  const config = fs.readFileSync(require.resolve('../features/bus/config.js'), 'utf8');
  assert.match(config, /PALURU_BUS_HOME_ROUTE_ENABLED\s*=\s*false/);
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

test('partial source failure is visible even when its station still has buses', () => {
  const doc = fakeDocument(), mount = doc.createElement('div');
  ui.renderDecision(doc, mount, { status: 'partial', fastest: null, alternate: null,
    unavailablePlaces: [], unavailableSources: ['tokyu:mukougaoka_to_kibukihoncho'] });
  assert.match(renderedText(mount), /一部の経路情報を取得できませんでした/);
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

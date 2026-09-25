'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const index = read('index.html');
const app = read('app.js');
const style = read('style.css');
const sw = read('sw.js');
const build = read('build.js');
const configSource = read('features/navigation/config.js');

class FakeElement {
  constructor(tag) {
    this.tagName = tag;
    this.dataset = {};
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.className = '';
    this.textContent = '';
  }
  append(...children) { this.children.push(...children); }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  click() { this.listeners.click?.({}); }
}

const launcher = new FakeElement('div');
const menu = new FakeElement('nav');
const documentEvents = [];
const document = {
  readyState: 'complete',
  getElementById(id) { return id === 'homeFeatureLauncher' ? launcher : id === 'drawerFeatureMenu' ? menu : null; },
  createElement(tag) { return new FakeElement(tag); },
  addEventListener() {},
  dispatchEvent(event) { documentEvents.push(event); },
};
const context = { document, URL, URLSearchParams, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } } };
context.globalThis = context;
vm.runInNewContext(configSource, context, { filename: 'features/navigation/config.js' });

const config = context.PALURU_NAVIGATION_CONFIG;
const byId = id => config.find(item => item.id === id);
const launcherItems = launcher.children;
const drawerButtons = menu.children.flatMap(section => section.children || []);
const drawerMemo = drawerButtons.find(item => item.dataset.navigationId === 'memo');
const drawerInfection = drawerButtons.find(item => item.dataset.navigationId === 'infection');
const homeMemo = launcherItems.find(item => item.dataset.navigationId === 'infection');

assert.equal(launcherItems.length, 4, 'home launcher should remain compact');
assert(!launcherItems.some(item => item.dataset.navigationId === 'today'), 'Home launcher should not duplicate Today summary');
assert(launcherItems.some(item => item.dataset.navigationId === 'bus'), 'Bus shortcut missing');
assert(launcherItems.some(item => item.dataset.navigationId === 'nurse'), 'Nurse Okan shortcut missing');
assert(launcherItems.some(item => item.dataset.navigationId === 'popio'), 'Popio shortcut missing');
assert(!launcherItems.some(item => ['home', 'inbox', 'settings', 'memo'].includes(item.dataset.navigationId)), 'launcher duplicated primary navigation or exposed memo composer');
assert(drawerMemo && drawerMemo.dataset.targetView === 'home' && drawerMemo.dataset.openHomeMemo === 'true', 'memo is not preserved as a drawer action');
assert(drawerInfection?.className.includes('is-external') && drawerInfection.attributes['aria-label'].includes('外部サイト') && drawerInfection.children.length === 2, 'external destination must remain accessible without a right-side arrow');
assert(drawerButtons.filter(item => item.className === 'drawer-menu-item').every(item => item.children.length === 2), 'drawer items must contain only icon and title');
assert(!drawerButtons.some(item => item.dataset.navigationId === 'home') && drawerButtons.at(-2)?.dataset.navigationId === 'memo', 'drawer must not duplicate Home and must keep memo under Other');
assert(!index.includes('id="infectionWatchCard"'), 'infection summary card remains in Home');
assert(!index.includes('features/infection-watch/card.js'), 'infection card script remains loaded');
assert(!app.includes('PALURUInfectionWatchCard') && !app.includes('infection-watch-api-poc'), 'PALURU still initializes or fetches the Public infection API');
assert(!style.includes('.infection-watch-card'), 'card-only CSS remains');
assert(!sw.includes('features/infection-watch/card.js') && sw.includes('versioned("features/navigation/config.js")'), 'service worker asset list is stale');
assert(index.includes('id="inboxForm"') && !index.includes('homeMemoDetails'), 'memo should be a direct compact composer without expansion');
assert(!index.includes('id="homeMemoOpenButton"') && !index.includes('よく使う機能'), 'Home contains an oversized memo entry or duplicate launcher heading');
assert(!index.includes('homeMemoQuickInput') && !index.includes('homeMemoQuickOpen') && index.includes('rows="3"'), 'memo must be directly editable in a compact textarea');
assert(index.includes('paw-menu.svg') && index.includes('paw-close.svg') && !index.includes('>☰</button>') && index.includes('paruru_bust.png'), 'paw controls or PALURU bust asset are missing');
assert(index.includes('class="app-topbar"') && index.includes('class="home-wordmark"'), 'shared navigation header is missing');
assert(!app.includes('openHomeMemoFromQuick_'), 'obsolete quick-to-expanded memo flow remains');
assert(index.includes('type="hidden" name="priority" value=""') && index.includes('id="category" name="category" type="hidden" value=""'), 'category/priority should default to AI without visible controls');
assert(app.includes('const hasVisibleItem = Array.from(section.querySelectorAll(".drawer-menu-item"))'), 'permission-filtered drawer sections remain visible when empty');
assert(app.includes('function getViewNavigationItems_()') && app.includes('item.dataset.visibilityView || item.dataset.targetView'), 'rendered navigation is not filtered using current membership views');
assert(index.includes('id="drawerFeatureMenu"') && index.includes('id="homeFeatureLauncher"'), 'navigation mount points missing');
const htmlIds = [...index.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert.equal(new Set(htmlIds).size, htmlIds.length, 'duplicate HTML IDs introduced');
assert.equal(new Set(config.map(item => item.id)).size, config.length, 'navigation config has duplicate item IDs');
assert(index.includes('data-target-view="home"') && index.includes('data-target-view="inbox"') && index.includes('data-target-view="settings"'), 'bottom navigation contract changed');
assert(index.includes('data-target-view="inbox">Inbox</button>') && index.includes('<h1>Inbox</h1>') && !index.includes('受信箱') && byId('inbox').label === 'Inbox', 'Inbox label is inconsistent');
assert(!byId('today') && byId('kaz-os').page === 'today', 'Today duplication or Kaz OS entry is incorrect');

const infection = byId('infection');
assert(infection?.external && infection.href === 'https://kawasaki-infection-watch.pages.dev/?disease=influenza&ward=%E5%AE%AE%E5%89%8D%E5%8C%BA&district=%E5%AE%AE%E5%89%8D%E5%8C%BA%3A%E5%90%91%E4%B8%98%E5%9C%B0%E5%8C%BA', 'infection link must contain only the approved public filters');
assert(homeMemo?.target === '_blank' && homeMemo.rel.includes('noopener'), 'launcher external link isolation missing');
assert(!/[?&](?:schoolDate|address|family|userId|token)=/i.test(infection.href), 'infection URL contains a prohibited parameter');
assert.equal(config.filter(item => item.home).length, 4, 'home launcher must use only configured frequent features');
assert(config.every(item => item.menu), 'a real configured app feature is missing from the hamburger menu');
assert(config.every(item => item.label && item.view || item.external), 'navigation config has an unlabeled or unrouted feature');

const nurseAction = launcherItems.find(item => item.dataset.navigationId === 'nurse');
nurseAction.click();
assert.equal(documentEvents.at(-1).type, 'paruru:view-request');
assert.deepEqual(JSON.parse(JSON.stringify(documentEvents.at(-1).detail)), { viewName: 'nurse-okan', anchorId: '', openMemo: false, navigationId: 'nurse' });
assert(app.includes('detail.openMemo') && app.includes('homeMemoDetails) homeMemoDetails.open = true'), 'drawer memo action does not open the preserved form');
assert(configSource.includes('kazPageLaunch') && app.includes('setCurrentNavigation_') && app.includes('aria-current'), 'current location highlighting contract missing');

assert(style.includes('grid-template-columns: repeat(2, minmax(0, 1fr))') && style.includes('grid-template-columns: 32px minmax(0, 1fr)'), 'home launcher is not a two-column compact horizontal tile grid');
assert(style.includes('height: 72px') && style.includes('.drawer-menu-item:focus-visible'), 'compact tile or keyboard focus styling missing');
assert(style.includes('width: min(90vw, 360px)') && style.includes('body.drawer-open') && style.includes('.home-memo-details:not([open])'), 'drawer width, scroll lock, or memo presentation regressed');
assert(style.includes('overflow-x: clip'), 'mobile horizontal overflow guard missing');
assert(app.includes('Build: ${globalThis.BUILD_ID}'), 'Build ID display is missing');
const buildId = build.match(/BUILD_ID\s*=\s*"([^"]+)"/)?.[1];
assert(buildId === 'v20260925-navigation-final-v7', 'Build ID not updated for the navigation/SW change');
assert(sw.includes(`importScripts("./build.js?v=${buildId}")`), 'Service Worker still uses an old Build ID');
assert(sw.includes('versioned("assets/icons/paw-menu.svg")') && sw.includes('versioned("assets/icons/paw-close.svg")'), 'paw assets are missing from offline cache');
assert(index.includes(`./style.css?v=${buildId}`) && index.includes(`./features/navigation/config.js?v=${buildId}`), 'updated UI assets are not versioned consistently');

console.log('PASS home navigation redesign, infection link/menu, memo preservation, Build ID, and service-worker asset contract');

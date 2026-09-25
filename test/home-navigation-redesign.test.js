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
assert(launcherItems.some(item => item.dataset.navigationId === 'today'), 'today summary shortcut missing');
assert(launcherItems.some(item => item.dataset.navigationId === 'bus'), 'Bus shortcut missing');
assert(launcherItems.some(item => item.dataset.navigationId === 'popio'), 'Popio shortcut missing');
assert(!launcherItems.some(item => ['home', 'inbox', 'settings', 'memo'].includes(item.dataset.navigationId)), 'launcher duplicated primary navigation or exposed memo composer');
assert(drawerMemo && drawerMemo.dataset.targetView === 'home' && drawerMemo.dataset.openHomeMemo === 'true', 'memo is not preserved as a drawer action');
assert(drawerInfection?.className.includes('is-external') && drawerInfection.children.some(item => item.className === 'external-link-marker'), 'external destination is not visibly marked in the drawer');
assert(!index.includes('id="infectionWatchCard"'), 'infection summary card remains in Home');
assert(!index.includes('features/infection-watch/card.js'), 'infection card script remains loaded');
assert(!app.includes('PALURUInfectionWatchCard') && !app.includes('infection-watch-api-poc'), 'PALURU still initializes or fetches the Public infection API');
assert(!style.includes('.infection-watch-card'), 'card-only CSS remains');
assert(!sw.includes('features/infection-watch/card.js') && sw.includes('versioned("features/navigation/config.js")'), 'service worker asset list is stale');
assert(index.includes('<details id="homeMemoDetails"') && index.includes('<form id="inboxForm"'), 'existing memo form was not preserved behind a collapsed details section');
assert(index.includes('id="homeMemoOpenButton"') && app.includes('homeMemoDetails.open = true'), 'Home Agent / memo quick action was lost');
assert(index.includes('id="drawerFeatureMenu"') && index.includes('id="homeFeatureLauncher"'), 'navigation mount points missing');
const htmlIds = [...index.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert.equal(new Set(htmlIds).size, htmlIds.length, 'duplicate HTML IDs introduced');
assert.equal(new Set(config.map(item => item.id)).size, config.length, 'navigation config has duplicate item IDs');
assert(index.includes('data-target-view="home"') && index.includes('data-target-view="inbox"') && index.includes('data-target-view="settings"'), 'bottom navigation contract changed');

const infection = byId('infection');
assert(infection?.external && infection.href === 'https://kawasaki-infection-watch.pages.dev/?disease=influenza&ward=%E5%AE%AE%E5%89%8D%E5%8C%BA&district=%E5%AE%AE%E5%89%8D%E5%8C%BA%3A%E5%90%91%E4%B8%98%E5%9C%B0%E5%8C%BA', 'infection link must contain only the approved public filters');
assert(homeMemo?.target === '_blank' && homeMemo.rel.includes('noopener'), 'launcher external link isolation missing');
assert(!/[?&](?:schoolDate|address|family|userId|token)=/i.test(infection.href), 'infection URL contains a prohibited parameter');
assert.equal(config.filter(item => item.home).length, 4, 'home launcher must use only configured frequent features');
assert(config.every(item => item.menu), 'a real configured app feature is missing from the hamburger menu');
assert(config.every(item => item.label && item.view || item.external), 'navigation config has an unlabeled or unrouted feature');

const memoAction = launcherItems.find(item => item.dataset.navigationId === 'today');
memoAction.click();
assert.equal(documentEvents.at(-1).type, 'paruru:view-request');
assert.deepEqual(JSON.parse(JSON.stringify(documentEvents.at(-1).detail)), { viewName: 'home', anchorId: 'todayParuru', openMemo: false, navigationId: 'today' });
assert(app.includes('detail.openMemo') && app.includes('homeMemoDetails) homeMemoDetails.open = true'), 'drawer memo action does not open the preserved form');
assert(configSource.includes('kazPageLaunch') && app.includes('setCurrentNavigation_') && app.includes('aria-current'), 'current location highlighting contract missing');

assert(style.includes('grid-template-columns: repeat(2, minmax(0, 1fr))'), 'home launcher is not a two-column responsive grid');
assert(style.includes('min-height: 72px') && style.includes('.drawer-menu-item:focus-visible'), 'touch target or keyboard focus styling missing');
assert(style.includes('overflow-x: clip'), 'mobile horizontal overflow guard missing');
assert(app.includes('Build: ${globalThis.BUILD_ID}'), 'Build ID display is missing');
const buildId = build.match(/BUILD_ID\s*=\s*"([^"]+)"/)?.[1];
assert(buildId === 'v20260925-home-menu-redesign-v1', 'Build ID not updated for the navigation/SW change');
assert(sw.includes(`importScripts("./build.js?v=${buildId}")`), 'Service Worker still uses an old Build ID');

console.log('PASS home navigation redesign, infection link/menu, memo preservation, Build ID, and service-worker asset contract');

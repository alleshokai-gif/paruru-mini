'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const configSource = fs.readFileSync(path.join(root, 'features/navigation/config.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

class Element {
  constructor(tag) {
    this.tagName = tag;
    this.className = '';
    this.classList = { contains: name => this.className.split(/\s+/).includes(name) };
    this.dataset = {};
    this.children = [];
    this.hidden = false;
  }
  append(...children) {
    for (const child of children) {
      child.previousElementSibling = this.children.at(-1) || null;
      this.children.push(child);
    }
  }
  setAttribute() {}
  addEventListener() {}
  querySelectorAll(selector) {
    return selector === '.drawer-menu-item' ? this.children.filter(child => child.className.includes('drawer-menu-item')) : [];
  }
}

const launcher = new Element('div');
const menu = new Element('nav');
const document = {
  readyState: 'complete',
  getElementById(id) { return id === 'homeFeatureLauncher' ? launcher : id === 'drawerFeatureMenu' ? menu : null; },
  createElement(tag) { return new Element(tag); },
  addEventListener() {},
  querySelectorAll(selector) {
    if (selector === '[data-target-view], [data-visibility-view]') return [...launcher.children, ...menu.children.flatMap(section => section.children)];
    if (selector === '#drawerFeatureMenu .drawer-menu-section') return menu.children.filter(child => child.className === 'drawer-menu-section');
    return [];
  },
};

const context = { document, URL, URLSearchParams, CustomEvent: class {} };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(configSource, context);

const start = appSource.indexOf('function isViewAllowed_(viewName)');
const end = appSource.indexOf('function normalizeCalendarMemberSelection(value)', start);
assert(start >= 0 && end > start, 'membership visibility functions missing');
context.appAuthenticationState = 'active_member';
context.activeMembershipContext = null;
context.views = [];
context.hasMembershipCapability_ = capability => context.activeMembershipContext.capabilities.includes(capability);
vm.runInContext(appSource.slice(start, end), context);

const navigation = id => document.querySelectorAll('[data-target-view], [data-visibility-view]').filter(item => item.dataset.navigationId === id);
const kazSection = menu.children.find(child => child.className === 'drawer-menu-section' && child.children.some(item => item.dataset.navigationId === 'kaz-today'));
assert(kazSection && kazSection.previousElementSibling?.textContent === 'やること・確認', 'Kaz category fixture missing');

function apply(role, allowedViews, capabilities = ['home.read', 'memo.self.create']) {
  context.activeMembershipContext = { role, allowedViews, capabilities };
  context.applyAllowedViews_();
}

apply('self_record', ['home', 'inbox', 'bus', 'nurse-okan', 'popio-health', 'kaz-os']);
assert(['kaz-today', 'kaz-work', 'kaz-projects', 'kaz-questions'].every(id => navigation(id).every(item => item.hidden)), 'non-admin saw Kaz OS items');
assert(kazSection.hidden && kazSection.previousElementSibling.hidden, 'empty Kaz category remained visible');
assert(navigation('infection').length === 2 && navigation('infection').every(item => !item.hidden), 'available external link was hidden');
assert(launcher.children.length === 4 && launcher.children.every(item => !item.hidden), 'available launcher items were hidden');

apply('admin', ['home', 'inbox', 'bus', 'nurse-okan', 'popio-health', 'settings', 'kaz-os']);
assert(['kaz-today', 'kaz-work', 'kaz-projects', 'kaz-questions'].every(id => navigation(id).every(item => !item.hidden)), 'authorized admin cannot see Kaz OS');
assert(!kazSection.hidden && !kazSection.previousElementSibling.hidden, 'authorized Kaz category remained hidden');

apply('admin', ['home', 'inbox', 'bus', 'nurse-okan', 'popio-health', 'settings']);
assert(navigation('kaz-today').every(item => item.hidden), 'feature-unavailable admin saw Kaz OS');

apply('self_record', ['inbox', 'bus', 'nurse-okan', 'popio-health']);
assert(navigation('infection').every(item => item.hidden) && navigation('today').every(item => item.hidden), 'Home-dependent launcher or external link ignored Home visibility');

apply('self_record', ['home', 'inbox', 'bus', 'nurse-okan', 'popio-health'], ['home.read']);
assert(navigation('memo').every(item => item.hidden), 'memo item ignored existing create capability');
assert(navigation('today').every(item => !item.hidden), 'Home Today was hidden despite read capability');

console.log('PASS shared launcher/drawer visibility uses existing views, admin role, capability, and empty-category rules');

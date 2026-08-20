'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
function between(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert(from >= 0 && to > from, `source boundary missing: ${start}`);
  return source.slice(from, to);
}
function classList() {
  const values = new Set();
  return { toggle: (name, enabled) => enabled ? values.add(name) : values.delete(name), contains: (name) => values.has(name) };
}
function view(name) { return { dataset: { view: name }, hidden: false, classList: classList() }; }
function nav(name) { return { dataset: { targetView: name }, hidden: false, disabled: false, attrs: {}, setAttribute(key, value) { this.attrs[key] = value; }, classList: classList() }; }

const functions = between('async function switchView(viewName)', 'async function loadInbox(options = {})')
  + between('function isViewAllowed_(viewName)', 'function getHomeAgentPairingToken()');
const views = [view('home'), view('inbox'), view('nurse-okan'), view('popio-health'), view('settings')];
const bottom = [nav('home'), nav('inbox'), nav('settings')];
const drawer = [nav('home'), nav('inbox'), nav('nurse-okan'), nav('popio-health'), nav('settings')];
const context = {
  appAuthenticationState: 'active_member',
  activeMembershipContext: { allowedViews: ['home', 'inbox', 'nurse-okan', 'popio-health'] },
  activeView: 'settings', views, navItems: bottom, viewNavigationItems: bottom.concat(drawer),
  showMessage() {}, setParuruState() {}, loadNotificationCandidates: async () => {}, loadInbox: async () => {},
  renderProfileForm() {}, renderHomeControlSettings: async () => {}, document: { dispatchEvent() {} }, Array, String,
};
vm.createContext(context);
vm.runInContext(functions, context);
context.applyAllowedViews_();
assert(views.find((item) => item.dataset.view === 'settings').hidden, 'guardian settings view remained visible');
assert(bottom.find((item) => item.dataset.targetView === 'settings').hidden, 'guardian bottom settings remained visible');
assert(drawer.find((item) => item.dataset.targetView === 'settings').disabled, 'guardian drawer settings remained enabled');
assert(!drawer.find((item) => item.dataset.targetView === 'popio-health').disabled, 'guardian Pet Health view was disabled');

(async () => {
  await context.switchView('settings');
  assert.strictEqual(context.activeView, 'home', 'guardian direct settings route was not normalized');
  await context.switchView('unknown');
  assert.strictEqual(context.activeView, 'home', 'unknown route was not normalized');
  context.activeMembershipContext = { allowedViews: ['home', 'inbox', 'nurse-okan', 'popio-health', 'settings'] };
  context.applyAllowedViews_();
  await context.switchView('settings');
  assert.strictEqual(context.activeView, 'settings', 'admin settings route was rejected');
  assert(!bottom.find((item) => item.dataset.targetView === 'settings').hidden, 'admin settings remained hidden');
  assert(source.includes('calendarSuffix: membershipContext.calendarSuffix'), 'server calendar suffix was not retained in context');
  const saveSource = between('function saveUserProfileFromForm()', 'function isViewAllowed_(viewName)');
  ['userId:', 'displayName:', 'calendarSuffix:', 'defaultCalendar:'].forEach((field) => assert(!saveSource.includes(field), `identity field persisted: ${field}`));
  console.log('PASS PWA allowed views, direct-route normalization, and display-settings persistence boundary');
})().catch((error) => { console.error(error); process.exitCode = 1; });

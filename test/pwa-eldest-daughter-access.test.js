'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function between(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert(from >= 0 && to > from, `source boundary missing: ${start}`);
  return source.slice(from, to);
}
function classList() { const values = new Set(); return { toggle(name, enabled) { if (enabled) values.add(name); else values.delete(name); }, add(name) { values.add(name); }, remove(name) { values.delete(name); }, contains(name) { return values.has(name); } }; }
function nav(name) { return { dataset: { targetView: name }, hidden: false, disabled: false, attrs: {}, setAttribute(key, value) { this.attrs[key] = value; }, classList: classList() }; }
function view(name) { return { dataset: { view: name }, hidden: false, classList: classList() }; }

const allowedViews = ['home', 'inbox', 'popio-health', 'bus'];
const capabilities = ['memo.self.read', 'memo.self.create', 'memo.self.update', 'memo.self.delete', 'pet.health.read', 'pet.health.record'];
const viewNames = ['home', 'inbox', 'nurse-okan', 'popio-health', 'bus', 'settings', 'kaz-os'];
const views = viewNames.map(view);
const navigation = viewNames.map(nav);
const consultOption = { hidden: false };
const hiddenPanels = [];
const context = {
  appAuthenticationState: 'active_member',
  activeMembershipContext: { memberUserId: 'eldest_daughter', role: 'self_record', allowedViews, capabilities },
  viewNavigationItems: navigation,
  views,
  todayParuru: { hidden: false },
  askPaluruButton: { closest: (selector) => selector === '.paluru-action-option' ? consultOption : null },
  familyInboxForm: { hidden: false },
  familyInboxReviewSection: { hidden: false },
  hideCalendarSyncPanel: (target) => hiddenPanels.push(target),
  Array, String,
};
vm.createContext(context);
vm.runInContext(
  between('function canUseHomeControl_()', 'const NURSE_OKAN_HEALTH_ACTIONS')
  + between('function isViewAllowed_(viewName)', 'function getHomeAgentPairingToken()'),
  context
);
context.applyAllowedViews_();
context.applyMembershipCapabilityVisibility_();

for (const name of allowedViews) {
  assert.strictEqual(views.find((item) => item.dataset.view === name).hidden, false, `${name} view hidden`);
  assert.strictEqual(navigation.find((item) => item.dataset.targetView === name).hidden, false, `${name} navigation hidden`);
}
for (const name of ['nurse-okan', 'settings', 'kaz-os']) {
  assert.strictEqual(views.find((item) => item.dataset.view === name).hidden, true, `${name} view visible`);
  assert.strictEqual(navigation.find((item) => item.dataset.targetView === name).disabled, true, `${name} navigation enabled`);
}
assert.strictEqual(context.todayParuru.hidden, true, 'Today/Calendar surface remained visible');
assert.strictEqual(consultOption.hidden, true, 'Home Agent consult surface remained visible');
assert.strictEqual(context.familyInboxForm.hidden, true, 'Family Inbox surface remained visible');
assert.strictEqual(context.familyInboxReviewSection.hidden, true, 'Family Inbox review surface remained visible');
assert.deepStrictEqual(hiddenPanels.sort(), ['detail', 'home']);
assert.strictEqual(context.canUseHomeControl_(), false, 'home control became available');
assert.strictEqual(context.hasMembershipCapability_('memo.self.create'), true, 'memo capability missing');
assert.strictEqual(context.hasMembershipCapability_('pet.health.record'), true, 'Popio capability missing');
assert(html.includes('<option value="eldest_daughter_initial">長女の端末</option>'), 'fixed eldest daughter approval template is missing');
assert(source.includes('if (!hasMembershipCapability_(requiredCapability))'), 'Calendar candidate capability gate is missing');

console.log('PASS eldest daughter PWA views and in-view capability visibility');

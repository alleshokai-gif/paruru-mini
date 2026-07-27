'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const nurseSource = fs.readFileSync(path.join(root, 'features', 'nurse-okan', 'nurse-okan.js'), 'utf8');
function between(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert(from >= 0 && to > from, `source boundary missing: ${start}`);
  return source.slice(from, to);
}

const policyFunctions = between('function isDeveloperPreviewActive_()', '\n\nsetParuruState("loading");');
const context = {
  appAuthenticationState: 'active_member',
  activeMembershipContext: { memberUserId: 'father', role: 'admin', allowedViews: ['home', 'inbox', 'nurse-okan', 'settings'] },
  developerPreviewState: null,
  createHomeControlError: (code) => Object.assign(new Error(code), { code }),
  Object, JSON, String, Boolean, Error,
};
vm.createContext(context);
vm.runInContext(policyFunctions, context);
assert(context.canStartSecondSonDeveloperPreview_(), 'father admin cannot start preview');
context.activeMembershipContext = { memberUserId: 'father', role: 'guardian' };
assert(!context.canStartSecondSonDeveloperPreview_(), 'non-admin father can start preview');
context.activeMembershipContext = { memberUserId: 'second_son', role: 'self_record' };
assert(!context.canStartSecondSonDeveloperPreview_(), 'self-record member can start preview');
context.activeMembershipContext = { memberUserId: 'father', role: 'admin' };
context.developerPreviewState = { fixture: { presentation: { memberUserId: 'second_son', role: 'self_record', allowedViews: ['home', 'inbox', 'nurse-okan'] } } };
assert.strictEqual(context.getPresentationContext_().memberUserId, 'second_son');
assert.throws(() => context.assertDeveloperPreviewNetworkAllowed_(), (error) => error.code === 'DEVELOPER_PREVIEW_NETWORK_DISABLED');
assert.throws(() => context.assertDeveloperPreviewWriteAllowed_(), (error) => error.code === 'DEVELOPER_PREVIEW_READ_ONLY');

assert(source.includes('const SECOND_SON_DEVELOPER_PREVIEW_FIXTURE'), 'fixed second-son fixture missing');
assert(source.includes('developerPreviewState = { fixture: SECOND_SON_DEVELOPER_PREVIEW_FIXTURE'), 'preview state is not memory-only');
assert(!between('function startSecondSonDeveloperPreview_()', 'async function exitDeveloperPreview_').includes('localStorage'), 'preview start writes localStorage');
assert(source.includes('activeMembershipContext?.memberUserId === "father"') && source.includes('activeMembershipContext?.role === "admin"'), 'preview authorization trusts something other than father/admin context');
assert(source.includes('return !isDeveloperPreviewActive_()') && source.includes('function canUseHomeControl_()'), 'home control remains enabled in preview');
assert(source.includes('if (isDeveloperPreviewActive_()) {\n    inboxItems = cloneDeveloperPreviewFixture_'), 'Inbox does not render fixture first');
assert(source.includes('if (isDeveloperPreviewActive_()) {\n    const items = cloneDeveloperPreviewFixture_'), 'notification does not render fixture first');
['savePaluruMemo', 'saveMemo', 'callHomeAgent', 'callAgentChat', 'executeHomeAgentAction', 'executeAgentActionConfirmation', 'cancelAgentActionConfirmation', 'callHomeControlApi', 'fetchInboxItems', 'fetchNotificationCandidates', 'fetchNotificationCandidatesForDate', 'updateInboxItem', 'answerFollowup', 'syncCalendar', 'updateCalendar', 'deleteInboxItem'].forEach((name) => {
  const start = source.indexOf(`async function ${name}`);
  assert(start >= 0, `missing transport: ${name}`);
  assert(source.slice(start, start + 240).includes('assertDeveloperPreview'), `preview guard missing: ${name}`);
});
assert(nurseSource.includes("paruru:developer-preview") && nurseSource.includes("DEVELOPER_PREVIEW_READ_ONLY") && nurseSource.includes('setPreviewDisabled_'), 'Nurse Okan preview fixture boundary missing');
assert(!fs.readFileSync(path.join(root, 'gas', 'HomeMembershipService.js'), 'utf8').includes('developerPreview'), 'GAS was changed for a PWA-only preview');

console.log('PASS father-only second-son developer preview, fixture-only reads, and transport write/read blocking');

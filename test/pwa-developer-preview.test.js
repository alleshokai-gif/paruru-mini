'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const nurseSource = fs.readFileSync(path.join(root, 'features', 'nurse-okan', 'nurse-okan.js'), 'utf8');
const styleSource = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
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
assert(source.includes('fixture: SECOND_SON_DEVELOPER_PREVIEW_FIXTURE') && source.includes('previousMembershipContext: activeMembershipContext'), 'preview state does not preserve the real member context in memory');
assert(source.includes('let developerPreviewState = null;'), 'preview state is not reset to inactive at PWA bootstrap');
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
assert(source.includes('developerPreviewExitButton?.addEventListener("click", handleDeveloperPreviewExitClick_, { capture: true });'), 'preview exit button is not bound to the guarded click handler');
assert(styleSource.includes('grid-template-columns: auto minmax(0, 1fr) auto') && styleSource.includes('@media (max-width: 560px)'), 'preview banner does not have responsive layout rules');

function clickableButton() {
  return {
    addEventListener(type, listener, options) { this.listener = listener; this.options = options; },
    click() {
      const event = {
        defaultPrevented: false,
        propagationStopped: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.propagationStopped = true; },
      };
      this.listener(event);
      return event;
    },
  };
}

const exitButton = clickableButton();
const realContext = { memberUserId: 'father', role: 'admin', allowedViews: ['home', 'inbox', 'nurse-okan', 'settings'] };
let applyAllowedViewsCalls = 0;
let restoredView = '';
const clickContext = {
  appAuthenticationState: 'active_member',
  activeMembershipContext: realContext,
  developerPreviewState: { fixture: { presentation: { memberUserId: 'second_son', allowedViews: ['home', 'inbox', 'nurse-okan'] } }, previousView: 'settings', previousMembershipContext: realContext },
  developerPreviewBanner: { hidden: false }, developerPreviewStartButton: { hidden: true }, developerPreviewSettings: { hidden: true }, developerPreviewExitButton: exitButton,
  askPaluruButton: null, saveToPaluruButton: null, refreshNotificationsButton: null, homeAgentRetryButton: null,
  detailDialog: null, deleteDialog: null, inboxItems: [], notificationCandidatesState: {},
  pendingHomeAgentActionCandidate: null, pendingHomeAgentRetry: null, homeAgentConversationContext: {},
  hideHomeAgentCard() {}, canStartSecondSonDeveloperPreview_: () => true,
  applyAllowedViews_: () => { applyAllowedViewsCalls += 1; },
  switchView: async (viewName) => { restoredView = viewName; },
  document: { body: { classList: { toggle() {} } }, querySelectorAll: () => [], dispatchEvent() {} },
  CustomEvent: function CustomEvent() {}, Object, JSON, String, Boolean, Error,
};
vm.createContext(clickContext);
vm.runInContext(policyFunctions, clickContext);
vm.runInContext('developerPreviewExitButton?.addEventListener("click", handleDeveloperPreviewExitClick_, { capture: true });', clickContext);
const exitEvent = exitButton.click();
Promise.resolve().then(() => {
  assert.strictEqual(exitButton.options.capture, true, 'exit handler is not capture-phase bound');
  assert(exitEvent.defaultPrevented && exitEvent.propagationStopped, 'exit click was not protected from default/propagation interference');
  assert.strictEqual(clickContext.developerPreviewState, null, 'exit click did not discard preview state');
  assert.strictEqual(clickContext.activeMembershipContext, realContext, 'exit click did not restore the real father/admin context');
  assert.strictEqual(restoredView, 'settings', 'exit click did not restore the previous allowed view');
  assert.strictEqual(applyAllowedViewsCalls, 1, 'exit click did not immediately restore navigation policy');
  console.log('PASS preview exit button dynamic click restores state, context, navigation, and view');
}).catch((error) => { console.error(error); process.exitCode = 1; });

console.log('PASS father-only second-son developer preview, fixture-only reads, and transport write/read blocking');

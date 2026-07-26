'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
function between(start, end) { return source.slice(source.indexOf(start), source.indexOf(end)); }
const approveSource = between('async function approveHomeControlPairing()', 'async function revokeHomeControlDevice');
const renderSource = between('async function renderHomeControlSettings()', 'function renderHomeControlDeviceList');

function element(value = '') { return { value, hidden: false, disabled: false, textContent: '', className: '' }; }
function createHarness(options = {}) {
  const requests = [];
  const messages = [];
  const context = {
    String, Array, Object, Promise,
    homeControlApproveCode: element(options.code || '123456'),
    homeControlMembershipTemplate: element(options.template || ''),
    homeControlApproveButton: element(),
    homeControlApprovePanel: element(),
    homeControlUnregistered: element(), homeControlPending: element(), homeControlRegistered: element(),
    homeControlPendingCode: element(), homeControlPendingExpiry: element(), homeControlStatus: element(), homeControlDeviceName: element(), homeControlRegisteredLabel: element(),
    getCurrentProfile: () => ({ deviceId: 'test-device', displayName: '父' }),
    getHomeAgentPairingToken: () => 'test-credential',
    getHomeControlPending: () => null,
    formatHomeControlExpiry: () => '', scheduleHomeControlPoll() {},
    renderHomeControlDeviceList() {},
    setHomeControlMessage(message, type) { messages.push({ message, type }); },
    callHomeControlApi: async (payload) => { requests.push(payload); return payload.action === 'devicePairingList' ? { devices: [] } : {}; },
    renderHomeControlSettings: async () => {},
  };
  vm.createContext(context);
  vm.runInContext(`let appAuthenticationState = ${JSON.stringify(options.state || 'active_member')}; let activeMembershipContext = ${JSON.stringify({ role: options.role || 'admin' })}; ${approveSource}\n${renderSource}\nglobalThis.setRole_ = (role) => { activeMembershipContext = { role }; };`, context);
  return { context, requests, messages };
}

(async () => {
  for (const template of ['father_add_device', 'second_son_initial']) {
    const h = createHarness({ template });
    await h.context.approveHomeControlPairing();
    const payload = h.requests.find((request) => request.action === 'devicePairingApprove');
    assert(payload, 'approval request was not sent');
    assert.deepStrictEqual(Object.keys(payload).sort(), ['action', 'code', 'deviceId', 'membershipTemplate', 'pairingToken'].sort());
    assert.strictEqual(payload.membershipTemplate, template);
    assert(!Object.hasOwn(payload, 'userId') && !Object.hasOwn(payload, 'role') && !Object.hasOwn(payload, 'homeId') && !Object.hasOwn(payload, 'capability'));
  }

  const blank = createHarness();
  await blank.context.approveHomeControlPairing();
  assert.strictEqual(blank.requests.length, 0, 'blank template must not call the API');
  assert.strictEqual(blank.messages[0].type, 'error');

  const nonAdmin = createHarness({ template: 'father_add_device', role: 'self_record' });
  await nonAdmin.context.renderHomeControlSettings();
  assert.strictEqual(nonAdmin.context.homeControlApprovePanel.hidden, true, 'non-admin must not see approval controls');
  await nonAdmin.context.approveHomeControlPairing();
  assert.strictEqual(nonAdmin.requests.length, 1, 'render list request only; approval must not be sent');
  assert.strictEqual(nonAdmin.requests[0].action, 'devicePairingList');

  const admin = createHarness({ template: 'father_add_device' });
  await admin.context.renderHomeControlSettings();
  assert.strictEqual(admin.context.homeControlApprovePanel.hidden, false, 'admin must see approval controls after active membership');

  console.log('PASS PWA membership template approval payload, validation, and admin-only visibility');
})().catch((error) => { console.error(error); process.exitCode = 1; });

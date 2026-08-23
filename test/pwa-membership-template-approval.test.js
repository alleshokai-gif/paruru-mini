'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const style = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');
function between(start, end) { return source.slice(source.indexOf(start), source.indexOf(end)); }
const approveSource = between('async function approveHomeControlPairing()', 'async function revokeHomeControlDevice');
const revokeSource = between('async function revokeHomeControlDevice(targetDeviceId)', 'async function renderHomeControlSettings()');
const renderSource = between('async function renderHomeControlSettings()', 'function renderHomeControlDeviceList');
const deviceListSource = between('function renderHomeControlDeviceList(devices)', 'function getHomeControlPublicMessage');

assert(html.includes('<span>スマホに表示された6桁コード</span>'), 'approval code label is missing');
assert(/id="homeControlApproveCode"[^>]*inputmode="numeric"[^>]*pattern="\[0-9\]\*"[^>]*maxlength="6"[^>]*autocomplete="one-time-code"[^>]*placeholder="000000"/.test(html), 'approval code input attributes changed');
assert(style.includes('.home-control-approve-panel') && style.includes('gap: 20px'), 'approval panel spacing is missing');
assert(style.includes('.home-control-approve-code') && style.includes('min-height: 56px') && style.includes('font-size: 28px') && style.includes('letter-spacing: 0.22em'), 'approval code input mobile sizing is missing');
assert(style.includes('.home-control-approve-code:focus') && style.includes('box-shadow:'), 'approval code focus indicator is missing');

function element(value = '') { return { value, hidden: false, disabled: false, textContent: '', className: '' }; }
function createHarness(options = {}) {
  const requests = [];
  const messages = [];
  const logs = [];
  const context = {
    String, Array, Object, Promise, Boolean,
    console: { info: (...args) => logs.push({ level: 'info', args }), error: (...args) => logs.push({ level: 'error', args }) },
    homeControlApproveCode: element(options.code || '123456'),
    homeControlMembershipTemplate: element(options.template || ''),
    homeControlApproveButton: element(),
    homeControlApprovePanel: element(),
    homeControlUnregistered: element(), homeControlPending: element(), homeControlRegistered: element(),
    homeControlPendingCode: element(), homeControlPendingExpiry: element(), homeControlStatus: element(), homeControlDeviceName: element(), homeControlRegisteredLabel: element(), homeControlDeviceList: Object.assign(element(), { replaceChildren() {} }),
    getCurrentProfile: () => ({ deviceId: 'test-device', displayName: '父' }),
    getHomeAgentPairingToken: () => 'test-credential',
    getHomeControlPending: () => null,
    formatHomeControlExpiry: () => '', scheduleHomeControlPoll() {},
    escapeHtml: (value) => String(value),
    renderHomeControlDeviceList() {},
    setHomeControlMessage(message, type) { messages.push({ message, type }); },
    getHomeControlPublicMessage: (code) => String(code || ''),
    callHomeControlApi: async (payload) => {
      requests.push(payload);
      if (payload.action === 'devicePairingApprove' && options.approvalError) throw options.approvalError;
      return payload.action === 'devicePairingList' ? { devices: [] } : { diagnostics: { stages: {} } };
    },
    renderHomeControlSettings: async () => {},
  };
  vm.createContext(context);
  vm.runInContext(`let appAuthenticationState = ${JSON.stringify(options.state || 'active_member')}; let activeMembershipContext = ${JSON.stringify({ role: options.role || 'admin' })}; ${approveSource}\n${revokeSource}\n${renderSource}\n${deviceListSource}\nglobalThis.setRole_ = (role) => { activeMembershipContext = { role }; };`, context);
  return { context, requests, messages, logs };
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
    const log = h.logs.find((entry) => entry.args[0] === '[Paruru] devicePairingApprove');
    assert(log && log.level === 'info', 'successful approval must be logged');
    assert.deepStrictEqual(Object.keys(log.args[1]).sort(), ['action', 'deviceId', 'errorCode', 'membershipTemplate', 'message', 'response', 'success'].sort());
    assert(!JSON.stringify(log.args).includes('123456'), 'raw pairing code must not be logged');
    assert.strictEqual(log.args[1].membershipTemplate, template);
  }

  const rejected = createHarness({
    template: 'second_son_initial',
    approvalError: Object.assign(new Error('server rejected'), {
      code: 'HOME_CONTROL_FAILED',
      response: { error: { code: 'MEMBERSHIP_CONFLICT' }, message: 'membership conflict', diagnostics: { stages: { conflict: 'detected' } } },
    }),
  });
  await rejected.context.approveHomeControlPairing();
  const errorLog = rejected.logs.find((entry) => entry.args[0] === '[Paruru] devicePairingApprove');
  assert(errorLog && errorLog.level === 'error', 'failed approval must be logged');
  assert.strictEqual(errorLog.args[1].errorCode, 'MEMBERSHIP_CONFLICT');
  assert.strictEqual(errorLog.args[1].message, 'membership conflict');
  assert.deepStrictEqual(errorLog.args[1].response.diagnostics.stages, { conflict: 'detected' });

  const blank = createHarness();
  await blank.context.approveHomeControlPairing();
  assert.strictEqual(blank.requests.length, 0, 'blank template must not call the API');
  assert.strictEqual(blank.messages[0].type, 'error');

  const nonAdmin = createHarness({ template: 'father_add_device', role: 'self_record' });
  await nonAdmin.context.renderHomeControlSettings();
  assert.strictEqual(nonAdmin.context.homeControlApprovePanel.hidden, true, 'non-admin must not see approval controls');
  assert.strictEqual(nonAdmin.context.homeControlDeviceList.hidden, true, 'non-admin must not see device list');
  assert.strictEqual(nonAdmin.requests.length, 0, 'non-admin must not request the device list');
  await nonAdmin.context.approveHomeControlPairing();
  await nonAdmin.context.revokeHomeControlDevice('another-device');
  assert.strictEqual(nonAdmin.requests.length, 0, 'non-admin must not send approval or revoke requests');

  const admin = createHarness({ template: 'father_add_device' });
  await admin.context.renderHomeControlSettings();
  assert.strictEqual(admin.context.homeControlApprovePanel.hidden, false, 'admin must see approval controls after active membership');
  assert.strictEqual(admin.context.homeControlDeviceList.hidden, false, 'admin must see device list');
  assert.strictEqual(admin.requests[0].action, 'devicePairingList', 'admin must request the device list');
  admin.context.renderHomeControlDeviceList([
    { deviceId: 'test-device', displayName: 'この端末名', status: 'active', isCurrentDevice: true },
    { deviceId: 'other-device', displayName: 'ほかの端末', status: 'active', isCurrentDevice: false },
  ]);
  assert(admin.context.homeControlDeviceList.innerHTML.includes('この端末'), 'current device label is missing');
  assert(!admin.context.homeControlDeviceList.innerHTML.includes('data-home-control-revoke="test-device"'), 'current device must not have a revoke button');
  assert(admin.context.homeControlDeviceList.innerHTML.includes('data-home-control-revoke="other-device"'), 'other active device must remain revocable');

  console.log('PASS PWA membership template approval payload, validation, and admin-only visibility');
})().catch((error) => { console.error(error); process.exitCode = 1; });

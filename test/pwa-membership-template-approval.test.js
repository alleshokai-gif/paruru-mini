'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const style = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');
function between(start, end) { return source.slice(source.indexOf(start), source.indexOf(end)); }
const identitySource = between('function readHomeControlRegistrationIdentity_()', 'async function approveHomeControlPairing()');
const approveSource = between('async function approveHomeControlPairing()', 'async function revokeHomeControlDevice');
const revokeSource = between('async function revokeHomeControlDevice(targetDeviceId)', 'async function renderHomeControlSettings()');
const renderSource = between('async function renderHomeControlSettings()', 'function renderHomeControlDeviceList');
const deviceListSource = between('function renderHomeControlDeviceList(devices)', 'function getHomeControlPublicMessage');

assert(html.includes('<span>スマホに表示された6桁コード</span>'), 'approval code label is missing');
assert(/id="homeControlApproveCode"[^>]*inputmode="numeric"[^>]*pattern="\[0-9\]\*"[^>]*maxlength="6"[^>]*autocomplete="one-time-code"[^>]*placeholder="000000"/.test(html), 'approval code input attributes changed');
assert(style.includes('.home-control-approve-panel') && style.includes('gap: 20px'), 'approval panel spacing is missing');
assert(style.includes('.home-control-approve-code') && style.includes('min-height: 56px') && style.includes('font-size: 28px') && style.includes('letter-spacing: 0.22em'), 'approval code input mobile sizing is missing');
assert(style.includes('.home-control-approve-code:focus') && style.includes('box-shadow:'), 'approval code focus indicator is missing');
for (const option of ['father', 'mother', 'eldest_son', 'eldest_daughter', 'second_son', 'youngest_daughter']) {
  assert(html.includes(`<option value="${option}">`), `${option} approval option is missing`);
}

function element(value = '') {
  return {
    value, selectedOptions: [], hidden: false, disabled: false, textContent: '', className: '', innerHTML: '',
    focus() {},
    replaceChildren() { this.innerHTML = ''; },
  };
}
function createHarness(options = {}) {
  const requests = [];
  const messages = [];
  const logs = [];
  const context = {
    String, Array, Object, Promise, Boolean, Date,
    BUILD_ID: 'test-build',
    HOME_CONTROL_REGISTRATION_IDENTITIES: { father: '父', mother: '母', eldest_son: '長男', eldest_daughter: '長女', second_son: '次男', youngest_daughter: '次女' },
    console: { info: (...args) => logs.push({ level: 'info', args }), error: (...args) => logs.push({ level: 'error', args }) },
    homeControlApproveCode: element(options.code || '123456'),
    homeControlMemberUserId: element(options.memberUserId || ''),
    homeControlApproveButton: element(),
    homeControlApprovePanel: element(),
    homeControlUnregistered: element(), homeControlPending: element(), homeControlRegistered: element(),
    homeControlPendingCode: element(), homeControlPendingExpiry: element(), homeControlStatus: element(), homeControlDeviceName: element(), homeControlRegisteredLabel: element(), homeControlDeviceList: element(),
    getCurrentProfile: () => ({ deviceId: 'test-device', displayName: '父' }),
    getHomeAgentPairingToken: () => 'test-credential',
    getHomeControlPending: () => null,
    formatHomeControlExpiry: () => '', scheduleHomeControlPoll() {},
    escapeHtml: (value) => String(value),
    renderHomeControlDeviceList() {},
    createUuid: () => '11111111-1111-4111-8111-111111111111',
    isUuid: (value) => /^[0-9a-f-]{36}$/i.test(String(value || '')),
    setHomeControlMessage(message, type) { messages.push({ message, type }); },
    getHomeControlPublicMessage: (code) => String(code || ''),
    callHomeControlApi: async (payload) => {
      requests.push(payload);
      if (typeof options.api === 'function') return options.api(payload);
      if (payload.action === 'devicePairingApprove' && options.approvalError) throw options.approvalError;
      if (payload.action === 'devicePairingList') return { devices: [] };
      return { registrationState: 'READY', diagnostics: { stages: {} } };
    },
    renderHomeControlSettings: async () => {},
  };
  vm.createContext(context);
  vm.runInContext(`let appAuthenticationState = ${JSON.stringify(options.state || 'active_member')}; let activeMembershipContext = ${JSON.stringify({ role: options.role || 'admin' })}; let homeControlSelectedMemberUserId = ""; ${identitySource}\n${approveSource}\n${revokeSource}\n${renderSource}\n${deviceListSource}\nglobalThis.setRole_ = (role) => { activeMembershipContext = { role }; };`, context);
  return { context, requests, messages, logs };
}

(async () => {
  for (const identity of [['father', '父'], ['mother', '母'], ['eldest_son', '長男'], ['eldest_daughter', '長女'], ['second_son', '次男'], ['youngest_daughter', '次女']]) {
    const h = createHarness({ memberUserId: identity[0] });
    await h.context.approveHomeControlPairing();
    const payload = h.requests.find((request) => request.action === 'devicePairingApprove');
    assert(payload, 'approval request was not sent');
    assert.deepStrictEqual(Object.keys(payload).sort(), ['action', 'clientRequestId', 'code', 'deviceId', 'memberUserId', 'displayName', 'pairingToken'].sort());
    assert.strictEqual(payload.clientRequestId, '11111111-1111-4111-8111-111111111111');
    assert.strictEqual(payload.memberUserId, identity[0]);
    assert.strictEqual(payload.displayName, identity[1]);
    assert(!Object.hasOwn(payload, 'membershipTemplate') && !Object.hasOwn(payload, 'userId') && !Object.hasOwn(payload, 'role') && !Object.hasOwn(payload, 'homeId') && !Object.hasOwn(payload, 'capability'));
    const log = h.logs.find((entry) => entry.args[0] === '[Paruru] devicePairingApprove');
    assert(log && log.level === 'info', 'successful approval must be logged');
    assert.deepStrictEqual(Object.keys(log.args[1]).sort(), ['action', 'buildId', 'deviceIdSuffix', 'errorCode', 'memberUserId', 'registrationState', 'replayed', 'stages', 'success'].sort());
    assert(!JSON.stringify(log.args).includes('123456'), 'raw pairing code must not be logged');
    assert(!JSON.stringify(log.args).includes('test-device'), 'full device id must not be logged');
    assert.strictEqual(log.args[1].memberUserId, identity[0]);
  }

  const rejected = createHarness({
    memberUserId: 'second_son',
    approvalError: Object.assign(new Error('server rejected'), {
      code: 'HOME_CONTROL_FAILED',
      response: { error: { code: 'MEMBERSHIP_CONFLICT' }, message: 'membership conflict', diagnostics: { stages: { conflict: 'detected' } } },
    }),
  });
  await rejected.context.approveHomeControlPairing();
  const errorLog = rejected.logs.find((entry) => entry.args[0] === '[Paruru] devicePairingApprove');
  assert(errorLog && errorLog.level === 'error', 'failed approval must be logged');
  assert.strictEqual(errorLog.args[1].errorCode, 'MEMBERSHIP_CONFLICT');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(errorLog.args[1].stages)), { conflict: 'detected' });
  assert(!Object.hasOwn(errorLog.args[1], 'response') && !Object.hasOwn(errorLog.args[1], 'message'), 'raw response or message reached approval diagnostics');

  const blank = createHarness();
  await blank.context.approveHomeControlPairing();
  assert.strictEqual(blank.requests.length, 0, 'blank identity must not call the API');
  assert.strictEqual(blank.messages[0].type, 'error');

  const nonAdmin = createHarness({ memberUserId: 'father', role: 'self_record' });
  await nonAdmin.context.renderHomeControlSettings();
  assert.strictEqual(nonAdmin.context.homeControlApprovePanel.hidden, true, 'non-admin must not see approval controls');
  assert.strictEqual(nonAdmin.context.homeControlDeviceList.hidden, true, 'non-admin must not see device list');
  assert.strictEqual(nonAdmin.requests.length, 0, 'non-admin must not request the device list');
  await nonAdmin.context.approveHomeControlPairing();
  await nonAdmin.context.revokeHomeControlDevice('another-device');
  assert.strictEqual(nonAdmin.requests.length, 0, 'non-admin must not send approval or revoke requests');

  const admin = createHarness({ memberUserId: 'father' });
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

  const responseTimeout = createHarness({
    memberUserId: 'eldest_daughter',
    api: async (payload) => {
      if (payload.action === 'devicePairingApprove') {
        const error = new Error('timeout'); error.code = 'HOME_CONTROL_UNAVAILABLE'; throw error;
      }
      return {};
    },
  });
  await responseTimeout.context.approveHomeControlPairing();
  assert.deepStrictEqual(responseTimeout.requests.map((request) => request.action), ['devicePairingApprove']);
  assert.strictEqual(responseTimeout.context.homeControlApproveCode.value, '123456', 'uncertain response must not be treated as consumed by the admin UI');
  assert(responseTimeout.messages.some((item) => item.message === '承認結果を対象端末で再確認してな。' && item.type === 'error'));

  ['devicePairingResume', 'devicePairingApprovalStatus', '登録処理を再開', 'HOME_CONTROL_APPROVAL_ATTEMPT_STORAGE_KEY'].forEach((value) => {
    assert(!source.includes(value), `fresh PWA still contains ${value}`);
  });

  console.log('PASS PWA identity-only approval and minimal admin visibility');
})().catch((error) => { console.error(error); process.exitCode = 1; });

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
assert(html.includes('<option value="eldest_daughter_initial">長女の端末</option>'), 'eldest daughter approval option is missing');

function element(value = '') {
  return {
    value, hidden: false, disabled: false, textContent: '', className: '', innerHTML: '',
    replaceChildren() { this.innerHTML = ''; },
  };
}
function createHarness(options = {}) {
  const requests = [];
  const messages = [];
  const logs = [];
  let approvalAttempt = options.approvalAttempt || null;
  const context = {
    String, Array, Object, Promise, Boolean, Date,
    BUILD_ID: 'test-build',
    console: { info: (...args) => logs.push({ level: 'info', args }), error: (...args) => logs.push({ level: 'error', args }) },
    homeControlApproveCode: element(options.code || '123456'),
    homeControlMembershipTemplate: element(options.template || ''),
    homeControlApproveButton: element(),
    homeControlApprovePanel: element(),
    homeControlUnregistered: element(), homeControlPending: element(), homeControlRegistered: element(),
    homeControlPendingCode: element(), homeControlPendingExpiry: element(), homeControlStatus: element(), homeControlDeviceName: element(), homeControlRegisteredLabel: element(), homeControlDeviceList: element(), homeControlRecoveryList: element(),
    getCurrentProfile: () => ({ deviceId: 'test-device', displayName: '父' }),
    getHomeAgentPairingToken: () => 'test-credential',
    getHomeControlPending: () => null,
    formatHomeControlExpiry: () => '', scheduleHomeControlPoll() {},
    escapeHtml: (value) => String(value),
    renderHomeControlDeviceList() {},
    createUuid: () => '11111111-1111-4111-8111-111111111111',
    isUuid: (value) => /^[0-9a-f-]{36}$/i.test(String(value || '')),
    getHomeControlApprovalAttempt_: () => approvalAttempt,
    saveHomeControlApprovalAttempt_: (value) => { approvalAttempt = { ...value }; },
    clearHomeControlApprovalAttempt_: () => { approvalAttempt = null; },
    setHomeControlMessage(message, type) { messages.push({ message, type }); },
    getHomeControlPublicMessage: (code) => String(code || ''),
    callHomeControlApi: async (payload) => {
      requests.push(payload);
      if (typeof options.api === 'function') return options.api(payload);
      if (payload.action === 'devicePairingApprove' && options.approvalError) throw options.approvalError;
      if (payload.action === 'devicePairingList') return { devices: [], recoveries: [] };
      if (payload.action === 'devicePairingApprovalStatus') {
        const error = new Error('not found'); error.code = 'PAIRING_APPROVAL_NOT_FOUND'; throw error;
      }
      return { registrationState: 'READY', diagnostics: { stages: {} } };
    },
    renderHomeControlSettings: async () => {},
  };
  vm.createContext(context);
  vm.runInContext(`let appAuthenticationState = ${JSON.stringify(options.state || 'active_member')}; let activeMembershipContext = ${JSON.stringify({ role: options.role || 'admin' })}; ${approveSource}\n${revokeSource}\n${renderSource}\n${deviceListSource}\nglobalThis.setRole_ = (role) => { activeMembershipContext = { role }; };`, context);
  return { context, requests, messages, logs, approvalAttempt: () => approvalAttempt };
}

(async () => {
  for (const template of ['father_add_device', 'eldest_daughter_initial', 'second_son_initial']) {
    const h = createHarness({ template });
    await h.context.approveHomeControlPairing();
    const payload = h.requests.find((request) => request.action === 'devicePairingApprove');
    assert(payload, 'approval request was not sent');
    assert.deepStrictEqual(Object.keys(payload).sort(), ['action', 'clientRequestId', 'code', 'deviceId', 'membershipTemplate', 'pairingToken'].sort());
    assert.strictEqual(payload.clientRequestId, '11111111-1111-4111-8111-111111111111');
    assert.strictEqual(payload.membershipTemplate, template);
    assert(!Object.hasOwn(payload, 'userId') && !Object.hasOwn(payload, 'role') && !Object.hasOwn(payload, 'homeId') && !Object.hasOwn(payload, 'capability'));
    const log = h.logs.find((entry) => entry.args[0] === '[Paruru] devicePairingApprove');
    assert(log && log.level === 'info', 'successful approval must be logged');
    assert.deepStrictEqual(Object.keys(log.args[1]).sort(), ['action', 'buildId', 'deviceIdSuffix', 'errorCode', 'membershipTemplate', 'registrationState', 'replayed', 'stages', 'success'].sort());
    assert(!JSON.stringify(log.args).includes('123456'), 'raw pairing code must not be logged');
    assert(!JSON.stringify(log.args).includes('test-device'), 'full device id must not be logged');
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
  assert.deepStrictEqual(JSON.parse(JSON.stringify(errorLog.args[1].stages)), { conflict: 'detected' });
  assert(!Object.hasOwn(errorLog.args[1], 'response') && !Object.hasOwn(errorLog.args[1], 'message'), 'raw response or message reached approval diagnostics');

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

  const responseTimeout = createHarness({
    template: 'eldest_daughter_initial',
    api: async (payload) => {
      if (payload.action === 'devicePairingApprove') {
        const error = new Error('timeout'); error.code = 'HOME_CONTROL_UNAVAILABLE'; throw error;
      }
      if (payload.action === 'devicePairingApprovalStatus') return { registrationState: 'READY', retryable: false };
      if (payload.action === 'devicePairingList') return { devices: [], recoveries: [] };
      return {};
    },
  });
  await responseTimeout.context.approveHomeControlPairing();
  assert.deepStrictEqual(responseTimeout.requests.map((request) => request.action), ['devicePairingApprove', 'devicePairingApprovalStatus', 'devicePairingList']);
  assert.strictEqual(responseTimeout.approvalAttempt(), null, 'confirmed READY must clear the client approval attempt');
  assert.strictEqual(responseTimeout.context.homeControlApproveCode.value, '', 'confirmed READY must clear the consumed code');
  assert(responseTimeout.messages.some((item) => item.message === '端末登録の成功を確認したで。' && item.type === 'success'));

  const retryableReload = createHarness({
    template: 'eldest_daughter_initial',
    approvalAttempt: { clientRequestId: '11111111-1111-4111-8111-111111111111', membershipTemplate: 'eldest_daughter_initial' },
    api: async (payload) => {
      if (payload.action === 'devicePairingList') return { devices: [], recoveries: [{ requestId: '22222222-2222-4222-8222-222222222222', deviceName: '長女の端末', retryable: true }] };
      if (payload.action === 'devicePairingApprovalStatus') return { registrationState: 'FAILED_RETRYABLE', retryable: true };
      if (payload.action === 'devicePairingResume') return { registrationState: 'READY' };
      return {};
    },
  });
  await retryableReload.context.renderHomeControlSettings();
  assert(retryableReload.context.homeControlRecoveryList.innerHTML.includes('登録処理を再開'), 'reload must render the resumable registration action');
  assert.strictEqual(retryableReload.context.homeControlApproveButton.textContent, '再試行');
  await retryableReload.context.resumeHomeControlPairing('22222222-2222-4222-8222-222222222222');
  assert(retryableReload.requests.some((request) => request.action === 'devicePairingResume'), 'resume endpoint was not called');

  console.log('PASS PWA membership template approval, idempotent retry, reload recovery, and admin-only visibility');
})().catch((error) => { console.error(error); process.exitCode = 1; });

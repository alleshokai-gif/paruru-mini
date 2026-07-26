'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const nurse = fs.readFileSync(path.join(root, 'features/nurse-okan', 'nurse-okan.js'), 'utf8');

[
  'authLock',
  'authLockUnpaired',
  'authLockPending',
  'authLockUnassigned',
  'authLockError',
  'authLockBeginButton',
  'authLockRetryButton',
  'authLockCode',
  'authLockExpiry',
].forEach((id) => assert(html.includes(id), `lock DOM missing ${id}`));
assert(!nurse.includes('localStorage.getItem'), 'nurse reads localStorage directly');
assert(!nurse.includes('pairingToken'), 'nurse refers to a raw pairing token');
assert(!nurse.includes('fetch('), 'nurse bypasses the authenticated health facade');

function classList() {
  const values = new Set();
  return {
    add: (...names) => names.forEach((name) => values.add(name)),
    remove: (...names) => names.forEach((name) => values.delete(name)),
    contains: (name) => values.has(name),
  };
}

function element() {
  return {
    hidden: false,
    textContent: '',
    value: '',
    classList: classList(),
    addEventListener() {},
  };
}

function sourceBetween(start, end) {
  const from = app.indexOf(start);
  const to = app.indexOf(end, from);
  assert(from >= 0 && to > from, `source boundary missing: ${start}`);
  return app.slice(from, to);
}

const pendingSource = sourceBetween('function getHomeControlPending()', 'async function createHomeControlToken()');
const pollingSource = sourceBetween('async function pollHomeControlPairing()', 'async function approveHomeControlPairing()');
const authenticationStateSource = sourceBetween('let appAuthenticationState = "booting";', 'const NURSE_OKAN_HEALTH_ACTIONS');
const healthFacadeSource = sourceBetween('const NURSE_OKAN_HEALTH_ACTIONS = new Set([', 'function showAuthenticationState');
const authSource = sourceBetween('function showAuthenticationState', 'window.addEventListener("load"');

function createHarness(options = {}) {
  const storage = new Map();
  const requests = [];
  const timers = [];
  const clearedTimers = [];
  const events = [];
  const panels = {
    lock: element(),
    message: element(),
    unpaired: element(),
    pending: element(),
    unassigned: element(),
    error: element(),
  };
  let response = options.response || (() => ({}));
  const context = {
    APP_VERSION: 'test',
    BUILD_VERSION: 'test',
    HOME_AGENT_PAIRING_TOKEN_STORAGE_KEY: 'pairing-token',
    HOME_CONTROL_PENDING_STORAGE_KEY: 'pairing-pending',
    MEMBERSHIP_REGISTRATION_PENDING_STORAGE_KEY: 'membership-pending',
    HOME_CONTROL_POLL_MILLISECONDS: 5000,
    homeControlPollTimer: null,
    membershipRegistrationPollTimer: null,
    notificationBoundaryTimerEnabled: false,
    userProfile: null,
    authLock: panels.lock,
    authLockMessage: panels.message,
    authLockUnpaired: panels.unpaired,
    authLockPending: panels.pending,
    authLockUnassigned: panels.unassigned,
    authLockError: panels.error,
    authLockDeviceName: element(),
    authLockBeginButton: element(),
    authLockRetryButton: element(),
    authLockCode: element(),
    authLockExpiry: element(),
    authLockMembershipBeginButton: element(),
    authLockMembershipPending: element(),
    authLockMembershipCode: element(),
    authLockMembershipExpiry: element(),
    authLockMembershipMessage: element(),
    homeControlDeviceName: element(),
    homeControlEnableButton: element(),
    homeControlMessage: element(),
    buildVersion: element(),
    splash: { classList: classList(), querySelector: () => element() },
    document: {
      body: { classList: classList() },
      dispatchEvent(event) { events.push(event); },
    },
    window: { addEventListener() {} },
    CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init.detail; },
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { storage.set(key, String(value)); },
      removeItem(key) { storage.delete(key); },
    },
    Date,
    JSON,
    Number,
    String,
    Math,
    Error,
    setTimeout(callback, milliseconds) {
      const timer = { callback, milliseconds, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      if (timer) timer.cleared = true;
      clearedTimers.push(timer);
    },
    isUuid: () => true,
    loadUserProfile: () => ({ deviceId: 'device-a', displayName: '端末A' }),
    getHomeAgentPairingToken: () => options.token || storage.get('pairing-token') || '',
    callHomeControlApi: async (payload) => {
      requests.push(payload);
      return response(payload);
    },
    renderProfileForm() { context.normalInitializations += 1; },
    setParuruState() {},
    loadNotificationCandidates() { context.notificationLoads += 1; },
    beginHomeControlPairing: async () => {},
    createHomeControlError(code) {
      const error = new Error(code);
      error.code = code;
      return error;
    },
    getHomeControlPublicMessage: (code) => `error:${code || ''}`,
    normalInitializations: 0,
    notificationLoads: 0,
    console,
  };
  vm.createContext(context);
  vm.runInContext(`${pendingSource}\n${pollingSource}\n${authenticationStateSource}\n${healthFacadeSource}\n${authSource}\nglobalThis.getState_ = () => appAuthenticationState;`, context);
  return {
    context,
    panels,
    requests,
    timers,
    clearedTimers,
    events,
    setResponse(next) { response = next; },
    savePending(value) { context.saveHomeControlPending(value); },
    hasPending() { return Boolean(context.getHomeControlPending()); },
    state() { return context.getState_(); },
  };
}

async function startup(options) {
  const harness = createHarness(options);
  await harness.context.initializeAuthenticatedPwa();
  return harness;
}

(async () => {
  const unpaired = await startup();
  assert.strictEqual(unpaired.state(), 'unpaired');
  assert.strictEqual(unpaired.normalInitializations, undefined);
  assert.strictEqual(unpaired.context.normalInitializations, 0);
  assert.strictEqual(unpaired.requests.length, 0);
  assert.strictEqual(unpaired.panels.unpaired.hidden, false);
  assert.strictEqual(unpaired.panels.pending.hidden, true);
  await assert.rejects(
    () => unpaired.context.callAuthenticatedHealth_('health.context.get', {}),
    (error) => error.code === 'AUTHENTICATION_REQUIRED',
  );
  assert.strictEqual(unpaired.requests.length, 0, 'unauthenticated facade must not call an API');

  const waiting = createHarness();
  waiting.savePending({ requestId: 'request-a', requestSecret: 'secret', token: 'credential', code: '123456', expiresAt: new Date(Date.now() + 60000).toISOString(), requestExpiresAt: Date.now() + 60000 });
  await waiting.context.initializeAuthenticatedPwa();
  assert.strictEqual(waiting.state(), 'pairing_pending');
  assert.strictEqual(waiting.context.normalInitializations, 0);
  assert.strictEqual(waiting.requests.length, 0);
  assert.strictEqual(waiting.panels.pending.hidden, false);
  assert.strictEqual(waiting.panels.unpaired.hidden, true);

  const active = await startup({ token: 'credential', response: () => ({ memberUserId: 'father' }) });
  assert.strictEqual(active.state(), 'active_member');
  assert.strictEqual(active.context.normalInitializations, 1);
  assert.strictEqual(active.context.notificationLoads, 1);
  assert.deepStrictEqual(active.requests.map((request) => request.action), ['membership.context.get']);
  assert.strictEqual(active.events.length, 1);
  assert(!Object.hasOwn(active.events[0].detail, 'pairingToken'), 'authentication event exposes a token');
  assert(!Object.hasOwn(active.events[0].detail.context, 'pairingToken'), 'authentication context exposes a token');
  assert.strictEqual(typeof active.events[0].detail.healthApi, 'function');
  await active.events[0].detail.healthApi('health.daily.get', {
    deviceId: 'spoofed-device',
    pairingToken: 'spoofed-token',
    targetMemberUserId: 'father',
  });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(active.requests[1])), {
    action: 'health.daily.get',
    deviceId: 'device-a',
    pairingToken: 'credential',
    targetMemberUserId: 'father',
  }, 'facade must inject credentials internally and override spoofed values');
  await assert.rejects(
    () => active.events[0].detail.healthApi('homeAgent', {}),
    (error) => error.code === 'HEALTH_ACTION_NOT_ALLOWED',
  );
  assert.strictEqual(active.requests.length, 2, 'health facade must reject non-Health actions before transport');
  await active.context.initializeAuthenticatedPwa();
  assert.strictEqual(active.context.normalInitializations, 1, 'active startup must be one-shot');

  const unassigned = await startup({
    token: 'credential',
    response: () => { const error = new Error('missing'); error.code = 'MEMBERSHIP_NOT_FOUND'; throw error; },
  });
  assert.strictEqual(unassigned.state(), 'paired_unassigned');
  assert.strictEqual(unassigned.context.normalInitializations, 0);
  assert.strictEqual(unassigned.panels.unassigned.hidden, false);

  const revoked = await startup({
    token: 'credential',
    response: () => { const error = new Error('revoked'); error.code = 'UNAUTHORIZED_DEVICE'; throw error; },
  });
  assert.strictEqual(revoked.state(), 'revoked_error');
  assert.strictEqual(revoked.context.normalInitializations, 0);
  assert.strictEqual(revoked.panels.error.hidden, false);

  const pending = createHarness({ token: 'credential' });
  pending.savePending({ requestId: 'request-a', requestSecret: 'secret', token: 'credential', code: '123456', expiresAt: new Date(Date.now() + 60000).toISOString(), requestExpiresAt: Date.now() + 60000 });
  pending.setResponse((payload) => payload.action === 'devicePairingStatus' ? { status: 'pending' } : ({ memberUserId: 'father' }));
  await pending.context.pollHomeControlPairing();
  assert.strictEqual(pending.requests[0].action, 'devicePairingStatus');
  assert.strictEqual(pending.timers.length, 1, 'pending must schedule exactly one retry');
  assert.strictEqual(pending.timers[0].milliseconds, 5000, 'pending retry interval must be five seconds');
  pending.context.scheduleHomeControlPoll();
  assert.strictEqual(pending.timers.length, 2);
  assert.strictEqual(pending.timers[0].cleared, true, 'reschedule must clear the prior timer');

  const transient = createHarness({ token: 'credential' });
  transient.savePending({ requestId: 'request-a', requestSecret: 'secret', token: 'credential', code: '123456', expiresAt: new Date(Date.now() + 60000).toISOString(), requestExpiresAt: Date.now() + 60000 });
  transient.setResponse(() => { const error = new Error('network'); error.code = 'HOME_CONTROL_UNAVAILABLE'; throw error; });
  await transient.context.pollHomeControlPairing();
  assert.strictEqual(transient.hasPending(), true, 'transient errors retain the pending request');
  assert.strictEqual(transient.timers.length, 1, 'transient errors retry once');
  assert.strictEqual(transient.timers[0].milliseconds, 5000, 'transient retry interval must be five seconds');

  const terminal = createHarness({ token: 'credential' });
  terminal.savePending({ requestId: 'request-a', requestSecret: 'secret', token: 'credential', code: '123456', expiresAt: new Date(Date.now() + 60000).toISOString(), requestExpiresAt: Date.now() + 60000 });
  terminal.setResponse(() => { const error = new Error('invalid'); error.code = 'PAIRING_REQUEST_INVALID'; throw error; });
  await terminal.context.pollHomeControlPairing();
  assert.strictEqual(terminal.hasPending(), false);
  assert.strictEqual(terminal.timers.length, 0, 'terminal errors must not retry');
  assert.strictEqual(terminal.state(), 'revoked_error');

  const expired = createHarness({ token: 'credential' });
  expired.savePending({ requestId: 'request-a', requestSecret: 'secret', token: 'credential', code: '123456', expiresAt: new Date(Date.now() - 1000).toISOString(), requestExpiresAt: Date.now() + 60000 });
  await expired.context.pollHomeControlPairing();
  assert.strictEqual(expired.hasPending(), false);
  assert.strictEqual(expired.requests.length, 0, 'expired requests must not call the API');
  assert.strictEqual(expired.state(), 'unpaired');

  const paired = createHarness({ token: '' });
  paired.savePending({ requestId: 'request-a', requestSecret: 'secret', token: 'credential', code: '123456', expiresAt: new Date(Date.now() + 60000).toISOString(), requestExpiresAt: Date.now() + 60000 });
  paired.setResponse((payload) => payload.action === 'devicePairingStatus' ? { status: 'active' } : ({ memberUserId: 'father' }));
  await paired.context.pollHomeControlPairing();
  assert.deepStrictEqual(paired.requests.map((request) => request.action), ['devicePairingStatus', 'membership.context.get']);
  assert.strictEqual(paired.hasPending(), false);
  assert.strictEqual(paired.context.normalInitializations, 1);

  console.log('PASS pairing lock VM state, API, polling, and initialization boundaries');
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});

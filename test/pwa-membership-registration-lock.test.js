'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
['authLockUnassigned', 'authLockMembershipBeginButton', 'authLockMembershipPending', 'authLockMembershipCode', 'authLockMembershipExpiry'].forEach((id) => {
  assert(html.includes(id), `membership lock DOM missing ${id}`);
});

function between(start, end) {
  const from = app.indexOf(start); const to = app.indexOf(end, from);
  assert(from >= 0 && to > from, `source boundary missing: ${start}`);
  return app.slice(from, to);
}

const pendingSource = between('const getMembershipRegistrationPending = function()', 'function setHomeControlMessage');
const lockSource = between('const renderMembershipRegistrationLock_ = function()', 'async function initializeAuthenticatedPwa()');
const beginSource = between('const beginMembershipRegistration = async function()', 'async function pollHomeControlPairing()');
const pollSource = between('const pollMembershipRegistration = async function()', 'async function approveHomeControlPairing()');
assert(!lockSource.includes('requestSecret'), 'requestSecret must not reach lock DOM rendering');
assert(!pendingSource.includes('console.'), 'membership pending helpers must not log secrets');

function element() { return { hidden: false, disabled: false, textContent: '' }; }
function harness(options = {}) {
  const storage = new Map();
  const requests = [];
  const timers = [];
  let response = options.response || (async () => ({}));
  let activated = 0;
  let states = [];
  const windowObject = {};
  const context = {
    MEMBERSHIP_REGISTRATION_PENDING_STORAGE_KEY: 'membership-pending',
    HOME_CONTROL_PENDING_STORAGE_KEY: 'pairing-pending',
    HOME_CONTROL_POLL_MILLISECONDS: 5000,
    membershipRegistrationPollTimer: null,
    authLockMembershipBeginButton: element(), authLockMembershipPending: element(), authLockMembershipCode: element(), authLockMembershipExpiry: element(), authLockMembershipMessage: element(),
    userProfile: null,
    Date, JSON, Number, String, Math, Error,
    localStorage: { getItem: (key) => storage.has(key) ? storage.get(key) : null, setItem: (key, value) => storage.set(key, String(value)), removeItem: (key) => storage.delete(key) },
    isUuid: () => true,
    loadUserProfile: () => ({ deviceId: 'test-device' }),
    getHomeAgentPairingToken: () => 'test-pairing-credential',
    callHomeControlApi: async (payload) => { requests.push(payload); return response(payload); },
    createHomeControlError(code) { const error = new Error(code); error.code = code; return error; },
    getHomeControlPublicMessage: (code) => `error:${code || ''}`,
    formatHomeControlExpiry: () => '期限',
    showAuthenticationState: (_message, state) => { states.push(state); },
    setTimeout(callback, milliseconds) { const timer = { callback, milliseconds, cleared: false }; timers.push(timer); return timer; },
    clearTimeout(timer) { if (timer) timer.cleared = true; },
    activateMembershipContext_: () => { activated += 1; context.clearMembershipRegistrationPending(); },
    window: windowObject,
  };
  vm.createContext(context);
  vm.runInContext(`${pendingSource}\n${lockSource}\n${beginSource}\n${pollSource}\nglobalThis.__membershipTestApi = { getMembershipRegistrationPending, saveMembershipRegistrationPending, clearMembershipRegistrationPending, renderMembershipRegistrationLock_, beginMembershipRegistration, pollMembershipRegistration };`, context);
  Object.assign(context, context.__membershipTestApi);
  return {
    context, windowObject, requests, timers, storage, states,
    activated: () => activated,
    setResponse: (next) => { response = next; },
    save: (value) => context.saveMembershipRegistrationPending(value),
    pending: () => context.getMembershipRegistrationPending(),
  };
}

function pending(overrides = {}) {
  return Object.assign({ kind: 'membership', requestId: 'request-a', requestSecret: 'request-secret', code: '123456', expiresAt: new Date(Date.now() + 60000).toISOString(), requestExpiresAt: Date.now() + 15 * 60 * 1000 }, overrides);
}

(async () => {
  const start = harness({ response: async () => ({ requestId: 'request-a', requestSecret: 'request-secret', code: '123456', expiresAt: new Date(Date.now() + 60000).toISOString() }) });
  ['getMembershipRegistrationPending', 'saveMembershipRegistrationPending', 'clearMembershipRegistrationPending', 'beginMembershipRegistration', 'pollMembershipRegistration'].forEach((name) => {
    assert.strictEqual(start.windowObject[name], undefined, `${name} must not be exposed on window`);
  });
  await start.context.beginMembershipRegistration();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(start.requests[0])), { action: 'membershipRegistrationBegin', deviceId: 'test-device', pairingToken: 'test-pairing-credential' });
  assert(start.pending(), 'begin must store only the membership pending request');
  assert.strictEqual(start.storage.has('pairing-pending'), false, 'membership pending must not use the pairing key');
  assert.strictEqual(start.timers.length, 1);
  assert.strictEqual(start.timers[0].milliseconds, 5000);

  const reload = harness(); reload.save(pending()); reload.context.renderMembershipRegistrationLock_(); reload.context.renderMembershipRegistrationLock_();
  assert.strictEqual(reload.requests.length, 0, 'reload must not call normal APIs');
  assert.strictEqual(reload.timers.length, 2);
  assert.strictEqual(reload.timers[0].cleared, true, 'reload rendering must not duplicate active timers');

  const approved = harness({ response: async (payload) => payload.action === 'membershipRegistrationStatus' ? { status: 'approved' } : ({ memberUserId: 'father' }) });
  approved.save(pending()); await approved.context.pollMembershipRegistration();
  assert.deepStrictEqual(approved.requests.map((item) => item.action), ['membershipRegistrationStatus', 'membership.context.get']);
  assert.strictEqual(approved.activated(), 1, 'only a successful context check may activate the normal PWA');
  assert.strictEqual(approved.pending(), null);

  for (const code of ['MEMBERSHIP_NOT_FOUND', 'HOME_CONTROL_UNAVAILABLE']) {
    const retry = harness({ response: async (payload) => {
      if (payload.action === 'membershipRegistrationStatus') return { status: 'approved' };
      const error = new Error(code); error.code = code; throw error;
    } });
    retry.save(pending()); await retry.context.pollMembershipRegistration();
    assert.strictEqual(retry.activated(), 0, `${code} must not activate the normal PWA`);
    assert(retry.pending(), `${code} must retain the registration request for recheck`);
    assert.strictEqual(retry.timers.length, 1);
  }

  const expired = harness(); expired.save(pending({ expiresAt: new Date(Date.now() - 1000).toISOString() })); await expired.context.pollMembershipRegistration();
  assert.strictEqual(expired.pending(), null); assert.strictEqual(expired.requests.length, 0);

  const terminal = harness({ response: async () => { const error = new Error('invalid'); error.code = 'MEMBERSHIP_REGISTRATION_REQUEST_INVALID'; throw error; } });
  terminal.save(pending()); await terminal.context.pollMembershipRegistration();
  assert.strictEqual(terminal.pending(), null); assert.strictEqual(terminal.timers.length, 0);

  const separate = harness({ response: async () => ({ status: 'pending' }) });
  separate.storage.set('pairing-pending', JSON.stringify({ requestId: 'pairing-request', token: 'pairing-only' })); separate.save(pending());
  await separate.context.pollMembershipRegistration();
  assert.deepStrictEqual(JSON.parse(separate.storage.get('pairing-pending')), { requestId: 'pairing-request', token: 'pairing-only' });
  assert.deepStrictEqual(Object.keys(separate.requests[0]).sort(), ['action', 'deviceId', 'pairingToken', 'requestId', 'requestSecret'].sort());
  console.log('PASS PWA membership registration begin, recovery, polling, and auth boundaries');
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

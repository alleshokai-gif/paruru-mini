'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'gas', 'DevicePairingService.js'), 'utf8');
const policySource = fs.readFileSync(path.join(root, 'gas', 'HomeMemberPolicy.js'), 'utf8');
const securitySource = fs.readFileSync(path.join(root, 'gas', 'HomeAgentActionSecurity.js'), 'utf8');
const properties = {};
let nowMs = Date.parse('2026-07-20T10:00:00+09:00');
let uuidCounter = 1;
let randomUuidCounter = 1;
let locked = false;
const membershipStatuses = {};

function hash(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function uuid() { return `aaaaaaaa-aaaa-4aaa-8aaa-${String(uuidCounter++).padStart(12, '0')}`; }
function response(value) { return value; }
function post(action, body) { return context[action](body); }
function assert(value, message) { if (!value) throw new Error(message); }
function reset() {
  Object.keys(properties).forEach((key) => delete properties[key]);
  nowMs = Date.parse('2026-07-20T10:00:00+09:00');
  uuidCounter = 1;
  randomUuidCounter = 1;
  Object.keys(membershipStatuses).forEach((key) => delete membershipStatuses[key]);
}

const context = {
  Date, JSON, Math, Number, Object, Array, String, RegExp, Error, parseInt,
  json_: response,
  PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => properties[key] || '', setProperty: (key, value) => { properties[key] = String(value); } }) },
  LockService: { getScriptLock: () => ({ waitLock: () => { if (locked) throw new Error('lock re-entry'); locked = true; }, releaseLock: () => { locked = false; } }) },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
    computeDigest: (_algorithm, value) => Array.from(crypto.createHash('sha256').update(String(value)).digest()),
    getUuid: () => `${String(randomUuidCounter++).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
    formatDate: (date) => date.toISOString(),
  },
  resolveMembershipApprovalAdminWithinRegistryLock_: (deviceId, credential, registry) => {
    if (deviceId !== parentId || credential !== parentToken || !registry.devices[parentId] || registry.devices[parentId].status !== 'active') {
      throw Object.assign(new Error('UNAUTHORIZED_DEVICE'), { code: 'UNAUTHORIZED_DEVICE' });
    }
    return { homeId: 'test-home', memberUserId: 'father', role: 'admin', deviceId };
  },
  provisionMembershipFromApprovalTemplateWithinRegistryLock_: (_actor, targetDeviceId) => {
    membershipStatuses[targetDeviceId] = 'active';
    return { status: 'active' };
  },
  snapshotActiveDeviceMembershipForRevoke_: (deviceId, homeId) => {
    if (homeId !== 'test-home' || membershipStatuses[deviceId] !== 'active') throw Object.assign(new Error('MEMBERSHIP_NOT_FOUND'), { code: 'MEMBERSHIP_NOT_FOUND' });
    return { deviceId, homeId, memberUserId: 'father', status: 'active' };
  },
  disableDeviceMembershipForRevoke_: (snapshot) => { membershipStatuses[snapshot.deviceId] = 'disabled'; },
  restoreDeviceMembershipAfterRevokeFailure_: (snapshot) => { membershipStatuses[snapshot.deviceId] = 'active'; },
  verifyDisabledDeviceMembershipForRevoke_: (snapshot) => {
    if (membershipStatuses[snapshot.deviceId] !== 'disabled') throw Object.assign(new Error('DEVICE_REVOKE_VERIFICATION_FAILED'), { code: 'DEVICE_REVOKE_VERIFICATION_FAILED' });
    return true;
  },
};
vm.createContext(context);
new vm.Script(policySource + '\n' + source + '\n' + securitySource).runInContext(context);

const parentToken = 'parent-pairing-token-000000000000000000000001';
const childTokenHash = hash('child-pairing-token-000000000000000000000002');
const parentId = 'parent-device';
const childId = 'child-device';

function legacyParent() {
  properties.PALURU_HOME_AGENT_DEVICE_TOKEN_HASHES = JSON.stringify({ [parentId]: hash(parentToken) });
}

function begin() {
  return post('devicePairingBegin_', { deviceId: childId, displayName: '新しい端末', tokenHash: childTokenHash });
}

function approve(code, membershipTemplate = 'father_add_device') {
  return post('devicePairingApprove_', { deviceId: parentId, pairingToken: parentToken, code, membershipTemplate });
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('Legacy hash map migrates as active registry records without deleting the old property', () => {
  reset(); legacyParent();
  const result = context.verifyHomeControlDevicePairing_(parentId, parentToken);
  assert(result.handled && result.authorized, 'legacy parent was not accepted');
  const registry = JSON.parse(properties.PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1);
  assert(registry.devices[parentId].status === 'active', 'legacy record did not become active');
  assert(Boolean(properties.PALURU_HOME_AGENT_DEVICE_TOKEN_HASHES), 'legacy property was deleted');
});

test('begin approve status activates only the requested device and stores hashes only', () => {
  reset(); legacyParent();
  const started = begin();
  assert(started.success && /^\d{6}$/.test(started.data.code), 'begin did not issue a code');
  const storedBefore = properties.PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1;
  assert(!storedBefore.includes('child-pairing-token-'), 'raw token reached registry');
  assert(!storedBefore.includes(started.data.requestSecret), 'request secret reached registry');
  assert(!storedBefore.includes(started.data.code), 'approval code reached registry');
  const approved = approve(started.data.code);
  assert(approved.success && approved.data.status === 'approved', 'registered parent could not approve');
  const status = post('devicePairingStatus_', { requestId: started.data.requestId, requestSecret: started.data.requestSecret });
  assert(status.success && status.data.status === 'active', 'new device did not become active');
});

test('wrong code expires, rate limits, and cannot be reused', () => {
  reset(); legacyParent();
  const started = begin();
  assert(!approve('000000').success, 'wrong code was accepted');
  for (let index = 0; index < 4; index += 1) approve('000000');
  assert(approve('000000').error.code === 'PAIRING_CODE_RATE_LIMITED', 'wrong code was not rate limited');
  const persisted = JSON.parse(properties.PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1);
  persisted.requests[started.data.requestId].codeExpiresAt = '2020-01-01T00:00:00.000Z';
  persisted.approveAttempts[parentId].startedAt = 0;
  properties.PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1 = JSON.stringify(persisted);
  const expired = approve(started.data.code);
  assert(!expired.success, 'expired code was accepted');
  const second = begin();
  const secondRegistry = JSON.parse(properties.PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1);
  assert(secondRegistry.requests[second.data.requestId].codeHash === hash(second.data.code), 'new code hash was not persisted');
  assert(!secondRegistry.requests[started.data.requestId], 'expired prior request remained after reissue');
  assert(Object.values(secondRegistry.requests).filter((request) => request.deviceId === childId && request.status === 'pending').length === 1, 'reissue did not leave exactly one pending request');
  const validAfterWindow = approve(second.data.code);
  assert(validAfterWindow.success, `valid code was rejected after rate window: ${validAfterWindow.error && validAfterWindow.error.code}`);
  const approvedRegistry = JSON.parse(properties.PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1);
  assert(Object.values(approvedRegistry.requests).filter((request) => request.deviceId === childId && request.status === 'pending').length === 0, 'approval left a stale pending request');
  assert(Object.values(approvedRegistry.requests).filter((request) => request.deviceId === childId && request.status === 'approved').length === 1, 'approval did not leave exactly one approved request');
  assert(!approve(second.data.code).success, 'used code was accepted again');
});

test('expiring a legacy sibling request preserves the newer pending request and device', () => {
  reset(); legacyParent();
  const first = begin();
  let registry = JSON.parse(properties.PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1);
  const staleRequest = JSON.parse(JSON.stringify(registry.requests[first.data.requestId]));
  registry.requests[first.data.requestId].codeExpiresAt = '2020-01-01T00:00:00.000Z';
  properties.PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1 = JSON.stringify(registry);

  const second = begin();
  registry = JSON.parse(properties.PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1);
  staleRequest.expiresAt = '2020-01-01T00:00:00.000Z';
  registry.requests[first.data.requestId] = staleRequest;
  properties.PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1 = JSON.stringify(registry);

  const status = post('devicePairingStatus_', { requestId: second.data.requestId, requestSecret: second.data.requestSecret });
  assert(status.success && status.data.status === 'pending', 'newer request did not remain pending');
  registry = JSON.parse(properties.PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1);
  assert(registry.devices[childId] && registry.devices[childId].status === 'pending', 'expired sibling removed the newer pending device');
  assert(registry.requests[second.data.requestId], 'expired sibling removed the newer pending request');
  assert(!registry.requests[first.data.requestId], 'expired sibling request was not pruned');
});

test('unregistered, revoked, or current devices cannot approve or use the registry', () => {
  reset(); legacyParent();
  const started = begin();
  const unknown = post('devicePairingApprove_', { deviceId: 'unknown-device', pairingToken: parentToken, code: started.data.code, membershipTemplate: 'father_add_device' });
  assert(!unknown.success && unknown.error.code === 'UNAUTHORIZED_DEVICE', 'unregistered device approved');
  const current = post('devicePairingRevoke_', { deviceId: parentId, pairingToken: parentToken, targetDeviceId: parentId });
  assert(!current.success && current.error.code === 'CANNOT_REVOKE_CURRENT_DEVICE', 'current device could revoke itself');
  const registry = JSON.parse(properties.PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1);
  registry.devices[parentId].status = 'revoked';
  properties.PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1 = JSON.stringify(registry);
  const rejected = post('devicePairingApprove_', { deviceId: parentId, pairingToken: parentToken, code: started.data.code, membershipTemplate: 'father_add_device' });
  assert(!rejected.success && rejected.error.code === 'UNAUTHORIZED_DEVICE', 'revoked device approved');
});

test('a revoked Registry device is rejected even while its legacy hash remains', () => {
  reset(); legacyParent();
  context.verifyHomeControlDevicePairing_(parentId, parentToken);
  const registry = JSON.parse(properties.PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1);
  registry.devices[parentId].status = 'revoked';
  registry.devices[parentId].revokedAt = '2026-07-20T00:00:00.000Z';
  properties.PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1 = JSON.stringify(registry);
  let code = '';
  try {
    context.verifyHomeAgentDevicePairing_(parentId, parentToken, {
      getProperty: (key) => properties[key] || '', hash, now: () => new Date(), lock: context.LockService.getScriptLock(),
    });
  } catch (error) { code = error.code; }
  assert(code === 'UNAUTHORIZED_DEVICE', 'revoked registry device fell back to the legacy hash');
});

test('a revoked device can request pairing again, remains pending, and requires admin approval to activate', () => {
  reset(); legacyParent();
  const first = begin();
  assert(approve(first.data.code).success, 'initial child pairing failed');
  const revoke = post('devicePairingRevoke_', { deviceId: parentId, pairingToken: parentToken, targetDeviceId: childId });
  assert(revoke.success, 'active child could not be revoked');
  const rePair = post('devicePairingBegin_', { deviceId: childId, displayName: '再登録端末', tokenHash: hash('replacement-child-credential') });
  assert(rePair.success, 'revoked device could not create a new pairing request');
  let registry = JSON.parse(properties.PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1);
  assert(registry.devices[childId].status === 'pending', 're-pairing must remain pending before approval');
  assert(registry.devices[childId].tokenGeneration === 2, 're-pairing must rotate the stored token hash generation');
  assert(approve(rePair.data.code).success, 'admin approval did not complete re-pairing');
  registry = JSON.parse(properties.PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1);
  assert(registry.devices[childId].status === 'active', 'only admin approval may activate re-pairing');
  const activeRetry = post('devicePairingBegin_', { deviceId: childId, displayName: 'active端末', tokenHash: hash('another-child-credential') });
  assert(!activeRetry.success && activeRetry.error.code === 'DEVICE_ALREADY_REGISTERED', 'active device was allowed to re-pair');
});

test('only one concurrent approval succeeds and the twenty-device cap is enforced', () => {
  reset(); legacyParent();
  const started = begin();
  assert(approve(started.data.code).success, 'first approval failed');
  assert(!approve(started.data.code).success, 'second approval succeeded');
  const registry = JSON.parse(properties.PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1);
  for (let index = 0; index < 18; index += 1) {
    registry.devices[`device-${index}`] = { deviceId: `device-${index}`, displayName: '端末', tokenHash: hash(`token-${index}`), status: 'active', registeredAt: null, lastUsedAt: null, revokedAt: null, tokenGeneration: 1 };
  }
  properties.PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1 = JSON.stringify(registry);
  const blocked = post('devicePairingBegin_', { deviceId: 'limit-device', displayName: '上限端末', tokenHash: hash('limit-token') });
  assert(!blocked.success && blocked.error.code === 'DEVICE_LIMIT_REACHED', 'device cap was not enforced');
});

for (const item of tests) {
  try { item.fn(); console.log(`PASS ${item.name}`); }
  catch (error) { console.error(`FAIL ${item.name}: ${error.message}`); process.exitCode = 1; }
}
if (!process.exitCode) console.log(`PASS all ${tests.length} device pairing tests`);

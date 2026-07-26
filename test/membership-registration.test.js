'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'gas', 'DevicePairingService.js'), 'utf8');
const codeSource = fs.readFileSync(path.join(__dirname, '..', 'gas', 'Code.js'), 'utf8');
const deviceId = 'unassigned-device';
const otherDeviceId = 'other-device';
const pairingToken = 'test-membership-registration-credential-00000001';

function sha256(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function expectCode(result, code) { assert(!result.success && result.error && result.error.code === code, `expected ${code}`); }

function createHarness() {
  const properties = {};
  let uuidCounter = 1;
  let locked = false;
  const memberships = {};
  let membershipLookupError = null;
  const context = {
    Date, JSON, Math, Number, Object, Array, String, RegExp, Error, parseInt,
    json_: (value) => value,
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (key) => properties[key] || '', setProperty: (key, value) => { properties[key] = String(value); },
    }) },
    LockService: { getScriptLock: () => ({ waitLock: () => { if (locked) throw new Error('lock re-entry'); locked = true; }, releaseLock: () => { locked = false; } }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (_algorithm, value) => Array.from(crypto.createHash('sha256').update(String(value)).digest()),
      getUuid: () => `${String(uuidCounter++).padStart(8, '0')}-bbbb-4bbb-8bbb-bbbbbbbbbbbb`,
      formatDate: (date) => date.toISOString(),
    },
    getDeviceMembership_: (id) => {
      if (membershipLookupError) throw Object.assign(new Error(membershipLookupError), { code: membershipLookupError });
      return memberships[id] || null;
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context);

  function seedDevice(id = deviceId, token = pairingToken) {
    const registry = properties.PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1
      ? JSON.parse(properties.PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1)
      : { version: 1, devices: {}, requests: {}, approveAttempts: {} };
    registry.devices[id] = { deviceId: id, displayName: 'paired device', tokenHash: sha256(token), status: 'active', registeredAt: null, lastUsedAt: null, revokedAt: null, tokenGeneration: 1 };
    properties.PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1 = JSON.stringify(registry);
  }
  function begin(id = deviceId, token = pairingToken) { return context.membershipRegistrationBegin_({ deviceId: id, pairingToken: token }); }
  function status(request, id = deviceId, token = pairingToken, secret = request.data.requestSecret) {
    return context.membershipRegistrationStatus_({ deviceId: id, pairingToken: token, requestId: request.data.requestId, requestSecret: secret });
  }
  function registry() { return JSON.parse(properties.PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1); }
  return { begin, status, registry, seedDevice, memberships, context, setMembershipLookupError: (value) => { membershipLookupError = value; } };
}

function test(name, fn) { try { fn(); console.log(`PASS ${name}`); } catch (error) { console.error(`FAIL ${name}: ${error.message}`); process.exitCode = 1; } }

test('active paired unassigned device receives one membership request with stored hashes only', () => {
  const h = createHarness(); h.seedDevice();
  const result = h.begin();
  assert(result.success && /^\d{6}$/.test(result.data.code));
  const request = h.registry().requests[result.data.requestId];
  assert.strictEqual(request.kind, 'membership');
  assert.strictEqual(request.status, 'pending');
  assert(!JSON.stringify(request).includes(result.data.code));
  assert(!JSON.stringify(request).includes(result.data.requestSecret));
  assert.strictEqual(h.status(result).data.status, 'pending');
});

test('unpaired, assigned, or duplicate Membership devices are rejected fail-closed', () => {
  const h = createHarness(); h.seedDevice();
  expectCode(h.begin(deviceId, 'wrong-membership-registration-credential-000000'), 'UNAUTHORIZED_DEVICE');
  h.memberships[deviceId] = { deviceId, status: 'active' };
  expectCode(h.begin(), 'MEMBERSHIP_ALREADY_ASSIGNED');
  h.memberships[deviceId] = { deviceId, status: 'disabled' };
  expectCode(h.begin(), 'MEMBERSHIP_ALREADY_ASSIGNED');
  delete h.memberships[deviceId];
  h.setMembershipLookupError('MEMBERSHIP_DUPLICATE');
  expectCode(h.begin(), 'MEMBERSHIP_DUPLICATE');
});

test('only one valid pending registration may exist and code expiry permits another request', () => {
  const h = createHarness(); h.seedDevice(); const first = h.begin();
  expectCode(h.begin(), 'MEMBERSHIP_REGISTRATION_PENDING');
  const saved = h.registry();
  saved.requests[first.data.requestId].codeExpiresAt = '2020-01-01T00:00:00.000Z';
  h.context.PropertiesService.getScriptProperties().setProperty('PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1', JSON.stringify(saved));
  assert.strictEqual(h.status(first).data.status, 'expired');
  const second = h.begin();
  assert(second.success && second.data.requestId !== first.data.requestId);
});

test('status is bound to the active paired device and matching secret', () => {
  const h = createHarness(); h.seedDevice(); h.seedDevice(otherDeviceId); const request = h.begin();
  expectCode(h.status(request, otherDeviceId, pairingToken), 'MEMBERSHIP_REGISTRATION_REQUEST_INVALID');
  expectCode(h.status(request, deviceId, pairingToken, 'wrong-membership-registration-secret-000000000000'), 'MEMBERSHIP_REGISTRATION_REQUEST_INVALID');
  const saved = h.registry();
  saved.requests[request.data.requestId].status = 'approved';
  saved.requests[request.data.requestId].codeHash = '';
  h.context.PropertiesService.getScriptProperties().setProperty('PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1', JSON.stringify(saved));
  assert.strictEqual(h.status(request).data.status, 'approved');
});

test('pairing and membership request kinds cannot be used through the other status path', () => {
  const h = createHarness(); h.seedDevice(); const membership = h.begin();
  expectCode(h.context.devicePairingStatus_({ requestId: membership.data.requestId, requestSecret: membership.data.requestSecret }), 'PAIRING_REQUEST_INVALID');
  const saved = h.registry();
  saved.requests[membership.data.requestId].kind = 'pairing';
  h.context.PropertiesService.getScriptProperties().setProperty('PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1', JSON.stringify(saved));
  expectCode(h.status(membership), 'MEMBERSHIP_REGISTRATION_REQUEST_INVALID');
});

test('Code routes membership registration actions explicitly', () => {
  assert(codeSource.includes("action === 'membershipRegistrationBegin'"));
  assert(codeSource.includes("action === 'membershipRegistrationStatus'"));
});

if (!process.exitCode) console.log('PASS membership registration begin/status tests');

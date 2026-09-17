'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'gas', 'DevicePairingService.js'), 'utf8');
const codeSource = fs.readFileSync(path.join(__dirname, '..', 'gas', 'Code.js'), 'utf8');
const deviceId = 'legacy-membership-device';
const pairingToken = 'test-membership-registration-credential-00000001';
const requestSecret = 'test-membership-registration-secret-0000000001';

function sha256(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function expectCode(result, code) { assert(!result.success && result.error && result.error.code === code, `expected ${code}`); }

function createHarness() {
  const properties = {};
  let locked = false;
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
      getUuid: () => '11111111-1111-4111-8111-111111111111',
      formatDate: (date) => date.toISOString(),
    },
    getDeviceMembership_: () => null,
  };
  vm.createContext(context);
  vm.runInContext(source, context);

  const requestId = '22222222-2222-4222-8222-222222222222';
  const registry = { version: 1, devices: {}, requests: {}, approveAttempts: {} };
  registry.devices[deviceId] = {
    deviceId, displayName: 'legacy device', tokenHash: sha256(pairingToken), status: 'active',
    registeredAt: null, lastUsedAt: null, revokedAt: null, tokenGeneration: 1,
  };
  registry.requests[requestId] = {
    requestId, requestSecretHash: sha256(requestSecret), deviceId, displayName: 'legacy device',
    tokenHash: sha256(pairingToken), codeHash: sha256('123456'), kind: 'membership', status: 'pending',
    createdAt: '2026-09-17T00:00:00.000Z', expiresAt: '2099-09-17T00:15:00.000Z',
    codeExpiresAt: '2099-09-17T00:10:00.000Z',
  };
  properties.PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1 = JSON.stringify(registry);
  const status = (secret = requestSecret) => context.membershipRegistrationStatus_({ deviceId, pairingToken, requestId, requestSecret: secret });
  return { context, properties, requestId, status };
}

function test(name, fn) { try { fn(); console.log(`PASS ${name}`); } catch (error) { console.error(`FAIL ${name}: ${error.message}`); process.exitCode = 1; } }

test('membership registration has no request-creation endpoint or implementation', () => {
  assert(!source.includes('function membershipRegistrationBegin_'));
  assert(!codeSource.includes("action === 'membershipRegistrationBegin'"));
  assert(codeSource.includes("action === 'membershipRegistrationStatus'"), 'legacy status endpoint must remain available to close existing records');
});

test('legacy membership status can read and close an existing request only', () => {
  const h = createHarness();
  assert.strictEqual(h.status().data.status, 'pending');
  expectCode(h.status('wrong-membership-registration-secret-000000000'), 'MEMBERSHIP_REGISTRATION_REQUEST_INVALID');
  const registry = JSON.parse(h.properties.PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1);
  registry.requests[h.requestId].status = 'approved';
  registry.requests[h.requestId].codeHash = '';
  h.properties.PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1 = JSON.stringify(registry);
  assert.strictEqual(h.status().data.status, 'approved');
});

test('fresh device registration request contains no recovery fields', () => {
  const h = createHarness();
  const started = h.context.deviceRegistrationBegin_({ deviceId: 'fresh-device', displayName: 'fresh', tokenHash: sha256('fresh-device-token') });
  assert(started.success);
  const request = JSON.parse(h.properties.PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1).requests[started.data.requestId];
  assert.strictEqual(request.registrationState, 'PENDING');
  ['recoveryExpiresAt', 'failureCode', 'lastAttemptAt', 'membershipTemplate'].forEach((key) => assert(!Object.prototype.hasOwnProperty.call(request, key), `fresh request must not contain ${key}`));
});

if (!process.exitCode) console.log('PASS minimal registration and legacy status tests');

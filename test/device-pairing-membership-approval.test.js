'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'gas', 'DevicePairingService.js'), 'utf8');
const parentId = 'admin-device';
const childId = 'joining-device';
const parentToken = 'test-parent-credential-000000000000000000000001';
const childTokenHash = sha256('test-child-credential-000000000000000000000002');

function sha256(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function expectCode(result, code) { assert(!result.success && result.error && result.error.code === code, `expected ${code}`); }

function createHarness() {
  const properties = {};
  let nowMs = Date.parse('2026-07-20T10:00:00+09:00');
  let uuidCounter = 1;
  let locked = false;
  let saveFailures = 0;
  let adminMode = 'admin';
  let provisionFailure = false;
  const provisionCalls = [];
  const context = {
    Date, JSON, Math, Number, Object, Array, String, RegExp, Error, parseInt,
    json_: (value) => value,
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (key) => properties[key] || '',
      setProperty: (key, value) => {
        if (key === 'PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1' && saveFailures > 0) { saveFailures -= 1; throw new Error('simulated property save failure'); }
        properties[key] = String(value);
      },
    }) },
    LockService: { getScriptLock: () => ({ waitLock: () => { if (locked) throw new Error('lock re-entry'); locked = true; }, releaseLock: () => { locked = false; } }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (_algorithm, value) => Array.from(crypto.createHash('sha256').update(String(value)).digest()),
      getUuid: () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(uuidCounter++).padStart(12, '0')}`,
      formatDate: (date) => date.toISOString(),
    },
    resolveMembershipApprovalAdminWithinRegistryLock_(deviceId, credential, registry) {
      if (deviceId !== parentId || credential !== parentToken || !registry.devices[parentId] || registry.devices[parentId].status !== 'active') {
        throw Object.assign(new Error('UNAUTHORIZED_DEVICE'), { code: 'UNAUTHORIZED_DEVICE' });
      }
      if (adminMode !== 'admin') throw Object.assign(new Error('FORBIDDEN'), { code: 'FORBIDDEN' });
      return { homeId: 'home-a', memberUserId: 'father', role: 'admin', deviceId };
    },
    provisionMembershipFromApprovalTemplateWithinRegistryLock_(actor, targetDeviceId, template, operationId) {
      provisionCalls.push({ actor: Object.assign({}, actor), targetDeviceId, template, operationId });
      if (provisionFailure) throw Object.assign(new Error('MEMBERSHIP_CONFLICT'), { code: 'MEMBERSHIP_CONFLICT' });
      return { status: 'active' };
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context);

  function seedParent() {
    properties.PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1 = JSON.stringify({ version: 1, devices: {
      [parentId]: { deviceId: parentId, displayName: 'admin', tokenHash: sha256(parentToken), status: 'active', registeredAt: null, lastUsedAt: null, revokedAt: null, tokenGeneration: 1 },
    }, requests: {}, approveAttempts: {} });
  }
  function begin() { return context.devicePairingBegin_({ deviceId: childId, displayName: 'joining', tokenHash: childTokenHash }); }
  function approve(code, template, extra) { return context.devicePairingApprove_(Object.assign({ deviceId: parentId, pairingToken: parentToken, code, membershipTemplate: template }, extra || {})); }
  function registry() { return JSON.parse(properties.PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1); }
  return {
    begin, approve, context, provisionCalls, registry, seedParent,
    setAdminMode: (value) => { adminMode = value; }, setProvisionFailure: (value) => { provisionFailure = value; }, setSaveFailures: (value) => { saveFailures = value; },
    setNow: (value) => { nowMs = Date.parse(value); }, now: () => new Date(nowMs),
  };
}

function test(name, fn) { try { fn(); console.log(`PASS ${name}`); } catch (error) { console.error(`FAIL ${name}: ${error.message}`); process.exitCode = 1; } }

test('new pairing requests persist kind pairing and both fixed templates provision before activation', () => {
  for (const template of ['father_add_device', 'second_son_initial']) {
    const h = createHarness(); h.seedParent();
    const started = h.begin();
    assert.strictEqual(h.registry().requests[started.data.requestId].kind, 'pairing');
    const approved = h.approve(started.data.code, template);
    assert(approved.success && approved.data.status === 'approved');
    const saved = h.registry();
    assert.strictEqual(saved.devices[childId].status, 'active');
    assert.strictEqual(saved.requests[started.data.requestId].codeHash, '');
    assert.deepStrictEqual(h.provisionCalls[0].template, template);
    assert.strictEqual(h.provisionCalls[0].operationId, started.data.requestId);
  }
});

test('complete legacy pending requests without kind remain pairing-compatible', () => {
  const h = createHarness(); h.seedParent(); const started = h.begin();
  const saved = h.registry(); delete saved.requests[started.data.requestId].kind;
  h.context.PropertiesService.getScriptProperties().setProperty('PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1', JSON.stringify(saved));
  assert(h.approve(started.data.code, 'father_add_device').success);
});

test('membership requests with complete pairing-shaped fields are never approved as pairing', () => {
  const h = createHarness(); h.seedParent(); const started = h.begin();
  const seeded = h.registry();
  seeded.requests[started.data.requestId].kind = 'membership';
  const deviceBefore = JSON.parse(JSON.stringify(seeded.devices[childId]));
  const requestBefore = JSON.parse(JSON.stringify(seeded.requests[started.data.requestId]));
  h.context.PropertiesService.getScriptProperties().setProperty('PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1', JSON.stringify(seeded));

  const result = h.approve(started.data.code, 'father_add_device');
  expectCode(result, 'INVALID_PAIRING_CODE');
  assert.strictEqual(h.provisionCalls.length, 0);
  const saved = h.registry();
  assert.deepStrictEqual(saved.devices[childId], deviceBefore);
  assert.deepStrictEqual(saved.requests[started.data.requestId], requestBefore);
  assert(!result.success, 'membership request must not return an approval success response');
});

test('incomplete legacy pending requests are rejected fail-closed', () => {
  const h = createHarness(); h.seedParent(); const started = h.begin();
  const saved = h.registry(); delete saved.requests[started.data.requestId].kind; saved.requests[started.data.requestId].tokenHash = '';
  h.context.PropertiesService.getScriptProperties().setProperty('PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1', JSON.stringify(saved));
  expectCode(h.approve(started.data.code, 'father_add_device'), 'INVALID_PAIRING_CODE');
  assert.strictEqual(h.provisionCalls.length, 0);
});

test('non-admin and client spoofed identity values cannot alter approval', () => {
  const h = createHarness(); h.seedParent(); const started = h.begin(); h.setAdminMode('self_record');
  expectCode(h.approve(started.data.code, 'father_add_device', { userId: 'spoofed', role: 'admin', homeId: 'spoofed', capabilities: ['home.control'] }), 'FORBIDDEN');
  assert.strictEqual(h.registry().devices[childId].status, 'pending');
  assert.strictEqual(h.provisionCalls.length, 0);
});

test('expired and wrong codes keep pairing pending and obey the existing rate boundary', () => {
  const h = createHarness(); h.seedParent(); const started = h.begin();
  expectCode(h.approve('000000', 'father_add_device'), 'INVALID_PAIRING_CODE');
  const saved = h.registry(); saved.requests[started.data.requestId].codeExpiresAt = '2020-01-01T00:00:00.000Z'; h.context.PropertiesService.getScriptProperties().setProperty('PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1', JSON.stringify(saved));
  expectCode(h.approve(started.data.code, 'father_add_device'), 'INVALID_PAIRING_CODE');
  assert.strictEqual(h.provisionCalls.length, 0);
  assert.strictEqual(h.registry().devices[childId].status, 'pending');
});

test('only one concurrent approval consumes a code', () => {
  const h = createHarness(); h.seedParent(); const started = h.begin();
  assert(h.approve(started.data.code, 'father_add_device').success);
  expectCode(h.approve(started.data.code, 'father_add_device'), 'INVALID_PAIRING_CODE');
  assert.strictEqual(h.provisionCalls.length, 1);
});

test('provisioning failure leaves request and pairing pending for same request retry', () => {
  const h = createHarness(); h.seedParent(); const started = h.begin(); h.setProvisionFailure(true);
  expectCode(h.approve(started.data.code, 'second_son_initial'), 'MEMBERSHIP_CONFLICT');
  let saved = h.registry();
  assert.strictEqual(saved.devices[childId].status, 'pending');
  assert.notStrictEqual(saved.requests[started.data.requestId].codeHash, '');
  h.setProvisionFailure(false);
  assert(h.approve(started.data.code, 'second_son_initial').success);
  saved = h.registry();
  assert.strictEqual(saved.devices[childId].status, 'active');
  assert.strictEqual(h.provisionCalls[0].operationId, h.provisionCalls[1].operationId);
});

test('registry save failure preserves the request so the same operation can retry', () => {
  const h = createHarness(); h.seedParent(); const started = h.begin(); h.setSaveFailures(2);
  const failed = h.approve(started.data.code, 'father_add_device');
  assert(!failed.success, 'property save failure must not report success');
  let saved = h.registry();
  assert.strictEqual(saved.devices[childId].status, 'pending');
  assert.notStrictEqual(saved.requests[started.data.requestId].codeHash, '');
  h.setSaveFailures(0);
  assert(h.approve(started.data.code, 'father_add_device').success);
  saved = h.registry();
  assert.strictEqual(saved.devices[childId].status, 'active');
  assert.strictEqual(h.provisionCalls[0].operationId, h.provisionCalls[1].operationId);
});

if (!process.exitCode) console.log('PASS all membership-aware device pairing approval tests');

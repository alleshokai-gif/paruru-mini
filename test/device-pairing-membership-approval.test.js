'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'gas', 'DevicePairingService.js'), 'utf8');
const policySource = fs.readFileSync(path.join(__dirname, '..', 'gas', 'HomeMemberPolicy.js'), 'utf8');
const parentId = 'admin-device';
const childId = 'joining-device';
const parentToken = 'test-parent-credential-000000000000000000000001';
const childTokenHash = sha256('test-child-credential-000000000000000000000002');
const membershipDeviceId = 'paired-unassigned-device';
const membershipToken = 'test-membership-target-credential-0000000000000003';

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
    getDeviceMembership_: () => null,
  };
  vm.createContext(context);
  vm.runInContext(policySource, context);
  vm.runInContext(source, context);

  function seedParent() {
    properties.PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1 = JSON.stringify({ version: 1, devices: {
      [parentId]: { deviceId: parentId, displayName: 'admin', tokenHash: sha256(parentToken), status: 'active', registeredAt: null, lastUsedAt: null, revokedAt: null, tokenGeneration: 1 },
    }, requests: {}, approveAttempts: {} });
  }
  function seedActiveMembershipDevice() {
    const registry = JSON.parse(properties.PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1);
    registry.devices[membershipDeviceId] = {
      deviceId: membershipDeviceId, displayName: 'paired unassigned', tokenHash: sha256(membershipToken),
      status: 'active', registeredAt: '2026-07-20T00:00:00.000Z', lastUsedAt: null, revokedAt: null, tokenGeneration: 7,
    };
    properties.PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1 = JSON.stringify(registry);
  }
  function begin() { return context.devicePairingBegin_({ deviceId: childId, displayName: 'joining', tokenHash: childTokenHash }); }
  function membershipBegin() { return context.membershipRegistrationBegin_({ deviceId: membershipDeviceId, pairingToken: membershipToken }); }
  function membershipStatus(started) {
    return context.membershipRegistrationStatus_({ deviceId: membershipDeviceId, pairingToken: membershipToken, requestId: started.data.requestId, requestSecret: started.data.requestSecret });
  }
  function approve(code, template, extra) { return context.devicePairingApprove_(Object.assign({ deviceId: parentId, pairingToken: parentToken, code, membershipTemplate: template }, extra || {})); }
  function registry() { return JSON.parse(properties.PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1); }
  return {
    begin, membershipBegin, membershipStatus, approve,
    list: () => context.devicePairingList_({ deviceId: parentId, pairingToken: parentToken }),
    revoke: (targetDeviceId) => context.devicePairingRevoke_({ deviceId: parentId, pairingToken: parentToken, targetDeviceId }),
    context, provisionCalls, registry, seedParent, seedActiveMembershipDevice,
    setParentDeviceStatus: (status) => {
      const saved = registry();
      saved.devices[parentId].status = status;
      properties.PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1 = JSON.stringify(saved);
    },
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

test('approval replies carry safe stage diagnostics before generic client messaging', () => {
  const success = createHarness(); success.seedParent();
  const started = success.begin();
  const approved = success.approve(started.data.code, 'second_son_initial');
  assert.strictEqual(approved.diagnostics.operation, 'devicePairingApprove');
  assert.strictEqual(approved.diagnostics.stages.pendingRequest, 'resolved');
  assert.strictEqual(approved.diagnostics.stages.registryDevice, 'verified');
  assert.strictEqual(approved.diagnostics.stages.registryActivation, 'active');

  const failed = createHarness(); failed.seedParent();
  const pending = failed.begin(); failed.setProvisionFailure(true);
  const rejected = failed.approve(pending.data.code, 'second_son_initial');
  expectCode(rejected, 'MEMBERSHIP_CONFLICT');
  assert.strictEqual(rejected.diagnostics.operation, 'devicePairingApprove');
  assert.strictEqual(rejected.diagnostics.errorCode, 'MEMBERSHIP_CONFLICT');
  assert.strictEqual(rejected.diagnostics.stages.pendingRequest, 'resolved');
  assert.strictEqual(rejected.diagnostics.stages.registryDevice, 'verified');
});

test('complete legacy pending requests without kind remain pairing-compatible', () => {
  const h = createHarness(); h.seedParent(); const started = h.begin();
  const saved = h.registry(); delete saved.requests[started.data.requestId].kind;
  h.context.PropertiesService.getScriptProperties().setProperty('PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1', JSON.stringify(saved));
  assert(h.approve(started.data.code, 'father_add_device').success);
});

test('membership requests approve both fixed templates without changing target credentials', () => {
  for (const template of ['father_add_device', 'second_son_initial']) {
    const h = createHarness(); h.seedParent(); h.seedActiveMembershipDevice();
    const started = h.membershipBegin();
    const deviceBefore = JSON.parse(JSON.stringify(h.registry().devices[membershipDeviceId]));
    const approved = h.approve(started.data.code, template);
    assert(approved.success && approved.data.status === 'approved');
    const saved = h.registry();
    assert.deepStrictEqual(saved.devices[membershipDeviceId], deviceBefore);
    assert.strictEqual(saved.requests[started.data.requestId].status, 'approved');
    assert.strictEqual(saved.requests[started.data.requestId].codeHash, '');
    assert.strictEqual(h.provisionCalls[0].operationId, started.data.requestId);
    assert.strictEqual(h.provisionCalls[0].template, template);
    assert.strictEqual(h.membershipStatus(started).data.status, 'approved');
  }
});

test('incomplete legacy pending requests are rejected fail-closed', () => {
  const h = createHarness(); h.seedParent(); const started = h.begin();
  const saved = h.registry(); delete saved.requests[started.data.requestId].kind; saved.requests[started.data.requestId].tokenHash = '';
  h.context.PropertiesService.getScriptProperties().setProperty('PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1', JSON.stringify(saved));
  expectCode(h.approve(started.data.code, 'father_add_device'), 'INVALID_PAIRING_CODE');
  assert.strictEqual(h.provisionCalls.length, 0);
});

test('unknown request kinds cannot be approved through either pairing or membership branch', () => {
  const h = createHarness(); h.seedParent(); const started = h.begin();
  const saved = h.registry();
  saved.requests[started.data.requestId].kind = 'unknown';
  h.context.PropertiesService.getScriptProperties().setProperty('PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1', JSON.stringify(saved));
  expectCode(h.approve(started.data.code, 'father_add_device'), 'INVALID_PAIRING_CODE');
  assert.strictEqual(h.provisionCalls.length, 0);
  assert.strictEqual(h.registry().requests[started.data.requestId].status, 'pending');
});

test('non-admin and client spoofed identity values cannot alter approval', () => {
  const h = createHarness(); h.seedParent(); h.seedActiveMembershipDevice(); const started = h.membershipBegin(); h.setAdminMode('self_record');
  expectCode(h.approve(started.data.code, 'father_add_device', { userId: 'spoofed', role: 'admin', homeId: 'spoofed', capabilities: ['home.control'] }), 'FORBIDDEN');
  assert.strictEqual(h.registry().requests[started.data.requestId].status, 'pending');
  assert.strictEqual(h.provisionCalls.length, 0);
});

test('only an active admin membership can list or revoke devices', () => {
  const h = createHarness(); h.seedParent(); h.seedActiveMembershipDevice();
  assert(h.list().success, 'active admin could not list devices');
  const beforeSelfRevoke = h.registry();
  expectCode(h.revoke(parentId), 'CANNOT_REVOKE_CURRENT_DEVICE');
  assert.deepStrictEqual(h.registry(), beforeSelfRevoke, 'self revoke must not change the registry');
  assert(h.revoke(membershipDeviceId).success, 'active admin could not revoke a device');

  for (const role of ['self_record', 'guardian']) {
    const blocked = createHarness(); blocked.seedParent(); blocked.seedActiveMembershipDevice(); blocked.setAdminMode(role);
    expectCode(blocked.list(), 'FORBIDDEN');
    expectCode(blocked.revoke(parentId), 'FORBIDDEN');
    expectCode(blocked.revoke(membershipDeviceId), 'FORBIDDEN');
    assert.strictEqual(blocked.registry().devices[membershipDeviceId].status, 'active');
  }

  const inactive = createHarness(); inactive.seedParent(); inactive.seedActiveMembershipDevice(); inactive.setAdminMode('disabled');
  expectCode(inactive.list(), 'FORBIDDEN');
  expectCode(inactive.revoke(membershipDeviceId), 'FORBIDDEN');

  const revoked = createHarness(); revoked.seedParent(); revoked.seedActiveMembershipDevice(); revoked.setParentDeviceStatus('revoked');
  expectCode(revoked.list(), 'UNAUTHORIZED_DEVICE');
  expectCode(revoked.revoke(membershipDeviceId), 'UNAUTHORIZED_DEVICE');

  const unregistered = createHarness(); unregistered.seedParent();
  expectCode(unregistered.context.devicePairingList_({ deviceId: 'unknown-device', pairingToken: parentToken }), 'UNAUTHORIZED_DEVICE');
  expectCode(unregistered.context.devicePairingRevoke_({ deviceId: 'unknown-device', pairingToken: parentToken, targetDeviceId: parentId }), 'UNAUTHORIZED_DEVICE');
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

test('revoked membership target and ambiguous matching codes fail closed', () => {
  const h = createHarness(); h.seedParent(); h.seedActiveMembershipDevice(); const started = h.membershipBegin();
  let saved = h.registry();
  saved.devices[membershipDeviceId].status = 'revoked';
  h.context.PropertiesService.getScriptProperties().setProperty('PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1', JSON.stringify(saved));
  expectCode(h.approve(started.data.code, 'father_add_device'), 'PAIRING_REQUEST_INVALID');
  assert.strictEqual(h.provisionCalls.length, 0);

  const collision = createHarness(); collision.seedParent(); collision.seedActiveMembershipDevice(); const first = collision.membershipBegin();
  saved = collision.registry();
  const secondId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  saved.requests[secondId] = Object.assign({}, saved.requests[first.data.requestId], { requestId: secondId });
  collision.context.PropertiesService.getScriptProperties().setProperty('PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1', JSON.stringify(saved));
  expectCode(collision.approve(first.data.code, 'father_add_device'), 'INVALID_PAIRING_CODE');
  assert.strictEqual(collision.provisionCalls.length, 0);
  saved = collision.registry();
  assert.strictEqual(saved.requests[first.data.requestId].status, 'pending');
  assert.strictEqual(saved.requests[secondId].status, 'pending');
});

test('membership approval retries the same operation after provisioning or registry save failure', () => {
  const h = createHarness(); h.seedParent(); h.seedActiveMembershipDevice(); const started = h.membershipBegin(); h.setProvisionFailure(true);
  expectCode(h.approve(started.data.code, 'second_son_initial'), 'MEMBERSHIP_CONFLICT');
  assert.strictEqual(h.registry().requests[started.data.requestId].status, 'pending');
  h.setProvisionFailure(false);
  assert(h.approve(started.data.code, 'second_son_initial').success);
  assert.strictEqual(h.provisionCalls[0].operationId, h.provisionCalls[1].operationId);

  const retry = createHarness(); retry.seedParent(); retry.seedActiveMembershipDevice(); const retried = retry.membershipBegin(); retry.setSaveFailures(2);
  assert(!retry.approve(retried.data.code, 'father_add_device').success);
  assert.strictEqual(retry.registry().requests[retried.data.requestId].status, 'pending');
  retry.setSaveFailures(0);
  assert(retry.approve(retried.data.code, 'father_add_device').success);
  assert.strictEqual(retry.provisionCalls[0].operationId, retry.provisionCalls[1].operationId);
});

if (!process.exitCode) console.log('PASS all membership-aware device pairing approval tests');

'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

class Range {
  constructor(sheet, row, column, rows, columns) { this.sheet = sheet; this.row = row; this.column = column; this.rows = rows; this.columns = columns; }
  getValues() { return Array.from({ length: this.rows }, (_, r) => Array.from({ length: this.columns }, (_, c) => this.sheet.values[this.row - 1 + r]?.[this.column - 1 + c] ?? '')); }
  setValues(values) {
    const spreadsheet = this.sheet.spreadsheet;
    spreadsheet.writeCount += 1;
    if (spreadsheet.failOnWrites.includes(spreadsheet.writeCount)) throw new Error('simulated sheet write failure');
    values.forEach((row, r) => row.forEach((value, c) => {
      if (!this.sheet.values[this.row - 1 + r]) this.sheet.values[this.row - 1 + r] = [];
      this.sheet.values[this.row - 1 + r][this.column - 1 + c] = value;
    }));
    if (spreadsheet.corruptOnWrites.includes(spreadsheet.writeCount)) {
      const statusIndex = this.sheet.values[0].indexOf('status');
      if (statusIndex >= 0) this.sheet.values[this.row - 1][statusIndex] = 'active';
    }
    return this;
  }
}

class Sheet {
  constructor(spreadsheet, headers) { this.spreadsheet = spreadsheet; this.values = [headers.slice()]; }
  getLastColumn() { return this.values.reduce((max, row) => Math.max(max, row.length), 0); }
  getLastRow() { return this.values.length; }
  getRange(row, column, rows, columns) { return new Range(this, row, column, rows, columns); }
  getDataRange() { return new Range(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
}

class Spreadsheet {
  constructor() { this.sheets = {}; this.writeCount = 0; this.failOnWrites = []; this.corruptOnWrites = []; }
  getSheetByName(name) { return this.sheets[name] || null; }
}

const homeHeaders = ['homeId', 'memberUserId', 'displayName', 'role', 'status', 'createdAt', 'updatedAt'];
const deviceHeaders = ['deviceId', 'homeId', 'memberUserId', 'status', 'assignedBy', 'assignedAt', 'updatedAt'];
const adminDevice = 'father-device';
const sonDeviceA = 'second-son-device-a';
const sonDeviceB = 'second-son-device-b';
const adminToken = 'father-token-00000000000000000000000000000001';
const sonTokenA = 'second-son-token-a-00000000000000000000000001';
const sonTokenB = 'second-son-token-b-00000000000000000000000001';

function sha256(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function add(sheet, headers, values) { sheet.values.push(headers.map((header) => values[header] ?? '')); }
function expectCode(fn, code) { assert.throws(fn, (error) => error && error.code === code); }

function createHarness() {
  const spreadsheet = new Spreadsheet();
  spreadsheet.sheets.Home_Members = new Sheet(spreadsheet, homeHeaders);
  spreadsheet.sheets.Device_Memberships = new Sheet(spreadsheet, deviceHeaders);
  add(spreadsheet.sheets.Home_Members, homeHeaders, { homeId: 'home-a', memberUserId: 'father', displayName: '父', role: 'admin', status: 'active' });
  add(spreadsheet.sheets.Home_Members, homeHeaders, { homeId: 'home-a', memberUserId: 'second_son', displayName: '次男', role: 'self_record', status: 'active' });
  add(spreadsheet.sheets.Device_Memberships, deviceHeaders, { deviceId: adminDevice, homeId: 'home-a', memberUserId: 'father', status: 'active', assignedBy: 'bootstrap' });
  add(spreadsheet.sheets.Device_Memberships, deviceHeaders, { deviceId: sonDeviceA, homeId: 'home-a', memberUserId: 'second_son', status: 'active', assignedBy: 'pairing_approval:son-a' });
  add(spreadsheet.sheets.Device_Memberships, deviceHeaders, { deviceId: sonDeviceB, homeId: 'home-a', memberUserId: 'second_son', status: 'active', assignedBy: 'pairing_approval:son-b' });

  const properties = {
    PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1: JSON.stringify({ version: 1, devices: {
      [adminDevice]: { deviceId: adminDevice, displayName: 'father', tokenHash: sha256(adminToken), status: 'active', registeredAt: '2026-08-01T00:00:00.000Z', lastUsedAt: null, revokedAt: null, tokenGeneration: 1 },
      [sonDeviceA]: { deviceId: sonDeviceA, displayName: 'son a', tokenHash: sha256(sonTokenA), status: 'active', registeredAt: '2026-08-01T00:00:00.000Z', lastUsedAt: null, revokedAt: null, tokenGeneration: 1 },
      [sonDeviceB]: { deviceId: sonDeviceB, displayName: 'son b', tokenHash: sha256(sonTokenB), status: 'active', registeredAt: '2026-08-01T00:00:00.000Z', lastUsedAt: null, revokedAt: null, tokenGeneration: 1 },
    }, requests: {}, approveAttempts: {} }),
  };
  let locked = false;
  let propertySetCount = 0;
  let failPropertySetAt = 0;
  let dropPropertySetAt = 0;
  const context = {
    Date, JSON, Math, Number, Object, Array, String, RegExp, Error, parseInt,
    json_: (value) => value,
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (key) => properties[key] || '',
      setProperty: (key, value) => {
        propertySetCount += 1;
        if (propertySetCount === failPropertySetAt) throw new Error('simulated Registry write failure');
        if (propertySetCount === dropPropertySetAt) return;
        properties[key] = String(value);
      },
    }) },
    LockService: { getScriptLock: () => ({ waitLock: () => { if (locked) throw new Error('lock re-entry'); locked = true; }, releaseLock: () => { locked = false; } }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (_algorithm, value) => Array.from(crypto.createHash('sha256').update(String(value)).digest()),
      getUuid: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      formatDate: (date) => date.toISOString(),
    },
  };
  vm.createContext(context);
  for (const file of ['HomeMemberPolicy.js', 'HomeMembershipService.js', 'DevicePairingService.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'gas', file), 'utf8'), context);
  }

  function membership(deviceId) {
    const rows = spreadsheet.sheets.Device_Memberships.values;
    const index = rows[0].indexOf('deviceId');
    const row = rows.slice(1).find((value) => value[index] === deviceId);
    return row ? Object.fromEntries(rows[0].map((header, column) => [header, row[column] ?? ''])) : null;
  }
  function registry() { return JSON.parse(properties.PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1); }
  function revoke(deviceId) { return context.devicePairingRevoke_({ deviceId: adminDevice, pairingToken: adminToken, targetDeviceId: deviceId }); }
  function begin(deviceId, displayName, tokenHash) { return context.devicePairingBegin_({ deviceId, displayName, tokenHash }); }
  function approve(code, membershipTemplate, extra) {
    return context.devicePairingApprove_(Object.assign({ deviceId: adminDevice, pairingToken: adminToken, code, membershipTemplate }, extra || {}));
  }
  function resetFailureCounters() { propertySetCount = 0; failPropertySetAt = 0; dropPropertySetAt = 0; spreadsheet.writeCount = 0; spreadsheet.failOnWrites = []; spreadsheet.corruptOnWrites = []; }
  return {
    context, spreadsheet, membership, registry, revoke, begin, approve, resetFailureCounters,
    failNextRegistryWrite: () => { failPropertySetAt = propertySetCount + 1; },
    dropNextRegistryWrite: () => { dropPropertySetAt = propertySetCount + 1; },
    dropRegistryWriteAfter: (offset) => { dropPropertySetAt = propertySetCount + offset; },
    failPostSaveMembershipVerification: () => {
      const verify = context.verifyDisabledDeviceMembershipForRevoke_;
      let callCount = 0;
      context.verifyDisabledDeviceMembershipForRevoke_ = (snapshot) => {
        callCount += 1;
        if (callCount > 1) throw Object.assign(new Error('simulated membership verification failure'), { code: 'DEVICE_REVOKE_VERIFICATION_FAILED' });
        return verify(snapshot);
      };
    },
    duplicateHomeMember: () => add(spreadsheet.sheets.Home_Members, homeHeaders, { homeId: 'home-a', memberUserId: 'second_son', displayName: '次男', role: 'self_record', status: 'active' }),
    duplicateTargetMembership: () => add(spreadsheet.sheets.Device_Memberships, deviceHeaders, { deviceId: sonDeviceB, homeId: 'home-a', memberUserId: 'second_son', status: 'active', assignedBy: 'duplicate' }),
    setTargetHome: (homeId) => {
      const rows = spreadsheet.sheets.Device_Memberships.values;
      const deviceIndex = rows[0].indexOf('deviceId');
      rows.find((row) => row[deviceIndex] === sonDeviceB)[rows[0].indexOf('homeId')] = homeId;
    },
  };
}

{
  const h = createHarness();
  const replacementToken = 'second-son-token-b-replacement-0000000000001';
  const homeBefore = JSON.stringify(h.spreadsheet.sheets.Home_Members.values);
  assert(h.revoke(sonDeviceB).success, 'initial revoke failed');
  const disabledBefore = JSON.parse(JSON.stringify(h.membership(sonDeviceB)));
  const started = h.begin(sonDeviceB, 'son b re-registration', sha256(replacementToken));
  assert(started.success, 'revoked device could not begin re-registration');
  assert.strictEqual(h.registry().devices[sonDeviceB].status, 'pending');
  const approved = h.approve(started.data.code, 'second_son_initial', { userId: 'father', role: 'admin', homeId: 'other-home', actorUserId: 'father' });
  assert(approved.success, 'same-device re-registration approval failed');
  const active = h.membership(sonDeviceB);
  assert.strictEqual(h.registry().devices[sonDeviceB].status, 'active');
  assert.strictEqual(active.status, 'active');
  assert.strictEqual(active.homeId, disabledBefore.homeId);
  assert.strictEqual(active.memberUserId, disabledBefore.memberUserId);
  assert.strictEqual(active.assignedBy, `pairing_approval:${started.data.requestId}`);
  assert.notStrictEqual(active.assignedBy, disabledBefore.assignedBy);
  assert.strictEqual(active.assignedAt, active.updatedAt);
  assert.strictEqual(h.membership(sonDeviceA).status, 'active', 're-registration changed the sibling second_son device');
  assert.strictEqual(h.registry().devices[sonDeviceA].status, 'active', 're-registration changed the sibling Registry device');
  assert.strictEqual(JSON.stringify(h.spreadsheet.sheets.Home_Members.values), homeBefore, 're-registration changed Home_Members');
  assert.strictEqual(h.context.resolveAuthenticatedActor_(sonDeviceB, replacementToken).memberUserId, 'second_son');
  assert(h.revoke(sonDeviceB).success, 're-registered device could not be revoked again');
  assert.strictEqual(h.registry().devices[sonDeviceB].status, 'revoked');
  assert.strictEqual(h.membership(sonDeviceB).status, 'disabled');
  assert.strictEqual(h.registry().devices[sonDeviceA].status, 'active');
  assert.strictEqual(h.membership(sonDeviceA).status, 'active');
}

for (const setupRegistryFailure of [
  (h) => h.failNextRegistryWrite(),
  (h) => h.dropNextRegistryWrite(),
]) {
  const h = createHarness();
  const replacementToken = 'second-son-token-b-replacement-0000000000002';
  assert(h.revoke(sonDeviceB).success);
  const disabledBefore = JSON.parse(JSON.stringify(h.membership(sonDeviceB)));
  const started = h.begin(sonDeviceB, 'son b rollback', sha256(replacementToken));
  h.resetFailureCounters();
  setupRegistryFailure(h);
  const failed = h.approve(started.data.code, 'second_son_initial');
  assert.strictEqual(failed.success, false, 'Registry failure reported re-registration success');
  assert.deepStrictEqual(h.membership(sonDeviceB), disabledBefore, 'Registry failure did not restore the complete disabled row');
  assert.strictEqual(h.registry().devices[sonDeviceB].status, 'pending', 'Registry rollback did not restore pending device state');
  assert.strictEqual(h.registry().requests[started.data.requestId].status, 'pending', 'Registry rollback did not restore pending request state');
  h.resetFailureCounters();
  assert(h.approve(started.data.code, 'second_son_initial').success, 'same operation could not retry after a verified rollback');
}

{
  const h = createHarness();
  const replacementToken = 'second-son-token-b-replacement-0000000000003';
  assert(h.revoke(sonDeviceB).success);
  const started = h.begin(sonDeviceB, 'son b rollback failure', sha256(replacementToken));
  h.resetFailureCounters();
  h.failNextRegistryWrite();
  h.spreadsheet.failOnWrites = [2];
  const failed = h.approve(started.data.code, 'second_son_initial');
  assert.strictEqual(failed.error.code, 'MEMBERSHIP_ROLLBACK_PENDING', 'rollback failure did not return the safe error');
}

{
  const h = createHarness();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(h.context.resolveAuthenticatedActor_(sonDeviceA, sonTokenA))), { homeId: 'home-a', memberUserId: 'second_son', role: 'self_record', deviceId: sonDeviceA });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(h.context.resolveAuthenticatedActor_(sonDeviceB, sonTokenB))), { homeId: 'home-a', memberUserId: 'second_son', role: 'self_record', deviceId: sonDeviceB });
  assert.strictEqual(h.context.authorizeTargetOperation_(h.context.resolveAuthenticatedActor_(sonDeviceA, sonTokenA), 'second_son', 'health.weight.record'), true);
  assert.strictEqual(h.context.authorizeTargetOperation_(h.context.resolveAuthenticatedActor_(sonDeviceB, sonTokenB), 'second_son', 'health.daily.list'), true);
  expectCode(() => h.context.authorizeTargetOperation_(h.context.resolveAuthenticatedActor_(sonDeviceA, sonTokenA), 'father', 'health.weight.record'), 'FORBIDDEN');
  expectCode(() => h.context.resolveHomeAgentControlActor_({ deviceId: sonDeviceB, pairingToken: sonTokenB }), 'FORBIDDEN');
  const homeBefore = JSON.stringify(h.spreadsheet.sheets.Home_Members.values);
  h.resetFailureCounters();
  const result = h.revoke(sonDeviceB);
  assert(result.success, 'revoke failed');
  assert.strictEqual(h.registry().devices[sonDeviceB].status, 'revoked');
  assert.strictEqual(h.membership(sonDeviceB).status, 'disabled');
  assert.strictEqual(h.registry().devices[sonDeviceA].status, 'active');
  assert.strictEqual(h.membership(sonDeviceA).status, 'active');
  assert.strictEqual(JSON.stringify(h.spreadsheet.sheets.Home_Members.values), homeBefore, 'revoke changed Home_Members');
  assert.strictEqual(h.context.resolveAuthenticatedActor_(sonDeviceA, sonTokenA).memberUserId, 'second_son');
  expectCode(() => h.context.resolveAuthenticatedActor_(sonDeviceB, sonTokenB), 'UNAUTHORIZED_DEVICE');
}

for (const setupFailure of [
  (h) => { h.spreadsheet.failOnWrites = [1]; },
  (h) => { h.failNextRegistryWrite(); },
  (h) => { h.spreadsheet.corruptOnWrites = [1]; },
  (h) => { h.dropNextRegistryWrite(); },
]) {
  const h = createHarness();
  h.resetFailureCounters();
  setupFailure(h);
  const result = h.revoke(sonDeviceB);
  assert.strictEqual(result.success, false, 'partial failure reported success');
  assert.strictEqual(h.registry().devices[sonDeviceB].status, 'active', 'partial failure left Registry revoked');
  assert.strictEqual(h.membership(sonDeviceB).status, 'active', 'partial failure left membership disabled');
}

{
  const h = createHarness(); h.resetFailureCounters(); h.duplicateHomeMember();
  const result = h.revoke(sonDeviceB);
  assert.strictEqual(result.error.code, 'MEMBERSHIP_NOT_FOUND');
  assert.strictEqual(h.registry().devices[sonDeviceB].status, 'active');
}

{
  const h = createHarness(); h.resetFailureCounters(); h.duplicateTargetMembership();
  const result = h.revoke(sonDeviceB);
  assert.strictEqual(result.error.code, 'MEMBERSHIP_NOT_FOUND');
  assert.strictEqual(h.registry().devices[sonDeviceB].status, 'active');
}

{
  const h = createHarness(); h.resetFailureCounters(); h.setTargetHome('other-home');
  const result = h.revoke(sonDeviceB);
  assert.strictEqual(result.error.code, 'FORBIDDEN');
  assert.strictEqual(h.registry().devices[sonDeviceB].status, 'active');
}

{
  const h = createHarness(); h.resetFailureCounters();
  h.spreadsheet.failOnWrites = [2];
  h.failNextRegistryWrite();
  const result = h.revoke(sonDeviceB);
  assert.strictEqual(result.error.code, 'DEVICE_REVOKE_ROLLBACK_PENDING', 'rollback failure did not return the safe recovery code');
}

{
  const h = createHarness(); h.resetFailureCounters();
  h.failPostSaveMembershipVerification();
  h.dropRegistryWriteAfter(2);
  const result = h.revoke(sonDeviceB);
  assert.strictEqual(result.error.code, 'DEVICE_REVOKE_ROLLBACK_PENDING', 'silent rollback Registry failure was not detected by read-back');
  assert.strictEqual(h.registry().devices[sonDeviceB].status, 'revoked', 'test setup did not retain the simulated partial Registry state');
  assert.strictEqual(h.membership(sonDeviceB).status, 'active', 'membership rollback should still restore its side before reporting pending recovery');
}

console.log('PASS synchronized one-of-N revoke, read-back verification, authorization, and rollback safety');

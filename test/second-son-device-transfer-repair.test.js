'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

class Range {
  constructor(sheet, row, column, rows, columns) { this.sheet = sheet; this.row = row; this.column = column; this.rows = rows; this.columns = columns; }
  getValues() { return Array.from({ length: this.rows }, (_, row) => Array.from({ length: this.columns }, (_, column) => this.sheet.values[this.row - 1 + row]?.[this.column - 1 + column] ?? '')); }
  setValues(values) {
    this.sheet.beforeWrite(this.row, values);
    values.forEach((row, rowOffset) => row.forEach((value, columnOffset) => {
      if (!this.sheet.values[this.row - 1 + rowOffset]) this.sheet.values[this.row - 1 + rowOffset] = [];
      this.sheet.values[this.row - 1 + rowOffset][this.column - 1 + columnOffset] = value;
    }));
    return this;
  }
}

class Sheet {
  constructor(headers) { this.values = [headers.slice()]; this.writeHook = () => {}; }
  getLastColumn() { return this.values.reduce((maximum, row) => Math.max(maximum, row.length), 0); }
  getLastRow() { return this.values.length; }
  getRange(row, column, rows, columns) { return new Range(this, row, column, rows, columns); }
  getDataRange() { return new Range(this, 1, 1, this.getLastRow(), this.getLastColumn()); }
  deleteRow(row) { this.values.splice(row - 1, 1); }
  setFrozenRows() {}
  beforeWrite(row, values) { this.writeHook(row, values); }
}

const root = path.resolve(__dirname, '..');
const homeHeaders = ['homeId', 'memberUserId', 'displayName', 'role', 'status', 'createdAt', 'updatedAt'];
const deviceHeaders = ['deviceId', 'homeId', 'memberUserId', 'status', 'assignedBy', 'assignedAt', 'updatedAt'];
const OLD = '11111111-1111-4111-8111-111111111111';
const NEW = '22222222-2222-4222-8222-222222222222';
const REQUEST = '33333333-3333-4333-8333-333333333333';

function createHarness(options = {}) {
  const spreadsheet = {
    sheets: {},
    getSheetByName(name) { return this.sheets[name] || null; },
    insertSheet(name) { const sheet = new Sheet([]); this.sheets[name] = sheet; return sheet; },
  };
  spreadsheet.sheets.Home_Members = new Sheet(homeHeaders);
  spreadsheet.sheets.Device_Memberships = new Sheet(deviceHeaders);
  spreadsheet.sheets.Home_Members.values.push(['paluru-home', 'father', '父', 'admin', 'active', '', '']);
  spreadsheet.sheets.Home_Members.values.push(['paluru-home', 'second_son', '谺�E�逕ｷ', 'self_record', 'active', '', '']);
  spreadsheet.sheets.Home_Members.values.push(['other-home', 'second_son', '谺�E�逕ｷ', 'self_record', 'active', '', '']);
  spreadsheet.sheets.Device_Memberships.values.push(['father-device', 'paluru-home', 'father', 'active', 'bootstrap', '', '']);
  spreadsheet.sheets.Device_Memberships.values.push([OLD, 'paluru-home', 'second_son', 'active', 'pairing_approval:old', 'old-time', 'old-time']);
  spreadsheet.sheets.Device_Memberships.values.push(['other-device', 'other-home', 'second_son', 'active', 'other', '', '']);
  let setCalls = 0;
  let failRestore = false;
  if (options.failDuringWrite) {
    spreadsheet.sheets.Device_Memberships.writeHook = (row) => {
      if (row > 4) throw new Error('append failed');
      if (failRestore && row === 3) throw new Error('rollback write failed');
    };
  }
  const registry = {
    version: 1,
    devices: {
      [OLD]: { deviceId: OLD, status: options.oldStatus || 'revoked', tokenHash: 'a'.repeat(64), registeredAt: '', lastUsedAt: '', revokedAt: '2026-07-31T21:35:00+09:00' },
      [NEW]: { deviceId: NEW, status: options.newStatus || 'pending', tokenHash: 'b'.repeat(64), registeredAt: null, lastUsedAt: null, revokedAt: null },
    },
    requests: {
      [REQUEST]: { requestId: REQUEST, deviceId: NEW, displayName: '次男Chrome', tokenHash: 'b'.repeat(64), requestSecretHash: 'c'.repeat(64), codeHash: 'd'.repeat(64), kind: 'pairing', status: options.requestStatus || 'pending', createdAt: '2026-07-31T21:40:00+09:00', expiresAt: '2026-08-01T21:40:00+09:00', codeExpiresAt: '2026-08-01T21:40:00+09:00', approvedAt: null, approvedByDeviceId: null },
    },
    approveAttempts: {},
  };
  const properties = { PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1: JSON.stringify(registry) };
  const lock = { waitLock() {}, releaseLock() {} };
  const context = {
    Array, Boolean, Date, Error, JSON, Math, Number, Object, RegExp, String,
    console: { log() {} },
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (name) => properties[name] || '', setProperty: (name, value) => { setCalls += 1; properties[name] = value; } }) },
    LockService: { getScriptLock: () => lock },
    Utilities: { formatDate: () => '2026-07-31T22:00:00+09:00', getUuid: () => REQUEST },
    homeControlPairingError_: (code) => Object.assign(new Error(code), { code }),
  };
  vm.createContext(context);
  ['HomeMemberPolicy.js', 'HomeMembershipService.js', 'DevicePairingService.js', 'SecondSonDeviceTransferRepair.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, 'gas', file), 'utf8'), context, { filename: file });
  });
  const secondSonDisplayName = context.getHomeMemberPolicy_('second_son').displayName;
  spreadsheet.sheets.Home_Members.values[2][2] = secondSonDisplayName;
  spreadsheet.sheets.Home_Members.values[3][2] = secondSonDisplayName;
  const input = { homeId: 'paluru-home', memberUserId: 'second_son', oldDeviceId: OLD, newDeviceId: NEW, pendingRequestId: REQUEST };
  return {
    context, spreadsheet, input,
    getRegistry: () => JSON.parse(properties.PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1),
    setRegistry: (value) => { properties.PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1 = JSON.stringify(value); },
    setRepairInput: () => {
      properties.PALURU_SECOND_SON_TRANSFER_OLD_DEVICE_ID = OLD;
      properties.PALURU_SECOND_SON_TRANSFER_NEW_DEVICE_ID = NEW;
      properties.PALURU_SECOND_SON_TRANSFER_PENDING_REQUEST_ID = REQUEST;
    },
    setFailRestore(value) { failRestore = value; },
    setCalls: () => setCalls,
  };
}

function expectCode(fn, code) {
  try { fn(); } catch (error) { assert.strictEqual(error.code, code); return; }
  throw new Error('expected ' + code);
}

function secondSonRows(harness) {
  return harness.spreadsheet.sheets.Device_Memberships.values.slice(1).filter((row) => row[1] === 'paluru-home' && row[2] === 'second_son');
}

{
  const h = createHarness();
  h.setRepairInput();
  const report = h.context.repairSecondSonDeviceTransferDryRun_();
  assert.strictEqual(report.canRepair, true);
  assert.strictEqual(report.oldRegistryStatus, 'revoked');
  assert.strictEqual(report.newRegistryStatus, 'pending');
  assert.strictEqual(report.pendingRequestDeviceId, NEW);
  assert.strictEqual(report.homeMemberCount, 1);
  assert.strictEqual(h.setCalls(), 0, 'dry-run wrote Registry');
  assert.deepStrictEqual(secondSonRows(h).map((row) => row[0]), [OLD], 'dry-run changed memberships');
}

[
  {
    name: 'new Registry must be pending',
    change(h) { const registry = h.getRegistry(); registry.devices[NEW].status = 'active'; h.setRegistry(registry); },
    reason: 'NEW_REGISTRY_NOT_PENDING',
  },
  {
    name: 'pairing request must be pending and belong to new device',
    change(h) { const registry = h.getRegistry(); registry.requests[REQUEST].deviceId = OLD; h.setRegistry(registry); },
    reason: 'PENDING_REQUEST_INVALID',
  },
  {
    name: 'Home_Members must contain one active policy matching second son',
    change(h) { h.spreadsheet.sheets.Home_Members.values.push(['paluru-home', 'second_son', 'duplicate', 'self_record', 'active', '', '']); },
    reason: 'HOME_MEMBER_INVALID',
  },
  {
    name: 'old Device_Memberships row must be active',
    change(h) { h.spreadsheet.sheets.Device_Memberships.values[2][3] = 'disabled'; },
    reason: 'OLD_DEVICE_MEMBERSHIP_INVALID',
  },
  {
    name: 'new device must not already have a membership row',
    change(h) { h.spreadsheet.sheets.Device_Memberships.values.push([NEW, 'paluru-home', 'second_son', 'active', 'unexpected', '', '']); },
    reason: 'NEW_DEVICE_MEMBERSHIP_EXISTS',
  },
  {
    name: 'old device must be the sole active second-son membership',
    change(h) { h.spreadsheet.sheets.Device_Memberships.values.push(['another-device', 'paluru-home', 'second_son', 'active', 'unexpected', '', '']); },
    reason: 'ACTIVE_DEVICE_MEMBERSHIPS_INVALID',
  },
].forEach((testCase) => {
  const h = createHarness();
  testCase.change(h);
  const beforeRegistry = JSON.stringify(h.getRegistry());
  const beforeMemberships = JSON.stringify(h.spreadsheet.sheets.Device_Memberships.values);
  const report = h.context.repairSecondSonDeviceTransferDryRun_(h.input);
  assert.strictEqual(report.canRepair, false, testCase.name + ' dry-run unexpectedly passed');
  assert(report.blockingReasons.includes(testCase.reason), testCase.name + ' reason missing');
  expectCode(() => h.context.repairSecondSonDeviceTransfer_(h.input), 'DEVICE_TRANSFER_PRECONDITION_FAILED');
  assert.strictEqual(h.setCalls(), 0, testCase.name + ' wrote Registry');
  assert.strictEqual(JSON.stringify(h.getRegistry()), beforeRegistry, testCase.name + ' changed Registry');
  assert.strictEqual(JSON.stringify(h.spreadsheet.sheets.Device_Memberships.values), beforeMemberships, testCase.name + ' changed memberships');
});

{
  const h = createHarness({ oldStatus: 'active' });
  const before = JSON.stringify(h.getRegistry());
  const report = h.context.repairSecondSonDeviceTransferDryRun_(h.input);
  assert.strictEqual(report.canRepair, false);
  assert(report.blockingReasons.includes('OLD_REGISTRY_NOT_REVOKED'));
  expectCode(() => h.context.repairSecondSonDeviceTransfer_(h.input), 'DEVICE_TRANSFER_PRECONDITION_FAILED');
  assert.strictEqual(JSON.stringify(h.getRegistry()), before, 'blocked repair wrote Registry');
  assert.deepStrictEqual(secondSonRows(h).map((row) => row[0]), [OLD], 'blocked repair changed memberships');
}

{
  const h = createHarness();
  const result = h.context.repairSecondSonDeviceTransfer_(h.input);
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.alreadyRepaired, false);
  assert.deepStrictEqual(secondSonRows(h).map((row) => [row[0], row[3]]), [[OLD, 'disabled'], [NEW, 'active']]);
  const saved = h.getRegistry();
  assert.strictEqual(saved.devices[OLD].status, 'revoked');
  assert.strictEqual(saved.devices[NEW].status, 'active');
  assert.strictEqual(saved.requests[REQUEST].status, 'approved');
  assert.strictEqual(saved.requests[REQUEST].codeHash, '');
  assert.strictEqual(h.spreadsheet.sheets.Home_Members.values.filter((row) => row[0] === 'paluru-home' && row[1] === 'second_son').length, 1);
  assert.deepStrictEqual(h.spreadsheet.sheets.Device_Memberships.values[1], ['father-device', 'paluru-home', 'father', 'active', 'bootstrap', '', '']);
  assert.deepStrictEqual(h.spreadsheet.sheets.Device_Memberships.values[3], ['other-device', 'other-home', 'second_son', 'active', 'other', '', '']);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(h.context.getActiveSelfRecordMembers_('paluru-home'))), [{ userId: 'second_son', displayName: h.context.getHomeMemberPolicy_('second_son').displayName }]);
  assert.strictEqual(h.context.getDeviceMembership_(NEW).memberUserId, 'second_son', 'new active membership cannot resolve the Chrome actor');
  const rerun = h.context.repairSecondSonDeviceTransfer_(h.input);
  assert.strictEqual(rerun.alreadyRepaired, true, 'completed repair was not idempotent');
}

{
  const h = createHarness({ failDuringWrite: true });
  const before = JSON.stringify(h.getRegistry());
  expectCode(() => h.context.repairSecondSonDeviceTransfer_(h.input), undefined);
  assert.strictEqual(JSON.stringify(h.getRegistry()), before, 'failed repair did not restore Registry');
  assert.deepStrictEqual(secondSonRows(h).map((row) => [row[0], row[3]]), [[OLD, 'active']], 'failed repair did not restore old membership');
}

{
  const h = createHarness({ failDuringWrite: true });
  h.setFailRestore(true);
  expectCode(() => h.context.repairSecondSonDeviceTransfer_(h.input), 'DEVICE_TRANSFER_ROLLBACK_PENDING');
}

console.log('PASS second-son device transfer dry-run, preconditions, transfer, rollback, idempotency, and isolation');

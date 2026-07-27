'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

class Range {
  constructor(sheet, row, column, rows, columns) { this.sheet = sheet; this.row = row; this.column = column; this.rows = rows; this.columns = columns; }
  getValues() { return Array.from({ length: this.rows }, (_, r) => Array.from({ length: this.columns }, (_, c) => this.sheet.values[this.row - 1 + r]?.[this.column - 1 + c] ?? '')); }
  setValues(values) {
    this.sheet.spreadsheet.writeCount += 1;
    if (this.sheet.spreadsheet.failOnWrite === this.sheet.spreadsheet.writeCount || this.sheet.spreadsheet.failOnWrites.includes(this.sheet.spreadsheet.writeCount)) throw new Error('simulated sheet failure');
    values.forEach((row, r) => row.forEach((value, c) => {
      if (!this.sheet.values[this.row - 1 + r]) this.sheet.values[this.row - 1 + r] = [];
      this.sheet.values[this.row - 1 + r][this.column - 1 + c] = value;
    }));
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
  constructor() { this.sheets = {}; this.writeCount = 0; this.failOnWrite = 0; this.failOnWrites = []; }
  getSheetByName(name) { return this.sheets[name] || null; }
}

const homeHeaders = ['homeId', 'memberUserId', 'displayName', 'role', 'status', 'createdAt', 'updatedAt'];
const deviceHeaders = ['deviceId', 'homeId', 'memberUserId', 'status', 'assignedBy', 'assignedAt', 'updatedAt'];

function add(sheet, headers, values) { sheet.values.push(headers.map((header) => values[header] || '')); }
function expectCode(fn, code) {
  try { fn(); } catch (error) { assert.strictEqual(String(error && error.code), String(code)); return; }
  assert.fail(`expected ${code}`);
}
function find(sheet, headers, key, value) { return sheet.values.slice(1).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] || '']))).filter((row) => row[key] === value); }

function setup(options = {}) {
  const spreadsheet = new Spreadsheet();
  spreadsheet.sheets.Home_Members = new Sheet(spreadsheet, homeHeaders);
  spreadsheet.sheets.Device_Memberships = new Sheet(spreadsheet, deviceHeaders);
  add(spreadsheet.sheets.Home_Members, homeHeaders, { homeId: 'home-a', memberUserId: 'father', displayName: '父', role: options.adminRole || 'admin', status: 'active' });
  add(spreadsheet.sheets.Device_Memberships, deviceHeaders, { deviceId: 'admin-device', homeId: options.adminDeviceHome || 'home-a', memberUserId: 'father', status: 'active' });
  if (options.duplicateTargetDevice) {
    add(spreadsheet.sheets.Device_Memberships, deviceHeaders, { deviceId: 'target-device', homeId: 'home-a', memberUserId: 'father', status: 'disabled' });
    add(spreadsheet.sheets.Device_Memberships, deviceHeaders, { deviceId: 'target-device', homeId: 'home-a', memberUserId: 'father', status: 'disabled' });
  }
  if (options.existingSecondSon) add(spreadsheet.sheets.Home_Members, homeHeaders, { homeId: 'home-a', memberUserId: 'second_son', displayName: '次男', role: 'self_record', status: 'disabled' });
  const registry = { devices: { 'admin-device': { status: 'active' } } };
  const context = {
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
    verifyHomeControlRegistryDevice_(deviceId, credential, suppliedRegistry) {
      assert.strictEqual(suppliedRegistry, registry, 'must use supplied Registry while lock is held');
      if (deviceId !== 'admin-device' || credential !== 'credential') throw Object.assign(new Error('UNAUTHORIZED_DEVICE'), { code: 'UNAUTHORIZED_DEVICE' });
    },
    Error, String, Object, Array,
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'gas', 'HomeMemberPolicy.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'gas', 'HomeMembershipService.js'), 'utf8'), context);
  return { spreadsheet, registry, api: context };
}

function adminActor(api, registry) { return api.resolveMembershipApprovalAdminWithinRegistryLock_('admin-device', 'credential', registry, {}, '2026-07-26T12:00:00+09:00'); }

{
  const { spreadsheet, registry, api } = setup();
  const result = api.provisionMembershipFromApprovalTemplateWithinRegistryLock_(adminActor(api, registry), 'father-phone', 'father_add_device', 'op-father', '2026-07-26T12:00:00+09:00');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(result)), { memberUserId: 'father', role: 'admin', deviceId: 'father-phone', status: 'active' });
  assert.strictEqual(find(spreadsheet.sheets.Home_Members, homeHeaders, 'memberUserId', 'father').length, 1);
  assert.strictEqual(find(spreadsheet.sheets.Device_Memberships, deviceHeaders, 'deviceId', 'father-phone')[0].status, 'active');
}

{
  const { spreadsheet, registry, api } = setup();
  const actor = adminActor(api, registry);
  api.provisionMembershipFromApprovalTemplateWithinRegistryLock_(actor, 'son-phone', 'second_son_initial', 'op-son', '2026-07-26T12:00:00+09:00', { userId: 'spoofed', role: 'admin', homeId: 'spoofed', capabilities: ['home.control'] });
  const son = find(spreadsheet.sheets.Home_Members, homeHeaders, 'memberUserId', 'second_son')[0];
  const device = find(spreadsheet.sheets.Device_Memberships, deviceHeaders, 'deviceId', 'son-phone')[0];
  assert.deepStrictEqual({ homeId: son.homeId, role: son.role, deviceHomeId: device.homeId, memberUserId: device.memberUserId }, { homeId: 'home-a', role: 'self_record', deviceHomeId: 'home-a', memberUserId: 'second_son' });
}

expectCode(() => { const { registry, api } = setup({ adminRole: 'self_record' }); adminActor(api, registry); }, 'FORBIDDEN');
expectCode(() => { const { registry, api } = setup({ existingSecondSon: true }); api.provisionMembershipFromApprovalTemplateWithinRegistryLock_(adminActor(api, registry), 'son-phone', 'second_son_initial', 'op-son', '2026-07-26T12:00:00+09:00'); }, 'MEMBERSHIP_CONFLICT');
expectCode(() => { const { registry, api } = setup({ duplicateTargetDevice: true }); api.provisionMembershipFromApprovalTemplateWithinRegistryLock_(adminActor(api, registry), 'target-device', 'father_add_device', 'op-father', '2026-07-26T12:00:00+09:00'); }, 'MEMBERSHIP_NOT_FOUND');
expectCode(() => { const { registry, api } = setup({ adminDeviceHome: 'home-b' }); adminActor(api, registry); }, 'FORBIDDEN');

{
  const { spreadsheet, registry, api } = setup();
  spreadsheet.failOnWrite = 3; // Home member, disabled device membership, then active device membership.
  assert.throws(() => api.provisionMembershipFromApprovalTemplateWithinRegistryLock_(adminActor(api, registry), 'son-phone', 'second_son_initial', 'op-retry', '2026-07-26T12:00:00+09:00'));
  const son = find(spreadsheet.sheets.Home_Members, homeHeaders, 'memberUserId', 'second_son')[0];
  const device = find(spreadsheet.sheets.Device_Memberships, deviceHeaders, 'deviceId', 'son-phone')[0];
  assert.strictEqual(son.status, 'disabled', 'failed new member must not remain active');
  assert.strictEqual(device.status, 'disabled', 'failed device membership must not become active');
  spreadsheet.failOnWrite = 0;
  assert.strictEqual(api.provisionMembershipFromApprovalTemplateWithinRegistryLock_(adminActor(api, registry), 'son-phone', 'second_son_initial', 'op-retry', '2026-07-26T12:00:00+09:00').status, 'active');
  expectCode(() => api.provisionMembershipFromApprovalTemplateWithinRegistryLock_(adminActor(api, registry), 'son-phone', 'second_son_initial', 'other-operation', '2026-07-26T12:00:00+09:00'), 'MEMBERSHIP_CONFLICT');
}

for (const failurePoint of [1, 2, 3]) {
  const { spreadsheet, registry, api } = setup();
  spreadsheet.failOnWrite = failurePoint;
  assert.throws(() => api.provisionMembershipFromApprovalTemplateWithinRegistryLock_(adminActor(api, registry), 'son-phone', 'second_son_initial', `op-write-${failurePoint}`, '2026-07-26T12:00:00+09:00'));
  spreadsheet.failOnWrite = 0;
  assert.strictEqual(api.provisionMembershipFromApprovalTemplateWithinRegistryLock_(adminActor(api, registry), 'son-phone', 'second_son_initial', `op-write-${failurePoint}`, '2026-07-26T12:00:00+09:00').status, 'active', `write ${failurePoint} must resume only with the same operation`);
}

{
  const { spreadsheet, registry, api } = setup();
  spreadsheet.failOnWrite = 2; // disabled father device membership exists; activation fails.
  assert.throws(() => api.provisionMembershipFromApprovalTemplateWithinRegistryLock_(adminActor(api, registry), 'father-phone', 'father_add_device', 'op-father-retry', '2026-07-26T12:00:00+09:00'));
  assert.strictEqual(find(spreadsheet.sheets.Device_Memberships, deviceHeaders, 'deviceId', 'father-phone')[0].status, 'disabled');
  assert.strictEqual(find(spreadsheet.sheets.Home_Members, homeHeaders, 'memberUserId', 'father')[0].status, 'active');
  spreadsheet.failOnWrite = 0;
  assert.strictEqual(api.provisionMembershipFromApprovalTemplateWithinRegistryLock_(adminActor(api, registry), 'father-phone', 'father_add_device', 'op-father-retry', '2026-07-26T12:00:00+09:00').status, 'active');
}

{
  const { spreadsheet, registry, api } = setup();
  spreadsheet.failOnWrite = 3;
  assert.throws(() => api.provisionMembershipFromApprovalTemplateWithinRegistryLock_(adminActor(api, registry), 'son-phone', 'second_son_initial', 'op-device-bound', '2026-07-26T12:00:00+09:00'));
  spreadsheet.failOnWrite = 0;
  expectCode(() => api.provisionMembershipFromApprovalTemplateWithinRegistryLock_(adminActor(api, registry), 'other-phone', 'second_son_initial', 'op-device-bound', '2026-07-26T12:00:00+09:00'), 'MEMBERSHIP_CONFLICT');
}

{
  const { spreadsheet, registry, api } = setup();
  const actor = adminActor(api, registry);
  api.provisionMembershipFromApprovalTemplateWithinRegistryLock_(actor, 'father-phone', 'father_add_device', 'op-idempotent', '2026-07-26T12:00:00+09:00');
  const counts = [spreadsheet.sheets.Home_Members.getLastRow(), spreadsheet.sheets.Device_Memberships.getLastRow()];
  assert.strictEqual(api.provisionMembershipFromApprovalTemplateWithinRegistryLock_(actor, 'father-phone', 'father_add_device', 'op-idempotent', '2026-07-26T12:00:00+09:00').status, 'active');
  assert.deepStrictEqual([spreadsheet.sheets.Home_Members.getLastRow(), spreadsheet.sheets.Device_Memberships.getLastRow()], counts, 'completed operation must be idempotent');
}

{
  const { spreadsheet, registry, api } = setup();
  spreadsheet.failOnWrites = [3, 4]; // active device write fails, then rollback of the new Home member fails.
  expectCode(() => api.provisionMembershipFromApprovalTemplateWithinRegistryLock_(adminActor(api, registry), 'son-phone', 'second_son_initial', 'op-rollback', '2026-07-26T12:00:00+09:00'), 'MEMBERSHIP_ROLLBACK_PENDING');
  assert.strictEqual(find(spreadsheet.sheets.Device_Memberships, deviceHeaders, 'deviceId', 'son-phone')[0].status, 'disabled');
  assert.strictEqual(find(spreadsheet.sheets.Home_Members, homeHeaders, 'memberUserId', 'second_son')[0].status, 'active');
  spreadsheet.failOnWrite = 0;
  spreadsheet.failOnWrites = [];
  assert.strictEqual(api.provisionMembershipFromApprovalTemplateWithinRegistryLock_(adminActor(api, registry), 'son-phone', 'second_son_initial', 'op-rollback', '2026-07-26T12:00:00+09:00').status, 'active');
}

console.log('PASS membership approval provisioning templates, operation-bound retry, fail-closed conflicts, and rollback recovery');

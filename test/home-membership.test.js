'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

class Range {
  constructor(sheet, row, column, rows, columns) { this.sheet = sheet; this.row = row; this.column = column; this.rows = rows; this.columns = columns; }
  getValues() { return Array.from({ length: this.rows }, (_, r) => Array.from({ length: this.columns }, (_, c) => this.sheet.values[this.row - 1 + r]?.[this.column - 1 + c] ?? '')); }
  setValues(values) { values.forEach((row, r) => row.forEach((value, c) => { if (!this.sheet.values[this.row - 1 + r]) this.sheet.values[this.row - 1 + r] = []; this.sheet.values[this.row - 1 + r][this.column - 1 + c] = value; })); return this; }
}
class Sheet {
  constructor(headers) { this.values = headers ? [headers.slice()] : []; }
  getLastColumn() { return this.values.reduce((max, row) => Math.max(max, row.length), 0); }
  getLastRow() { return this.values.length; }
  getRange(row, column, rows, columns) { return new Range(this, row, column, rows, columns); }
  getDataRange() { return new Range(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  setFrozenRows() {}
}
class Spreadsheet {
  constructor() { this.sheets = {}; }
  getSheetByName(name) { return this.sheets[name] || null; }
  insertSheet(name) { const sheet = new Sheet(); this.sheets[name] = sheet; return sheet; }
}
function load(spreadsheet, properties) {
  const context = {
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => properties[key] || '' }) },
    Utilities: { formatDate: () => '2026-07-24T12:00:00+09:00' },
    verifyHomeControlDevicePairing_: (_deviceId, pairingToken) => String(pairingToken || '') === 'pairing'
      ? ({ handled: true, authorized: true })
      : ({ handled: true, authorized: false }),
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'gas', 'HomeMemberPolicy.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'gas', 'HomeMembershipService.js'), 'utf8'), context);
  return context;
}
function addRow(sheet, headers, valueByHeader) { sheet.values.push(headers.map((header) => valueByHeader[header] || '')); }
function expectCode(fn, code) { assert.throws(fn, (error) => error && error.code === code); }

const homeHeaders = ['status', 'memberUserId', 'role', 'homeId', 'displayName', 'updatedAt', 'createdAt'];
const deviceHeaders = ['memberUserId', 'updatedAt', 'homeId', 'deviceId', 'status', 'assignedBy', 'assignedAt'];
const spreadsheet = new Spreadsheet();
spreadsheet.sheets.Home_Members = new Sheet(homeHeaders);
spreadsheet.sheets.Device_Memberships = new Sheet(deviceHeaders);
addRow(spreadsheet.sheets.Home_Members, homeHeaders, { homeId: 'home-a', memberUserId: 'father', displayName: '父', role: 'admin', status: 'active' });
addRow(spreadsheet.sheets.Home_Members, homeHeaders, { homeId: 'home-a', memberUserId: 'mother', displayName: '母', role: 'guardian', status: 'active' });
addRow(spreadsheet.sheets.Home_Members, homeHeaders, { homeId: 'home-a', memberUserId: 'second_son', displayName: '次男', role: 'self_record', status: 'active' });
addRow(spreadsheet.sheets.Home_Members, homeHeaders, { homeId: 'home-b', memberUserId: 'other_child', role: 'self_record', status: 'active' });
addRow(spreadsheet.sheets.Device_Memberships, deviceHeaders, { deviceId: 'father-phone', homeId: 'home-a', memberUserId: 'father', status: 'active' });
addRow(spreadsheet.sheets.Device_Memberships, deviceHeaders, { deviceId: 'mother-phone', homeId: 'home-a', memberUserId: 'mother', status: 'active' });
addRow(spreadsheet.sheets.Device_Memberships, deviceHeaders, { deviceId: 'son-phone', homeId: 'home-a', memberUserId: 'second_son', status: 'active' });
addRow(spreadsheet.sheets.Device_Memberships, deviceHeaders, { deviceId: 'old-phone', homeId: 'home-a', memberUserId: 'second_son', status: 'disabled' });
addRow(spreadsheet.sheets.Device_Memberships, deviceHeaders, { deviceId: 'unknown-phone', homeId: 'home-b', memberUserId: 'other_child', status: 'active' });
const api = load(spreadsheet, {});

assert.deepStrictEqual(JSON.parse(JSON.stringify(api.resolveAuthenticatedActor_('father-phone', 'pairing'))), { homeId: 'home-a', memberUserId: 'father', role: 'admin', deviceId: 'father-phone' });
assert.deepStrictEqual(JSON.parse(JSON.stringify(api.resolveHomeAgentReadActor_({ deviceId: 'father-phone', pairingToken: 'pairing', userId: 'spoofed', role: 'self_record' }))), { homeId: 'home-a', memberUserId: 'father', displayName: '父', role: 'admin', capabilities: ['home.read', 'home.control', 'calendar.family.read', 'calendar.family.create', 'calendar.family.edit_own', 'calendar.family.delete_own', 'memo.self.read', 'memo.self.create', 'memo.self.update', 'memo.self.delete', 'health.self.read', 'health.self.record', 'health.supervision.read', 'health.supervision.record', 'pet.health.read', 'pet.health.record'], deviceId: 'father-phone' });
assert.strictEqual(api.resolveHomeAgentReadActor_({ deviceId: 'son-phone', pairingToken: 'pairing' }).memberUserId, 'second_son');
assert.deepStrictEqual(JSON.parse(JSON.stringify(api.resolveHomeAgentReadActor_({ deviceId: 'mother-phone', pairingToken: 'pairing' }))), { homeId: 'home-a', memberUserId: 'mother', displayName: '母', role: 'guardian', capabilities: ['home.read', 'calendar.family.read', 'calendar.family.create', 'calendar.family.edit_own', 'calendar.family.delete_own', 'memo.self.read', 'memo.self.create', 'memo.self.update', 'memo.self.delete', 'health.self.read', 'health.self.record', 'health.supervision.read', 'health.supervision.record', 'pet.health.read', 'pet.health.record'], deviceId: 'mother-phone' });
assert.deepStrictEqual(JSON.parse(JSON.stringify(api.getMembershipContext_({ deviceId: 'mother-phone', pairingToken: 'pairing' }))), { memberUserId: 'mother', displayName: '母', role: 'guardian', calendarSuffix: '（母）', addressTerms: { paruru: '', nurseOkan: '' }, capabilities: ['home.read', 'calendar.family.read', 'calendar.family.create', 'calendar.family.edit_own', 'calendar.family.delete_own', 'memo.self.read', 'memo.self.create', 'memo.self.update', 'memo.self.delete', 'health.self.read', 'health.self.record', 'health.supervision.read', 'health.supervision.record', 'pet.health.read', 'pet.health.record'], allowedViews: ['home', 'inbox', 'nurse-okan', 'popio-health'] });
expectCode(() => api.resolveHomeAgentReadActor_({ deviceId: 'son-phone', pairingToken: '' }), 'UNAUTHORIZED_DEVICE');
assert.strictEqual(api.resolveHomeAgentControlActor_({ deviceId: 'father-phone', pairingToken: 'pairing', userId: 'spoofed', role: 'self_record' }).memberUserId, 'father');
expectCode(() => api.resolveHomeAgentControlActor_({ deviceId: 'son-phone', pairingToken: 'pairing' }), 'FORBIDDEN');
expectCode(() => api.resolveHomeAgentControlActor_({ deviceId: 'mother-phone', pairingToken: 'pairing' }), 'FORBIDDEN');
expectCode(() => api.resolveHomeAgentControlActor_({ deviceId: 'father-phone', pairingToken: '' }), 'UNAUTHORIZED_DEVICE');
const fatherStatusColumn = homeHeaders.indexOf('status');
spreadsheet.sheets.Home_Members.values[1][fatherStatusColumn] = 'disabled';
expectCode(() => api.resolveHomeAgentControlActor_({ deviceId: 'father-phone', pairingToken: 'pairing' }), 'MEMBERSHIP_NOT_FOUND');
spreadsheet.sheets.Home_Members.values[1][fatherStatusColumn] = 'active';
expectCode(() => api.resolveAuthenticatedActor_('old-phone', 'pairing'), 'MEMBERSHIP_NOT_FOUND');
expectCode(() => api.resolveAuthenticatedActor_('unknown-phone', 'pairing'), 'MEMBERSHIP_NOT_FOUND');
const fatherDisplayNameColumn = homeHeaders.indexOf('displayName');
spreadsheet.sheets.Home_Members.values[1][fatherDisplayNameColumn] = 'Father';
expectCode(() => api.resolveAuthenticatedActor_('father-phone', 'pairing'), 'MEMBERSHIP_NOT_FOUND');
spreadsheet.sheets.Home_Members.values[1][fatherDisplayNameColumn] = '父';
const fatherRoleColumn = homeHeaders.indexOf('role');
spreadsheet.sheets.Home_Members.values[1][fatherRoleColumn] = 'self_record';
expectCode(() => api.resolveAuthenticatedActor_('father-phone', 'pairing'), 'MEMBERSHIP_NOT_FOUND');
spreadsheet.sheets.Home_Members.values[1][fatherRoleColumn] = 'admin';
assert.strictEqual(api.authorizeTargetOperation_(api.resolveAuthenticatedActor_('son-phone', 'pairing'), 'second_son', 'health.weight.record'), true);
assert.strictEqual(api.authorizeTargetOperation_(api.resolveAuthenticatedActor_('son-phone', 'pairing'), 'second_son', 'health.weight.correct'), true);
assert.strictEqual(api.authorizeTargetOperation_(api.resolveAuthenticatedActor_('son-phone', 'pairing'), 'second_son', 'health.daily.list'), true);
assert.strictEqual(api.authorizeTargetOperation_(api.resolveAuthenticatedActor_('mother-phone', 'pairing'), 'mother', 'health.weight.record'), true);
assert.strictEqual(api.authorizeTargetOperation_(api.resolveAuthenticatedActor_('mother-phone', 'pairing'), 'second_son', 'health.daily.list'), true);
assert.strictEqual(api.authorizeTargetOperation_(api.resolveAuthenticatedActor_('mother-phone', 'pairing'), 'second_son', 'health.weight.record'), true);
assert.strictEqual(api.authorizeTargetOperation_(api.resolveAuthenticatedActor_('mother-phone', 'pairing'), 'second_son', 'health.weight.correct'), true);
expectCode(() => api.authorizeTargetOperation_(api.resolveAuthenticatedActor_('mother-phone', 'pairing'), 'father', 'health.weight.record'), 'FORBIDDEN');
expectCode(() => api.getMembershipApprovalTemplate_('mother_initial'), 'INVALID_MEMBERSHIP_TEMPLATE');
expectCode(() => api.authorizeTargetOperation_(api.resolveAuthenticatedActor_('son-phone', 'pairing'), 'father', 'health.weight.record'), 'FORBIDDEN');
expectCode(() => api.authorizeTargetOperation_(api.resolveAuthenticatedActor_('son-phone', 'pairing'), 'father', 'health.weight.correct'), 'FORBIDDEN');
expectCode(() => api.authorizeTargetOperation_(api.resolveAuthenticatedActor_('son-phone', 'pairing'), 'father', 'health.daily.list'), 'FORBIDDEN');
expectCode(() => api.authorizeTargetOperation_(api.resolveAuthenticatedActor_('father-phone', 'pairing'), 'other_child', 'health.weight.record'), 'FORBIDDEN');

const missingHeaders = new Spreadsheet();
missingHeaders.sheets.Home_Members = new Sheet(['homeId', 'memberUserId']);
missingHeaders.sheets.Device_Memberships = new Sheet(deviceHeaders);
expectCode(() => load(missingHeaders, {}).getHomeMember_('home-a', 'father'), 'CONFIGURATION_ERROR');

const bootstrap = new Spreadsheet();
const bootstrapProperties = {
  PALURU_HOME_ID: 'home-a', PILOT_FATHER_DEVICE_ID: 'father-phone', PILOT_SECOND_SON_DEVICE_ID: 'son-phone',
  PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1: JSON.stringify({ devices: { 'father-phone': { status: 'active' }, 'son-phone': { status: 'active' } } }),
};
const bootstrapApi = load(bootstrap, bootstrapProperties);
bootstrapApi.bootstrapPilotHomeMembership_();
const firstCounts = [bootstrap.sheets.Home_Members.getLastRow(), bootstrap.sheets.Device_Memberships.getLastRow()];
bootstrapApi.bootstrapPilotHomeMembership_();
assert.deepStrictEqual([bootstrap.sheets.Home_Members.getLastRow(), bootstrap.sheets.Device_Memberships.getLastRow()], firstCounts);
bootstrapProperties.PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1 = JSON.stringify({ devices: { 'father-phone': { status: 'disabled' }, 'son-phone': { status: 'active' } } });
expectCode(() => load(new Spreadsheet(), bootstrapProperties).bootstrapPilotHomeMembership_(), 'CONFIGURATION_ERROR');

console.log('PASS membership authorization, schema, cross-home, and bootstrap idempotency');

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
    verifyHomeControlDevicePairing_: () => ({ handled: true, authorized: true }),
  };
  vm.createContext(context);
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
addRow(spreadsheet.sheets.Home_Members, homeHeaders, { homeId: 'home-a', memberUserId: 'father', role: 'admin', status: 'active' });
addRow(spreadsheet.sheets.Home_Members, homeHeaders, { homeId: 'home-a', memberUserId: 'second_son', role: 'self_record', status: 'active' });
addRow(spreadsheet.sheets.Home_Members, homeHeaders, { homeId: 'home-b', memberUserId: 'other_child', role: 'self_record', status: 'active' });
addRow(spreadsheet.sheets.Device_Memberships, deviceHeaders, { deviceId: 'father-phone', homeId: 'home-a', memberUserId: 'father', status: 'active' });
addRow(spreadsheet.sheets.Device_Memberships, deviceHeaders, { deviceId: 'son-phone', homeId: 'home-a', memberUserId: 'second_son', status: 'active' });
addRow(spreadsheet.sheets.Device_Memberships, deviceHeaders, { deviceId: 'old-phone', homeId: 'home-a', memberUserId: 'second_son', status: 'disabled' });
const api = load(spreadsheet, {});

assert.deepStrictEqual(JSON.parse(JSON.stringify(api.resolveAuthenticatedActor_('father-phone', 'pairing'))), { homeId: 'home-a', memberUserId: 'father', role: 'admin', deviceId: 'father-phone' });
expectCode(() => api.resolveAuthenticatedActor_('old-phone', 'pairing'), 'MEMBERSHIP_NOT_FOUND');
assert.strictEqual(api.authorizeTargetOperation_(api.resolveAuthenticatedActor_('son-phone', 'pairing'), 'second_son', 'health.weight.record'), true);
expectCode(() => api.authorizeTargetOperation_(api.resolveAuthenticatedActor_('son-phone', 'pairing'), 'father', 'health.weight.record'), 'FORBIDDEN');
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

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

class Range {
  constructor(sheet, row, column, rows, columns) { this.sheet = sheet; this.row = row; this.column = column; this.rows = rows; this.columns = columns; }
  getValues() { return Array.from({ length: this.rows }, (_, row) => Array.from({ length: this.columns }, (_, column) => this.sheet.values[this.row - 1 + row]?.[this.column - 1 + column] ?? '')); }
  setValues(values) {
    values.forEach((row, rowOffset) => row.forEach((value, columnOffset) => {
      if (!this.sheet.values[this.row - 1 + rowOffset]) this.sheet.values[this.row - 1 + rowOffset] = [];
      this.sheet.values[this.row - 1 + rowOffset][this.column - 1 + columnOffset] = value;
    }));
    return this;
  }
}

class Sheet {
  constructor(headers) { this.values = [headers.slice()]; }
  getLastColumn() { return this.values.reduce((maximum, row) => Math.max(maximum, row.length), 0); }
  getLastRow() { return this.values.length; }
  getRange(row, column, rows, columns) { return new Range(this, row, column, rows, columns); }
  getDataRange() { return new Range(this, 1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1)); }
  setFrozenRows() {}
}

const homeHeaders = ['homeId', 'memberUserId', 'displayName', 'role', 'status', 'createdAt', 'updatedAt'];
const deviceHeaders = ['deviceId', 'homeId', 'memberUserId', 'status', 'assignedBy', 'assignedAt', 'updatedAt'];
const spreadsheet = { sheets: {}, getSheetByName(name) { return this.sheets[name] || null; }, insertSheet(name) { const sheet = new Sheet([]); this.sheets[name] = sheet; return sheet; } };
spreadsheet.sheets.Home_Members = new Sheet(homeHeaders);
spreadsheet.sheets.Device_Memberships = new Sheet(deviceHeaders);
spreadsheet.sheets.Home_Members.values.push(['paluru-home', 'father', '父', 'admin', 'active', '', '']);
spreadsheet.sheets.Device_Memberships.values.push(['father-device', 'paluru-home', 'father', 'active', 'bootstrap', '', '']);

const context = {
  Array, Boolean, Error, JSON, Object, String,
  SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
  Utilities: { formatDate: () => '2026-07-30T12:00:00+09:00' },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => '' }) },
  verifyHomeControlDevicePairing_: (_deviceId, pairingToken) => ({ handled: true, authorized: pairingToken === 'pairing' }),
  json_: (value) => value,
};
vm.createContext(context);
for (const file of ['HomeMemberPolicy.js', 'HomeMembershipService.js', 'HealthGatewayService.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'gas', file), 'utf8'), context);
}

assert.deepStrictEqual(JSON.parse(JSON.stringify(context.getActiveSelfRecordMembers_('paluru-home'))), [], 'father-only home must have no health targets');
context.provisionMembershipFromApprovalTemplateWithinRegistryLock_(
  { homeId: 'paluru-home', memberUserId: 'father', role: 'admin', deviceId: 'father-device' },
  'second-son-device',
  'second_son_initial',
  'membership-request-1',
  '2026-07-30T12:00:00+09:00',
);

const result = context.healthGateway_({ action: 'health.context.get', deviceId: 'father-device', pairingToken: 'pairing' });
assert.strictEqual(result.success, true);
assert.deepStrictEqual(JSON.parse(JSON.stringify(result.data.targets)), [{ userId: 'second_son', displayName: '次男' }]);
console.log('PASS approved second-son membership appears as the sole Health context target');

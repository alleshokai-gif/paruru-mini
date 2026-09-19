'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

class Range {
  constructor(sheet, row, column, rows, columns) { this.sheet = sheet; this.row = row; this.column = column; this.rows = rows; this.columns = columns; }
  getValues() { return Array.from({ length: this.rows }, (_, r) => Array.from({ length: this.columns }, (_, c) => this.sheet.values[this.row - 1 + r]?.[this.column - 1 + c] ?? '')); }
}
class Sheet {
  constructor(headers) { this.values = [headers.slice()]; }
  getLastColumn() { return this.values[0].length; }
  getLastRow() { return this.values.length; }
  getRange(row, column, rows, columns) { return new Range(this, row, column, rows, columns); }
  getDataRange() { return new Range(this, 1, 1, this.values.length, this.values[0].length); }
}

const homeHeaders = ['homeId', 'memberUserId', 'displayName', 'role', 'status', 'createdAt', 'updatedAt'];
const deviceHeaders = ['deviceId', 'homeId', 'memberUserId', 'status', 'assignedBy', 'assignedAt', 'updatedAt'];
const sheets = {
  Home_Members: new Sheet(homeHeaders),
  Device_Memberships: new Sheet(deviceHeaders),
};
function add(sheet, headers, values) { sheet.values.push(headers.map((header) => values[header] || '')); }
add(sheets.Home_Members, homeHeaders, { homeId: 'home-a', memberUserId: 'eldest_daughter', displayName: '長女', role: 'self_record', status: 'active' });
add(sheets.Device_Memberships, deviceHeaders, { deviceId: 'daughter-phone', homeId: 'home-a', memberUserId: 'eldest_daughter', status: 'active' });

const context = {
  SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: (name) => sheets[name] || null }) },
  verifyHomeControlDevicePairing_: (deviceId, pairingToken) => ({ handled: true, authorized: deviceId === 'daughter-phone' && pairingToken === 'credential' }),
  Error, String, Object, Array,
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'gas', 'HomeMemberPolicy.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'gas', 'HomeMembershipService.js'), 'utf8'), context);
context.resolveFirebaseAuthenticatedActor_ = () => ({
  homeId: 'home-a', memberUserId: 'eldest_daughter', displayName: '長女', role: 'self_record',
  capabilities: context.getEffectiveMemberCapabilities_('eldest_daughter', 'self_record'),
  authBindingKey: 'firebase-eldest-daughter',
});

const membership = JSON.parse(JSON.stringify(context.getMembershipContext_({
  deviceId: 'daughter-phone', pairingToken: 'credential', role: 'admin', capabilities: ['home.control'],
})));
assert.deepStrictEqual(membership, {
  memberUserId: 'eldest_daughter',
  displayName: '長女',
  role: 'self_record',
  calendarSuffix: '（は）',
  addressTerms: { paruru: '', nurseOkan: '' },
  capabilities: ['home.read', 'calendar.family.read', 'calendar.family.create', 'calendar.family.edit_own', 'calendar.family.delete_own', 'memo.self.read', 'memo.self.create', 'memo.self.update', 'memo.self.delete', 'health.self.read', 'health.self.record', 'pet.health.read', 'pet.health.record', 'family.inbox.read', 'family.inbox.submit'],
  allowedViews: ['home', 'inbox', 'nurse-okan', 'popio-health', 'bus'],
});

const actor = context.resolveAuthenticatedActor_('daughter-phone', 'credential');
for (const capability of membership.capabilities) assert.strictEqual(context.authorizeCapability_(actor, capability), true, capability);
for (const capability of ['home.control', 'health.supervision.read', 'health.supervision.record', 'family.inbox.review']) {
  assert.throws(() => context.authorizeCapability_(actor, capability), (error) => error && error.code === 'FORBIDDEN', capability);
}
assert.strictEqual(context.resolveHomeAgentReadActor_({ auth: { provider: 'firebase', idToken: 'firebase-token' } }).memberUserId, 'eldest_daughter');
assert.throws(() => context.resolveHomeAgentControlActor_({ auth: { provider: 'firebase', idToken: 'firebase-token' } }), (error) => error && error.code === 'FORBIDDEN');
assert.strictEqual(context.authorizeTargetOperation_(actor, 'eldest_daughter', 'health.daily.get'), true);

assert.deepStrictEqual(JSON.parse(JSON.stringify(context.getRegistrationMemberIdentity_('eldest_daughter', '長女'))), { memberUserId: 'eldest_daughter', displayName: '長女' });
assert.throws(() => context.getRegistrationMemberIdentity_('eldest_daughter', '次男'), (error) => error && error.code === 'INVALID_MEMBER_IDENTITY');

console.log('PASS eldest daughter baseline access, forbidden privileges, and identity-only registration policy');

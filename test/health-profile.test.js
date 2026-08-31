'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const vm = require('vm');

class Range {
  constructor(sheet, row, column, rows, columns) { this.sheet = sheet; this.row = row; this.column = column; this.rows = rows; this.columns = columns; }
  getValues() { return Array.from({ length: this.rows }, (_, row) => Array.from({ length: this.columns }, (_, column) => this.sheet.values[this.row - 1 + row]?.[this.column - 1 + column] ?? '')); }
  setValues(values) { values.forEach((row, rowOffset) => row.forEach((value, columnOffset) => { (this.sheet.values[this.row - 1 + rowOffset] ||= [])[this.column - 1 + columnOffset] = value; })); }
}
class Sheet {
  constructor() { this.values = []; }
  getLastColumn() { return Math.max(0, ...this.values.map((row) => row.length)); }
  getLastRow() { return this.values.length; }
  getRange(row, column, rows, columns) { return new Range(this, row, column, rows, columns); }
  getDataRange() { return new Range(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  appendRow(row) { this.values.push(row); }
  setFrozenRows() {}
}
class Spreadsheet {
  constructor() { this.sheets = {}; }
  getSheetByName(name) { return this.sheets[name] || null; }
  insertSheet(name) { return (this.sheets[name] = new Sheet()); }
}

const spreadsheet = new Spreadsheet();
const context = {
  console, JSON, Number, String, Object, Array, Date, Math, RegExp,
  Utilities: {
    getUuid: () => crypto.randomUUID(),
    formatDate: (_date, _timezone, format) => format === 'yyyy-MM-dd' ? '2026-08-31' : '2026-08-31T12:00:00+09:00',
    base64Encode: (bytes) => Buffer.from(bytes).toString('base64'),
    computeDigest: (_algorithm, text) => crypto.createHash('sha256').update(text).digest(),
    DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => key === 'HEALTH_SPREADSHEET_ID' ? 'sheet' : '' }) },
  SpreadsheetApp: { openById: () => spreadsheet },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
};
vm.createContext(context);
['HealthSetup.js', 'HealthSecurity.js', 'HealthRuleService.js', 'HealthDataService.js', 'HealthDailyAuditService.js', 'HealthIdempotencyRecovery.js'].forEach((file) => vm.runInContext(fs.readFileSync(`gas-health/${file}`, 'utf8'), context));
context.setupHealthSchema_();

const plain = (value) => JSON.parse(JSON.stringify(value));
const id = (tail) => `00000000-0000-4000-8000-${String(tail).padStart(12, '0')}`;
const update = (clientRequestId, targetWeightKg, targetUserId = 'second_son') => ({
  operation: 'health.profile.update', homeId: 'home-a', actorUserId: 'father', targetUserId, targetWeightKg, clientRequestId,
});

assert.deepStrictEqual(plain(vm.runInContext('HEALTH_HEADERS.profile', context)), ['homeId', 'targetUserId', 'targetWeightKg', 'updatedBy', 'createdAt', 'updatedAt'], 'Health_Profile headers changed');
assert.deepStrictEqual(plain(context.healthProfileGet_({ homeId: 'home-a', targetUserId: 'second_son' })), { targetWeightKg: null, updatedAt: null }, 'K5: missing target must remain explicit');

const created = context.executeIdempotentWrite_(update(id(1), 55));
assert.deepStrictEqual(plain(created.data), { targetWeightKg: 55, updatedAt: '2026-08-31T12:00:00+09:00' }, 'K2: profile update response mismatch');
const profileSheet = spreadsheet.sheets.Health_Profile;
assert.strictEqual(profileSheet.getLastRow(), 2, 'one target must create one profile row');
let headers = profileSheet.values[0];
let row = profileSheet.values[1];
assert.strictEqual(row[headers.indexOf('updatedBy')], 'father', 'profile updater must be server-resolved actor');
assert.strictEqual(row[headers.indexOf('createdAt')], '2026-08-31T12:00:00+09:00');

context.executeIdempotentWrite_(update(id(1), 55));
assert.strictEqual(profileSheet.getLastRow(), 2, 'K6: exact retry must not create another profile row');
assert.throws(() => context.executeIdempotentWrite_(update(id(1), 56)), (error) => error.code === 'IDEMPOTENCY_CONFLICT', 'same request ID with changed target must conflict');

const originalAppendRequestLog = context.appendRequestLog_;
context.appendRequestLog_ = () => { throw new Error('request log failure'); };
assert.throws(() => context.executeIdempotentWrite_(update(id(2), 56)), /request log failure/);
context.appendRequestLog_ = originalAppendRequestLog;
context.executeIdempotentWrite_(update(id(2), 56));
assert.strictEqual(profileSheet.getLastRow(), 2, 'request-log recovery must remain a one-row upsert');
assert.strictEqual(context.healthProfileGet_({ homeId: 'home-a', targetUserId: 'second_son' }).targetWeightKg, 56);

[19.9, 200.1, 55.55, '', NaN].forEach((value, index) => {
  assert.throws(() => context.executeIdempotentWrite_(update(id(10 + index), value)), (error) => error.code === 'INVALID_INPUT', `invalid target weight accepted: ${String(value)}`);
});

const duplicate = new Array(headers.length).fill('');
duplicate[headers.indexOf('homeId')] = 'home-a';
duplicate[headers.indexOf('targetUserId')] = 'second_son';
duplicate[headers.indexOf('targetWeightKg')] = 57;
duplicate[headers.indexOf('updatedBy')] = 'father';
duplicate[headers.indexOf('createdAt')] = '2026-08-31T12:00:00+09:00';
duplicate[headers.indexOf('updatedAt')] = '2026-08-31T12:00:00+09:00';
profileSheet.appendRow(duplicate);
assert.throws(() => context.healthProfileGet_({ homeId: 'home-a', targetUserId: 'second_son' }), (error) => error.code === 'DATA_INTEGRITY_ERROR', 'duplicate profile rows must fail closed');

const code = fs.readFileSync('gas-health/Code.js', 'utf8');
assert(code.includes("'health.profile.get':true") && code.includes("'health.profile.update':true"), 'Health profile operations are missing from Health GAS');
console.log('PASS Health_Profile schema, validation, idempotent upsert, and duplicate-row guard');

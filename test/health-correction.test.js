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
let now = '2026-08-23T12:00:00+09:00';
const context = {
  console, JSON, Number, String, Object, Array, Date, Math, RegExp,
  Utilities: {
    getUuid: () => crypto.randomUUID(),
    formatDate: (_date, _timezone, format) => format === 'yyyy-MM-dd' ? now.slice(0, 10) : now,
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

const id = (tail) => `00000000-0000-4000-8000-${String(tail).padStart(12, '0')}`;
const daily = (clientRequestId, payload) => ({
  operation: 'health.daily.recordSlot', homeId: 'home-a', actorUserId: 'second_son', targetUserId: 'second_son',
  localDate: '2026-08-23', slot: 'morning', clientRequestId, payload,
});
const incompleteMorning = { morningStaple: 'none', morningProteinSource: 'none', morningWater: false, morningMedication: false, morningCondition: false };
const auditSheet = () => spreadsheet.sheets.Health_Daily_Audit;
const weightSheet = () => spreadsheet.sheets.Health_Weight;

const created = context.executeIdempotentWrite_(daily(id(1), incompleteMorning));
assert(created.data.slots.morning.recordedAt, 'C1/C3: saved daily slot must retain recordedAt');
assert(created.data.ruleCodes.includes('morning_fuel_missing'), 'C4/T2: content evaluation must remain after recorded save');
assert.strictEqual(auditSheet().getLastRow(), 2, 'C1: first daily save must append one audit row');
let auditHeaders = auditSheet().values[0];
let audit = auditSheet().values[1];
assert.strictEqual(audit[auditHeaders.indexOf('operation')], 'create', 'C1: first audit must be create');
assert.strictEqual(audit[auditHeaders.indexOf('commitState')], 'committed', 'C1: audit must commit with daily write');
assert.strictEqual(audit[auditHeaders.indexOf('beforeJson')], 'null', 'C1: create has no prior slot value');

const withMeal = { morningStaple: 'normal', morningProteinSource: 'egg', morningWater: true, morningMedication: false, morningCondition: false, morningMealType: 'rice_1', morningWaterType: 'water_glass_1' };
const updated = context.executeIdempotentWrite_(daily(id(2), withMeal));
assert.strictEqual(updated.data.slots.morning.morningStaple, 'normal', 'C2: current daily state must update');
assert.strictEqual(auditSheet().getLastRow(), 3, 'C2: update must append one audit row');
audit = auditSheet().values[2];
assert.strictEqual(audit[auditHeaders.indexOf('operation')], 'update', 'C2: second audit must be update');
assert.strictEqual(JSON.parse(audit[auditHeaders.indexOf('beforeJson')]).morningStaple, 'none', 'C2: audit must preserve before value');
assert.strictEqual(JSON.parse(audit[auditHeaders.indexOf('afterJson')]).morningStaple, 'normal', 'C2: audit must preserve after value');

const cleared = context.executeIdempotentWrite_(Object.assign(daily(id(3), incompleteMorning), { isCorrection: true }));
assert.strictEqual(cleared.data.slots.morning.morningMealType, '', 'Daily correction must clear deselected optional values');
assert.strictEqual(auditSheet().values[3][auditHeaders.indexOf('isCorrection')], true, 'Daily audit must distinguish an explicit correction from a normal save');
const auditRowsBeforeReplay = auditSheet().getLastRow();
context.executeIdempotentWrite_(Object.assign(daily(id(3), incompleteMorning), { isCorrection: true }));
assert.strictEqual(auditSheet().getLastRow(), auditRowsBeforeReplay, 'C5: exact retry must not duplicate audit');
assert.throws(() => context.executeIdempotentWrite_(Object.assign(daily(id(3), withMeal), { isCorrection: true })), (error) => error.code === 'IDEMPOTENCY_CONFLICT', 'C6: changed payload with same ID must fail');

const logFailureRequest = daily(id(4), withMeal);
const originalAppendRequestLog = context.appendRequestLog_;
context.appendRequestLog_ = () => { throw new Error('request log failure'); };
assert.throws(() => context.executeIdempotentWrite_(logFailureRequest), /request log failure/);
context.appendRequestLog_ = originalAppendRequestLog;
const auditRowsAfterFailedLog = auditSheet().getLastRow();
context.executeIdempotentWrite_(logFailureRequest);
assert.strictEqual(auditSheet().getLastRow(), auditRowsAfterFailedLog, 'C5: request-log recovery must not duplicate audit');

const weightRecord = context.executeIdempotentWrite_({ operation: 'health.weight.record', homeId: 'home-a', actorUserId: 'second_son', targetUserId: 'second_son', measuredDate: '2026-08-23', weightKg: 52.3, clientRequestId: id(10) });
assert(weightRecord.data.recordId, 'C8: recorded weight must return its recordId');
const corrected = context.executeIdempotentWrite_({ operation: 'health.weight.correct', homeId: 'home-a', actorUserId: 'second_son', targetUserId: 'second_son', recordId: weightRecord.data.recordId, measuredDate: '2026-08-23', weightKg: 53.2, correctionReason: 'input typo', clientRequestId: id(11) });
assert.notStrictEqual(corrected.data.recordId, weightRecord.data.recordId, 'C9: correction must append a new weight event');
let listed = context.weightList_({ homeId: 'home-a', targetUserId: 'second_son', limit: 8 }).items;
assert.deepStrictEqual(JSON.parse(JSON.stringify(listed.map((item) => item.weightKg))), [53.2], 'C9: corrected source must not remain in normal list');
assert.strictEqual(weightSheet().getLastRow(), 3, 'C9: weight correction must preserve the original event row');
assert.throws(() => context.executeIdempotentWrite_({ operation: 'health.weight.correct', homeId: 'home-a', actorUserId: 'second_son', targetUserId: 'second_son', recordId: id(99), measuredDate: '2026-08-23', weightKg: 54, clientRequestId: id(12) }), (error) => error.code === 'INVALID_INPUT', 'C10: unknown weight source must fail');
assert.throws(() => context.executeIdempotentWrite_({ operation: 'health.weight.correct', homeId: 'home-a', actorUserId: 'second_son', targetUserId: 'other_child', recordId: corrected.data.recordId, measuredDate: '2026-08-23', weightKg: 54, clientRequestId: id(13) }), (error) => error.code === 'INVALID_INPUT', 'C11: another target record must not be corrected');
assert.throws(() => context.executeIdempotentWrite_({ operation: 'health.weight.correct', homeId: 'home-a', actorUserId: 'second_son', targetUserId: 'second_son', recordId: weightRecord.data.recordId, measuredDate: '2026-08-23', weightKg: 54, clientRequestId: id(14) }), (error) => error.code === 'INVALID_INPUT', 'C12: corrected source must reject a second correction');

const correctionRetry = { operation: 'health.weight.correct', homeId: 'home-a', actorUserId: 'second_son', targetUserId: 'second_son', recordId: corrected.data.recordId, measuredDate: '2026-08-23', weightKg: 53.4, correctionReason: 'measurement typo', clientRequestId: id(15) };
context.appendRequestLog_ = () => { throw new Error('request log failure'); };
assert.throws(() => context.executeIdempotentWrite_(correctionRetry), /request log failure/);
context.appendRequestLog_ = originalAppendRequestLog;
const weightRowsAfterFailedLog = weightSheet().getLastRow();
const retriedCorrection = context.executeIdempotentWrite_(correctionRetry);
assert.strictEqual(weightSheet().getLastRow(), weightRowsAfterFailedLog, 'C13: correction retry must not append a second event');
listed = context.weightList_({ homeId: 'home-a', targetUserId: 'second_son', limit: 8 }).items;
assert.deepStrictEqual(JSON.parse(JSON.stringify(listed.map((item) => item.weightKg))), [53.4], 'C13: retried correction must remain the sole active value');
assert.strictEqual(retriedCorrection.data.weightKg, 53.4, 'C13: retry response must identify the corrected value');

assert(fs.readFileSync('gas-health/Code.js', 'utf8').includes("'health.weight.correct':true"), 'Health GAS allowlist is missing health.weight.correct');
assert.deepStrictEqual(JSON.parse(JSON.stringify(vm.runInContext('HEALTH_HEADERS.weight.slice(-3)', context))), ['status', 'correctionOfRecordId', 'correctionReason'], 'Weight schema migration must append correction columns only');
console.log('PASS daily audit, daily correction recovery, and effective weight correction');

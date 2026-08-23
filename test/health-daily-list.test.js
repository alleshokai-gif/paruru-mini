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
  constructor() { this.values = []; this.dataRangeReads = 0; }
  getLastColumn() { return Math.max(0, ...this.values.map((row) => row.length)); }
  getLastRow() { return this.values.length; }
  getRange(row, column, rows, columns) { return new Range(this, row, column, rows, columns); }
  getDataRange() { this.dataRangeReads += 1; return new Range(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
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
    formatDate: (_date, _timezone, format) => format === 'yyyy-MM-dd' ? '2026-08-23' : '2026-08-23T12:00:00+09:00',
    base64Encode: (bytes) => Buffer.from(bytes).toString('base64'),
    computeDigest: (_algorithm, text) => crypto.createHash('sha256').update(text).digest(),
    DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => key === 'HEALTH_SPREADSHEET_ID' ? 'sheet' : '' }) },
  SpreadsheetApp: { openById: () => spreadsheet },
};
vm.createContext(context);
['HealthSetup.js', 'HealthSecurity.js', 'HealthRuleService.js', 'HealthDataService.js'].forEach((file) => vm.runInContext(fs.readFileSync(`gas-health/${file}`, 'utf8'), context));
context.setupHealthSchema_();

context.dailyRecord_({
  homeId: 'home-a', actorUserId: 'second-son', targetUserId: 'second-son', localDate: '2026-08-23', slot: 'morning', clientRequestId: '11111111-1111-4111-8111-111111111111',
  payload: { morningStaple: 'none', morningProteinSource: 'none', morningWater: false, morningMedication: false, morningCondition: false },
});
context.dailyRecord_({
  homeId: 'home-a', actorUserId: 'second-son', targetUserId: 'second-son', localDate: '2026-08-22', slot: 'post_training', clientRequestId: '22222222-2222-4222-8222-222222222222',
  payload: { postTrainingStatus: 'rest_day', postTrainingOnigiriCount: 0, postTrainingProteinSource: 'none', postTrainingWater: false, postTrainingCondition: false },
});
context.dailyRecord_({
  homeId: 'home-a', actorUserId: 'other-child', targetUserId: 'other-child', localDate: '2026-08-21', slot: 'morning', clientRequestId: '33333333-3333-4333-8333-333333333333',
  payload: { morningStaple: 'normal', morningProteinSource: 'egg', morningWater: true, morningMedication: true, morningCondition: true, morningMealType: 'rice_1', morningWaterType: 'water_glass_1', morningConditionType: 'good' },
});

spreadsheet.sheets.Health_Daily.dataRangeReads = 0;
spreadsheet.sheets.Health_Weight.dataRangeReads = 0;
const result = context.dailyList_({ homeId: 'home-a', targetUserId: 'second-son', fromLocalDate: '2026-08-17', toLocalDate: '2026-08-23' });
assert.strictEqual(result.items.length, 7, 'B1: seven-day range must return every date');
assert.deepStrictEqual(JSON.parse(JSON.stringify(result.items.map((item) => item.localDate))), ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22', '2026-08-23'], 'response order must be ascending');
assert.deepStrictEqual(JSON.parse(JSON.stringify(result.items[1].slots)), {}, 'B2: missing row must be returned as empty slots');
assert(result.items[6].slots.morning.recordedAt, 'B3: saved slot lost recordedAt');
assert(result.items[6].ruleCodes.includes('morning_fuel_missing'), 'content evaluation must remain separate from recorded state');
assert.strictEqual(result.items[5].slots.post_training.postTrainingStatus, 'rest_day', 'B4: rest day value missing');
assert(result.items[5].slots.post_training.recordedAt, 'B4: rest day must remain recorded');
assert.deepStrictEqual(JSON.parse(JSON.stringify(result.items[4].slots)), {}, 'other target data leaked into the requested target');
assert.strictEqual(spreadsheet.sheets.Health_Daily.dataRangeReads, 1, 'Health_Daily must be scanned once per list request');
assert.strictEqual(spreadsheet.sheets.Health_Weight.dataRangeReads, 1, 'Health_Weight evaluation input must be read once per list request');
assert.throws(() => context.dailyList_({ homeId: 'home-a', targetUserId: 'second-son', fromLocalDate: '2026-08-24', toLocalDate: '2026-08-23' }), (error) => error.code === 'INVALID_INPUT', 'B7: from > to must be rejected');
assert.strictEqual(context.dailyList_({ homeId: 'home-a', targetUserId: 'second-son', fromLocalDate: '2026-07-24', toLocalDate: '2026-08-23' }).items.length, 31, 'B8: inclusive 31-day boundary must be accepted');
assert.throws(() => context.dailyList_({ homeId: 'home-a', targetUserId: 'second-son', fromLocalDate: '2026-07-23', toLocalDate: '2026-08-23' }), (error) => error.code === 'INVALID_INPUT', 'B8: over 31 days must be rejected');
assert.throws(() => context.dailyList_({ homeId: 'home-a', targetUserId: 'second-son', fromLocalDate: '2026-02-30', toLocalDate: '2026-03-01' }), (error) => error.code === 'INVALID_INPUT', 'invalid calendar dates must be rejected');
assert.throws(() => context.dailyList_({ homeId: 'home-a', targetUserId: 'second-son', toLocalDate: '2026-08-23' }), (error) => error.code === 'INVALID_INPUT', 'missing fromLocalDate must be rejected');
const codeSource = fs.readFileSync('gas-health/Code.js', 'utf8');
assert(codeSource.includes("body.operation === 'health.daily.list'"), 'Health GAS dispatch does not route health.daily.list');
assert(codeSource.includes("'health.daily.list':true"), 'Health GAS operation allowlist is missing health.daily.list');

console.log('PASS health.daily.list full dates, validation, target isolation, rules, and bounded sheet reads');

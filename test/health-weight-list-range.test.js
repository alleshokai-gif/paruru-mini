'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

class Range {
  constructor(sheet, row, column, rows, columns) { this.sheet = sheet; this.row = row; this.column = column; this.rows = rows; this.columns = columns; }
  getValues() { return Array.from({ length: this.rows }, (_, row) => Array.from({ length: this.columns }, (_, column) => this.sheet.values[this.row - 1 + row]?.[this.column - 1 + column] ?? '')); }
  setValues(values) { values.forEach((row, rowIndex) => row.forEach((value, columnIndex) => { (this.sheet.values[this.row - 1 + rowIndex] ||= [])[this.column - 1 + columnIndex] = value; })); }
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
  insertSheet(name) { return this.sheets[name] = new Sheet(); }
}

const spreadsheet = new Spreadsheet();
const context = {
  JSON, Number, String, Object, Array, Date, Math, RegExp,
  Utilities: { formatDate: () => '2026-08-23' },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'sheet' }) },
  SpreadsheetApp: { openById: () => spreadsheet },
};
vm.createContext(context);
['HealthSetup.js', 'HealthSecurity.js', 'HealthRuleService.js', 'HealthDataService.js'].forEach((name) => vm.runInContext(fs.readFileSync('gas-health/' + name, 'utf8'), context));
context.setupHealthSchema_();
const sheet = spreadsheet.sheets.Health_Weight;
const headers = sheet.values[0];
function add(row) {
  const values = new Array(headers.length).fill('');
  Object.keys(row).forEach((key) => { values[headers.indexOf(key)] = row[key]; });
  sheet.appendRow(values);
}
add({ recordId: 'old', homeId: 'home-a', targetUserId: 'second_son', measuredDate: '2026-07-24', weightKg: 49, status: 'active', recordedAt: '2026-07-24T08:00:00+09:00' });
add({ recordId: 'corrected-source', homeId: 'home-a', targetUserId: 'second_son', measuredDate: '2026-08-20', weightKg: 50, status: 'corrected', recordedAt: '2026-08-20T08:00:00+09:00' });
add({ recordId: 'corrected-replacement', homeId: 'home-a', targetUserId: 'second_son', measuredDate: '2026-08-20', weightKg: 51, status: 'active', recordedAt: '2026-08-20T09:00:00+09:00' });
add({ recordId: 'latest', homeId: 'home-a', targetUserId: 'second_son', measuredDate: '2026-08-23', weightKg: 52, status: 'active', recordedAt: '2026-08-23T08:00:00+09:00' });
add({ recordId: 'other-target', homeId: 'home-a', targetUserId: 'other_child', measuredDate: '2026-08-22', weightKg: 70, status: 'active', recordedAt: '2026-08-22T08:00:00+09:00' });
sheet.dataRangeReads = 0;

const range = context.weightList_({ homeId: 'home-a', targetUserId: 'second_son', fromLocalDate: '2026-08-01', toLocalDate: '2026-08-30' });
assert.deepStrictEqual(JSON.parse(JSON.stringify(range.items.map((item) => [item.recordId, item.measuredDate, item.weightKg]))), [['latest', '2026-08-23', 52], ['corrected-replacement', '2026-08-20', 51]], 'D4-D7: range items must contain only in-range active values');
assert.deepStrictEqual(JSON.parse(JSON.stringify(range.latest)), { recordId: 'latest', measuredDate: '2026-08-23', weightKg: 52, recordedAt: '2026-08-23T08:00:00+09:00' }, 'D2: latest active record is missing');
assert.strictEqual(range.previous.recordId, 'corrected-replacement', 'D3: previous active record is incorrect');
assert.strictEqual(sheet.dataRangeReads, 1, 'range list must read Health_Weight once');
assert.throws(() => context.weightList_({ homeId: 'home-a', targetUserId: 'second_son', fromLocalDate: '2026-08-30', toLocalDate: '2026-08-01' }), (error) => error.code === 'INVALID_INPUT', 'from > to must fail');
assert.throws(() => context.weightList_({ homeId: 'home-a', targetUserId: 'second_son', fromLocalDate: '2026-08-01' }), (error) => error.code === 'INVALID_INPUT', 'one-sided range must fail');
assert.throws(() => context.weightList_({ homeId: 'home-a', targetUserId: 'second_son', fromLocalDate: '2026-07-31', toLocalDate: '2026-08-31' }), (error) => error.code === 'INVALID_INPUT', 'over-31-day range must fail');
const legacy = context.weightList_({ homeId: 'home-a', targetUserId: 'second_son', limit: 8 });
assert.deepStrictEqual(JSON.parse(JSON.stringify(legacy.items.map((item) => item.weightKg))), [52, 51, 49], 'legacy limit response changed');
assert.strictEqual(Object.hasOwn(legacy, 'latest'), false, 'legacy response must stay unchanged');
console.log('PASS weight range list, active-only correction handling, validation, and one-read contract');

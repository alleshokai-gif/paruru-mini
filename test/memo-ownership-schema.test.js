'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

class Range {
  constructor(sheet, row, column, rows, columns) { this.sheet = sheet; this.row = row; this.column = column; this.rows = rows; this.columns = columns; }
  getValues() { return Array.from({ length: this.rows }, (_, r) => Array.from({ length: this.columns }, (_, c) => this.sheet.values[this.row - 1 + r]?.[this.column - 1 + c] ?? '')); }
  setValues(values) { values.forEach((row, r) => row.forEach((value, c) => { (this.sheet.values[this.row - 1 + r] ||= [])[this.column - 1 + c] = value; })); return this; }
}
class Sheet {
  constructor(values) { this.values = values.map((row) => row.slice()); }
  getLastColumn() { return this.values.reduce((max, row) => Math.max(max, row.length), 0); }
  getLastRow() { return this.values.length; }
  getRange(row, column, rows, columns) { return new Range(this, row, column, rows, columns); }
  setFrozenRows() {}
}
class Spreadsheet { constructor(sheet) { this.sheet = sheet; } getSheetByName(name) { return name === '01_Inbox' ? this.sheet : null; } }
function load(values) {
  const spreadsheet = new Spreadsheet(values ? new Sheet(values) : null);
  const context = { SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'gas', 'MemoOwnershipService.js'), 'utf8'), context);
  return { api: context, sheet: spreadsheet.sheet };
}
function expectCode(fn, code) { assert.throws(fn, (error) => error && error.code === code); }

const legacy = load([
  ['id', 'memo', 'status'],
  ['one', 'private memo must not leak', 'Inbox'],
  ['two', 'another private memo', 'Inbox'],
]);
assert.deepStrictEqual(JSON.parse(JSON.stringify(legacy.api.setupMemoOwnershipSchema_())), { addedHeaders: ['ownerUserId', 'createdByUserId'], addedHeaderCount: 2 });
assert.deepStrictEqual(legacy.sheet.values[0], ['id', 'memo', 'status', 'ownerUserId', 'createdByUserId']);
assert.deepStrictEqual(JSON.parse(JSON.stringify(legacy.api.setupMemoOwnershipSchema_())), { addedHeaders: [], addedHeaderCount: 0 });
const beforeAudit = legacy.api.auditLegacyMemoOwnership_();
assert.deepStrictEqual(JSON.parse(JSON.stringify(beforeAudit)), { ownerUnsetCount: 2, ownerSetCount: 0, duplicateHeaders: [] });
assert(!JSON.stringify(beforeAudit).includes('private memo'), 'memo text leaked from audit');
assert.deepStrictEqual(JSON.parse(JSON.stringify(legacy.api.migrateLegacyMemosToFather_())), { migratedCount: 2 });
assert.deepStrictEqual(legacy.sheet.values[1].slice(3), ['father', 'father']);
assert.deepStrictEqual(JSON.parse(JSON.stringify(legacy.api.migrateLegacyMemosToFather_())), { migratedCount: 0 });

const mixed = load([
  ['id', 'memo', 'ownerUserId', 'createdByUserId'],
  ['one', 'keep owner', 'second_son', 'second_son'],
  ['two', 'migrate only this', '', ''],
]);
assert.deepStrictEqual(JSON.parse(JSON.stringify(mixed.api.migrateLegacyMemosToFather_())), { migratedCount: 1 });
assert.deepStrictEqual(mixed.sheet.values[1].slice(2), ['second_son', 'second_son']);
assert.deepStrictEqual(mixed.sheet.values[2].slice(2), ['father', 'father']);

const partial = load([
  ['id', 'memo', 'ownerUserId', 'createdByUserId'],
  ['one', 'do not overwrite', '', 'second_son'],
]);
expectCode(() => partial.api.auditLegacyMemoOwnership_(), 'MEMO_OWNERSHIP_INCONSISTENT');
expectCode(() => partial.api.migrateLegacyMemosToFather_(), 'MEMO_OWNERSHIP_INCONSISTENT');
assert.deepStrictEqual(partial.sheet.values[1].slice(2), ['', 'second_son']);
expectCode(() => load([['id', 'memo', 'memo']]).api.setupMemoOwnershipSchema_(), 'MEMO_OWNERSHIP_CONFIGURATION_ERROR');
expectCode(() => load(null).api.setupMemoOwnershipSchema_(), 'MEMO_OWNERSHIP_CONFIGURATION_ERROR');

const code = fs.readFileSync(path.join(__dirname, '..', 'gas', 'Code.js'), 'utf8');
['setupMemoOwnershipSchema_', 'auditLegacyMemoOwnership_', 'migrateLegacyMemosToFather_'].forEach((name) => assert(!code.includes(name), name + ' must not be exposed through doPost'));
console.log('PASS memo ownership schema, migration, privacy, and web isolation');

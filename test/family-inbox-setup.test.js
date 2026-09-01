'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

function clone(value) { return JSON.parse(JSON.stringify(value)); }

class Range {
  constructor(sheet, row, column, rowCount, columnCount) {
    this.sheet = sheet;
    this.row = row;
    this.column = column;
    this.rowCount = rowCount;
    this.columnCount = columnCount;
  }
  getValues() {
    this.sheet.calls.push({ method: 'getValues', row: this.row, column: this.column, rowCount: this.rowCount, columnCount: this.columnCount });
    return Array.from({ length: this.rowCount }, (_, rowOffset) =>
      Array.from({ length: this.columnCount }, (_, columnOffset) =>
        this.sheet.values[this.row - 1 + rowOffset]?.[this.column - 1 + columnOffset] ?? ''));
  }
  setValues(values) {
    this.sheet.calls.push({ method: 'setValues', row: this.row, column: this.column, values: clone(values) });
    values.forEach((sourceRow, rowOffset) => sourceRow.forEach((value, columnOffset) => {
      if (!this.sheet.values[this.row - 1 + rowOffset]) this.sheet.values[this.row - 1 + rowOffset] = [];
      this.sheet.values[this.row - 1 + rowOffset][this.column - 1 + columnOffset] = value;
    }));
    return this;
  }
}

class Sheet {
  constructor(name, values = [], maxColumns = 10) {
    this.name = name;
    this.values = clone(values);
    this.maxColumns = Math.max(maxColumns, this.getLastColumn());
    this.calls = [];
  }
  getLastRow() {
    let last = 0;
    this.values.forEach((row, index) => { if (row.some((value) => value !== '')) last = index + 1; });
    return last;
  }
  getLastColumn() {
    let last = 0;
    this.values.forEach((row) => row.forEach((value, index) => { if (value !== '') last = Math.max(last, index + 1); }));
    return last;
  }
  getMaxColumns() { this.calls.push({ method: 'getMaxColumns' }); return this.maxColumns; }
  insertColumnsAfter(column, count) {
    this.calls.push({ method: 'insertColumnsAfter', column, count });
    assert.strictEqual(column, this.maxColumns);
    assert(count > 0);
    this.maxColumns += count;
    return this;
  }
  getRange(row, column, rowCount, columnCount) {
    this.calls.push({ method: 'getRange', row, column, rowCount, columnCount });
    return new Range(this, row, column, rowCount, columnCount);
  }
}

class Spreadsheet {
  constructor() { this.sheets = {}; this.calls = []; }
  addSheet(name, values, maxColumns) {
    const sheet = new Sheet(name, values, maxColumns);
    this.sheets[name] = sheet;
    return sheet;
  }
  getSheetByName(name) { this.calls.push({ method: 'getSheetByName', name }); return this.sheets[name] || null; }
  insertSheet(name) {
    this.calls.push({ method: 'insertSheet', name });
    if (this.sheets[name]) throw new Error('duplicate sheet');
    return (this.sheets[name] = new Sheet(name));
  }
}

function loadHarness({ property = 'family-inbox-sheet-id', openThrows = false } = {}) {
  const spreadsheet = new Spreadsheet();
  let lockReleased = 0;
  const context = {
    console,
    JSON,
    Number,
    String,
    Object,
    Array,
    Date,
    Math,
    RegExp,
    Error,
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => key === 'FAMILY_INBOX_LEDGER_SPREADSHEET_ID' ? property : '' }) },
    SpreadsheetApp: { openById: (id) => { if (openThrows) throw new Error('open failed'); assert.strictEqual(id, 'family-inbox-sheet-id'); return spreadsheet; } },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => { lockReleased += 1; } }) },
  };
  vm.createContext(context);
  [
    'gas-family-inbox/FamilyInboxService.js',
    'gas-family-inbox/FamilyInboxWorkerService.js',
    'gas-family-inbox/FamilyInboxReviewService.js',
    'gas-family-inbox/FamilyInboxPcReviewService.js',
    'gas-family-inbox/FamilyInboxSetup.js',
  ].forEach((file) => vm.runInContext(fs.readFileSync(file, 'utf8'), context));
  const headers = clone(vm.runInContext(`({
    inbox: FAMILY_INBOX_HEADERS,
    candidates: FAMILY_INBOX_CANDIDATE_HEADERS.concat(FAMILY_INBOX_REVIEW_EXTRA_HEADERS, FAMILY_INBOX_PC_REVIEW_CANDIDATE_HEADERS),
    reviewItems: FAMILY_INBOX_PC_REVIEW_HEADERS
  })`, context));
  return { context, spreadsheet, headers, lockReleased: () => lockReleased };
}

function valuesSnapshot(spreadsheet) {
  return clone(Object.fromEntries(Object.entries(spreadsheet.sheets).map(([name, sheet]) => [name, sheet.values])));
}

{
  const { context, spreadsheet, headers, lockReleased } = loadHarness();
  assert.strictEqual(context.setupFamilyInboxSchema(), 'CREATED', 'FI-SET01');
  assert.deepStrictEqual(spreadsheet.calls.filter((call) => call.method === 'insertSheet').map((call) => call.name), [
    'Family_Inbox', 'Family_Candidates', 'Family_Review_Items',
  ], 'FI-SET02');
  assert.deepStrictEqual(spreadsheet.sheets.Family_Inbox.values, [headers.inbox], 'FI-SET03');
  assert.deepStrictEqual(spreadsheet.sheets.Family_Candidates.values, [headers.candidates], 'FI-SET04');
  assert.deepStrictEqual(spreadsheet.sheets.Family_Review_Items.values, [headers.reviewItems], 'FI-SET05');
  assert(spreadsheet.sheets.Family_Inbox.maxColumns >= headers.inbox.length, 'FI-SET06 inbox columns');
  assert(spreadsheet.sheets.Family_Candidates.maxColumns >= headers.candidates.length, 'FI-SET06 candidate columns');
  assert(spreadsheet.sheets.Family_Review_Items.maxColumns >= headers.reviewItems.length, 'FI-SET06 review item columns');
  const before = valuesSnapshot(spreadsheet);
  const mutationCount = Object.values(spreadsheet.sheets).flatMap((sheet) => sheet.calls).filter((call) => ['setValues', 'insertColumnsAfter'].includes(call.method)).length;
  assert.strictEqual(context.setupFamilyInboxSchema(), 'VERIFIED', 'FI-SET07');
  assert.deepStrictEqual(valuesSnapshot(spreadsheet), before, 'FI-SET08');
  assert.strictEqual(Object.values(spreadsheet.sheets).flatMap((sheet) => sheet.calls).filter((call) => ['setValues', 'insertColumnsAfter'].includes(call.method)).length, mutationCount, 'FI-SET09');
  assert.strictEqual(lockReleased(), 2, 'FI-SET10');
}

{
  const { context, spreadsheet, headers } = loadHarness();
  spreadsheet.addSheet('Family_Inbox', [headers.inbox], headers.inbox.length);
  const candidatePrefix = headers.candidates.slice(0, 28);
  spreadsheet.addSheet('Family_Candidates', [candidatePrefix], candidatePrefix.length);
  spreadsheet.addSheet('Family_Review_Items', [], 12);
  assert.strictEqual(context.setupFamilyInboxSchema(), 'CREATED', 'FI-SET11');
  assert.deepStrictEqual(spreadsheet.sheets.Family_Candidates.values[0], headers.candidates, 'FI-SET12');
  assert.deepStrictEqual(spreadsheet.sheets.Family_Candidates.values[0].slice(0, candidatePrefix.length), candidatePrefix, 'FI-SET13');
  assert.deepStrictEqual(spreadsheet.sheets.Family_Review_Items.values[0], headers.reviewItems, 'FI-SET14');
}

{
  const { context, spreadsheet, headers } = loadHarness();
  const reorderedCandidates = headers.candidates.slice();
  [reorderedCandidates[0], reorderedCandidates[1]] = [reorderedCandidates[1], reorderedCandidates[0]];
  spreadsheet.addSheet('Family_Inbox', [headers.inbox, headers.inbox.map((header) => `inbox-${header}`)], headers.inbox.length);
  spreadsheet.addSheet('Family_Candidates', [reorderedCandidates, reorderedCandidates.map((header) => header === 'reviewHistoryJson' ? '[{"revision":1}]' : `candidate-${header}`)], reorderedCandidates.length);
  spreadsheet.addSheet('Family_Review_Items', [headers.reviewItems, headers.reviewItems.map((header) => header === 'reviewHistoryJson' ? '[{"revision":2}]' : `review-${header}`)], headers.reviewItems.length);
  const before = valuesSnapshot(spreadsheet);
  assert.strictEqual(context.setupFamilyInboxSchema(), 'VERIFIED', 'FI-SET15');
  assert.deepStrictEqual(valuesSnapshot(spreadsheet), before, 'FI-SET16 existing rows and review history');
  assert(!Object.values(spreadsheet.sheets).flatMap((sheet) => sheet.calls).some((call) => ['setValues', 'insertColumnsAfter'].includes(call.method)), 'FI-SET17 no writes');
}

{
  const { context, spreadsheet, headers } = loadHarness();
  const legacyCandidateHeaders = headers.candidates.slice(0, 36);
  const legacyCandidateRow = legacyCandidateHeaders.map((header) => {
    if (header === 'payloadJson') return '{"title":"existing"}';
    if (header === 'reviewHistoryJson') return '[{"revision":4,"reviewAction":"updated"}]';
    return `existing-${header}`;
  });
  spreadsheet.addSheet('Family_Inbox', [headers.inbox, headers.inbox.map((header) => `inbox-${header}`)], headers.inbox.length);
  const candidateSheet = spreadsheet.addSheet('Family_Candidates', [legacyCandidateHeaders, legacyCandidateRow], 36);
  spreadsheet.addSheet('Family_Review_Items', [headers.reviewItems], headers.reviewItems.length);
  const existingRowBefore = clone(candidateSheet.values[1]);

  assert.strictEqual(context.setupFamilyInboxSchema(), 'CREATED', 'FI-MIG01 36 to 39');
  assert.deepStrictEqual(candidateSheet.values[0].slice(0, 36), legacyCandidateHeaders, 'FI-MIG02 existing headers retain order and names');
  assert.deepStrictEqual(candidateSheet.values[0].slice(36), ['reviewedByServiceId', 'reviewChannel', 'sourceReviewItemId'], 'FI-MIG03 append-only headers');
  assert.deepStrictEqual(candidateSheet.values[1], existingRowBefore, 'FI-MIG04 existing row values unchanged');
  assert.strictEqual(candidateSheet.values[1][legacyCandidateHeaders.indexOf('reviewHistoryJson')], '[{"revision":4,"reviewAction":"updated"}]', 'FI-MIG05 review history unchanged');
  const headerWrite = candidateSheet.calls.find((call) => call.method === 'setValues');
  assert.deepStrictEqual(headerWrite, {
    method: 'setValues', row: 1, column: 37,
    values: [['reviewedByServiceId', 'reviewChannel', 'sourceReviewItemId']],
  }, 'FI-MIG06 only right edge header write');
  assert(candidateSheet.calls.some((call) => call.method === 'insertColumnsAfter' && call.column === 36 && call.count === 3), 'FI-MIG07 only missing columns appended');
  assert.strictEqual(context.setupFamilyInboxSchema(), 'VERIFIED', 'FI-MIG08 replay');
  assert.deepStrictEqual(candidateSheet.values[1], existingRowBefore, 'FI-MIG09 replay row unchanged');
}

{
  const { context, spreadsheet, headers } = loadHarness();
  const incompleteInbox = headers.inbox.slice(0, -1);
  spreadsheet.addSheet('Family_Inbox', [incompleteInbox, incompleteInbox.map((header) => `existing-${header}`)], incompleteInbox.length);
  const before = valuesSnapshot(spreadsheet);
  assert.strictEqual(context.setupFamilyInboxSchema(), 'CONFIGURATION_ERROR', 'FI-SET18');
  assert.deepStrictEqual(valuesSnapshot(spreadsheet), before, 'FI-SET19');
  assert.deepStrictEqual(Object.keys(spreadsheet.sheets), ['Family_Inbox'], 'FI-SET20 preflight prevents partial creation');
  assert(!spreadsheet.sheets.Family_Inbox.calls.some((call) => ['setValues', 'insertColumnsAfter'].includes(call.method)), 'FI-SET21');
}

{
  const { context, spreadsheet, headers } = loadHarness();
  spreadsheet.addSheet('Family_Inbox', [headers.inbox]);
  spreadsheet.addSheet('Family_Candidates', [['wrongHeader']]);
  const before = valuesSnapshot(spreadsheet);
  assert.strictEqual(context.setupFamilyInboxSchema(), 'CONFIGURATION_ERROR', 'FI-SET22 unsafe empty prefix');
  assert.deepStrictEqual(valuesSnapshot(spreadsheet), before, 'FI-SET23');
  assert.strictEqual(spreadsheet.getSheetByName('Family_Review_Items'), null, 'FI-SET24');
}

{
  const { context, spreadsheet, headers } = loadHarness();
  const unknown = headers.candidates.slice(0, 36);
  unknown[35] = 'unknownHeader';
  spreadsheet.addSheet('Family_Inbox', [headers.inbox]);
  spreadsheet.addSheet('Family_Candidates', [unknown, unknown.map((header) => `value-${header}`)], unknown.length);
  spreadsheet.addSheet('Family_Review_Items', [headers.reviewItems]);
  const before = valuesSnapshot(spreadsheet);
  assert.strictEqual(context.setupFamilyInboxSchema(), 'CONFIGURATION_ERROR', 'FI-MIG10 unknown header');
  assert.deepStrictEqual(valuesSnapshot(spreadsheet), before, 'FI-MIG11 unknown header changed data');
}

{
  const { context, spreadsheet, headers } = loadHarness();
  const duplicate = headers.candidates.slice(0, 36);
  duplicate[35] = duplicate[34];
  spreadsheet.addSheet('Family_Inbox', [headers.inbox]);
  spreadsheet.addSheet('Family_Candidates', [duplicate, duplicate.map((header) => `value-${header}`)], duplicate.length);
  spreadsheet.addSheet('Family_Review_Items', [headers.reviewItems]);
  const before = valuesSnapshot(spreadsheet);
  assert.strictEqual(context.setupFamilyInboxSchema(), 'CONFIGURATION_ERROR', 'FI-MIG12 duplicate header');
  assert.deepStrictEqual(valuesSnapshot(spreadsheet), before, 'FI-MIG13 duplicate header changed data');
}

{
  assert.strictEqual(loadHarness({ property: '' }).context.setupFamilyInboxSchema(), 'CONFIGURATION_ERROR', 'FI-SET25 missing property');
  assert.strictEqual(loadHarness({ openThrows: true }).context.setupFamilyInboxSchema(), 'CONFIGURATION_ERROR', 'FI-SET26 open failure');
  const code = fs.readFileSync('gas-family-inbox/Code.js', 'utf8');
  assert(!code.includes('setupFamilyInboxSchema'), 'FI-SET27 setup must not be exposed through Web App');
}

console.log('PASS Family Inbox setup creates empty schemas, performs known append-only migrations, fails closed before unsafe mutation, and preserves rows/history');

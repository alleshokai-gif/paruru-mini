'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

class Range {
  constructor(sheet, row, column, rowCount, columnCount) {
    this.sheet = sheet;
    this.row = row;
    this.column = column;
    this.rowCount = rowCount;
    this.columnCount = columnCount;
  }

  getValues() {
    this.sheet.calls.push({ method: 'getValues', row: this.row, column: this.column });
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
  constructor(name, values) {
    this.name = name;
    this.values = clone(values || []);
    this.calls = [];
    this.frozenRows = 0;
  }

  getLastColumn() {
    this.calls.push({ method: 'getLastColumn' });
    return this.values.reduce((maximum, row) => Math.max(maximum, row.length), 0);
  }

  getLastRow() {
    this.calls.push({ method: 'getLastRow' });
    return this.values.length;
  }

  getRange(row, column, rowCount, columnCount) {
    this.calls.push({ method: 'getRange', row, column, rowCount, columnCount });
    return new Range(this, row, column, rowCount, columnCount);
  }

  appendRow(row) {
    this.calls.push({ method: 'appendRow', values: clone(row) });
    this.values.push(row.slice());
  }

  setFrozenRows(count) {
    this.calls.push({ method: 'setFrozenRows', count });
    this.frozenRows = count;
  }
}

class Spreadsheet {
  constructor() {
    this.sheets = {};
    this.calls = [];
  }

  addSheet(name, values) {
    const sheet = new Sheet(name, values);
    this.sheets[name] = sheet;
    return sheet;
  }

  getSheetByName(name) {
    this.calls.push({ method: 'getSheetByName', name });
    return this.sheets[name] || null;
  }

  insertSheet(name) {
    this.calls.push({ method: 'insertSheet', name });
    const sheet = new Sheet(name, []);
    this.sheets[name] = sheet;
    return sheet;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadHarness() {
  const spreadsheet = new Spreadsheet();
  const context = {
    SpreadsheetApp: {
      openById(id) {
        assert.strictEqual(id, 'health-spreadsheet-id');
        return spreadsheet;
      },
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => key === 'HEALTH_SPREADSHEET_ID' ? 'health-spreadsheet-id' : '',
      }),
    },
    healthErr_(code) {
      const error = new Error(code);
      error.code = code;
      return error;
    },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('gas-health/HealthSetup.js', 'utf8'), context);
  const headers = clone(vm.runInContext('({ human: HEALTH_HEADERS, pet: PET_HEALTH_HEADERS })', context));
  return { context, spreadsheet, headers };
}

function addHumanFixtures(spreadsheet, headers) {
  const dailyHeaders = headers.human.daily.slice(0, 34);
  spreadsheet.addSheet('Health_Daily', [dailyHeaders, dailyHeaders.map((_, index) => `daily-${index}`)]);
  spreadsheet.addSheet('Health_Weight', [headers.human.weight, headers.human.weight.map((_, index) => `weight-${index}`)]);
  spreadsheet.addSheet('Health_Request_Log', [headers.human.request, headers.human.request.map((_, index) => `request-${index}`)]);
}

function humanSnapshot(spreadsheet) {
  return clone(['Health_Daily', 'Health_Weight', 'Health_Request_Log'].reduce((result, name) => {
    result[name] = {
      values: spreadsheet.sheets[name].values,
      frozenRows: spreadsheet.sheets[name].frozenRows,
    };
    return result;
  }, {}));
}

function assertConfigurationError(fn, id) {
  assert.throws(fn, (error) => error && error.code === 'CONFIGURATION_ERROR', id);
}

{
  const { context, spreadsheet, headers } = loadHarness();
  addHumanFixtures(spreadsheet, headers);
  const humanBefore = humanSnapshot(spreadsheet);
  const setupSource = vm.runInContext('setupPetHealthSchema.toString()', context);
  assert(!setupSource.includes('setupHealthSchema('), 'Pet setup must not delegate to Human setup');

  context.setupPetHealthSchema();

  assert.deepStrictEqual(
    spreadsheet.calls.filter((call) => call.method === 'insertSheet').map((call) => call.name),
    ['Pet_Health_Events', 'Pet_Health_Request_Log'],
    'PH-SET01',
  );
  assert.strictEqual(spreadsheet.sheets.Health_Daily.values[0].length, 34, 'PH-SET02');
  assert.deepStrictEqual(humanSnapshot(spreadsheet), humanBefore, 'PH-SET03');
  const humanCalls = ['Health_Daily', 'Health_Weight', 'Health_Request_Log'].flatMap((name) => spreadsheet.sheets[name].calls);
  assert.deepStrictEqual(humanCalls, [], 'PH-SET04');
  assert(!spreadsheet.calls.some((call) => call.method === 'getSheetByName' && call.name.startsWith('Health_')), 'PH-SET04 Human sheet read');
  assert.deepStrictEqual(spreadsheet.sheets.Pet_Health_Events.values[0], headers.pet.events, 'PH-SET05');
  assert.deepStrictEqual(spreadsheet.sheets.Pet_Health_Request_Log.values[0], headers.pet.request, 'PH-SET06');
  assert.strictEqual(spreadsheet.sheets.Pet_Health_Events.frozenRows, 1, 'PH-SET07 events');
  assert.strictEqual(spreadsheet.sheets.Pet_Health_Request_Log.frozenRows, 1, 'PH-SET07 request');

  spreadsheet.sheets.Pet_Health_Events.values.push(['event-existing']);
  spreadsheet.sheets.Pet_Health_Request_Log.values.push(['request-existing']);
  const sheetCountBeforeReplay = Object.keys(spreadsheet.sheets).length;
  const petValuesBeforeReplay = clone({
    events: spreadsheet.sheets.Pet_Health_Events.values,
    request: spreadsheet.sheets.Pet_Health_Request_Log.values,
  });
  const setValuesBeforeReplay = Object.values(spreadsheet.sheets)
    .flatMap((sheet) => sheet.calls)
    .filter((call) => call.method === 'setValues').length;

  context.setupPetHealthSchema();

  assert.strictEqual(Object.keys(spreadsheet.sheets).length, sheetCountBeforeReplay, 'PH-SET08');
  const setValuesAfterReplay = Object.values(spreadsheet.sheets)
    .flatMap((sheet) => sheet.calls)
    .filter((call) => call.method === 'setValues').length;
  assert.strictEqual(setValuesAfterReplay, setValuesBeforeReplay, 'PH-SET09');
  assert.deepStrictEqual({
    events: spreadsheet.sheets.Pet_Health_Events.values,
    request: spreadsheet.sheets.Pet_Health_Request_Log.values,
  }, petValuesBeforeReplay, 'PH-SET10');
  assert.deepStrictEqual(humanSnapshot(spreadsheet), humanBefore, 'Human sheets changed on replay');
}

{
  const { context, spreadsheet, headers } = loadHarness();
  const existingPrefix = headers.pet.events.slice(0, -2);
  spreadsheet.addSheet('Pet_Health_Events', [existingPrefix, ['existing-data']]);
  spreadsheet.addSheet('Pet_Health_Request_Log', [headers.pet.request]);
  context.setupPetHealthSchema();
  assert.deepStrictEqual(spreadsheet.sheets.Pet_Health_Events.values[0], headers.pet.events, 'PH-SET11');
  assert.strictEqual(spreadsheet.sheets.Pet_Health_Events.values[1][0], 'existing-data', 'PH-SET11 data moved');
  const tailWrite = spreadsheet.sheets.Pet_Health_Events.calls.find((call) => call.method === 'setValues');
  assert.strictEqual(tailWrite.column, existingPrefix.length + 1, 'PH-SET11 append position');
  assert.deepStrictEqual(tailWrite.values[0], headers.pet.events.slice(-2), 'PH-SET11 appended fields');
}

{
  const { context, spreadsheet, headers } = loadHarness();
  const reordered = headers.pet.events.slice();
  [reordered[0], reordered[1]] = [reordered[1], reordered[0]];
  spreadsheet.addSheet('Pet_Health_Events', [reordered]);
  spreadsheet.addSheet('Pet_Health_Request_Log', [headers.pet.request]);
  assertConfigurationError(() => context.setupPetHealthSchema(), 'PH-SET12');
}

{
  const { context, spreadsheet, headers } = loadHarness();
  const unknownInserted = headers.pet.events.slice();
  unknownInserted.splice(3, 0, 'unknownHeader');
  spreadsheet.addSheet('Pet_Health_Events', [unknownInserted]);
  spreadsheet.addSheet('Pet_Health_Request_Log', [headers.pet.request]);
  assertConfigurationError(() => context.setupPetHealthSchema(), 'PH-SET13');
}

{
  const { context, spreadsheet, headers } = loadHarness();
  const duplicate = headers.pet.events.slice();
  duplicate.splice(4, 0, duplicate[3]);
  spreadsheet.addSheet('Pet_Health_Events', [duplicate]);
  spreadsheet.addSheet('Pet_Health_Request_Log', [headers.pet.request]);
  assertConfigurationError(() => context.setupPetHealthSchema(), 'PH-SET14');
}

console.log('PASS Pet setup PH-SET01..14 isolation, schema, idempotency, and migration guard');

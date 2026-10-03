'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const headers = ['source', 'generated_at', 'date', 'start', 'end'];
const generated = '2026-09-15T15:50:00+09:00';
const rows = [
  ['Gmail:PALURU_AVAILABILITY', generated, '2026-09-15', '16:30', '17:00'],
  ['Gmail:PALURU_AVAILABILITY', generated, '2026-09-16', '10:00', '11:00'],
];
const sheet = {
  getLastColumn: () => 5,
  getLastRow: () => 1 + rows.length,
  getRange: (row) => ({getValues: () => row === 1 ? [headers] : rows}),
};
const context = vm.createContext({
  SpreadsheetApp: {getActiveSpreadsheet: () => ({getSheetByName: name => name === 'WorkBusy' ? sheet : null})},
  Utilities: {formatDate: () => {throw Error('Unexpected date conversion');}},
});
for (const file of ['WorkBusyImportService.js', 'KazOsWorkBusyRead.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, 'gas', file), 'utf8'), context);
}

const result = context.buildKazOsWorkBusyToday_('2026-09-15');
assert.equal(result.status, 'ok');
assert.equal(result.source, 'Gmail:PALURU_AVAILABILITY');
assert.equal(result.generated_at, generated);
assert.equal(result.date, '2026-09-15');
assert.deepEqual(JSON.parse(JSON.stringify(result.intervals)), [
  {start: '2026-09-15T16:30:00+09:00', end: '2026-09-15T17:00:00+09:00'},
]);
assert.equal(context.buildKazOsWorkBusyToday_('2026-09-17').intervals.length, 0);
sheet.getLastColumn = () => 4;
assert.equal(context.buildKazOsWorkBusyToday_('2026-09-15').status, 'failed');
console.log('kaz-today-free-windows: PASS');

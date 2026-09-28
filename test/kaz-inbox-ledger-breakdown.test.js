'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
let nowMs = 1000;
let writes = 0;
let headerRangeCalls = 0;
let dataRangeCalls = 0;
class ClockDate extends Date { static now() { return nowMs; } }
const headers = ['answerId', 'proposalId', 'decisionId', 'questionRevision', 'sourceRevisionsJson',
  'actor', 'selectedOptionJson', 'reason', 'answeredAt', 'retainUntil', 'idempotencyKey',
  'requestHash', 'answerJson', 'proposalJson', 'persistenceStatus'];
const sheet = {
  getLastColumn() { nowMs += 3; return headers.length; },
  getRange() { headerRangeCalls++; nowMs += 4; return { getValues() { nowMs += 11; return [headers]; } }; },
  getDataRange() { dataRangeCalls++; nowMs += 5; return { getValues() { nowMs += 40; return [headers]; } }; },
  setValues() { writes++; throw Error('WRITE_FORBIDDEN'); },
};
const context = {
  Date: ClockDate, JSON, Math, Number, Object, Array, String, Set,
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'true' }) },
  SpreadsheetApp: { getActiveSpreadsheet() { nowMs += 7; return {
    getSheetByName() { nowMs += 9; return sheet; },
  }; } },
  Utilities: { formatDate: () => '2026-09-28' },
  homeMembershipError_: code => Object.assign(new Error(code), { code }),
};
vm.createContext(context);
for (const file of ['gas/KazOsInbox.js', 'gas/KazOsInboxAnswer.js', 'gas/KazOsToday.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}

const trace = context.createKazOsInboxTrace_('123e4567-e89b-42d3-a456-426614174000');
trace.debug_timing_requested = true;
assert.equal(context.buildKazOsTodayPlanningClassifications_(trace).length, 0);
assert.equal(context.buildKazOsTodayPlanningEvidence_(trace).preferences.length, 0);
const projected = context.applyKazOsDecisionLedger_({ inbox_items: [], calendar_events: [],
  work_items: [], sources: { projects: { source_revision: 'p' }, tasks: { source_revision: 'w' },
    calendar: { source_revision: 'c' } } }, trace);
assert.equal(projected.persistence.answers, 0);
const breakdown = context.buildKazOsLedgerBreakdown_(trace);
assert.deepEqual(Object.keys(breakdown), ['read_count', 'spreadsheet_open_ms', 'sheet_get_ms',
  'range_get_ms', 'rows_read_ms', 'filter_parse_ms', 'planning_projection_ms', 'confirmed_current_ms']);
assert.equal(breakdown.read_count, 3, 'INBOX should account for all three ledger reads');
assert.equal(breakdown.spreadsheet_open_ms, 21);
assert.equal(breakdown.sheet_get_ms, 27);
assert.equal(breakdown.range_get_ms, 15);
assert.equal(breakdown.rows_read_ms, 120);
assert.equal(headerRangeCalls, 0, 'read path must not fetch the header range separately');
assert.equal(dataRangeCalls, 3, 'each ledger read fetches one complete range');
assert.equal(writes, 0);
assert(!JSON.stringify(breakdown).includes('answerId'));

const ordinaryTrace = context.createKazOsInboxTrace_('123e4567-e89b-42d3-a456-426614174001');
context.readKazOsDecisionLedger_(ordinaryTrace);
assert.equal(ordinaryTrace.ledger_breakdown_ms, undefined);
assert.equal(ordinaryTrace.ledger_read_count, undefined);
assert.equal(writes, 0);

sheet.getDataRange = () => ({ getValues: () => [headers.slice(0, -1)] });
assert.throws(() => context.readKazOsDecisionLedger_(), { code: 'KAZ_PERSISTENCE_SCHEMA_MISMATCH' });
assert.equal(writes, 0);

console.log('PASS INBOX ledger range reuse, schema guard, debug-only numbers, and zero writes');

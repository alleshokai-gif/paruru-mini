'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'gas', 'KazOsToday.js'), 'utf8');
const rows = [
  { answer: { source_revision_references: { calendar: 'calendar-version-a' } },
    proposal: { change: { kind: 'CALENDAR_CLASSIFICATION_PROPOSAL',
      target_event_ref: 'synthetic-event', impact_on_kaz: 'hard_constraint', coverage: 'full_event' } } },
  { answer: { answered_at: '2026-11-17T00:00:00Z' }, proposal: { change: {
    kind: 'DAILY_PLANNING_PREFERENCE', work_item_id: 'synthetic-work',
    work_item_source_revision: 'work-version-a', planning_date: '2026-11-17',
    expires_at: '2099-01-01T00:00:00Z', preference: 'today', estimate_min: 10,
    timezone: 'Asia/Tokyo', source: 'human' } } },
];

function harness(read, enabled = true) {
  let ledgerReads = 0, backendReads = 0, payload;
  const context = {
    Date, JSON, Number, Object, Array, String,
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'https://reader.invalid/v1/projects' }) },
    getKazOsProgressReadToken_: () => 'synthetic-token-that-is-long-enough-for-local-validation',
    buildKazOsCalendarCapture_: () => ({ synthetic: true }),
    buildKazOsWorkBusyToday_: date => ({ status: 'failed', date, intervals: [] }),
    Utilities: { formatDate: () => '2026-11-17' },
    isKazOsInboxAnswerEnabled_: () => enabled,
    readKazOsDecisionLedger_: () => { ledgerReads++; return read(ledgerReads); },
    recordKazOsTransport_: () => {},
    homeMembershipError_: code => Object.assign(new Error(code), { code }),
    UrlFetchApp: { fetch: (_, options) => {
      backendReads++;
      payload = JSON.parse(options.payload);
      return { getResponseCode: () => 200, getContentText: () => '{}' };
    } },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return { context, stats: () => ({ ledgerReads, backendReads, payload }) };
}

test('TODAY shares one immutable ledger read between both projections', () => {
  const original = JSON.stringify(rows);
  const h = harness(call => call === 1 ? rows : []);
  h.context.readKazOsToday_();
  const { ledgerReads, backendReads, payload } = h.stats();
  assert.equal(ledgerReads, 1, 'do not read the same Sheet twice for one request');
  assert.equal(backendReads, 1);
  assert.equal(payload.classifications.items[0].calendar_source_revision, 'calendar-version-a');
  assert.equal(payload.planning.preferences[0].work_item_source_revision, 'work-version-a');
  assert.equal(payload.planning.daily_estimates[0].estimate_min, 10);
  assert.equal(payload.work_busy.status, 'failed', 'a ledger optimization must not upgrade WorkBusy');
  assert.equal(JSON.stringify(rows), original, 'source snapshot must not be mutated');
});

test('a ledger outage is read once and preserves empty evidence and failed WorkBusy', () => {
  const h = harness(() => { throw new Error('synthetic outage'); });
  h.context.readKazOsToday_();
  const { ledgerReads, payload } = h.stats();
  assert.equal(ledgerReads, 1);
  assert.deepEqual(payload.classifications.items, []);
  assert.deepEqual(payload.planning.preferences, []);
  assert.deepEqual(payload.planning.daily_estimates, []);
  assert.equal(payload.work_busy.status, 'failed');
});

test('disabled human evidence never reads the ledger', () => {
  const h = harness(() => { throw new Error('must not read'); }, false);
  h.context.readKazOsToday_();
  assert.equal(h.stats().ledgerReads, 0);
  assert.deepEqual(h.stats().payload.classifications.items, []);
});

test('non-array ledger response cannot cause a second read', () => {
  const h = harness(() => undefined);
  h.context.readKazOsToday_();
  assert.equal(h.stats().ledgerReads, 1);
  assert.deepEqual(h.stats().payload.planning.preferences, []);
});

test('standalone projection helpers retain existing on-demand reads', () => {
  const h = harness(() => rows);
  assert.equal(h.context.buildKazOsTodayPlanningClassifications_().length, 1);
  assert.equal(h.context.buildKazOsTodayPlanningEvidence_().preferences.length, 1);
  assert.equal(h.stats().ledgerReads, 2);
});

test('an explicitly empty request snapshot cannot fall back to a fresh read', () => {
  const h = harness(() => { throw new Error('must not read'); });
  assert.equal(h.context.buildKazOsTodayPlanningClassifications_([]).length, 0);
  assert.equal(h.context.buildKazOsTodayPlanningEvidence_([]).preferences.length, 0);
  assert.equal(h.stats().ledgerReads, 0);
});

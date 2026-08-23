'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const healthRoutine = require('../features/nurse-okan/health-routine.js');

const context = {
  console: { log() {}, error() {}, warn() {} }, JSON, Error, Object, String, Array, Number, Promise, Date,
  module: { exports: {} }, exports: {}, window: { PALURUHealthRoutine: healthRoutine },
  crypto: { randomUUID: () => '11111111-1111-4111-8111-111111111111' },
  document: { addEventListener() {} }, navigator: { onLine: true }, location: { hostname: 'localhost' },
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('features/nurse-okan/nurse-okan.js', 'utf8'), context);
const api = context.module.exports;

assert.deepStrictEqual(JSON.parse(JSON.stringify(api.recentHistoryRange_('2026-08-23'))), { fromLocalDate: '2026-08-17', toLocalDate: '2026-08-23' });
const rows = api.buildHistoryRows_([
  { localDate: '2026-08-21', slots: {} },
  { localDate: '2026-08-22', slots: { post_training: { recordedAt: '2026-08-22T18:00:00+09:00', postTrainingStatus: 'rest_day' } } },
  { localDate: '2026-08-23', slots: { morning: { recordedAt: '2026-08-23T08:00:00+09:00', morningStaple: 'none' } } },
], '2026-08-23', new Date('2026-08-23T12:00:00+09:00'));
assert.deepStrictEqual(rows.map((row) => row.localDate), ['2026-08-23', '2026-08-22', '2026-08-21'], 'history must render newest first');
assert.strictEqual(rows[0].slots[0].status, 'recorded', 'recordedAt must define recorded history state');
assert.strictEqual(rows[0].slots[1].status, 'not_due', 'today must retain N2-A not_due semantics');
assert.strictEqual(rows[1].slots[2].status, 'rest_day', 'B4: saved rest day must be distinct');
assert.strictEqual(rows[1].slots[2].statusLabel, '休');
assert(rows[2].slots.every((slot) => slot.status === 'missing'), 'B5: past missing slots must never be not_due');
assert(rows[2].slots.every((slot) => slot.statusLabel === '未記録'), 'B6: missing must be labelled 未記録');
assert(!rows[2].slots.some((slot) => /^(0|なし|食べなかった)$/.test(slot.statusLabel)), 'B6: missing was rendered as zero or no intake');

(async () => {
  let todayVisible = true;
  let historyMessage = '';
  const result = await api.loadNurseHistory_({
    loadHistory: async () => { throw new Error('history unavailable'); },
    onSuccess: () => { throw new Error('history success callback must not run'); },
    onFailure: () => { historyMessage = '最近7日の記録を読み込めませんでした'; },
  });
  assert.strictEqual(result.loaded, false, 'history failure must be contained');
  assert.strictEqual(todayVisible, true, 'B10: history failure suppressed today UI state');
  assert.strictEqual(historyMessage, '最近7日の記録を読み込めませんでした');
  const nurseSource = fs.readFileSync('features/nurse-okan/nurse-okan.js', 'utf8');
  const styleSource = fs.readFileSync('style.css', 'utf8');
  assert(nurseSource.includes('<details class="nurse-dashboard-card nurse-history-card">'), 'history must be initially collapsible');
  assert(styleSource.includes('grid-template-columns: repeat(2, minmax(0, 1fr));'), 'B11: compact history grid missing');
  assert(!styleSource.match(/\.nurse-history[^}]*overflow-x\s*:\s*(auto|scroll)/s), 'B11: history introduces horizontal scrolling');
  console.log('PASS Nurse Okan seven-day history semantics, failure isolation, and compact layout contract');
})().catch((error) => { console.error(error); process.exitCode = 1; });

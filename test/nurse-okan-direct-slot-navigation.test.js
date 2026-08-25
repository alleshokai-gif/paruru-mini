'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const healthRoutine = require('../features/nurse-okan/health-routine.js');

const context = {
  console, JSON, Error, Object, String, Array, Number, Promise, Date,
  module: { exports: {} }, exports: {}, window: { PALURUHealthRoutine: healthRoutine },
  crypto: { randomUUID: () => '11111111-1111-4111-8111-111111111111' },
  document: { addEventListener() {} }, navigator: { onLine: true }, location: { hostname: 'localhost' },
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('features/nurse-okan/nurse-okan.js', 'utf8'), context);
const api = context.module.exports;
const plain = (value) => JSON.parse(JSON.stringify(value));

const unrecorded = { slots: { morning: {}, lunch: {}, post_training: {}, dinner: {}, condition: {} } };
assert.deepStrictEqual(plain(api.resolveDirectSlotSelection_('lunch', 'lunch', unrecorded)), {
  slot: 'lunch', field: 'lunch', label: '昼食', isCorrection: false,
}, 'breakfast must not gate direct lunch entry');
assert.deepStrictEqual(plain(api.resolveDirectSlotSelection_('post_training', 'water', unrecorded)), {
  slot: 'post_training', field: 'water', label: '水分', isCorrection: false,
}, 'breakfast must not gate direct water entry');
assert.deepStrictEqual(plain(api.resolveDirectSlotSelection_('post_training', 'protein', unrecorded)), {
  slot: 'post_training', field: 'protein', label: 'プロテイン', isCorrection: false,
}, 'breakfast must not gate direct protein entry');
assert.deepStrictEqual(plain(api.resolveDirectSlotSelection_('dinner', 'dinner', unrecorded)), {
  slot: 'dinner', field: 'dinner', label: '夕食', isCorrection: false,
}, 'dinner must be directly selectable');
assert.deepStrictEqual(plain(api.resolveDirectSlotSelection_('dinner', 'sleep', unrecorded)), {
  slot: 'dinner', field: 'sleep', label: '就寝', isCorrection: false,
}, 'other existing form fields must remain directly selectable');

const recorded = { slots: { morning: { recordedAt: '2026-08-24T08:00:00+09:00', morningStaple: 'normal' } } };
assert.deepStrictEqual(plain(api.resolveDirectSlotSelection_('morning', 'breakfast', recorded)), {
  slot: 'morning', field: 'breakfast', label: '朝食', isCorrection: true,
}, 'recorded slot must reopen through the correction contract');
assert.strictEqual(api.resolveDirectSlotSelection_('morning', 'protein', unrecorded), null, 'unknown field must fail closed');
assert.strictEqual(api.resolveDirectSlotSelection_('unknown', '', unrecorded), null, 'unknown slot must fail closed');
assert.strictEqual(api.directSlotStatusLabel_('recorded'), '記録済み');
assert.strictEqual(api.directSlotStatusLabel_('not_due'), '未記録');
assert.strictEqual(api.directSlotStatusLabel_('due_missing'), '未記録');

const source = fs.readFileSync('features/nurse-okan/nurse-okan.js', 'utf8');
const css = fs.readFileSync('style.css', 'utf8');
const shell = source.slice(source.indexOf('root.innerHTML ='), source.indexOf('mount.append(root);'));
const shellOrder = [
  'class="nurse-dashboard-card nurse-kpi-card"',
  'class="nurse-okan-talk paruru-hero"',
  'class="nurse-dashboard-card nurse-action-card"',
  'id="nurseMissingCard"',
  'class="nurse-dashboard-card nurse-progress-card"',
  'class="nurse-dashboard-card nurse-history-card"',
].map((marker) => shell.indexOf(marker));
assert(shellOrder.every((index) => index >= 0), 'Nurse Okan dashboard section is missing');
assert(shellOrder.every((index, position) => position === 0 || shellOrder[position - 1] < index), 'Nurse Okan dashboard information hierarchy is out of order');
assert(source.includes("const talk=root.querySelector('.nurse-okan-talk');if(talk&&talk.parentNode)talk.parentNode.insertBefore(trendCard,talk);"), 'weight trend must sit after KPI and before Nurse Okan comment');
assert(source.includes('id="nurseActionTitle">🕐 いまのチェック'), 'current-time check heading missing');
assert(source.includes('id="nurseMissingTitle">⚠️ 今日の未記録'), 'due-missing recovery heading missing');
assert(source.includes('id="nurseProgressTitle">📋 今日の記録'), 'today record navigation heading missing');
assert(source.includes('data-nurse-open-slot') && source.includes('dataset.nurseFocusField'), 'direct slot navigation controls missing');
assert(source.includes("state.selectedSlot=selection.slot;state.selectedField=selection.field"), 'direct selection does not drive the existing slot form');
assert(source.includes('resolveCurrentHealthCheck_') && source.includes('buildMissingReminderState_'), 'current and missing selectors are not separated');
assert(source.includes("expanded=state.selectedSlot===progress.slot") && source.includes("if(expanded){const panel=renderRecordAccordionPanel_"), 'today record list is not a one-slot accordion');
assert(source.includes("if(!state.pendingOpen){clearDailySelection_();}"), 'ordinary Nurse Okan open must start with every record slot closed');
assert(source.includes("clearDailySelection_();document.dispatchEvent") && source.includes('render_();focusRecordList_();'), 'save must return to the freely selectable record list');
assert(css.includes('.nurse-progress-open') && css.includes('.nurse-record-panel') && css.includes('.nurse-missing-card'), 'direct navigation or missing alert styles missing');

const missingAtNoon = api.buildMissingReminderState_(unrecorded, new Date('2026-08-24T12:00:00+09:00'));
assert.deepStrictEqual(plain(missingAtNoon.items.map((item) => item.slot)), ['morning']);
assert.strictEqual(missingAtNoon.count, 1);
assert.strictEqual(missingAtNoon.severity, 'reminder');
const missingAtNight = api.buildMissingReminderState_(unrecorded, new Date('2026-08-24T23:00:00+09:00'));
assert.deepStrictEqual(plain(missingAtNight.items.map((item) => item.slot)), ['morning', 'lunch', 'dinner', 'condition']);
assert.strictEqual(missingAtNight.severity, 'strong');

const payload = api.buildHealthRequest_('health.daily.recordSlot', 'second_son', {
  localDate: '2026-08-24', slot: 'lunch', payload: { lunchAmount: 'all' }, clientRequestId: 'request-1',
});
assert.deepStrictEqual(plain(payload), {
  action: 'health.daily.recordSlot', targetMemberUserId: 'second_son', localDate: '2026-08-24', slot: 'lunch', payload: { lunchAmount: 'all' }, clientRequestId: 'request-1',
}, 'Health recordSlot payload contract changed');

(async () => {
  let reads = 0;
  const refreshedDaily = { slots: { lunch: { recordedAt: '2026-08-24T12:00:00+09:00' } } };
  const refreshed = await api.reReadDailyAfterSlotSave_({ loadDaily: async () => { reads += 1; return refreshedDaily; } }, unrecorded);
  assert.strictEqual(reads, 1, 'successful slot save must re-read today once');
  assert.strictEqual(refreshed.refreshed, true);
  assert.strictEqual(api.buildProgressState_(refreshed.daily, new Date('2026-08-24T12:30:00+09:00'))[1].status, 'recorded', 're-read state must update the today list');

  let failures = 0;
  const fallback = await api.reReadDailyAfterSlotSave_({
    loadDaily: async () => { throw new Error('read failed'); },
    onFailure: () => { failures += 1; },
  }, recorded);
  assert.strictEqual(fallback.refreshed, false, 'failed re-read must be explicit');
  assert.strictEqual(failures, 1);
  assert.strictEqual(fallback.daily.slots.morning.recordedAt, recorded.slots.morning.recordedAt, 'save response fallback must be preserved');
  console.log('PASS Nurse Okan direct slot navigation, save re-read, recommendation, and payload contract');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

'use strict';

const assert = require('assert');
const {
  MISSING_AFTER_HOURS,
  resolveRoutineStatus,
  resolveNextHealthTask,
  resolveCurrentHealthCheck,
  listDueMissingRoutines,
  isRoutineComplete,
} = require('../features/nurse-okan/health-routine.js');

const at = (hour) => new Date(`2026-07-29T${String(hour).padStart(2, '0')}:00:00+09:00`);
const recorded = (values = {}) => Object.assign({ recordedAt: '2026-07-29T08:00:00+09:00' }, values);

assert.deepStrictEqual(MISSING_AFTER_HOURS, {
  morning: 9,
  lunch: 15,
  dinner: 22,
  condition: 23,
});

// T1: 内容が不足していても、recordedAt があれば記録済み。
assert.strictEqual(isRoutineComplete('morning', recorded({
  morningStaple: 'none',
  morningWater: false,
  morningMedication: false,
  morningCondition: false,
})), true);

// T3-T5: 食事slotのmissing猶予はAsia/Tokyoの時刻定数に従う。
assert.strictEqual(resolveRoutineStatus('morning', {}, at(9)), 'due_missing');
assert.strictEqual(resolveRoutineStatus('lunch', {}, at(12)), 'not_due');
assert.strictEqual(resolveRoutineStatus('lunch', {}, at(15)), 'due_missing');

// T6-T7: rest_day保存済みはrecorded、未保存の部活後は時刻だけでdue_missingにしない。
assert.strictEqual(resolveRoutineStatus('post_training', recorded({ postTrainingStatus: 'rest_day' }), at(17)), 'recorded');
assert.strictEqual(resolveRoutineStatus('post_training', {}, at(23)), 'not_due');

// T8-T9: 夕食と体調のmissing開始時刻。
assert.strictEqual(resolveRoutineStatus('dinner', {}, at(22)), 'due_missing');
assert.strictEqual(resolveRoutineStatus('condition', {}, at(23)), 'due_missing');

assert.deepStrictEqual(resolveNextHealthTask({ slots: {} }, at(12)), {
  slot: 'morning', title: '朝の健康記録', status: 'due_missing', overdue: true, priority: 'high', action: 'daily',
});

// 現在入力は期限超過の優先順位と分離し、時刻に対応するslotだけを返す。
assert.deepStrictEqual(resolveCurrentHealthCheck({ slots: {} }, at(22)), {
  slot: 'condition', title: '体調の健康記録', status: 'not_due', overdue: false, action: 'daily',
});
assert.deepStrictEqual(resolveCurrentHealthCheck({ slots: {} }, at(21)), {
  slot: 'dinner', title: '夜の健康記録', status: 'not_due', overdue: false, action: 'daily',
});
assert.deepStrictEqual(resolveCurrentHealthCheck({ slots: { condition: recorded() } }, at(22)), {
  slot: 'condition', title: '体調の健康記録', status: 'recorded', overdue: false, action: 'daily',
});
assert.strictEqual(resolveCurrentHealthCheck({ slots: {} }, at(6)), null);

// due_missingだけが「今日の未記録」。futureとpost_training未確認は含めない。
assert.deepStrictEqual(listDueMissingRoutines({ slots: {} }, at(12)).map((item) => item.slot), ['morning']);
assert.deepStrictEqual(listDueMissingRoutines({ slots: {} }, at(22)).map((item) => item.slot), ['morning', 'lunch', 'dinner']);
assert.deepStrictEqual(listDueMissingRoutines({ slots: { morning: recorded(), dinner: recorded() } }, at(22)).map((item) => item.slot), ['lunch']);

assert.deepStrictEqual(resolveNextHealthTask({ slots: { morning: recorded() } }, at(12)), {
  slot: 'lunch', title: '昼の健康記録', status: 'not_due', overdue: false, priority: 'normal', action: 'daily',
});

assert.deepStrictEqual(resolveNextHealthTask({ slots: {
  morning: recorded(),
  lunch: recorded(),
} }, at(18)), {
  slot: 'post_training', title: '部活後の健康記録', status: 'not_due', overdue: false, priority: 'normal', action: 'daily',
});

assert.deepStrictEqual(resolveNextHealthTask({ slots: {
  morning: recorded(),
  lunch: recorded(),
} }, at(22)), {
  slot: 'dinner', title: '夜の健康記録', status: 'due_missing', overdue: true, priority: 'high', action: 'daily',
});

assert.deepStrictEqual(resolveNextHealthTask({ slots: {
  morning: recorded(),
  lunch: recorded(),
  dinner: recorded(),
  condition: recorded(),
} }, at(23)), {
  slot: 'post_training', title: '部活後の健康記録', status: 'not_due', overdue: false, priority: 'normal', action: 'daily',
});

assert.strictEqual(resolveNextHealthTask({ slots: {
  morning: recorded(),
  lunch: recorded(),
  post_training: recorded({ postTrainingStatus: 'rest_day' }),
  dinner: recorded(),
  condition: recorded(),
} }, at(23)), null);

console.log('PASS health routine recorded/due_missing/not_due semantics and ordering');

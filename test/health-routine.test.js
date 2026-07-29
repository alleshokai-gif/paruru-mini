'use strict';
const assert = require('assert');
const { resolveNextHealthTask } = require('../features/nurse-okan/health-routine.js');

const at = (hour) => new Date(`2026-07-29T${String(hour).padStart(2, '0')}:00:00+09:00`);

assert.deepStrictEqual(resolveNextHealthTask({ slots: {} }, at(8)), {
  slot: 'morning', title: '朝の健康記録', overdue: true, priority: 'high', action: 'daily',
});

assert.deepStrictEqual(resolveNextHealthTask({ slots: { morning: { morningStaple:'normal',morningWater:true,morningMedication:true,morningCondition:true } } }, at(13)), {
  slot: 'lunch', title: '昼の健康記録', overdue: true, priority: 'high', action: 'daily',
});

assert.deepStrictEqual(resolveNextHealthTask({ slots: { morning: { morningStaple:'normal',morningWater:true,morningMedication:true,morningCondition:true }, lunch: { lunchAmount:'all',lunchWater:true,lunchCondition:true } } }, at(14)), {
  slot: 'post_training', title: '部活後の健康記録', overdue: false, priority: 'normal', action: 'daily',
});

assert.strictEqual(resolveNextHealthTask({ slots: {
  morning: { morningStaple:'normal',morningWater:true,morningMedication:true,morningCondition:true }, lunch: { lunchAmount:'all',lunchWater:true,lunchCondition:true }, post_training: { postTrainingProteinSource:'protein',postTrainingOnigiriCount:1,postTrainingWater:true,postTrainingCondition:true },
  dinner: { dinnerRiceBowls:1,dinnerMedication:true,bedtime:true }, condition: { recordedAt: 'x' },
} }, at(23)), null);

assert.strictEqual(resolveNextHealthTask({ slots: { morning: { morningStaple:'normal',morningWater:true,morningMedication:false,morningCondition:true } } }, at(8)).slot, 'morning');
assert.strictEqual(resolveNextHealthTask({ slots: { morning: { morningStaple:'normal',morningWater:true,morningMedication:true,morningCondition:true }, lunch: { lunchAmount:'all',lunchWater:true,lunchCondition:false } } }, at(13)).slot, 'lunch');
assert.strictEqual(resolveNextHealthTask({ slots: { morning: { morningStaple:'normal',morningWater:true,morningMedication:true,morningCondition:true }, lunch: { lunchAmount:'all',lunchWater:true,lunchCondition:true }, post_training: { postTrainingProteinSource:'protein',postTrainingOnigiriCount:1,postTrainingWater:true,postTrainingCondition:false } } }, at(18)).slot, 'post_training');

console.log('PASS health routine resolution and overdue ordering');

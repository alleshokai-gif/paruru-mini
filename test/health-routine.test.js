'use strict';
const assert = require('assert');
const { resolveNextHealthTask } = require('../features/nurse-okan/health-routine.js');

const at = (hour) => new Date(`2026-07-29T${String(hour).padStart(2, '0')}:00:00+09:00`);

assert.deepStrictEqual(resolveNextHealthTask({ slots: {} }, at(8)), {
  slot: 'morning', title: '朝の健康記録', overdue: true, priority: 'high', action: 'daily',
});

assert.deepStrictEqual(resolveNextHealthTask({ slots: { morning: { recordedAt: '2026-07-29T07:30:00+09:00' } } }, at(13)), {
  slot: 'lunch', title: '昼の健康記録', overdue: true, priority: 'high', action: 'daily',
});

assert.deepStrictEqual(resolveNextHealthTask({ slots: { morning: { recordedAt: 'x' }, lunch: { recordedAt: 'x' } } }, at(14)), {
  slot: 'post_training', title: '部活後の健康記録', overdue: false, priority: 'normal', action: 'daily',
});

assert.strictEqual(resolveNextHealthTask({ slots: {
  morning: { recordedAt: 'x' }, lunch: { recordedAt: 'x' }, post_training: { recordedAt: 'x' },
  dinner: { recordedAt: 'x' }, condition: { recordedAt: 'x' },
} }, at(23)), null);

console.log('PASS health routine resolution and overdue ordering');

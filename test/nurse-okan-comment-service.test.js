'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const authorized = [];
const fetched = [];
const context = {
  JSON, Error, String, Object, Array, Number, Date, RegExp,
  Utilities: {
    formatDate: (_value, _timezone, format) => format === 'H' ? '12' : '2026-08-23'
  },
  createAgentGatewayError_: (code) => { const error = new Error(code); error.code = code; return error; },
  authorizeTargetOperation_: (actor, targetUserId, operation) => authorized.push({ actor, targetUserId, operation }),
  fetchHealthGatewayData_: (input, actor, targetUserId) => {
    fetched.push({ input, actor, targetUserId });
    if (input.action === 'health.daily.get') return { slots: {}, ruleCodes: [] };
    if (input.action === 'health.daily.list') return { items: [] };
    if (input.action === 'health.weight.list') return { items: [] };
    throw new Error('unexpected operation');
  }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('gas/NurseOkanCommentService.js', 'utf8'), context);

const facts = {
  localDate: '2026-08-23',
  daily: {
    slots: {
      morning: { recordedAt: '2026-08-23T07:00:00+09:00', morningMealType: 'rice_1', morningWaterType: 'milk_glass_1', morningCondition: true, morningConditionType: 'good', note: 'do not send' },
      post_training: { recordedAt: '2026-08-23T08:00:00+09:00', postTrainingStatus: 'rest_day' }
    },
    ruleCodes: ['on_track', 'symptom_attention', 'untrusted_rule']
  },
  weights: {
    items: [
      { recordId: 'old', measuredDate: '2026-08-20', weightKg: 52.3, status: 'corrected' },
      { recordId: 'new', measuredDate: '2026-08-23', weightKg: 53.2, status: 'active' }
    ],
    latest: { recordId: 'new', measuredDate: '2026-08-23', weightKg: 53.2, status: 'active' }
  },
  recent: {
    items: [
      { localDate: '2026-08-23', slots: { morning: { recordedAt: '2026-08-23T07:00:00+09:00' }, post_training: { recordedAt: '2026-08-23T08:00:00+09:00', postTrainingStatus: 'rest_day' } } },
      { localDate: '2026-08-22', slots: {} }
    ]
  }
};

const dto = JSON.parse(JSON.stringify(context.buildNurseOkanCommentContext_(facts, new Date('2026-08-23T03:00:00Z'))));
assert.deepStrictEqual(dto.today.morning, { state: 'recorded', summary: 'ご飯1杯 / 牛乳1杯 / 体調よい', restDay: false });
assert.deepStrictEqual(dto.today.postTraining, { state: 'recorded', summary: '部活なし', restDay: true });
assert.deepStrictEqual(dto.today.lunch, { state: 'not_due' });
assert.deepStrictEqual(dto.today.dinner, { state: 'not_due' });
assert.deepStrictEqual(dto.ruleCodes, ['on_track', 'symptom_attention']);
assert.deepStrictEqual(dto.weight, { latestKg: 53.2, previousDifferenceKg: null, sevenDayDifferenceKg: null, thirtyDayDifferenceKg: null, measurementCount: 1 });
assert.equal(JSON.stringify(dto).includes('do not send'), false, 'raw Daily note leaked into DTO');
assert.equal(JSON.stringify(dto).includes('old'), false, 'corrected Weight leaked into DTO');
assert.equal(dto.recent.days[1].states.morning, 'missing', 'past unrecorded slot was not missing');

const actor = { homeId: 'server-home', memberUserId: 'father', role: 'admin' };
const loaded = context.loadNurseOkanCommentFacts_({ actor, targetUserId: 'second_son' }, '2026-08-23');
assert.deepStrictEqual(JSON.parse(JSON.stringify(authorized.map((entry) => entry.operation))), ['health.daily.get', 'health.daily.list', 'health.weight.list']);
assert.deepStrictEqual(JSON.parse(JSON.stringify(fetched.map((entry) => entry.input))), [
  { action: 'health.daily.get', localDate: '2026-08-23' },
  { action: 'health.daily.list', fromLocalDate: '2026-08-17', toLocalDate: '2026-08-23' },
  { action: 'health.weight.list', fromLocalDate: '2026-07-25', toLocalDate: '2026-08-23' }
]);
assert.equal(loaded.localDate, '2026-08-23');

const request = context.validateNurseOkanCommentRequest_({
  clientRequestId: '11111111-1111-4111-8111-111111111111', deviceId: 'device', pairingToken: 'pair', targetMemberUserId: 'second_son',
  homeId: 'attacker-home', actorUserId: 'attacker', commentContext: { madeBy: 'pwa' }
});
assert.deepStrictEqual(JSON.parse(JSON.stringify(request)), {
  clientRequestId: '11111111-1111-4111-8111-111111111111', deviceId: 'device', pairingToken: 'pair', targetMemberUserId: 'second_son'
});
assert.throws(() => context.validateNurseOkanCommentOutput_('あ'.repeat(101)), (error) => error.code === 'AGENT_ERROR');
assert.throws(() => context.validateNurseOkanCommentOutput_('一。二。三。四。'), (error) => error.code === 'AGENT_ERROR');

console.log('PASS Nurse Okan comment DTO, server-side Health reads, corrected Weight exclusion, and output guard');

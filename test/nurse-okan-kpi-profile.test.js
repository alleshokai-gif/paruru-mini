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

assert.deepStrictEqual(plain(api.buildKpiValues_([{ weightKg: 50.9 }], null, null, { targetWeightKg: 55 })), {
  currentWeight: 50.9, targetWeight: 55, remainingKg: 4.1, achievementRate: null,
}, 'K2/K3: target and remaining KPI mismatch');
assert.deepStrictEqual(plain(api.buildKpiValues_([{ weightKg: 56 }], null, null, { targetWeightKg: 55 })), {
  currentWeight: 56, targetWeight: 55, remainingKg: 0, achievementRate: null,
}, 'K4: remaining weight must not be negative');
assert.deepStrictEqual(plain(api.buildKpiValues_([{ weightKg: 50.9 }], null, null, { targetWeightKg: null })), {
  currentWeight: 50.9, targetWeight: null, remainingKg: null, achievementRate: null,
}, 'K5: unset target must remain missing');
assert.strictEqual(api.formatKpiWeight_(50.9), '50.9', 'K1: current KPI format mismatch');
assert.strictEqual(api.formatKpiWeight_(55), '55.0', 'K2: target KPI must retain one decimal');
assert.strictEqual(api.normalizeTargetWeightKg_('55.0'), 55);
assert.throws(() => api.normalizeTargetWeightKg_('55.55'), /小数1桁/);

const request = api.buildHealthRequest_('health.profile.update', 'second_son', { targetWeightKg: 55, clientRequestId: 'request-1' });
assert.deepStrictEqual(plain(request), { action: 'health.profile.update', targetMemberUserId: 'second_son', targetWeightKg: 55, clientRequestId: 'request-1' });
['homeId', 'actorUserId', 'actorRole', 'updatedBy', 'deviceId', 'pairingToken', 'serviceToken'].forEach((key) => assert(!Object.hasOwn(request, key), `profile request leaked ${key}`));

function makeForm() {
  const button = { textContent: '保存', disabled: false };
  const attributes = {};
  return {
    dataset: { action: 'target-weight', clientRequestId: 'same-profile-request' },
    querySelector: (selector) => selector === 'button[type="submit"]' ? button : null,
    setAttribute: (name, value) => { attributes[name] = value; },
    inputValue: '55.0', button, attributes,
  };
}

(async () => {
  let release;
  let calls = 0;
  const form = makeForm();
  const flow = api.createNurseOkanSaveFlow_({
    call: async () => { calls += 1; return new Promise((resolve) => { release = resolve; }); },
    onSaving: () => api.setNurseFormSaving_(form, true), onSuccess: async () => {}, onSaved: () => {}, onFailure: () => {}, onSettled: () => api.setNurseFormSaving_(form, false),
  });
  const first = flow.save('health.profile.update', { targetWeightKg: 55, clientRequestId: form.dataset.clientRequestId });
  const second = await flow.save('health.profile.update', { targetWeightKg: 55, clientRequestId: form.dataset.clientRequestId });
  assert.strictEqual(calls, 1, 'K6: profile duplicate submit must be ignored');
  assert.strictEqual(second.skipped, true);
  assert.strictEqual(form.button.textContent, '保存中…');
  assert.strictEqual(form.button.disabled, true);
  release({ targetWeightKg: 55 });
  await first;
  assert.strictEqual(form.button.textContent, '保存');
  assert.strictEqual(form.button.disabled, false);

  const failureForm = makeForm();
  const failureFlow = api.createNurseOkanSaveFlow_({
    call: async () => { throw new Error('network'); }, onSaving: () => api.setNurseFormSaving_(failureForm, true), onSuccess: async () => {}, onSaved: () => {}, onFailure: () => {}, onSettled: () => api.setNurseFormSaving_(failureForm, false),
  });
  const failed = await failureFlow.save('health.profile.update', { targetWeightKg: 55, clientRequestId: failureForm.dataset.clientRequestId });
  assert.strictEqual(failed.saved, false, 'K7: failed profile write must remain retryable');
  assert.strictEqual(failureForm.inputValue, '55.0', 'K7: profile input must remain intact');
  assert.strictEqual(failureForm.dataset.clientRequestId, 'same-profile-request', 'K7: request ID must be retained');
  assert.strictEqual(failureForm.button.disabled, false);

  let profileFailure = 0;
  const loadResult = await api.loadNurseProfile_({ loadProfile: async () => { throw new Error('profile unavailable'); }, onSuccess: () => {}, onFailure: () => { profileFailure += 1; } });
  assert.strictEqual(loadResult.loaded, false, 'profile read failure must be isolated');
  assert.strictEqual(profileFailure, 1);

  const source = fs.readFileSync('features/nurse-okan/nurse-okan.js', 'utf8');
  const css = fs.readFileSync('style.css', 'utf8');
  assert(source.includes("setKpiValue_('nurseCurrentWeight',kpi.currentWeight===null?'--':formatKpiWeight_(kpi.currentWeight),'')"), 'K1: current KPI still renders a kg suffix');
  assert(source.includes("setKpiValue_('nurseTargetWeight',kpi.targetWeight===null?'--':formatKpiWeight_(kpi.targetWeight),'')"), 'target KPI still renders a kg suffix');
  assert(source.includes("latest.textContent='最新測定 '+formatWeightNumber_(summary.latest.weightKg)+'kg"), 'trend prose lost its kg unit');
  assert(source.includes('id="nurseTargetWeightEditor"') && source.includes("form.dataset.action='target-weight'"), 'target weight setting UI missing');
  assert(css.includes('.nurse-target-weight-form') && css.includes('@media (max-width: 390px)') && !css.match(/\.nurse-target-weight[^}]*overflow-x\s*:\s*(auto|scroll)/s), '390px target editor contract missing or horizontally scrollable');
  console.log('PASS Nurse Okan KPI units, target calculation, save guard, retry identity, and isolated profile load');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

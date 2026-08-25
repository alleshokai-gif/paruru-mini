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
const request = api.buildHealthRequest_('health.weight.correct', 'second_son', { recordId: '22222222-2222-4222-8222-222222222222', measuredDate: '2026-08-23', weightKg: 53.2, correctionReason: 'input typo', clientRequestId: '33333333-3333-4333-8333-333333333333' });
assert.deepStrictEqual(JSON.parse(JSON.stringify(request)), { action: 'health.weight.correct', targetMemberUserId: 'second_son', recordId: '22222222-2222-4222-8222-222222222222', measuredDate: '2026-08-23', weightKg: 53.2, correctionReason: 'input typo', clientRequestId: '33333333-3333-4333-8333-333333333333' });
['homeId', 'actorUserId', 'actorRole', 'recordedBy', 'serviceToken', 'deviceId', 'pairingToken'].forEach((key) => assert(!Object.hasOwn(request, key), `correction request leaked ${key}`));
const form = { dataset: {} };
assert.strictEqual(api.formRequestId_(form), '11111111-1111-4111-8111-111111111111');
assert.strictEqual(api.formRequestId_(form), '11111111-1111-4111-8111-111111111111', 'retry must reuse the form request id');
function makeForm(dataset, label) {
  const button = { textContent: label, disabled: false };
  const attributes = {};
  return {
    dataset: Object.assign({}, dataset),
    querySelector: (selector) => selector === 'button[type="submit"]' ? button : null,
    setAttribute: (name, value) => { attributes[name] = value; },
    button,
    attributes,
  };
}
function makeBusyFlow(form, call) {
  return api.createNurseOkanSaveFlow_({
    call,
    onSaving: () => api.setNurseFormSaving_(form, true),
    onSuccess: async () => {},
    onSaved: () => {},
    onFailure: () => {},
    onSettled: () => api.setNurseFormSaving_(form, false),
  });
}
(async () => {
  let releaseNormal;
  let normalCalls = 0;
  const normalForm = makeForm({ clientRequestId: 'normal-request' }, '記録する');
  const normalFlow = makeBusyFlow(normalForm, async () => {
    normalCalls += 1;
    return new Promise((resolve) => { releaseNormal = resolve; });
  });
  const normalFirst = normalFlow.save('health.daily.recordSlot', { clientRequestId: normalForm.dataset.clientRequestId });
  const normalSecond = await normalFlow.save('health.daily.recordSlot', { clientRequestId: normalForm.dataset.clientRequestId });
  assert.strictEqual(normalCalls, 1, 'M11: normal duplicate submit must not send twice');
  assert.strictEqual(normalSecond.skipped, true, 'M11: second normal submit must be ignored');
  assert.strictEqual(normalForm.button.textContent, '記録中…');
  assert.strictEqual(normalForm.button.disabled, true);
  assert.strictEqual(normalForm.attributes['aria-busy'], 'true');
  releaseNormal({});
  await normalFirst;
  assert.strictEqual(normalForm.button.textContent, '記録する', 'M15: successful normal save must clear busy text');
  assert.strictEqual(normalForm.button.disabled, false, 'M15: successful normal save must enable the button');

  let releaseCorrection;
  let correctionCalls = 0;
  let auditWrites = 0;
  const correctionForm = makeForm({ correction: 'true', clientRequestId: 'correction-request' }, '修正を保存');
  const correctionFlow = makeBusyFlow(correctionForm, async () => {
    correctionCalls += 1;
    auditWrites += 1;
    return new Promise((resolve) => { releaseCorrection = resolve; });
  });
  const correctionFirst = correctionFlow.save('health.daily.recordSlot', { clientRequestId: correctionForm.dataset.clientRequestId, isCorrection: true });
  const correctionSecond = await correctionFlow.save('health.daily.recordSlot', { clientRequestId: correctionForm.dataset.clientRequestId, isCorrection: true });
  assert.strictEqual(correctionCalls, 1, 'M12: correction duplicate submit must not send twice');
  assert.strictEqual(auditWrites, 1, 'M12: correction duplicate submit must not create a second audit write');
  assert.strictEqual(correctionSecond.skipped, true);
  assert.strictEqual(correctionForm.button.textContent, '修正中…');
  assert.strictEqual(correctionForm.button.disabled, true);
  releaseCorrection({});
  await correctionFirst;
  assert.strictEqual(correctionForm.button.textContent, '修正を保存');
  assert.strictEqual(correctionForm.button.disabled, false);

  const normalRetryForm = makeForm({ clientRequestId: 'same-normal-request' }, '記録する');
  const normalDraft = { meal: 'rice_1' };
  const normalFailure = makeBusyFlow(normalRetryForm, async () => { throw new Error('network'); });
  const normalFailureResult = await normalFailure.save('health.daily.recordSlot', normalDraft);
  assert.strictEqual(normalFailureResult.saved, false, 'M13: normal failure must remain retryable');
  assert.deepStrictEqual(normalDraft, { meal: 'rice_1' }, 'M13: normal input must remain intact');
  assert.strictEqual(normalRetryForm.dataset.clientRequestId, 'same-normal-request', 'M13: normal retry must retain request ID');
  assert.strictEqual(normalRetryForm.button.textContent, '記録する');
  assert.strictEqual(normalRetryForm.button.disabled, false);

  const correctionRetryForm = makeForm({ correction: 'true', clientRequestId: 'same-correction-request' }, '修正を保存');
  const correctionDraft = { meal: 'rice_1', correctionReason: '入力間違い' };
  const correctionFailure = makeBusyFlow(correctionRetryForm, async () => { throw new Error('network'); });
  const correctionFailureResult = await correctionFailure.save('health.daily.recordSlot', correctionDraft);
  assert.strictEqual(correctionFailureResult.saved, false, 'M14: correction failure must remain retryable');
  assert.deepStrictEqual(correctionDraft, { meal: 'rice_1', correctionReason: '入力間違い' }, 'M14: correction values must remain intact');
  assert.strictEqual(correctionRetryForm.dataset.clientRequestId, 'same-correction-request', 'M14: correction retry must retain request ID');
  assert.strictEqual(correctionRetryForm.button.textContent, '修正を保存');
  assert.strictEqual(correctionRetryForm.button.disabled, false);
})().then(() => {
  console.log('PASS Nurse Okan correction request boundary and retry identity');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
const source = fs.readFileSync('features/nurse-okan/nurse-okan.js', 'utf8');
const css = fs.readFileSync('style.css', 'utf8');
const appSource = fs.readFileSync('app.js', 'utf8');
assert(source.includes('renderCorrectionSlotCard_') && source.includes('renderWeightCorrection_'), 'Daily and Weight correction forms are missing');
assert(source.includes("'health.weight.correct'") && source.includes('correctionReason'), 'Weight correction operation or reason is missing');
assert(source.includes('data-nurse-open-slot') && source.includes('data-nurse-correction-cancel'), 'Direct-open correction controls are missing');
assert(css.includes('.nurse-inline-edit') && css.includes('.nurse-weight-correction'), 'Correction styles are missing');
assert(!css.match(/\.nurse-weight-correction[^}]*overflow-x\s*:\s*(auto|scroll)/s), 'Weight correction introduces horizontal scrolling');
const correctionOpen = source.slice(source.indexOf('function openSlotFromProgress_'), source.indexOf('function openWeightCorrection_'));
assert(correctionOpen.includes("state.editingSlot=selection.isCorrection?selection.slot:''") && !correctionOpen.includes('paruru:view-request') && !correctionOpen.includes('switchView('), 'M7: correction must render in Nurse Okan without requesting Home navigation');
assert(/rememberViewForControllerChange_\(\);\s*location\.reload\(\);/.test(appSource) && /if \(restoredView\) activeView = restoredView;\s*void switchView\(activeView\);/.test(appSource), 'M8: a controller-change reload must restore the active Nurse Okan view');
assert(source.includes('reReadDailyAfterSlotSave_') && source.includes('clearDailySelection_();document.dispatchEvent') && source.includes('void loadRecentHistory_();') && source.includes('render_();focusRecordList_();'), 'M9: correction save must re-read, update the current state, and return to the record list');
assert(css.includes('.nurse-progress-summary') && css.includes('.nurse-history-summary') && css.includes('overflow-wrap: anywhere'), 'M10: summary layout must wrap rather than horizontally scroll');
assert(source.includes('const nurseFormSaveFlows_=new WeakMap()') && source.includes('if(isNurseFormSaving_(form)||(slotKey&&state.savingSlots[slotKey]))return') && source.includes('setNurseFormSaving_(form,true)') && source.includes('setNurseFormSaving_(form,false)'), 'M11-M15: Nurse form and slot scoped saving guard is missing');

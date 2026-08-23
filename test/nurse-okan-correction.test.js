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
const source = fs.readFileSync('features/nurse-okan/nurse-okan.js', 'utf8');
const css = fs.readFileSync('style.css', 'utf8');
assert(source.includes('renderCorrectionSlotCard_') && source.includes('renderWeightCorrection_'), 'Daily and Weight correction forms are missing');
assert(source.includes("'health.weight.correct'") && source.includes('correctionReason'), 'Weight correction operation or reason is missing');
assert(source.includes('data-nurse-correction-slot') && source.includes('data-nurse-correction-cancel'), 'Correction controls are missing');
assert(css.includes('.nurse-inline-edit') && css.includes('.nurse-weight-correction'), 'Correction styles are missing');
assert(!css.match(/\.nurse-weight-correction[^}]*overflow-x\s*:\s*(auto|scroll)/s), 'Weight correction introduces horizontal scrolling');
console.log('PASS Nurse Okan correction request boundary and retry identity');

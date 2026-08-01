'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const context = { Object, Array, String, Boolean, Math };
vm.createContext(context);
['MailConfig.js', 'MailRuleService.js'].forEach(function(file) {
  vm.runInContext(fs.readFileSync(path.join(root, 'gas-Mail', file), 'utf8'), context, { filename: file });
});

function classify(input) {
  return JSON.parse(JSON.stringify(context.classifyMailMetadata_(input)));
}

function assertClassification(input, expected) {
  assert.deepStrictEqual(classify(input), expected);
}

assertClassification({ subject: 'お支払い期限のお知らせ' }, {
  category: 'finance', importance: 'high', actionRequired: true, actionType: 'payment',
  archiveRecommended: false, reasonCodes: ['payment_deadline'], matchedRuleId: 'payment_deadline',
});

assertClassification({ subject: '提出期限のご案内' }, {
  category: 'unknown', importance: 'high', actionRequired: true, actionType: 'submission',
  archiveRecommended: false, reasonCodes: ['submission_deadline'], matchedRuleId: 'submission_deadline',
});

assertClassification({ subject: '内容をご確認ください' }, {
  category: 'unknown', importance: 'medium', actionRequired: true, actionType: 'confirmation',
  archiveRecommended: false, reasonCodes: ['confirmation_request'], matchedRuleId: 'confirmation_request',
});

assertClassification({ snippet: '配信停止はこちら unsubscribe' }, {
  category: 'newsletter', importance: 'low', actionRequired: false, actionType: 'none',
  archiveRecommended: true, reasonCodes: ['newsletter_indicator'], matchedRuleId: 'newsletter',
});

assertClassification({ subject: '夏のキャンペーンとクーポン' }, {
  category: 'promotion', importance: 'low', actionRequired: false, actionType: 'none',
  archiveRecommended: true, reasonCodes: ['promotion_indicator'], matchedRuleId: 'promotion',
});

assertClassification({ subject: 'キャンペーン：支払期限をご確認ください' }, {
  category: 'finance', importance: 'high', actionRequired: true, actionType: 'payment',
  archiveRecommended: false, reasonCodes: ['payment_deadline'], matchedRuleId: 'payment_deadline',
});

const unknown = {
  category: 'unknown', importance: 'medium', actionRequired: false, actionType: 'none',
  archiveRecommended: false, reasonCodes: [], matchedRuleId: null,
};
assert.deepStrictEqual(classify({}), unknown);
assert.deepStrictEqual(classify(null), unknown);
assert.deepStrictEqual(classify({ from: 'person@example.test', subject: '近況のお知らせ' }), unknown);

const input = { subject: '支払期限', snippet: '配信停止', hasAttachment: true };
const original = JSON.parse(JSON.stringify(input));
classify(input);
assert.deepStrictEqual(input, original);

const allowed = JSON.parse(vm.runInContext('JSON.stringify(MAIL_ALLOWED_CLASSIFICATION_VALUES)', context));
const results = [
  classify({ subject: '支払期限' }), classify({ subject: '提出期限' }),
  classify({ subject: 'ご確認ください' }), classify({ snippet: 'unsubscribe' }),
  classify({ subject: 'クーポン' }), classify({ subject: '未知' }),
];
results.forEach(function(result) {
  assert(allowed.category.includes(result.category));
  assert(allowed.importance.includes(result.importance));
  assert(allowed.actionType.includes(result.actionType));
});

const deterministicInput = { subject: 'お支払い期限', snippet: 'キャンペーン' };
assert.deepStrictEqual(classify(deterministicInput), classify(deterministicInput));

const source = ['Code.js', 'MailConfig.js', 'MailRuleService.js'].map(function(file) {
  return fs.readFileSync(path.join(root, 'gas-Mail', file), 'utf8');
}).join('\n');
assert(!/Logger\s*\./.test(source));
assert(!/GmailApp|SpreadsheetApp|ScriptApp|PropertiesService/.test(source));

console.log('PASS mail fixed-rule classification, safety, and determinism');

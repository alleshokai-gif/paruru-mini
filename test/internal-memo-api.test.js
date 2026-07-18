'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const gasDir = path.resolve(__dirname, '..', 'gas');
const properties = {};
const headers = ['id', 'title', 'category', 'type', 'needsFollowup', 'followupQuestion', 'followupInputType', 'clientRequestId'];
const rows = [];
let aiCalls = 0;
let sheetCalls = 0;
let lockCalls = 0;
const sheet = {
  getLastRow: () => rows.length + 1,
  getRange: (row, column, rowCount, columnCount) => ({
    getValues: () => {
      if (row === 1) return [headers.slice(column - 1, column - 1 + columnCount)];
      return rows.slice(row - 2, row - 2 + rowCount).map((values) => values.slice(column - 1, column - 1 + columnCount));
    }
  })
};
const context = {
  Date, JSON, Math, Number, Object, Array, String, RegExp, Error,
  PropertiesService: { getScriptProperties: () => ({ getProperty: (name) => properties[name] || '' }) },
  LockService: { getScriptLock: () => ({ waitLock: () => { lockCalls += 1; }, releaseLock: () => {} }) },
  getInboxSheet_: () => { sheetCalls += 1; return sheet; },
  getActualHeaders_: () => headers,
  createItemWithAIResult_: (input, memo, options) => {
    aiCalls += 1;
    if (options.source !== 'paluru-agent' || options.clientRequestId !== input.clientRequestId) throw new Error('trusted options missing');
    const needsFollowup = input.memo === 'FOLLOWUP_MEMO';
    const item = { id: 'item-' + aiCalls, title: '牛乳を買う', category: '買い物', type: 'shopping', needsFollowup, followupQuestion: needsFollowup ? '締切はいつ？' : '', followupInputType: needsFollowup ? 'date' : '' };
    rows.push(headers.map((header) => header === 'clientRequestId' ? input.clientRequestId : item[header]));
    return item;
  },
  json_: (value) => value
};
vm.createContext(context);
new vm.Script(fs.readFileSync(path.join(gasDir, 'InternalMemoApi.js'), 'utf8')).runInContext(context);
const requestId = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';
const valid = (overrides) => Object.assign({ internalToken: 'inbox-secret', memo: '牛乳買う', clientRequestId: requestId, source: 'paluru-agent', userId: 'father', visibility: 'private', category: '', priority: '' }, overrides || {});
function assert(value, message) { if (!value) throw new Error(message); }
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('normal internal save and duplicate are idempotent', () => {
  properties.PALURU_INBOX_API_TOKEN = 'inbox-secret';
  const first = context.createItemWithAIInternal_(valid());
  const second = context.createItemWithAIInternal_(valid());
  assert(first.success && !first.duplicate && second.success && second.duplicate, 'duplicate contract wrong');
  assert(aiCalls === 1 && rows.length === 1 && lockCalls === 2, 'AI or save repeated');
});
test('missing or wrong token short-circuits sheet and AI', () => {
  const beforeSheet = sheetCalls; const beforeAi = aiCalls;
  delete properties.PALURU_INBOX_API_TOKEN;
  const missing = context.createItemWithAIInternal_(valid({ internalToken: '' }));
  properties.PALURU_INBOX_API_TOKEN = 'inbox-secret';
  const wrong = context.createItemWithAIInternal_(valid({ internalToken: 'wrong' }));
  assert(missing.error.code === 'UNAUTHORIZED' && wrong.error.code === 'UNAUTHORIZED', 'auth error wrong');
  assert(sheetCalls === beforeSheet && aiCalls === beforeAi, 'auth did not short-circuit');
});
test('followup fields and duplicate item identity are preserved', () => {
  const id = '77777777-7777-4777-8777-777777777777';
  const first = context.createItemWithAIInternal_(valid({ memo: 'FOLLOWUP_MEMO', clientRequestId: id }));
  const beforeAi = aiCalls;
  const second = context.createItemWithAIInternal_(valid({ memo: 'FOLLOWUP_MEMO', clientRequestId: id }));
  assert(first.item.needsFollowup === true && first.item.followupQuestion === '締切はいつ？' && first.item.followupInputType === 'date', 'followup sanitize failed');
  assert(second.duplicate === true && second.item.id === first.item.id && aiCalls === beforeAi, 'duplicate changed item or reran AI');
});
test('invalid memo and UUID are rejected before AI', () => {
  const beforeAi = aiCalls;
  const blank = context.createItemWithAIInternal_(valid({ memo: '   ' }));
  const long = context.createItemWithAIInternal_(valid({ memo: 'x'.repeat(1001) }));
  const uuid = context.createItemWithAIInternal_(valid({ clientRequestId: 'bad' }));
  assert([blank, long, uuid].every((result) => result.error.code === 'INVALID_INPUT'), 'invalid input accepted');
  assert(aiCalls === beforeAi, 'AI called for invalid input');
});
test('secret and memo are absent from public errors', () => {
  const result = context.createItemWithAIInternal_(valid({ internalToken: 'wrong', memo: 'SENSITIVE_MEMO' }));
  const text = JSON.stringify(result);
  assert(!text.includes('wrong') && !text.includes('SENSITIVE_MEMO') && !text.includes('inbox-secret'), 'secret data leaked');
});
test('missing clientRequestId header fails without AI or migration', () => {
  const beforeAi = aiCalls;
  const removed = headers.pop();
  const result = context.createItemWithAIInternal_(valid({ clientRequestId: '9f8c7a16-f1e2-4c51-9b38-4a4eb35f6fa3' }));
  headers.push(removed);
  assert(result.error.code === 'CONFIGURATION_ERROR' && aiCalls === beforeAi, 'missing header did not fail safely');
});
test('public createWithAI route remains explicit and shared', () => {
  const code = fs.readFileSync(path.join(gasDir, 'Code.js'), 'utf8');
  assert(code.includes("if (action === 'createWithAI')") && code.includes('item: createItemWithAIResult_(body, memo)'), 'public createWithAI contract path changed');
  const headerBlock = code.slice(code.indexOf('const HEADERS = ['), code.indexOf('];', code.indexOf('const HEADERS = [')) + 2);
  assert(!headerBlock.includes("'clientRequestId'"), 'automatic header migration introduced');
});

let failures = 0;
for (const item of tests) { try { item.fn(); console.log('PASS ' + item.name); } catch (error) { failures += 1; console.error('FAIL ' + item.name + ': ' + error.message); } }
if (failures) process.exit(1); else console.log('PASS all ' + tests.length + ' tests');

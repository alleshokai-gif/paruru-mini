'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');

function createContext(options) {
  const input = options || {};
  const properties = input.properties || {};
  const records = input.records || [];
  const readFailures = new Set(input.readFailures || []);
  const logs = [];
  const recordById = {};
  records.forEach(function(record) { recordById[record.id] = record; });
  const context = {
    Array, Boolean, Date, Error, JSON, Math, Number, Object, RegExp, String,
    Logger: { log: function(value) { logs.push(String(value)); } },
    PropertiesService: { getScriptProperties: function() { return { getProperty: function(key) { return properties[key]; } }; } },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: function(_, value) { return crypto.createHash('sha256').update(String(value)).digest(); },
      base64Encode: function(value) { return Buffer.from(value).toString('base64'); },
      formatDate: function(date) { return new Date(date).toISOString().replace('Z', '+00:00'); },
    },
    Gmail: { Users: { Messages: {
      list: function(_, request) {
        context.__listRequest = request;
        if (input.listFailure) throw new Error('mailbox unavailable');
        return { messages: records.slice(0, request.maxResults).map(function(record) { return { id: record.id, threadId: record.threadId }; }) };
      },
      get: function(_, id, request) {
        context.__getRequests.push(request);
        if (readFailures.has(id)) throw new Error('read failure');
        const record = recordById[id];
        if (!record) throw new Error('not found');
        return {
          id: record.id, threadId: record.threadId, internalDate: String(record.receivedAtMillis), snippet: record.snippet,
          payload: { headers: [{ name: 'From', value: record.from }, { name: 'Subject', value: record.subject }], parts: record.parts || [] },
        };
      },
    } } },
    __getRequests: [], __logs: logs,
  };
  vm.createContext(context);
  ['MailConfig.js', 'MailRuleService.js', 'MailSecurity.js', 'GmailReaderService.js', 'Code.js'].forEach(function(file) {
    vm.runInContext(fs.readFileSync(path.join(root, 'gas-Mail', file), 'utf8'), context, { filename: file });
  });
  return context;
}

function record(index, overrides) {
  return Object.assign({
    id: 'message-' + index, threadId: 'thread-' + index, receivedAtMillis: Date.now() - index * 1000,
    from: 'Sender <sender' + index + '@example.test>', subject: 'お知らせ ' + index, snippet: '内容 ' + index,
  }, overrides || {});
}

function resultOf(context) { return JSON.parse(JSON.stringify(context.runMailTriageDryRun())); }

let context = createContext();
assert.deepStrictEqual(JSON.parse(JSON.stringify(context.getMailDryRunSettings_())), { lookbackHours: 24, searchLimit: 100, batchSize: 50, diagnostic: false });

context = createContext({ properties: { MAIL_LOOKBACK_HOURS: '48', MAIL_SEARCH_LIMIT: '200', MAIL_BATCH_SIZE: '25', MAIL_DRY_RUN_DIAGNOSTIC: 'true' } });
assert.deepStrictEqual(JSON.parse(JSON.stringify(context.getMailDryRunSettings_())), { lookbackHours: 48, searchLimit: 200, batchSize: 25, diagnostic: true });

context = createContext({ properties: { MAIL_LOOKBACK_HOURS: '0', MAIL_SEARCH_LIMIT: '501', MAIL_BATCH_SIZE: 'bad', MAIL_DRY_RUN_DIAGNOSTIC: 'FALSE' } });
assert.deepStrictEqual(JSON.parse(JSON.stringify(context.getMailDryRunSettings_())), { lookbackHours: 24, searchLimit: 100, batchSize: 50, diagnostic: false });
assert.strictEqual(context.mailReadBoolean_('true', false), true);
assert.strictEqual(context.mailReadBoolean_('false', true), false);

context = createContext({ records: [] });
let result = resultOf(context);
assert.strictEqual(result.counts.fetched, 0);
assert.strictEqual(result.hasMoreLikely, false);
assert.deepStrictEqual(result.diagnostics, []);

const hundred = Array.from({ length: 100 }, function(_, index) { return record(index); });
context = createContext({ records: hundred });
result = resultOf(context);
assert.strictEqual(result.counts.fetched, 100);
assert.strictEqual(result.counts.classified, 100);
assert.strictEqual(result.counts.unknown, 100);
assert.strictEqual(result.hasMoreLikely, true);
assert.deepStrictEqual(JSON.parse(JSON.stringify(context.mailBatches_(hundred, 50))).map(function(batch) { return batch.length; }), [50, 50]);
assert(context.__listRequest.q.includes('-in:trash') && context.__listRequest.q.includes('-in:spam'));

context = createContext({ records: [record(1), record(2)], readFailures: ['message-1'] });
result = resultOf(context);
assert.strictEqual(result.counts.classified, 1);
assert.deepStrictEqual(result.errors, { count: 1, reasonCounts: { READ_FAILED: 1, CLASSIFICATION_FAILED: 0 } });

context = createContext({ records: [record(1), record(2)] });
const originalClassifier = context.classifyMailMetadata_;
context.classifyMailMetadata_ = function(item) { if (item.subject === 'お知らせ 1') throw new Error('classification failure'); return originalClassifier(item); };
result = resultOf(context);
assert.strictEqual(result.counts.classified, 1);
assert.deepStrictEqual(result.errors, { count: 1, reasonCounts: { READ_FAILED: 0, CLASSIFICATION_FAILED: 1 } });

context = createContext({ records: [record(1, { subject: 'A'.repeat(60), from: 'Private <private@example.test>' })], properties: { MAIL_DRY_RUN_DIAGNOSTIC: 'false' } });
result = resultOf(context);
assert.deepStrictEqual(result.diagnostics, []);
assert(!context.__logs.join('\n').includes('private@example.test'));
assert(!context.__logs.join('\n').includes('message-1'));

context = createContext({ records: Array.from({ length: 25 }, function(_, index) { return record(index, { subject: '長い件名'.repeat(20) }); }), properties: { MAIL_DRY_RUN_DIAGNOSTIC: 'true' } });
result = resultOf(context);
assert.strictEqual(result.diagnostics.length, 20);
assert(result.diagnostics.every(function(item) { return item.subjectPreview.length <= 30; }));
assert(result.diagnostics.every(function(item) { return item.messageIdHash !== 'message-1' && !item.messageIdHash.includes('message-'); }));
assert(!context.__logs.join('\n').includes('message-'));

const source = ['Code.js', 'MailSecurity.js', 'GmailReaderService.js'].map(function(file) { return fs.readFileSync(path.join(root, 'gas-Mail', file), 'utf8'); }).join('\n');
assert(!/GmailApp|SpreadsheetApp|ScriptApp|UrlFetchApp/.test(source));
assert(!/markRead|markUnread|moveToArchive|moveToTrash|addLabel|removeLabel|\.star\(|\.unstar\(|sendEmail|createDraft/.test(source));
assert(!/getPlainBody|getBody|attachments\.get/.test(source));
assert(context.__getRequests.every(function(request) { return request.fields.indexOf('body/data') < 0; }));

console.log('PASS mail reader dry-run configuration, batching, privacy, and read-only safeguards');

'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const headers = [
  'schemaVersion', 'inboxId', 'homeId', 'clientRequestId', 'receivedAt', 'updatedAt',
  'source', 'submittedByMemberId', 'subjectMemberHint', 'userNote', 'originalName',
  'mediaType', 'sizeBytes', 'originalRef', 'sha256', 'status', 'attemptCount',
  'processingStartedAt', 'processingCompletedAt', 'claimedBy', 'claimVersion',
  'leaseExpiresAt', 'retryable', 'nextAttemptAt', 'errorCode', 'duplicateOfInboxId',
];

class Range {
  constructor(sheet, row, column, rows, columns) { this.sheet = sheet; this.row = row; this.column = column; this.rows = rows; this.columns = columns; }
  getValues() { return Array.from({ length: this.rows }, (_, r) => Array.from({ length: this.columns }, (_, c) => this.sheet.values[this.row - 1 + r]?.[this.column - 1 + c] ?? '')); }
}

class Sheet {
  constructor(state) { this.state = state; this.values = [headers.slice()]; }
  getLastRow() { return this.values.length; }
  getLastColumn() { return this.values[0].length; }
  getRange(row, column, rows, columns) { return new Range(this, row, column, rows, columns); }
  appendRow(row) { if (this.state.ledgerError) throw new Error('raw ledger failure'); this.values.push(row.slice()); }
}

function uuid(number) { return `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`; }
function bytesFor(mediaType, suffix = 1) {
  const signatures = {
    'image/jpeg': [0xff, 0xd8, 0xff, 0xe0],
    'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    'application/pdf': [0x25, 0x50, 0x44, 0x46, 0x2d],
  };
  return signatures[mediaType].concat([suffix, 2, 3]);
}

function fixture(options = {}) {
  const state = { files: [], logs: [], ledgerError: Boolean(options.ledgerError), driveError: Boolean(options.driveError), uuidCounter: 1, lockCount: 0 };
  const sheet = new Sheet(state);
  const properties = Object.assign({
    FAMILY_INBOX_SERVICE_TOKEN: 'service-secret-value',
    FAMILY_INBOX_RAW_FOLDER_ID: 'raw-folder-secret-id',
    FAMILY_INBOX_LEDGER_SPREADSHEET_ID: 'ledger-secret-id',
  }, options.properties || {});
  const context = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => properties[key] || '' }) },
    LockService: { getScriptLock: () => ({ waitLock: () => { state.lockCount += 1; }, releaseLock: () => {} }) },
    SpreadsheetApp: { openById: (id) => { assert.strictEqual(id, 'ledger-secret-id'); return { getSheetByName: (name) => name === 'Family_Inbox' ? sheet : null }; } },
    DriveApp: { getFolderById: (id) => {
      assert.strictEqual(id, 'raw-folder-secret-id');
      if (state.driveError) throw new Error('raw drive failure');
      return { createFile: (blob) => {
        const file = { id: `drive-raw-secret-${state.files.length + 1}`, blob, trashed: false, getId() { return this.id; }, setTrashed(value) { this.trashed = value; } };
        state.files.push(file);
        return file;
      } };
    } },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      base64Decode: (value) => Array.from(Buffer.from(value, 'base64')),
      computeDigest: (_, values) => Array.from(crypto.createHash('sha256').update(Buffer.from(values)).digest()),
      newBlob: (values, mediaType, name) => ({ values: values.slice(), mediaType, name }),
      getUuid: () => uuid(state.uuidCounter++),
      formatDate: () => '2026-08-28T12:34:56+09:00',
    },
    Logger: { log: (line) => state.logs.push(String(line)) },
    Date, Error, Object, Array, String, Number, RegExp, JSON, Math,
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'gas-family-inbox', 'FamilyInboxService.js'), 'utf8'), context);
  return { api: context, state, sheet, properties };
}

function submitBody(mediaType, clientRequestId, suffix = 1) {
  const names = { 'image/jpeg': 'notice.jpg', 'image/png': 'notice.png', 'application/pdf': 'notice.pdf' };
  return {
    operation: 'familyInbox.submit', internalToken: 'service-secret-value', clientRequestId,
    subjectMemberId: 'youngest_daughter', userNote: 'private family note',
    file: { name: `../${names[mediaType]}`, mediaType, base64: Buffer.from(bytesFor(mediaType, suffix)).toString('base64') },
    homeId: 'home-a', submittedByMemberId: 'father', source: 'paluru', traceId: 'fi_testtrace01',
  };
}

function expectCode(action, code) {
  assert.throws(action, (error) => error && error.code === code, `expected ${code}`);
}

for (const [index, mediaType] of ['image/jpeg', 'image/png', 'application/pdf'].entries()) {
  const f = fixture();
  const result = f.api.familyInboxSubmit_(submitBody(mediaType, uuid(index + 10)));
  assert.strictEqual(result.status, 'pending');
  assert.strictEqual(result.idempotency.replayed, false);
  assert.match(result.inboxId, /^inb_[0-9a-f]{32}$/);
  assert.strictEqual(f.state.files.length, 1);
  assert.strictEqual(f.sheet.values.length, 2);
  const row = Object.fromEntries(headers.map((header, column) => [header, f.sheet.values[1][column]]));
  assert.strictEqual(row.schemaVersion, 'family-inbox-1.0');
  assert.strictEqual(row.subjectMemberHint, 'youngest_daughter');
  assert.strictEqual(row.submittedByMemberId, 'father');
  assert.strictEqual(row.originalName, namesFor(mediaType));
  assert.strictEqual(row.status, 'pending');
  assert.strictEqual(f.state.files[0].blob.name, `${result.inboxId}.${mediaType === 'image/jpeg' ? 'jpg' : mediaType === 'image/png' ? 'png' : 'pdf'}`);
}

function namesFor(mediaType) { return { 'image/jpeg': 'notice.jpg', 'image/png': 'notice.png', 'application/pdf': 'notice.pdf' }[mediaType]; }

{
  const f = fixture();
  const first = f.api.familyInboxSubmit_(submitBody('application/pdf', uuid(20)));
  const replay = f.api.familyInboxSubmit_(submitBody('application/pdf', uuid(20)));
  assert.strictEqual(replay.inboxId, first.inboxId);
  assert.strictEqual(replay.idempotency.replayed, true);
  assert.strictEqual(f.state.files.length, 1);
  assert.strictEqual(f.sheet.values.length, 2);
}

{
  const f = fixture();
  f.api.familyInboxSubmit_(submitBody('application/pdf', uuid(23), 1));
  expectCode(() => f.api.familyInboxSubmit_(submitBody('application/pdf', uuid(23), 9)), 'DUPLICATE_REQUEST');
  assert.strictEqual(f.state.files.length, 1);
  assert.strictEqual(f.sheet.values.length, 2);
}

{
  const f = fixture();
  const first = f.api.familyInboxSubmit_(submitBody('image/png', uuid(21)));
  const duplicate = f.api.familyInboxSubmit_(submitBody('image/png', uuid(22)));
  assert.strictEqual(duplicate.status, 'duplicate');
  assert.strictEqual(duplicate.duplicateOfInboxId, first.inboxId);
  assert.strictEqual(f.state.files.length, 2, 'same bytes with a new request must keep its raw original');
  assert.strictEqual(f.sheet.values.length, 3);
}

{
  const f = fixture();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(f.api.familyInboxErrorEnvelope_(f.api.familyInboxError_('INVALID_FILE_SIGNATURE')).data)), { status: 'rejected' });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(f.api.familyInboxErrorEnvelope_(f.api.familyInboxError_('CONFIGURATION_ERROR')).data)), {});
  const body = submitBody('image/jpeg', uuid(30));
  body.file.mediaType = 'text/csv';
  expectCode(() => f.api.familyInboxSubmit_(body), 'UNSUPPORTED_MEDIA_TYPE');
  body.file.mediaType = 'image/jpeg';
  body.file.base64 = Buffer.from([0, 1, 2, 3]).toString('base64');
  expectCode(() => f.api.familyInboxSubmit_(body), 'INVALID_FILE_SIGNATURE');
  body.file.base64 = 'A'.repeat(Math.ceil((5 * 1024 * 1024 + 1) / 3) * 4);
  expectCode(() => f.api.familyInboxSubmit_(body), 'FILE_TOO_LARGE');
  assert.strictEqual(f.state.files.length, 0);
}

{
  const f = fixture({ driveError: true });
  expectCode(() => f.api.familyInboxSubmit_(submitBody('application/pdf', uuid(40))), 'STORAGE_ERROR');
  assert.strictEqual(f.sheet.values.length, 1);
}

{
  const f = fixture({ ledgerError: true });
  expectCode(() => f.api.familyInboxSubmit_(submitBody('application/pdf', uuid(41))), 'LEDGER_ERROR');
  assert.strictEqual(f.state.files.length, 1);
  assert.strictEqual(f.state.files[0].trashed, true, 'orphan raw file must be moved to trash');
  assert.strictEqual(f.sheet.values.length, 1);
}

{
  const f = fixture();
  const body = submitBody('application/pdf', uuid(50));
  body.internalToken = 'wrong-secret';
  expectCode(() => f.api.familyInboxSubmit_(body), 'FORBIDDEN');
  assert.strictEqual(f.state.files.length, 0);
  assert.strictEqual(f.state.lockCount, 0);
}

{
  const f = fixture({ properties: { FAMILY_INBOX_SERVICE_TOKEN: '' } });
  expectCode(() => f.api.familyInboxSubmit_(submitBody('application/pdf', uuid(51))), 'CONFIGURATION_ERROR');
  assert.strictEqual(f.state.files.length, 0);
}

{
  const f = fixture();
  const created = f.api.familyInboxSubmit_(submitBody('image/jpeg', uuid(60)));
  const status = f.api.familyInboxGetStatus_({ operation: 'familyInbox.getStatus', internalToken: 'service-secret-value', homeId: 'home-a', inboxId: created.inboxId, traceId: 'fi_status001' });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(status)), { inboxId: created.inboxId, status: 'pending', receivedAt: '2026-08-28T12:34:56+09:00', updatedAt: '2026-08-28T12:34:56+09:00', errorCode: '', duplicateOfInboxId: '' });
  assert(!Object.hasOwn(status, 'originalRef'));
  expectCode(() => f.api.familyInboxGetStatus_({ operation: 'familyInbox.getStatus', internalToken: 'service-secret-value', homeId: 'home-b', inboxId: created.inboxId, traceId: 'fi_status002' }), 'FORBIDDEN');
  const logs = f.state.logs.join('\n');
  ['service-secret-value', 'private family note', submitBody('image/jpeg', uuid(60)).file.base64, 'drive-raw-secret', 'raw-folder-secret-id', 'ledger-secret-id'].forEach((secret) => assert(!logs.includes(secret), `unsafe log content: ${secret}`));
}

console.log('PASS Family Inbox service media validation, idempotency, duplicate retention, storage, atomicity, status, and safe logs');

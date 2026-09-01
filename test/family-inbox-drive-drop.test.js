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
  constructor(sheet, row, column, rows, columns) { Object.assign(this, { sheet, row, column, rows, columns }); }
  getValues() { return Array.from({ length: this.rows }, (_, r) => Array.from({ length: this.columns }, (_, c) => this.sheet.values[this.row - 1 + r]?.[this.column - 1 + c] ?? '')); }
}

class Sheet {
  constructor() { this.values = [headers.slice()]; }
  getLastRow() { return this.values.length; }
  getLastColumn() { return this.values[0].length; }
  getRange(row, column, rows, columns) { return new Range(this, row, column, rows, columns); }
  appendRow(row) { this.values.push(row.slice()); }
}

function pdfBytes(suffix) { return [0x25, 0x50, 0x44, 0x46, 0x2d, suffix, 1, 2]; }
function sourceFile(id, bytes, options = {}) {
  return {
    trashed: false,
    getId: () => id,
    getName: () => options.name || 'private-grade-newsletter.pdf',
    getMimeType: () => options.mediaType || 'application/pdf',
    getSize: () => options.size === undefined ? bytes.length : options.size,
    getBlob: () => ({ getBytes: () => bytes.slice() }),
  };
}

function fixture(options = {}) {
  const sheet = new Sheet();
  const sourceFiles = (options.sourceFiles || [sourceFile('drop-file-A', pdfBytes(1))]).slice();
  const state = { rawFiles: [], logs: [], sourceFiles, uuidCounter: 1 };
  const properties = Object.assign({
    FAMILY_INBOX_SERVICE_TOKEN: 'mini-secret',
    FAMILY_INBOX_RAW_FOLDER_ID: 'raw-folder-id',
    FAMILY_INBOX_LEDGER_SPREADSHEET_ID: 'ledger-id',
    FAMILY_INBOX_DRIVE_DROP_FOLDER_ID: 'drop-folder-id',
    FAMILY_INBOX_DRIVE_DROP_HOME_ID: 'home-a',
    FAMILY_INBOX_DRIVE_DROP_DEFAULT_SUBJECT_MEMBER_ID: 'child-a',
    FAMILY_INBOX_DRIVE_DROP_SUBMITTED_BY_MEMBER_ID: 'guardian-a',
  }, options.properties || {});
  const context = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => properties[key] || '' }) },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    SpreadsheetApp: { openById: (id) => { assert.strictEqual(id, 'ledger-id'); return { getSheetByName: (name) => name === 'Family_Inbox' ? sheet : null }; } },
    DriveApp: { getFolderById: (id) => {
      if (id === 'drop-folder-id') {
        let index = 0;
        return { getFiles: () => ({ hasNext: () => index < sourceFiles.length, next: () => sourceFiles[index++] }) };
      }
      if (id === 'raw-folder-id') {
        return { createFile: (blob) => {
          const raw = { id: `raw-${state.rawFiles.length + 1}`, blob, trashed: false, getId() { return this.id; }, setTrashed(value) { this.trashed = value; } };
          state.rawFiles.push(raw);
          return raw;
        } };
      }
      throw new Error('unknown folder');
    } },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      computeDigest: (_, values) => Array.from(crypto.createHash('sha256').update(Buffer.from(values)).digest()),
      newBlob: (values, mediaType, name) => ({ values: values.slice(), mediaType, name }),
      getUuid: () => `00000000-0000-4000-8000-${String(state.uuidCounter++).padStart(12, '0')}`,
      formatDate: () => '2026-08-31T10:00:00+09:00',
    },
    Logger: { log: (line) => state.logs.push(String(line)) },
    Date, Error, Object, Array, String, Number, RegExp, JSON, Math,
  };
  vm.createContext(context);
  for (const name of ['FamilyInboxService.js', 'DriveDropImporter.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'gas-family-inbox', name), 'utf8'), context);
  }
  return { api: context, state, sheet, properties };
}

function rowAt(f, index) { return Object.fromEntries(headers.map((header, column) => [header, f.sheet.values[index][column]])); }
function expectCode(action, code) { assert.throws(action, (error) => error && error.code === code, `expected ${code}`); }

{
  const f = fixture();
  const result = f.api.runFamilyInboxDriveDropImportOnce();
  assert.strictEqual(result.imported, true);
  assert.strictEqual(result.status, 'pending');
  assert.strictEqual(f.state.rawFiles.length, 1);
  assert.strictEqual(f.sheet.values.length, 2);
  const row = rowAt(f, 1);
  assert.strictEqual(row.source, 'drive_drop');
  assert.strictEqual(row.homeId, 'home-a');
  assert.strictEqual(row.subjectMemberHint, 'child-a');
  assert.strictEqual(row.submittedByMemberId, 'guardian-a');
  assert.strictEqual(row.originalName, 'private-grade-newsletter.pdf');
  assert.strictEqual(row.status, 'pending');
  assert.match(row.clientRequestId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.strictEqual(f.state.sourceFiles[0].trashed, false);
  assert.strictEqual(f.state.rawFiles[0].blob.name, `${result.inboxId}.pdf`);

  const replay = f.api.runFamilyInboxDriveDropImportOnce();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(replay)), { imported: false, status: 'no_new_pdf', scannedCount: 1 });
  assert.strictEqual(f.state.rawFiles.length, 1);
  assert.strictEqual(f.sheet.values.length, 2);
}

{
  let currentName = 'initial.pdf';
  const file = sourceFile('stable-drive-file', pdfBytes(4));
  file.getName = () => currentName;
  const f = fixture({ sourceFiles: [file] });
  f.api.runFamilyInboxDriveDropImportOnce();
  currentName = 'renamed-after-import.pdf';
  const replay = f.api.runFamilyInboxDriveDropImportOnce();
  assert.strictEqual(replay.imported, false, 'Drive file ID remains the idempotency key after a source rename');
  assert.strictEqual(f.state.rawFiles.length, 1);
  assert.strictEqual(f.sheet.values.length, 2);
  assert.strictEqual(rowAt(f, 1).originalName, 'initial.pdf', 'first imported metadata remains the ledger record');
}

{
  const bytes = pdfBytes(7);
  const f = fixture({ sourceFiles: [sourceFile('drop-file-A', bytes), sourceFile('drop-file-B', bytes)] });
  f.api.runFamilyInboxDriveDropImportOnce();
  const second = f.api.runFamilyInboxDriveDropImportOnce();
  assert.strictEqual(second.status, 'duplicate');
  assert.strictEqual(f.state.rawFiles.length, 2, 'a different Drive file ID preserves its own raw copy');
  assert.strictEqual(rowAt(f, 2).duplicateOfInboxId, rowAt(f, 1).inboxId);
}

{
  const f = fixture({ sourceFiles: [sourceFile('text-file', [1, 2, 3], { mediaType: 'text/plain', name: 'ignore.txt' })] });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(f.api.runFamilyInboxDriveDropImportOnce())), { imported: false, status: 'no_new_pdf', scannedCount: 1 });
  assert.strictEqual(f.state.rawFiles.length, 0);
}

{
  const f = fixture({ sourceFiles: [sourceFile('bad-pdf', [1, 2, 3])] });
  expectCode(() => f.api.runFamilyInboxDriveDropImportOnce(), 'INVALID_FILE_SIGNATURE');
  assert.strictEqual(f.state.rawFiles.length, 0);
}

{
  const f = fixture({ sourceFiles: [sourceFile('large-pdf', pdfBytes(2), { size: 5 * 1024 * 1024 + 1 })] });
  expectCode(() => f.api.runFamilyInboxDriveDropImportOnce(), 'FILE_TOO_LARGE');
  assert.strictEqual(f.state.rawFiles.length, 0);
}

{
  const f = fixture({ properties: { FAMILY_INBOX_DRIVE_DROP_DEFAULT_SUBJECT_MEMBER_ID: '' } });
  expectCode(() => f.api.runFamilyInboxDriveDropImportOnce(), 'CONFIGURATION_ERROR');
  assert.strictEqual(f.state.rawFiles.length, 0);
}

{
  const f = fixture();
  f.api.runFamilyInboxDriveDropImportOnce();
  const logs = f.state.logs.join('\n');
  ['mini-secret', 'drop-folder-id', 'raw-folder-id', 'ledger-id', 'drop-file-A', 'private-grade-newsletter.pdf'].forEach((secret) => {
    assert(!logs.includes(secret), `unsafe log content: ${secret}`);
  });
}

console.log('PASS Family Inbox Drive Drop PDF import, idempotency, duplicate policy, validation, source preservation, and safe logs');

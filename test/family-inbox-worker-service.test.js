'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const inboxHeaders = [
  'schemaVersion', 'inboxId', 'homeId', 'clientRequestId', 'receivedAt', 'updatedAt',
  'source', 'submittedByMemberId', 'subjectMemberHint', 'userNote', 'originalName',
  'mediaType', 'sizeBytes', 'originalRef', 'sha256', 'status', 'attemptCount',
  'processingStartedAt', 'processingCompletedAt', 'claimedBy', 'claimVersion',
  'leaseExpiresAt', 'retryable', 'nextAttemptAt', 'errorCode', 'duplicateOfInboxId',
];
const candidateHeaders = [
  'schemaVersion', 'candidateId', 'inboxId', 'homeId', 'candidateType', 'revision',
  'status', 'createdAt', 'updatedAt', 'subjectMemberId', 'confidence', 'sourceSha256',
  'profile', 'model', 'extractorVersion', 'promptVersion', 'payloadDigest', 'payloadJson',
  'evidenceJson', 'warningsJson', 'questionsJson', 'publishRequestId', 'claimVersion',
  'inputTokens', 'outputTokens', 'durationMs', 'reviewStatus', 'domainWriteResult',
];

class Range {
  constructor(sheet, row, column, rows, columns) { Object.assign(this, { sheet, row, column, rows, columns }); }
  getValues() { return Array.from({ length: this.rows }, (_, r) => Array.from({ length: this.columns }, (_, c) => this.sheet.values[this.row - 1 + r]?.[this.column - 1 + c] ?? '')); }
  setValues(values) {
    if (this.sheet.state.candidateWriteError && this.sheet.name === 'Family_Candidates') throw new Error('candidate ledger failed');
    if (this.sheet.state.inboxWriteError && this.sheet.name === 'Family_Inbox') throw new Error('inbox ledger failed');
    for (let r = 0; r < this.rows; r += 1) {
      if (!this.sheet.values[this.row - 1 + r]) this.sheet.values[this.row - 1 + r] = Array(this.sheet.getLastColumn()).fill('');
      for (let c = 0; c < this.columns; c += 1) this.sheet.values[this.row - 1 + r][this.column - 1 + c] = values[r][c];
    }
  }
}

class Sheet {
  constructor(name, headers, state) { this.name = name; this.values = [headers.slice()]; this.state = state; }
  getLastRow() { return this.values.length; }
  getLastColumn() { return this.values[0].length; }
  getRange(row, column, rows, columns) { return new Range(this, row, column, rows, columns); }
  appendRow(row) { this.values.push(row.slice()); }
}

function uuid(number) { return `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`; }
function bytesFor(mediaType = 'image/jpeg') {
  return mediaType === 'application/pdf'
    ? [0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3]
    : [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3];
}
function rowObject(headers, row) { return Object.fromEntries(headers.map((header, index) => [header, row[index]])); }
function inboxRow(sheet, inboxId) { return sheet.values.slice(1).map((row) => rowObject(inboxHeaders, row)).find((row) => row.inboxId === inboxId); }

function fixture(options = {}) {
  const state = { logs: [], files: new Map(), lockCount: 0, sheetOpenCount: 0, driveReadCount: 0, uuidCounter: 1, candidateWriteError: false, inboxWriteError: false };
  const inbox = new Sheet('Family_Inbox', inboxHeaders, state);
  const candidates = new Sheet('Family_Candidates', candidateHeaders, state);
  const properties = Object.assign({
    FAMILY_INBOX_SERVICE_TOKEN: 'mini-service-secret',
    FAMILY_INBOX_WORKER_TOKEN: 'worker-service-secret',
    FAMILY_INBOX_WORKER_ID: 'worker-home-01',
    FAMILY_INBOX_RAW_FOLDER_ID: 'raw-folder-id',
    FAMILY_INBOX_LEDGER_SPREADSHEET_ID: 'ledger-id',
  }, options.properties || {});
  const context = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => properties[key] || '' }) },
    LockService: { getScriptLock: () => ({ waitLock: () => { state.lockCount += 1; }, releaseLock: () => {} }) },
    SpreadsheetApp: { openById: (id) => {
      assert.strictEqual(id, 'ledger-id');
      state.sheetOpenCount += 1;
      return { getSheetByName: (name) => name === 'Family_Inbox' ? inbox : name === 'Family_Candidates' ? candidates : null };
    } },
    DriveApp: {
      getFolderById: () => ({ createFile: (blob) => {
        const id = `drive-secret-${state.files.size + 1}`;
        const file = { id, blob, getId() { return id; }, setTrashed() {}, getBlob() { return blob; } };
        state.files.set(id, file);
        return file;
      } }),
      getFileById: (id) => {
        state.driveReadCount += 1;
        const file = state.files.get(id);
        if (!file) throw new Error('missing');
        return file;
      },
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      base64Decode: (value) => Array.from(Buffer.from(value, 'base64')),
      base64Encode: (values) => Buffer.from(values).toString('base64'),
      computeDigest: (_, values) => Array.from(crypto.createHash('sha256').update(Buffer.from(values)).digest()),
      newBlob: (value, mediaType, name) => {
        const bytes = typeof value === 'string' ? Array.from(Buffer.from(value, 'utf8')) : Array.from(value);
        return { getBytes: () => bytes.slice(), mediaType, name };
      },
      getUuid: () => uuid(state.uuidCounter++),
      formatDate: (date) => {
        const shifted = new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString();
        return `${shifted.slice(0, 19)}+09:00`;
      },
    },
    Logger: { log: (line) => state.logs.push(String(line)) },
    Date, Error, Object, Array, String, Number, RegExp, JSON, Math, isFinite,
  };
  vm.createContext(context);
  for (const file of ['FamilyInboxService.js', 'FamilyInboxWorkerService.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'gas-family-inbox', file), 'utf8'), context);
  }
  return { api: context, state, inbox, candidates };
}

function submit(f, mediaType = 'image/jpeg', requestNumber = 10) {
  const bytes = bytesFor(mediaType);
  return f.api.familyInboxSubmit_({
    operation: 'familyInbox.submit', internalToken: 'mini-service-secret', clientRequestId: uuid(requestNumber),
    subjectMemberId: 'child-01', userNote: 'private note',
    file: { name: mediaType === 'application/pdf' ? 'school.pdf' : 'school.jpg', mediaType, base64: Buffer.from(bytes).toString('base64') },
    homeId: 'home-01', submittedByMemberId: 'parent-01', source: 'paluru', traceId: 'trace_submit01',
  });
}
function workerBody(operation, fields = {}) { return { operation, workerToken: 'worker-service-secret', traceId: 'trace_worker01', ...fields }; }
function expectCode(action, code) { assert.throws(action, (error) => error?.code === code, `expected ${code}`); }
function candidatesFixture() {
  return [
    {
      candidateType: 'school.document', schemaVersion: 'school.document/1.0', confidence: 0.98,
      evidence: [{ page: 1, quote: '8月28日 始業式', fieldPaths: ['documentDate', 'title'] }], warnings: [], questions: [],
      payload: { title: '始業式のお知らせ', documentType: 'schedule', documentDate: '2026-08-28', relevantNotes: [] },
    },
    {
      candidateType: 'schedule.event', schemaVersion: 'schedule.event/1.0', confidence: 0.96,
      evidence: [{ page: 1, quote: '8月28日 始業式', fieldPaths: ['date', 'title'] }], warnings: [], questions: [],
      payload: { title: '始業式', date: '2026-08-28', startTime: null, endTime: null, location: null, notes: null },
    },
  ];
}
function digest(f, candidateList) {
  return crypto.createHash('sha256').update(f.api.familyInboxWorkerStableStringify_(candidateList), 'utf8').digest('hex');
}
function claimOne(f) { return f.api.familyInboxClaimNext_(workerBody('familyInbox.claimNext')); }

{
  const f = fixture();
  assert.strictEqual(digest(f, candidatesFixture()), '22c5ccc8b93dec6bf251f76cf8a5ad9c69a2c435286c0205e1acbd7538c9fd82', 'GAS and worker canonical candidate digests must match');
}

{
  const f = fixture();
  const created = submit(f);
  const claim = claimOne(f);
  assert.strictEqual(claim.claimed, true);
  assert.strictEqual(claim.inboxId, created.inboxId);
  assert.strictEqual(claim.claimVersion, 1);
  assert.strictEqual(inboxRow(f.inbox, created.inboxId).status, 'processing');
  assert.strictEqual(inboxRow(f.inbox, created.inboxId).attemptCount, 1);
  assert.strictEqual(inboxRow(f.inbox, created.inboxId).claimedBy, 'worker-home-01');
  assert.strictEqual(claimOne(f).claimed, false, 'an active lease must not be claimed twice');

  const source = f.api.familyInboxGetClaimedSource_(workerBody('familyInbox.getClaimedSource', { inboxId: claim.inboxId, claimVersion: claim.claimVersion }));
  assert.strictEqual(source.base64, Buffer.from(bytesFor()).toString('base64'));
  assert(!Object.hasOwn(source, 'originalRef'));
  expectCode(() => f.api.familyInboxGetClaimedSource_(workerBody('familyInbox.getClaimedSource', { inboxId: claim.inboxId, claimVersion: 2 })), 'CLAIM_CONFLICT');
  expectCode(() => f.api.familyInboxGetClaimedSource_(workerBody('familyInbox.getClaimedSource', { inboxId: 'inb_ffffffffffffffffffffffffffffffff', claimVersion: 1 })), 'CLAIM_NOT_FOUND');

  const heartbeat = f.api.familyInboxHeartbeat_(workerBody('familyInbox.heartbeat', { inboxId: claim.inboxId, claimVersion: claim.claimVersion }));
  assert.strictEqual(heartbeat.status, 'processing');
}

{
  const f = fixture();
  const created = submit(f, 'application/pdf', 20);
  const first = claimOne(f);
  const rowIndex = f.inbox.values.findIndex((row) => row[inboxHeaders.indexOf('inboxId')] === created.inboxId);
  f.inbox.values[rowIndex][inboxHeaders.indexOf('leaseExpiresAt')] = '2000-01-01T00:00:00+09:00';
  expectCode(() => f.api.familyInboxGetClaimedSource_(workerBody('familyInbox.getClaimedSource', { inboxId: created.inboxId, claimVersion: first.claimVersion })), 'CLAIM_EXPIRED');
  const reclaimed = claimOne(f);
  assert.strictEqual(reclaimed.claimVersion, first.claimVersion + 1);
  assert.strictEqual(inboxRow(f.inbox, created.inboxId).attemptCount, 2);
  expectCode(() => f.api.familyInboxGetClaimedSource_(workerBody('familyInbox.getClaimedSource', { inboxId: created.inboxId, claimVersion: first.claimVersion })), 'CLAIM_CONFLICT');
}

{
  const f = fixture();
  const created = submit(f, 'image/jpeg', 30);
  const claim = claimOne(f);
  const list = candidatesFixture();
  const request = workerBody('familyInbox.publishCandidates', {
    inboxId: claim.inboxId, claimVersion: claim.claimVersion, publishRequestId: uuid(900),
    payloadDigest: digest(f, list), candidates: list, usage: { inputTokens: 120, outputTokens: 40 }, durationMs: 1500,
  });
  const published = f.api.familyInboxPublishCandidates_(request);
  assert.strictEqual(published.status, 'needs_review');
  assert.strictEqual(published.candidateIds.length, 2);
  assert.strictEqual(inboxRow(f.inbox, created.inboxId).status, 'needs_review');
  assert.strictEqual(f.candidates.values.length, 3);
  const eventRow = rowObject(candidateHeaders, f.candidates.values[2]);
  assert.strictEqual(eventRow.subjectMemberId, 'child-01');
  assert.strictEqual(eventRow.model, 'gpt-5.6-luna');
  assert.strictEqual(eventRow.profile, 'school-v1');
  assert.strictEqual(eventRow.reviewStatus, 'pending');
  assert.strictEqual(eventRow.domainWriteResult, '');
  const replay = f.api.familyInboxPublishCandidates_(request);
  assert.strictEqual(replay.idempotency.replayed, true);
  assert.strictEqual(f.candidates.values.length, 3);
  const changed = structuredClone(list);
  changed[1].payload.title = '別の予定';
  expectCode(() => f.api.familyInboxPublishCandidates_({ ...request, payloadDigest: digest(f, changed), candidates: changed }), 'IDEMPOTENCY_CONFLICT');
}

{
  const f = fixture();
  submit(f, 'image/jpeg', 40);
  const claim = claimOne(f);
  const valid = candidatesFixture();
  const badExtra = structuredClone(valid);
  badExtra[0].subjectMemberId = 'other-child';
  expectCode(() => f.api.familyInboxPublishCandidates_(workerBody('familyInbox.publishCandidates', { inboxId: claim.inboxId, claimVersion: claim.claimVersion, publishRequestId: uuid(910), payloadDigest: digest(f, badExtra), candidates: badExtra, usage: { inputTokens: 1, outputTokens: 1 }, durationMs: 1 })), 'INVALID_INPUT');
  const badDate = structuredClone(valid);
  badDate[1].payload.date = '2026-02-30';
  expectCode(() => f.api.familyInboxPublishCandidates_(workerBody('familyInbox.publishCandidates', { inboxId: claim.inboxId, claimVersion: claim.claimVersion, publishRequestId: uuid(911), payloadDigest: digest(f, badDate), candidates: badDate, usage: { inputTokens: 1, outputTokens: 1 }, durationMs: 1 })), 'INVALID_CANDIDATE');
  const unsupported = structuredClone(valid);
  unsupported[1].candidateType = 'finance.transaction';
  expectCode(() => f.api.familyInboxPublishCandidates_(workerBody('familyInbox.publishCandidates', { inboxId: claim.inboxId, claimVersion: claim.claimVersion, publishRequestId: uuid(912), payloadDigest: digest(f, unsupported), candidates: unsupported, usage: { inputTokens: 1, outputTokens: 1 }, durationMs: 1 })), 'INVALID_CANDIDATE');
  const tooMany = Array.from({ length: 9 }, () => structuredClone(valid[0]));
  expectCode(() => f.api.familyInboxPublishCandidates_(workerBody('familyInbox.publishCandidates', { inboxId: claim.inboxId, claimVersion: claim.claimVersion, publishRequestId: uuid(913), payloadDigest: digest(f, tooMany), candidates: tooMany, usage: { inputTokens: 1, outputTokens: 1 }, durationMs: 1 })), 'INVALID_CANDIDATE');
}

{
  const f = fixture();
  const created = submit(f, 'image/jpeg', 50);
  let claim = claimOne(f);
  let failed = f.api.familyInboxFailClaim_(workerBody('familyInbox.failClaim', { inboxId: claim.inboxId, claimVersion: claim.claimVersion, errorCode: 'AI_PROVIDER_ERROR', retryable: true }));
  assert.strictEqual(failed.status, 'failed');
  const rowIndex = f.inbox.values.findIndex((row) => row[inboxHeaders.indexOf('inboxId')] === created.inboxId);
  f.inbox.values[rowIndex][inboxHeaders.indexOf('nextAttemptAt')] = '2000-01-01T00:00:00+09:00';
  claim = claimOne(f);
  failed = f.api.familyInboxFailClaim_(workerBody('familyInbox.failClaim', { inboxId: claim.inboxId, claimVersion: claim.claimVersion, errorCode: 'INVALID_AI_OUTPUT', retryable: false }));
  assert.strictEqual(failed.status, 'needs_review');
  assert.strictEqual(failed.retryable, false);
}

{
  const f = fixture();
  submit(f, 'image/jpeg', 60);
  const lockCountBefore = f.state.lockCount;
  const sheetOpenCountBefore = f.state.sheetOpenCount;
  const driveReadCountBefore = f.state.driveReadCount;
  const bad = workerBody('familyInbox.claimNext');
  bad.workerToken = 'wrong-worker-secret';
  expectCode(() => f.api.familyInboxClaimNext_(bad), 'FORBIDDEN');
  assert.strictEqual(f.state.lockCount, lockCountBefore, 'invalid worker token must fail before Sheet/Drive work');
  assert.strictEqual(f.state.sheetOpenCount, sheetOpenCountBefore);
  assert.strictEqual(f.state.driveReadCount, driveReadCountBefore);
}

{
  const f = fixture({ properties: { FAMILY_INBOX_WORKER_TOKEN: '' } });
  submit(f, 'image/jpeg', 70);
  expectCode(() => f.api.familyInboxClaimNext_(workerBody('familyInbox.claimNext')), 'CONFIGURATION_ERROR');
}

{
  const f = fixture();
  const created = submit(f, 'image/jpeg', 80);
  const claim = claimOne(f);
  f.state.candidateWriteError = true;
  const list = candidatesFixture();
  expectCode(() => f.api.familyInboxPublishCandidates_(workerBody('familyInbox.publishCandidates', { inboxId: claim.inboxId, claimVersion: claim.claimVersion, publishRequestId: uuid(920), payloadDigest: digest(f, list), candidates: list, usage: { inputTokens: 1, outputTokens: 1 }, durationMs: 1 })), 'LEDGER_ERROR');
  assert.strictEqual(inboxRow(f.inbox, created.inboxId).status, 'processing');
  const logs = f.state.logs.join('\n');
  ['worker-service-secret', 'mini-service-secret', 'private note', Buffer.from(bytesFor()).toString('base64'), 'drive-secret-', 'raw-folder-id', 'ledger-id'].forEach((secret) => assert(!logs.includes(secret), `unsafe log content: ${secret}`));
}

{
  const f = fixture();
  const created = submit(f, 'image/jpeg', 81);
  const claim = claimOne(f);
  const list = candidatesFixture();
  const request = workerBody('familyInbox.publishCandidates', {
    inboxId: claim.inboxId, claimVersion: claim.claimVersion, publishRequestId: uuid(930),
    payloadDigest: digest(f, list), candidates: list, usage: { inputTokens: 10, outputTokens: 5 }, durationMs: 50,
  });
  f.state.inboxWriteError = true;
  expectCode(() => f.api.familyInboxPublishCandidates_(request), 'LEDGER_ERROR');
  assert.strictEqual(f.candidates.values.length, 3, 'candidate rows remain available for idempotent recovery');
  assert.strictEqual(inboxRow(f.inbox, created.inboxId).status, 'processing');
  f.state.inboxWriteError = false;
  const recovered = f.api.familyInboxPublishCandidates_(request);
  assert.strictEqual(recovered.idempotency.replayed, true);
  assert.strictEqual(inboxRow(f.inbox, created.inboxId).status, 'needs_review');
  assert.strictEqual(f.candidates.values.length, 3, 'recovery must not append duplicate candidates');
}

console.log('PASS Family Inbox worker GAS claim, lease, bounded source, strict candidates, publish idempotency, failure policy, and safe logs');

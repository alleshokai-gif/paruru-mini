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
  'reviewPayloadJson', 'reviewedAt', 'reviewedByMemberId', 'reviewAction',
  'reviewReason', 'reviewNote', 'reviewRequestId', 'reviewHistoryJson',
  'reviewedByServiceId', 'reviewChannel', 'sourceReviewItemId',
];
const reviewItemHeaders = [
  'schemaVersion', 'reviewItemId', 'inboxId', 'homeId', 'reviewType', 'candidateType',
  'revision', 'status', 'createdAt', 'updatedAt', 'subjectMemberId', 'confidence',
  'sourceSha256', 'profile', 'model', 'extractorVersion', 'promptVersion', 'payloadDigest',
  'payloadJson', 'reviewPayloadJson', 'evidenceJson', 'warningsJson', 'questionsJson',
  'publishRequestId', 'claimVersion', 'fragmentCount', 'inputTokens', 'outputTokens',
  'durationMs', 'reviewedAt', 'reviewedByServiceId', 'reviewChannel', 'reviewAction',
  'reviewReason', 'reviewNote', 'reviewRequestId', 'reviewHistoryJson', 'promotedCandidateId',
];

class Range {
  constructor(sheet, row, column, rows, columns) { Object.assign(this, { sheet, row, column, rows, columns }); }
  getValues() { return Array.from({ length: this.rows }, (_, r) => Array.from({ length: this.columns }, (_, c) => this.sheet.values[this.row - 1 + r]?.[this.column - 1 + c] ?? '')); }
  setValues(values) {
    if (this.sheet.state.candidateWriteError && this.sheet.name === 'Family_Candidates') throw new Error('candidate ledger failed');
    if (this.sheet.state.reviewItemWriteError && this.sheet.name === 'Family_Review_Items') throw new Error('review item ledger failed');
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
  const state = { logs: [], files: new Map(), lockCount: 0, sheetOpenCount: 0, driveReadCount: 0, uuidCounter: 1, candidateWriteError: false, reviewItemWriteError: false, inboxWriteError: false };
  const inbox = new Sheet('Family_Inbox', inboxHeaders, state);
  const candidates = new Sheet('Family_Candidates', candidateHeaders, state);
  const reviewItems = new Sheet('Family_Review_Items', reviewItemHeaders, state);
  const properties = Object.assign({
    FAMILY_INBOX_SERVICE_TOKEN: 'mini-service-secret',
    FAMILY_INBOX_WORKER_TOKEN: 'worker-service-secret',
    FAMILY_INBOX_WORKER_ID: 'worker-home-01',
    FAMILY_INBOX_WORKER_PROFILE: 'school-v1',
    FAMILY_INBOX_PC_REVIEW_TOKEN: 'pc-review-service-secret',
    FAMILY_INBOX_PC_REVIEW_ID: 'pc-review-01',
    FAMILY_INBOX_RAW_FOLDER_ID: 'raw-folder-id',
    FAMILY_INBOX_LEDGER_SPREADSHEET_ID: 'ledger-id',
  }, options.properties || {});
  const context = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => properties[key] || '' }) },
    LockService: { getScriptLock: () => ({ waitLock: () => { state.lockCount += 1; }, releaseLock: () => {} }) },
    SpreadsheetApp: { openById: (id) => {
      assert.strictEqual(id, 'ledger-id');
      state.sheetOpenCount += 1;
      return { getSheetByName: (name) => name === 'Family_Inbox' ? inbox : name === 'Family_Candidates' ? candidates : name === 'Family_Review_Items' ? reviewItems : null };
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
  for (const file of ['FamilyInboxService.js', 'FamilyInboxWorkerService.js', 'FamilyInboxReviewService.js', 'FamilyInboxPcReviewService.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'gas-family-inbox', file), 'utf8'), context);
  }
  return { api: context, state, inbox, candidates, reviewItems };
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
function fiveCandidatesFixture() {
  const document = candidatesFixture()[0];
  const event = (title, date, startTime, location = null) => ({
    candidateType: 'schedule.event', schemaVersion: 'schedule.event/1.0', confidence: 0.97,
    evidence: [{ page: 1, quote: `${date} ${title}`, fieldPaths: ['date', 'title'] }], warnings: [], questions: [],
    payload: { title, date, startTime, endTime: null, location, notes: null },
  });
  return [
    document,
    event('始業式', '2026-09-03', '08:15'),
    event('身体測定', '2026-09-10', null),
    event('遠足', '2026-09-12', '08:00', 'テスト公園'),
    {
      candidateType: 'school.belongings', schemaVersion: 'school.belongings/1.0', confidence: 0.98,
      evidence: [{ page: 1, quote: '持ち物 上履き 防災頭巾 夏休みの宿題', fieldPaths: ['items'] }], warnings: [], questions: [],
      payload: { date: '2026-09-03', items: ['上履き', '防災頭巾', '夏休みの宿題'] },
    },
  ];
}
function digest(f, candidateList) {
  return crypto.createHash('sha256').update(f.api.familyInboxWorkerStableStringify_(candidateList), 'utf8').digest('hex');
}
function longDigest(f, candidateList, reviewItems) {
  return crypto.createHash('sha256').update(f.api.familyInboxWorkerStableStringify_({ candidates: candidateList, reviewItems }), 'utf8').digest('hex');
}
function claimOne(f) { return f.api.familyInboxClaimNext_(workerBody('familyInbox.claimNext')); }
function publishCandidates(f, created, candidates, requestNumber = 950) {
  const claim = claimOne(f);
  return f.api.familyInboxPublishCandidates_(workerBody('familyInbox.publishCandidates', {
    inboxId: created.inboxId,
    claimVersion: claim.claimVersion,
    publishRequestId: uuid(requestNumber),
    payloadDigest: digest(f, candidates),
    candidates,
    usage: { inputTokens: 100, outputTokens: 50 },
    durationMs: 500,
  }));
}
function reviewBody(operation, fields = {}) {
  const body = { operation, internalToken: 'mini-service-secret', homeId: 'home-01', traceId: 'trace_review01', ...fields };
  if (/\.(updateCandidate|approveCandidate|rejectCandidate)$/.test(operation)) body.reviewedByMemberId = 'parent-01';
  return body;
}
function pcReviewBody(operation, fields = {}) {
  return { operation, pcReviewToken: 'pc-review-service-secret', traceId: 'trace_pc_review01', ...fields };
}
function longCandidatesFixture() {
  return [
    candidatesFixture()[0],
    candidatesFixture()[1],
    {
      candidateType: 'school.belongings', schemaVersion: 'school.belongings/1.0', confidence: 0.95,
      evidence: [{ page: 2, quote: '上履き', fieldPaths: ['items'] }], warnings: [], questions: [],
      payload: { date: '2026-08-28', items: ['上履き'] },
    },
  ];
}
function longReviewItemsFixture() {
  return Array.from({ length: 9 }, (_, index) => index < 6 ? {
    reviewType: 'page_fragment', status: 'needs_review', candidateType: 'schedule.event', confidence: 0.82, fragmentCount: 1,
    evidence: [{ page: index + 2, quote: `架空予定${index + 1}`, fieldPaths: ['title'] }],
    warnings: ['unresolved_required_field:date'], questions: ['confirm_event_date'],
    payload: { title: `架空予定${index + 1}`, date: null, startTime: null, endTime: null, location: null, notes: null },
  } : index < 8 ? {
    reviewType: 'page_fragment', status: 'needs_review', candidateType: 'school.deadline', confidence: 0.79, fragmentCount: 1,
    evidence: [{ page: index + 2, quote: `架空締切${index + 1}`, fieldPaths: ['title'] }],
    warnings: ['unresolved_required_field:dueDate'], questions: ['confirm_deadline_date'],
    payload: { title: `架空締切${index + 1}`, dueDate: null, actionRequired: '提出する' },
  } : {
    reviewType: 'page_fragment', status: 'needs_review', candidateType: 'school.belongings', confidence: 0.81, fragmentCount: 1,
    evidence: [{ page: 9, quote: '架空の持ち物', fieldPaths: ['items'] }],
    warnings: ['unresolved_required_field:date'], questions: ['confirm_belongings_date'],
    payload: { date: null, items: ['架空の持ち物'], relatedEventTitle: null },
  });
}

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

{
  const f = fixture();
  const created = submit(f, 'image/jpeg', 100);
  publishCandidates(f, created, fiveCandidatesFixture(), 951);
  submit(f, 'image/jpeg', 101);
  const list = f.api.familyInboxListReviews_(reviewBody('familyInbox.listReviews'));
  assert.strictEqual(list.items.length, 1, 'needs_review only');
  assert.strictEqual(list.items[0].candidateCount, 5);
  assert.deepStrictEqual(Array.from(list.items[0].candidateTypes), ['school.document', 'schedule.event', 'school.belongings']);
  assert.strictEqual(list.items[0].reviewStatus, 'pending');
  assert(!Object.hasOwn(list.items[0], 'originalRef'));

  const detail = f.api.familyInboxGetReview_(reviewBody('familyInbox.getReview', { inboxId: created.inboxId }));
  assert.strictEqual(detail.candidates.length, 5, 'all inboxId candidate rows must be returned');
  assert.strictEqual(detail.candidates.filter((candidate) => candidate.candidateType === 'school.document').length, 1);
  assert(!JSON.stringify(detail).includes('drive-secret-'));
  assert(detail.candidates.every((candidate) => candidate.evidenceSummary.length <= 2));

  const eventCandidate = detail.candidates.find((candidate) => candidate.candidateType === 'schedule.event');
  const updateRequest = reviewBody('familyInbox.updateCandidate', {
    inboxId: created.inboxId,
    candidateId: eventCandidate.candidateId,
    revision: eventCandidate.revision,
    reviewRequestId: uuid(960),
    payload: { title: '始業式（修正）', date: '2026-09-03', startTime: '08:20', endTime: null, location: null },
    reviewNote: '時刻を確認',
  });
  const updated = f.api.familyInboxUpdateCandidate_(updateRequest);
  assert.strictEqual(updated.candidate.revision, 2);
  assert.strictEqual(updated.candidate.payload.title, '始業式（修正）');
  const storedEvent = f.candidates.values.slice(1).map((row) => rowObject(candidateHeaders, row)).find((row) => row.candidateId === eventCandidate.candidateId);
  assert.strictEqual(JSON.parse(storedEvent.payloadJson).title, '始業式', 'AI payload must stay unchanged');
  assert.strictEqual(JSON.parse(storedEvent.reviewPayloadJson).title, '始業式（修正）');
  assert.strictEqual(storedEvent.reviewedByMemberId, 'parent-01');
  assert.strictEqual(JSON.parse(storedEvent.reviewHistoryJson).length, 1);
  expectCode(() => f.api.familyInboxUpdateCandidate_({ ...updateRequest, reviewRequestId: uuid(961) }), 'REVISION_CONFLICT');
  expectCode(() => f.api.familyInboxUpdateCandidate_({ ...updateRequest, revision: 2, reviewRequestId: uuid(962), payload: { ...updateRequest.payload, subjectMemberId: 'other' } }), 'INVALID_INPUT');

  const approveRequest = reviewBody('familyInbox.approveCandidate', {
    inboxId: created.inboxId, candidateId: eventCandidate.candidateId, revision: 2,
    reviewRequestId: uuid(963), reviewNote: '',
  });
  const approved = f.api.familyInboxApproveCandidate_(approveRequest);
  assert.strictEqual(approved.candidate.reviewStatus, 'approved');
  assert.strictEqual(approved.candidate.revision, 3);
  const replay = f.api.familyInboxApproveCandidate_(approveRequest);
  assert.strictEqual(replay.idempotency.replayed, true);
  assert.strictEqual(replay.candidate.revision, 3);
  expectCode(() => f.api.familyInboxApproveCandidate_({ ...approveRequest, reviewNote: 'changed' }), 'IDEMPOTENCY_CONFLICT');

  let remaining = f.api.familyInboxGetReview_(reviewBody('familyInbox.getReview', { inboxId: created.inboxId })).candidates.filter((candidate) => candidate.reviewStatus === 'pending');
  remaining.forEach((candidate, index) => {
    const common = { inboxId: created.inboxId, candidateId: candidate.candidateId, revision: candidate.revision, reviewRequestId: uuid(970 + index), reviewNote: '' };
    if (index === remaining.length - 1) {
      f.api.familyInboxRejectCandidate_(reviewBody('familyInbox.rejectCandidate', { ...common, reviewReason: 'not_relevant' }));
    } else {
      f.api.familyInboxApproveCandidate_(reviewBody('familyInbox.approveCandidate', common));
    }
  });
  const reviewed = f.api.familyInboxGetReview_(reviewBody('familyInbox.getReview', { inboxId: created.inboxId }));
  assert.strictEqual(reviewed.reviewStatus, 'reviewed');
  assert.strictEqual(inboxRow(f.inbox, created.inboxId).status, 'needs_review', 'Phase 3 must not complete the Inbox');
  assert(reviewed.candidates.every((candidate) => ['approved', 'rejected'].includes(candidate.reviewStatus)));
  assert(reviewed.candidates.every((candidate) => !Object.hasOwn(candidate, 'reviewedByMemberId')), 'actor must not be returned to PWA');
  const logs = f.state.logs.join('\n');
  ['mini-service-secret', 'private note', 'drive-secret-', '時刻を確認'].forEach((secret) => assert(!logs.includes(secret), `unsafe review log content: ${secret}`));
}

{
  const f = fixture();
  const created = submit(f, 'image/jpeg', 110);
  publishCandidates(f, created, fiveCandidatesFixture(), 980);
  const firstCandidateRow = f.candidates.values[1];
  firstCandidateRow[candidateHeaders.indexOf('publishRequestId')] = uuid(999);
  expectCode(() => f.api.familyInboxGetReview_(reviewBody('familyInbox.getReview', { inboxId: created.inboxId })), 'DATA_INTEGRITY_ERROR');
}

{
  const f = fixture();
  const created = submit(f, 'image/jpeg', 120);
  publishCandidates(f, created, fiveCandidatesFixture(), 981);
  const opensBefore = f.state.sheetOpenCount;
  expectCode(() => f.api.familyInboxListReviews_({ operation: 'familyInbox.listReviews', internalToken: 'wrong', homeId: 'home-01', traceId: 'trace_review02' }), 'FORBIDDEN');
  assert.strictEqual(f.state.sheetOpenCount, opensBefore, 'invalid Mini token must fail before Sheet work');
  const foreign = f.api.familyInboxListReviews_({ operation: 'familyInbox.listReviews', internalToken: 'mini-service-secret', homeId: 'home-02', traceId: 'trace_review03' });
  assert.strictEqual(foreign.items.length, 0, 'foreign home must not see reviews');
}

console.log('PASS Family Inbox Review list/detail, five-candidate integrity, correction provenance, optimistic concurrency, approve/reject idempotency, same-home security, and no Domain completion');

{
  const f = fixture({ properties: { FAMILY_INBOX_WORKER_PROFILE: 'school-v1-long' } });
  const created = submit(f, 'application/pdf', 200);
  const claim = claimOne(f);
  assert.strictEqual(claim.processingProfile, 'school-v1-long');
  const candidates = longCandidatesFixture();
  const reviewItems = longReviewItemsFixture();
  const publishRequestId = uuid(1200);
  const published = f.api.familyInboxPublishCandidates_(workerBody('familyInbox.publishCandidates', {
    inboxId: created.inboxId, claimVersion: claim.claimVersion, publishRequestId,
    payloadDigest: longDigest(f, candidates, reviewItems), candidates, reviewItems,
    usage: { inputTokens: 5000, outputTokens: 700 }, durationMs: 25000,
  }));
  assert.strictEqual(published.candidateIds.length, 3);
  assert.strictEqual(published.reviewItemIds.length, 9);
  assert.strictEqual(f.reviewItems.values.length, 10);

  const list = f.api.familyInboxPcReviewList_(pcReviewBody('familyInbox.pcReview.list'));
  assert.strictEqual(list.batches.length, 1);
  assert.strictEqual(list.batches[0].profile, 'school-v1-long');
  assert.strictEqual(list.batches[0].candidateCount, 3);
  assert.strictEqual(list.batches[0].reviewItemCount, 9);
  const detail = f.api.familyInboxPcReviewGet_(pcReviewBody('familyInbox.pcReview.get', { inboxId: created.inboxId }));
  assert.strictEqual(detail.items.length, 12);
  assert.strictEqual(detail.items[0].origin, 'review_item', 'unresolved items must be exception-first');
  assert(!JSON.stringify(detail).includes('drive-secret-'));

  const fragment = detail.items.find((item) => item.origin === 'review_item' && item.candidateType === 'schedule.event');
  const correctedPayload = { ...fragment.payload, date: '2026-09-10' };
  const updated = f.api.familyInboxPcReviewUpdate_(pcReviewBody('familyInbox.pcReview.update', {
    inboxId: created.inboxId, itemId: fragment.itemId, revision: fragment.revision,
    reviewRequestId: uuid(1201), payload: correctedPayload, reviewNote: 'synthetic correction',
  }));
  assert.strictEqual(updated.item.revision, 2);
  assert.strictEqual(updated.item.reviewStatus, 'pending');
  const promoted = f.api.familyInboxPcReviewApprove_(pcReviewBody('familyInbox.pcReview.approve', {
    inboxId: created.inboxId, itemId: fragment.itemId, revision: 2,
    reviewRequestId: uuid(1202), payload: correctedPayload, reviewNote: '',
  }));
  assert.strictEqual(promoted.item.reviewStatus, 'promoted');
  assert.strictEqual(promoted.promotedCandidate.reviewStatus, 'pending');
  assert.strictEqual(f.candidates.values.length, 5, 'promotion appends one canonical candidate');
  const promotionReplay = f.api.familyInboxPcReviewApprove_(pcReviewBody('familyInbox.pcReview.approve', {
    inboxId: created.inboxId, itemId: fragment.itemId, revision: 2,
    reviewRequestId: uuid(1202), payload: correctedPayload, reviewNote: '',
  }));
  assert.strictEqual(promotionReplay.idempotency.replayed, true);
  assert.strictEqual(f.candidates.values.length, 5, 'promotion replay must not duplicate candidate');

  let current = f.api.familyInboxPcReviewGet_(pcReviewBody('familyInbox.pcReview.get', { inboxId: created.inboxId }));
  const promotedCandidate = current.items.find((item) => item.origin === 'canonical' && item.itemId === promoted.promotedCandidate.candidateId);
  f.api.familyInboxPcReviewApprove_(pcReviewBody('familyInbox.pcReview.approve', {
    inboxId: created.inboxId, itemId: promotedCandidate.itemId, revision: promotedCandidate.revision,
    reviewRequestId: uuid(1203), payload: promotedCandidate.payload, reviewNote: '',
  }));
  current = f.api.familyInboxPcReviewGet_(pcReviewBody('familyInbox.pcReview.get', { inboxId: created.inboxId }));
  const canonicalPending = current.items.filter((item) => item.origin === 'canonical' && item.reviewStatus === 'pending');
  f.api.familyInboxPcReviewBulkApprove_(pcReviewBody('familyInbox.pcReview.bulkApproveCanonical', {
    inboxId: created.inboxId, reviewRequestId: uuid(1204), reviewNote: '',
    items: canonicalPending.map((item) => ({ candidateId: item.itemId, revision: item.revision })),
  }));
  current = f.api.familyInboxPcReviewGet_(pcReviewBody('familyInbox.pcReview.get', { inboxId: created.inboxId }));
  const pendingFragments = current.items.filter((item) => item.origin === 'review_item' && item.reviewStatus === 'pending');
  pendingFragments.forEach((item, index) => {
    f.api.familyInboxPcReviewReject_(pcReviewBody('familyInbox.pcReview.reject', {
      inboxId: created.inboxId, itemId: item.itemId, revision: item.revision,
      reviewRequestId: uuid(1210 + index), reviewReason: 'not_relevant', reviewNote: '',
    }));
  });
  const reviewed = f.api.familyInboxPcReviewGet_(pcReviewBody('familyInbox.pcReview.get', { inboxId: created.inboxId }));
  assert.strictEqual(reviewed.status, 'reviewed');
  assert.strictEqual(inboxRow(f.inbox, created.inboxId).status, 'needs_review', 'PC review must not perform Domain completion');
  assert(reviewed.items.every((item) => ['approved', 'rejected', 'promoted'].includes(item.reviewStatus)));
  const logs = f.state.logs.join('\n');
  ['pc-review-service-secret', 'worker-service-secret', 'synthetic correction', 'drive-secret-'].forEach((secret) => assert(!logs.includes(secret), `unsafe PC review log content: ${secret}`));
}

{
  const f = fixture({ properties: { FAMILY_INBOX_WORKER_PROFILE: 'school-v1-long' } });
  const created = submit(f, 'application/pdf', 210);
  const claim = claimOne(f);
  const candidates = longCandidatesFixture();
  const reviewItems = longReviewItemsFixture();
  f.api.familyInboxPublishCandidates_(workerBody('familyInbox.publishCandidates', {
    inboxId: created.inboxId, claimVersion: claim.claimVersion, publishRequestId: uuid(1300),
    payloadDigest: longDigest(f, candidates, reviewItems), candidates, reviewItems,
    usage: { inputTokens: 1, outputTokens: 1 }, durationMs: 1,
  }));
  const detail = f.api.familyInboxPcReviewGet_(pcReviewBody('familyInbox.pcReview.get', { inboxId: created.inboxId }));
  const fragment = detail.items.find((item) => item.origin === 'review_item' && item.candidateType === 'schedule.event');
  const payload = { ...fragment.payload, date: '2026-09-11' };
  f.state.reviewItemWriteError = true;
  expectCode(() => f.api.familyInboxPcReviewApprove_(pcReviewBody('familyInbox.pcReview.approve', {
    inboxId: created.inboxId, itemId: fragment.itemId, revision: 1, reviewRequestId: uuid(1301), payload, reviewNote: '',
  })), 'LEDGER_ERROR');
  assert.strictEqual(f.candidates.values.length, 5, 'promoted candidate remains for recovery');
  f.state.reviewItemWriteError = false;
  const recovered = f.api.familyInboxPcReviewApprove_(pcReviewBody('familyInbox.pcReview.approve', {
    inboxId: created.inboxId, itemId: fragment.itemId, revision: 1, reviewRequestId: uuid(1301), payload, reviewNote: '',
  }));
  assert.strictEqual(recovered.item.reviewStatus, 'promoted');
  assert.strictEqual(f.candidates.values.length, 5, 'recovery must reuse sourceReviewItemId candidate');
}

{
  const short = fixture();
  const created = submit(short, 'image/jpeg', 220);
  const claim = claimOne(short);
  const nine = [candidatesFixture()[0]].concat(Array.from({ length: 8 }, (_, index) => ({
    ...candidatesFixture()[1], payload: { ...candidatesFixture()[1].payload, title: `event-${index}` },
  })));
  expectCode(() => short.api.familyInboxPublishCandidates_(workerBody('familyInbox.publishCandidates', {
    inboxId: created.inboxId, claimVersion: claim.claimVersion, publishRequestId: uuid(1400), payloadDigest: digest(short, nine),
    candidates: nine, usage: { inputTokens: 1, outputTokens: 1 }, durationMs: 1,
  })), 'INVALID_CANDIDATE');
  expectCode(() => short.api.familyInboxPublishCandidates_({ ...workerBody('familyInbox.publishCandidates'), profile: 'school-v1-long' }), 'INVALID_INPUT');

  const long = fixture({ properties: { FAMILY_INBOX_WORKER_PROFILE: 'school-v1-long' } });
  const longCreated = submit(long, 'application/pdf', 221);
  const longClaim = claimOne(long);
  const forty = [candidatesFixture()[0]].concat(Array.from({ length: 39 }, (_, index) => ({
    ...candidatesFixture()[1], payload: { ...candidatesFixture()[1].payload, title: `long-event-${index}` },
  })));
  const accepted = long.api.familyInboxPublishCandidates_(workerBody('familyInbox.publishCandidates', {
    inboxId: longCreated.inboxId, claimVersion: longClaim.claimVersion, publishRequestId: uuid(1401),
    payloadDigest: longDigest(long, forty, []), candidates: forty, reviewItems: [],
    usage: { inputTokens: 1, outputTokens: 1 }, durationMs: 1,
  }));
  assert.strictEqual(accepted.candidateIds.length, 40);

  const oversized = fixture({ properties: { FAMILY_INBOX_WORKER_PROFILE: 'school-v1-long' } });
  const oversizedCreated = submit(oversized, 'application/pdf', 222);
  const oversizedClaim = claimOne(oversized);
  const hugeReviewItems = Array.from({ length: 39 }, (_, index) => ({
    reviewType: 'page_fragment', status: 'needs_review', candidateType: 'schedule.event', confidence: 0.8, fragmentCount: 1,
    evidence: Array.from({ length: 20 }, (__, evidenceIndex) => ({ page: index + 1, quote: 'x'.repeat(240), fieldPaths: [`field${evidenceIndex}`] })),
    warnings: [], questions: [],
    payload: { title: `oversized-event-${index}`, date: null, startTime: null, endTime: null, location: null, notes: null },
  }));
  const oneDocument = [candidatesFixture()[0]];
  expectCode(() => oversized.api.familyInboxPublishCandidates_(workerBody('familyInbox.publishCandidates', {
    inboxId: oversizedCreated.inboxId, claimVersion: oversizedClaim.claimVersion, publishRequestId: uuid(1402),
    payloadDigest: longDigest(oversized, oneDocument, hugeReviewItems), candidates: oneDocument, reviewItems: hugeReviewItems,
    usage: { inputTokens: 1, outputTokens: 1 }, durationMs: 1,
  })), 'INVALID_CANDIDATE');
}

{
  const f = fixture({ properties: { FAMILY_INBOX_WORKER_PROFILE: 'school-v1-long' } });
  const created = submit(f, 'application/pdf', 223);
  const claim = claimOne(f);
  const candidates = longCandidatesFixture();
  const reviewItems = longReviewItemsFixture();
  const request = workerBody('familyInbox.publishCandidates', {
    inboxId: created.inboxId, claimVersion: claim.claimVersion, publishRequestId: uuid(1410),
    payloadDigest: longDigest(f, candidates, reviewItems), candidates, reviewItems,
    usage: { inputTokens: 10, outputTokens: 5 }, durationMs: 50,
  });
  f.state.reviewItemWriteError = true;
  expectCode(() => f.api.familyInboxPublishCandidates_(request), 'LEDGER_ERROR');
  assert.strictEqual(f.candidates.values.length, 4, 'complete Candidate boundary must remain for replay');
  assert.strictEqual(f.reviewItems.values.length, 1, 'failed Review Item boundary must remain empty');
  assert.strictEqual(inboxRow(f.inbox, created.inboxId).status, 'processing');

  f.state.reviewItemWriteError = false;
  const recovered = f.api.familyInboxPublishCandidates_(request);
  assert.strictEqual(recovered.idempotency.replayed, true);
  assert.strictEqual(f.candidates.values.length, 4, 'replay must not duplicate Candidates');
  assert.strictEqual(f.reviewItems.values.length, 10, 'replay must append the missing Review Item boundary once');
  assert.strictEqual(inboxRow(f.inbox, created.inboxId).status, 'needs_review');
}

{
  const f = fixture({ properties: { FAMILY_INBOX_WORKER_PROFILE: 'school-v1-long' } });
  const created = submit(f, 'application/pdf', 224);
  const claim = claimOne(f);
  const candidates = longCandidatesFixture();
  const reviewItems = longReviewItemsFixture();
  const request = workerBody('familyInbox.publishCandidates', {
    inboxId: created.inboxId, claimVersion: claim.claimVersion, publishRequestId: uuid(1420),
    payloadDigest: longDigest(f, candidates, reviewItems), candidates, reviewItems,
    usage: { inputTokens: 10, outputTokens: 5 }, durationMs: 50,
  });
  f.state.inboxWriteError = true;
  expectCode(() => f.api.familyInboxPublishCandidates_(request), 'LEDGER_ERROR');
  assert.strictEqual(f.candidates.values.length, 4, 'Candidates remain after final Inbox update failure');
  assert.strictEqual(f.reviewItems.values.length, 10, 'Review Items remain after final Inbox update failure');
  assert.strictEqual(inboxRow(f.inbox, created.inboxId).status, 'processing');

  f.state.inboxWriteError = false;
  const recovered = f.api.familyInboxPublishCandidates_(request);
  assert.strictEqual(recovered.idempotency.replayed, true);
  assert.strictEqual(f.candidates.values.length, 4, 'Inbox recovery must not duplicate Candidates');
  assert.strictEqual(f.reviewItems.values.length, 10, 'Inbox recovery must not duplicate Review Items');
  assert.strictEqual(inboxRow(f.inbox, created.inboxId).status, 'needs_review');
}

{
  const f = fixture({ properties: { FAMILY_INBOX_WORKER_PROFILE: 'school-v1-long' } });
  const created = submit(f, 'application/pdf', 225);
  const claim = claimOne(f);
  const candidates = longCandidatesFixture();
  const reviewItems = longReviewItemsFixture();
  const request = workerBody('familyInbox.publishCandidates', {
    inboxId: created.inboxId, claimVersion: claim.claimVersion, publishRequestId: uuid(1430),
    payloadDigest: longDigest(f, candidates, reviewItems), candidates, reviewItems,
    usage: { inputTokens: 10, outputTokens: 5 }, durationMs: 50,
  });
  f.state.reviewItemWriteError = true;
  expectCode(() => f.api.familyInboxPublishCandidates_(request), 'LEDGER_ERROR');
  f.state.reviewItemWriteError = false;
  f.candidates.values.pop();
  f.candidates.values.pop();
  expectCode(() => f.api.familyInboxPublishCandidates_(request), 'DATA_INTEGRITY_ERROR');
  assert.strictEqual(f.candidates.values.length, 2, 'partial non-zero Candidate group must not be repaired implicitly');
  assert.strictEqual(f.reviewItems.values.length, 1, 'fail-closed replay must not append Review Items');
  assert.strictEqual(inboxRow(f.inbox, created.inboxId).status, 'processing');
}

{
  const f = fixture();
  const opensBefore = f.state.sheetOpenCount;
  expectCode(() => f.api.familyInboxPcReviewList_({ operation: 'familyInbox.pcReview.list', pcReviewToken: 'wrong', traceId: 'trace_bad_pc' }), 'FORBIDDEN');
  assert.strictEqual(f.state.sheetOpenCount, opensBefore, 'PC token must fail before Sheet work');

  const empty = fixture();
  expectCode(() => empty.api.familyInboxPcReviewList_(pcReviewBody('familyInbox.pcReview.list')), 'CONFIGURATION_ERROR');

  const automatic = fixture({ properties: { FAMILY_INBOX_PC_REVIEW_HOME_ID: 'stale-home-must-be-ignored' } });
  const created = submit(automatic, 'image/jpeg', 230);
  publishCandidates(automatic, created, candidatesFixture(), 1500);
  assert.strictEqual(automatic.api.familyInboxPcReviewList_(pcReviewBody('familyInbox.pcReview.list')).batches.length, 1, 'server-owned ledger home must replace the legacy Property');
  const foreignCandidate = automatic.candidates.values[1].slice();
  foreignCandidate[candidateHeaders.indexOf('candidateId')] = 'cand_' + 'e'.repeat(32);
  foreignCandidate[candidateHeaders.indexOf('homeId')] = 'home-02';
  automatic.candidates.appendRow(foreignCandidate);
  assert.strictEqual(automatic.api.familyInboxPcReviewGet_(pcReviewBody('familyInbox.pcReview.get', { inboxId: created.inboxId })).items.length, 2, 'foreign-home Candidate must remain invisible');
  expectCode(() => automatic.api.familyInboxPcReviewList_(pcReviewBody('familyInbox.pcReview.list', { homeId: 'home-02' })), 'INVALID_INPUT');

  const mixed = fixture();
  const mixedCreated = submit(mixed, 'image/jpeg', 231);
  publishCandidates(mixed, mixedCreated, candidatesFixture(), 1501);
  const foreignRow = mixed.inbox.values[1].slice();
  foreignRow[inboxHeaders.indexOf('inboxId')] = 'inb_' + 'f'.repeat(32);
  foreignRow[inboxHeaders.indexOf('clientRequestId')] = uuid(1502);
  foreignRow[inboxHeaders.indexOf('homeId')] = 'home-02';
  mixed.inbox.appendRow(foreignRow);
  expectCode(() => mixed.api.familyInboxPcReviewList_(pcReviewBody('familyInbox.pcReview.list')), 'CONFIGURATION_ERROR');
}

console.log('PASS Family Inbox PC Review dedicated auth, automatic single-home scope, long batch persistence, fragment promotion/recovery, canonical bulk approval, profile limits, safe logs, and zero Domain writes');

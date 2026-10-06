'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const uuid = '00000000-0000-4000-8000-000000000101';
const pdfBase64 = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 1]).toString('base64');
const inboxId = 'inb_00000000000040008000000000000101';
const candidateId = 'cand_00000000000040008000000000000101';

function reviewCandidate(overrides = {}) {
  return Object.assign({
    candidateId, candidateType: 'schedule.event', revision: 1, confidence: 0.98,
    payload: { title: '始業式', date: '2026-09-03', startTime: '08:15', endTime: null, location: null, notes: null },
    evidenceSummary: [{ page: 1, quote: '9月3日 始業式', fieldPaths: ['date', 'title'] }],
    warnings: [], questions: [], reviewStatus: 'pending', reviewedAt: '', reviewAction: '', reviewReason: '',
  }, overrides);
}

function fixture(options = {}) {
  const state = { calls: [], logs: [], authorized: [], driveFiles: [], folders: {}, lockCalls: 0 };
  const properties = Object.assign({ FAMILY_INBOX_WEBAPP_URL: 'https://script.google.com/macros/s/test-deployment/exec', FAMILY_INBOX_SERVICE_TOKEN: 'internal-service-secret' }, options.properties || {});
  let nextDriveId = 0;
  function makeFolder(name, parent = null) {
    const folder = {
      id: `folder-${++nextDriveId}`, name, parent, folders: [], files: [],
      getId() { return this.id; }, getName() { return this.name; },
      createFolder(childName) { const child = makeFolder(childName, this); this.folders.push(child); return child; },
      getFoldersByName(childName) {
        const matches = this.folders.filter((folder) => folder.name === childName);
        let index = 0;
        return { hasNext: () => index < matches.length, next: () => matches[index++] };
      },
      createFile(blob) {
        const file = {
          id: `drive-file-${++nextDriveId}`, name: blob.name, description: '', parent: this,
          bytes: Buffer.from(blob.bytes), mediaType: blob.mediaType,
          getId() { return this.id; }, getDescription() { return this.description; },
          setDescription(value) { this.description = value; return this; },
          setName(value) { this.name = value; return this; },
          moveTo(destination) { this.parent.files = this.parent.files.filter((item) => item !== this); this.parent = destination; destination.files.push(this); return this; },
          setTrashed(value) { this.trashed = Boolean(value); return this; },
        };
        this.files.push(file); state.driveFiles.push(file); return file;
      },
      searchFiles(query) {
        const match = /title contains \"([^\"]+)\"/.exec(query);
        const prefix = match?.[1] || '';
        const matches = this.files.filter((file) => file.name.includes(prefix));
        let index = 0;
        return { hasNext: () => index < matches.length, next: () => matches[index++] };
      },
    };
    state.folders[folder.id] = folder;
    return folder;
  }
  const driveRoot = makeFolder('My Drive');
  state.driveRoot = driveRoot;
  const members = {
    father: { homeId: 'home-a', memberUserId: 'father', displayName: '父', role: 'admin', status: 'active' },
    youngest_daughter: { homeId: 'home-a', memberUserId: 'youngest_daughter', displayName: '次女', role: 'self_record', status: 'active' },
  };
  const context = {
    resolveFirebaseAuthenticatedActor_: () => {
      if (options.unauthorized) { const error = new Error('raw auth details'); error.code = 'AUTH_TOKEN_INVALID'; throw error; }
      return { homeId: 'home-a', memberUserId: 'father', role: 'admin', authBindingKey: 'firebase-father' };
    },
    authorizeCapability_: (_, capability) => state.authorized.push(capability),
    getHomeMember_: (homeId, memberId) => homeId === 'home-a' && members[memberId] ? members[memberId] : null,
    isHomeMemberPolicyMatch_: (member) => Boolean(member && members[member.memberUserId]),
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (key) => properties[key] || '',
      setProperty: (key, value) => { properties[key] = String(value); return this; },
    }) },
    LockService: { getScriptLock: () => ({ waitLock: () => { state.lockCalls++; }, releaseLock: () => {} }) },
    DriveApp: {
      getRootFolder: () => driveRoot,
      getFolderById: (id) => { if (!state.folders[id]) throw new Error('folder missing'); return state.folders[id]; },
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      base64Decode: (value) => Array.from(Buffer.from(value, 'base64')),
      computeDigest: (algorithm, bytes) => { assert.strictEqual(algorithm, 'SHA_256'); return Array.from(require('crypto').createHash('sha256').update(Buffer.from(bytes)).digest()).map((value) => value > 127 ? value - 256 : value); },
      newBlob: (bytes, mediaType, name) => ({ bytes, mediaType, name }),
    },
    UrlFetchApp: { fetch: (url, fetchOptions) => {
      state.calls.push({ url, fetchOptions });
      if (options.fetchError) throw new Error('raw URL failure');
      const request = JSON.parse(fetchOptions.payload);
      let data;
      if (request.operation === 'familyInbox.submit') data = { inboxId, status: 'pending', idempotency: { replayed: false }, duplicateOfInboxId: '' };
      else if (request.operation === 'familyInbox.listReviews') data = { items: [{ inboxId, receivedAt: '2026-08-31T00:00:00+09:00', subjectMemberId: 'youngest_daughter', originalName: 'school.pdf', candidateCount: 5, candidateTypes: ['school.document', 'schedule.event', 'school.belongings'], reviewStatus: 'pending' }] };
      else if (request.operation === 'familyInbox.getReview') data = { inboxId, subjectMemberId: 'youngest_daughter', reviewStatus: 'pending', document: { originalName: 'school.pdf', receivedAt: '2026-08-31T00:00:00+09:00' }, candidates: [reviewCandidate()] };
      else if (['familyInbox.updateCandidate', 'familyInbox.approveCandidate', 'familyInbox.rejectCandidate'].includes(request.operation)) data = { candidate: reviewCandidate({ revision: 2, reviewStatus: request.operation === 'familyInbox.approveCandidate' ? 'approved' : request.operation === 'familyInbox.rejectCandidate' ? 'rejected' : 'pending' }), reviewStatus: 'pending', idempotency: { replayed: false } };
      else data = { inboxId: request.inboxId, status: 'pending', receivedAt: '2026-08-28T00:00:00+09:00', updatedAt: '2026-08-28T00:00:00+09:00', errorCode: '', duplicateOfInboxId: '' };
      const envelope = options.backendError
        ? { success: false, error: { code: options.backendError } }
        : { success: true, schemaVersion: 'family-inbox-1.0', data };
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify(envelope) };
    } },
    Logger: { log: (line) => state.logs.push(String(line)) },
    json_: (value) => value,
    Date, Error, Object, Array, String, Number, RegExp, JSON, Math,
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'gas', 'SchoolPrintDriveService.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'gas', 'FamilyInboxGatewayService.js'), 'utf8'), context);
  return { api: context, state };
}

function submit(overrides = {}) {
  return Object.assign({
    action: 'familyInbox.submit', auth: { provider: 'firebase', idToken: 'firebase-token' },
    clientRequestId: uuid, subjectMemberId: 'youngest_daughter', userNote: 'family private note',
    file: { name: 'school.pdf', mediaType: 'application/pdf', base64: pdfBase64 },
  }, overrides);
}

{
  const f = fixture();
  const result = f.api.familyInboxGateway_(submit());
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.data.status, 'pending');
  assert.deepStrictEqual(f.state.authorized, ['family.inbox.submit']);
  assert.strictEqual(f.state.calls.length, 1);
  const forwarded = JSON.parse(f.state.calls[0].fetchOptions.payload);
  assert.strictEqual(forwarded.homeId, 'home-a');
  assert.strictEqual(forwarded.submittedByMemberId, 'father');
  assert.strictEqual(forwarded.subjectMemberId, 'youngest_daughter');
  assert.strictEqual(forwarded.source, 'paluru');
  assert.strictEqual(forwarded.internalToken, 'internal-service-secret');
  assert(!Object.hasOwn(forwarded.file, 'sizeBytes'));
}

{
  const f = fixture({ properties: { FAMILY_INBOX_SERVICE_TOKEN: '' } });
  const result = f.api.familyInboxGateway_(submit({ documentType: 'school_print' }));
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.data.status, 'queued');
  assert.strictEqual(result.data.idempotency.replayed, false);
  assert.match(result.data.fileId, /^drive-file-/);
  assert.deepStrictEqual(f.state.authorized, ['family.inbox.submit']);
  assert.strictEqual(f.state.calls.length, 0, 'school print must not forward to Family Inbox Web App');
  assert.strictEqual(f.state.driveFiles.length, 1);
  assert.match(f.state.driveFiles[0].name, new RegExp(`^skv3-${uuid}__${result.data.fileId}__school.pdf$`));
  const metadata = JSON.parse(f.state.driveFiles[0].description);
  assert.strictEqual(metadata.type, 'school_print_v3');
  assert.strictEqual(metadata.clientRequestId, uuid);
  assert.strictEqual(metadata.userNote, 'family private note');
  const schoolPrint = f.state.driveRoot.folders.find((folder) => folder.name === 'SchoolPrint');
  assert(schoolPrint, 'SchoolPrint folder should be created directly under My Drive');
  assert.deepStrictEqual(schoolPrint.folders.map((folder) => folder.name), ['inbox']);
  const replay = f.api.familyInboxGateway_(submit({ documentType: 'school_print' }));
  assert.strictEqual(replay.success, true);
  assert.strictEqual(replay.data.fileId, result.data.fileId);
  assert.strictEqual(replay.data.idempotency.replayed, true);
  assert.strictEqual(f.state.driveFiles.length, 1);
  assert.strictEqual(f.state.calls.length, 0);
}

{
  const f = fixture();
  const invalid = f.api.familyInboxGateway_(submit({ documentType: 'school-v1-long' }));
  assert.strictEqual(invalid.success, false);
  assert.strictEqual(invalid.error.code, 'INVALID_INPUT');
  assert.strictEqual(f.state.driveFiles.length, 0);
  assert.strictEqual(f.state.calls.length, 0);
}

{
  const f = fixture();
  f.api.familyInboxGateway_(submit({ documentType: 'school_print' }));
  const conflict = f.api.familyInboxGateway_(submit({ documentType: 'school_print', file: { name: 'different.pdf', mediaType: 'application/pdf', base64: Buffer.from('%PDF-different').toString('base64') } }));
  assert.strictEqual(conflict.success, false);
  assert.strictEqual(conflict.error.code, 'DUPLICATE_REQUEST');
  assert.strictEqual(f.state.driveFiles.length, 1);
}

{
  const f = fixture();
  const result = f.api.familyInboxGateway_(submit({ homeId: 'home-b' }));
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.error.code, 'INVALID_INPUT');
  assert.strictEqual(f.state.calls.length, 0);
}

{
  const f = fixture();
  const result = f.api.familyInboxGateway_(submit({ subjectMemberId: 'outsider' }));
  assert.strictEqual(result.error.code, 'INVALID_MEMBER');
  assert.strictEqual(result.data.status, 'rejected');
  assert.strictEqual(f.state.calls.length, 0);
}

{
  const f = fixture({ unauthorized: true });
  const result = f.api.familyInboxGateway_(submit());
  assert.strictEqual(result.error.code, 'FORBIDDEN');
  assert.strictEqual(f.state.calls.length, 0);
}

{
  const f = fixture();
  const result = f.api.familyInboxGateway_(submit({ file: { name: 'school.pdf', mediaType: 'application/pdf', base64: Buffer.from([1, 2, 3]).toString('base64') } }));
  assert.strictEqual(result.error.code, 'INVALID_FILE_SIGNATURE');
  assert.strictEqual(result.data.status, 'rejected');
  assert.strictEqual(f.state.calls.length, 0);
}

{
  const unsupported = fixture();
  const unsupportedResult = unsupported.api.familyInboxGateway_(submit({ file: { name: 'school.csv', mediaType: 'text/csv', base64: Buffer.from('a,b').toString('base64') } }));
  assert.strictEqual(unsupportedResult.error.code, 'UNSUPPORTED_MEDIA_TYPE');
  assert.strictEqual(unsupported.state.calls.length, 0);
  const oversized = fixture();
  const oversizedResult = oversized.api.familyInboxGateway_(submit({ file: { name: 'school.pdf', mediaType: 'application/pdf', base64: 'A'.repeat(Math.ceil((5 * 1024 * 1024 + 1) / 3) * 4) } }));
  assert.strictEqual(oversizedResult.error.code, 'FILE_TOO_LARGE');
  assert.strictEqual(oversized.state.calls.length, 0);
}

{
  const f = fixture({ properties: { FAMILY_INBOX_SERVICE_TOKEN: '' } });
  const result = f.api.familyInboxGateway_(submit());
  assert.strictEqual(result.error.code, 'CONFIGURATION_ERROR');
  assert.strictEqual(f.state.calls.length, 0);
}

{
  const f = fixture({ backendError: 'FORBIDDEN' });
  const result = f.api.familyInboxGateway_(submit());
  assert.strictEqual(result.error.code, 'CONFIGURATION_ERROR', 'service-token mismatch must not be treated as an end-user denial');
}

{
  const f = fixture();
  const result = f.api.familyInboxGateway_({ action: 'familyInbox.getStatus', auth: { provider: 'firebase', idToken: 'firebase-token' }, inboxId });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.data.inboxId, inboxId);
  assert.deepStrictEqual(f.state.authorized, ['family.inbox.read']);
}

{
  const f = fixture();
  const list = f.api.familyInboxGateway_({ action: 'familyInbox.listReviews', auth: { provider: 'firebase', idToken: 'firebase-token' } });
  assert.strictEqual(list.success, true);
  assert.strictEqual(list.data.items[0].candidateCount, 5);
  assert.deepStrictEqual(f.state.authorized, ['family.inbox.review']);
  const forwarded = JSON.parse(f.state.calls[0].fetchOptions.payload);
  assert.strictEqual(forwarded.homeId, 'home-a');
  assert(!Object.hasOwn(forwarded, 'reviewedByMemberId'));
}

{
  const f = fixture();
  const detail = f.api.familyInboxGateway_({ action: 'familyInbox.getReview', auth: { provider: 'firebase', idToken: 'firebase-token' }, inboxId });
  assert.strictEqual(detail.success, true);
  assert.strictEqual(detail.data.candidates.length, 1);
  assert(!Object.hasOwn(detail.data.candidates[0], 'reviewedByMemberId'));
}

{
  const f = fixture();
  const result = f.api.familyInboxGateway_({
    action: 'familyInbox.updateCandidate', auth: { provider: 'firebase', idToken: 'firebase-token' },
    inboxId, candidateId, revision: 1, reviewRequestId: uuid, reviewNote: '',
    payload: { title: '始業式（修正）', date: '2026-09-03', startTime: '08:20', endTime: null, location: null },
  });
  assert.strictEqual(result.success, true);
  const forwarded = JSON.parse(f.state.calls[0].fetchOptions.payload);
  assert.strictEqual(forwarded.reviewedByMemberId, 'father');
  assert.strictEqual(forwarded.homeId, 'home-a');
  assert.strictEqual(forwarded.revision, 1);
  assert(!Object.hasOwn(forwarded, 'subjectMemberId'));
}

{
  const f = fixture();
  const result = f.api.familyInboxGateway_({
    action: 'familyInbox.rejectCandidate', auth: { provider: 'firebase', idToken: 'firebase-token' },
    inboxId, candidateId, revision: 1, reviewRequestId: uuid, reviewNote: '', reviewReason: 'not_relevant',
  });
  assert.strictEqual(result.success, true);
  const forwarded = JSON.parse(f.state.calls[0].fetchOptions.payload);
  assert.strictEqual(forwarded.reviewReason, 'not_relevant');
}

{
  const f = fixture();
  const invalid = f.api.familyInboxGateway_({
    action: 'familyInbox.approveCandidate', auth: { provider: 'firebase', idToken: 'firebase-token' },
    inboxId, candidateId, revision: 1, reviewRequestId: uuid, reviewNote: '', reviewedByMemberId: 'spoofed',
  });
  assert.strictEqual(invalid.success, false);
  assert.strictEqual(invalid.error.code, 'INVALID_INPUT');
  assert.strictEqual(f.state.calls.length, 0);
}

{
  const f = fixture({ fetchError: true });
  const result = f.api.familyInboxGateway_({ action: 'familyInbox.listReviews', auth: { provider: 'firebase', idToken: 'firebase-token' } });
  assert.strictEqual(result.error.code, 'SERVICE_UNAVAILABLE');
}

{
  const f = fixture();
  f.api.familyInboxGateway_(submit());
  const logs = f.state.logs.join('\n');
  ['internal-service-secret', 'pairing-token', 'family private note', pdfBase64, 'test-deployment'].forEach((secret) => assert(!logs.includes(secret), `unsafe gateway log: ${secret}`));
}

assert(fs.readFileSync(path.join(__dirname, '..', 'gas', 'Code.js'), 'utf8').includes("indexOf('familyInbox.') === 0"), 'Family Inbox route missing');
console.log('PASS Family Inbox Mini actor boundary, member validation, capability, internal token, service contract, and safe logs');

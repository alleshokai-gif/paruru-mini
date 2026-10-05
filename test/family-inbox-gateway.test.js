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
  const state = { calls: [], logs: [], authorized: [] };
  const properties = Object.assign({ FAMILY_INBOX_WEBAPP_URL: 'https://script.google.com/macros/s/test-deployment/exec', FAMILY_INBOX_SERVICE_TOKEN: 'internal-service-secret' }, options.properties || {});
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
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => properties[key] || '' }) },
    Utilities: { base64Decode: (value) => Array.from(Buffer.from(value, 'base64')), getUuid: () => uuid },
    UrlFetchApp: { fetch: (url, fetchOptions) => {
      state.calls.push({ url, fetchOptions });
      if (options.fetchError) throw new Error('raw URL failure');
      const request = JSON.parse(fetchOptions.payload);
      let data;
      if (request.operation === 'familyInbox.submit') data = { inboxId, status: 'pending', idempotency: { replayed: false }, duplicateOfInboxId: '' };
      else if (request.operation === 'familyInbox.schoolKnowledge.submit') data = { inboxId, status: options.schoolKnowledgeSubmitStatus || 'queued', idempotency: { replayed: options.schoolKnowledgeSubmitReplayed === true }, duplicateOfInboxId: '' };
      else if (request.operation === 'familyInbox.listReviews') data = { items: [{ inboxId, receivedAt: '2026-08-31T00:00:00+09:00', subjectMemberId: 'youngest_daughter', originalName: 'school.pdf', candidateCount: 5, candidateTypes: ['school.document', 'schedule.event', 'school.belongings'], reviewStatus: 'pending' }] };
      else if (request.operation === 'familyInbox.getReview') data = { inboxId, subjectMemberId: 'youngest_daughter', reviewStatus: 'pending', document: { originalName: 'school.pdf', receivedAt: '2026-08-31T00:00:00+09:00' }, candidates: [reviewCandidate()] };
      else if (['familyInbox.updateCandidate', 'familyInbox.approveCandidate', 'familyInbox.rejectCandidate'].includes(request.operation)) data = { candidate: reviewCandidate({ revision: 2, reviewStatus: request.operation === 'familyInbox.approveCandidate' ? 'approved' : request.operation === 'familyInbox.rejectCandidate' ? 'rejected' : 'pending' }), reviewStatus: 'pending', idempotency: { replayed: false } };
      else if (options.schoolKnowledgeStatus && request.operation === 'familyInbox.getStatus') data = {
        inboxId: request.inboxId, status: 'completed', receivedAt: '2026-10-04T09:00:00+09:00', updatedAt: '2026-10-04T09:01:00+09:00',
        errorCode: '', duplicateOfInboxId: '', processingProfile: 'school-knowledge-p2', originalName: 'school.pdf',
        processedAt: '2026-10-04T09:01:00+09:00', sourceSha: 'b'.repeat(64),
        knowledgePath: 'school/2026/grade-3/2026-10/knowledge.md', gitCommitSha: 'c'.repeat(40), errorMessage: '',
      };
      else data = { inboxId: request.inboxId, status: 'pending', receivedAt: '2026-08-28T00:00:00+09:00', updatedAt: '2026-08-28T00:00:00+09:00', errorCode: '', duplicateOfInboxId: '' };
      const envelope = options.backendError
        ? {
          success: false,
          ok: false,
          error: { code: options.backendError },
          ...(request.operation === 'familyInbox.schoolKnowledge.submit' ? {
            errorCode: options.backendError,
            stage: options.backendStage || 'receipt_write',
            clientRequestId: request.clientRequestId,
            requestId: request.traceId,
            correlationId: request.traceId,
            message: 'safe backend diagnostic',
          } : {}),
        }
        : { success: true, schemaVersion: 'family-inbox-1.0', data };
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify(envelope) };
    } },
    Logger: { log: (line) => state.logs.push(String(line)) },
    json_: (value) => value,
    Date, Error, Object, Array, String, Number, RegExp, JSON, Math,
  };
  vm.createContext(context);
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
  const f = fixture();
  const request = submit({ action: 'familyInbox.schoolKnowledge.submit' });
  const result = f.api.familyInboxGateway_(request);
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.data.status, 'queued');
  assert.deepStrictEqual(f.state.authorized, ['family.inbox.submit']);
  const forwarded = JSON.parse(f.state.calls[0].fetchOptions.payload);
  assert.strictEqual(forwarded.operation, 'familyInbox.schoolKnowledge.submit');
  assert.strictEqual(forwarded.source, 'paluru');
  assert.strictEqual(forwarded.file.mediaType, 'application/pdf');
  assert(!Object.hasOwn(forwarded, 'processingProfile'), 'client cannot choose profile');

  const injected = fixture().api.familyInboxGateway_(submit({
    action: 'familyInbox.schoolKnowledge.submit', processingProfile: 'school-v1-long',
  }));
  assert.strictEqual(injected.error.code, 'INVALID_INPUT');

  const replayFixture = fixture({ schoolKnowledgeSubmitStatus: 'completed', schoolKnowledgeSubmitReplayed: true });
  const replay = replayFixture.api.familyInboxGateway_(submit({ action: 'familyInbox.schoolKnowledge.submit' }));
  assert.strictEqual(replay.success, true, 'an idempotent replay may report the row current status');
  assert.strictEqual(replay.data.status, 'completed');
  assert.strictEqual(replay.data.idempotency.replayed, true);

  const image = fixture().api.familyInboxGateway_(submit({
    action: 'familyInbox.schoolKnowledge.submit',
    file: { name: 'school.jpg', mediaType: 'image/jpeg', base64: Buffer.from([0xff, 0xd8, 0xff, 1]).toString('base64') },
  }));
  assert.strictEqual(image.error.code, 'UNSUPPORTED_MEDIA_TYPE');
}

{
  const f = fixture({ backendError: 'LEDGER_ERROR', backendStage: 'receipt_write' });
  const request = submit({ action: 'familyInbox.schoolKnowledge.submit' });
  const result = f.api.familyInboxGateway_(request);
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error.code, 'LEDGER_ERROR');
  assert.strictEqual(result.errorCode, 'LEDGER_ERROR');
  assert.strictEqual(result.stage, 'receipt_write');
  assert.strictEqual(result.clientRequestId, uuid);
  assert.strictEqual(result.requestId, result.correlationId);
  assert.match(result.correlationId, /^fi_[A-Za-z0-9_-]{8,}$/);
  assert.strictEqual(result.error.stage, 'receipt_write');
  assert(!JSON.stringify(result).includes('internal-service-secret'));
  assert(!JSON.stringify(f.state.logs).includes('family private note'));
}

{
  const f = fixture();
  const request = submit({ action: 'familyInbox.schoolKnowledge.submit', subjectMemberId: 'outsider' });
  const result = f.api.familyInboxGateway_(request);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.errorCode, 'INVALID_MEMBER');
  assert.strictEqual(result.stage, 'gateway_validation');
  assert.strictEqual(result.clientRequestId, uuid);
  assert.match(result.correlationId, /^fi_[A-Za-z0-9_-]{8,}$/);
  assert.strictEqual(f.state.calls.length, 0);
}

{
  const f = fixture({ backendError: 'FORBIDDEN', backendStage: 'authentication' });
  const result = f.api.familyInboxGateway_(submit({ action: 'familyInbox.schoolKnowledge.submit' }));
  assert.strictEqual(result.errorCode, 'FORBIDDEN', 'P2 diagnostic preserves the safe backend code');
  assert.strictEqual(result.stage, 'authentication');
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
  const f = fixture({ schoolKnowledgeStatus: true });
  const result = f.api.familyInboxGateway_({ action: 'familyInbox.getStatus', auth: { provider: 'firebase', idToken: 'firebase-token' }, inboxId });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.data.processingProfile, 'school-knowledge-p2');
  assert.strictEqual(result.data.sourceSha, 'b'.repeat(64));
  assert.strictEqual(result.data.knowledgePath, 'school/2026/grade-3/2026-10/knowledge.md');
  assert.strictEqual(result.data.gitCommitSha, 'c'.repeat(40));
  assert.strictEqual(result.data.processedAt, '2026-10-04T09:01:00+09:00');
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

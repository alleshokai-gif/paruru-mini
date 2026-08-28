'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const uuid = '00000000-0000-4000-8000-000000000101';
const pdfBase64 = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 1]).toString('base64');

function fixture(options = {}) {
  const state = { calls: [], logs: [], authorized: [] };
  const properties = Object.assign({ FAMILY_INBOX_WEBAPP_URL: 'https://script.google.com/macros/s/test-deployment/exec', FAMILY_INBOX_SERVICE_TOKEN: 'internal-service-secret' }, options.properties || {});
  const members = {
    father: { homeId: 'home-a', memberUserId: 'father', displayName: '父', role: 'admin', status: 'active' },
    youngest_daughter: { homeId: 'home-a', memberUserId: 'youngest_daughter', displayName: '次女', role: 'self_record', status: 'active' },
  };
  const context = {
    resolveAuthenticatedActor_: () => {
      if (options.unauthorized) { const error = new Error('raw auth details'); error.code = 'UNAUTHORIZED_DEVICE'; throw error; }
      return { homeId: 'home-a', memberUserId: 'father', role: 'admin', deviceId: 'father-device' };
    },
    authorizeCapability_: (_, capability) => state.authorized.push(capability),
    getHomeMember_: (homeId, memberId) => homeId === 'home-a' && members[memberId] ? members[memberId] : null,
    isHomeMemberPolicyMatch_: (member) => Boolean(member && members[member.memberUserId]),
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => properties[key] || '' }) },
    Utilities: { base64Decode: (value) => Array.from(Buffer.from(value, 'base64')) },
    UrlFetchApp: { fetch: (url, fetchOptions) => {
      state.calls.push({ url, fetchOptions });
      if (options.fetchError) throw new Error('raw URL failure');
      const request = JSON.parse(fetchOptions.payload);
      const data = request.operation === 'familyInbox.submit'
        ? { inboxId: 'inb_00000000000040008000000000000101', status: 'pending', idempotency: { replayed: false }, duplicateOfInboxId: '' }
        : { inboxId: request.inboxId, status: 'pending', receivedAt: '2026-08-28T00:00:00+09:00', updatedAt: '2026-08-28T00:00:00+09:00', errorCode: '', duplicateOfInboxId: '' };
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
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'gas', 'FamilyInboxGatewayService.js'), 'utf8'), context);
  return { api: context, state };
}

function submit(overrides = {}) {
  return Object.assign({
    action: 'familyInbox.submit', deviceId: 'father-device', pairingToken: 'pairing-token',
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
  const inboxId = 'inb_00000000000040008000000000000101';
  const result = f.api.familyInboxGateway_({ action: 'familyInbox.getStatus', deviceId: 'father-device', pairingToken: 'pairing-token', inboxId });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.data.inboxId, inboxId);
  assert.deepStrictEqual(f.state.authorized, ['family.inbox.read']);
}

{
  const f = fixture();
  f.api.familyInboxGateway_(submit());
  const logs = f.state.logs.join('\n');
  ['internal-service-secret', 'pairing-token', 'family private note', pdfBase64, 'test-deployment'].forEach((secret) => assert(!logs.includes(secret), `unsafe gateway log: ${secret}`));
}

assert(fs.readFileSync(path.join(__dirname, '..', 'gas', 'Code.js'), 'utf8').includes("indexOf('familyInbox.') === 0"), 'Family Inbox route missing');
console.log('PASS Family Inbox Mini actor boundary, member validation, capability, internal token, service contract, and safe logs');

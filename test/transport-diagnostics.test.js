'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { TextEncoder } = require('node:util');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'features', 'transport', 'diagnostics.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const swSource = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

function storage() {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

function load(localStorage) {
  const events = [];
  const logs = [];
  const context = {
    console: { info: (...args) => logs.push(args) },
    localStorage,
    crypto: { randomUUID: () => '11111111-1111-4111-8111-12345678abcd', subtle: webcrypto.subtle },
    TextEncoder,
    BUILD_ID: 'v-test',
    Date,
    Number,
    String,
    Object,
    Array,
    Set,
    Map,
    JSON,
    TypeError,
    CustomEvent: class CustomEvent { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    document: { dispatchEvent: event => events.push(event) },
    globalThis: null,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'features/transport/diagnostics.js' });
  return { api: context.PALURUTransportDiagnostics, events, logs };
}

const shared = storage();
const cold = load(shared);
const auth = cold.api.start('auth_read', 'auth.config.get');
const saved = cold.api.record(auth, {
  attempt: 1,
  elapsedMs: 321,
  classification: 'network',
  backendStage: 'AUTH_RESPONSE',
  outcome: 'retry',
  errorCode: 'TRANSPORT_FAILURE',
  token: 'firebase-id-token-secret',
  uid: 'private-user',
  eventTitle: 'private calendar title',
  payload: { private: true },
});
assert.deepEqual(Object.keys(saved), [
  'at', 'requestClass', 'action', 'requestIdSuffix', 'attempt', 'elapsedMs', 'classification',
  'httpStatus', 'backendStage', 'buildId', 'outcome', 'errorCode', 'transportType',
  'serverTotalMs', 'firebaseVerifyMs', 'actorResolveMs', 'upstreamMs', 'serializeMs',
  'questionIdFingerprint', 'questionRevisionFingerprint', 'projectsRevisionFingerprint',
  'workItemsRevisionFingerprint', 'calendarRevisionFingerprint'
]);
assert.equal(saved.requestIdSuffix, '5678abcd');
assert.equal(saved.outcome, 'retry');
const serialized = JSON.stringify(shared);
assert(!JSON.stringify(saved).includes('secret') && !JSON.stringify(saved).includes('private'), 'safe record leaked private input');
assert.equal(cold.events.length, 1, 'diagnostic update event missing');

(async function verifyFingerprints() {
  const questionId = 'decision-c8443ab12e611951c1a86506';
  const revisionInput = {
    inbox_items: [{ id: questionId, question_revision: 'qrev-private-value',
      source_revision_references: { projects: 'projects-private', work_items: 'work-private', calendar: 'calendar-private' } }],
  };
  const fingerprintContext = cold.api.start('kaz_read', 'kazOs.inbox.get', '33333333-3333-4333-8333-12345678abcd');
  const fingerprintCount = await cold.api.recordInboxRevisionFingerprints(fingerprintContext, revisionInput, 'DIRECT_V2');
  assert.equal(fingerprintCount, 1, 'one safe fingerprint row should be recorded');
  const fingerprintRecord = cold.api.list().at(-1);
  const fingerprint = async value => Buffer.from(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(value))).toString('hex').slice(0, 12);
  assert.equal(fingerprintRecord.questionIdFingerprint, await fingerprint(questionId));
  assert.equal(fingerprintRecord.questionRevisionFingerprint, await fingerprint('qrev-private-value'));
  assert.equal(fingerprintRecord.projectsRevisionFingerprint, await fingerprint('projects-private'));
  assert.equal(fingerprintRecord.workItemsRevisionFingerprint, await fingerprint('work-private'));
  assert.equal(fingerprintRecord.calendarRevisionFingerprint, await fingerprint('calendar-private'));
  assert.equal(fingerprintRecord.transportType, 'DIRECT_V2');
  const fingerprintLogs = JSON.stringify({ storage: shared.getItem(cold.api.storageKey), logs: cold.logs });
  assert(!fingerprintLogs.includes(questionId) && !fingerprintLogs.includes('qrev-private-value')
    && !fingerprintLogs.includes('projects-private') && !fingerprintLogs.includes('work-private')
    && !fingerprintLogs.includes('calendar-private'), 'revision diagnostics leaked raw question or revision data');
  assert.equal(await cold.api.recordInboxRevisionFingerprints(fingerprintContext, revisionInput, 'INVALID'), 0,
    'unexpected transport must not create fingerprint records');

  const warm = load(shared);
  assert.equal(warm.api.list().length, 2, 'warm start did not retain cold-start diagnostics');
  assert.equal(warm.api.list()[0].requestIdSuffix, '5678abcd');

  for (let index = 0; index < 70; index += 1) {
    const request = warm.api.start('kaz_read', 'kazOs.inbox.get', `22222222-2222-4222-8222-${String(index).padStart(12, '0')}`);
    warm.api.record(request, { attempt: 1, elapsedMs: index, classification: 'none', outcome: 'success' });
  }
  assert.equal(warm.api.list().length, 64, 'diagnostic ledger is not bounded');
  assert(warm.api.list().every(entry => Object.keys(entry).length === 23), 'diagnostic record shape drifted');

  assert(htmlSource.indexOf('features/transport/diagnostics.js') < htmlSource.indexOf('features/auth/firebase-auth-runtime.js'), 'diagnostics must load before auth runtime');
  assert(htmlSource.includes('transportDiagnosticsOutput') && htmlSource.includes('安全なメタデータのみ'), 'read-only Settings diagnostics are missing');
  assert(swSource.includes('versioned("features/transport/diagnostics.js")'), 'diagnostics module is missing from the app shell');
  assert(swSource.includes('versioned("features/transport/read-v2.js")'), 'direct read adapter is missing from the app shell');
  assert(swSource.includes('PALURU_TRANSPORT_DIAGNOSTIC') && swSource.includes('NETWORK_FIRST_CACHE_HIT') && swSource.includes('NAVIGATION_FALLBACK'), 'service-worker transition/cache diagnostics are incomplete');
  assert(appSource.includes('navigator.serviceWorker.addEventListener("message"') && appSource.includes('recordServiceWorkerDiagnostic_'), 'service-worker diagnostics are not retained by the page');
  assert(swSource.includes('self.skipWaiting()') && swSource.includes('self.clients.claim()'), 'service-worker version transition safeguards changed');

  console.log('PASS bounded secret-free transport diagnostics cold/warm persistence and service-worker transition');
})().catch(error => { console.error(error); process.exitCode = 1; });

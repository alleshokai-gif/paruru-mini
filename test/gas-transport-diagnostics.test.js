'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'gas', 'TransportDiagnostics.js'), 'utf8');
const logs = [];
const context = {
  Date,
  JSON,
  Math,
  Number,
  Object,
  String,
  Logger: { log: line => logs.push(String(line)) },
  PALURU_MINI_BUILD_ID: 'mini-test-build',
};
vm.createContext(context);
vm.runInContext(source, context, { filename: 'gas/TransportDiagnostics.js' });

const trace = context.createMiniTransportTrace_({
  action: 'kazOs.inbox.get',
  request_id: '123e4567-e89b-42d3-a456-426614174000',
  transport_attempt: 2,
  auth: { idToken: 'firebase-secret-token' },
  userId: 'private-user',
  calendarId: 'private-calendar-id',
  eventTitle: 'private-event-title',
});
assert(trace, 'valid correlated Kaz request did not create a trace');
context.recordMiniTransportTrace_(trace, 'SANITIZER_OK', {
  classification: 'none',
  outcome: 'success',
  token: 'another-secret',
  payload: { body: 'private-body' },
});

assert.equal(logs.length, 1);
assert(logs[0].startsWith('[PALURU_TRANSPORT] '));
const entry = JSON.parse(logs[0].slice('[PALURU_TRANSPORT] '.length));
assert.deepEqual(Object.keys(entry), [
  'requestClass', 'action', 'requestIdSuffix', 'attempt', 'elapsedMs', 'classification',
  'httpStatus', 'backendStage', 'buildId', 'outcome', 'errorCode'
]);
assert.equal(entry.requestIdSuffix, '426614174000'.slice(-8));
assert.equal(entry.attempt, 2);
assert.equal(entry.backendStage, 'SANITIZER_OK');
assert.equal(entry.buildId, 'mini-test-build');
for (const forbidden of ['firebase-secret-token', 'private-user', 'private-calendar-id', 'private-event-title', 'another-secret', 'private-body']) {
  assert(!logs[0].includes(forbidden), `safe GAS diagnostic leaked ${forbidden}`);
}

assert.equal(context.createMiniTransportTrace_({ action: 'kazOs.inbox.get', request_id: 'not-a-uuid' }), null);
assert.equal(context.createMiniTransportTrace_({ action: 'unknown.action', request_id: '123e4567-e89b-42d3-a456-426614174000' }), null);

console.log('PASS GAS transport diagnostics safe allowlist and correlation');

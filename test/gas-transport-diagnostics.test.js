'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'gas', 'TransportDiagnostics.js'), 'utf8');
const logs = [];
let nowMs = 1000;
const context = {
  Date: { now: () => nowMs },
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
nowMs = 1010;
context.recordMiniTransportTrace_(trace, 'GAS_EXECUTION_START', { outcome: 'progress' });
nowMs = 1040;
context.recordMiniTransportTrace_(trace, 'SANITIZE_END', {
  classification: 'none',
  outcome: 'success',
  httpStatus: 200,
  token: 'another-secret',
  payload: { body: 'private-body' },
});
context.recordMiniTransportTrace_(trace, 'NOT_ALLOWLISTED', { outcome: 'success' });

assert.equal(logs.length, 2, 'allowlisted stages were not the only emitted records');
assert(logs[1].startsWith('[PALURU_TRANSPORT] '));
const entry = JSON.parse(logs[1].slice('[PALURU_TRANSPORT] '.length));
assert.deepEqual(Object.keys(entry), [
  'requestClass', 'action', 'requestIdSuffix', 'attempt', 'stage', 'stageElapsedMs',
  'elapsedMs', 'cumulativeMs', 'classification', 'httpStatus', 'httpStatusCategory',
  'backendStage', 'buildId', 'outcome', 'errorCode'
]);
assert.equal(entry.requestIdSuffix, '426614174000'.slice(-8));
assert.equal(entry.attempt, 2);
assert.equal(entry.stage, 'SANITIZE_END');
assert.equal(entry.backendStage, 'SANITIZE_END');
assert.equal(entry.stageElapsedMs, 30);
assert.equal(entry.elapsedMs, 40);
assert.equal(entry.cumulativeMs, 40);
assert.equal(entry.httpStatusCategory, '2xx');
assert.equal(entry.buildId, 'mini-test-build');
for (const forbidden of ['firebase-secret-token', 'private-user', 'private-calendar-id', 'private-event-title', 'another-secret', 'private-body']) {
  assert(!logs.join('\n').includes(forbidden), `safe GAS diagnostic leaked ${forbidden}`);
}

assert.equal(context.createMiniTransportTrace_({ action: 'kazOs.inbox.get', request_id: 'not-a-uuid' }), null);
assert.equal(context.createMiniTransportTrace_({ action: 'unknown.action', request_id: '123e4567-e89b-42d3-a456-426614174000' }), null);

console.log('PASS GAS transport diagnostics safe allowlist and correlation');

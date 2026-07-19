'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'gas', 'HomeAgentActionSecurity.js'), 'utf8');
const context = { Date, JSON, Math, Number, Object, Array, String, RegExp, Error };
vm.createContext(context);
new vm.Script(source).runInContext(context);

const properties = {};
const stateValues = new Map();
let nowMs = Date.parse('2026-07-19T10:00:00+09:00');
let executeCalls = 0;
let lockDepth = 0;
let uuidCounter = 1;
const token = 'pairing-token-placeholder-000000000001';
const deviceId = 'device-test-1';
const clientIds = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
  '55555555-5555-4555-8555-555555555555',
  '66666666-6666-4666-8666-666666666666',
];

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function uuid() {
  const suffix = String(uuidCounter++).padStart(12, '0');
  return 'aaaaaaaa-aaaa-4aaa-8aaa-' + suffix;
}

const state = {
  get: (key) => stateValues.has(key) ? stateValues.get(key) : null,
  put: (key, value) => stateValues.set(key, String(value)),
  remove: (key) => stateValues.delete(key),
  all: () => Object.fromEntries([...stateValues.entries()].map(([key, value]) => ['PALURU_HA_ACTION_STATE_' + key, value])),
};
const lock = {
  waitLock: () => { if (lockDepth) throw new Error('lock re-entry'); lockDepth += 1; },
  releaseLock: () => { lockDepth -= 1; },
};
const deps = {
  getProperty: (name) => properties[name] || '',
  state,
  lock,
  uuid,
  now: () => new Date(nowMs),
  hash: sha256,
  execute: (record) => {
    executeCalls += 1;
    return record.skill === 'pauseRoomAutomation'
      ? { success: true, result: { activePause: { expiresAt: record.operation.pauseExpiresAt, status: 'active', pauseId: 'must-not-leak', requestedBy: 'must-not-leak' } } }
      : { success: true, result: { resumed: 1, status: 'cancelled', roomId: 'must-not-leak' } };
  },
};

function configure() {
  properties.PALURU_HOME_AGENT_ACTIONS_ENABLED = 'true';
  properties.PALURU_HOME_AGENT_ALLOWED_ROOM_IDS = JSON.stringify(['bedroom', 'living']);
  properties.PALURU_HOME_AGENT_DEVICE_TOKEN_HASHES = JSON.stringify({ [deviceId]: sha256(token) });
}

function request(clientRequestId) {
  return { clientRequestId, userId: 'father', userDisplayName: '父', deviceId };
}

function pauseCandidate(hours) {
  return {
    skill: 'pauseRoomAutomation',
    parameters: { roomId: 'bedroom', expiresAt: new Date(nowMs + hours * 60 * 60 * 1000).toISOString() },
  };
}

function resumeCandidate() {
  return { skill: 'resumeRoomAutomation', parameters: { roomId: 'bedroom', resumeTarget: 'pause-logical-target' } };
}

function assert(value, message) { if (!value) throw new Error(message); }
function errorCode(fn) { try { fn(); return ''; } catch (error) { return error && error.code; } }
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('kill switch missing or disabled fails closed', () => {
  delete properties.PALURU_HOME_AGENT_ACTIONS_ENABLED;
  assert(errorCode(() => context.createHomeAgentActionConfirmation_(pauseCandidate(2), request(clientIds[0]), token, deps)) === 'HOME_AGENT_ACTIONS_DISABLED', 'missing switch accepted');
  properties.PALURU_HOME_AGENT_ACTIONS_ENABLED = 'false';
  const result = context.executeHomeAgentActionConfirmation_({}, deps);
  assert(result.error.code === 'HOME_AGENT_ACTIONS_DISABLED' && executeCalls === 0, 'disabled action executed');
});

test('device pairing and server room allowlist are required', () => {
  configure();
  assert(errorCode(() => context.createHomeAgentActionConfirmation_(pauseCandidate(2), request(clientIds[0]), 'wrong-token-that-is-long-enough-000000', deps)) === 'UNAUTHORIZED_DEVICE', 'wrong pairing accepted');
  const badRoom = pauseCandidate(2); badRoom.parameters.roomId = 'unknown-room';
  assert(errorCode(() => context.createHomeAgentActionConfirmation_(badRoom, request(clientIds[0]), token, deps)) === 'ROOM_NOT_ALLOWED', 'unknown room accepted');
});

test('confirmation is bound to operation and omits mutable parameters', () => {
  configure();
  const issued = context.createHomeAgentActionConfirmation_(pauseCandidate(2), request(clientIds[0]), token, deps);
  const text = JSON.stringify(issued);
  assert(issued.type === 'homeAgentActionConfirmation' && !text.includes('bedroom') && !text.includes('duration') && !text.includes('pauseRoomAutomation'), 'mutable operation leaked');
  const response = context.executeHomeAgentActionConfirmation_({
    confirmationId: issued.confirmationId,
    clientRequestId: issued.clientRequestId,
    pairingToken: token,
    candidate: { skill: 'resumeRoomAutomation', parameters: { roomId: 'living', durationMinutes: 999 } },
  }, deps);
  assert(response.success && response.operation === 'pause', 'client altered bound operation');
  assert(!JSON.stringify(response).includes('must-not-leak'), 'execution result was not sanitized');
});

test('missing altered and expired confirmations are rejected', () => {
  configure();
  const missing = context.executeHomeAgentActionConfirmation_({ clientRequestId: clientIds[1], pairingToken: token }, deps);
  assert(missing.error.code === 'INVALID_CONFIRMATION', 'missing confirmation accepted');
  const issued = context.createHomeAgentActionConfirmation_(pauseCandidate(2), request(clientIds[1]), token, deps);
  const altered = context.executeHomeAgentActionConfirmation_({ confirmationId: issued.confirmationId, clientRequestId: clientIds[2], pairingToken: token }, deps);
  assert(altered.error.code === 'INVALID_CONFIRMATION', 'altered request accepted');
  nowMs += 6 * 60 * 1000;
  const expired = context.executeHomeAgentActionConfirmation_({ confirmationId: issued.confirmationId, clientRequestId: issued.clientRequestId, pairingToken: token }, deps);
  assert(expired.error.code === 'CONFIRMATION_EXPIRED', 'expired confirmation accepted');
  nowMs -= 6 * 60 * 1000;
});

test('same confirmation executes upstream once and replays same result', () => {
  configure();
  const issued = context.createHomeAgentActionConfirmation_(resumeCandidate(), request(clientIds[2]), token, deps);
  const before = executeCalls;
  const body = { confirmationId: issued.confirmationId, clientRequestId: issued.clientRequestId, pairingToken: token };
  const first = context.executeHomeAgentActionConfirmation_(body, deps);
  const second = context.executeHomeAgentActionConfirmation_(body, deps);
  assert(first.success && JSON.stringify(first) === JSON.stringify(second), 'result replay changed');
  assert(executeCalls === before + 1, 'upstream executed more than once');
});

test('same clientRequestId issues one confirmation and cannot create a second pause', () => {
  configure();
  const first = context.createHomeAgentActionConfirmation_(pauseCandidate(2), request(clientIds[3]), token, deps);
  const second = context.createHomeAgentActionConfirmation_(pauseCandidate(2), request(clientIds[3]), token, deps);
  assert(first.confirmationId === second.confirmationId, 'retry issued a second confirmation');
  const before = executeCalls;
  const body = { confirmationId: first.confirmationId, clientRequestId: clientIds[3], pairingToken: token };
  context.executeHomeAgentActionConfirmation_(body, deps);
  context.executeHomeAgentActionConfirmation_(body, deps);
  assert(executeCalls === before + 1, 'retry created a second operation');
});

test('same clientRequestId with different operation is rejected', () => {
  configure();
  context.createHomeAgentActionConfirmation_(pauseCandidate(2), request(clientIds[4]), token, deps);
  assert(errorCode(() => context.createHomeAgentActionConfirmation_(resumeCandidate(), request(clientIds[4]), token, deps)) === 'IDEMPOTENCY_CONFLICT', 'idempotency conflict accepted');
});

test('pause and resume are the only confirmation allowlist', () => {
  configure();
  const candidate = { skill: 'setAirconOverride', parameters: { roomId: 'bedroom' } };
  assert(errorCode(() => context.createHomeAgentActionConfirmation_(candidate, request(clientIds[5]), token, deps)) === 'UNSUPPORTED_HOME_AGENT_ACTION', 'unconnected operation accepted');
  assert(errorCode(() => context.createHomeAgentActionConfirmation_({ skill: 'other', parameters: { roomId: 'bedroom' } }, request(clientIds[5]), token, deps)) === 'UNSUPPORTED_HOME_AGENT_ACTION', 'unknown operation accepted');
});

test('pause maximum remains eight hours', () => {
  configure();
  assert(errorCode(() => context.createHomeAgentActionConfirmation_(pauseCandidate(8.01), request(clientIds[5]), token, deps)) === 'INVALID_HOME_AGENT_ACTION', 'pause over eight hours accepted');
});

test('production executor revalidates room state and resume target immediately before write', () => {
  let pauseWrites = 0;
  let resumeWrites = 0;
  context.normalizeHomeAgentRequest_ = (input) => input;
  context.getRoomClimateSkill_ = () => ({ success: true, data: { roomId: 'bedroom' } });
  context.pauseRoomAutomationSkill_ = () => { pauseWrites += 1; return { success: true, data: { activePause: { expiresAt: 'later', status: 'active' } } }; };
  context.getRoomAutomationPauseSkill_ = () => ({ success: true, data: { activePause: { pauseId: 'expected-target' } } });
  context.resumeRoomAutomationSkill_ = () => { resumeWrites += 1; return { success: true, data: { resumed: 1, status: 'cancelled' } }; };
  context.executeSecuredHomeAgentActionRecord_({ skill: 'pauseRoomAutomation', roomId: 'bedroom', actor: {}, operation: { pauseExpiresAt: 'later' } });
  context.executeSecuredHomeAgentActionRecord_({ skill: 'resumeRoomAutomation', roomId: 'bedroom', actor: {}, operation: { resumeTarget: 'expected-target' } });
  assert(pauseWrites === 1 && resumeWrites === 1, 'validated operations did not execute');
  assert(errorCode(() => context.executeSecuredHomeAgentActionRecord_({ skill: 'resumeRoomAutomation', roomId: 'bedroom', actor: {}, operation: { resumeTarget: 'changed-target' } })) === 'HOME_AGENT_ACTION_STATE_CHANGED', 'changed resume target executed');
  assert(resumeWrites === 1, 'resume wrote after target changed');
});

test('read-only route remains and PWA sends no mutable action fields', () => {
  const core = fs.readFileSync(path.join(root, 'gas', 'HomeAgentCore.js'), 'utf8');
  const code = fs.readFileSync(path.join(root, 'gas', 'Code.js'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert(code.includes("if (action === 'homeAgent')") && core.includes('function runHomeAgentRequest_'), 'read-only Home Agent route changed');
  const actionBody = app.slice(app.indexOf('async function executeHomeAgentAction'), app.indexOf('function buildHomeAgentPayload'));
  ['candidate,', 'confirmed:', 'roomId:', 'durationMinutes:', 'skill:'].forEach((forbidden) => assert(!actionBody.includes(forbidden), 'PWA resends mutable action field: ' + forbidden));
  assert(actionBody.includes('confirmationId') && actionBody.includes('clientRequestId') && actionBody.includes('pairingToken'), 'protected action identifiers missing');
});

test('tokens confirmation IDs and operation bodies are not logged', () => {
  const all = source + fs.readFileSync(path.join(root, 'gas', 'HomeAgentCore.js'), 'utf8') + fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert(!/Logger\.log\([^\n]*(pairingToken|confirmationId)/.test(all), 'sensitive value logged by GAS');
  assert(!/debugLog\([^\n]*(pairingToken|confirmationId)/.test(all), 'sensitive value logged by PWA');
  const failure = context.executeHomeAgentActionConfirmation_({ confirmationId: 'bad', clientRequestId: clientIds[5], pairingToken: token }, deps);
  const text = JSON.stringify(failure);
  assert(!text.includes(token) && !text.includes('bedroom'), 'public error leaked protected input');
});

let failures = 0;
for (const item of tests) {
  try { item.fn(); console.log('PASS ' + item.name); }
  catch (error) { failures += 1; console.error('FAIL ' + item.name + ': ' + error.message); }
}
if (failures) process.exit(1); else console.log('PASS all ' + tests.length + ' tests');

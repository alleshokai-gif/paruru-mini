'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { buildPrototype } = require('../src/server');

function runtimeInput() {
  return `runtime-${crypto.randomBytes(24).toString('base64url')}`;
}

function prepareAndStage(prototype, credentialId) {
  const prepared = prototype.service.prepareRotation({ credential_id: credentialId });
  const input = runtimeInput();
  const staged = prototype.service.stageCredential(credentialId, {
    rotation_id: prepared.rotation_id,
    new_credential: input,
    confirm_credential: input
  });
  return staged;
}

test('successful synthetic rotation requires Human approval before old-disable', () => {
  const prototype = buildPrototype();
  const staged = prepareAndStage(prototype, 'synthetic_kaz_os_read');
  assert.match(staged.created_at, /\+09:00$/);
  assert.ok(staged.audit.every((event) => /\+09:00$/.test(event.timestamp)));
  const distributed = prototype.service.distribute(staged.rotation_id);
  const verified = prototype.service.verify(distributed.rotation_id);
  assert.equal(verified.rotation.state, 'awaiting_human_approval');
  assert.throws(
    () => prototype.service.disableOld(distributed.rotation_id, { approval_id: 'not-approved' }),
    (error) => error.code === 'HUMAN_APPROVAL_REQUIRED'
  );
  const approved = prototype.service.approve(distributed.rotation_id);
  assert.equal(approved.human_approved, true);
  const disabled = prototype.service.disableOld(distributed.rotation_id, { approval_id: approved.approval_id });
  assert.equal(disabled.state, 'previous_disabled');
  const closed = prototype.service.regressionCheck(distributed.rotation_id);
  assert.equal(closed.rotation.state, 'closed');
  assert.equal(closed.rotation.permitted_actions.length, 0);
});

test('failed synthetic verification can roll back to the previous generation', () => {
  const prototype = buildPrototype();
  const before = prototype.backend.getStatus('synthetic_health');
  const staged = prepareAndStage(prototype, 'synthetic_health');
  prototype.service.distribute(staged.rotation_id);
  const verified = prototype.service.verify(staged.rotation_id);
  assert.equal(verified.rotation.state, 'verify_failed');
  assert.equal(verified.diagnostics.connectivity, 'FAILED');
  const rolledBack = prototype.service.rollback(staged.rotation_id);
  assert.equal(rolledBack.state, 'rolled_back');
  assert.deepEqual(prototype.backend.getStatus('synthetic_health'), before);
});

test('audit write failure prevents stage success and restores backend metadata', () => {
  const prototype = buildPrototype();
  const prepared = prototype.service.prepareRotation({ credential_id: 'synthetic_openai' });
  const before = prototype.backend.getStatus('synthetic_openai');
  const input = runtimeInput();
  prototype.audit.failNextWrite();
  assert.throws(
    () => prototype.service.stageCredential('synthetic_openai', {
      rotation_id: prepared.rotation_id,
      new_credential: input,
      confirm_credential: input
    }),
    (error) => error.code === 'AUDIT_PERSISTENCE_FAILED'
  );
  assert.deepEqual(prototype.backend.getStatus('synthetic_openai'), before);
  assert.equal(prototype.service.getRotation(prepared.rotation_id).state, 'input_pending');
});

test('service refuses any backend other than the synthetic adapter', () => {
  const prototype = buildPrototype();
  assert.throws(() => new prototype.service.constructor({
    registry: prototype.registry,
    backend: { kind: 'not-synthetic' },
    audit: prototype.audit
  }), /REQUEST_INVALID/);
});

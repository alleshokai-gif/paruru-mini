'use strict';

const crypto = require('node:crypto');
const { ConsoleError } = require('./errors');
const { toTokyoIso } = require('./time');

const TERMINAL_STATES = new Set(['closed', 'rolled_back']);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConsoleError('REQUEST_INVALID');
  }
}

function assertKeys(value, allowed) {
  assertObject(value);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new ConsoleError('REQUEST_INVALID');
  }
}

class SecretConsoleService {
  constructor({ registry, backend, audit, clock = () => new Date() }) {
    if (!registry || !backend || backend.kind !== 'synthetic' || !audit) {
      throw new ConsoleError('REQUEST_INVALID');
    }
    this.registry = registry;
    this.backend = backend;
    this.audit = audit;
    this.clock = clock;
    this.rotations = new Map();
  }

  listCredentials() {
    return this.registry.list().map((summary) => {
      const status = this.backend.getStatus(summary.credential_id);
      return {
        ...summary,
        status: status.configured ? 'configured' : 'missing',
        enabled: status.enabled,
        active_rotation_id: this.findActiveRotation(summary.credential_id)?.rotation_id || null
      };
    });
  }

  getCredential(credentialId) {
    const record = this.registry.get(credentialId);
    const status = this.backend.getStatus(credentialId);
    return {
      ...this.registry.toDetail(record),
      status: status.configured ? 'configured' : 'missing',
      enabled: status.enabled,
      staged: status.staged,
      active_rotation_id: this.findActiveRotation(credentialId)?.rotation_id || null
    };
  }

  findActiveRotation(credentialId) {
    return Array.from(this.rotations.values()).find((rotation) => (
      rotation.credential_id === credentialId && !TERMINAL_STATES.has(rotation.state)
    )) || null;
  }

  prepareRotation(body) {
    assertKeys(body, new Set(['credential_id']));
    const record = this.registry.get(body.credential_id);
    if (this.findActiveRotation(record.credential_id)) {
      throw new ConsoleError('ROTATION_ACTIVE', 409);
    }
    const rotation = {
      rotation_id: `rot_${crypto.randomUUID()}`,
      credential_id: record.credential_id,
      state: 'input_pending',
      human_approved: false,
      approval_id: null,
      created_at: toTokyoIso(this.clock()),
      updated_at: toTokyoIso(this.clock())
    };
    this.audit.append({
      event: 'rotation_prepared',
      credential_id: rotation.credential_id,
      rotation_id: rotation.rotation_id,
      previous_state: null,
      next_state: rotation.state
    });
    this.rotations.set(rotation.rotation_id, rotation);
    return this.toRotationDto(rotation);
  }

  stageCredential(credentialId, body) {
    assertKeys(body, new Set(['rotation_id', 'new_credential', 'confirm_credential']));
    const rotation = this.requireRotation(body.rotation_id, credentialId, ['input_pending']);
    if (typeof body.new_credential !== 'string'
        || body.new_credential !== body.confirm_credential
        || body.new_credential.length < 12
        || body.new_credential.length > 512) {
      throw new ConsoleError('SECRET_INPUT_INVALID');
    }
    return this.mutate({
      rotation,
      event: 'credential_staged',
      nextState: 'staged',
      backendAction: () => this.backend.stage(credentialId, body.new_credential, rotation.rotation_id)
    });
  }

  distribute(rotationId) {
    const rotation = this.requireRotation(rotationId, null, ['staged']);
    return this.mutate({
      rotation,
      event: 'credential_distributed',
      nextState: 'distributed',
      backendAction: () => this.backend.activate(rotation.credential_id, rotation.rotation_id)
    });
  }

  verify(rotationId) {
    const rotation = this.requireRotation(rotationId, null, ['distributed']);
    const result = this.backend.probe(rotation.credential_id);
    const passed = result.connectivity === 'OK'
      && result.configured === true
      && result.consumers.every((consumer) => consumer.status === 'OK');
    const nextState = passed ? 'awaiting_human_approval' : 'verify_failed';
    const next = this.withState(rotation, nextState);
    this.audit.append({
      event: 'credential_verified',
      credential_id: rotation.credential_id,
      rotation_id: rotation.rotation_id,
      previous_state: rotation.state,
      next_state: nextState,
      result: passed ? 'success' : 'failure',
      safe_code: passed ? 'OK' : 'CONNECTIVITY_FAILED'
    });
    this.rotations.set(rotation.rotation_id, next);
    return {
      rotation: this.toRotationDto(next),
      diagnostics: clone(result)
    };
  }

  approve(rotationId) {
    const rotation = this.requireRotation(rotationId, null, ['awaiting_human_approval']);
    const next = {
      ...this.withState(rotation, 'approved'),
      human_approved: true,
      approval_id: `approval_${crypto.randomUUID()}`
    };
    this.audit.append({
      event: 'old_disable_approved',
      credential_id: rotation.credential_id,
      rotation_id: rotation.rotation_id,
      previous_state: rotation.state,
      next_state: next.state
    });
    this.rotations.set(rotation.rotation_id, next);
    return this.toRotationDto(next);
  }

  disableOld(rotationId, body) {
    assertKeys(body, new Set(['approval_id']));
    const rotation = this.requireRotation(rotationId, null, ['approved']);
    if (!rotation.human_approved || body.approval_id !== rotation.approval_id) {
      throw new ConsoleError('HUMAN_APPROVAL_REQUIRED', 409);
    }
    return this.mutate({
      rotation,
      event: 'previous_credential_disabled',
      nextState: 'previous_disabled',
      backendAction: () => this.backend.disablePrevious(rotation.credential_id, rotation.rotation_id)
    });
  }

  regressionCheck(rotationId) {
    const rotation = this.requireRotation(rotationId, null, ['previous_disabled']);
    const result = this.backend.probe(rotation.credential_id);
    const passed = result.connectivity === 'OK'
      && result.configured === true
      && result.consumers.every((consumer) => consumer.status === 'OK');
    const nextState = passed ? 'closed' : 'regression_failed';
    const next = this.withState(rotation, nextState);
    this.audit.append({
      event: 'regression_checked',
      credential_id: rotation.credential_id,
      rotation_id: rotation.rotation_id,
      previous_state: rotation.state,
      next_state: nextState,
      result: passed ? 'success' : 'failure',
      safe_code: passed ? 'OK' : 'CONNECTIVITY_FAILED'
    });
    this.rotations.set(rotation.rotation_id, next);
    return {
      rotation: this.toRotationDto(next),
      diagnostics: clone(result)
    };
  }

  rollback(rotationId) {
    const rotation = this.requireRotation(rotationId, null, [
      'staged', 'distributed', 'verify_failed', 'awaiting_human_approval',
      'approved', 'previous_disabled', 'regression_failed'
    ]);
    return this.mutate({
      rotation,
      event: 'rotation_rolled_back',
      nextState: 'rolled_back',
      backendAction: () => this.backend.rollback(rotation.credential_id, rotation.rotation_id)
    });
  }

  probeCredential(credentialId) {
    this.registry.get(credentialId);
    const result = this.backend.probe(credentialId);
    this.audit.append({
      event: 'credential_probed',
      credential_id: credentialId,
      rotation_id: null,
      previous_state: null,
      next_state: null,
      result: result.connectivity === 'OK' ? 'success' : 'failure',
      safe_code: result.connectivity === 'OK' ? 'OK' : 'CONNECTIVITY_FAILED'
    });
    return clone(result);
  }

  getRotation(rotationId) {
    return this.toRotationDto(this.requireRotation(rotationId));
  }

  requireRotation(rotationId, credentialId = null, expectedStates = null) {
    const rotation = this.rotations.get(rotationId);
    if (!rotation || (credentialId && rotation.credential_id !== credentialId)) {
      throw new ConsoleError('NOT_FOUND', 404);
    }
    if (expectedStates && !expectedStates.includes(rotation.state)) {
      throw new ConsoleError(
        rotation.state === 'awaiting_human_approval' ? 'HUMAN_APPROVAL_REQUIRED' : 'ROTATION_STATE_CONFLICT',
        409
      );
    }
    return rotation;
  }

  mutate({ rotation, event, nextState, backendAction }) {
    const snapshot = this.backend.snapshot();
    try {
      backendAction();
      const next = this.withState(rotation, nextState);
      this.audit.append({
        event,
        credential_id: rotation.credential_id,
        rotation_id: rotation.rotation_id,
        previous_state: rotation.state,
        next_state: nextState
      });
      this.rotations.set(rotation.rotation_id, next);
      return this.toRotationDto(next);
    } catch (error) {
      this.backend.restore(snapshot);
      throw error;
    }
  }

  withState(rotation, state) {
    return {
      ...rotation,
      state,
      updated_at: toTokyoIso(this.clock())
    };
  }

  toRotationDto(rotation) {
    return {
      rotation_id: rotation.rotation_id,
      credential_id: rotation.credential_id,
      state: rotation.state,
      human_approved: rotation.human_approved,
      approval_id: rotation.approval_id,
      created_at: rotation.created_at,
      updated_at: rotation.updated_at,
      permitted_actions: this.permittedActions(rotation),
      audit: this.audit.listForRotation(rotation.rotation_id)
    };
  }

  permittedActions(rotation) {
    const actions = {
      input_pending: ['stage'],
      staged: ['distribute', 'rollback'],
      distributed: ['verify', 'rollback'],
      verify_failed: ['rollback'],
      awaiting_human_approval: ['approve', 'rollback'],
      approved: ['disable_old', 'rollback'],
      previous_disabled: ['regression_check', 'rollback'],
      regression_failed: ['rollback'],
      closed: [],
      rolled_back: []
    };
    return actions[rotation.state] ? [...actions[rotation.state]] : [];
  }
}

module.exports = { SecretConsoleService, TERMINAL_STATES };

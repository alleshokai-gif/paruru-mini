'use strict';

const { ConsoleError } = require('./errors');

function cloneState(state) {
  return new Map(Array.from(state.entries(), ([key, value]) => [key, { ...value }]));
}

class SyntheticSecretBackend {
  constructor(registry) {
    this.kind = 'synthetic';
    this.registry = registry;
    this.state = new Map();
    for (const record of registry.list()) {
      this.state.set(record.credential_id, {
        configured: record.status === 'configured',
        enabled: record.enabled,
        generation: record.status === 'configured' ? 1 : 0,
        previous_generation: null,
        staged_rotation_id: null,
        active_rotation_id: null,
        previous_disabled: false
      });
    }
  }

  snapshot() {
    return cloneState(this.state);
  }

  restore(snapshot) {
    this.state = cloneState(snapshot);
  }

  getStatus(credentialId) {
    const current = this.state.get(credentialId);
    if (!current) throw new ConsoleError('NOT_FOUND', 404);
    return {
      configured: current.configured,
      enabled: current.enabled,
      staged: Boolean(current.staged_rotation_id)
    };
  }

  stage(credentialId, secretInput, rotationId) {
    const current = this.state.get(credentialId);
    if (!current) throw new ConsoleError('NOT_FOUND', 404);
    if (typeof secretInput !== 'string' || secretInput.length < 12 || secretInput.length > 512) {
      throw new ConsoleError('SECRET_INPUT_INVALID');
    }
    current.staged_rotation_id = rotationId;
    return { staged: true, backend: 'synthetic' };
  }

  activate(credentialId, rotationId) {
    const current = this.state.get(credentialId);
    if (!current || current.staged_rotation_id !== rotationId) {
      throw new ConsoleError('ROTATION_STATE_CONFLICT', 409);
    }
    current.previous_generation = current.generation;
    current.generation += 1;
    current.configured = true;
    current.enabled = true;
    current.active_rotation_id = rotationId;
    current.staged_rotation_id = null;
    current.previous_disabled = false;
    return { activated: true, backend: 'synthetic' };
  }

  probe(credentialId) {
    const record = this.registry.get(credentialId);
    const current = this.state.get(credentialId);
    const connectivity = record.connectivity;
    const status = connectivity === 'OK' ? 'OK' : connectivity === 'FAILED' ? 'FAILED' : 'NOT_TESTED';
    return {
      credential_id: credentialId,
      configured: current.configured,
      connectivity: status,
      consumers: record.consumers.map((consumer) => ({ id: consumer.id, status })),
      elapsed_ms: 7
    };
  }

  disablePrevious(credentialId, rotationId) {
    const current = this.state.get(credentialId);
    if (!current || current.active_rotation_id !== rotationId || current.previous_generation === null) {
      throw new ConsoleError('ROTATION_STATE_CONFLICT', 409);
    }
    current.previous_disabled = true;
    return { previous_disabled: true, backend: 'synthetic' };
  }

  rollback(credentialId, rotationId) {
    const current = this.state.get(credentialId);
    if (!current) throw new ConsoleError('NOT_FOUND', 404);
    if (current.active_rotation_id === rotationId && current.previous_generation !== null) {
      current.generation = current.previous_generation;
      current.previous_generation = null;
      current.active_rotation_id = null;
      current.previous_disabled = false;
    }
    if (current.staged_rotation_id === rotationId) current.staged_rotation_id = null;
    return { rolled_back: true, backend: 'synthetic' };
  }
}

module.exports = { SyntheticSecretBackend };

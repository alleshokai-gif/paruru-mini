'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const TERMINAL_STATE = 'APPLIED_ACKNOWLEDGED';
const SAFE_ALIAS = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

class BrokerError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = 'BrokerError';
    this.code = code;
    this.status = status;
  }
}

function requireAlias(value, code = 'INVALID_ALIAS') {
  if (typeof value !== 'string' || !SAFE_ALIAS.test(value)) {
    throw new BrokerError(code, 400);
  }
  return value;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function publicOperation(operation) {
  return {
    operation_alias: operation.operation_id,
    state: operation.state,
    lease_alias: operation.lease_alias,
    lease_expires_at: operation.lease_expires_at,
    attempt_count: operation.attempt_count,
    acknowledged: operation.acknowledged,
    safe_error_code: operation.safe_error_code,
  };
}

class SafeAudit {
  constructor() {
    this.entries = [];
  }

  record({ event, operationAlias = null, state = null, safeCode = 'OK', status = 200 }) {
    this.entries.push(Object.freeze({
      event,
      operation_alias: operationAlias,
      state,
      safe_code: safeCode,
      status,
    }));
  }
}

class SyntheticSecretStore {
  constructor(entries = {}) {
    this.entries = new Map(Object.entries(entries));
  }

  async access(versionAlias) {
    requireAlias(versionAlias, 'INVALID_SECRET_VERSION_ALIAS');
    if (!this.entries.has(versionAlias)) {
      throw new BrokerError('SYNTHETIC_SECRET_NOT_FOUND', 404);
    }
    return this.entries.get(versionAlias);
  }
}

class DurableOperationStore {
  constructor(filePath) {
    if (typeof filePath !== 'string' || filePath.length === 0) {
      throw new TypeError('filePath is required');
    }
    this.filePath = filePath;
    this.queue = Promise.resolve();
    this.nextFailure = null;
  }

  failNext(code = 'STATE_STORE_UNAVAILABLE') {
    this.nextFailure = code;
  }

  async transact(mutator) {
    const transaction = this.queue.then(async () => {
      if (this.nextFailure) {
        const code = this.nextFailure;
        this.nextFailure = null;
        throw new BrokerError(code, 503);
      }
      const data = await this.readAll();
      const result = await mutator(data);
      await this.writeAll(data);
      return clone(result);
    });
    this.queue = transaction.catch(() => undefined);
    return transaction;
  }

  async readOnly(reader) {
    const operation = this.queue.then(async () => {
      if (this.nextFailure) {
        const code = this.nextFailure;
        this.nextFailure = null;
        throw new BrokerError(code, 503);
      }
      return clone(await reader(await this.readAll()));
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  async readAll() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      if (!parsed || parsed.schema_version !== 1 || !parsed.operations) {
        throw new Error('invalid state schema');
      }
      return parsed;
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        return { schema_version: 1, operations: {} };
      }
      throw new BrokerError('STATE_STORE_CORRUPT', 503);
    }
  }

  async writeAll(data) {
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const temporary = `${this.filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
      await fs.writeFile(temporary, `${JSON.stringify(data)}\n`, { mode: 0o600 });
      await fs.rename(temporary, this.filePath);
    } catch {
      throw new BrokerError('STATE_STORE_UNAVAILABLE', 503);
    }
  }
}

class PrivateBrokerService {
  constructor({ store, secretStore, audit = new SafeAudit(), now = () => Date.now(), leaseMs = 120000 }) {
    this.store = store;
    this.secretStore = secretStore;
    this.audit = audit;
    this.now = now;
    this.leaseMs = leaseMs;
  }

  async prepareSyntheticOperation({ operationAlias, secretVersionAlias }) {
    requireAlias(operationAlias, 'INVALID_OPERATION_ALIAS');
    requireAlias(secretVersionAlias, 'INVALID_SECRET_VERSION_ALIAS');
    const nowIso = new Date(this.now()).toISOString();
    const result = await this.store.transact((data) => {
      const existing = data.operations[operationAlias];
      if (existing) {
        if (existing.secret_version_alias !== secretVersionAlias) {
          throw new BrokerError('OPERATION_ALIAS_CONFLICT', 409);
        }
        return publicOperation(existing);
      }
      const operation = {
        operation_id: operationAlias,
        state: 'READY',
        lease_alias: null,
        lease_owner_alias: null,
        lease_expires_at: null,
        attempt_count: 0,
        acknowledged: false,
        created_at: nowIso,
        updated_at: nowIso,
        safe_error_code: null,
        secret_version_alias: secretVersionAlias,
      };
      data.operations[operationAlias] = operation;
      return publicOperation(operation);
    });
    this.audit.record({ event: 'operation_prepared', operationAlias, state: result.state, status: 201 });
    return result;
  }

  async poll(principalAlias) {
    requireAlias(principalAlias, 'INVALID_PRINCIPAL_ALIAS');
    const operation = await this.store.readOnly((data) => {
      const candidates = Object.values(data.operations)
        .filter((item) => item.state !== TERMINAL_STATE)
        .sort((left, right) => left.created_at.localeCompare(right.created_at));
      return candidates.length ? publicOperation(candidates[0]) : null;
    });
    this.audit.record({
      event: 'operation_polled',
      operationAlias: operation ? operation.operation_alias : null,
      state: operation ? operation.state : null,
    });
    return operation;
  }

  async lease(principalAlias, operationAlias) {
    requireAlias(principalAlias, 'INVALID_PRINCIPAL_ALIAS');
    requireAlias(operationAlias, 'INVALID_OPERATION_ALIAS');
    const nowMs = this.now();
    const result = await this.store.transact((data) => {
      const operation = data.operations[operationAlias];
      if (!operation) throw new BrokerError('OPERATION_NOT_FOUND', 404);
      if (operation.state === TERMINAL_STATE) throw new BrokerError('OPERATION_ALREADY_ACKNOWLEDGED', 409);

      const activeLease = operation.lease_alias && Date.parse(operation.lease_expires_at) > nowMs;
      if (activeLease) {
        if (operation.lease_owner_alias !== principalAlias) {
          throw new BrokerError('LEASE_HELD_BY_OTHER', 409);
        }
        return publicOperation(operation);
      }

      operation.state = 'LEASED';
      operation.lease_alias = `lease_${crypto.randomUUID()}`;
      operation.lease_owner_alias = principalAlias;
      operation.lease_expires_at = new Date(nowMs + this.leaseMs).toISOString();
      operation.updated_at = new Date(nowMs).toISOString();
      operation.safe_error_code = null;
      return publicOperation(operation);
    });
    this.audit.record({ event: 'lease_granted', operationAlias, state: result.state });
    return result;
  }

  async redeem(principalAlias, operationAlias, leaseAlias) {
    requireAlias(principalAlias, 'INVALID_PRINCIPAL_ALIAS');
    requireAlias(operationAlias, 'INVALID_OPERATION_ALIAS');
    requireAlias(leaseAlias, 'INVALID_LEASE_ALIAS');
    const nowMs = this.now();
    const operation = await this.store.transact((data) => {
      const item = data.operations[operationAlias];
      this.assertActiveLease(item, principalAlias, leaseAlias, nowMs);
      if (item.state === 'REDEEMED') {
        throw new BrokerError('LEASE_ALREADY_REDEEMED', 409);
      }
      item.state = 'REDEEMED';
      item.attempt_count += 1;
      item.updated_at = new Date(nowMs).toISOString();
      item.safe_error_code = null;
      return clone(item);
    });
    const syntheticPayload = await this.secretStore.access(operation.secret_version_alias);
    this.audit.record({ event: 'secret_redeemed', operationAlias, state: operation.state });
    return {
      operation_alias: operationAlias,
      lease_alias: leaseAlias,
      expires_at: operation.lease_expires_at,
      synthetic_payload: syntheticPayload,
    };
  }

  async acknowledge(principalAlias, operationAlias, leaseAlias) {
    requireAlias(principalAlias, 'INVALID_PRINCIPAL_ALIAS');
    requireAlias(operationAlias, 'INVALID_OPERATION_ALIAS');
    requireAlias(leaseAlias, 'INVALID_LEASE_ALIAS');
    const nowMs = this.now();
    const result = await this.store.transact((data) => {
      const operation = data.operations[operationAlias];
      if (!operation) throw new BrokerError('OPERATION_NOT_FOUND', 404);
      if (operation.state === TERMINAL_STATE) {
        if (operation.lease_owner_alias !== principalAlias || operation.lease_alias !== leaseAlias) {
          throw new BrokerError('LEASE_INVALID', 409);
        }
        return publicOperation(operation);
      }
      if (operation.state !== 'REDEEMED') {
        this.assertActiveLease(operation, principalAlias, leaseAlias, nowMs);
        throw new BrokerError('ACK_BEFORE_REDEEM', 409);
      }
      if (operation.lease_owner_alias !== principalAlias || operation.lease_alias !== leaseAlias) {
        throw new BrokerError('LEASE_INVALID', 409);
      }
      operation.state = TERMINAL_STATE;
      operation.acknowledged = true;
      operation.updated_at = new Date(nowMs).toISOString();
      operation.safe_error_code = null;
      return publicOperation(operation);
    });
    this.audit.record({ event: 'operation_acknowledged', operationAlias, state: result.state });
    return result;
  }

  async status(principalAlias, operationAlias) {
    requireAlias(principalAlias, 'INVALID_PRINCIPAL_ALIAS');
    requireAlias(operationAlias, 'INVALID_OPERATION_ALIAS');
    return this.store.readOnly((data) => {
      const operation = data.operations[operationAlias];
      if (!operation) throw new BrokerError('OPERATION_NOT_FOUND', 404);
      return publicOperation(operation);
    });
  }

  assertActiveLease(operation, principalAlias, leaseAlias, nowMs) {
    if (!operation) throw new BrokerError('OPERATION_NOT_FOUND', 404);
    if (operation.state === TERMINAL_STATE) throw new BrokerError('OPERATION_ALREADY_ACKNOWLEDGED', 409);
    if (operation.lease_owner_alias !== principalAlias || operation.lease_alias !== leaseAlias) {
      throw new BrokerError('LEASE_INVALID', 409);
    }
    if (!operation.lease_expires_at || Date.parse(operation.lease_expires_at) <= nowMs) {
      throw new BrokerError('LEASE_EXPIRED', 409);
    }
  }
}

module.exports = {
  BrokerError,
  DurableOperationStore,
  PrivateBrokerService,
  SafeAudit,
  SyntheticSecretStore,
};

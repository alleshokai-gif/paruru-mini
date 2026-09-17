'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { PrivateBrokerService, SyntheticSecretStore } = require('../src/broker');
const { FirestoreOperationStore } = require('../src/firestore-operation-store');
const { GoogleSyntheticSecretStore } = require('../src/google-secret-store');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class FakeFirestore {
  constructor() {
    this.documents = new Map();
    this.queue = Promise.resolve();
  }

  collection(name) {
    const firestore = this;
    return {
      name,
      doc(id) { return { collection: name, id }; },
      limit(limit) {
        return {
          limit,
          async get() { return firestore.snapshot(limit); },
        };
      },
    };
  }

  snapshot(limit) {
    return {
      docs: [...this.documents.entries()].slice(0, limit).map(([id, value]) => ({
        id,
        data: () => clone(value),
      })),
    };
  }

  async runTransaction(callback) {
    const pending = this.queue.then(async () => {
      const writes = [];
      const transaction = {
        get: async (query) => this.snapshot(query.limit),
        set: (reference, value) => writes.push([reference.id, clone(value)]),
      };
      const result = await callback(transaction);
      for (const [id, value] of writes) this.documents.set(id, value);
      return result;
    });
    this.queue = pending.catch(() => undefined);
    return pending;
  }
}

test('two broker instances share one atomic Firestore lease winner', async () => {
  const firestore = new FakeFirestore();
  const operationAlias = `op_${crypto.randomUUID()}`;
  const versionAlias = `ver_${crypto.randomUUID()}`;
  const payload = `payload_${crypto.randomUUID()}`;
  const makeBroker = () => new PrivateBrokerService({
    store: new FirestoreOperationStore({ firestore, collectionName: 'poc_operations' }),
    secretStore: new SyntheticSecretStore({ [versionAlias]: payload }),
    now: () => 1900000000000,
  });
  const firstBroker = makeBroker();
  const secondBroker = makeBroker();
  await firstBroker.prepareSyntheticOperation({ operationAlias, secretVersionAlias: versionAlias });
  const leases = await Promise.allSettled([
    firstBroker.lease('caller_a', operationAlias),
    secondBroker.lease('caller_b', operationAlias),
  ]);
  assert.equal(leases.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(leases.filter((item) => item.status === 'rejected').length, 1);
  assert.equal(leases.find((item) => item.status === 'rejected').reason.code, 'LEASE_HELD_BY_OTHER');
  assert.equal((await secondBroker.status('caller_b', operationAlias)).state, 'LEASED');
});

test('Firestore adapter rejects forbidden persisted fields', async () => {
  const firestore = new FakeFirestore();
  firestore.documents.set('op_bad', {
    operation_id: 'op_bad',
    state: 'READY',
    forbidden_payload: 'must-not-exist',
  });
  const store = new FirestoreOperationStore({ firestore, collectionName: 'poc_operations' });
  await assert.rejects(
    store.readOnly((data) => data),
    (error) => error && error.code === 'STATE_STORE_FORBIDDEN_FIELD',
  );
});

test('Google Secret Manager adapter returns payload without exposing provider failures', async () => {
  const payload = `payload_${crypto.randomUUID()}`;
  const calls = [];
  const store = new GoogleSyntheticSecretStore({
    client: {
      accessSecretVersion: async (request) => {
        calls.push(request.name);
        return [{ payload: { data: Buffer.from(payload) } }];
      },
    },
    projectId: 'isolated-poc-project',
    secretId: 'synthetic-poc-secret',
  });
  assert.equal(await store.access('1'), payload);
  assert.equal(calls.length, 1);

  const unavailable = new GoogleSyntheticSecretStore({
    client: { accessSecretVersion: async () => { throw new Error('provider detail'); } },
    projectId: 'isolated-poc-project',
    secretId: 'synthetic-poc-secret',
  });
  await assert.rejects(
    unavailable.access('1'),
    (error) => error && error.code === 'SYNTHETIC_SECRET_UNAVAILABLE' && !error.message.includes('provider detail'),
  );
});

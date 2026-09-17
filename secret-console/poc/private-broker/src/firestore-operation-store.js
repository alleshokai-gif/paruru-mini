'use strict';

const { BrokerError } = require('./broker');

const SAFE_COLLECTION = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;
const SAFE_OPERATION_FIELDS = new Set([
  'operation_id',
  'state',
  'lease_alias',
  'lease_owner_alias',
  'lease_expires_at',
  'attempt_count',
  'acknowledged',
  'created_at',
  'updated_at',
  'safe_error_code',
  'secret_version_alias',
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validateDocument(documentId, operation) {
  if (!operation || operation.operation_id !== documentId) {
    throw new BrokerError('STATE_STORE_CORRUPT', 503);
  }
  if (Object.keys(operation).some((field) => !SAFE_OPERATION_FIELDS.has(field))) {
    throw new BrokerError('STATE_STORE_FORBIDDEN_FIELD', 503);
  }
}

class FirestoreOperationStore {
  constructor({ firestore, collectionName, maxOperations = 100 }) {
    if (!firestore || typeof firestore.runTransaction !== 'function') {
      throw new TypeError('firestore client is required');
    }
    if (typeof collectionName !== 'string' || !SAFE_COLLECTION.test(collectionName)) {
      throw new TypeError('safe collectionName is required');
    }
    if (!Number.isInteger(maxOperations) || maxOperations < 1 || maxOperations > 1000) {
      throw new TypeError('maxOperations is invalid');
    }
    this.firestore = firestore;
    this.collection = firestore.collection(collectionName);
    this.maxOperations = maxOperations;
  }

  async transact(mutator) {
    try {
      return await this.firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(this.collection.limit(this.maxOperations + 1));
        const data = this.snapshotToData(snapshot);
        const result = await mutator(data);
        for (const [documentId, operation] of Object.entries(data.operations)) {
          validateDocument(documentId, operation);
          transaction.set(this.collection.doc(documentId), clone(operation));
        }
        return clone(result);
      });
    } catch (error) {
      if (error instanceof BrokerError) throw error;
      throw new BrokerError('STATE_STORE_UNAVAILABLE', 503);
    }
  }

  async readOnly(reader) {
    try {
      const snapshot = await this.collection.limit(this.maxOperations + 1).get();
      return clone(await reader(this.snapshotToData(snapshot)));
    } catch (error) {
      if (error instanceof BrokerError) throw error;
      throw new BrokerError('STATE_STORE_UNAVAILABLE', 503);
    }
  }

  snapshotToData(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.docs)) {
      throw new BrokerError('STATE_STORE_CORRUPT', 503);
    }
    if (snapshot.docs.length > this.maxOperations) {
      throw new BrokerError('STATE_STORE_CAPACITY_EXCEEDED', 503);
    }
    const operations = {};
    for (const document of snapshot.docs) {
      const operation = document.data();
      validateDocument(document.id, operation);
      operations[document.id] = clone(operation);
    }
    return { schema_version: 1, operations };
  }
}

module.exports = { FirestoreOperationStore };

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const crypto = require('node:crypto');
const {
  DurableOperationStore,
  PrivateBrokerService,
  SafeAudit,
  SyntheticSecretStore,
} = require('../src/broker');

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'paluru-broker-poc-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let nowMs = 1900000000000;
  const operationAlias = `op_${crypto.randomUUID()}`;
  const versionAlias = `ver_${crypto.randomUUID()}`;
  const payload = `payload_${crypto.randomUUID()}`;
  const filePath = path.join(directory, 'safe-state.json');
  const store = new DurableOperationStore(filePath);
  const secretStore = new SyntheticSecretStore({ [versionAlias]: payload });
  const audit = new SafeAudit();
  const broker = new PrivateBrokerService({
    store,
    secretStore,
    audit,
    now: () => nowMs,
    leaseMs: 1000,
  });
  await broker.prepareSyntheticOperation({ operationAlias, secretVersionAlias: versionAlias });
  return {
    broker,
    store,
    secretStore,
    audit,
    filePath,
    operationAlias,
    versionAlias,
    payload,
    advance: (milliseconds) => { nowMs += milliseconds; },
    now: () => nowMs,
  };
}

async function rejectsCode(promise, code) {
  await assert.rejects(promise, (error) => error && error.code === code);
}

test('poll, lease, one-time redeem, ACK, and reconciliation status', async (t) => {
  const f = await fixture(t);
  const polled = await f.broker.poll('owner_binding');
  assert.equal(polled.operation_alias, f.operationAlias);
  assert.equal(polled.state, 'READY');

  const leased = await f.broker.lease('owner_binding', f.operationAlias);
  assert.equal(leased.state, 'LEASED');
  const retriedLease = await f.broker.lease('owner_binding', f.operationAlias);
  assert.equal(retriedLease.lease_alias, leased.lease_alias);
  await rejectsCode(
    f.broker.acknowledge('owner_binding', f.operationAlias, leased.lease_alias),
    'ACK_BEFORE_REDEEM',
  );

  const redeemed = await f.broker.redeem('owner_binding', f.operationAlias, leased.lease_alias);
  assert.equal(redeemed.synthetic_payload, f.payload);
  await rejectsCode(
    f.broker.redeem('owner_binding', f.operationAlias, leased.lease_alias),
    'LEASE_ALREADY_REDEEMED',
  );

  const acknowledged = await f.broker.acknowledge('owner_binding', f.operationAlias, leased.lease_alias);
  assert.equal(acknowledged.state, 'APPLIED_ACKNOWLEDGED');
  assert.equal(acknowledged.acknowledged, true);
  assert.equal((await f.broker.poll('owner_binding')), null);
  assert.equal((await f.broker.status('owner_binding', f.operationAlias)).attempt_count, 1);
  await rejectsCode(
    f.broker.redeem('owner_binding', f.operationAlias, leased.lease_alias),
    'OPERATION_ALREADY_ACKNOWLEDGED',
  );
});

test('expired lease rejects old redemption and permits same-operation re-lease', async (t) => {
  const f = await fixture(t);
  const first = await f.broker.lease('owner_binding', f.operationAlias);
  f.advance(1001);
  await rejectsCode(
    f.broker.redeem('owner_binding', f.operationAlias, first.lease_alias),
    'LEASE_EXPIRED',
  );
  const second = await f.broker.lease('owner_binding', f.operationAlias);
  assert.notEqual(second.lease_alias, first.lease_alias);
  await rejectsCode(
    f.broker.redeem('owner_binding', f.operationAlias, first.lease_alias),
    'LEASE_INVALID',
  );
  assert.equal((await f.broker.redeem('owner_binding', f.operationAlias, second.lease_alias)).synthetic_payload, f.payload);
});

test('parallel different callers produce one lease winner and no takeover', async (t) => {
  const f = await fixture(t);
  const settled = await Promise.allSettled([
    f.broker.lease('caller_a', f.operationAlias),
    f.broker.lease('caller_b', f.operationAlias),
  ]);
  assert.equal(settled.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(settled.filter((item) => item.status === 'rejected').length, 1);
  const failure = settled.find((item) => item.status === 'rejected');
  assert.equal(failure.reason.code, 'LEASE_HELD_BY_OTHER');
});

test('safe metadata survives broker restart while payload stays external', async (t) => {
  const f = await fixture(t);
  const lease = await f.broker.lease('owner_binding', f.operationAlias);
  const restarted = new PrivateBrokerService({
    store: new DurableOperationStore(f.filePath),
    secretStore: f.secretStore,
    now: f.now,
    leaseMs: 1000,
  });
  const recovered = await restarted.status('owner_binding', f.operationAlias);
  assert.equal(recovered.lease_alias, lease.lease_alias);
  assert.equal(recovered.state, 'LEASED');
  const persisted = await fs.readFile(f.filePath, 'utf8');
  assert.equal(persisted.includes(f.payload), false);
});

test('temporary durable-state failure fails closed without exposing payload', async (t) => {
  const f = await fixture(t);
  f.store.failNext();
  await rejectsCode(f.broker.poll('owner_binding'), 'STATE_STORE_UNAVAILABLE');
  const recovered = await f.broker.poll('owner_binding');
  assert.equal(recovered.operation_alias, f.operationAlias);
  assert.equal(JSON.stringify(f.audit.entries).includes(f.payload), false);
});

'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const {
  DurableOperationStore,
  PrivateBrokerService,
  SafeAudit,
  SyntheticSecretStore,
} = require('../src/broker');
const { createHttpHandler } = require('../src/http-app');
const { OidcVerifier } = require('../src/oidc-verifier');
const { makeSigningFixture, signJwt } = require('./helpers');
const {
  POC_BROKER_KEYS_: KEYS,
  pocIdentityBindingMetadata_,
  pocPrivateBrokerTick_,
  pocPrivateBrokerTickWithDeps_: runTick,
} = require('../apps-script/Code');

function makeSynchronousTransport() {
  const payload = `runtime_payload_${crypto.randomUUID()}`;
  const operationAlias = `op_${crypto.randomUUID()}`;
  let state = 'READY';
  let leaseNumber = 0;
  let leaseAlias = null;
  let leaseExpiresAt = 0;
  let now = 1000;
  let acknowledged = false;
  let redeemCount = 0;
  let ackCount = 0;
  let failAckOnce = false;

  return {
    payload,
    operationAlias,
    request(route, body) {
      if (route === '/v1/operations/poll') {
        return { operation: acknowledged ? null : { operation_alias: operationAlias, state } };
      }
      if (route === '/v1/operations/lease') {
        assert.equal(body.operation_alias, operationAlias);
        if (!leaseAlias || now >= leaseExpiresAt) {
          leaseNumber += 1;
          leaseAlias = `lease_${leaseNumber}`;
          leaseExpiresAt = now + 100;
          state = 'LEASED';
        }
        return { operation: { operation_alias: operationAlias, lease_alias: leaseAlias, state } };
      }
      if (route === '/v1/operations/redeem') {
        assert.equal(body.lease_alias, leaseAlias);
        if (now >= leaseExpiresAt) throw new Error('LEASE_EXPIRED');
        if (state === 'REDEEMED') throw new Error('LEASE_ALREADY_REDEEMED');
        state = 'REDEEMED';
        redeemCount += 1;
        return { operation_alias: operationAlias, lease_alias: leaseAlias, synthetic_payload: payload };
      }
      if (route === '/v1/operations/ack') {
        assert.equal(body.lease_alias, leaseAlias);
        ackCount += 1;
        if (failAckOnce) {
          failAckOnce = false;
          throw new Error('ACK_TRANSPORT_FAILED');
        }
        acknowledged = true;
        state = 'APPLIED_ACKNOWLEDGED';
        return { operation: { operation_alias: operationAlias, state, acknowledged: true } };
      }
      throw new Error('UNEXPECTED_ROUTE');
    },
    advance(milliseconds) { now += milliseconds; },
    failNextAck() { failAckOnce = true; },
    counts() { return { redeemCount, ackCount, leaseNumber }; },
  };
}

function makeTriggerDeps(transport, hookPlan = {}) {
  const properties = new Map();
  const slotWrites = { A: 0, B: 0 };
  const hooks = {};
  for (const [name, remaining] of Object.entries(hookPlan)) {
    let count = remaining;
    hooks[name] = () => {
      if (count > 0) {
        count -= 1;
        throw new Error(`SIMULATED_${name.toUpperCase()}_CRASH`);
      }
    };
  }
  return {
    deps: {
      get: (key) => properties.has(key) ? properties.get(key) : null,
      setMany: (values) => {
        for (const [key, value] of Object.entries(values)) {
          if (key === KEYS.SLOT_A && properties.get(key) !== value) slotWrites.A += 1;
          if (key === KEYS.SLOT_B && properties.get(key) !== value) slotWrites.B += 1;
          properties.set(key, value);
        }
      },
      deleteMany: (keys) => keys.forEach((key) => properties.delete(key)),
      request: (route, body) => transport.request(route, body),
      hooks,
    },
    properties,
    slotWrites,
  };
}

test('every HTTP endpoint authenticates before routing and safe logs omit sensitive input', async (t) => {
  const directory = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'paluru-http-poc-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const signing = makeSigningFixture();
  const audience = `aud_${crypto.randomUUID()}`;
  const ownerSubject = `sub_${crypto.randomUUID()}`;
  const ownerSubjectSha256 = crypto.createHash('sha256').update(ownerSubject).digest('hex');
  const syntheticPayload = `payload_${crypto.randomUUID()}`;
  const operationAlias = `op_${crypto.randomUUID()}`;
  const versionAlias = `ver_${crypto.randomUUID()}`;
  const token = signJwt({
    privateKey: signing.privateKey,
    kid: signing.kid,
    claims: {
      iss: 'accounts.google.com',
      aud: audience,
      sub: ownerSubject,
      iat: 1899999990,
      exp: 1900000300,
    },
  });
  const verifier = new OidcVerifier({
    audience,
    ownerSubjectSha256,
    keyProvider: { getKey: async () => signing.publicJwk },
    now: () => 1900000000000,
    clockSkewSeconds: 0,
  });
  const audit = new SafeAudit();
  const broker = new PrivateBrokerService({
    store: new DurableOperationStore(path.join(directory, 'state.json')),
    secretStore: new SyntheticSecretStore({ [versionAlias]: syntheticPayload }),
    audit,
    now: () => 1900000000000,
  });
  await broker.prepareSyntheticOperation({ operationAlias, secretVersionAlias: versionAlias });
  const logs = [];
  const server = http.createServer(createHttpHandler({ verifier, broker, logger: (entry) => logs.push(entry) }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const anonymous = await fetch(`${baseUrl}/v1/operations/poll`, { method: 'POST', body: '{}' });
  assert.equal(anonymous.status, 401);
  const unknownAnonymous = await fetch(`${baseUrl}/not-a-route`, { method: 'POST', body: '{}' });
  assert.equal(unknownAnonymous.status, 401);
  const malformed = await fetch(`${baseUrl}/v1/operations/poll`, {
    method: 'POST',
    headers: { authorization: 'Bearer malformed' },
    body: '{}',
  });
  assert.equal(malformed.status, 401);

  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const pollResponse = await fetch(`${baseUrl}/v1/operations/poll`, { method: 'POST', headers, body: '{}' });
  assert.equal(pollResponse.status, 200);
  const polled = await pollResponse.json();
  assert.equal(polled.operation.operation_alias, operationAlias);
  const leaseResponse = await fetch(`${baseUrl}/v1/operations/lease`, {
    method: 'POST', headers, body: JSON.stringify({ operation_alias: operationAlias }),
  });
  const leased = await leaseResponse.json();
  const leaseAlias = leased.operation.lease_alias;
  const redeemResponse = await fetch(`${baseUrl}/v1/operations/redeem`, {
    method: 'POST', headers, body: JSON.stringify({ operation_alias: operationAlias, lease_alias: leaseAlias }),
  });
  const redeemed = await redeemResponse.json();
  assert.equal(redeemed.synthetic_payload, syntheticPayload);
  const ackResponse = await fetch(`${baseUrl}/v1/operations/ack`, {
    method: 'POST', headers, body: JSON.stringify({ operation_alias: operationAlias, lease_alias: leaseAlias }),
  });
  assert.equal(ackResponse.status, 200);
  const statusResponse = await fetch(`${baseUrl}/v1/operations/${operationAlias}/status`, { headers });
  assert.equal(statusResponse.status, 200);

  const safeLogs = JSON.stringify({ logs, audit: audit.entries });
  assert.equal(safeLogs.includes(syntheticPayload), false);
  assert.equal(safeLogs.includes(token), false);
  assert.equal(safeLogs.includes(ownerSubject), false);
});

test('duplicate trigger applies the synthetic value once', () => {
  const transport = makeSynchronousTransport();
  const trigger = makeTriggerDeps(transport);
  assert.equal(runTick(trigger.deps).code, 'APPLIED_ACKNOWLEDGED');
  assert.equal(runTick(trigger.deps).code, 'NO_OPERATION');
  assert.equal(trigger.slotWrites.A + trigger.slotWrites.B, 1);
  assert.equal(transport.counts().redeemCount, 1);
});

test('lost ACK retries the saved lease after expiry without re-leasing, reapplying, or redeeming', () => {
  const transport = makeSynchronousTransport();
  const trigger = makeTriggerDeps(transport);
  transport.failNextAck();
  assert.throws(() => runTick(trigger.deps), /ACK_TRANSPORT_FAILED/);
  transport.advance(101);
  assert.equal(runTick(trigger.deps).code, 'ACK_RECONCILED');
  assert.equal(trigger.slotWrites.A + trigger.slotWrites.B, 1);
  assert.equal(transport.counts().redeemCount, 1);
  assert.deepEqual(transport.counts(), { redeemCount: 1, ackCount: 2, leaseNumber: 1 });
});

test('crash immediately after redeem recovers after lease timeout with the same operation', () => {
  const transport = makeSynchronousTransport();
  const trigger = makeTriggerDeps(transport, { afterRedeem: 1 });
  assert.throws(() => runTick(trigger.deps), /SIMULATED_AFTERREDEEM_CRASH/);
  assert.throws(() => runTick(trigger.deps), /LEASE_ALREADY_REDEEMED/);
  transport.advance(101);
  assert.equal(runTick(trigger.deps).code, 'APPLIED_ACKNOWLEDGED');
  assert.equal(trigger.slotWrites.A + trigger.slotWrites.B, 1);
  assert.deepEqual(transport.counts(), { redeemCount: 2, ackCount: 1, leaseNumber: 2 });
});

test('crash after slot write resumes without a second redeem or slot write', () => {
  const transport = makeSynchronousTransport();
  const trigger = makeTriggerDeps(transport, { afterSlotWrite: 1 });
  assert.throws(() => runTick(trigger.deps), /SIMULATED_AFTERSLOTWRITE_CRASH/);
  assert.equal(runTick(trigger.deps).code, 'APPLIED_ACKNOWLEDGED');
  assert.equal(trigger.slotWrites.A + trigger.slotWrites.B, 1);
  assert.equal(transport.counts().redeemCount, 1);
});

test('crash after apply and before ACK reconciles by ACK only', () => {
  const transport = makeSynchronousTransport();
  const trigger = makeTriggerDeps(transport, { beforeAck: 1 });
  assert.throws(() => runTick(trigger.deps), /SIMULATED_BEFOREACK_CRASH/);
  assert.equal(runTick(trigger.deps).code, 'ACK_RECONCILED');
  assert.equal(trigger.slotWrites.A + trigger.slotWrites.B, 1);
  assert.equal(transport.counts().redeemCount, 1);
});

test('ScriptLock rejects an overlapping invocation before token or transport access', () => {
  const original = global.LockService;
  let released = false;
  global.LockService = {
    getScriptLock: () => ({
      tryLock: () => false,
      releaseLock: () => { released = true; },
    }),
  };
  try {
    assert.deepEqual(pocPrivateBrokerTick_(), { success: false, code: 'TRIGGER_BUSY' });
    assert.equal(released, false);
  } finally {
    if (original === undefined) delete global.LockService;
    else global.LockService = original;
  }
});

test('identity bootstrap returns audience and subject digest without raw token or subject', () => {
  const originalScriptApp = global.ScriptApp;
  const originalUtilities = global.Utilities;
  const audience = `aud_${crypto.randomUUID()}`;
  const subject = `sub_${crypto.randomUUID()}`;
  const claims = {
    iss: 'https://accounts.google.com',
    aud: audience,
    sub: subject,
    iat: 1899999990,
    exp: 1900000300,
  };
  const token = `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
  global.ScriptApp = { getIdentityToken: () => token };
  global.Utilities = {
    base64DecodeWebSafe: (value) => Buffer.from(value, 'base64url'),
    newBlob: (value) => ({ getDataAsString: () => Buffer.from(value).toString('utf8') }),
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    Charset: { UTF_8: 'UTF_8' },
    computeDigest: (_algorithm, value) => [...crypto.createHash('sha256').update(value).digest()]
      .map((byte) => byte > 127 ? byte - 256 : byte),
  };
  try {
    const metadata = pocIdentityBindingMetadata_();
    assert.equal(metadata.audience, audience);
    assert.equal(metadata.owner_subject_sha256, crypto.createHash('sha256').update(subject).digest('hex'));
    const serialized = JSON.stringify(metadata);
    assert.equal(serialized.includes(subject), false);
    assert.equal(serialized.includes(token), false);
    assert.equal(Object.hasOwn(metadata, 'email'), false);
  } finally {
    if (originalScriptApp === undefined) delete global.ScriptApp;
    else global.ScriptApp = originalScriptApp;
    if (originalUtilities === undefined) delete global.Utilities;
    else global.Utilities = originalUtilities;
  }
});

test('production public Mini source has no route into the isolated broker flow', async () => {
  const productionCode = await fs.readFile(path.resolve(__dirname, '../../../../gas/Code.js'), 'utf8');
  assert.equal(productionCode.includes('pocPrivateBrokerTick_'), false);
  assert.equal(productionCode.includes('/v1/operations/redeem'), false);
  assert.equal(productionCode.includes('POC_PRIVATE_BROKER_URL'), false);
});

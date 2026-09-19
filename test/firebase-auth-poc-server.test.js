'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { lookupFirebaseAccount } = require('../scripts/firebase-auth-poc-server.js');

test('local PoC verifier classifies a Firebase transport failure as unavailable', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error('network unavailable'); };
  try {
    await assert.rejects(
      () => lookupFirebaseAccount('firebase-id-token', { webApiKey: 'public-web-api-key' }),
      (error) => error && error.code === 'AUTH_VERIFIER_UNAVAILABLE'
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('local PoC verifier returns the single Firebase account', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ users: [{ localId: 'firebase-father' }] }),
  });
  try {
    const account = await lookupFirebaseAccount('firebase-id-token', { webApiKey: 'public-web-api-key' });
    assert.equal(account.localId, 'firebase-father');
  } finally {
    global.fetch = originalFetch;
  }
});

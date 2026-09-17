'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const crypto = require('node:crypto');
const { OidcVerifier } = require('../src/oidc-verifier');
const { makeSigningFixture, signJwt } = require('./helpers');

const NOW_MS = 1900000000000;

function setup() {
  const signing = makeSigningFixture();
  const audience = `aud_${crypto.randomUUID()}`;
  const ownerSubject = `sub_${crypto.randomUUID()}`;
  const ownerSubjectSha256 = crypto.createHash('sha256').update(ownerSubject).digest('hex');
  const verifier = new OidcVerifier({
    audience,
    ownerSubjectSha256,
    keyProvider: { getKey: async () => signing.publicJwk },
    now: () => NOW_MS,
    clockSkewSeconds: 0,
  });
  const baseClaims = {
    iss: 'https://accounts.google.com',
    aud: audience,
    sub: ownerSubject,
    iat: Math.floor(NOW_MS / 1000) - 10,
    exp: Math.floor(NOW_MS / 1000) + 300,
  };
  const token = (overrides = {}, privateKey = signing.privateKey) => signJwt({
    privateKey,
    kid: signing.kid,
    claims: { ...baseClaims, ...overrides },
  });
  return { verifier, token, audience, ownerSubject };
}

async function rejectsCode(promise, code) {
  await assert.rejects(promise, (error) => error && error.code === code);
}

test('valid Google-style token produces only the stable owner alias', async () => {
  const { verifier, token } = setup();
  const first = await verifier.verifyAuthorization(`Bearer ${token()}`);
  const second = await verifier.verifyAuthorization(`Bearer ${token({ iat: Math.floor(NOW_MS / 1000) - 5 })}`);
  assert.deepEqual(first, { principalAlias: 'owner_binding' });
  assert.deepEqual(second, first);
  assert.equal(Object.keys(first).length, 1);
});

test('wrong issuer, audience, owner, and expired token are rejected', async () => {
  const { verifier, token } = setup();
  await rejectsCode(verifier.verifyAuthorization(`Bearer ${token({ iss: 'https://issuer.invalid' })}`), 'TOKEN_ISSUER_INVALID');
  await rejectsCode(verifier.verifyAuthorization(`Bearer ${token({ aud: `wrong_${crypto.randomUUID()}` })}`), 'TOKEN_AUDIENCE_INVALID');
  await rejectsCode(verifier.verifyAuthorization(`Bearer ${token({ sub: `wrong_${crypto.randomUUID()}` })}`), 'TOKEN_OWNER_INVALID');
  await rejectsCode(verifier.verifyAuthorization(`Bearer ${token({ exp: Math.floor(NOW_MS / 1000) - 1 })}`), 'TOKEN_EXPIRED');
});

test('missing, malformed, and invalid-signature tokens are rejected', async () => {
  const { verifier, token } = setup();
  await rejectsCode(verifier.verifyAuthorization(undefined), 'AUTH_REQUIRED');
  await rejectsCode(verifier.verifyAuthorization('Bearer not-a-jwt'), 'TOKEN_MALFORMED');
  const unrelated = makeSigningFixture();
  await rejectsCode(verifier.verifyAuthorization(`Bearer ${token({}, unrelated.privateKey)}`), 'TOKEN_SIGNATURE_INVALID');
});

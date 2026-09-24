'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const sources = [
  'gas/HomeMemberPolicy.js',
  'gas/HomeMembershipService.js',
  'gas/FirebaseAuthVerifier.js',
  'gas/HomeIdentityService.js',
  'gas/AuthenticatedActorService.js',
  'gas/PaluruUserAccountService.js',
].map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');

let clock = 1_800_000_000;
let lookupCount = 0;
let identityReadCount = 0;
let membershipReadCount = 0;
let lookupFailure = null;
const cacheValues = new Map();
const cache = {
  get: key => cacheValues.get(key) || null,
  put: (key, value) => cacheValues.set(key, String(value)),
  remove: key => cacheValues.delete(key),
};
const identities = [
  ['homeId', 'memberUserId', 'provider', 'providerSubject', 'status', 'createdAt', 'updatedAt'],
  ['family-home', 'father', 'firebase:paluru-auth-poc', 'firebase-father', 'active', '', ''],
];
const members = [
  ['homeId', 'memberUserId', 'displayName', 'role', 'status', 'createdAt', 'updatedAt'],
  ['family-home', 'father', '父', 'admin', 'active', '', ''],
];

function sheet(values, kind) {
  return {
    getLastColumn: () => values[0].length,
    getDataRange: () => {
      if (kind === 'identity') identityReadCount++;
      if (kind === 'membership') membershipReadCount++;
      return { getValues: () => values.map(row => row.slice()) };
    },
    getRange: (row, column, rowCount, columnCount) => ({
      getValues: () => values.slice(row - 1, row - 1 + rowCount).map(item => item.slice(column - 1, column - 1 + columnCount)),
    }),
  };
}

const context = {
  Date, JSON, Math, Number, Object, Array, String, RegExp, Error, encodeURIComponent,
  SpreadsheetApp: { getActiveSpreadsheet: () => ({
    getSheetByName(name) {
      if (name === 'Home_Identities') return sheet(identities, 'identity');
      if (name === 'Home_Members') return sheet(members, 'membership');
      return null;
    },
  }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => '' }) },
  json_: value => value,
  Utilities: {
    DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
    computeDigest: (_algorithm, value) => Array.from(crypto.createHash('sha256').update(String(value)).digest()),
    base64Decode: value => Array.from(Buffer.from(String(value), 'base64')),
    newBlob: bytes => ({ getDataAsString: () => Buffer.from(bytes).toString('utf8') }),
  },
};
vm.createContext(context);
new vm.Script(sources).runInContext(context);

function base64url(value) { return Buffer.from(JSON.stringify(value)).toString('base64url'); }
function token(version = 'a', expiresAt = clock + 3600) {
  const payload = {
    iss: 'https://securetoken.google.com/paluru-auth-poc', aud: 'paluru-auth-poc', sub: 'firebase-father',
    user_id: 'firebase-father', exp: expiresAt, iat: clock - 60, auth_time: clock - 120,
    firebase: { sign_in_provider: 'google.com' }, version,
  };
  return `${base64url({ alg: 'RS256', kid: 'test' })}.${base64url(payload)}.signature`;
}
function overrides() {
  return {
    cache,
    nowSeconds: () => clock,
    verifier: {
      config: { projectId: 'paluru-auth-poc', webApiKey: 'public-key' },
      nowSeconds: () => clock,
      lookupAccount: () => {
        lookupCount++;
        if (lookupFailure) throw lookupFailure;
        return { localId: 'firebase-father', disabled: false, validSince: String(clock - 3600), providerUserInfo: [{ providerId: 'google.com' }] };
      },
    },
  };
}
function body(idToken) { return { auth: { provider: 'firebase', idToken } }; }
function reset() {
  lookupCount = 0;
  identityReadCount = 0;
  membershipReadCount = 0;
  lookupFailure = null;
  cacheValues.clear();
}

reset();
const baselineToken = token('baseline');
context.resolveFirebaseAuthenticatedActor_(body(baselineToken), overrides());
context.resolveFirebaseAuthenticatedActor_(body(baselineToken), overrides());
const before = { identityToolkit: lookupCount, identitySheet: identityReadCount, membershipSheet: membershipReadCount };
assert.deepEqual(before, { identityToolkit: 2, identitySheet: 2, membershipSheet: 2 });

reset();
const reusedToken = token('reused');
context.resolveFirebaseAuthenticatedActorForRead_(body(reusedToken), overrides());
context.resolveFirebaseAuthenticatedActorForRead_(body(reusedToken), overrides());
const after = { identityToolkit: lookupCount, identitySheet: identityReadCount, membershipSheet: membershipReadCount };
assert.deepEqual(after, { identityToolkit: 1, identitySheet: 1, membershipSheet: 1 }, 'same read batch did not reuse the verified actor');
assert.equal(cacheValues.size, 1);
assert(![...cacheValues.keys()].some(key => key.includes(reusedToken)), 'raw token leaked into cache key');
assert(![...cacheValues.values()].some(value => value.includes(reusedToken)), 'raw token leaked into cached actor');

clock += 9;
context.resolveFirebaseAuthenticatedActorForRead_(body(reusedToken), overrides());
assert.equal(lookupCount, 2, 'TTL expiry did not force fresh verification');

const otherToken = token('other-token');
context.resolveFirebaseAuthenticatedActorForRead_(body(otherToken), overrides());
assert.equal(lookupCount, 3, 'different token fingerprint reused another token cache entry');

reset();
const logoutToken = token('logout');
context.resolveFirebaseAuthenticatedActorForRead_(body(logoutToken), overrides());
const invalidated = context.authSessionInvalidate_(body(logoutToken), overrides());
assert.equal(invalidated.success, true, 'authenticated logout invalidation route failed');
context.resolveFirebaseAuthenticatedActorForRead_(body(logoutToken), overrides());
assert.equal(lookupCount, 3, 'explicit logout invalidation did not perform fresh validation and force the next read fresh');

reset();
const revokedToken = token('revoked-member');
context.resolveFirebaseAuthenticatedActorForRead_(body(revokedToken), overrides());
members[1][4] = 'disabled';
const revoked = context.authSessionResolve_(body(revokedToken), null, overrides());
assert.equal(revoked.success, false, 'confirmed membership loss did not fail closed');
members[1][4] = 'active';
context.resolveFirebaseAuthenticatedActorForRead_(body(revokedToken), overrides());
assert.equal(lookupCount, 3, 'confirmed authorization loss did not invalidate the read cache');

reset();
const transientToken = token('transient');
lookupFailure = Object.assign(new Error('AUTH_VERIFIER_UNAVAILABLE'), { code: 'AUTH_VERIFIER_UNAVAILABLE' });
assert.throws(() => context.resolveFirebaseAuthenticatedActorForRead_(body(transientToken), overrides()), error => error.code === 'AUTH_VERIFIER_UNAVAILABLE');
lookupFailure = null;
context.resolveFirebaseAuthenticatedActorForRead_(body(transientToken), overrides());
assert.equal(lookupCount, 2, 'transient auth failure was cached');

reset();
const shortToken = token('short', clock + 3);
context.resolveFirebaseAuthenticatedActorForRead_(body(shortToken), overrides());
clock += 4;
assert.throws(() => context.resolveFirebaseAuthenticatedActorForRead_(body(shortToken), overrides()), error => error.code === 'AUTH_TOKEN_EXPIRED');
assert.equal(lookupCount, 1, 'token expiry hard cap performed another external lookup');

const progressSource = fs.readFileSync(path.join(root, 'gas', 'KazOsProgress.js'), 'utf8');
const answerSource = fs.readFileSync(path.join(root, 'gas', 'KazOsInboxAnswer.js'), 'utf8');
assert(progressSource.includes('resolveFirebaseAuthenticatedActorForRead_(input)'), 'Kaz reads do not use read-only actor reuse');
assert(answerSource.includes('resolveFirebaseAuthenticatedActor_(input)'), 'Kaz answer write no longer performs fresh actor resolution');
assert(!answerSource.includes('resolveFirebaseAuthenticatedActorForRead_'), 'Kaz answer write incorrectly shares read cache');

console.log(`PASS actor call-count evidence before=${JSON.stringify(before)} after=${JSON.stringify(after)} ttlSeconds=8`);

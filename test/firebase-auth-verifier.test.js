'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'gas', 'FirebaseAuthVerifier.js'), 'utf8');
const now = 1_800_000_000;

const context = {
  Date, JSON, Math, Number, Object, Array, String, RegExp, Error, encodeURIComponent,
  Utilities: {
    base64Decode: (value) => Array.from(Buffer.from(String(value), 'base64')),
    newBlob: (bytes) => ({ getDataAsString: () => Buffer.from(bytes).toString('utf8') }),
  },
};
vm.createContext(context);
new vm.Script(source).runInContext(context);

function assert(value, message) { if (!value) throw new Error(message); }
function base64url(value) { return Buffer.from(JSON.stringify(value)).toString('base64url'); }
function token(claims) { return `${base64url({ alg: 'RS256', kid: 'test' })}.${base64url(claims)}.signature`; }
function claims(overrides) {
  return Object.assign({
    iss: 'https://securetoken.google.com/paluru-auth-poc',
    aud: 'paluru-auth-poc',
    sub: 'firebase-father',
    user_id: 'firebase-father',
    exp: now + 3600,
    iat: now - 60,
    auth_time: now - 120,
    firebase: { sign_in_provider: 'google.com' },
  }, overrides || {});
}
function account(overrides) {
  return Object.assign({ localId: 'firebase-father', disabled: false, validSince: String(now - 3600), providerUserInfo: [{ providerId: 'google.com' }] }, overrides || {});
}
function verify(jwtClaims, accountValue) {
  return context.verifyFirebaseIdToken_(token(jwtClaims), {
    config: { projectId: 'paluru-auth-poc', webApiKey: 'public-web-api-key' },
    nowSeconds: () => now,
    lookupAccount: () => accountValue,
  });
}
function expectCode(expected, fn) {
  let actual = '';
  try { fn(); } catch (error) { actual = error.code; }
  assert(actual === expected, `expected ${expected}, got ${actual || 'no error'}`);
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('accepts a live Google Firebase user after account lookup', () => {
  const result = verify(claims(), account());
  assert(result.provider === 'firebase:paluru-auth-poc', 'provider namespace mismatch');
  assert(result.providerSubject === 'firebase-father', 'verified UID mismatch');
});
test('rejects a forged token when Firebase lookup rejects it', () => {
  expectCode('AUTH_TOKEN_INVALID', () => context.verifyFirebaseIdToken_(token(claims()), {
    config: { projectId: 'paluru-auth-poc', webApiKey: 'public-web-api-key' }, nowSeconds: () => now,
    lookupAccount: () => { throw Object.assign(new Error('invalid'), { code: 'AUTH_TOKEN_INVALID' }); },
  }));
});
test('rejects an expired token before lookup', () => expectCode('AUTH_TOKEN_EXPIRED', () => verify(claims({ exp: now - 61 }), account())));
test('rejects a token from the wrong Firebase project', () => expectCode('AUTH_PROJECT_MISMATCH', () => verify(claims({ aud: 'other-project' }), account())));
test('rejects a disabled Firebase user', () => expectCode('AUTH_USER_DISABLED', () => verify(claims(), account({ disabled: true }))));
test('rejects a session older than Firebase validSince', () => expectCode('AUTH_SESSION_REVOKED', () => verify(claims(), account({ validSince: String(now) }))));
test('rejects a non-Google sign-in provider', () => expectCode('AUTH_PROVIDER_NOT_ALLOWED', () => verify(claims({ firebase: { sign_in_provider: 'password' } }), account())));
test('rejects a UID mismatch between token and account lookup', () => expectCode('AUTH_UID_MISMATCH', () => verify(claims(), account({ localId: 'firebase-attacker' }))));
test('fails closed as unavailable on a Firebase lookup service failure', () => {
  context.UrlFetchApp = { fetch: () => ({ getResponseCode: () => 503, getContentText: () => '' }) };
  expectCode('AUTH_VERIFIER_UNAVAILABLE', () => context.lookupFirebaseAccount_('firebase-id-token', { webApiKey: 'public-web-api-key' }));
});
test('fails closed as unavailable when the Firebase lookup transport throws', () => {
  context.UrlFetchApp = { fetch: () => { throw new Error('network unavailable'); } };
  expectCode('AUTH_VERIFIER_UNAVAILABLE', () => context.lookupFirebaseAccount_('firebase-id-token', { webApiKey: 'public-web-api-key' }));
});
test('GAS account lookup posts the ID token to Identity Toolkit without returning extra users', () => {
  let request = null;
  context.UrlFetchApp = { fetch: (url, options) => {
    request = { url, options };
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ users: [account()] }) };
  } };
  const result = context.lookupFirebaseAccount_('firebase-id-token', { webApiKey: 'public-web-api-key' });
  assert(result.localId === 'firebase-father', 'lookup did not return the exact account');
  assert(request.url.includes('accounts:lookup?key='), 'wrong Identity Toolkit endpoint');
  assert(JSON.parse(request.options.payload).idToken === 'firebase-id-token', 'ID token was not sent in the request body');
  assert(request.options.muteHttpExceptions === true, 'GAS lookup cannot classify HTTP failures');
});

for (const item of tests) {
  try { item.fn(); console.log(`PASS ${item.name}`); }
  catch (error) { console.error(`FAIL ${item.name}: ${error.message}`); process.exitCode = 1; }
}
if (!process.exitCode) console.log(`PASS all ${tests.length} Firebase verifier tests`);

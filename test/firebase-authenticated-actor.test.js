'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const sources = [
  'gas/HomeMemberPolicy.js',
  'gas/HomeMembershipService.js',
  'gas/FirebaseAuthVerifier.js',
  'gas/HomeIdentityService.js',
  'gas/AuthenticatedActorService.js',
].map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
const now = 1_800_000_000;
let identityRows = [];
let memberRows = [];
const requestedSheets = [];

function makeSheet(values) {
  return {
    getLastColumn: () => values[0].length,
    getDataRange: () => ({ getValues: () => values.map((row) => row.slice()) }),
    getRange: (row, column, rowCount, columnCount) => ({
      getValues: () => values.slice(row - 1, row - 1 + rowCount).map((item) => item.slice(column - 1, column - 1 + columnCount)),
    }),
  };
}
function spreadsheet() {
  return {
    getSheetByName: (name) => {
      requestedSheets.push(name);
      if (name === 'Home_Identities') return makeSheet(identityRows);
      if (name === 'Home_Members') return makeSheet(memberRows);
      return null;
    },
  };
}
const context = {
  Date, JSON, Math, Number, Object, Array, String, RegExp, Error, encodeURIComponent,
  SpreadsheetApp: { getActiveSpreadsheet: spreadsheet },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => '' }) },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
    computeDigest: (_algorithm, value) => Array.from(crypto.createHash('sha256').update(String(value)).digest()),
    base64Decode: (value) => Array.from(Buffer.from(String(value), 'base64')),
    newBlob: (bytes) => ({ getDataAsString: () => Buffer.from(bytes).toString('utf8') }),
  },
};
vm.createContext(context);
new vm.Script(sources).runInContext(context);

function assert(value, message) { if (!value) throw new Error(message); }
function base64url(value) { return Buffer.from(JSON.stringify(value)).toString('base64url'); }
function token(uid) {
  const payload = {
    iss: 'https://securetoken.google.com/paluru-auth-poc', aud: 'paluru-auth-poc', sub: uid, user_id: uid,
    exp: now + 3600, iat: now - 60, auth_time: now - 120, firebase: { sign_in_provider: 'google.com' },
  };
  return `${base64url({ alg: 'RS256', kid: 'test' })}.${base64url(payload)}.signature`;
}
function rows() {
  identityRows = [
    ['homeId', 'memberUserId', 'provider', 'providerSubject', 'status', 'createdAt', 'updatedAt'],
    ['family-home', 'father', 'firebase:paluru-auth-poc', 'firebase-father', 'active', '', ''],
    ['family-home', 'second_son', 'firebase:paluru-auth-poc', 'firebase-second-son', 'active', '', ''],
  ];
  memberRows = [
    ['homeId', 'memberUserId', 'displayName', 'role', 'status', 'createdAt', 'updatedAt'],
    ['family-home', 'father', '父', 'admin', 'active', '', ''],
    ['family-home', 'second_son', '次男', 'self_record', 'active', '', ''],
  ];
  requestedSheets.length = 0;
}
function resolve(uid, clientFields) {
  return context.authPocResolve_(Object.assign({
    auth: { provider: 'firebase', idToken: token(uid) },
  }, clientFields || {}), {
    verifier: {
      config: { projectId: 'paluru-auth-poc', webApiKey: 'public-web-api-key' }, nowSeconds: () => now,
      lookupAccount: () => ({ localId: uid, disabled: false, validSince: String(now - 3600), providerUserInfo: [{ providerId: 'google.com' }] }),
    },
  });
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('maps Firebase UID to father and derives admin capability only on the server', () => {
  rows();
  const result = resolve('firebase-father', { memberUserId: 'second_son', role: 'self_record', capabilities: [] });
  assert(result.success && result.data.actor.memberUserId === 'father', 'verified father mapping was not authoritative');
  assert(result.data.actor.role === 'admin' && result.data.actor.canHomeControl, 'server role policy was not applied');
  assert(result.data.authentication.deviceIdUsed === false && result.data.authentication.pairingTokenUsed === false, 'device credential reached actor resolution');
  assert(result.data.authentication.deviceMembershipsUsed === false, 'Device_Memberships was used');
  assert(!requestedSheets.includes('Device_Memberships'), 'Device_Memberships sheet was read');
});

test('client cannot self-elevate a self_record member', () => {
  rows();
  const result = resolve('firebase-second-son', { memberUserId: 'father', role: 'admin', capabilities: ['home.control'] });
  assert(result.success && result.data.actor.memberUserId === 'second_son', 'client replaced mapped member');
  assert(result.data.actor.role === 'self_record' && result.data.actor.canHomeControl === false, 'client escalated privilege');
});

test('unmapped Firebase UID fails closed', () => {
  rows();
  const result = resolve('firebase-unmapped');
  assert(!result.success && result.error.code === 'IDENTITY_NOT_MAPPED', 'unmapped identity was accepted');
});

test('duplicate identity mapping fails closed', () => {
  rows();
  identityRows.push(['family-home', 'second_son', 'firebase:paluru-auth-poc', 'firebase-father', 'active', '', '']);
  const result = resolve('firebase-father');
  assert(!result.success && result.error.code === 'IDENTITY_MAPPING_CONFLICT', 'duplicate mapping was accepted');
});

test('disabled identity mapping fails closed', () => {
  rows();
  identityRows[1][4] = 'disabled';
  const result = resolve('firebase-father');
  assert(!result.success && result.error.code === 'IDENTITY_DISABLED', 'disabled mapping was accepted');
});

for (const item of tests) {
  try { item.fn(); console.log(`PASS ${item.name}`); }
  catch (error) { console.error(`FAIL ${item.name}: ${error.message}`); process.exitCode = 1; }
}
if (!process.exitCode) console.log(`PASS all ${tests.length} authenticated actor tests`);

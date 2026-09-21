'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const runtime = fs.readFileSync(path.join(root, 'features', 'auth', 'firebase-auth-runtime.js'), 'utf8');
const authCore = fs.readFileSync(path.join(root, 'features', 'auth', 'firebase-auth.js'), 'utf8');

assert(html.includes('id="authGoogleButton"'), 'GIS Google button host is missing');
assert(html.includes('id="authLogoutButton"') && html.includes('id="authAccountSwitchButton"'), 'logout/account switch controls are missing');
assert(app.includes('PALURUFirebaseAuthRuntime.create'), 'Firebase auth runtime is not initialized');
assert(app.includes('appAuthenticationState = "active_member"'), 'active Firebase member state is missing');
assert(app.includes('firebaseAuthService.getAuthEnvelope(false)'), 'ordinary API does not obtain a Firebase ID token');
assert(authCore.includes('persistence: firebase.browserLocalPersistence'), 'Firebase LOCAL persistence is missing');
assert(runtime.includes('accounts.google.com/gsi/client'), 'official GIS entry point is missing');
assert(runtime.includes("readOnlyRequest_(url, { action: 'auth.config.get' }"), 'auth config does not use the bounded read-only transport');
assert(runtime.includes("readOnlyRequest_(url, { action: 'auth.session.resolve', auth: auth }"), 'session resolve does not use the bounded read-only transport');
assert(runtime.includes("for (let attempt = 0; attempt < 2; attempt += 1)"), 'read-only auth transport retry budget must be exactly one retry');
assert(runtime.includes("response.status >= 500 && response.status <= 599"), 'transient 5xx retry boundary missing');
assert(runtime.includes("codedError_('TRANSPORT_FAILURE')"), 'transport failure classification missing');
assert(app.includes('PALURUサーバーに接続できませんでした。再試行しても復旧しませんでした。'), 'transport failure UI remains misclassified as authentication');

[
  'membership.context.get', 'deviceRegistrationBegin', 'devicePairingApprove',
  'devicePairingStatus', 'devicePairingList', 'devicePairingRevoke', 'pairingToken:',
  'HOME_CONTROL_PENDING_STORAGE_KEY', 'HOME_AGENT_PAIRING_TOKEN_STORAGE_KEY',
].forEach((value) => assert(!app.includes(value), `ordinary PWA retains legacy auth value: ${value}`));

['authLockUnpaired', 'authLockPending', 'authLockCode', 'homeControlApproveButton', 'homeControlDeviceList']
  .forEach((id) => assert(!html.includes(id), `legacy auth DOM remains: ${id}`));

console.log('PASS PWA Firebase authentication gate static boundaries');

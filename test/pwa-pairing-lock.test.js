'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const nurse = fs.readFileSync(path.join(root, 'features', 'nurse-okan', 'nurse-okan.js'), 'utf8');

assert(html.includes('id="authLock"') && html.includes('id="authGoogleButton"'), 'Firebase auth lock is missing');
assert(!nurse.includes('localStorage.getItem') && !nurse.includes('pairingToken'), 'Nurse Okan bypasses the authenticated facade');

[
  'getHomeControlPending', 'saveHomeControlPending', 'pollHomeControlPairing',
  'scheduleHomeControlPoll', 'createHomeControlToken', 'beginHomeControlPairing',
  'renderHomeControlSettings', 'getHomeAgentPairingToken', 'pairingToken:',
].forEach((value) => assert(!app.includes(value), `legacy pairing flow remains in ordinary PWA: ${value}`));

assert(app.includes('postAuthenticatedApi_'), 'shared Firebase-authenticated transport is missing');
assert(app.includes('cache: "no-store"'), 'authenticated API transport can be cached');
assert(app.includes('delete request[key]'), 'client identity sanitization is missing');

console.log('PASS PWA pairing lock is replaced by the Firebase session boundary');

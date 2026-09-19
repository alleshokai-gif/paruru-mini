'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const runtime = fs.readFileSync(path.join(root, 'features', 'auth', 'firebase-auth-runtime.js'), 'utf8');

[
  'membershipRegistrationBegin', 'membershipRegistrationStatus', 'beginMembershipRegistration',
  'pollMembershipRegistration', 'MEMBERSHIP_REGISTRATION_PENDING_STORAGE_KEY',
  'deviceRegistrationBegin', 'devicePairingApprove', 'devicePairingStatus',
].forEach((value) => {
  assert(!app.includes(value), `ordinary PWA still contains ${value}`);
  assert(!html.includes(value), `ordinary PWA DOM still contains ${value}`);
});

assert(runtime.includes('auth.session.resolve'), 'Firebase actor resolution route is missing');
assert(html.includes('Googleで続ける'), 'Google sign-in copy is missing');

console.log('PASS PWA has no registration or pairing state machine');

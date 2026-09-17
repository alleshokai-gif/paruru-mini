'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

[
  'membershipRegistrationBegin', 'membershipRegistrationStatus', 'beginMembershipRegistration',
  'pollMembershipRegistration', 'MEMBERSHIP_REGISTRATION_PENDING_STORAGE_KEY',
  'authLockMembershipBeginButton', 'authLockMembershipPending', 'authLockMembershipCode',
  'authLockMembershipExpiry', 'authLockMembershipMessage', 'authLockUnassigned',
].forEach((value) => {
  assert(!app.includes(value), `new PWA still contains ${value}`);
  assert(!html.includes(value), `new PWA DOM still contains ${value}`);
});

assert(app.includes('action: "deviceRegistrationBegin"'), 'new PWA does not use the minimal begin endpoint');
assert(!app.includes('action: "devicePairingBegin"'), 'new PWA still reaches the old begin action');

console.log('PASS PWA has no membership registration creation or polling path');

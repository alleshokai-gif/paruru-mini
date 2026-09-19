'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

['6桁', '承認コード', '端末を承認', 'homeControlMemberUserId', 'homeControlApproveCode']
  .forEach((value) => assert(!html.includes(value), `pairing approval UI remains: ${value}`));
['HOME_CONTROL_REGISTRATION_IDENTITIES', 'approveHomeControlPairing', 'devicePairingApprove']
  .forEach((value) => assert(!app.includes(value), `pairing approval implementation remains: ${value}`));

assert(app.includes('activeMembershipContext = null'), 'account transition does not clear member context');
assert(app.includes('sessionStorage.removeItem(AGENT_CHAT_SESSION_STORAGE_KEY)'), 'account transition does not clear Agent session context');

console.log('PASS PWA removes fixed-roster pairing approval and clears prior actor context');

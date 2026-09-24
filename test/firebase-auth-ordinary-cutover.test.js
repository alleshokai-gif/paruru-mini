'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const app = read('app.js');
const code = read('gas/Code.js');
const membership = read('gas/HomeMembershipService.js');
const actionSecurity = read('gas/HomeAgentActionSecurity.js');
const sw = read('sw.js');

function functionSource(source, name, nextMarker) {
  const start = source.indexOf(`function ${name}`);
  const end = source.indexOf(nextMarker, start);
  assert(start >= 0 && end > start, `source boundary missing: ${name}`);
  return source.slice(start, end);
}

[
  'gas/FamilyInboxGatewayService.js',
  'gas/HealthGatewayService.js',
  'gas/PetHealthGatewayService.js',
  'gas/KazOsInboxAnswer.js',
].forEach((relative) => {
  const source = read(relative);
  assert(source.includes('resolveFirebaseAuthenticatedActor_'), `${relative} does not use the Firebase actor resolver`);
  assert(!source.includes('resolveAuthenticatedActor_'), `${relative} still uses the device actor resolver`);
});
const kazRead = read('gas/KazOsProgress.js');
assert(kazRead.includes('resolveFirebaseAuthenticatedActorForRead_'), 'Kaz read does not use the Firebase read actor resolver');
assert(!kazRead.includes('resolveAuthenticatedActor_'), 'Kaz read still uses the device actor resolver');

const readActor = functionSource(membership, 'resolveHomeAgentReadActor_', 'function resolveHomeAgentControlActor_');
const controlActor = functionSource(membership, 'resolveHomeAgentControlActor_', 'function getMembershipContext_');
[readActor, controlActor].forEach((source) => {
  assert(source.includes('resolveFirebaseAuthenticatedActor_'), 'Home Agent actor is not Firebase-derived');
  assert(!/deviceId|pairingToken|Device_Memberships/.test(source), 'Home Agent ordinary actor uses device trust');
});

assert(code.indexOf('isLegacyDeviceAuthMutationAction_(action)') < code.indexOf("if (action === 'deviceRegistrationBegin')"), 'legacy mutation guard is after device dispatch');
const legacyGuard = functionSource(code, 'isLegacyDeviceAuthMutationAction_', 'function getInternalFatherMemoIdentity_');
['deviceRegistrationBegin', 'devicePairingApprove', 'devicePairingResume', 'devicePairingRevoke']
  .forEach((action) => assert(legacyGuard.includes(`'${action}'`), `legacy mutation is not read-only: ${action}`));
assert(!code.includes("if (action === 'authPocResolve')"), 'PoC auth route remains exposed');

assert((app.match(/pairingToken/g) || []).length === 1, 'ordinary PWA has a device pairing token path beyond the sanitizer');
assert(app.includes('firebaseAuthService.getAuthEnvelope(false)'), 'ordinary API does not attach a refreshed Firebase token');
assert(app.includes('cache: "no-store"'), 'ordinary authenticated requests are cacheable');
assert(!/localStorage\.setItem\([^\n]*(idToken|accessToken|firebaseAuth)/.test(app), 'PWA stores an auth token itself');

assert(actionSecurity.includes('authBindingKey'), 'confirmation security is not bound to the verified actor');
assert(/if\s*\(request\.method\s*!==\s*"GET"\)\s*\{\s*return;\s*\}/.test(sw), 'service worker does not bypass non-GET requests');

console.log('PASS Firebase ordinary cutover, legacy isolation, and actor binding boundaries');

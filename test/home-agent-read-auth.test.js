'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'gas', 'HomeAgentCore.js'), 'utf8');
const coreSource = source.slice(source.indexOf('function homeAgent_'), source.indexOf('function homeAgentAction_'));

function load(options = {}) {
  let calls = 0;
  const context = {
    Array, Object, String,
    json_: (value) => value,
    resolveHomeAgentReadActor_: options.resolve || (() => ({
      homeId: 'home-a', memberUserId: 'father', displayName: '父', role: 'admin',
      capabilities: ['home.read', 'home.control'], deviceId: 'father-device',
    })),
    runHomeAgentRequest_: (request) => { calls += 1; return request; },
  };
  vm.createContext(context);
  vm.runInContext(coreSource, context);
  return { context, calls: () => calls };
}

const allowed = load();
const result = allowed.context.homeAgent_({
  deviceId: 'spoofed-device', pairingToken: 'credential', userId: 'spoofed-user', userDisplayName: '偽名',
  role: 'self_record', capabilities: ['home.control'], homeId: 'spoofed-home', useMocks: true,
  allowActiveSpreadsheetFallback: true,
});
assert.strictEqual(allowed.calls(), 1, 'authorized read did not reach Home Agent Core');
assert.strictEqual(result.userId, 'father');
assert.strictEqual(result.userDisplayName, '父');
assert.strictEqual(result.role, 'admin');
assert.deepStrictEqual(JSON.parse(JSON.stringify(result.capabilities)), ['home.read', 'home.control']);
assert.strictEqual(result.homeId, 'home-a');
assert.strictEqual(result.deviceId, 'father-device');
assert.strictEqual(result.useMocks, false);
assert.strictEqual(result.allowActiveSpreadsheetFallback, false);
assert(!Object.prototype.hasOwnProperty.call(result, 'pairingToken'), 'pairing token reached Core');

const denied = load({ resolve: () => { const error = new Error('UNAUTHORIZED_DEVICE'); error.code = 'UNAUTHORIZED_DEVICE'; throw error; } });
assert.throws(() => denied.context.homeAgent_({ deviceId: 'bad', pairingToken: 'bad' }), (error) => error.code === 'UNAUTHORIZED_DEVICE');
assert.strictEqual(denied.calls(), 0, 'unauthorized read reached Home Agent Core');

console.log('PASS Home Agent read authentication, actor replacement, and public test-flag blocking');

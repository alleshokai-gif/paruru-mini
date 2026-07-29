'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
function between(startMarker, endMarker) {
  const start = appSource.indexOf(startMarker);
  const end = appSource.indexOf(endMarker, start);
  assert(start >= 0 && end > start, `source boundary missing: ${startMarker}`);
  return appSource.slice(start, end);
}

const logs = [];
const requests = [];
let response = { ok: true, status: 200, json: async () => ({ success: true }) };
const context = {
  JSON,
  Number,
  String,
  Boolean,
  Object,
  Error,
  GAS_WEB_APP_URL: 'https://example.test/exec',
  activeMembershipContext: { role: 'self_record' },
  fetch: async (_url, options) => { requests.push(JSON.parse(options.body)); return response; },
  buildMemoCredentialPayload: (action) => ({ action, deviceId: 'device-secret', pairingToken: 'token-secret' }),
  getCurrentProfile: () => ({ deviceId: 'device-secret' }),
  getHomeAgentPairingToken: () => 'token-secret',
  dummyUpdate() { throw new Error('dummy path used'); },
  debugLog() {},
  console: { error: (...args) => logs.push(args) },
};
vm.createContext(context);
vm.runInContext(between('async function updateInboxItem', 'async function answerFollowup'), context);
vm.runInContext(between('async function parseApiResponse', 'function renderInboxLoading'), context);

(async () => {
  await context.updateInboxItem('inbox-123', { status: 'Done' });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(requests[0])), {
    action: 'update', deviceId: 'device-secret', pairingToken: 'token-secret', id: 'inbox-123', status: 'Done',
  }, 'update request changed');

  response = { ok: true, status: 200, json: async () => ({ success: false, error: { code: 'FORBIDDEN' }, message: 'forbidden' }) };
  await assert.rejects(() => context.updateInboxItem('inbox-456', { status: 'Done' }), (error) => error.responseErrorCode === 'FORBIDDEN' && error.httpStatus === 200);
  let diagnostic = logs.at(-1)[1];
  assert.deepStrictEqual(JSON.parse(JSON.stringify(diagnostic)), {
    action: 'update', httpStatus: 200, responseSuccess: false, responseErrorCode: 'FORBIDDEN', responseMessage: 'forbidden',
    inboxId: 'inbox-456', role: 'self_record', hasDeviceId: true, hasPairingToken: true,
  }, 'success:false diagnostic is incomplete or leaked a secret');

  response = { ok: false, status: 503, json: async () => ({}) };
  await assert.rejects(() => context.updateInboxItem('inbox-789', { status: 'Done' }), (error) => error.httpStatus === 503);
  diagnostic = logs.at(-1)[1];
  assert.strictEqual(diagnostic.httpStatus, 503, 'HTTP failure status was not diagnosed');
  assert.strictEqual(diagnostic.responseSuccess, null, 'HTTP failure incorrectly reported response success');
  assert(!JSON.stringify(diagnostic).includes('device-secret') && !JSON.stringify(diagnostic).includes('token-secret'), 'diagnostic leaked a credential value');
  console.log('PASS update request preservation and failure diagnostics');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

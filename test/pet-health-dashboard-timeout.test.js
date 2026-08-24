'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const constants = appSource.slice(
  appSource.indexOf('const PET_HEALTH_DASHBOARD_TIMEOUT_MS'),
  appSource.indexOf('const HOME_CONTROL_POLL_MILLISECONDS'),
);
const helpers = appSource.slice(
  appSource.indexOf('function petHealthDashboardSafeErrorCode_'),
  appSource.indexOf('function loadPetHealthDashboardCache_'),
);

function createHarness() {
  let now = 0;
  let nextTimerId = 1;
  const timers = new Map();
  const logs = [];
  const context = {
    Set,
    Promise,
    globalThis: { BUILD_ID: 'test-pwa-build' },
    console: { info: (...args) => logs.push(args) },
    setTimeout(fn, delay) {
      const id = nextTimerId++;
      timers.set(id, { at: now + Number(delay), fn, cancelled: false });
      return id;
    },
    clearTimeout(id) {
      const timer = timers.get(id);
      if (timer) timer.cancelled = true;
    },
    createHomeControlError(code) {
      const error = new Error(code);
      error.code = code;
      return error;
    },
  };
  vm.createContext(context);
  vm.runInContext(constants + '\n' + helpers, context);
  return {
    context,
    logs,
    schedule(delay, value) {
      return new Promise((resolve) => context.setTimeout(() => resolve(value), delay));
    },
    advance(milliseconds) {
      now += milliseconds;
      Array.from(timers.entries())
        .filter((entry) => !entry[1].cancelled && entry[1].at <= now)
        .sort((left, right) => left[1].at - right[1].at)
        .forEach((entry) => {
          entry[1].cancelled = true;
          entry[1].fn();
        });
    },
  };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

async function testSuccessAt(milliseconds, id) {
  const harness = createHarness();
  const result = harness.context.withPetHealthDashboardTimeout_(harness.schedule(milliseconds, id));
  harness.advance(milliseconds);
  await settle();
  assert.strictEqual(await result, id);
}

async function run() {
  await testSuccessAt(12000, 'PH-TIME01');
  await testSuccessAt(29000, 'PH-TIME02');

  const timeoutHarness = createHarness();
  const timeoutResult = timeoutHarness.context.withPetHealthDashboardTimeout_(timeoutHarness.schedule(30001, 'late'));
  timeoutHarness.advance(30000);
  await assert.rejects(timeoutResult, (error) => error.code === 'PET_HEALTH_TIMEOUT', 'PH-TIME03 30 second timeout');

  assert.strictEqual(timeoutHarness.context.petHealthDashboardSafeErrorCode_('PET_HEALTH_TIMEOUT'), 'PET_HEALTH_TIMEOUT', 'PH-OBS01 timeout code');
  assert.strictEqual(timeoutHarness.context.petHealthDashboardSafeErrorCode_('HOME_CONTROL_UNAVAILABLE'), 'PET_HEALTH_UNAVAILABLE', 'PH-OBS01 transport code');
  assert.strictEqual(timeoutHarness.context.petHealthDashboardSafeErrorCode_('SECRET_DETAIL'), 'UNKNOWN', 'PH-OBS01 unknown code');

  timeoutHarness.context.logPetHealthDashboardDiagnostic_({
    requestId: '12345678-1234-4234-8234-123456789abc',
    startedAtMs: Date.now(),
  }, 'REQUEST_FAILED', 'DATA_INTEGRITY_ERROR');
  const diagnostic = timeoutHarness.logs[0][1];
  assert.deepStrictEqual(Object.keys(diagnostic), ['requestIdSuffix', 'stage', 'elapsedMs', 'errorCode', 'buildId'], 'PH-OBS02 safe diagnostic fields');
  assert.strictEqual(diagnostic.requestIdSuffix, '56789abc');
  assert.strictEqual(diagnostic.errorCode, 'DATA_INTEGRITY_ERROR');
  const serialized = JSON.stringify(diagnostic);
  ['pairingToken', 'deviceId', 'serviceToken', 'homeId', 'note', 'payload'].forEach((field) => assert(!serialized.includes(field), `PH-OBS03 ${field} leaked`));

  const timeoutHelperSource = helpers.slice(helpers.indexOf('function withPetHealthDashboardTimeout_'));
  assert.strictEqual((timeoutHelperSource.match(/Promise\.resolve\(request\)/g) || []).length, 1, 'PH-TIME07 timeout wrapper must not retry');
  assert(!/callAuthenticatedPetHealth_|callHomeControlApi/.test(timeoutHelperSource), 'PH-TIME07 timeout wrapper must not issue another request');

  console.log('PASS PH-TIME01-PH-TIME07 and PH-OBS01-PH-OBS03 Dashboard timeout contracts');
}

run().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});

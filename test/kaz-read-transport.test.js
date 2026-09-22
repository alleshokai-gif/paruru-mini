'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const start = appSource.indexOf('async function callHomeControlReadOnlyApi_');
const end = appSource.indexOf('async function readHomeControlErrorResponse_', start);
assert(start >= 0 && end > start, 'Kaz read transport functions were not found');
const source = appSource.slice(start, end);

function harness(callHomeControlApi) {
  const records = [];
  const context = {
    AbortController,
    Date,
    Error,
    TypeError,
    Number,
    Promise,
    console,
    setTimeout,
    clearTimeout,
    KAZ_OS_READ_TIMEOUT_MS: 8000,
    KAZ_OS_READ_RETRY_DELAY_MS: 0,
    callHomeControlApi,
    createHomeControlError(code) { return Object.assign(new Error(code), { code }); },
    transportDiagnostics_() {
      return {
        requestId: () => '123e4567-e89b-42d3-a456-426614174000',
        start: (requestClass, action, requestId) => ({ requestClass, action, requestId }),
        classifyError: error => error.transportClassification || (error.httpStatus ? 'http' : 'unknown'),
        record: (_diagnostic, entry) => records.push({ ...entry }),
      };
    },
    globalThis: null,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'app.js#kaz-read-transport' });
  return { call: context.callHomeControlReadOnlyApi_, records };
}

(async () => {
  {
    const payloads = [];
    const h = harness(async payload => {
      payloads.push(payload);
      if (payloads.length === 1) {
        const error = Object.assign(new Error('transient'), {
          code: 'HOME_CONTROL_UNAVAILABLE',
          httpStatus: 503,
          transportClassification: 'http',
        });
        throw error;
      }
      return { recovered: true };
    });
    const result = await h.call({ action: 'kazOs.inbox.get' });
    assert.equal(result.recovered, true);
    assert.equal(payloads.length, 2, 'one transient failure must receive exactly one retry');
    assert.equal(payloads[0].request_id, payloads[1].request_id, 'retry must reuse the correlation id');
    assert.deepEqual(payloads.map(item => item.transport_attempt), [1, 2]);
    assert.deepEqual(h.records.map(item => item.outcome), ['retry', 'success']);
    assert.deepEqual(h.records.map(item => item.attempt), [1, 2]);
  }

  {
    let calls = 0;
    const h = harness(async () => {
      calls++;
      throw Object.assign(new Error('still unavailable'), {
        code: 'HOME_CONTROL_UNAVAILABLE',
        httpStatus: 503,
        transportClassification: 'http',
      });
    });
    await assert.rejects(
      () => h.call({ action: 'kazOs.today.get' }),
      error => error && error.code === 'HOME_CONTROL_UNAVAILABLE'
    );
    assert.equal(calls, 2, 'two consecutive transport failures must stop after one retry');
    assert.deepEqual(h.records.map(item => item.outcome), ['retry', 'unresolved']);
    assert.deepEqual(h.records.map(item => item.attempt), [1, 2]);
  }

  console.log('PASS deterministic Kaz read retry success and bounded failure');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

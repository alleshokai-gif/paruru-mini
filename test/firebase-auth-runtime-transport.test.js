'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'features', 'auth', 'firebase-auth-runtime.js'), 'utf8');

function response(status, body, jsonError = null) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() {
      if (jsonError) throw jsonError;
      return body;
    },
  };
}

function harness(fetchImpl) {
  const context = {
    console,
    Object,
    String,
    Error,
    TypeError,
    Promise,
    setTimeout: fn => { fn(); return 1; },
    fetch: fetchImpl,
    document: {
      querySelector() { return null; },
      createElement() { return { dataset: {}, addEventListener() {} }; },
      head: { appendChild() {} },
    },
    PALURUFirebaseAuth: { create() { throw new Error('MUST_NOT_REACH_AUTH_CORE'); } },
    google: null,
    globalThis: null,
  };
  context.globalThis = context;
  vm.createContext(context);
  new vm.Script(source, { filename: 'features/auth/firebase-auth-runtime.js' }).runInContext(context);
  return context;
}

(async () => {
  {
    let calls = 0;
    const h = harness(async () => {
      calls++;
      throw new TypeError('synthetic network failure');
    });
    await assert.rejects(
      () => h.PALURUFirebaseAuthRuntime.create({ gasWebAppUrl: 'https://example.invalid/exec' }),
      error => error && error.code === 'TRANSPORT_FAILURE'
    );
    assert.equal(calls, 2, 'transient fetch failure must receive exactly one retry');
  }

  {
    let calls = 0;
    const h = harness(async () => {
      calls++;
      return response(503, { success: false, error: { code: 'SERVER_DOWN' } });
    });
    await assert.rejects(
      () => h.PALURUFirebaseAuthRuntime.create({ gasWebAppUrl: 'https://example.invalid/exec' }),
      error => error && error.code === 'TRANSPORT_FAILURE'
    );
    assert.equal(calls, 2, 'transient 5xx must receive exactly one retry');
  }

  {
    let calls = 0;
    const h = harness(async () => {
      calls++;
      return response(200, { success: false, error: { code: 'AUTH_CONFIGURATION_ERROR' } });
    });
    await assert.rejects(
      () => h.PALURUFirebaseAuthRuntime.create({ gasWebAppUrl: 'https://example.invalid/exec' }),
      error => error && error.code === 'AUTH_CONFIG_LOAD_FAILED'
    );
    assert.equal(calls, 1, 'meaningful server/config error must not retry');
  }

  {
    let calls = 0;
    const h = harness(async () => {
      calls++;
      return response(200, null, new SyntaxError('synthetic malformed json'));
    });
    await assert.rejects(
      () => h.PALURUFirebaseAuthRuntime.create({ gasWebAppUrl: 'https://example.invalid/exec' }),
      error => error && error.code === 'TRANSPORT_FAILURE'
    );
    assert.equal(calls, 2, 'unreadable response must receive exactly one retry');
  }

  console.log('PASS bounded Firebase bootstrap transport retry');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

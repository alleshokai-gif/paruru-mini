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

function harness(fetchImpl, timers = {}) {
  const context = {
    console,
    Object,
    String,
    Error,
    TypeError,
    Promise,
    setTimeout: timers.setTimeout || setTimeout,
    clearTimeout: timers.clearTimeout || clearTimeout,
    AbortController,
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
    // Headers arriving does not finish a read: a stalled body must also time out.
    let now = 0, sequence = 0, calls = 0, outcome = null;
    const pending = new Map(), signals = [];
    const timers = {
      setTimeout(fn, delay) { const id = ++sequence; pending.set(id, { at:now + delay, fn }); return id; },
      clearTimeout(id) { pending.delete(id); },
    };
    const flush = async () => { for (let i=0;i<20;i++) await Promise.resolve(); };
    const advance = async delay => {
      const end = now + delay;
      for (;;) {
        const next = [...pending].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
        if (!next) break;
        now=next[1].at;pending.delete(next[0]);next[1].fn();await flush();
      }
      now=end;await flush();
    };
    const h = harness(async (_url, options) => {
      calls++;signals.push(options.signal);
      return {status:200,ok:true,json:()=>new Promise(()=>{})};
    }, timers);
    h.PALURUFirebaseAuthRuntime.create({gasWebAppUrl:'https://example.invalid/exec'})
      .then(()=>{outcome={unexpectedSuccess:true};},error=>{outcome=error;});
    await flush();assert.equal(calls,1);
    await advance(8000);await advance(120);await advance(8000);
    assert.equal(calls,2,'stalled response bodies get exactly one bounded retry');
    assert.equal(outcome?.code,'TRANSPORT_FAILURE','body read must not stay pending beyond both attempts');
    assert.equal(outcome?.transportClassification,'timeout');
    assert(signals.every(signal=>signal.aborted));
    assert.equal(pending.size,0,'completed transport must leave no timer running');
  }

  {
    let calls = 0;
    const h = harness((_url, options) => {
      calls++;
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      });
    });
    const started = Date.now();
    await assert.rejects(
      () => h.PALURUFirebaseAuthRuntime.create({ gasWebAppUrl: 'https://example.invalid/exec' }),
      error => error && error.code === 'TRANSPORT_FAILURE'
    );
    assert.equal(calls, 2, 'hung fetch must receive exactly one retry after timeout');
    assert(Date.now() - started < 19000, 'bounded retry exceeded the expected total timeout window');
  }

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

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const source = app.slice(app.indexOf('async function callHomeControlReadOnlyApi_'),
  app.indexOf('async function readHomeControlErrorResponse_'));

function harness(operation) {
  let now = 0, sequence = 0;
  const timers = new Map(), records = [], calls = [];
  const context = {
    AbortController, Error, TypeError, Promise, Number, console,
    Date: { now: () => now },
    KAZ_OS_READ_TIMEOUT_MS: 8000, KAZ_OS_READ_RETRY_DELAY_MS: 120,
    setTimeout(callback, delay) {
      const id = ++sequence;
      timers.set(id, { at: now + delay, callback });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    callHomeControlApi(payload, options) {
      calls.push({ payload, signal: options.signal });
      return operation(payload, options, calls.length);
    },
    createHomeControlError(code, details = {}) {
      return Object.assign(new Error(code), { code }, details);
    },
    transportDiagnostics_: () => ({
      requestId: () => '123e4567-e89b-42d3-a456-426614174000',
      start: () => ({}),
      classifyError: error => context.PALURUTransportDiagnostics.classifyError(error),
      record: (_, entry) => records.push(entry),
    }),
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'features', 'transport', 'diagnostics.js'), 'utf8'), context);
  vm.runInContext(source, context);
  async function flush() { for (let i = 0; i < 16; i++) await Promise.resolve(); }
  async function advance(ms) {
    now += ms;
    for (;;) {
      const due = [...timers].filter(([, timer]) => timer.at <= now)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      due[1].callback();
      await flush();
    }
    await flush();
  }
  return { call: context.callHomeControlReadOnlyApi_, calls, records, timers, advance, flush };
}

test('an unresponsive read settles after two existing deadlines, with bounded retry and no real network', async () => {
  const h = harness(() => new Promise(() => {}));
  let settled = false, failure;
  h.call({ action: 'kazOs.today.get' }).catch(error => { settled = true; failure = error; });
  await h.advance(8000);
  assert.equal(h.records[0]?.backendStage, 'CLIENT_TIMEOUT');
  assert.equal(h.records[0]?.outcome, 'retry');
  assert.equal(settled, false);
  await h.advance(120);
  assert.equal(h.calls.length, 2);
  await h.advance(8000);
  assert.equal(settled, true, 'abort alone must not leave token preflight pending forever');
  assert.equal(failure.code, 'HOME_CONTROL_UNAVAILABLE');
  assert.equal(failure.transportClassification, 'timeout');
  assert.equal(h.records[1].outcome, 'unresolved');
  assert.deepEqual(h.records.map(row => row.classification), ['timeout', 'timeout']);
  assert.deepEqual(h.records.map(row => row.elapsedMs), [8000, 8000]);
  assert.equal(h.calls[0].payload.request_id, h.calls[1].payload.request_id);
  assert.deepEqual(h.calls.map(row => row.payload.transport_attempt), [1, 2]);
  assert(h.calls.every(row => row.signal.aborted));
  assert.equal(h.timers.size, 0);
});

test('late success from an aborted attempt cannot replace the current attempt', async () => {
  const resolvers = [];
  const h = harness(() => new Promise(resolve => resolvers.push(resolve)));
  let result;
  const done = h.call({ action: 'kazOs.today.get' }).then(value => { result = value; });
  await h.advance(8000);
  await h.advance(120);
  resolvers[0]({ generation: 'late' });
  await h.flush();
  assert.equal(result, undefined);
  assert.equal(h.records.filter(row => row.outcome === 'success').length, 0);
  resolvers[1]({ generation: 'on-time' });
  await done;
  assert.equal(result.generation, 'on-time');
  assert.deepEqual(h.records.map(row => row.outcome), ['retry', 'success']);
  assert.equal(h.timers.size, 0);
});

test('on-time success clears the deadline without abort or retry', async () => {
  const h = harness(async () => ({ accepted: true }));
  const value = await h.call({ action: 'kazOs.today.get' });
  await h.advance(20000);
  assert.equal(value.accepted, true);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].signal.aborted, false);
  assert.equal(h.timers.size, 0);
});

test('business rejection remains non-retryable and cancels its timer', async () => {
  const h = harness(async () => { throw Object.assign(new Error('FORBIDDEN'),
    { code: 'FORBIDDEN', httpStatus: 403, transportClassification: 'business' }); });
  await assert.rejects(h.call({ action: 'kazOs.today.get' }), error => error.code === 'FORBIDDEN');
  await h.advance(20000);
  assert.equal(h.calls.length, 1);
  assert.equal(h.timers.size, 0);
});

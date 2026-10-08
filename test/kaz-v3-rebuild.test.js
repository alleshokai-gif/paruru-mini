'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'gas', 'KazOsV3Rebuild.js'), 'utf8');
const context = { JSON, Object, String, Error, RegExp };
vm.createContext(context);
new vm.Script(source, { filename: 'KazOsV3Rebuild.js' }).runInContext(context);

test('internal hook sends only safe source-event fields with existing bearer', () => {
  const calls = [];
  const result = context.requestKazOsV3Rebuild_(
    'WORK_DONE', 'work', 'mutation-12345678', {
      properties: { getProperty: key => key === 'KAZ_OS_PROGRESS_READ_TOKEN' ? 'x'.repeat(40) : '' },
      fetch(url, options) {
        calls.push({ url, options });
        return { getResponseCode: () => 202,
          getContentText: () => JSON.stringify({ status: 'requested', event_id: 'a'.repeat(64) }) };
      }
    });
  assert.equal(result.status, 'requested');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/v3\/rebuild$/);
  assert.deepEqual(JSON.parse(calls[0].options.payload), {
    reason: 'WORK_DONE', source: 'work', correlation_id: 'mutation-12345678'
  });
  assert.equal(calls[0].options.headers.Authorization, 'Bearer ' + 'x'.repeat(40));
  assert.equal(calls[0].options.headers.Origin, undefined);
});

test('PWA open and source mismatch cannot request a rebuild', () => {
  let calls = 0;
  const dependencies = { properties: { getProperty: () => 'x'.repeat(40) },
    fetch() { calls++; throw Error('SHOULD_NOT_FETCH'); } };
  for (const [reason, source] of [['PWA_OPEN', 'work'], ['WORK_DONE', 'calendar']]) {
    assert.throws(() => context.requestKazOsV3Rebuild_(reason, source, 'opaque-12345678', dependencies),
      error => error.code === 'REBUILD_REQUEST_INVALID');
  }
  assert.equal(calls, 0);
});

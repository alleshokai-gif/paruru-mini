'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SyntheticRegistry, RECORDS, validateRecord } = require('../src/registry');

function keysDeep(value, output = []) {
  if (Array.isArray(value)) {
    value.forEach((item) => keysDeep(item, output));
  } else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => {
      output.push(key);
      keysDeep(item, output);
    });
  }
  return output;
}

test('registry contains exactly the four required synthetic logical credentials', () => {
  const registry = new SyntheticRegistry();
  assert.deepEqual(
    registry.list().map((item) => item.credential_id).sort(),
    [
      'synthetic_family_inbox',
      'synthetic_health',
      'synthetic_kaz_os_read',
      'synthetic_openai'
    ]
  );
  assert.equal(registry.list().every((item) => item.backend === 'Synthetic'), true);
});

test('registry schema rejects non-synthetic backend and forbidden value fields', () => {
  const base = JSON.parse(JSON.stringify(RECORDS[0]));
  assert.throws(() => validateRecord({ ...base, backend: 'production' }), /REQUEST_INVALID/);
  assert.throws(() => validateRecord({ ...base, value: 'not-allowed' }), /REQUEST_INVALID/);
});

test('registry list and detail expose metadata only', () => {
  const registry = new SyntheticRegistry();
  const detail = registry.toDetail(registry.get('synthetic_kaz_os_read'));
  const forbidden = new Set(['value', 'secret', 'token', 'password', 'hash', 'fingerprint', 'prefix', 'suffix']);
  assert.equal(keysDeep(detail).some((key) => forbidden.has(key)), false);
  assert.equal(detail.consumer_count, 3);
  assert.equal(detail.consumers.length, 3);
});

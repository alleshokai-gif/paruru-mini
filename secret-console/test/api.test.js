'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { buildPrototype } = require('../src/server');

async function withServer(run) {
  const prototype = buildPrototype();
  const server = http.createServer(prototype.app.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    await run({
      ...prototype,
      base: `http://127.0.0.1:${address.port}`
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function request(base, pathname, options = {}) {
  const method = options.method || 'GET';
  const headers = {};
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    headers['Idempotency-Key'] = options.key || crypto.randomUUID();
  }
  const response = await fetch(base + pathname, {
    method,
    headers,
    body: method === 'GET' ? undefined : JSON.stringify(options.body || {})
  });
  return { status: response.status, body: await response.json() };
}

function runtimeInput() {
  return `runtime-${crypto.randomBytes(24).toString('base64url')}`;
}

test('list, detail, stage response, logs, audit, and backend state never expose submitted input', async () => {
  await withServer(async ({ base, logger, audit, backend }) => {
    const input = runtimeInput();
    const list = await request(base, '/api/credentials');
    const detail = await request(base, '/api/credentials/synthetic_kaz_os_read');
    const prepared = await request(base, '/api/rotations', {
      method: 'POST',
      body: { credential_id: 'synthetic_kaz_os_read' }
    });
    const rotationId = prepared.body.data.rotation_id;
    const staged = await request(base, '/api/credentials/synthetic_kaz_os_read/stage', {
      method: 'POST',
      body: {
        rotation_id: rotationId,
        new_credential: input,
        confirm_credential: input
      }
    });

    assert.equal(list.status, 200);
    assert.equal(detail.status, 200);
    assert.equal(staged.status, 200);
    assert.equal(staged.body.data.state, 'staged');

    const backendState = Array.from(backend.snapshot().entries());
    const observable = JSON.stringify({
      list: list.body,
      detail: detail.body,
      staged: staged.body,
      logs: logger.entries,
      audit: audit.listAll(),
      backendState
    });
    assert.equal(observable.includes(input), false);
    assert.equal(observable.includes(Buffer.from(input).toString('base64')), false);
  });
});

test('stage rejects mismatch without echoing either submitted input', async () => {
  await withServer(async ({ base, logger, audit }) => {
    const left = runtimeInput();
    const right = runtimeInput();
    const prepared = await request(base, '/api/rotations', {
      method: 'POST',
      body: { credential_id: 'synthetic_openai' }
    });
    const response = await request(base, '/api/credentials/synthetic_openai/stage', {
      method: 'POST',
      body: {
        rotation_id: prepared.body.data.rotation_id,
        new_credential: left,
        confirm_credential: right
      }
    });
    const observable = JSON.stringify({ response: response.body, logs: logger.entries, audit: audit.listAll() });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'SECRET_INPUT_INVALID');
    assert.equal(observable.includes(left), false);
    assert.equal(observable.includes(right), false);
  });
});

test('prohibited secret retrieval endpoints do not exist', async () => {
  await withServer(async ({ base }) => {
    const paths = ['/secret', '/value', '/export', '/reveal', '/compare', '/api/read-secret'];
    for (const pathname of paths) {
      const result = await request(base, pathname);
      assert.equal(result.status, 404, pathname);
      assert.equal(result.body.error.code, 'NOT_FOUND', pathname);
    }
  });
});

test('mutations require an idempotency key and safe retry returns the same result', async () => {
  await withServer(async ({ base, audit }) => {
    const missing = await fetch(base + '/api/rotations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential_id: 'synthetic_kaz_os_read' })
    });
    assert.equal(missing.status, 400);

    const key = `retry_${crypto.randomUUID()}`;
    const first = await request(base, '/api/rotations', {
      method: 'POST', key, body: { credential_id: 'synthetic_kaz_os_read' }
    });
    const second = await request(base, '/api/rotations', {
      method: 'POST', key, body: { credential_id: 'synthetic_kaz_os_read' }
    });
    assert.equal(first.body.data.rotation_id, second.body.data.rotation_id);
    assert.equal(audit.listAll().filter((event) => event.event === 'rotation_prepared').length, 1);
  });
});

test('redacted probe includes only consumer status and safe timing metadata', async () => {
  await withServer(async ({ base }) => {
    const response = await request(base, '/api/credentials/synthetic_kaz_os_read/probe', {
      method: 'POST', body: {}
    });
    assert.equal(response.status, 200);
    assert.deepEqual(Object.keys(response.body.data).sort(), [
      'configured', 'connectivity', 'consumers', 'credential_id', 'elapsed_ms'
    ]);
    assert.deepEqual(response.body.data.consumers.map((item) => item.id), ['progress', 'projects', 'inbox']);
  });
});

test('only the stage endpoint accepts credential input fields', async () => {
  await withServer(async ({ base, audit }) => {
    const input = runtimeInput();
    const prepared = await request(base, '/api/rotations', {
      method: 'POST', body: { credential_id: 'synthetic_kaz_os_read' }
    });
    const response = await request(base, `/api/rotations/${prepared.body.data.rotation_id}/distribute`, {
      method: 'POST', body: { new_credential: input }
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'REQUEST_INVALID');
    assert.equal(JSON.stringify({ response: response.body, audit: audit.listAll() }).includes(input), false);
  });
});

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'features', 'transport', 'read-v2.js'), 'utf8');
const configSource = fs.readFileSync(path.join(root, 'features', 'transport', 'read-v2-config.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

function projectsDto() {
  return { origin: 'notion_official_api', mode: 'read_only', fixture_only: false,
    sources: { projects: { status: 'ok', complete: true } }, projects: [] };
}

function workDto() {
  return { origin: 'notion_official_api', mode: 'read_only', fixture_only: false,
    sources: { work_items: { status: 'ok', complete: true } }, work_items: [],
    writes: { notion: 0, calendar: 0, context: 0 } };
}

function response(status, body, timing = 'firebase;dur=10, actor;dur=20, upstream;dur=30, serialize;dur=1, total;dur=61') {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: name => name === 'Server-Timing' ? timing : null },
    async json() { return body; },
    clone() { return response(status, body, timing); },
  };
}

function load(fetchImpl, records = []) {
  const context = {
    console,
    fetch: fetchImpl,
    Date,
    Number,
    String,
    Object,
    Array,
    Set,
    Map,
    Error,
    TypeError,
    RegExp,
    Promise,
    AbortController,
    setTimeout,
    clearTimeout,
    globalThis: null,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'features/transport/read-v2.js' });
  const diagnostics = {
    requestId: () => '12345678-1234-4234-8234-123456789abc',
    start: (requestClass, action, requestId) => ({ requestClass, action, requestId }),
    record: (diagnostic, values) => records.push({ diagnostic, values }),
    classifyError: error => error.transportClassification || 'unknown',
  };
  const create = overrides => context.PALURUReadTransportV2.create({
    config: { mode: 'DIRECT_V2', baseUrl: 'https://reader.example.test',
      canaryCapability: 'kaz.read.direct_v2.canary' },
    fetchImpl,
    getAuthEnvelope: async () => ({ provider: 'firebase', idToken: 'private-token' }),
    diagnostics,
    timeoutMs: 8000,
    retryDelayMs: 0,
    ...(overrides || {}),
  });
  return { context, create, records };
}

async function main() {
  {
    const context = { globalThis: null, Object };
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(configSource, context, { filename: 'features/transport/read-v2-config.js' });
    assert.equal(context.PALURU_READ_TRANSPORT_V2_CONFIG.mode, 'DIRECT_V2', 'owner canary must explicitly select direct transport');
    assert.equal(context.PALURU_READ_TRANSPORT_V2_CONFIG.baseUrl, 'https://paluru-read-transport-v2-jwnmkrlyha-an.a.run.app');
    assert.equal(context.PALURU_READ_TRANSPORT_V2_CONFIG.canaryCapability, 'home.control');
  }

  {
    const harness = load(async () => response(200, projectsDto()));
    const ownerCanary = { mode: 'DIRECT_V2',
      baseUrl: 'https://paluru-read-transport-v2-jwnmkrlyha-an.a.run.app',
      canaryCapability: 'home.control' };
    assert.equal(harness.context.PALURUReadTransportV2.selectMode(ownerCanary, {
      role: 'admin', capabilities: ['home.control']
    }), 'DIRECT_V2');
    assert.equal(harness.context.PALURUReadTransportV2.selectMode(ownerCanary, {
      role: 'guardian', capabilities: ['home.control']
    }), 'GAS', 'non-admin member must remain on GAS');
    assert.equal(harness.context.PALURUReadTransportV2.selectMode(ownerCanary, {
      role: 'admin', capabilities: []
    }), 'GAS', 'admin without the server-owned cohort capability must remain on GAS');
    const direct = { mode: 'DIRECT_V2', baseUrl: 'https://reader.example.test',
      canaryCapability: 'kaz.read.direct_v2.canary' };
    assert.equal(harness.context.PALURUReadTransportV2.selectMode(direct, {
      role: 'admin', capabilities: ['kaz.read.direct_v2.canary']
    }), 'DIRECT_V2');
    assert.equal(harness.context.PALURUReadTransportV2.selectMode(direct, {
      role: 'admin', capabilities: []
    }), 'GAS', 'non-canary admin must remain on GAS');
    assert.equal(harness.context.PALURUReadTransportV2.selectMode(direct, {
      role: 'self_record', capabilities: ['kaz.read.direct_v2.canary']
    }), 'GAS', 'non-admin member must remain on GAS');
    assert.equal(harness.context.PALURUReadTransportV2.selectMode({
      mode: 'GAS', baseUrl: '', canaryCapability: 'kaz.read.direct_v2.canary'
    }, { role: 'admin', capabilities: ['kaz.read.direct_v2.canary'] }), 'GAS');
  }

  {
    const calls = [];
    const harness = load(async (url, options) => {
      calls.push({ url, options });
      return response(200, url.endsWith('/projects') ? projectsDto() : workDto());
    });
    assert.deepEqual(await harness.create().projects(), projectsDto());
    assert.deepEqual(await harness.create().work(), workDto());
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, 'https://reader.example.test/v2/read/projects');
    assert.equal(calls[1].url, 'https://reader.example.test/v2/read/work');
    assert.equal(calls[0].options.method, 'GET');
    assert.equal(calls[0].options.cache, 'no-store');
    assert.equal(calls[0].options.redirect, 'error');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer private-token');
    assert.equal(calls[0].options.headers['X-Paluru-Request-Id'], '12345678-1234-4234-8234-123456789abc');
    assert(harness.records.every(item => item.values.transportType === 'DIRECT_V2'));
    assert.equal(harness.records[0].values.serverTotalMs, 61);
    assert(!JSON.stringify(harness.records).includes('private-token'), 'token leaked to diagnostics');
  }

  {
    let calls = 0;
    const harness = load(async () => { calls += 1; return response(403, { error: { code: 'FORBIDDEN' } }); });
    await assert.rejects(harness.create().projects(), error => error.code === 'FORBIDDEN');
    assert.equal(calls, 1, 'authorization failure must not retry or fall back to GAS');
  }

  {
    let calls = 0;
    const harness = load(async () => {
      calls += 1;
      return calls === 1 ? response(503, { error: { code: 'PROJECTS_SOURCE_UNAVAILABLE' } })
        : response(200, projectsDto());
    });
    assert.deepEqual(await harness.create().projects(), projectsDto());
    assert.equal(calls, 2, 'direct read budget must remain one bounded retry');
  }

  {
    const harness = load(async () => response(200, { ...workDto(), writes: { notion: 1, calendar: 0, context: 0 } }));
    await assert.rejects(harness.create().work(), error => error.code === 'WORK_CONTRACT_INVALID');
  }

  assert(appSource.includes('selectedKazOsReadTransport_() === "DIRECT_V2"'), 'Projects/Work canary selector missing');
  assert(appSource.includes('capabilities: Array.isArray(activeMembershipContext?.capabilities)'), 'canary selector must use membership capability');
  assert(appSource.includes('return callHomeControlReadOnlyApi_(buildMemoCredentialPayload("kazOs.today.get"))'), 'TODAY must remain on GAS');
  assert(appSource.includes('buildMemoCredentialPayload("kazOs.inbox.get")'), 'INBOX must remain on GAS');
  const answer = appSource.slice(appSource.indexOf('async function callAuthenticatedKazOsInboxAnswer_'), appSource.indexOf('function applyMembershipCapabilityVisibility_'));
  assert(answer.includes('callHomeControlApi') && !answer.includes('callDirectKazOsRead_'), 'write path must remain on GAS');

  console.log('PASS Projects/Work direct-read adapter, bounded retry, no fallback, and GAS write boundary');
}

main().catch(error => { console.error(error); process.exitCode = 1; });

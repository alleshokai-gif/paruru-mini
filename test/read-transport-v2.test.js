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

function healthy(revision) {
  return { status: 'ok', complete: true, source_revision: revision };
}

function todayDto() {
  return { schema_version: 'kaz-today-plan-v1', origin: 'real_operational_sources',
    mode: 'read_only', fixture_only: false,
    sources: { work_items: healthy('work-revision'), calendar: healthy('calendar-revision') },
    today: { now: { kind: 'none', items: [], basis: [] },
      next: { kind: 'none', items: [], basis: [] }, waiting: [], availability: [],
      calendar_state: { unknown: [], classification_revision_current: true } },
    writes: { notion: 0, calendar: 0, context: 0 } };
}

function inboxDto() {
  const sources = Object.fromEntries(['inbox','projects','tasks','calendar','resolution']
    .map((key) => [key, healthy(key + '-revision')]));
  return { schema_version: 'kaz-secretary-inbox-0.1', origin: 'real_operational_sources',
    mode: 'controlled_proposal', fixture_only: false, fixture_fallback: false,
    sources, projects: [], work_items: [], calendar_events: [], inbox_items: [],
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
    assert.equal(context.PALURU_READ_TRANSPORT_V2_CONFIG.mode, 'DIRECT_V2', 'production cutover must explicitly select direct transport');
    assert.equal(context.PALURU_READ_TRANSPORT_V2_CONFIG.baseUrl, 'https://paluru-read-transport-v2-jwnmkrlyha-an.a.run.app');
    assert.equal(context.PALURU_READ_TRANSPORT_V2_CONFIG.canaryCapability, '');
    assert.equal(context.PALURU_READ_TRANSPORT_V2_CONFIG.routeModes.projects, 'DIRECT_V2');
    assert.equal(context.PALURU_READ_TRANSPORT_V2_CONFIG.routeModes.work, 'DIRECT_V2');
    assert.equal(context.PALURU_READ_TRANSPORT_V2_CONFIG.routeModes.today, 'GAS');
    assert.equal(context.PALURU_READ_TRANSPORT_V2_CONFIG.routeModes.inbox, 'GAS');

    const canaryContext = { globalThis: null, Object,
      location: { search: '?paluru_read_transport_phase2_canary=1' } };
    canaryContext.globalThis = canaryContext;
    vm.createContext(canaryContext);
    vm.runInContext(configSource, canaryContext, { filename: 'features/transport/read-v2-config.js' });
    assert.equal(canaryContext.PALURU_READ_TRANSPORT_V2_CONFIG.baseUrl,
      'https://phase2-canary-20260925---paluru-read-transport-v2-jwnmkrlyha-an.a.run.app');
    assert.equal(canaryContext.PALURU_READ_TRANSPORT_V2_CONFIG.routeModes.projects, 'DIRECT_V2');
    assert.equal(canaryContext.PALURU_READ_TRANSPORT_V2_CONFIG.routeModes.work, 'DIRECT_V2');
    assert.equal(canaryContext.PALURU_READ_TRANSPORT_V2_CONFIG.routeModes.today, 'DIRECT_V2');
    assert.equal(canaryContext.PALURU_READ_TRANSPORT_V2_CONFIG.routeModes.inbox, 'DIRECT_V2');
  }

  {
    const harness = load(async () => response(200, projectsDto()));
    const production = { mode: 'DIRECT_V2',
      baseUrl: 'https://paluru-read-transport-v2-jwnmkrlyha-an.a.run.app',
      canaryCapability: '' };
    assert.equal(harness.context.PALURUReadTransportV2.selectMode(production, {
      role: 'admin', capabilities: []
    }, 'projects'), 'DIRECT_V2', 'authorized Kaz admin must use production direct transport');
    assert.equal(harness.context.PALURUReadTransportV2.selectMode(production, {
      role: 'admin', capabilities: []
    }, 'today'), 'GAS', 'TODAY must default to GAS without an explicit route flag');
    assert.equal(harness.context.PALURUReadTransportV2.selectMode(production, {
      role: 'admin', capabilities: []
    }, 'inbox'), 'GAS', 'INBOX must default to GAS without an explicit route flag');
    assert.equal(harness.context.PALURUReadTransportV2.selectMode(production, {
      role: 'guardian', capabilities: ['home.control']
    }), 'GAS', 'production cutover must not bypass the existing Kaz admin boundary');
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
    const calls = [];
    const harness = load(async (url, options) => {
      calls.push({ url, options });
      return response(200, url.endsWith('/today') ? todayDto() : inboxDto());
    });
    const phase2Config = { mode: 'DIRECT_V2', baseUrl: 'https://reader.example.test',
      canaryCapability: '', routeModes: { projects: 'DIRECT_V2', work: 'DIRECT_V2',
        today: 'DIRECT_V2', inbox: 'DIRECT_V2' } };
    assert.deepEqual(await harness.create({ config: phase2Config }).today(), todayDto());
    assert.deepEqual(await harness.create({ config: phase2Config }).inbox(), inboxDto());
    assert.deepEqual(calls.map(item => item.url), [
      'https://reader.example.test/poc/read-v2/today',
      'https://reader.example.test/poc/read-v2/inbox'
    ]);
    assert(calls.every(item => item.options.method === 'GET'));
    assert(harness.records.every(item => item.values.transportType === 'DIRECT_V2'));

    const multipleNow = todayDto();
    multipleNow.today.now = { kind: 'multiple', items: [{ id: 'now-one' }, { id: 'now-two' }],
      basis: ['state=DOING'] };
    assert.deepEqual(await harness.create({ fetchImpl: async () => response(200, multipleNow),
      config: phase2Config }).today(), multipleNow,
    'Direct V1 validator must preserve the legacy V1 multiple-NOW contract');

    for (const invalidNow of [
      [],
      { kind: 'unknown', items: [], basis: [] },
      { kind: 'none', items: [{}], basis: [] },
      { kind: 'single', items: [], basis: [] },
      { kind: 'multiple', items: [{}], basis: [] },
      { kind: 'none', items: [], basis: 'not-an-array' },
      { kind: 'none', items: [], basis: [], unexpected: true },
    ]) {
      const invalid = todayDto();
      invalid.today.now = invalidNow;
      await assert.rejects(harness.create({ fetchImpl: async () => response(200, invalid),
        config: phase2Config }).today(), error => error.code === 'TODAY_CONTRACT_INVALID');
    }

    const tooManyNext = todayDto();
    tooManyNext.today.next = { kind: 'multiple',
      items: [{}, {}, {}], basis: ['availability'] };
    await assert.rejects(harness.create({ fetchImpl: async () => response(200, tooManyNext),
      config: phase2Config }).today(), error => error.code === 'TODAY_CONTRACT_INVALID');
  }

  {
    let calls = 0;
    const harness = load(async () => { calls += 1; return response(403, { error: { code: 'FORBIDDEN' } }); });
    const phase2Config = { mode: 'DIRECT_V2', baseUrl: 'https://reader.example.test',
      canaryCapability: '', routeModes: { today: 'DIRECT_V2' } };
    await assert.rejects(harness.create({ config: phase2Config }).today(), error => error.code === 'FORBIDDEN');
    assert.equal(calls, 1, 'TODAY direct authorization failure must not retry or fall back to GAS');
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

  assert(appSource.includes('selectedKazOsReadTransport_("projects") === "DIRECT_V2"'), 'Projects selector missing');
  assert(appSource.includes('selectedKazOsReadTransport_("work") === "DIRECT_V2"'), 'Work selector missing');
  assert(appSource.includes('capabilities: Array.isArray(activeMembershipContext?.capabilities)'), 'optional cohort selector must use membership capability');
  assert(appSource.includes('selectedKazOsReadTransport_("today") === "DIRECT_V2"'), 'TODAY route selector missing');
  assert(appSource.includes('selectedKazOsReadTransport_("inbox") === "DIRECT_V2"'), 'INBOX route selector missing');
  assert(configSource.includes('baseUrl: phase2Canary ? phase2CanaryBaseUrl : stableBaseUrl')
    && configSource.includes("today: phase2Canary ? 'DIRECT_V2' : 'GAS'")
    && configSource.includes("inbox: phase2Canary ? 'DIRECT_V2' : 'GAS'"),
  'Phase 2 routes must default to GAS and require the explicit canary query flag');
  const answer = appSource.slice(appSource.indexOf('async function callAuthenticatedKazOsInboxAnswer_'), appSource.indexOf('function applyMembershipCapabilityVisibility_'));
  assert(answer.includes('callHomeControlApi') && !answer.includes('callDirectKazOsRead_'), 'write path must remain on GAS');

  console.log('PASS Projects/Work direct-read adapter, bounded retry, no fallback, and GAS write boundary');
}

main().catch(error => { console.error(error); process.exitCode = 1; });

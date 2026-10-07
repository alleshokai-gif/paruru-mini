'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
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
    assert.equal(context.PALURU_READ_TRANSPORT_V2_CONFIG.routeModes.inbox, 'DIRECT_V2');

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
      canaryCapability: '', routeModes: { projects: 'DIRECT_V2', work: 'DIRECT_V2', today: 'GAS', inbox: 'DIRECT_V2' } };
    assert.equal(harness.context.PALURUReadTransportV2.selectMode(production, {
      role: 'admin', capabilities: []
    }, 'projects'), 'DIRECT_V2', 'authorized Kaz admin must use production direct transport');
    assert.equal(harness.context.PALURUReadTransportV2.selectMode(production, {
      role: 'admin', capabilities: []
    }, 'today'), 'GAS', 'TODAY must default to GAS without an explicit route flag');
    assert.equal(harness.context.PALURUReadTransportV2.selectMode(production, {
      role: 'admin', capabilities: []
    }, 'inbox'), 'DIRECT_V2', 'INBOX must use the production direct transport');
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
    let authCalls = 0;
    let fetchCalls = 0;
    const harness = load(async () => { fetchCalls += 1; return response(200, projectsDto()); });
    const client = harness.create({
      timeoutMs: 10,
      getAuthEnvelope: () => { authCalls += 1; return new Promise(() => {}); }
    });
    const startedAt = Date.now();
    await assert.rejects(client.projects(), error => error.code === 'AUTH_ENVELOPE_TIMEOUT');
    assert(Date.now() - startedAt < 1000, 'auth timeout must settle instead of remaining pending');
    assert.equal(authCalls, 2, 'auth timeout may use only the existing two-attempt budget');
    assert.equal(fetchCalls, 0, 'fetch must not start without a resolved auth envelope');
  }

  {
    let fetchCalls = 0;
    const harness = load(async () => { fetchCalls += 1; return response(200, projectsDto()); });
    assert.deepEqual(await harness.create({ timeoutMs: 10 }).projects(), projectsDto(),
      'normal auth resolution must continue to allow a Direct V2 read');
    assert.equal(fetchCalls, 1);
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
    await harness.create({ fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response(200, inboxDto());
    }, config: phase2Config }).inbox({ requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-12345678abcd' });
    assert.equal(calls.at(-1).options.headers['X-Paluru-Request-Id'],
      'aaaaaaaa-aaaa-4aaa-8aaa-12345678abcd', 'INBOX correlation ID must be supplied by the caller when available');

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
    const base = inboxDto();
    const uuid = '13c232c5-8bc4-4f47-8f3a-1d03a9d2817f';
    const digest = 'a'.repeat(64);
    const revision = 'paluru-inbox-sha256:' + digest;
    const candidateRef = 'paluru-inbox://' + uuid + '@sha256:' + digest;
    const id = 'candidate-review-' + crypto.createHash('sha256')
      .update(candidateRef + '\0' + revision).digest('hex').slice(0, 24);
    const choices = ['CONTEXT','WORK','PROJECT','HOLD','REJECT','MERGE']
      .map(value => ({value,label:value,effect:'review'}));
    const candidate = { id, kind: 'generic_candidate_review',
      contract: 'generic-candidate-review-0.1', owner: 'kaz', decision_requested: true,
      decision_status: 'pending', write_allowed: false, title: 'PALURU Candidate',
      entity_ref: candidateRef, candidate_ref: candidateRef, candidate_revision: revision,
      candidate_origin: 'PALURU', question_revision: 'question-sha256:' + 'b'.repeat(64),
      source_revision_references: {projects:'projects-revision',work_items:'tasks-revision',calendar:'calendar-revision'},
      answer_contract: {inbox_item_id:id,question_revision:'question-sha256:' + 'b'.repeat(64),
        question:'review',choices} };
    base.inbox_items.push(candidate);
    base.sources.paluru_candidates = healthy('paluru-inbox-source-sha256:' + 'c'.repeat(64));
    const harness = load(async () => response(200, base));
    const config = { mode: 'DIRECT_V2', baseUrl: 'https://reader.example.test',
      routeModes: { inbox: 'DIRECT_V2' } };
    assert.deepEqual(await harness.create({config}).inbox(), base,
      'DIRECT_V2 INBOX must accept the Version 182 PALURU Candidate revision contract');

    const stale = structuredClone(base);
    stale.inbox_items[0].candidate_ref = candidateRef.replace(digest, 'd'.repeat(64));
    await assert.rejects(load(async () => response(200, stale)).create({config}).inbox(),
      error => error.code === 'INBOX_CONTRACT_INVALID');
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

  {
    const sourceNames = ['projects', 'work', 'capa', 'calendar', 'work_busy',
      'decision_ledger', 'gardener', 'today', 'inbox'];
    const sources = Object.fromEntries(sourceNames.map(key => [key, {
      status: 'current', updated_at: '2026-10-07T12:00:00+00:00',
      valid_until: '2026-10-07T12:15:00+00:00', revision: key + '-revision' }]));
    const dashboard = { schema_version: 'kaz-os-dashboard-v3',
      generated_at: '2026-10-07T12:00:00+00:00', status: 'CURRENT', sources,
      today: { now: [], next: [], scheduled: [], company_free_windows: [],
        personal_free_windows: [], waiting: [] }, work: [], projects: [], capa: [] };
    const inbox = { schema_version: 'kaz-os-inbox-v3',
      generated_at: dashboard.generated_at, status: 'CURRENT', sources,
      inbox_items: [{ kind: 'human_review', decision_status: 'pending' }] };
    const calls = [];
    const harness = load(async url => { calls.push(url); return response(200,
      url.endsWith('/dashboard') ? dashboard : inbox); });
    const config = { mode: 'DIRECT_V2', baseUrl: 'https://reader.example.test',
      routeModes: { dashboardV3: 'DIRECT_V2', inboxV3: 'DIRECT_V2' } };
    assert.deepEqual(await harness.create({ config }).dashboardV3(), dashboard);
    assert.deepEqual(await harness.create({ config }).inboxV3(), inbox);
    assert.deepEqual(calls, ['https://reader.example.test/v3/dashboard',
      'https://reader.example.test/v3/inbox']);
    await assert.rejects(harness.create().dashboardV3(),
      error => error.code === 'DIRECT_READ_NOT_SELECTED');
    const invalid = load(async () => response(200, { ...dashboard, today: null }));
    await assert.rejects(invalid.create({ config }).dashboardV3(),
      error => error.code === 'V3_SNAPSHOT_CONTRACT_INVALID');
    const validWindow = { start: '2026-10-07T12:30:00+09:00',
      end: '2026-10-07T13:00:00+09:00', duration_min: 30,
      suggestions: [{ title: '資料確認', estimate_min: 30 }] };
    const withWindow = { ...dashboard, today: { ...dashboard.today,
      company_free_windows: [validWindow], personal_free_windows: [validWindow] } };
    assert.deepEqual(await load(async () => response(200, withWindow))
      .create({ config }).dashboardV3(), withWindow);
    for (const broken of [
      { ...validWindow, suggestions: undefined },
      { ...validWindow, suggestions: [{ title: '資料確認', estimate_min: 45 }] },
    ]) {
      const payload = { ...dashboard, today: { ...dashboard.today,
        company_free_windows: [broken] } };
      await assert.rejects(load(async () => response(200, payload))
        .create({ config }).dashboardV3(),
      error => error.code === 'V3_SNAPSHOT_CONTRACT_INVALID');
    }
  }

  assert(appSource.includes('selectedKazOsReadTransport_("projects") === "DIRECT_V2"'), 'Projects selector missing');
  assert(appSource.includes('selectedKazOsReadTransport_("work") === "DIRECT_V2"'), 'Work selector missing');
  assert(appSource.includes('capabilities: Array.isArray(activeMembershipContext?.capabilities)'), 'optional cohort selector must use membership capability');
  assert(appSource.includes('selectedKazOsReadTransport_("today") === "DIRECT_V2"'), 'TODAY route selector missing');
  assert(appSource.includes('const transportType = selectedKazOsReadTransport_("inbox")'), 'INBOX route selector missing');
  assert(appSource.includes('recordInboxRevisionFingerprints') && appSource.includes('callDirectKazOsRead_("inbox", requestId)'),
    'INBOX revision fingerprints must use the safe diagnostic helper and shared request correlation');
  assert(configSource.includes('baseUrl: phase2Canary ? phase2CanaryBaseUrl : stableBaseUrl')
    && configSource.includes("today: phase2Canary ? 'DIRECT_V2' : 'GAS'")
    && configSource.includes("inbox: 'DIRECT_V2'"),
  'INBOX must use production DIRECT_V2 while TODAY retains its explicit canary gate');
  const answer = appSource.slice(appSource.indexOf('async function callAuthenticatedKazOsInboxAnswer_'), appSource.indexOf('function applyMembershipCapabilityVisibility_'));
  assert(answer.includes('callHomeControlApi') && !answer.includes('callDirectKazOsRead_'), 'write path must remain on GAS');

  
(function testGithubCandidateWithPaluruMetadataStillUsesGithubContract() {
  const source = fs.readFileSync(path.join(root, 'features', 'transport', 'read-v2.js'), 'utf8');
  assert(source.includes(String.raw`const paluru = /^paluru-inbox:\/\//i.test(String(item.candidate_ref || ''));`),
    'candidate transport source must be derived from candidate_ref namespace, not candidate_origin metadata');
})();

console.log('PASS Projects/Work direct-read adapter, bounded retry, no fallback, and GAS write boundary');
}

main().catch(error => { console.error(error); process.exitCode = 1; });

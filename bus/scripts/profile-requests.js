// Local V8 diagnostic, NOT Cloudflare-billed CPU. No browser automation, raw profile or RT persistence.
import { Miniflare, Log, LogLevel, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync } from 'node:fs';
import { buildWorker } from './bundle.js';
import { readLocalToken } from './local-secret.js';

let runtime, socket, phase = 'bundle';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  const config = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  const token = readLocalToken(), bundle = await buildWorker();
  let fetchCount = 0, fetchMs = 0;
  phase = 'runtime';
  runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.text, inspectorPort: 0,
    compatibilityDate: config.compatibility_date, log: new Log(LogLevel.NONE),
    bindings: { ...config.vars, ODPT_ACCESS_TOKEN: token }, outboundService: async (request) => {
      const url = new URL(request.url);
      if (url.origin !== 'https://api.odpt.org' || url.pathname !== '/api/v4/gtfs/realtime/odpt_TransportationBureau_CityOfKawasaki_AllLines_trip_update') throw Error('PROFILE_UPSTREAM_DENIED');
      fetchCount++; const start = performance.now();
      const response = await fetch(request.url, { redirect: 'error', signal: AbortSignal.timeout(20000) });
      const bytes = await response.arrayBuffer(); fetchMs += performance.now() - start;
      return new Response(bytes, { status: response.status, headers: { 'Content-Type': 'application/octet-stream' } });
    } }));
  await runtime.ready;
  phase = 'inspector';
  const inspector = await runtime.getInspectorURL();
  inspector.protocol = 'http:';
  phase = 'targets';
  const targets = await (await fetch(new URL('/json/list', inspector))).json();
  const target = targets.find((t) => t.webSocketDebuggerUrl && /core:user/.test(t.id));
  if (!target) throw Error('PROFILE_TARGET_MISSING');
  phase = 'websocket';
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let serial = 0; const pending = new Map();
  socket.addEventListener('message', ({ data }) => {
    const result = JSON.parse(data); if (!pending.has(result.id)) return;
    const job = pending.get(result.id); pending.delete(result.id); clearTimeout(job.timer);
    if (result.error) job.reject(Error('PROFILE_PROTOCOL_ERROR')); else job.resolve(result.result);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => { pending.delete(id); reject(Error('PROFILE_TIMEOUT')); }, 10000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  phase = 'profiler';
  await call('Profiler.enable');
  await call('Profiler.setSamplingInterval', { interval: 100 });
  const results = [];
  for (const kind of ['cold-miss', 'cache-hit-1', 'cache-hit-2', 'refresh-miss']) {
    if (kind === 'refresh-miss') await sleep(26000);
    phase = kind;
    fetchCount = 0; fetchMs = 0;
    await call('Profiler.start');
    const start = performance.now();
    const response = await runtime.dispatchFetch('https://bus.example/api/bus/arrivals', { headers: { Origin: config.vars.ALLOWED_ORIGINS } });
    const raw = await response.text(), wallMs = performance.now() - start;
    const { profile } = await call('Profiler.stop');
    if (raw.includes(token)) throw Error('BUS_SECRET_LEAK');
    const data = JSON.parse(raw);
    if (response.status !== 200 || data.fetchError || data.directions.length !== 4 || data.directions.some((d) => d.arrivals.length !== 3)) throw Error('PROFILE_API_FAILED');
    const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
    let activeUs = 0, idleUs = 0, gcUs = 0;
    for (let i = 0; i < profile.samples.length; i++) {
      const name = nodes.get(profile.samples[i]).callFrame.functionName;
      const us = profile.timeDeltas[i];
      if (name === '(idle)') idleUs += us; else activeUs += us;
      if (name === '(garbage collector)') gcUs += us;
    }
    results.push({ kind, httpStatus: response.status, responseBytes: Buffer.byteLength(raw), wallMs,
      odptFetches: fetchCount, odptFetchBodyMs: fetchMs, sampledActiveMs: activeUs / 1000, sampledIdleMs: idleUs / 1000,
      sampledGcMs: gcUs / 1000, samples: profile.samples.length, cloudflareBilledCpuMs: null,
      directions: data.directions.map((d) => ({ id: d.id, rows: d.arrivals.length, realtimeRows: d.arrivals.filter((a) => a.realtime).length })) });
  }
  console.log(JSON.stringify({ status: 'LOCAL_REQUEST_PROFILE_PASS', checkedAt: new Date().toISOString(),
    environment: 'local-workerd-v8-sampling-100us', cloudflareCpuLimitValidated: false, results }));
} catch (error) {
  console.log(JSON.stringify({ error: /^[A-Z_]+$/.test(error?.message || '') ? error.message : 'LOCAL_REQUEST_PROFILE_FAILED', phase, type: /^[A-Za-z]+$/.test(error?.name || '') ? error.name : null, code: /^[A-Z_]+$/.test(error?.code || '') ? error.code : null })); process.exitCode = 1;
} finally { socket?.close(); await runtime?.dispose(); }

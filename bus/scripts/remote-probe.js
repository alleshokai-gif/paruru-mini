// Temporary remote validation only. Never creates/changes the production Worker.
// No raw API body, feed, secrets, or profiles are written to disk.
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { cloudflareSession, ACCOUNT_ID } from './cloudflare-session.js';
import { readLocalToken } from './local-secret.js';
const name = 'paluru-bus-api-validation-20260910';
const scriptPath = `/workers/scripts/${name}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const exactBundle = process.argv.includes('--exact-bundle');
let cf, created = false, phase = 'auth';
const report = { checkedAt: new Date().toISOString(), accountId: ACCOUNT_ID, workerName: name,
  productionDeployed: false, variant: exactBundle ? 'wrangler-dry-run-exact-bundle' : 'timing-headers',
  requests: [], invocations: [], cleanup: false };
const reportUrl = new URL(`../.local/remote-probe${exactBundle ? '-exact' : ''}-summary.json`, import.meta.url);
try {
  cf = cloudflareSession();
  phase = 'collision';
  const scripts = await cf.api('/workers/scripts');
  if (scripts.some((s) => [name, 'paluru-bus-api'].includes(s.id))) throw Error('CF_WORKER_NAME_COLLISION');
  const { subdomain } = await cf.api('/workers/subdomain');
  if (subdomain !== 'alle-shokai') throw Error('CF_SUBDOMAIN_MISMATCH');
  phase = 'bundle';
  const config = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  const built = exactBundle ? null : await build({ absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
    entryPoints: ['scripts/remote-probe-entry.js'], bundle: true, write: false, format: 'esm', platform: 'browser',
    target: 'es2022', minify: true, logLevel: 'silent' });
  let source;
  if (exactBundle) {
    // Wrangler --outfile is the multipart upload, not a JavaScript source file.
    const upload = readFileSync(new URL('../.local/deploy-check/worker.bundle', import.meta.url));
    const boundary = upload.subarray(0, upload.indexOf('\r\n')).toString('utf8').slice(2);
    const parts = await new Response(upload, { headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` } }).formData();
    const originalMetadata = JSON.parse(await parts.get('metadata').text?.() || parts.get('metadata'));
    if ([...parts.keys()].length !== 2 || !originalMetadata.main_module) throw Error('CF_BUNDLE_MODULES_UNEXPECTED');
    source = await parts.get(originalMetadata.main_module).text();
  } else source = built.outputFiles[0].text;
  const odptToken = readLocalToken();
  if (source.includes(odptToken)) throw Error('BUS_SECRET_LEAK');
  report.bundleBytes = Buffer.byteLength(source);
  report.bundleHash = createHash('sha256').update(source).digest('hex');
  const metadata = { main_module: 'worker.js', compatibility_date: config.compatibility_date,
    bindings: [{ type: 'plain_text', name: 'ALLOWED_ORIGINS', text: config.vars.ALLOWED_ORIGINS },
      { type: 'secret_text', name: 'ODPT_ACCESS_TOKEN', text: odptToken }],
    observability: { enabled: true, head_sampling_rate: 1, redact_query_string: true,
      logs: { enabled: true, invocation_logs: true, head_sampling_rate: 1, persist: true },
      traces: { enabled: false } }, logpush: false,
    tags: ['paluru-bus-p0-temporary-validation'] };
  const form = new FormData();
  form.set('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.set('worker.js', new Blob([source], { type: 'application/javascript+module' }), 'worker.js');
  phase = 'upload';
  const uploaded = await cf.api(scriptPath, { method: 'PUT', body: form }); created = true;
  report.startupTimeMs = uploaded.startup_time_ms ?? null;
  phase = 'enable-temporary-url';
  await cf.api(`${scriptPath}/subdomain`, { method: 'POST', json: { enabled: true, previews_enabled: false } });
  console.log(cf.safe({ status: 'TEMPORARY_PROBE_CREATED', name, bundleBytes: report.bundleBytes }));
  await sleep(8000);
  const begin = Date.now();
  const url = `https://${name}.${subdomain}.workers.dev/api/bus/arrivals`;
  for (const kind of ['cold-miss', 'cache-hit-1', 'cache-hit-2', 'refresh-miss', 'cache-hit-3']) {
    if (kind === 'refresh-miss') await sleep(26000);
    phase = kind;
    const start = performance.now();
    const response = await fetch(url, { headers: { Origin: config.vars.ALLOWED_ORIGINS },
      redirect: 'error', signal: AbortSignal.timeout(30000) });
    const raw = await response.text();
    if (raw.includes(odptToken)) throw Error('BUS_SECRET_LEAK');
    const data = response.headers.get('Content-Type')?.includes('application/json') ? JSON.parse(raw) : null;
    const summary = { kind, checkedAt: new Date().toISOString(), httpStatus: response.status,
      wallMs: performance.now() - start, bytes: Buffer.byteLength(raw), ray: response.headers.get('CF-Ray'),
      timing: JSON.parse(response.headers.get('X-Bus-Probe-Timing') || 'null'),
      cors: response.headers.get('Access-Control-Allow-Origin'), fetchError: data?.fetchError,
      directions: data?.directions?.map((d) => ({ id: d.id, rows: d.arrivals.length,
        realtimeRows: d.arrivals.filter((a) => a.realtime).length })) };
    report.requests.push(summary); console.log(cf.safe(summary, [odptToken]));
  }
  phase = 'cpu-logs';
  await sleep(20000);
  const query = await cf.api('/workers/observability/telemetry/query', { method: 'POST', json: {
    queryId: 'paluru-bus-p0-cpu-validation', timeframe: { from: begin - 1000, to: Date.now() },
    view: 'events', limit: 50, dry: true,
    parameters: { filters: [{ key: '$workers.scriptName', operation: 'eq', type: 'string', value: name }], filterCombination: 'and' }
  } });
  const events = query.events?.events || [];
  report.invocations = events.filter((e) => Number.isFinite(e.$workers?.cpuTimeMs)).map((e) => ({
    timestamp: e.timestamp, requestId: e.$workers.requestId, cpuTimeMs: e.$workers.cpuTimeMs,
    wallTimeMs: e.$workers.wallTimeMs, outcome: e.$workers.outcome }));
  report.cpuLimitMs = 10;
  report.cpuPass = report.invocations.length >= report.requests.length && report.invocations.every((r) => r.cpuTimeMs <= 10 && r.outcome === 'ok');
  console.log(cf.safe({ status: 'REMOTE_CPU_RESULTS', ...report }));
} catch (error) {
  report.error = { phase, code: /^[A-Z_]+$/.test(error.message) ? error.message : 'REMOTE_PROBE_FAILED',
    httpStatus: error.httpStatus, apiCodes: error.apiCodes };
  console.log(JSON.stringify(report.error)); process.exitCode = 1;
  if (created && phase === 'cpu-logs' && error.httpStatus === 403) {
    // Wrangler OAuth lacks Observability Write. Read CPU in the signed-in dashboard instead.
    writeFileSync(reportUrl, cf.safe(report), 'utf8');
    console.log('CPU_DASHBOARD_CHECK_PENDING: press Enter after reading CPU; auto-cleanup in 5 minutes.');
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 300000);
      process.stdin.resume();
      process.stdin.once('data', () => { clearTimeout(timer); resolve(); });
    });
    process.stdin.pause();
  }
} finally {
  if (created) {
    try {
      await cf.api(scriptPath, { method: 'DELETE' });
      const scripts = await cf.api('/workers/scripts');
      report.cleanup = !scripts.some((s) => s.id === name);
      report.productionStillAbsent = !scripts.some((s) => s.id === 'paluru-bus-api');
    } catch { report.cleanup = false; process.exitCode = 1; }
  }
  if (cf) {
    writeFileSync(reportUrl, cf.safe(report), 'utf8');
    console.log(cf.safe({ status: 'REMOTE_PROBE_FINISHED', cleanup: report.cleanup, productionDeployed: false }));
  }
}

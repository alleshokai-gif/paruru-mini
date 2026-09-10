// Cloud Run composition: no Worker globals, ZIP parser, build scripts, or secret files.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import source from '../config/static-source.json' with { type: 'json' };
import { validateArtifact } from './static-artifact.js';
import { runtimeConfig } from './config.js';
import { createNodeServer } from './server.js';
import { recordStages } from './metrics.js';
import { createHttpHandler } from '../http/handler.js';
import { createBusService } from '../core/service.js';
import { prepareStatic, getArrivals } from '../core/arrivals.js';
import { fetchRealtime, parseRealtime } from '../providers/kawasaki/adapter.js';

export function start({ env = process.env, log = (v) => console.log(JSON.stringify(v)) } = {}) {
  const started = performance.now(), config = runtimeConfig(env);
  const index = validateArtifact(JSON.parse(readFileSync(new URL('../generated/p0-static.json', import.meta.url), 'utf8')), source.sourceDate);
  prepareStatic(index);
  // Validate feed validity before advertising health. No ODPT call occurs at startup.
  getArrivals({ index, now: Date.now() / 1000 });
  const staticStartupMs = performance.now() - started;
  const adapter = { async getRealtime() {
    const begin = performance.now();
    recordStages({ odptFetches: 1 });
    let bytes;
    try { bytes = await fetchRealtime(config.env.ODPT_ACCESS_TOKEN); }
    finally { recordStages({ odptFetchMs: performance.now() - begin }); }
    const decode = performance.now();
    try { return parseRealtime(bytes, Date.now() / 1000); }
    finally { recordStages({ rtDecodeMs: performance.now() - decode }); }
  } };
  // One provider instance owns its memory cache and pending fetches. No per-direction adapter construction.
  const service = createBusService({ index, adapter, provider: 'kawasaki', version: index.sourceHash, measure: recordStages });
  const handler = createHttpHandler(() => service, { health: true });
  const server = createNodeServer({ handler, env: config.env, measure: log });
  server.listen(config.port, config.host, () => log({ event: 'bus_startup', build: 'bus-p0-cloud-run-v1',
    startupMs: performance.now() - started, staticStartupMs, rssBytes: process.memoryUsage().rss, port: config.port }));
  const shutdown = () => {
    server.close(() => process.exit(0));
    server.closeIdleConnections();
    setTimeout(() => process.exit(0), 9000).unref();
  };
  process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
  server.on('error', () => { log({ event: 'bus_startup_error', code: 'BUS_LISTEN_FAILED' }); process.exitCode = 1; });
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { start(); } catch { console.error('{"event":"bus_startup_error","code":"BUS_STARTUP_INVALID"}'); process.exitCode = 1; }
}

// One RT fetch and three cached calls. Static ZIP is not fetched.
import { readFileSync } from 'node:fs';
import { createKawasakiAdapter } from '../providers/kawasaki/adapter.js';
import { createBusService } from '../worker/service.js';
import { prepareStatic } from '../core/arrivals.js';
import { P0_QUERIES } from '../config/queries.js';
import { KAWASAKI_CONTEXT } from '../providers/kawasaki/context.js';
import { readLocalToken } from './local-secret.js';
try {
  const token = readLocalToken(), staticStarted = performance.now();
  const text = readFileSync(new URL('../generated/p0-static.json', import.meta.url), 'utf8');
  const index = JSON.parse(text);
  prepareStatic(index, P0_QUERIES, KAWASAKI_CONTEXT);
  const startupStaticReadMs = performance.now() - staticStarted;
  const stages = [], fetches = []; let last;
  const adapter = createKawasakiAdapter({ token, fetcher: async (url, init) => {
    const started = performance.now();
    const response = await fetch(url, init); fetches.push({ headersMs: performance.now() - started }); return response;
  } });
  const service = createBusService({ index, adapter, queries: P0_QUERIES, providerContext: KAWASAKI_CONTEXT,
    version: index.sourceHash, measure: (v) => stages.push(v) });
  const samples = [];
  for (let i = 0; i < 4; i++) {
    const started = performance.now(), cpu = process.cpuUsage();
    last = await service.getArrivals();
    const serialStarted = performance.now(), response = JSON.stringify(last), serializationMs = performance.now() - serialStarted;
    if (response.includes(token)) throw Error('BUS_SECRET_LEAK');
    const delta = process.cpuUsage(cpu);
    samples.push({ kind: i ? 'cached' : 'cold', ...stages[i], serializationMs, responseBytes: Buffer.byteLength(response),
      wallMs: performance.now() - started, cpuMs: (delta.user + delta.system) / 1000 });
  }
  if (fetches.length !== 1 || last.fetchError || last.directions.some((d) => d.arrivals.length !== 3)) throw Error('BUS_LIVE_ACCEPTANCE_FAILED');
  console.log(JSON.stringify({ status: 'LIVE_CHECK_PASS', checkedAt: last.generatedAt, startupStaticReadMs, staticBytes: Buffer.byteLength(text),
    samples, rtFetches: fetches.length, fetches, secretLeak: false,
    directions: last.directions.map((d) => ({ id: d.id, state: d.state, rows: d.arrivals.map((a) => ({ scheduled: a.scheduledTime,
      estimated: a.estimatedTime, delayMinutes: a.delayMinutes, etaMinutes: a.etaMinutes, realtime: a.realtime })) })) }));
} catch (error) {
  console.log(JSON.stringify({ error: /^[A-Z_]+$/.test(error?.message || '') ? error.message : 'BUS_LIVE_CHECK_FAILED' }));
  process.exitCode = 1;
}

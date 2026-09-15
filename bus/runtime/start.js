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
import { createKawasakiAdapter } from '../providers/kawasaki/adapter.js';
import { KAWASAKI_CONTEXT } from '../providers/kawasaki/context.js';
import { P0_QUERIES } from '../config/queries.js';
import { KAWASAKI_JOURNEY_QUERIES } from '../providers/kawasaki/journey-config.js';
import { mergeKawasakiStatic, validateKawasakiJourneyArtifact } from '../providers/kawasaki/journey-static.js';
import { loadPosition } from './position.js';
import { createDepartureConfidence } from '../departure/confidence.js';
import { HUBS } from '../hub/config.js';
import { createHubService } from '../hub/service.js';
import { normalizeKawasakiHubResult } from '../providers/kawasaki/hub.js';
import { createTokyuStaticProvider } from '../providers/tokyu/static.js';
import { createSeibuProvider } from '../providers/seibu/provider.js';
import { JOURNEYS } from '../journey/config.js';
import { createJourneyService } from '../journey/service.js';

export function start({ env = process.env, log = (v) => console.log(JSON.stringify(v)) } = {}) {
  const started = performance.now(), config = runtimeConfig(env);
  const p0Index = validateArtifact(JSON.parse(readFileSync(new URL('../generated/p0-static.json', import.meta.url), 'utf8')), source.sourceDate);
  const journeyIndex = validateKawasakiJourneyArtifact(JSON.parse(readFileSync(
    new URL('../generated/kawasaki-p2-5-static.json', import.meta.url), 'utf8')), source.sourceDate);
  const index = mergeKawasakiStatic(p0Index, journeyIndex);
  const queries = Object.freeze([...P0_QUERIES, ...KAWASAKI_JOURNEY_QUERIES]), providerContext = KAWASAKI_CONTEXT;
  prepareStatic(index, queries, providerContext);
  // Validate feed validity before advertising health. No ODPT call occurs at startup.
  getArrivals({ index, queries, providerContext, now: Date.now() / 1000 });
  const staticStartupMs = performance.now() - started;
  // The research-only Position index covers the P0 artifact. P2.5 trips remain unsupported until separately validated.
  const positionStarted=performance.now(),position=loadPosition({index:p0Index,provider:providerContext.id});
  const positionStartupMs=performance.now()-positionStarted;
  const departureConfidence=createDepartureConfidence({index,positionStatic:position.staticData});
  const adapter = createKawasakiAdapter({ token: config.env.ODPT_ACCESS_TOKEN, measure: recordStages });
  // One provider instance owns its memory cache and pending fetches. No per-direction adapter construction.
  const allKawasakiService = createBusService({ index, adapter, queries, providerContext, version: index.sourceHash, measure: recordStages,
    positionObserver:position.observer,departureObserver:departureConfidence,
    originDepartureResolver:value=>departureConfidence.evaluate(value) });
  const p0Ids = new Set(P0_QUERIES.map((query) => query.id));
  const service = { async getArrivals() {
    const data = await allKawasakiService.getArrivals();
    return { ...data, directions: data.directions.filter((direction) => p0Ids.has(direction.id)) };
  } };
  const tokyuProvider = createTokyuStaticProvider({ token: config.env.ODPT_ACCESS_TOKEN });
  const seibuArtifact = JSON.parse(readFileSync(new URL('../generated/seibu-p2-4-static.json', import.meta.url), 'utf8'));
  const seibuProvider = createSeibuProvider({ artifact: seibuArtifact, token: config.env.ODPT_ACCESS_TOKEN });
  const hubService = createHubService({ hubs: HUBS, providerLoaders: {
    kawasaki: async () => normalizeKawasakiHubResult(await allKawasakiService.getArrivals(), { index, queries }),
    tokyu: () => tokyuProvider.getArrivals(),
    seibu: () => seibuProvider.getArrivals()
  } });
  const journeyService = createJourneyService({ journeys: JOURNEYS, hubService });
  const handler = createHttpHandler(() => service, { health: true, hubServiceFactory: () => hubService,
    journeyServiceFactory: () => journeyService });
  const server = createNodeServer({ handler, env: config.env, measure: log });
  server.listen(config.port, config.host, () => log({ event: 'bus_startup', build: 'bus-p2-5-noborito-mukougaoka-poc-v1',
    startupMs: performance.now() - started, staticStartupMs, positionStartupMs, positionStatus:position.status,
    positionIndex:position.stats, rssBytes: process.memoryUsage().rss, port: config.port }));
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

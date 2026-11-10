// Cloud Run composition: no Worker globals, ZIP parser, build scripts, or secret files.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createScheduleStore, createScheduleReader, effectiveAt, sha } from './schedule-store.js';
import { validatePositionArtifact } from '../position/route-index.js';
import { TOKYU_HUB_DIRECTIONS, CALENDARS } from '../providers/tokyu/config.js';
import { fetchTokyuSnapshot } from '../providers/tokyu/static.js';
import { fetchTokyuJourneyTimetables } from '../providers/tokyu/journey-static.js';
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
import { loadShadowPosition } from './shadow-position.js';
import { createStopSequenceObserver } from '../position/stop-sequence.js';
import { createTurnaroundObserver } from '../departure/turnaround-observer.js';
import { createDepartureConfidence } from '../departure/confidence.js';
import { HUBS } from '../hub/config.js';
import { createHubService } from '../hub/service.js';
import { normalizeKawasakiHubResult } from '../providers/kawasaki/hub.js';
import { createTokyuStaticProvider } from '../providers/tokyu/static.js';
import { createTokyuApproachSource, withTokyuApproaches } from '../providers/tokyu/approach.js';
import { createSeibuProvider } from '../providers/seibu/provider.js';
import { SCHOOL_TO_TACHIKAWA_SOURCE } from '../providers/seibu/config.js';
import { JOURNEYS } from '../journey/config.js';
import { createJourneyService } from '../journey/service.js';
import { createRailHomeRouteService } from '../rail/home-route-service.js';
import { createKazuRouteService, KAZU_TRANSFER_MINUTES } from '../rail/kazu-route-service.js';
import { getFutureBuses } from '../journey/future-bus.js';

const read = name => JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));
function kawasakiIndex({p0, journey, position}) {
  const index = mergeKawasakiStatic(validateArtifact(p0, p0.sourceDate),
    validateKawasakiJourneyArtifact(journey, p0.sourceDate));
  validatePositionArtifact(position,index,'kawasaki');
  return index;
}

export function start({ env = process.env, log = (v) => console.log(JSON.stringify(v)) } = {}) {
  const started = performance.now(), config = runtimeConfig(env), token = config.env.ODPT_ACCESS_TOKEN;
  const p0 = validateArtifact(read('../generated/p0-static.json'),source.sourceDate);
  const bundledSeibu = read('../generated/seibu-p2-4-static.json');
  let assets = { kawasaki:{p0,journey:read('../generated/kawasaki-p2-5-static.json'),
    position:read('../generated/p1-position-static.json')},
    seibu:{artifact:bundledSeibu}, tokyu:null };
  let stopReference;
  try { stopReference=read('../generated/shadow-stop-reference.json'); } catch { /* Old build support. */ }
  const fallbackRef = artifact => ({version:artifact.sourceVersion,sourceHash:artifact.sourceHash,
    effectiveAt:effectiveAt(artifact.sourceDate || artifact.feedInfo.feed_start_date),endDate:artifact.feedInfo.feed_end_date,
    fetchedAt:Date.parse(artifact.generatedAt) || (artifact.generatedAtEpoch || 0) * 1000});
  const fallback = {kawasaki:fallbackRef(p0),seibu:fallbackRef(assets.seibu.artifact)};
  const adapter = createKawasakiAdapter({token,measure:recordStages});
  const tokyuApproach = createTokyuApproachSource();
  const odakyuStatic = read('../release-static/rail-odakyu-static.json');
  const jrStatic = read('../release-static/rail-nambu-challenge-static.json');
  const kazuStatic = read('../release-static/kazu-commute-static.json');
  function compose(inputs) {
  const index = kawasakiIndex(inputs.kawasaki);
  const queries = Object.freeze([...P0_QUERIES, ...KAWASAKI_JOURNEY_QUERIES]), providerContext = KAWASAKI_CONTEXT;
  prepareStatic(index, queries, providerContext);
  // An expired image seed must not prevent cold startup from loading the durable snapshot.
  // Only composition is probed at a valid date; live queries still enforce calendar expiry.
  const wallNow = Date.now() / 1000;
  const validationTime = env.BUS_SCHEDULE_BUCKET
    ? Math.min(wallNow,effectiveAt(index.feedInfo.feed_end_date)/1000) : wallNow;
  getArrivals({ index, queries, providerContext, now:validationTime });
  const staticStartupMs = performance.now() - started;
  const positionStarted=performance.now(),position=loadPosition({index,provider:providerContext.id,read:()=>JSON.stringify(inputs.kawasaki.position)});
  const shadowPosition=loadShadowPosition({index,positionStatic:position.staticData,stopReference});
  const stopSequenceObserver=createStopSequenceObserver({index,positionStatic:position.staticData});
  const turnaroundObserver=createTurnaroundObserver({index,positionStatic:position.staticData});
  const positionStartupMs=performance.now()-positionStarted;
  const departureConfidence=createDepartureConfidence({index,positionStatic:position.staticData});
  // One provider instance owns its memory cache and pending fetches. No per-direction adapter construction.
  const allKawasakiService = createBusService({ index, adapter, queries, providerContext, version: index.sourceHash, measure: recordStages,
    positionObserver:position.observer,shadowPositionObserver:shadowPosition.observer,
    stopSequenceObserver,turnaroundObserver,
    departureObserver:departureConfidence,
    originDepartureResolver:value=>departureConfidence.evaluate(value) });
  const p0Ids = new Set(P0_QUERIES.map((query) => query.id));
  const service = { async getArrivals() {
    const data = await allKawasakiService.getArrivals();
    return { ...data, directions: data.directions.filter((direction) => p0Ids.has(direction.id)) };
  } };
  const tokyuProvider = createTokyuStaticProvider({ token,
    ...(inputs.tokyu ? {loadSnapshot:async()=>inputs.tokyu.snapshot} : {}) });
  const seibuProvider = createSeibuProvider({ artifact:inputs.seibu.artifact, token });
  const hubService = createHubService({ hubs: HUBS, providerLoaders: {
    kawasaki: async () => {
      const { data, shadowPositions, stopSequencePositions, turnarounds } = await allKawasakiService.getArrivals({ forHub: true });
      return normalizeKawasakiHubResult(data, { index, queries,
        shadowPositions, stopSequencePositions, turnarounds, shadowArtifact: shadowPosition.stats });
    },
    tokyu: async () => {
      const [staticResult, approaches] = await Promise.all([tokyuProvider.getArrivals(), tokyuApproach.getApproaches()]);
      return withTokyuApproaches(staticResult, approaches);
    },
    seibu: () => seibuProvider.getArrivals()
  } });
  const journeyService = createJourneyService({ journeys: JOURNEYS, hubService });
  const railHomeRouteService = createRailHomeRouteService({ odakyuStatic, jrStatic,
    futureIndex: index, futureQueries: queries, providerContext, adapter,
    odptToken: token, challengeEnv: env,
    loadAccessBuses: (query) => seibuProvider.getAccessBuses(query),
    loadTokyuIndex: () => inputs.tokyu?.journey ?? fetchTokyuJourneyTimetables(token) });
  const commuteQueries = Object.freeze({ noborito: ['noborito_to_home',
    'noborito_tamagawa_to_kibukihoncho'], mizonokuchi: ['mizonokuchi_to_home'] });
  const kazuRouteService = createKazuRouteService({ artifact: kazuStatic,
    loadBuses: async ({ terminal, boardingAt, now }) => {
      let realtime = null;
      try { realtime = await adapter.getRealtime(); }
      catch { /* Future Bus keeps its scheduled candidates. */ }
      return commuteQueries[terminal].flatMap((queryId) => getFutureBuses({ index,
        queries: queries.filter((query) => query.id === queryId), providerContext, realtime,
        now, boardingAt: boardingAt + (queryId === 'noborito_tamagawa_to_kibukihoncho'
          ? (KAZU_TRANSFER_MINUTES.noborito_tamagawa - KAZU_TRANSFER_MINUTES.noborito) * 60 : 0),
        limit: 100 }).results.flatMap((group) => group.arrivals));
    } });
  return { service,hubService,journeyService,railHomeRouteService,kazuRouteService,
    staticStartupMs,positionStartupMs,position,shadowPosition };
  }
  let current = compose(assets);
  const schedule = env.BUS_SCHEDULE_BUCKET ? createScheduleReader({
    store:createScheduleStore(env.BUS_SCHEDULE_BUCKET),log,
    accept(provider, payload, ref) {
      if (provider === 'tokyu') {
        const snap = payload.snapshot;
        if (!Number.isFinite(snap?.fetchedAt) || snap.directions?.length !== TOKYU_HUB_DIRECTIONS.length)
          throw Error('SCHEDULE_TOKYU_INVALID');
        const directions = TOKYU_HUB_DIRECTIONS.map(query => {
          const row = snap.directions.find(d => d.query?.sourceId === query.sourceId);
          if (!row || JSON.stringify(row.query) !== JSON.stringify(query) ||
            Object.values(CALENDARS).some(calendar => !row.calendars?.[calendar]?.length
              || row.calendars[calendar].some((t,i,list)=>!Number.isInteger(t)||t<0||t>=86400||i>0&&t<=list[i-1])))
            throw Error('SCHEDULE_TOKYU_INVALID');
          return {...row,query};
        });
        if (sha(JSON.stringify([directions.map(d=>[d.query.sourceId,d.calendars]),payload.journey])) !== ref.sourceHash)
          throw Error('SCHEDULE_TOKYU_INVALID');
        payload = {...payload,snapshot:{...snap,directions}};
      } else {
        const artifact = provider === 'kawasaki' ? payload.p0 : payload.artifact;
        if (artifact?.sourceHash !== ref.sourceHash || artifact.sourceVersion !== ref.version
          || artifact.feedInfo.feed_end_date !== ref.endDate || effectiveAt(artifact.feedInfo.feed_start_date) > Date.now())
          throw Error('SCHEDULE_ARTIFACT_MISMATCH');
      }
      // An older durable snapshot with the exact same GTFS hash has the
      // same trips, but predates the destination-arrival field.
      if (provider === 'seibu' && payload.artifact.sourceHash === bundledSeibu.sourceHash
        && !payload.artifact.directions[SCHOOL_TO_TACHIKAWA_SOURCE].some(
          (row) => Number.isFinite(row.scheduledArrivalSeconds))) {
        payload = {...payload,artifact:bundledSeibu};
      }
      const next = {...assets,[provider]:payload};
      const composition = compose(next);
      assets = next; current = composition;
    }
  }) : null;
  const api = createHttpHandler(() => current.service, { health: true, hubServiceFactory: () => current.hubService,
    journeyServiceFactory: () => current.journeyService,
    railHomeRouteServiceFactory: () => current.railHomeRouteService,
    kazuRouteServiceFactory: () => current.kazuRouteService,
    scheduleStatus: () => schedule?.status(fallback) ?? null });
  let initialRead;
  const handler = { async fetch(request,env) {
    if (schedule && request.method === 'GET' && new URL(request.url).pathname.startsWith('/api/bus/')) {
      const poll = schedule.poll();
      // Bound the cold request's wait for the durable state. Health and later polls never wait.
      initialRead ??= Promise.race([poll,new Promise(resolve=>setTimeout(resolve,1200).unref())]);
      await initialRead;
    }
    return api.fetch(request,env);
  } };
  const server = createNodeServer({ handler, env: config.env, measure: log });
  const {staticStartupMs,positionStartupMs,position,shadowPosition} = current;
  server.listen(config.port, config.host, () => log({ event: 'bus_startup', build: 'bus-static-refresh-v1',
    startupMs: performance.now() - started, staticStartupMs, positionStartupMs, positionStatus:position.status,
    positionIndex:position.stats, shadowPositionStatus:shadowPosition.status, staticVersion:p0.sourceVersion,
    seibuVersion:assets.seibu.artifact.sourceVersion, rssBytes: process.memoryUsage().rss, port: config.port }));
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

// Read-only one-feed smoke. Prints counts only; no trip, vehicle, coordinate or token values.
import { readFileSync } from 'node:fs';
import { readLocalToken } from './local-secret.js';
import { validateArtifact } from '../runtime/static-artifact.js';
import { validateKawasakiJourneyArtifact, mergeKawasakiStatic } from '../providers/kawasaki/journey-static.js';
import { P0_QUERIES } from '../config/queries.js';
import { KAWASAKI_JOURNEY_QUERIES } from '../providers/kawasaki/journey-config.js';
import { KAWASAKI_CONTEXT } from '../providers/kawasaki/context.js';
import { createKawasakiAdapter } from '../providers/kawasaki/adapter.js';
import { loadPosition } from '../runtime/position.js';
import { loadShadowPosition } from '../runtime/shadow-position.js';
import { createStopSequenceObserver } from '../position/stop-sequence.js';
import { createTurnaroundObserver } from '../departure/turnaround-observer.js';
import { createDepartureConfidence } from '../departure/confidence.js';
import { createBusService } from '../core/service.js';
import { normalizeKawasakiHubResult } from '../providers/kawasaki/hub.js';
import source from '../config/static-source.json' with { type: 'json' };

try {
  const p0 = validateArtifact(JSON.parse(readFileSync(new URL('../generated/p0-static.json', import.meta.url))), source.sourceDate);
  const journey = validateKawasakiJourneyArtifact(JSON.parse(readFileSync(
    new URL('../generated/kawasaki-p2-5-static.json', import.meta.url))), source.sourceDate);
  const index = mergeKawasakiStatic(p0, journey);
  const queries = [...P0_QUERIES, ...KAWASAKI_JOURNEY_QUERIES];
  const position = loadPosition({ index, provider: KAWASAKI_CONTEXT.id });
  const shadow = loadShadowPosition({ index, positionStatic: position.staticData });
  const sequence = createStopSequenceObserver({ index, positionStatic: position.staticData });
  const turnaround = createTurnaroundObserver({ index, positionStatic: position.staticData });
  const departure = createDepartureConfidence({ index, positionStatic: position.staticData });
  const rt = await createKawasakiAdapter({ token: readLocalToken() }).getRealtime();
  const service = createBusService({ index, queries, providerContext: KAWASAKI_CONTEXT, version: index.sourceHash,
    adapter: { getRealtime: async () => rt }, now: () => Date.now() / 1000,
    shadowPositionObserver: shadow.observer, stopSequenceObserver: sequence, turnaroundObserver: turnaround,
    departureObserver: departure, originDepartureResolver: (value) => departure.evaluate(value) });
  const { data, shadowPositions, stopSequencePositions, turnarounds } = await service.getArrivals({ forHub: true });
  const normalized = normalizeKawasakiHubResult(data, { index, queries, shadowPositions,
    stopSequencePositions, turnarounds, shadowArtifact: shadow.stats });
  const groups = Object.fromEntries(queries.map(({ id }) => [id, {
    staticTrips: new Set(index.directions[id].map((row) => row.tripId)).size,
    displayed: normalized.arrivals.filter((row) => row.sourceId === id).length,
    realtimeEta: normalized.arrivals.filter((row) => row.sourceId === id && row.etaMinutes !== null).length,
    stopSequence: normalized.arrivals.filter((row) => row.sourceId === id
      && row.position.fidelity === 'stop_sequence').length,
    geometry: normalized.arrivals.filter((row) => row.sourceId === id && row.position.shadowReady === true).length
  }]));
  console.log(JSON.stringify({ status: 'PROGRESSIVE_LOCATION_LIVE_READ', queryCount: queries.length,
    feedVehicles: rt.vehicles.length, stopSequenceCandidates: stopSequencePositions.size,
    geometryCandidates: shadowPositions.size, shadowStatus: shadow.status, groups }));
} catch {
  console.log('{"status":"PROGRESSIVE_LOCATION_LIVE_FAILED"}');
  process.exitCode = 1;
}

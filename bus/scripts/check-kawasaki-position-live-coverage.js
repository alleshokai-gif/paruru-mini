// Read-only one-feed audit. Output is counts only: no trip/vehicle ID or GPS.
import { readFileSync } from 'node:fs';
import { readLocalToken } from './local-secret.js';
import { createKawasakiAdapter } from '../providers/kawasaki/adapter.js';
import { mergeKawasakiStatic } from '../providers/kawasaki/journey-static.js';
import { P0_QUERIES } from '../config/queries.js';
import { KAWASAKI_JOURNEY_QUERIES } from '../providers/kawasaki/journey-config.js';
import { KAWASAKI_CONTEXT } from '../providers/kawasaki/context.js';
import { createBusService } from '../core/service.js';
import { loadPosition } from '../runtime/position.js';
import { loadShadowPosition } from '../runtime/shadow-position.js';
import { normalizeKawasakiHubResult } from '../providers/kawasaki/hub.js';

const read = name => JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));
const index = mergeKawasakiStatic(read('../generated/p0-static.json'), read('../generated/kawasaki-p2-5-static.json'));
const queries = [...P0_QUERIES, ...KAWASAKI_JOURNEY_QUERIES];
const position = loadPosition({ index, provider: 'kawasaki' });
if (!position.staticData) throw Error('POSITION_LIVE_SIDECAR_INVALID');
const shadow = loadShadowPosition({ index, positionStatic: position.staticData });
if (shadow.status !== 'shadow_geometry_loaded') throw Error('POSITION_LIVE_SHADOW_INVALID');
const adapter = createKawasakiAdapter({ token: readLocalToken() });
try {
  const realtime = await adapter.getRealtime();
  const vehicleTrips = new Set(realtime.vehicles.map(vehicle => vehicle.trip?.tripId).filter(Boolean));
  const service = createBusService({ index, adapter: { getRealtime: async () => realtime }, queries,
    providerContext: KAWASAKI_CONTEXT, version: index.sourceHash,
    positionObserver: position.observer, shadowPositionObserver: shadow.observer });
  const { data, shadowPositions } = await service.getArrivals({ forHub: true });
  const dto = normalizeKawasakiHubResult(data, { index, queries, shadowPositions, shadowArtifact: shadow.stats });
  const byQuery = Object.fromEntries(queries.map(query => {
    const rows = index.directions[query.id] || [];
    const matched = rows.filter(row => vehicleTrips.has(row.tripId));
    const active = data.directions.find(direction => direction.id === query.id);
    const visible = dto.arrivals.filter(row => row.sourceId === query.id);
    return [query.id, { staticRows: rows.length, vpTripJoined: matched.length,
      nextArrivals: active?.arrivals?.length || 0, hubDtoRows: visible.length,
      hubPositionSupported: visible.filter(row => row.position?.supported).length,
      hubPositionWaiting: visible.filter(row => !row.position?.supported).length }];
  }));
  const gate = shadow.observer.summary();
  console.log(JSON.stringify({ status: 'KAWASAKI_POSITION_LIVE_COVERAGE',
    fetchedAt: new Date(realtime.fetchedAt * 1000).toISOString(),
    parsedVehiclePositionCount: realtime.vehicles.length, targetVehicleTrips: [...vehicleTrips]
      .filter(tripId => position.staticData.trips[tripId]).length,
    supportedChains: shadow.stats.supportedChains,
    gate: { evaluated: gate.evaluated, supported: gate.supported, reasons: gate.reasons }, queries: byQuery }));
} catch {
  console.log(JSON.stringify({ status: 'KAWASAKI_POSITION_LIVE_UNAVAILABLE' }));
  process.exitCode = 1;
}

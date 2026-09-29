import { readFileSync } from 'node:fs';
import { prepareShape } from '../position/geometry.js';
import { createPositionObserver } from '../position/observer.js';

const unavailable = status => ({ observer: null, status,
  stats: { supportedChains: 0, geometrySources: [] } });
const fail = () => { throw Error('SHADOW_GEOMETRY_INVALID'); };

export function terminalCorridor(approved, other, target) {
  let common = 0;
  while (common < Math.min(approved.length, other.length)
    && approved[approved.length - 1 - common].id === other[other.length - 1 - common].stopId) common++;
  if (common < 3) return null;
  const approvedStart = approved.length - common, otherStart = other.length - common;
  const offset = other[otherStart].sequence - approved[approvedStart].sequence;
  if (!other.slice(otherStart).every((stop, ordinal) =>
    stop.stopId === approved[approvedStart + ordinal].id
    && stop.sequence === approved[approvedStart + ordinal].sequence + offset)) return null;
  const targetOrdinal = other.findIndex((stop) =>
    stop.stopId === target.fromStopId && stop.sequence === target.stopSequence);
  // Require the boarding stop and two preceding stops inside the verified corridor.
  if (targetOrdinal < otherStart + 2) return null;
  return { approvedStart, entrySequence: other[otherStart].sequence,
    entryAlong: approved[approvedStart].along, sequenceOffset: offset };
}

function validatedSource(bundle, positionStatic) {
  if (bundle?.schemaVersion !== 1 || bundle.staticSourceHash !== positionStatic?.sourceHash
    || bundle.sources?.length !== 1) fail();
  const source = bundle.sources[0];
  if (source.schemaVersion !== 1 || source.provider !== 'kawasaki'
    || source.routeId !== '10044' || source.directionId !== 'home_to_noborito'
    || source.sourceType !== 'validated_road_geometry'
    || source.sourceVersion !== 'osm:7109917:v14+mlit:n07:2022'
    || source.approvalVersion !== 'p3.3-shadow-1'
    || source.staticSourceHash !== positionStatic.sourceHash
    || source.approvedForShadow !== true || source.approvedForPublic !== false
    || source.geometryReady !== false || source.validation?.status !== 'approved_for_stage_1_shadow'
    || source.validation.pointCount !== 281 || source.validation.gapCount !== 0
    || source.validation.stopCount !== 20 || source.validation.stopProjectionOrderValid !== true
    || source.validation.selfIntersectionCount !== 0) fail();
  const entries = Object.entries(source.chains || {});
  if (entries.length !== 1) fail();
  const [chainId, candidate] = entries[0], chain = positionStatic.chains?.[chainId];
  if (!chain || candidate.eligible !== false || candidate.geometryReady !== false
    || candidate.approvedForShadow !== true || candidate.approvedForPublic !== false
    || candidate.points?.length !== 281 || candidate.stopProjections?.length !== 20
    || chain.stops.length !== 20 || candidate.corridor?.fromStopId !== '184_2'
    || candidate.corridor?.toStopId !== '362_1') fail();
  let previous = -1;
  for (const [ordinal, projection] of candidate.stopProjections.entries()) {
    const stop = chain.stops[ordinal];
    if (projection.ordinal !== ordinal || projection.stopId !== stop.stopId
      || projection.sequence !== stop.sequence || !Number.isFinite(projection.along)
      || projection.along <= previous + (ordinal ? 1 : 0)) fail();
    previous = projection.along;
  }
  return { source, chainId, candidate };
}

// This index exists only for the family Shadow display. The public Route Index
// still rejects the artifact's eligible=false and geometryReady=false flags.
export function loadShadowPosition({ index, positionStatic,
  read = () => readFileSync(new URL('../release-static/position-shadow-geometry.json', import.meta.url), 'utf8') } = {}) {
  try {
    const raw = read();
    if (Buffer.byteLength(raw) > 2 * 1024 * 1024) throw Error('SHADOW_GEOMETRY_SIZE');
    const { source, chainId, candidate } = validatedSource(JSON.parse(raw), positionStatic);
    const geometry = prepareShape(candidate.points);
    const stops = candidate.stopProjections.map((projection, ordinal) => {
      const stop = positionStatic.stops[projection.stopId];
      if (!stop?.name || !stop.position || projection.along < 0
        || projection.along > geometry.total + 1 || projection.ordinal !== ordinal)
        throw Error('SHADOW_GEOMETRY_STOP');
      return { id: projection.stopId, name: stop.name, sequence: projection.sequence,
        ordinal, along: projection.along, position: stop.position };
    });
    const trips = positionStatic.trips;
    const sharedChains = new Map();
    const direction = index.directions[source.directionId];
    if (!Array.isArray(direction) || !direction.some(row => row.routeId === source.routeId
      && row.fromStopId === candidate.corridor.fromStopId)) throw Error('SHADOW_GEOMETRY_TARGET');
    for (const row of direction) {
      if (row.routeId !== source.routeId || row.fromStopId !== candidate.corridor.fromStopId) continue;
      const trip = trips[row.tripId], other = positionStatic.chains[trip?.chainId];
      if (!trip || trip.routeId !== source.routeId || !other) throw Error('SHADOW_GEOMETRY_TRIP');
      if (trip.chainId === chainId || sharedChains.has(trip.chainId)) continue;
      const shared = terminalCorridor(stops, other.stops, row);
      if (shared) sharedChains.set(trip.chainId, shared);
    }
    const routeIndex = {
      provider: source.provider, sourceHash: positionStatic.sourceHash,
      getTrip(tripId) {
        const trip = trips[tripId];
        const shared = sharedChains.get(trip?.chainId);
        if (trip?.routeId !== source.routeId || trip.chainId !== chainId && !shared) return null;
        return { ...trip, supported: true, geometry,
          stops: shared ? stops.slice(shared.approvedStart).map((stop, ordinal) =>
            ({ ...stop, ordinal, sequence: stop.sequence + shared.sequenceOffset })) : stops,
          ...(shared ? { sharedCorridorEntrySequence: shared.entrySequence,
            sharedCorridorEntryAlong: shared.entryAlong } : {}),
          geometrySourceType: source.sourceType, geometrySourceVersion: source.sourceVersion,
          geometryId: candidate.geometryId };
      }
    };
    const scopedIndex = { ...index, directions: { [source.directionId]: direction.filter(row =>
      row.routeId === source.routeId && row.fromStopId === candidate.corridor.fromStopId) } };
    const observer = createPositionObserver({ routeIndex, index: scopedIndex });
    return {
      observer, status: 'shadow_geometry_loaded',
      stats: { supportedChains: 1 + sharedChains.size, sharedCorridorChains: sharedChains.size,
        geometrySources: [source.sourceType],
        routeId: source.routeId, directionId: source.directionId,
        approvalVersion: source.approvalVersion, approvedForShadow: true,
        approvedForPublic: false, geometryReady: false }
    };
  } catch {
    return unavailable('shadow_geometry_unavailable');
  }
}

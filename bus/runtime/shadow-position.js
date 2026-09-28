import { readFileSync } from 'node:fs';
import { prepareShape } from '../position/geometry.js';
import { createPositionObserver } from '../position/observer.js';

const unavailable = status => ({ observer: null, status,
  stats: { supportedChains: 0, geometrySources: [] } });
const fail = () => { throw Error('SHADOW_GEOMETRY_INVALID'); };

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
    const routeIndex = {
      provider: source.provider, sourceHash: positionStatic.sourceHash,
      getTrip(tripId) {
        const trip = trips[tripId];
        return trip?.chainId === chainId && trip.routeId === source.routeId
          ? { ...trip, supported: true, geometry, stops,
            geometrySourceType: source.sourceType, geometrySourceVersion: source.sourceVersion,
            geometryId: candidate.geometryId } : null;
      }
    };
    const direction = index.directions[source.directionId];
    if (!Array.isArray(direction) || !direction.some(row => row.routeId === source.routeId
      && row.fromStopId === candidate.corridor.fromStopId)) throw Error('SHADOW_GEOMETRY_TARGET');
    const scopedIndex = { ...index, directions: { [source.directionId]: direction.filter(row =>
      row.routeId === source.routeId && row.fromStopId === candidate.corridor.fromStopId) } };
    const observer = createPositionObserver({ routeIndex, index: scopedIndex });
    return {
      observer, status: 'shadow_geometry_loaded',
      stats: { supportedChains: 1, geometrySources: [source.sourceType],
        routeId: source.routeId, directionId: source.directionId,
        approvalVersion: source.approvalVersion, approvedForPublic: false, geometryReady: false }
    };
  } catch {
    return unavailable('shadow_geometry_unavailable');
  }
}

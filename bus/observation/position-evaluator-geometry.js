import { validPoint } from '../position/geometry.js';

export const POSITION_GEOMETRY_SOURCE_PRIORITY = Object.freeze({
  gtfs_shape: 0,
  official_odpt_geometry: 1,
  validated_road_geometry: 2,
  observed_corridor: 3
});

export function validatePositionGeometryBundle(bundle, positionStatic) {
  if (!bundle || bundle.schemaVersion !== 1 || bundle.staticSourceHash !== positionStatic?.sourceHash
    || !Array.isArray(bundle.sources)) throw Error('POSITION_GEOMETRY_BUNDLE_INVALID');
  for (const source of bundle.sources) {
    if (!source || source.schemaVersion !== 1 || !Object.hasOwn(POSITION_GEOMETRY_SOURCE_PRIORITY, source.sourceType)
      || source.provider !== positionStatic.provider || source.staticSourceHash !== positionStatic.sourceHash
      || typeof source.sourceVersion !== 'string' || !source.sourceVersion
      || !Number.isFinite(Date.parse(source.generatedAt || '')) || typeof source.directionId !== 'string'
      || !source.chains || typeof source.chains !== 'object') throw Error('POSITION_GEOMETRY_BUNDLE_INVALID');
    for (const chain of Object.values(source.chains)) {
      if (!chain || typeof chain.geometryId !== 'string' || !chain.geometryId
        || !Array.isArray(chain.points) || chain.points.length < 2 || chain.points.some((point) => !validPoint(point)))
        throw Error('POSITION_GEOMETRY_BUNDLE_INVALID');
    }
  }
  return bundle;
}

export function selectPositionGeometry({ bundle, positionStatic, target }) {
  validatePositionGeometryBundle(bundle, positionStatic);
  const candidates = bundle.sources.filter((source) => source.provider === target.provider
    && source.directionId === target.directionId
    && Object.keys(source.chains).some((chainId) => positionStatic.chains?.[chainId]
      && positionStatic.chains[chainId].stops.some((stop) => stop.stopId === target.targetStopId)))
    .sort((left, right) => POSITION_GEOMETRY_SOURCE_PRIORITY[left.sourceType]
      - POSITION_GEOMETRY_SOURCE_PRIORITY[right.sourceType]);
  if (!candidates.length) return null;
  const bestPriority = POSITION_GEOMETRY_SOURCE_PRIORITY[candidates[0].sourceType];
  if (candidates.filter((source) => POSITION_GEOMETRY_SOURCE_PRIORITY[source.sourceType] === bestPriority).length !== 1)
    throw Error('POSITION_GEOMETRY_SOURCE_AMBIGUOUS');
  return candidates[0];
}

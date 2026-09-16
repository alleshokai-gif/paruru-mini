import { projectRoadStops } from '../position/road-geometry.js';
import { validPoint } from '../position/geometry.js';

export const NOBORITO_SHADOW_GEOMETRY = Object.freeze({
  provider: 'kawasaki', routeId: '10044', directionId: 'home_to_noborito',
  relationId: 7109917, relationVersion: 14, sourceVersion: 'osm:7109917:v14+mlit:n07:2022',
  pointCount: 281, wayCount: 39, stopCount: 20, chainStartStopId: '234_1',
  corridorStartStopId: '184_2', targetStopId: '362_1', approvalVersion: 'p3.3-shadow-1'
});

const SHA256 = /^[a-f0-9]{64}$/;
const finite = (value) => Number.isFinite(value);
const round = (value, digits = 6) => Number(Number(value).toFixed(digits));

function properSelfIntersections(points) {
  const origin = points[0], radians = Math.PI / 180, radius = 6371008.8;
  const scale = Math.cos(origin.lat * radians), rows = points.map((point) => ({
    x: (point.lon - origin.lon) * radians * radius * scale,
    y: (point.lat - origin.lat) * radians * radius
  }));
  const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  let count = 0;
  for (let left = 0; left < rows.length - 1; left++) for (let right = left + 2; right < rows.length - 1; right++) {
    const a = rows[left], b = rows[left + 1], c = rows[right], d = rows[right + 1];
    const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
    if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0))
      && ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) count++;
  }
  return count;
}

function assertCandidate(roadArtifact, positionStatic) {
  const expected = NOBORITO_SHADOW_GEOMETRY;
  if (!roadArtifact || roadArtifact.schemaVersion !== 1 || roadArtifact.provider !== expected.provider
    || roadArtifact.sourceType !== 'validated_road_geometry' || roadArtifact.sourceVersion !== expected.sourceVersion
    || roadArtifact.staticSourceHash !== positionStatic?.sourceHash || roadArtifact.directionId !== expected.directionId
    || !Number.isFinite(Date.parse(roadArtifact.generatedAt || ''))) throw Error('SHADOW_GEOMETRY_SOURCE_INVALID');
  const entries = Object.entries(roadArtifact.chains || {});
  if (entries.length !== 1) throw Error('SHADOW_GEOMETRY_SOURCE_INVALID');
  const [chainId, candidate] = entries[0], chain = positionStatic.chains?.[chainId];
  if (!chain || chain.stops.length !== expected.stopCount || chain.stops[0]?.stopId !== expected.chainStartStopId
    || chain.stops.at(-1)?.stopId !== expected.targetStopId || candidate?.route?.ref !== '登05'
    || candidate.route.wayCount !== expected.wayCount || candidate.route.gaps !== 0 || candidate.route.gapMeters !== 0
    || candidate.points?.length !== expected.pointCount || candidate.points.some((point) => !validPoint(point)))
    throw Error('SHADOW_GEOMETRY_SOURCE_INVALID');
  const osm = roadArtifact.attribution?.osm, mlit = roadArtifact.attribution?.mlit;
  if (osm?.relationId !== expected.relationId || osm.version !== expected.relationVersion
    || osm.license !== 'ODbL 1.0' || !SHA256.test(osm.sourceSha256 || '')
    || mlit?.year !== 2022 || !SHA256.test(mlit.sourceSha256 || '')
    || !mlit.termsUrl || !mlit.siteAttribution) throw Error('SHADOW_GEOMETRY_PROVENANCE_INVALID');
  const evidence = candidate.evidence;
  if (evidence?.stops?.total !== expected.stopCount || evidence.stops.projected !== expected.stopCount
    || evidence.officialRoad?.points !== expected.pointCount || evidence.officialRoad.matchRate !== 1
    || evidence.gps?.evaluatedTraces !== 10 || evidence.gps.monotonicTrips !== 10
    || evidence.gps.monotonicRate !== 1) throw Error('SHADOW_GEOMETRY_VALIDATION_INVALID');
  return { chainId, chain, candidate, osm, mlit };
}

export function buildApprovedPositionShadowBundle({ roadArtifact, positionStatic } = {}) {
  const expected = NOBORITO_SHADOW_GEOMETRY;
  const { chainId, chain, candidate, osm, mlit } = assertCandidate(roadArtifact, positionStatic);
  const projection = projectRoadStops({ points: candidate.points, chain, stops: positionStatic.stops });
  if (!projection.orderValid || projection.rows.length !== expected.stopCount
    || JSON.stringify(projection.ambiguousStopIds) !== JSON.stringify([expected.targetStopId]))
    throw Error('SHADOW_GEOMETRY_STOP_PROJECTION_INVALID');
  const corridorStartOrdinal = projection.rows.findIndex((row) => row.stopId === expected.corridorStartStopId);
  const targetOrdinal = projection.rows.findIndex((row) => row.stopId === expected.targetStopId);
  if (corridorStartOrdinal < 0 || targetOrdinal !== expected.stopCount - 1 || corridorStartOrdinal >= targetOrdinal)
    throw Error('SHADOW_GEOMETRY_CORRIDOR_INVALID');
  const selfIntersectionCount = properSelfIntersections(candidate.points);
  if (selfIntersectionCount !== 0) throw Error('SHADOW_GEOMETRY_SELF_INTERSECTION');
  const publicGateReasons = [...new Set(candidate.reasons || [])].sort();
  const source = {
    schemaVersion: 1, provider: expected.provider, routeId: expected.routeId, directionId: expected.directionId,
    sourceType: 'validated_road_geometry', sourceVersion: expected.sourceVersion,
    staticSourceHash: positionStatic.sourceHash, generatedAt: roadArtifact.generatedAt,
    approvedForShadow: true, approvedForPublic: false, geometryReady: false,
    approvalVersion: expected.approvalVersion,
    dataLicense: { name: 'Open Data Commons Open Database License', version: '1.0',
      url: 'https://opendatacommons.org/licenses/odbl/1-0/' },
    sourceReferences: [
      { type: 'osm_route_relation', url: `https://www.openstreetmap.org/relation/${expected.relationId}`,
        copyrightUrl: osm.url, relationId: osm.relationId, version: osm.version,
        timestamp: osm.timestamp, sha256: osm.sourceSha256 },
      { type: 'mlit_n07_corroboration', url: mlit.url, termsUrl: mlit.termsUrl,
        attribution: mlit.siteAttribution, processedAttribution: mlit.text, year: mlit.year, sha256: mlit.sourceSha256 },
      { type: 'gtfs_stop_sequence', sourceVersion: positionStatic.sourceVersion,
        sourceHash: positionStatic.sourceHash, chainId }
    ],
    validation: {
      status: 'approved_for_stage_1_shadow', pointCount: candidate.points.length,
      wayCount: candidate.route.wayCount, gapCount: candidate.route.gaps,
      gapMeters: candidate.route.gapMeters, routeLengthMeters: round(projection.routeLengthMeters, 3),
      selfIntersectionCount, stopCount: projection.rows.length, stopProjectionOrderValid: projection.orderValid,
      stopProjectionAmbiguous: projection.ambiguous,
      stopProjectionAmbiguousStopIds: projection.ambiguousStopIds,
      stopProjectionResolution: 'terminal_route_end_order_constraint',
      n07LineCount: candidate.evidence.officialRoad.lines,
      n07MatchRate: candidate.evidence.officialRoad.matchRate,
      n07P95DistanceMeters: round(candidate.evidence.officialRoad.p95DistanceMeters, 3),
      gpsEvaluated: candidate.evidence.gps.evaluated, gpsMatched: candidate.evidence.gps.matched,
      gpsMatchRate: candidate.evidence.gps.matchRate,
      gpsP95DistanceMeters: round(candidate.evidence.gps.p95DistanceMeters, 3),
      independentTrips: candidate.evidence.gps.independentTrips,
      monotonicTrips: candidate.evidence.gps.monotonicTrips,
      gpsProjectionAmbiguousCount: candidate.rejected?.gps_projection_ambiguous || 0,
      publicGateReasons
    },
    chains: {
      [chainId]: {
        geometryId: candidate.geometryId, eligible: false, geometryReady: false,
        approvedForShadow: true, approvedForPublic: false,
        points: candidate.points,
        stopProjections: projection.rows.map((row) => ({ stopId: row.stopId, sequence: row.sequence,
          ordinal: row.ordinal, along: round(row.along, 3), distance: round(row.distance, 3) })),
        corridor: { fromStopId: expected.corridorStartStopId, fromOrdinal: corridorStartOrdinal,
          toStopId: expected.targetStopId, toOrdinal: targetOrdinal },
        route: candidate.route, evidence: candidate.evidence,
        rejected: candidate.rejected, reasons: publicGateReasons
      }
    }
  };
  return Object.freeze({ schemaVersion: 1, staticSourceHash: positionStatic.sourceHash,
    generatedAt: roadArtifact.generatedAt, sources: Object.freeze([Object.freeze(source)]) });
}

export function validateApprovedPositionShadowBundle(bundle, positionStatic) {
  if (!bundle || bundle.schemaVersion !== 1 || bundle.staticSourceHash !== positionStatic?.sourceHash
    || !Number.isFinite(Date.parse(bundle.generatedAt || '')) || bundle.sources?.length !== 1)
    throw Error('POSITION_SHADOW_BUNDLE_INVALID');
  const source = bundle.sources[0], expected = NOBORITO_SHADOW_GEOMETRY;
  if (source.provider !== expected.provider || source.routeId !== expected.routeId
    || source.directionId !== expected.directionId || source.sourceVersion !== expected.sourceVersion
    || source.approvedForShadow !== true || source.approvedForPublic !== false
    || source.geometryReady !== false || source.approvalVersion !== expected.approvalVersion
    || source.validation?.status !== 'approved_for_stage_1_shadow'
    || source.validation.pointCount !== expected.pointCount || source.validation.gapCount !== 0
    || source.validation.stopCount !== expected.stopCount || source.validation.stopProjectionOrderValid !== true
    || source.validation.selfIntersectionCount !== 0) throw Error('POSITION_SHADOW_BUNDLE_INVALID');
  const entries = Object.entries(source.chains || {});
  if (entries.length !== 1) throw Error('POSITION_SHADOW_BUNDLE_INVALID');
  const [chainId, candidate] = entries[0], chain = positionStatic.chains?.[chainId];
  if (!chain || candidate.eligible !== false || candidate.geometryReady !== false
    || candidate.approvedForShadow !== true || candidate.approvedForPublic !== false
    || candidate.points?.length !== expected.pointCount || candidate.stopProjections?.length !== expected.stopCount)
    throw Error('POSITION_SHADOW_BUNDLE_INVALID');
  let previousAlong = -1;
  for (let index = 0; index < candidate.stopProjections.length; index++) {
    const row = candidate.stopProjections[index], stop = chain.stops[index];
    if (row.stopId !== stop.stopId || row.sequence !== stop.sequence || row.ordinal !== index
      || !finite(row.along) || row.along <= previousAlong + (index ? 1 : 0) || !finite(row.distance) || row.distance < 0)
      throw Error('POSITION_SHADOW_BUNDLE_INVALID');
    previousAlong = row.along;
  }
  return bundle;
}

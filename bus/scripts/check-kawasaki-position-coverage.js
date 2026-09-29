// Read-only inventory of every Kawasaki row selectable by the current Hub/P0 queries.
import { readFileSync } from 'node:fs';
import { mergeKawasakiStatic } from '../providers/kawasaki/journey-static.js';
import { validatePositionArtifact } from '../position/route-index.js';
import { loadShadowPosition, terminalCorridor } from '../runtime/shadow-position.js';

const read = (name) => JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));
const p0 = read('../generated/p0-static.json');
const journey = read('../generated/kawasaki-p2-5-static.json');
const position = read('../generated/p1-position-static.json');
const bundle = read('../release-static/position-shadow-geometry.json');
const index = mergeKawasakiStatic(p0, journey);
validatePositionArtifact(position, p0, 'kawasaki');
const shadow = loadShadowPosition({ index: p0, positionStatic: position });
if (shadow.status !== 'shadow_geometry_loaded' || bundle.sources.length !== 1) {
  throw Error('POSITION_COVERAGE_GEOMETRY_INVALID');
}
const source = bundle.sources[0];
const [approvedChainId, approved] = Object.entries(source.chains)[0];
const approvedStops = approved.stopProjections.map((stop) =>
  ({ id: stop.stopId, sequence: stop.sequence, along: stop.along }));

function classify(row, queryId) {
  const trip = position.trips[row.tripId];
  if (!trip) return { status: 'position_static_missing', chainId: null };
  const chain = position.chains[trip.chainId];
  if (!chain) throw Error('POSITION_COVERAGE_CHAIN_MISSING');
  if (queryId !== source.directionId || row.routeId !== source.routeId
    || row.fromStopId !== approved.corridor.fromStopId) {
    return { status: 'geometry_missing', chainId: trip.chainId };
  }
  if (trip.chainId === approvedChainId) return { status: 'approved', chainId: trip.chainId };
  return { status: terminalCorridor(approvedStops, chain.stops, row)
    ? 'exact_shared_corridor' : 'geometry_missing', chainId: trip.chainId };
}

const queries = {}, uniqueTrips = new Map();
for (const [queryId, rows] of Object.entries(index.directions)) {
  const counts = {}, groups = new Map();
  for (const row of rows) {
    const result = classify(row, queryId);
    counts[result.status] = (counts[result.status] || 0) + 1;
    const previous = uniqueTrips.get(row.tripId);
    if (previous && previous.status !== result.status) throw Error('POSITION_COVERAGE_TRIP_CONFLICT');
    uniqueTrips.set(row.tripId, result);
    const key = `${row.routeId}:${result.chainId || 'not_in_sidecar'}:${result.status}`;
    const group = groups.get(key) || { routeId: row.routeId, chainId: result.chainId,
      status: result.status, rows: 0 };
    group.rows++;
    groups.set(key, group);
  }
  queries[queryId] = { rows: rows.length, counts,
    groups: [...groups.values()].sort((a, b) => a.routeId.localeCompare(b.routeId)
      || String(a.chainId).localeCompare(String(b.chainId))) };
}
const uniqueCounts = {};
for (const { status } of uniqueTrips.values()) uniqueCounts[status] = (uniqueCounts[status] || 0) + 1;
console.log(JSON.stringify({ status: 'KAWASAKI_POSITION_COVERAGE', staticSourceVersion: index.sourceVersion,
  staticSourceHash: index.sourceHash, geometryApprovalVersion: source.approvalVersion,
  approvedForPublic: source.approvedForPublic, geometryReady: source.geometryReady,
  uniqueTrips: uniqueTrips.size, uniqueCounts, queries }));

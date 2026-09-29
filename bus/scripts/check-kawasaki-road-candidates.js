// Build-time screening with the same OSM route stitching used for the approved 登05 artifact.
// This never approves geometry. It prints stop-order and gap evidence only.
import { readFileSync } from 'node:fs';
import { isGapZeroFullStopOrderCandidate, stitchOsmRoute, validateRoadGeometry } from '../position/road-geometry.js';
import { mergeKawasakiStatic } from '../providers/kawasaki/journey-static.js';

const read = name => JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));
const index = mergeKawasakiStatic(read('../generated/p0-static.json'), read('../generated/kawasaki-p2-5-static.json'));
const position = read('../generated/p1-position-static.json');
const refs = new Map(Object.values(index.routes).map(route => [route.label.normalize('NFKC'), route.routeId]));
const bounded = async (url, maxBytes) => {
  const response = await fetch(url, { redirect: 'error', headers: { 'user-agent': 'PALURU-Bus-Research/1.0' },
    signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw Error(`HTTP_${response.status}`);
  if (Number(response.headers.get('content-length')) > maxBytes) throw Error('SOURCE_SIZE');
  const text = await response.text();
  if (Buffer.byteLength(text) > maxBytes) throw Error('SOURCE_SIZE');
  return text;
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

try {
  const html = await bounded('https://wiki.openstreetmap.org/wiki/JA:Bus_routes_in_Kanagawa', 3 * 1024 * 1024);
  const candidates = new Map();
  for (const row of html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)) {
    const plain = row[0].replace(/<[^>]+>/g, ' ').replace(/&[^;]+;/g, ' ').replace(/\s+/g, ' ').normalize('NFKC');
    const ref = [...refs.keys()].find(value => new RegExp(`(?:^|\\s)${value}(?:\\s|$)`).test(plain));
    if (!ref) continue;
    const ids = [...new Set([...row[0].matchAll(/\/relation\/(\d+)/g)].map(match => Number(match[1])))];
    if (ids.length) candidates.set(refs.get(ref), ids);
  }
  const chains = Object.entries(position.chains).map(([chainId, chain]) => ({ chainId, chain,
    routeId: Object.values(position.trips).find(trip => trip.chainId === chainId)?.routeId }));
  const results = new Map(chains.map(({ chainId, routeId, chain }) => [chainId,
    { chainId, routeId, stops: chain.stops.length, candidates: 0, fullStopOrderCandidates: 0,
      gapZeroCandidates: 0, gapZeroFullStopOrderCandidates: 0, relationCandidates: [],
      bestProjectedStops: 0, bestRelationId: null, reasons: [] }]));
  const relations = [];
  for (const [routeId, ids] of candidates) for (const relationId of ids) {
    await sleep(4500);
    try {
      const osm = JSON.parse(await bounded(`https://api.openstreetmap.org/api/0.6/relation/${relationId}/full.json`, 8 * 1024 * 1024));
      const relation = osm.elements?.find(item => item.type === 'relation' && item.id === relationId);
      if (relation?.tags?.type === 'route_master') {
        if (relation.tags.ref?.normalize('NFKC') !== index.routes[routeId]?.label.normalize('NFKC')) {
          relations.push({ routeId, relationId, status: 'REF_MISMATCH' });
          continue;
        }
        const children = (relation.members || []).filter(item => item.type === 'relation').map(item => item.ref);
        for (const child of children) if (!ids.includes(child)) ids.push(child);
        relations.push({ routeId, relationId, status: 'ROUTE_MASTER', children: children.length });
        continue;
      }
      const stitched = stitchOsmRoute(osm, relationId);
      if (stitched.relation.ref?.normalize('NFKC') !== index.routes[routeId]?.label.normalize('NFKC')) {
        relations.push({ routeId, relationId, status: 'REF_MISMATCH' });
        continue;
      }
      relations.push({ routeId, relationId, status: 'FETCHED', points: stitched.points.length,
        gaps: stitched.gaps });
      for (const { chainId, chain } of chains.filter(item => item.routeId === routeId)) {
        const target = results.get(chainId);
        target.candidates++;
        const validation = validateRoadGeometry({ points: stitched.points, chain,
          stops: position.stops });
        const projected = validation.evidence.stops.projected;
        const allStopsOrdered = projected === chain.stops.length
          && !validation.reasons.includes('stop_projection_failed')
          && !validation.reasons.includes('stop_projection_ambiguous');
        const gapZero = stitched.gaps === 0;
        const gapZeroFullStopOrder = isGapZeroFullStopOrderCandidate({ gaps: stitched.gaps,
          validation, stopCount: chain.stops.length });
        if (allStopsOrdered) target.fullStopOrderCandidates++;
        if (gapZero) target.gapZeroCandidates++;
        if (gapZeroFullStopOrder) target.gapZeroFullStopOrderCandidates++;
        target.relationCandidates.push({ relationId, relationVersion: stitched.relation.version,
          gaps: stitched.gaps, gapMeters: Math.round(stitched.gapMeters * 100) / 100,
          projectedStops: projected, totalStops: chain.stops.length, allStopsOrdered,
          stopProjectionAmbiguous: validation.reasons.includes('stop_projection_ambiguous'),
          gapZeroFullStopOrder });
        if (projected > target.bestProjectedStops) {
          target.bestProjectedStops = projected;
          target.bestRelationId = relationId;
          target.reasons = validation.reasons;
        }
      }
    } catch (error) {
      const code = /^(HTTP_\d{3}|SOURCE_SIZE|ROAD_[A-Z_]+)$/.test(error?.message || '')
        ? error.message : 'SOURCE_UNAVAILABLE';
      relations.push({ routeId, relationId, status: code });
      if (code === 'HTTP_429') break;
    }
  }
  console.log(JSON.stringify({ status: 'KAWASAKI_ROAD_CANDIDATE_SCREEN',
    sourceVersion: position.sourceVersion, routeCandidateSets: candidates.size,
    relations, chains: [...results.values()].sort((a, b) => a.routeId.localeCompare(b.routeId)
      || a.chainId.localeCompare(b.chainId)) }));
} catch (error) {
  const code = /^(HTTP_\d{3}|SOURCE_SIZE)$/.test(error?.message || '') ? error.message : 'SOURCE_UNAVAILABLE';
  console.log(JSON.stringify({ status: 'KAWASAKI_ROAD_CANDIDATE_UNAVAILABLE', code }));
  process.exitCode = 1;
}

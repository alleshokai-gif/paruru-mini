import { buildP0Static } from './p0-static.js';
import { buildP2_5KawasakiStatic } from './p2-5-kawasaki-static.js';
import { buildPositionStatic } from './position-static.js';
import { mergeKawasakiStatic } from '../providers/kawasaki/journey-static.js';
import { validatePositionArtifact } from '../position/route-index.js';

const fail = code => { throw Error(code); };
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export function verifyKawasakiPositionBatch(previous, next, bundle) {
  const { p0: oldP0, journey: oldJourney, position: oldPosition } = previous;
  const { p0, journey, position } = next;
  const oldIndex = mergeKawasakiStatic(oldP0, oldJourney);
  const index = mergeKawasakiStatic(p0, journey);
  const oldPositionIndex = Object.keys(oldPosition.directions || {}).length === Object.keys(oldP0.directions).length
    ? oldP0 : oldIndex;
  validatePositionArtifact(oldPosition, oldPositionIndex, 'kawasaki');
  validatePositionArtifact(position, index, 'kawasaki');
  if (oldP0.sourceDate !== p0.sourceDate || oldJourney.sourceDate !== journey.sourceDate
    || !equal(oldIndex.directions, index.directions)
    || !equal(oldIndex.stops, index.stops) || !equal(oldIndex.routes, index.routes)
    || !equal(oldIndex.calendar, index.calendar)) fail('POSITION_BATCH_STATIC_CHANGED');
  for (const [tripId, trip] of Object.entries(oldPosition.trips)) {
    const updated = position.trips[tripId];
    if (!updated || updated.chainId !== trip.chainId || updated.routeId !== trip.routeId
      || !equal(oldPosition.chains[trip.chainId], position.chains[trip.chainId]))
      fail('POSITION_BATCH_CHAIN_CHANGED');
  }
  if (bundle?.schemaVersion !== 1 || bundle.staticSourceHash !== oldPosition.sourceHash
    || !Array.isArray(bundle.sources) || bundle.sources.length !== 1)
    fail('POSITION_BATCH_SHADOW_SOURCE_INVALID');
  const oldSource = bundle.sources[0], [chainId, candidate] = Object.entries(oldSource.chains || {})[0] || [];
  const chain = position.chains[chainId];
  if (oldSource.staticSourceHash !== oldPosition.sourceHash || !chain || !candidate
    || candidate.approvedForShadow !== true || candidate.approvedForPublic !== false
    || candidate.geometryReady !== false || chain.stops.length !== candidate.stopProjections?.length
    || !candidate.stopProjections.every((stop, ordinal) => stop.stopId === chain.stops[ordinal].stopId
      && stop.sequence === chain.stops[ordinal].sequence)) fail('POSITION_BATCH_SHADOW_CHAIN_CHANGED');
  const updatedBundle = structuredClone(bundle);
  updatedBundle.staticSourceHash = position.sourceHash;
  updatedBundle.sources[0].staticSourceHash = position.sourceHash;
  return { index, bundle: updatedBundle,
    stats: { priorTrips: Object.keys(oldPosition.trips).length, allTrips: Object.keys(position.trips).length,
      priorChains: Object.keys(oldPosition.chains).length, allChains: Object.keys(position.chains).length,
      journeyOnlyTrips: Object.keys(position.trips).length - Object.keys(oldPosition.trips).length,
      shadowChainParity: true, calendarDatesChanged: !equal(oldIndex.calendarDates, index.calendarDates) } };
}

export function buildKawasakiPositionBatch(bytes, { sourceDate, now = Date.now() / 1000 }) {
  const p0 = buildP0Static(bytes, { sourceDate, now });
  const journey = buildP2_5KawasakiStatic(bytes, { sourceDate, now });
  const index = mergeKawasakiStatic(p0, journey);
  const position = buildPositionStatic(bytes, { index, provider: 'kawasaki', now: now * 1000 });
  return { p0, journey, position };
}

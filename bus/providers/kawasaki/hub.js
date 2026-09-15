import { ATTRIBUTION } from './attribution.js';
import { resolvePlatform } from './config.js';

const INCLUDED_SOURCES = new Set(['home_to_noborito', 'home_to_mizonokuchi', 'mizonokuchi_to_home',
  'noborito_to_home', 'mukougaoka_to_kibukihoncho', 'kibukihoncho_to_miyamae_washigamine']);
const DEPARTURE_STATES = new Set(['departure_pending', 'departure_overdue', 'departure_uncertain']);
const fail = (code) => { throw new Error(code); };

function routeIdFor(row, query, index) {
  const matches = query.routeIds.filter((id) => index.routes[id]?.label === row.routeLabel);
  if (matches.length !== 1) fail('BUS_KAWASAKI_HUB_ROUTE_INVALID');
  return matches[0];
}

function stopIdFor(row, query) {
  const candidates = query.fromStopIds.filter((stopId) => resolvePlatform(stopId) === row.platform);
  if (candidates.length === 1) return candidates[0];
  if (query.fromStopIds.length === 1) return query.fromStopIds[0];
  fail('BUS_KAWASAKI_HUB_PLATFORM_INVALID');
}

function epoch(value) {
  const parsed = Date.parse(value) / 1000;
  if (!Number.isFinite(parsed)) fail('BUS_KAWASAKI_HUB_TIME_INVALID');
  return parsed;
}

function realtimeState(response, direction, row) {
  if (!row.realtime) return 'static_fallback';
  if (response.fetchError || direction.state === 'realtime_stale' || row.state === 'realtime_stale') return 'stale';
  return 'realtime';
}

function departureState(row) {
  if (DEPARTURE_STATES.has(row.state)) return row.state;
  if (row.state === 'prediction_pending') return 'departure_pending';
  return row.realtime ? 'realtime' : 'scheduled';
}

export function normalizeKawasakiHubResult(response, { index, queries }) {
  if (response?.success !== true || !Array.isArray(response.directions)) fail('BUS_KAWASAKI_HUB_INVALID');
  const queryMap = new Map(queries.filter((query) => INCLUDED_SOURCES.has(query.id)).map((query) => [query.id, query]));
  const arrivals = [];
  for (const direction of response.directions) {
    const query = queryMap.get(direction.id);
    if (!query) continue;
    if (!Array.isArray(direction.arrivals)) fail('BUS_KAWASAKI_HUB_INVALID');
    for (const row of direction.arrivals) {
      const stopId = stopIdFor(row, query), stop = index.stops[stopId];
      if (!stop) fail('BUS_KAWASAKI_HUB_INVALID');
      const scheduledDeparture = epoch(row.scheduledAt);
      const estimatedDeparture = row.realtime ? epoch(row.estimatedAt) : null;
      arrivals.push({
        id: `kawasaki:${row.tripId}`, sourceId: direction.id, provider: 'kawasaki',
        routeId: routeIdFor(row, query, index), routeLabel: row.routeLabel,
        destination: row.headsign || direction.to,
        originStop: { id: stopId, name: stop.name }, targetStop: { id: stopId, name: stop.name },
        scheduledDeparture, estimatedDeparture, effectiveDeparture: null,
        etaMinutes: row.realtime ? row.etaMinutes : null,
        delayMinutes: row.realtime ? row.delayMinutes : null,
        platform: row.platform ?? null,
        realtimeState: realtimeState(response, direction, row), departureState: departureState(row),
        actionability: row.state === 'departure_uncertain' ? 'do_not_recommend' : row.realtime ? 'catchable' : null,
        confidence: null,
        position: row.position?.supported ? {
          supported: true, state: row.position.status, stopsAway: row.position.stopsAway,
          previousStop: row.position.previousStop, nextStop: row.position.nextStop,
          confidence: row.position.confidence
        } : { supported: false, state: null, stopsAway: null, previousStop: null, nextStop: null, confidence: null }
      });
    }
  }
  return { provider: 'kawasaki', arrivals, attribution: ATTRIBUTION };
}

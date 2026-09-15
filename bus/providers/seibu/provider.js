import { LIMITS } from '../../config/policy.js';
import { serviceActive } from '../../core/arrivals.js';
import { ATTRIBUTION } from './attribution.js';
import { ARTIFACT_SCHEMA_VERSION, DIRECTIONS, PROVIDER_ID, RT_CACHE_SEC } from './config.js';
import { fetchSeibuRealtime } from './realtime.js';

const DAY = 86400, JST = 9 * 3600, RT_JOIN_WINDOW_SEC = 6 * 3600;
const fail = (code) => { throw new Error(code); };
const dayStart = (seconds) => Math.floor((seconds + JST) / DAY) * DAY - JST;
const dateKey = (seconds) => new Date((seconds + JST) * 1000).toISOString().slice(0, 10).replaceAll('-', '');
const fresh = (timestamp, now, maxAge) => Number.isFinite(timestamp) && timestamp <= now + 5 && now - timestamp <= maxAge;

function validateArtifact(value) {
  if (value?.schemaVersion !== ARTIFACT_SCHEMA_VERSION || value.provider !== PROVIDER_ID
    || !value.feedInfo || !value.directions || !Array.isArray(value.calendar) || !Array.isArray(value.calendarDates))
    fail('BUS_SEIBU_ARTIFACT_INVALID');
  for (const direction of DIRECTIONS) if (!Array.isArray(value.directions[direction.id]) || !value.directions[direction.id].length)
    fail('BUS_SEIBU_ARTIFACT_INVALID');
  return value;
}

function eventTime(stop, scheduled) {
  const event = stop?.departure || stop?.arrival;
  if (event?.time != null) return event.time;
  if (event?.delay != null) return scheduled + event.delay;
  return null;
}

function unsupportedPosition() {
  return { supported: false, state: null, stopsAway: null, previousStop: null, nextStop: null, confidence: null };
}

export function buildSeibuArrivals({ artifact, realtime = null, now, realtimeError = false, limit = 3 }) {
  validateArtifact(artifact);
  if (!Number.isFinite(now) || !Number.isInteger(limit) || limit < 1 || limit > 10) fail('BUS_SEIBU_BUILD_INVALID');
  const today = dateKey(now);
  if (today > artifact.feedInfo.feed_end_date || dateKey(now + DAY) < artifact.feedInfo.feed_start_date)
    fail('BUS_SEIBU_STATIC_OUT_OF_RANGE');
  const feedFresh = realtime && fresh(realtime.timestamp, now, LIMITS.feedMaxAgeSec);
  const updates = new Map();
  for (const update of realtime?.updates || []) {
    if (!updates.has(update.trip.tripId)) updates.set(update.trip.tripId, []);
    updates.get(update.trip.tripId).push(update);
  }
  const active = new Map(), result = [];
  for (const direction of DIRECTIONS) {
    const candidates = [];
    for (const offset of [-1, 0, 1]) {
      const day = dayStart(now) + offset * DAY, date = dateKey(day);
      if (date < artifact.feedInfo.feed_start_date || date > artifact.feedInfo.feed_end_date) continue;
      for (const row of artifact.directions[direction.id]) {
        const serviceKey = `${row.serviceId}|${date}`;
        if (!active.has(serviceKey)) active.set(serviceKey, serviceActive(artifact, row.serviceId, day));
        if (!active.get(serviceKey)) continue;
        const scheduledDeparture = day + row.scheduledSeconds;
        const matches = (updates.get(row.tripId) || []).filter((update) => !update.trip.routeId || update.trip.routeId === row.routeId)
          .filter((update) => !update.trip.startDate || update.trip.startDate === date);
        const update = matches.length === 1 ? matches[0] : null;
        const updateFresh = feedFresh && update && fresh(update.timestamp ?? realtime.timestamp, now, LIMITS.tripMaxAgeSec);
        if (updateFresh && update.trip.relationship === 3) continue;
        const stopMatches = (update?.stops || []).filter((stop) => (stop.stopId === row.fromStopId || stop.stopId == null)
          && (stop.sequence === row.stopSequence || stop.sequence == null));
        const stop = stopMatches.length === 1 ? stopMatches[0] : null;
        if (updateFresh && stop?.relationship === 1) continue;
        let estimatedDeparture = updateFresh && Math.abs(scheduledDeparture - now) <= RT_JOIN_WINDOW_SEC
          ? eventTime(stop, scheduledDeparture) : null;
        if (estimatedDeparture != null && Math.abs(estimatedDeparture - scheduledDeparture) > RT_JOIN_WINDOW_SEC)
          estimatedDeparture = null;
        if (estimatedDeparture != null && estimatedDeparture < now) continue;
        if (estimatedDeparture == null && scheduledDeparture < now) continue;
        const realtimeState = estimatedDeparture != null ? 'realtime'
          : realtime && !feedFresh || update && !updateFresh ? 'realtime_stale'
            : realtimeError || realtime ? 'static_fallback' : 'static_only';
        candidates.push({
          id: `seibu:${date}:${row.tripId}`, sourceId: direction.id, provider: PROVIDER_ID,
          routeId: row.routeId, routeLabel: row.routeLabel, destination: row.headsign,
          originStop: { id: row.fromStopId, name: artifact.stops[row.fromStopId].name },
          targetStop: { id: row.fromStopId, name: artifact.stops[row.fromStopId].name },
          scheduledDeparture, estimatedDeparture, effectiveDeparture: null,
          etaMinutes: estimatedDeparture == null ? null : Math.max(0, Math.ceil((estimatedDeparture - now) / 60)),
          delayMinutes: estimatedDeparture == null ? null : Math.round((estimatedDeparture - scheduledDeparture) / 60),
          platform: row.platform ? `${row.platform}${row.platform.endsWith('番') ? '' : '番'}` : null, realtimeState,
          departureState: estimatedDeparture == null ? 'scheduled' : 'realtime',
          actionability: estimatedDeparture == null ? null : 'catchable', confidence: null,
          position: unsupportedPosition()
        });
      }
    }
    candidates.sort((a, b) => (a.estimatedDeparture ?? a.scheduledDeparture) - (b.estimatedDeparture ?? b.scheduledDeparture)
      || a.scheduledDeparture - b.scheduledDeparture || a.id.localeCompare(b.id));
    result.push(...candidates.slice(0, limit));
  }
  return result;
}

export function createSeibuProvider({ artifact, token, fetcher = fetch, now = () => Date.now() / 1000,
  cacheSeconds = RT_CACHE_SEC } = {}) {
  validateArtifact(artifact);
  if (!token || /\s/.test(token) || !Number.isFinite(cacheSeconds) || cacheSeconds < 0) fail('BUS_SEIBU_PROVIDER_INVALID');
  let cached = null, pending = null;
  async function realtime() {
    if (cached && now() - cached.fetchedAt >= 0 && now() - cached.fetchedAt < cacheSeconds) return cached;
    if (pending) return pending;
    pending = fetchSeibuRealtime(token, fetcher, now).then((value) => { cached = value; return value; });
    try { return await pending; } finally { pending = null; }
  }
  return {
    async getArrivals() {
      let snapshot = null, realtimeError = false;
      try { snapshot = await realtime(); } catch { realtimeError = true; }
      return { provider: PROVIDER_ID,
        arrivals: buildSeibuArrivals({ artifact, realtime: snapshot, realtimeError, now: now() }),
        retrievedAt: snapshot?.fetchedAt ?? null,
        sourceUpdatedAt: artifact.generatedAtEpoch,
        attribution: ATTRIBUTION };
    },
    // Research/test boundary. The Hub response only receives the arrival allowlist above.
    getInternalVehicles() { return cached?.vehicles ? structuredClone(cached.vehicles) : []; }
  };
}

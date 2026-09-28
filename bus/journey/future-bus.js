import { clock, iso, prepareStatic, serviceActive } from '../core/arrivals.js';
import { LIMITS } from '../config/policy.js';
import { clockSeconds } from '../core/time.js';

const DAY = 86400, JST = 9 * 3600;
const dayStart = (seconds) => Math.floor((seconds + JST) / DAY) * DAY - JST;
const dateKey = (seconds) => iso(seconds).slice(0, 10).replaceAll('-', '');
const fresh = (timestamp, now, limit) => Number.isFinite(timestamp) && timestamp <= now + 5
  && now - timestamp <= limit;
const fail = () => { throw Error('BUS_FUTURE_QUERY_INVALID'); };
const nullable = (value) => value === null || Number.isFinite(value);

function eventAt(stops, stopId, sequence, kind, scheduled) {
  const matching = (stops || []).filter((stop) => (stop.stopId === null || stop.stopId === stopId)
    && (stop.sequence === null || stop.sequence === sequence)
    && (stop.stopId !== null || stop.sequence !== null));
  if (matching.length !== 1) return null;
  const event = matching[0][kind];
  if (matching[0].relationship !== 0 || !event) return null;
  if (Number.isFinite(event.time)) return event.time;
  if (Number.isFinite(event.delay) && Number.isFinite(scheduled)) return scheduled + event.delay;
  return null;
}

// BoardingAt is a future station-arrival plus transfer time, not the current wall clock.
// This service deliberately does not reuse getArrivals(), which truncates to the next three at now.
export function getFutureBuses({ index, queries, providerContext, realtime = null, now, boardingAt,
  departureStateForTrip = () => 'scheduled', limit = 12, horizonSec = 6 * 3600 } = {}) {
  if (!Number.isFinite(now) || !Number.isFinite(boardingAt) || boardingAt < now
    || boardingAt > now + 2 * DAY || !Number.isSafeInteger(limit) || limit < 1 || limit > 100
    || !Number.isSafeInteger(horizonSec) || horizonSec < 60 || horizonSec > DAY
    || typeof departureStateForTrip !== 'function') fail();
  const resolved = prepareStatic(index, queries, providerContext);
  const feedFresh = realtime && fresh(realtime.timestamp, now, LIMITS.feedMaxAgeSec);
  const updates = new Map();
  if (feedFresh) for (const update of realtime.updates || []) {
    const key = `${update.trip?.tripId}|${update.trip?.startDate}`;
    if (!updates.has(key)) updates.set(key, []);
    updates.get(key).push(update);
  }
  const results = [];
  for (const { query, groups } of resolved) {
    const arrivals = [];
    for (const day of [dayStart(boardingAt) - DAY, dayStart(boardingAt), dayStart(boardingAt) + DAY]) {
      const date = dateKey(day);
      if (date < index.feedInfo.feed_start_date || date > index.feedInfo.feed_end_date) continue;
      for (const [serviceId, rows] of groups) {
        if (!serviceActive(index, serviceId, day)) continue;
        for (const row of rows) {
          const scheduledDeparture = day + row.scheduledSeconds;
          const scheduledArrival = Number.isFinite(row.scheduledArrivalSeconds)
            ? day + row.scheduledArrivalSeconds : null;
          const matches = (updates.get(`${row.tripId}|${date}`) || []).filter((update) =>
            (update.trip.routeId == null || update.trip.routeId === row.routeId)
            && (update.trip.startTime == null || clockSeconds(update.trip.startTime) === clockSeconds(row.startTime)));
          const update = matches.length === 1 && fresh(matches[0].timestamp, now, LIMITS.tripMaxAgeSec)
            ? matches[0] : null;
          if (update?.trip.relationship === 3 || update && update.trip.relationship !== 0) continue;
          const estimatedDeparture = update ? eventAt(update.stops, row.fromStopId, row.stopSequence,
            'departure', scheduledDeparture) : null;
          const estimatedArrival = update ? eventAt(update.stops, row.toStopId, row.alightSequence,
            'arrival', scheduledArrival) : null;
          const departureAt = estimatedDeparture ?? scheduledDeparture;
          const departureState = departureStateForTrip({ row, date, now, scheduledDeparture, estimatedDeparture });
          if (!['scheduled', 'departure_pending', 'departure_overdue', 'departure_uncertain',
            'unknown', 'departed', 'cancelled'].includes(departureState)) fail();
          if (['departed', 'cancelled'].includes(departureState)) continue;
          const unconfirmedOrigin = row.isOrigin === true && date === dateKey(boardingAt)
            && ['departure_pending', 'departure_overdue', 'departure_uncertain', 'unknown']
              .includes(departureState);
          if (departureAt > boardingAt + horizonSec || departureAt < boardingAt && !unconfirmedOrigin) continue;
          const projectedArrival = estimatedArrival ?? (scheduledArrival !== null && estimatedDeparture !== null
            ? scheduledArrival + estimatedDeparture - scheduledDeparture : scheduledArrival);
          if (!nullable(projectedArrival) || projectedArrival !== null && projectedArrival < departureAt) fail();
          const timingQuality = estimatedArrival !== null ? 'realtime_arrival'
            : projectedArrival !== null && estimatedDeparture !== null ? 'departure_delay_projection'
              : scheduledArrival !== null ? 'static_only' : 'arrival_unknown';
          arrivals.push({ tripId: `${date}:${row.tripId}`, queryId: query.id, provider: providerContext.id,
            routeId: row.routeId, routeLabel: row.routeLabel, destination: row.headsign,
            fromStopId: row.fromStopId, toStopId: row.toStopId,
            platform: providerContext.platformResolver(row.fromStopId, index),
            scheduledDeparture, estimatedDeparture, boardingAt, departureAt,
            scheduledArrival, estimatedArrival: projectedArrival,
            delayMinutes: estimatedDeparture === null ? null : Math.round((estimatedDeparture - scheduledDeparture) / 60),
            timingQuality, departureState, recommendable: departureAt >= boardingAt
              && !['departure_pending', 'departure_overdue', 'departure_uncertain', 'unknown'].includes(departureState)
              && projectedArrival !== null });
        }
      }
    }
    arrivals.sort((a, b) => Number(!a.recommendable) - Number(!b.recommendable)
      || a.departureAt - b.departureAt || a.tripId.localeCompare(b.tripId));
    results.push({ queryId: query.id, provider: providerContext.id, boardingAt: iso(boardingAt),
      arrivals: arrivals.slice(0, limit).map((row) => ({ ...row,
        scheduledDepartureTime: clock(row.scheduledDeparture),
        departureTime: clock(row.departureAt),
        homeArrivalTime: row.estimatedArrival === null ? null : clock(row.estimatedArrival) })) });
  }
  return { generatedAt: iso(now), results };
}

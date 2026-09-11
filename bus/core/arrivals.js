import { LIMITS, BUS_POSITION_UI_ENABLED } from '../config/policy.js';
import { clockSeconds } from './time.js';
import { resolveQuerySet } from './queries.js';

const DAY = 86400, JST = 9 * 3600;
export const iso = (seconds) => new Date((seconds + JST) * 1000).toISOString().replace('Z', '+09:00');
export const clock = (seconds) => iso(seconds).slice(11, 16);
const dateKey = (seconds) => iso(seconds).slice(0, 10).replaceAll('-', '');
const dayStart = (seconds) => Math.floor((seconds + JST) / DAY) * DAY - JST;
const fresh = (timestamp, now, limit) => timestamp !== null && timestamp <= now + 5 && now - timestamp <= limit;
const unsupportedPosition = () => ({ supported: false, status: null, stopsAway: null, previousStop: null, nextStop: null });
export function prepareStatic(index, queries, providerContext) {
  return resolveQuerySet(index, queries, providerContext);
}

export function serviceActive(index, serviceId, day) {
  const key = dateKey(day);
  const exceptions = index.calendarDates.filter((r) => r.service_id === serviceId && r.date === key);
  if (exceptions.length) return exceptions.length === 1 && exceptions[0].exception_type === '1';
  const weekday = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][new Date((day + JST) * 1000).getUTCDay()];
  const rows = index.calendar.filter((r) => r.service_id === serviceId && r.start_date <= key && r.end_date >= key);
  return rows.length === 1 && rows[0][weekday] === '1';
}
function joins(descriptor, row, date) {
  return descriptor.tripId === row.tripId && descriptor.startDate === date
    && (!descriptor.routeId || descriptor.routeId === row.routeId)
    && (!descriptor.startTime || clockSeconds(descriptor.startTime) === clockSeconds(row.startTime));
}

export function getArrivals({ index, realtime = null, queries, providerContext, now, fetchError = false, staticStale = false }) {
  const resolved = prepareStatic(index, queries, providerContext);
  if (dateKey(now) > index.feedInfo.feed_end_date || dateKey(now + DAY) < index.feedInfo.feed_start_date) throw new Error('BUS_STATIC_OUT_OF_RANGE');
  const feedFresh = realtime && fresh(realtime.timestamp, now, LIMITS.feedMaxAgeSec);
  const updates = new Map(), vehicles = new Map();
  for (const [source, dest] of [[realtime?.updates || [], updates], [realtime?.vehicles || [], vehicles]]) {
    for (const item of source) {
      const key = `${item.trip.tripId}|${item.trip.startDate}`;
      if (!dest.has(key)) dest.set(key, []);
      dest.get(key).push(item);
    }
  }
  const days = [-1, 0, 1].map((offset) => dayStart(now) + offset * DAY);
  const active = new Map();
  const directions = resolved.map(({ query, groups }) => {
    const arrivals = [];
    for (const day of days) {
      const date = dateKey(day);
      if (date < index.feedInfo.feed_start_date || date > index.feedInfo.feed_end_date) continue;
      for (const [serviceId, rows] of groups) {
        const serviceKey = `${serviceId}|${date}`;
        if (!active.has(serviceKey)) active.set(serviceKey, serviceActive(index, serviceId, day));
        if (!active.get(serviceKey)) continue;
        for (const row of rows) {
          const scheduled = day + row.scheduledSeconds;
          const key = `${row.tripId}|${date}`;
          const matched = (updates.get(key) || []).filter((u) => joins(u.trip, row, date));
          const tu = matched.length === 1 ? matched[0] : null;
          const tripFresh = tu && feedFresh && fresh(tu.timestamp, now, LIMITS.tripMaxAgeSec);
          // A cancellation is not an on-time static trip. Other unsupported RT relationships are withheld too.
          if (feedFresh && tu && tu.trip.relationship !== 0) continue;
          const stops = (tu?.stops || []).filter((s) => (s.stopId !== null || s.sequence !== null)
            && (s.stopId === null || s.stopId === row.fromStopId) && (s.sequence === null || s.sequence === row.stopSequence));
          const stop = stops.length === 1 ? stops[0] : null;
          if (feedFresh && stop?.relationship === 1) continue;
          const departure = tripFresh && stop?.relationship === 0 ? stop.departure : null;
          let estimated = null, delay = null, timingSource = 'static';
          if (departure?.time !== null && departure?.time !== undefined) {
            estimated = departure.time; timingSource = 'departure_time';
          } else if (departure?.delay !== null && departure?.delay !== undefined) {
            estimated = scheduled + departure.delay; timingSource = 'departure_delay';
          }
          if (estimated !== null) delay = estimated - scheduled;
          const vps = (vehicles.get(key) || []).filter((v) => joins(v.trip, row, date));
          const vp = vps.length === 1 ? vps[0] : null;
          const atOrigin = feedFresh && vp?.status === 1 && vp.stopId === row.fromStopId
            && vp.sequence === row.stopSequence && fresh(vp.timestamp, now, LIMITS.vehicleMaxAgeSec);
          let predictionPending = false;
          if (estimated !== null && estimated < now) {
            if (!atOrigin) continue;
            estimated = null; delay = null; predictionPending = true; timingSource = 'prediction_pending';
          }
          if (estimated === null && scheduled < now && !predictionPending) continue;
          const rt = estimated !== null;
          const state = predictionPending ? 'prediction_pending' : rt ? 'realtime'
            : realtime && (!feedFresh || (tu && !tripFresh)) ? 'realtime_stale' : 'static_fallback';
          // Rank numeric candidates first; only the three visible trips need a formatted DTO.
          arrivals.push({ row, date, scheduled, estimated, delay, rt, state, timingSource, tu, departure,
            sort: predictionPending ? now : estimated ?? scheduled });
        }
      }
    }
    arrivals.sort((a, b) => a.sort - b.sort || a.scheduled - b.scheduled || `${a.date}:${a.row.tripId}`.localeCompare(`${b.date}:${b.row.tripId}`));
    const selected = arrivals.slice(0, LIMITS.arrivals).map(({ row, date, scheduled, estimated, delay, rt, state, timingSource, tu, departure }) => ({
      tripId: `${date}:${row.tripId}`, routeLabel: row.routeLabel, headsign: row.headsign, platform: providerContext.platformResolver(row.fromStopId, index),
      scheduledTime: clock(scheduled), scheduledAt: iso(scheduled),
      estimatedTime: rt ? clock(estimated) : null, estimatedAt: rt ? iso(estimated) : null,
      etaMinutes: rt ? Math.max(0, Math.ceil((estimated - now) / 60)) : null,
      delayMinutes: rt ? Math.round(delay / 60) : null, delaySeconds: delay, realtime: rt, state, timingSource,
      updatedAt: tu ? iso(tu.timestamp ?? realtime.timestamp) : iso(index.fetchedAt),
      dataAgeSec: tu ? Math.max(0, Math.floor(now - (tu.timestamp ?? realtime.timestamp))) : null,
      delayConsistent: rt && departure.delay !== null ? departure.delay === delay : null,
      position: unsupportedPosition()
    }));
    const timestamp = realtime?.timestamp ?? index.fetchedAt;
    return { id: query.id, group: query.group, provider: providerContext.id, from: query.from, to: query.to,
      routeLabel: selected[0]?.routeLabel || null, updatedAt: iso(timestamp), dataAgeSec: Math.max(0, Math.floor(now - timestamp)),
      state: selected.some((r) => r.state === 'realtime_stale') || (realtime && !feedFresh) ? 'realtime_stale'
        : selected.some((r) => r.realtime) ? 'realtime' : 'static_fallback',
      fetchError, staticStale, arrivals: selected };
  });
  return { success: true, generatedAt: iso(now), pollAfterSeconds: LIMITS.pollSec,
    positionUiEnabled: BUS_POSITION_UI_ENABLED, fetchError, staticStale, staticVersion: index.feedInfo.feed_version, staticUpdatedAt: iso(index.fetchedAt),
    searchUntil: iso(dayStart(now) + 2 * DAY), directions,
    attribution: { provider: providerContext.attribution.provider, distributor: providerContext.attribution.distributor,
      url: providerContext.attribution.url } };
}

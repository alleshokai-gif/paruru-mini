import { serviceActive } from '../core/arrivals.js';
import { clockSeconds } from '../core/time.js';
import { POSITION_POLICY } from './policy.js';

const dayStart = (date) => /^\d{8}$/.test(date || '')
  ? Date.parse(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}T00:00:00+09:00`) / 1000 : NaN;
const keyFor = (date, row) => `${date}:${row.tripId}:${row.fromStopId}:${row.stopSequence}`;

// Stop-level location uses the official trip's ordered stops. It does not infer GPS geometry.
export function createStopSequenceObserver({ index, positionStatic }) {
  const targets = new Map();
  for (const row of Object.values(index.directions).flat()) {
    const trip = positionStatic?.trips?.[row.tripId];
    const chain = positionStatic?.chains?.[trip?.chainId];
    if (!trip || !chain || trip.routeId !== row.routeId
      || !chain.stops.some((stop) => stop.stopId === row.fromStopId && stop.sequence === row.stopSequence)) continue;
    if (!targets.has(row.tripId)) targets.set(row.tripId, []);
    targets.get(row.tripId).push({ row, chain });
  }
  let positions = new Map();
  return {
    observe({ realtime, now }) {
      positions = new Map();
      if (!Number.isFinite(realtime?.timestamp) || now - realtime.timestamp > POSITION_POLICY.maxAgeSec
        || realtime.timestamp - now > POSITION_POLICY.futureSec) return;
      const collisions = new Set();
      for (const vehicle of realtime.vehicles || []) {
        const descriptor = vehicle.trip;
        const date = descriptor?.startDate, day = dayStart(date);
        if (!Number.isFinite(day) || !Number.isFinite(vehicle.timestamp)
          || now - vehicle.timestamp > POSITION_POLICY.maxAgeSec
          || vehicle.timestamp - now > POSITION_POLICY.futureSec
          || descriptor.relationship !== 0) continue;
        for (const { row, chain } of targets.get(descriptor.tripId) || []) {
          if (!serviceActive(index, row.serviceId, day)
            || descriptor.routeId && descriptor.routeId !== row.routeId
            || descriptor.startTime && clockSeconds(descriptor.startTime) !== clockSeconds(row.startTime)) continue;
          const key = keyFor(date, row);
          if (positions.has(key)) { collisions.add(key); positions.delete(key); continue; }
          if (collisions.has(key)) continue;
          const current = chain.stops.findIndex((stop) => stop.sequence === vehicle.sequence);
          const boarding = chain.stops.findIndex((stop) => stop.sequence === row.stopSequence
            && stop.stopId === row.fromStopId);
          if (current < 0 || boarding < current || vehicle.stopId
            && chain.stops[current].stopId !== vehicle.stopId
            || ![null, 0, 1, 2].includes(vehicle.status)) continue;
          const next = chain.stops[current];
          const previous = current ? chain.stops[current - 1] : null;
          const nextName = positionStatic.stops[next.stopId]?.name;
          const previousName = previous && positionStatic.stops[previous.stopId]?.name;
          if (!nextName || previous && !previousName) continue;
          positions.set(key, { supported: true, fidelity: 'stop_sequence',
            state: vehicle.status === 1 ? 'at_stop' : vehicle.status === 0 ? 'approaching' : 'near_stop',
            previousStop: previousName || null, nextStop: nextName,
            stopsAway: boarding - current, observedAt: vehicle.timestamp });
        }
      }
    },
    snapshot: () => structuredClone(positions),
    clear: () => { positions = new Map(); }
  };
}

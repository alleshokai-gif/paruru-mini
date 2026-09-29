import { serviceActive } from '../core/arrivals.js';
import { clockSeconds } from '../core/time.js';
import { POSITION_POLICY } from '../position/policy.js';

const MAX_HISTORY_SEC = 45 * 60;
const MAX_VEHICLES = 512;
const dayStart = (date) => /^\d{8}$/.test(date || '')
  ? Date.parse(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}T00:00:00+09:00`) / 1000 : NaN;

// Runtime-only, same-vehicle evidence. Vehicle IDs never enter a snapshot, DTO or log.
export function createTurnaroundObserver({ index, positionStatic }) {
  const origins = new Map(), history = new Map();
  for (const row of Object.values(index.directions).flat()) {
    if (!row.isOrigin) continue;
    if (!origins.has(row.tripId)) origins.set(row.tripId, []);
    origins.get(row.tripId).push(row);
  }
  let candidates = new Map();
  return {
    observe({ realtime, now }) {
      if (!Number.isFinite(realtime?.timestamp) || now - realtime.timestamp > POSITION_POLICY.maxAgeSec
        || realtime.timestamp - now > POSITION_POLICY.futureSec) { candidates = new Map(); return; }
      for (const [key, candidate] of candidates) if (now - candidate.observedAt > 180) candidates.delete(key);
      for (const [id, prior] of history) if (now - prior.timestamp > MAX_HISTORY_SEC) history.delete(id);
      for (const vehicle of realtime.vehicles || []) {
        const id = vehicle.vehicleId, trip = vehicle.trip;
        if (!id || !trip?.tripId || !Number.isFinite(vehicle.timestamp)
          || now - vehicle.timestamp > POSITION_POLICY.maxAgeSec
          || vehicle.timestamp - now > POSITION_POLICY.futureSec) continue;
        const previous = history.get(id), chain = positionStatic?.chains?.[positionStatic.trips?.[trip.tripId]?.chainId];
        if (previous && previous.tripId !== trip.tripId && vehicle.timestamp >= previous.timestamp
          && vehicle.timestamp - previous.timestamp <= MAX_HISTORY_SEC) {
          const priorChain = positionStatic?.chains?.[positionStatic.trips?.[previous.tripId]?.chainId];
          const terminal = priorChain?.stops?.at(-1);
          const terminalName = positionStatic?.stops?.[terminal?.stopId]?.name;
          const day = dayStart(trip.startDate);
          for (const row of origins.get(trip.tripId) || []) {
            const originName = positionStatic?.stops?.[row.fromStopId]?.name;
            if (!Number.isFinite(day) || !serviceActive(index, row.serviceId, day)
              || trip.routeId && trip.routeId !== row.routeId
              || trip.startTime && clockSeconds(trip.startTime) !== clockSeconds(row.startTime)
              || !originName || terminalName !== originName || !terminal
              || previous.sequence < terminal.sequence - 1
              || !chain?.stops?.some((stop) => stop.stopId === row.fromStopId && stop.sequence === row.stopSequence)) continue;
            const key = `${trip.startDate}:${trip.tripId}:${row.fromStopId}:${row.stopSequence}`;
            candidates.set(key, { status: previous.sequence === terminal.sequence && previous.status === 1
              ? 'high' : 'candidate', incomingTerminal: terminalName, observedAt: vehicle.timestamp });
          }
        }
        if (!previous || vehicle.timestamp >= previous.timestamp) history.set(id, {
          tripId: trip.tripId, timestamp: vehicle.timestamp, sequence: vehicle.sequence,
          status: vehicle.status });
      }
      while (history.size > MAX_VEHICLES) history.delete(history.keys().next().value);
    },
    snapshot: () => structuredClone(candidates),
    clear: () => { history.clear(); candidates = new Map(); }
  };
}

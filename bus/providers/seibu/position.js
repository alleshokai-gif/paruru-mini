import { LIMITS } from '../../config/policy.js';

const unsupported = () => ({ supported: false, state: null, stopsAway: null,
  previousStop: null, nextStop: null, confidence: null });
const fresh = (timestamp, now) => Number.isFinite(timestamp) && timestamp <= now + 5
  && now - timestamp <= LIMITS.vehicleMaxAgeSec;

// GTFS-RT current_stop_sequence identifies the reported stop, not a road segment.
// Keep this deliberately coarse when current_status is absent.
export function seibuStopPosition({ row, vehicle, now, scheduledDeparture, vehicleFeedTimestamp } = {}) {
  if (!row || !vehicle || !fresh(vehicleFeedTimestamp, now) || !fresh(vehicle.timestamp, now)
    || vehicle.tripId !== row.tripId || vehicle.routeId && vehicle.routeId !== row.routeId
    || !Number.isFinite(scheduledDeparture) || Math.abs(scheduledDeparture - now) > 6 * 3600
    || !Array.isArray(row.positionStops)) return unsupported();
  const stops = row.positionStops;
  const sequence = vehicle.rawState?.sequence, stopId = vehicle.rawState?.stopId;
  const bySequence = Number.isInteger(sequence) ? stops.filter((stop) => stop.sequence === sequence) : [];
  const byStop = typeof stopId === 'string' && stopId ? stops.filter((stop) => stop.stopId === stopId) : [];
  if (bySequence.length > 1 || byStop.length > 1 || !bySequence.length && !byStop.length
    || bySequence.length && byStop.length && bySequence[0] !== byStop[0]
    || Number.isInteger(sequence) && !bySequence.length || stopId && !byStop.length)
    return unsupported();
  const stop = bySequence[0] || byStop[0];
  const stopsAway = stops.findIndex((entry) => entry.sequence === row.stopSequence
    && entry.stopId === row.fromStopId) - stops.indexOf(stop);
  if (stopsAway < 0) return unsupported();
  const status = vehicle.rawState?.status;
  const state = status === 1 ? 'at_stop' : status === 0 ? 'approaching' : 'near_stop';
  return { supported: true, fidelity: 'stop_sequence', state, stopsAway,
    previousStop: null, nextStop: stop.name, observedAt: vehicle.timestamp };
}

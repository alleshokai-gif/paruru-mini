import { createHmac } from 'node:crypto';
import bindings from 'gtfs-realtime-bindings';
import { serviceActive } from '../core/arrivals.js';

const validId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 128
  && !/[\u0000-\u001f\u007f]/.test(value);
const ownNumber = (value, name) => value && Object.hasOwn(value, name) && Number.isSafeInteger(Number(value[name]))
  ? Number(value[name]) : null;
const coordinate = (value, name, bound) => value && Object.hasOwn(value, name)
  && Number.isFinite(value[name]) && Math.abs(value[name]) <= bound ? value[name] : null;
const iso = (seconds) => new Date(seconds * 1000).toISOString();
const tripKey = (startDate, tripId) => `${startDate || ''}:${tripId || ''}`;

// Append-only candidate fields for a future Observation Platform schema migration.
// The deployed Sheet schema is intentionally unchanged by this research PoC.
export const PREORIGIN_OBSERVATION_FIELDS = Object.freeze([
  'preorigin_vehicle_seen',
  'preorigin_first_seen_at',
  'preorigin_distance_to_origin',
  'trip_assignment_transition_at',
  'seconds_before_scheduled',
  'arrival_to_origin',
  'departure_positive_evidence'
]);

function hmacVehicle(key, value, scope = '') {
  if (typeof key !== 'string' || key.length < 32) throw Error('PREORIGIN_HASH_KEY_INVALID');
  if (typeof scope !== 'string' || scope.length > 64 || /[\u0000-\u001f\u007f]/.test(scope))
    throw Error('PREORIGIN_HASH_SCOPE_INVALID');
  return validId(value) ? `veh_${createHmac('sha256', key).update(`${scope}\u001f${value}`).digest('hex').slice(0, 32)}` : null;
}

export function classifyRawVehiclePositions(bytes, { hashKey, receivedAt, hashScope = '', maxGpsAgeSec = 120,
  futureToleranceSec = 5 } = {}) {
  if (!(bytes instanceof Uint8Array) || !Number.isFinite(receivedAt)) throw Error('PREORIGIN_RAW_INPUT_INVALID');
  let feed;
  try { feed = bindings.transit_realtime.FeedMessage.decode(bytes); }
  catch { throw Error('PREORIGIN_RT_DECODE_FAILED'); }
  const vehicles = [];
  for (const entity of feed.entity || []) {
    const value = entity.vehicle;
    if (!value || entity.isDeleted) continue;
    const vehicleHash = hmacVehicle(hashKey, value.vehicle?.id, hashScope);
    const tripId = validId(value.trip?.tripId) ? value.trip.tripId : null;
    const routeId = validId(value.trip?.routeId) ? value.trip.routeId : null;
    const startDate = /^\d{8}$/.test(value.trip?.startDate || '') ? value.trip.startDate : null;
    const lat = coordinate(value.position, 'latitude', 90), lon = coordinate(value.position, 'longitude', 180);
    const hasPosition = lat !== null && lon !== null, timestamp = ownNumber(value, 'timestamp');
    const stale = timestamp !== null && (timestamp > receivedAt + futureToleranceSec || receivedAt - timestamp > maxGpsAgeSec);
    const runtimeAccepted = Boolean(tripId && startDate);
    const classification = runtimeAccepted ? 'assigned'
      : vehicleHash && hasPosition && !tripId && !routeId ? 'unassigned_candidate'
      : vehicleHash && hasPosition ? 'partial_assignment' : 'unusable';
    vehicles.push(Object.freeze({ vehicleHash, tripId, routeId, startDate,
      scheduleRelationship: ownNumber(value.trip, 'scheduleRelationship'), timestamp,
      position: Object.freeze({ lat, lon }), classification, runtimeAccepted, gpsMissing: !hasPosition, stale }));
  }
  const feedTimestamp = ownNumber(feed.header, 'timestamp');
  return Object.freeze({ receivedAt, feedTimestamp, vehicles: Object.freeze(vehicles), summary: Object.freeze({
    entities: vehicles.length, assigned: vehicles.filter((value) => value.classification === 'assigned').length,
    unassignedCandidates: vehicles.filter((value) => value.classification === 'unassigned_candidate').length,
    partialAssignments: vehicles.filter((value) => value.classification === 'partial_assignment').length,
    unusable: vehicles.filter((value) => value.classification === 'unusable').length,
    droppedByRuntimeParser: vehicles.filter((value) => !value.runtimeAccepted).length,
    tripIdMissing: vehicles.filter((value) => !value.tripId).length,
    routeIdMissing: vehicles.filter((value) => !value.routeId).length,
    positioned: vehicles.filter((value) => value.position.lat !== null && value.position.lon !== null).length,
    gpsMissing: vehicles.filter((value) => value.gpsMissing).length,
    stale: vehicles.filter((value) => value.stale).length
  }) });
}

export function extractKibukihonchoOriginTrips(index, { serviceDayStart = null } = {}) {
  const rows = index?.directions?.home_to_mizonokuchi;
  if (!Array.isArray(rows)) throw Error('PREORIGIN_STATIC_INVALID');
  return rows.filter((row) => row.isOrigin === true && row.originStopId === '184_1' && row.fromStopId === '184_1'
    && row.routeId === '10035' && (serviceDayStart === null || serviceActive(index, row.serviceId, serviceDayStart)))
    .map((row) => Object.freeze({ tripId: row.tripId, routeId: row.routeId, routeLabel: row.routeLabel,
      serviceId: row.serviceId, originStopId: row.originStopId, platform: row.platform,
      scheduledSeconds: row.scheduledSeconds, startTime: row.startTime, headsign: row.headsign }));
}

export function distanceMeters(a, b) {
  const rad = Math.PI / 180, lat = (a.lat + b.lat) / 2 * rad;
  const x = (b.lon - a.lon) * rad * Math.cos(lat), y = (b.lat - a.lat) * rad;
  return Math.hypot(x, y) * 6371008.8;
}

export function createPreoriginTracker({ origin, targetTrips, maxGpsAgeSec = 120, futureToleranceSec = 5,
  beforeSec = 15 * 60, afterSec = 5 * 60, candidateRadiusMeters = 4000, originRadiusMeters = 80 } = {}) {
  if (!Number.isFinite(origin?.lat) || !Number.isFinite(origin?.lon) || !Array.isArray(targetTrips)
    || !targetTrips.length) throw Error('PREORIGIN_TRACKER_CONFIG_INVALID');
  const targets = new Map();
  for (const value of targetTrips) {
    if (!validId(value?.tripId) || !/^\d{8}$/.test(value.serviceDate || '') || !Number.isFinite(value.scheduledDeparture))
      throw Error('PREORIGIN_TRACKER_CONFIG_INVALID');
    targets.set(tripKey(value.serviceDate, value.tripId), Object.freeze({ ...value }));
  }
  const history = new Map(), records = new Map();
  const fresh = (value, now) => Number.isFinite(value.timestamp) && value.timestamp <= now + futureToleranceSec
    && now - value.timestamp >= 0 && now - value.timestamp <= maxGpsAgeSec;
  function activeTargets(now) {
    return [...targets.entries()].filter(([, value]) => now >= value.scheduledDeparture - beforeSec
      && now <= value.scheduledDeparture + afterSec);
  }
  function ensure(key, target) {
    if (!records.has(key)) records.set(key, { tripId: target.tripId, serviceDate: target.serviceDate,
      scheduledDeparture: target.scheduledDeparture, preorigin_vehicle_seen: false, preorigin_first_seen_at: null,
      preorigin_distance_to_origin: null, trip_assignment_transition_at: null, seconds_before_scheduled: null,
      arrival_to_origin: null, departure_positive_evidence: null, vehicle_hash: null, level: 'undetermined' });
    return records.get(key);
  }
  function observe({ sample, now, departureEvidence = new Map() } = {}) {
    if (!sample?.vehicles || !Number.isFinite(now)) throw Error('PREORIGIN_TRACKER_INPUT_INVALID');
    const active = activeTargets(now), activeKeys = new Set(active.map(([key]) => key)), transitions = [];
    for (const vehicle of sample.vehicles) {
      if (!vehicle.vehicleHash || !fresh(vehicle, now) || !Number.isFinite(vehicle.position?.lat)
        || !Number.isFinite(vehicle.position?.lon)) continue;
      const distance = distanceMeters(vehicle.position, origin), assignedKey = tripKey(vehicle.startDate, vehicle.tripId);
      const previous = history.get(vehicle.vehicleHash);
      if (activeKeys.has(assignedKey)) {
        const target = targets.get(assignedKey), record = ensure(assignedKey, target);
        if (previous && previous.classification !== 'assigned' && previous.candidateKeys.has(assignedKey)) {
          record.preorigin_vehicle_seen = true; record.preorigin_first_seen_at ??= previous.firstSeenAt;
          record.preorigin_distance_to_origin = previous.minimumDistance;
          record.trip_assignment_transition_at ??= vehicle.timestamp;
          record.seconds_before_scheduled = target.scheduledDeparture - vehicle.timestamp;
          record.vehicle_hash = vehicle.vehicleHash; record.level = 'A';
          transitions.push({ tripKey: assignedKey, vehicleHash: vehicle.vehicleHash,
            level: 'A', transitionAt: vehicle.timestamp });
        }
        if (distance <= originRadiusMeters) record.arrival_to_origin ??= vehicle.timestamp;
        if (departureEvidence.has(assignedKey)) record.departure_positive_evidence = departureEvidence.get(assignedKey);
      }
      if (vehicle.classification !== 'assigned' && distance <= candidateRadiusMeters && active.length) {
        const candidateKeys = new Set(active.map(([key]) => key));
        const prior = history.get(vehicle.vehicleHash), firstSeenAt = prior?.firstSeenAt ?? vehicle.timestamp;
        const minimumDistance = Math.min(prior?.minimumDistance ?? Infinity, distance);
        history.set(vehicle.vehicleHash, { classification: vehicle.classification, candidateKeys, firstSeenAt, minimumDistance });
        for (const [key, target] of active) {
          const record = ensure(key, target); record.preorigin_vehicle_seen = true;
          record.preorigin_first_seen_at ??= vehicle.timestamp;
          record.preorigin_distance_to_origin = Math.min(record.preorigin_distance_to_origin ?? Infinity, distance);
          if (record.level === 'undetermined') record.level = 'B';
        }
      } else if (vehicle.classification === 'assigned') {
        history.set(vehicle.vehicleHash, { classification: 'assigned', candidateKeys: new Set(),
          firstSeenAt: vehicle.timestamp, minimumDistance: distance });
      }
    }
    return Object.freeze({ transitions: Object.freeze(transitions), records: Object.freeze([...records.values()].map((value) =>
      Object.freeze({ ...value, preorigin_first_seen_at: value.preorigin_first_seen_at ? iso(value.preorigin_first_seen_at) : null,
        trip_assignment_transition_at: value.trip_assignment_transition_at ? iso(value.trip_assignment_transition_at) : null,
        arrival_to_origin: value.arrival_to_origin ? iso(value.arrival_to_origin) : null,
        preorigin_distance_to_origin: Number.isFinite(value.preorigin_distance_to_origin)
          ? Number(value.preorigin_distance_to_origin.toFixed(1)) : null }))) });
  }
  return { observe };
}

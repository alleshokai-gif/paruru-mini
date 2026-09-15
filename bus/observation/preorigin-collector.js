import { iso } from '../core/arrivals.js';
import { classifyRawVehiclePositions, createPreoriginTracker, distanceMeters,
  extractKibukihonchoOriginTrips } from '../research/preorigin.js';
import { finalizePreoriginObservation } from './preorigin-schema.js';

const DAY = 86400, JST = 9 * 3600, BEFORE_SEC = 15 * 60, AFTER_SEC = 5 * 60;
const CANDIDATE_RADIUS_METERS = 4000;
const EXPECTED_START_TIMES = Object.freeze([
  '06:50:00', '07:00:00', '07:10:00', '07:20:00', '07:30:00', '07:40:00',
  '07:50:00', '08:00:00', '08:10:00', '08:20:00', '08:35:00', '08:50:00'
]);
const dayStart = (seconds) => Math.floor((seconds + JST) / DAY) * DAY - JST;
const dateKey = (seconds) => iso(seconds).slice(0, 10).replaceAll('-', '');
const targetKey = (value) => `${value.serviceDate}:${value.tripId}`;
const jstIso = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value))
  ? iso(Date.parse(value) / 1000) : null;
const fresh = (value, now) => Number.isSafeInteger(value.timestamp) && value.timestamp <= now + 5
  && now - value.timestamp >= 0 && now - value.timestamp <= 120;

export function createPreoriginObservationCollector({ index, positionStatic, hashKey } = {}) {
  const origin = positionStatic?.stops?.['184_1']?.position;
  if (!index?.directions || positionStatic?.sourceVersion !== index.sourceVersion || !Number.isFinite(origin?.lat)
    || !Number.isFinite(origin?.lon) || typeof hashKey !== 'string' || hashKey.length < 32)
    throw Error('PREORIGIN_COLLECTOR_CONFIG_INVALID');
  let context = null;
  function prepare(now) {
    const start = dayStart(now), serviceDate = dateKey(now);
    if (context?.serviceDate === serviceDate) return context;
    const rows = extractKibukihonchoOriginTrips(index, { serviceDayStart: start });
    if (rows.length && (rows.length !== EXPECTED_START_TIMES.length
      || rows.map((row) => row.startTime).sort().join('|') !== [...EXPECTED_START_TIMES].sort().join('|')))
      throw Error('PREORIGIN_TARGET_SET_INVALID');
    const targets = rows.map((row) => Object.freeze({ ...row, serviceDate,
      scheduledDeparture: start + row.scheduledSeconds }));
    context = Object.freeze({ serviceDate, start, rows: Object.freeze(rows), targets: Object.freeze(targets),
      tracker: targets.length ? createPreoriginTracker({ origin, targetTrips: targets }) : null });
    return context;
  }
  function activeTargets(now) {
    return prepare(now).targets.filter((target) => now >= target.scheduledDeparture - BEFORE_SEC
      && now <= target.scheduledDeparture + AFTER_SEC);
  }
  function collect({ bytes, now, runId, sampleIndex } = {}) {
    if (!(bytes instanceof Uint8Array) || !Number.isFinite(now) || typeof runId !== 'string'
      || !Number.isInteger(sampleIndex) || sampleIndex < 0) throw Error('PREORIGIN_SAMPLE_INVALID');
    const current = prepare(now), active = activeTargets(now);
    if (!active.length || !current.tracker) return Object.freeze({ rows: Object.freeze([]), summary: null });
    const sample = classifyRawVehiclePositions(bytes, { hashKey, receivedAt: now, hashScope: current.serviceDate });
    const tracked = current.tracker.observe({ sample, now });
    const trackedByTarget = new Map(tracked.records.map((record) => [`${record.serviceDate}:${record.tripId}`, record]));
    const transitions = new Set(tracked.transitions.map((transition) => `${transition.tripKey}:${transition.vehicleHash}`));
    const feedAge = Number.isSafeInteger(sample.feedTimestamp) ? Math.max(0, now - sample.feedTimestamp) : null;
    const common = {
      run_id: runId, sample_index: sampleIndex, observed_at: iso(now), feed_timestamp: sample.feedTimestamp,
      rt_age_sec: feedAge, raw_vehicle_entities: sample.summary.entities, assigned_count: sample.summary.assigned,
      tripless_count: sample.summary.tripIdMissing, partial_descriptor_count: sample.summary.partialAssignments,
      stale_count: sample.summary.stale, gps_missing_count: sample.summary.gpsMissing,
      runtime_dropped_count: sample.summary.droppedByRuntimeParser
    };
    const rows = [];
    for (const target of active) {
      const key = targetKey(target), evidence = trackedByTarget.get(key);
      const base = {
        ...common, service_date: target.serviceDate, target_trip_id: target.tripId,
        scheduled_departure: iso(target.scheduledDeparture), origin_stop_id: target.originStopId,
        route_id: target.routeId, platform: target.platform || '', preorigin_vehicle_seen: evidence?.preorigin_vehicle_seen === true,
        preorigin_first_seen_at: jstIso(evidence?.preorigin_first_seen_at),
        preorigin_distance_to_origin: evidence?.preorigin_distance_to_origin ?? null,
        trip_assignment_transition_at: jstIso(evidence?.trip_assignment_transition_at),
        seconds_before_scheduled: evidence?.seconds_before_scheduled ?? null,
        arrival_to_origin: jstIso(evidence?.arrival_to_origin),
        departure_positive_evidence: evidence?.departure_positive_evidence || null,
        evidence_level: 'undetermined', censored: true
      };
      rows.push(finalizePreoriginObservation({ ...base, preorigin_observation_id: null,
        record_kind: 'target_snapshot', vehicle_classification: 'none', vehicle_hash: null,
        vehicle_timestamp: null, position_lat: null, position_lon: null, distance_to_origin_m: null,
        gps_age_sec: null }, hashKey));
      for (const vehicle of sample.vehicles) {
        const assignedToTarget = vehicle.classification === 'assigned'
          && vehicle.startDate === target.serviceDate && vehicle.tripId === target.tripId;
        const candidate = ['unassigned_candidate', 'partial_assignment'].includes(vehicle.classification)
          && vehicle.vehicleHash && fresh(vehicle, now) && Number.isFinite(vehicle.position.lat)
          && Number.isFinite(vehicle.position.lon)
          && distanceMeters(vehicle.position, origin) <= CANDIDATE_RADIUS_METERS;
        if (!assignedToTarget && !candidate) continue;
        const distance = Number.isFinite(vehicle.position.lat) && Number.isFinite(vehicle.position.lon)
          ? distanceMeters(vehicle.position, origin) : null;
        const transition = transitions.has(`${key}:${vehicle.vehicleHash}`);
        rows.push(finalizePreoriginObservation({ ...base, preorigin_observation_id: null,
          record_kind: transition ? 'assignment_transition' : 'vehicle_observation',
          vehicle_classification: vehicle.classification, vehicle_hash: vehicle.vehicleHash,
          vehicle_timestamp: vehicle.timestamp, position_lat: vehicle.position.lat, position_lon: vehicle.position.lon,
          distance_to_origin_m: distance, gps_age_sec: Number.isSafeInteger(vehicle.timestamp)
            ? Math.max(0, now - vehicle.timestamp) : null }, hashKey));
      }
    }
    return Object.freeze({ rows: Object.freeze(rows), summary: sample.summary });
  }
  return { activeTargetCount: (now) => activeTargets(now).length, collect,
    targetCount: (now) => prepare(now).targets.length };
}

export const PREORIGIN_EXPECTED_START_TIMES = EXPECTED_START_TIMES;

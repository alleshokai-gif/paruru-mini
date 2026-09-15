import { PREORIGIN_HEADERS } from './preorigin-schema.js';

const TARGET_TIMES = new Set([
  '06:50', '07:00', '07:10', '07:20', '07:30', '07:40', '07:50',
  '08:00', '08:10', '08:20', '08:35', '08:50'
]);
const VEHICLE_HASH = /^veh_[a-f0-9]{32}$/;
const OBSERVATION_ID = /^pre_[a-f0-9]{32}$/;
const RUN_ID = /^[a-z0-9][a-z0-9-]{0,127}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const COMPACT_DATE = /^\d{8}$/;
const isoTime = (value) => Number.isFinite(Date.parse(value || '')) ? Date.parse(value) : null;
const compact = (value) => value.replaceAll('-', '');
const object = (row) => Object.fromEntries(PREORIGIN_HEADERS.map((name, index) => [name, row[index] ?? '']));
const integer = (value) => value === '' || value === null || value === undefined ? 0 : Number(value);

function validateRow(value) {
  const scheduled = typeof value.scheduled_departure === 'string' ? value.scheduled_departure.slice(11, 16) : '';
  if (!OBSERVATION_ID.test(String(value.preorigin_observation_id)) || !RUN_ID.test(String(value.run_id))
    || !COMPACT_DATE.test(String(value.service_date)) || !TARGET_TIMES.has(scheduled)
    || String(value.origin_stop_id) !== '184_1' || String(value.route_id) !== '10035'
    || !['target_snapshot', 'vehicle_observation', 'assignment_transition'].includes(String(value.record_kind))
    || !['none', 'assigned', 'unassigned_candidate', 'partial_assignment'].includes(String(value.vehicle_classification))
    || String(value.evidence_level) !== 'undetermined'
    || value.vehicle_hash !== '' && !VEHICLE_HASH.test(String(value.vehicle_hash))
    || isoTime(value.observed_at) === null || isoTime(value.scheduled_departure) === null)
    throw Error('PREORIGIN_REPORT_ROW_INVALID');
  for (const name of ['sample_index', 'raw_vehicle_entities', 'assigned_count', 'tripless_count',
    'partial_descriptor_count', 'stale_count', 'gps_missing_count', 'runtime_dropped_count']) {
    const number = Number(value[name]);
    if (!Number.isInteger(number) || number < 0) throw Error('PREORIGIN_REPORT_ROW_INVALID');
  }
  return value;
}

function rowIdentity(value) {
  return PREORIGIN_HEADERS.map((name) => String(value[name] ?? '')).join('\u001f');
}

export function summarizePreoriginRows(values, targetDate) {
  if (!DATE.test(targetDate || '') || !Array.isArray(values) || !values.length
    || JSON.stringify(values[0].map(String)) !== JSON.stringify(PREORIGIN_HEADERS))
    throw Error('PREORIGIN_REPORT_INPUT_INVALID');
  if (values.length > 250001) throw Error('PREORIGIN_REPORT_TOO_LARGE');
  const seen = new Map(), rows = [], allRows = values.slice(1).map(object).map(validateRow);
  let duplicateRows = 0;
  for (const value of allRows) {
    if (String(value.service_date) !== compact(targetDate)) continue;
    const id = String(value.preorigin_observation_id), identity = rowIdentity(value);
    if (seen.has(id)) {
      if (seen.get(id) !== identity) throw Error('PREORIGIN_REPORT_DUPLICATE_CONFLICT');
      duplicateRows++;
    } else { seen.set(id, identity); rows.push(value); }
  }
  const samples = new Map(), chains = new Map(), trips = new Set(), runIds = new Set();
  for (const value of rows) {
    runIds.add(String(value.run_id)); trips.add(String(value.target_trip_id));
    const sampleKey = [value.run_id, value.sample_index, value.feed_timestamp].join(':');
    if (!samples.has(sampleKey)) samples.set(sampleKey, value);
    if (!VEHICLE_HASH.test(String(value.vehicle_hash))) continue;
    const chainKey = [value.service_date, value.target_trip_id, value.vehicle_hash].join(':');
    if (!chains.has(chainKey)) chains.set(chainKey, { tripId: String(value.target_trip_id), candidates: [], assigned: [] });
    const chain = chains.get(chainKey), at = isoTime(value.observed_at);
    if (['unassigned_candidate', 'partial_assignment'].includes(String(value.vehicle_classification))) chain.candidates.push(at);
    if (String(value.vehicle_classification) === 'assigned') chain.assigned.push(at);
  }
  const levelA = [], levelBTrips = new Set();
  for (const chain of chains.values()) {
    const firstCandidate = chain.candidates.length ? Math.min(...chain.candidates) : null;
    const firstAssigned = chain.assigned.length ? Math.min(...chain.assigned) : null;
    if (firstCandidate !== null && firstAssigned !== null && firstCandidate <= firstAssigned)
      levelA.push({ tripId: chain.tripId, elapsedMs: firstAssigned - firstCandidate });
    else if (firstCandidate !== null) levelBTrips.add(chain.tripId);
  }
  const levelATrips = new Set(levelA.map((value) => value.tripId));
  for (const tripId of levelATrips) levelBTrips.delete(tripId);
  const metrics = { rawVehicleEntities: 0, tripless: 0, partialDescriptors: 0, stale: 0, gpsMissing: 0,
    runtimeDropped: 0 };
  for (const value of samples.values()) {
    metrics.rawVehicleEntities += integer(value.raw_vehicle_entities);
    metrics.tripless += integer(value.tripless_count);
    metrics.partialDescriptors += integer(value.partial_descriptor_count);
    metrics.stale += integer(value.stale_count);
    metrics.gpsMissing += integer(value.gps_missing_count);
    metrics.runtimeDropped += integer(value.runtime_dropped_count);
  }
  return Object.freeze({ targetDate, executionsWithRows: runIds.size, rows: rows.length, uniqueObservationIds: seen.size,
    duplicateRows, targetTripsObserved: trips.size, samples: samples.size, metrics: Object.freeze(metrics),
    levelA: Object.freeze({ chains: levelA.length, trips: levelATrips.size }), levelBCandidateTrips: levelBTrips.size,
    levelC: null, levelCStatus: 'not_auto_classified', vehicleHashesValid: rows.every((value) =>
      value.vehicle_hash === '' || VEHICLE_HASH.test(String(value.vehicle_hash))) });
}

const jstDate = (value) => {
  const time = isoTime(value); return time === null ? null : new Date(time + 9 * 3600 * 1000).toISOString().slice(0, 10);
};

export function summarizePreoriginExecutions(executions, targetDate) {
  if (!DATE.test(targetDate || '') || !Array.isArray(executions)) throw Error('PREORIGIN_EXECUTION_REPORT_INPUT_INVALID');
  const rows = executions.filter((value) => jstDate(value.createTime) === targetDate);
  const succeeded = rows.filter((value) => Number(value.succeededCount || 0) > 0 && Number(value.failedCount || 0) === 0).length;
  const failed = rows.filter((value) => Number(value.failedCount || 0) > 0).length;
  const running = rows.filter((value) => !value.completionTime && Number(value.failedCount || 0) === 0).length;
  const latest = rows.slice().sort((a, b) => isoTime(b.createTime) - isoTime(a.createTime))[0];
  return Object.freeze({ targetDate, count: rows.length, succeeded, failed, running,
    latestExecution: latest?.name ? String(latest.name).split('/').at(-1) : null });
}

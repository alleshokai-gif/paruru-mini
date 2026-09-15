import { OBSERVATION_HEADERS } from './schema.js';
import { prepareShape, snapCandidates, validPoint } from '../position/geometry.js';
import { POSITION_POLICY } from '../position/policy.js';
import { finalizePositionEvaluation } from './position-evaluator-schema.js';

const HMAC = /^veh_[a-f0-9]{32}$/;
const OBSERVATION_ID = /^obs_[a-f0-9]{32}$/;
const asText = (value) => value === null || value === undefined ? '' : String(value);
const number = (value) => value === '' || value === null || value === undefined ? null : Number(value);
const percentile = (values, fraction) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))].toFixed(3));
};
const ratio = (part, total) => total ? Number((part / total).toFixed(6)) : null;
const jstDate = (value) => {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time + 9 * 3600 * 1000).toISOString().slice(0, 10) : null;
};

function parseRaw(rawValues, serviceDate, target) {
  const header = rawValues?.[0] || [], headerMatch = JSON.stringify(header) === JSON.stringify(OBSERVATION_HEADERS);
  const result = { headerMatch, rows: [], duplicateCount: 0, conflictingDuplicateCount: 0,
    tokenLeak: 0, rawId: 0, rawResponse: 0 };
  if (!headerMatch) return result;
  const seen = new Map();
  for (const row of rawValues.slice(1)) {
    if (!Array.isArray(row) || row.length > header.length) { result.conflictingDuplicateCount++; continue; }
    const value = Object.fromEntries(header.map((name, index) => [name, row[index] ?? '']));
    if (asText(value.service_date) !== serviceDate.replaceAll('-', '') || asText(value.provider) !== target.provider
      || asText(value.direction_id) !== target.directionId || asText(value.route_id) !== target.routeId) continue;
    const encoded = JSON.stringify(value), id = asText(value.observation_id);
    if (seen.has(id)) {
      if (seen.get(id) === encoded) result.duplicateCount++;
      else result.conflictingDuplicateCount++;
      continue;
    }
    seen.set(id, encoded);
    const cells = Object.values(value).map(asText);
    if (cells.some((cell) => /(?:Bearer\s+|ya29\.|access[_-]?token|ODPT_ACCESS_TOKEN)/i.test(cell))) result.tokenLeak++;
    if (cells.some((cell) => /^[\[{].*[\]}]$/.test(cell.trim()))) result.rawResponse++;
    const vehicle = asText(value.vehicle_hash);
    if ((vehicle && !HMAC.test(vehicle)) || cells.some((cell) => /(?:vehicle|entity)[_-]?id=/i.test(cell))) result.rawId++;
    result.rows.push({ ...value, _validId: OBSERVATION_ID.test(id), _vehicleHashValid: !vehicle || HMAC.test(vehicle) });
  }
  return result;
}

function projectStops(shape, chain, staticStops, policy) {
  let paths = [];
  for (const item of chain?.stops || []) {
    const stop = staticStops?.[item.stopId];
    if (!validPoint(stop?.position)) return { rows: [], orderViolations: 1, ambiguous: true };
    const candidates = snapCandidates(shape, stop.position, policy.stopRouteMeters, policy.candidateSlackMeters).slice(0, 16);
    if (!candidates.length) return { rows: [], orderViolations: 1, ambiguous: true };
    if (!paths.length) paths = candidates.map((candidate) => ({ score: candidate.distance,
      rows: [{ id: item.stopId, sequence: item.sequence, along: candidate.along, distance: candidate.distance }] }));
    else {
      const next = [];
      for (const path of paths) for (const candidate of candidates) if (candidate.along > path.rows.at(-1).along + 1)
        next.push({ score: path.score + candidate.distance,
          rows: [...path.rows, { id: item.stopId, sequence: item.sequence, along: candidate.along, distance: candidate.distance }] });
      if (!next.length) return { rows: [], orderViolations: 1, ambiguous: true };
      next.sort((a, b) => a.score - b.score); paths = next.slice(0, 256);
    }
  }
  paths.sort((a, b) => a.score - b.score);
  const best = paths[0], competitive = paths.filter((path) => path.score <= best.score + policy.candidateSlackMeters);
  const ambiguous = competitive.some((path) => path.rows.some((stop, index) =>
    Math.abs(stop.along - best.rows[index].along) >= policy.ambiguityMeters));
  return { rows: best.rows.map((stop, ordinal) => ({ ...stop, ordinal })), orderViolations: 0, ambiguous };
}

function geometryContext(geometryArtifact, positionStatic, target, policy) {
  if (!geometryArtifact || geometryArtifact.provider !== target.provider
    || geometryArtifact.staticSourceHash !== positionStatic?.sourceHash
    || geometryArtifact.directionId !== target.directionId) return null;
  const entries = Object.entries(geometryArtifact.chains || {}).filter(([, value]) => Array.isArray(value?.points));
  if (entries.length !== 1) return null;
  const [chainId, candidate] = entries[0], chain = positionStatic.chains?.[chainId];
  if (!chain) return null;
  const shape = prepareShape(candidate.points), stops = projectStops(shape, chain, positionStatic.stops, policy);
  return { chainId, candidate, chain, shape, stops, sourceType: geometryArtifact.sourceType,
    sourceVersion: geometryArtifact.sourceVersion, geometryId: candidate.geometryId };
}

function analyzeTraces(points, policy) {
  const groups = new Map();
  for (const point of points) {
    const key = `${point.serviceDate}:${point.tripId}:${point.vehicleHash}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(point);
  }
  let traces = 0, monotonic = 0, reverseOrJump = 0, jitter = 0, severe = 0;
  for (const rows of groups.values()) {
    const ordered = [...rows].sort((a, b) => a.timestamp - b.timestamp);
    const unique = [];
    for (const row of ordered) {
      if (unique.at(-1)?.timestamp === row.timestamp) continue;
      unique.push(row);
    }
    if (unique.length < 2) continue;
    traces++; let valid = true;
    for (let index = 1; index < unique.length; index++) {
      const previous = unique[index - 1], current = unique[index], dt = current.timestamp - previous.timestamp;
      const delta = current.along - previous.along, stopsDelta = current.stopsAway - previous.stopsAway;
      if (stopsDelta === 1) jitter++;
      else if (stopsDelta > 1) severe++;
      if (dt <= 0 || delta < -policy.jitterMeters || delta > dt * policy.maxSpeedMps + policy.jumpAllowanceMeters) {
        valid = false; reverseOrJump++;
      }
    }
    if (valid) monotonic++;
  }
  return { traces, monotonic, reverseOrJump, jitter, severe };
}

export function evaluatePositionObservations({ rawValues, serviceDate, evaluatedAt, positionStatic,
  geometryArtifact, target, policy: overrides = {} } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate || '') || !Number.isFinite(Date.parse(evaluatedAt || ''))
    || !target || !['provider', 'directionId', 'routeId'].every((name) =>
      typeof target[name] === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(target[name]))
    || !positionStatic?.sourceHash || !positionStatic?.trips || !positionStatic?.chains || !positionStatic?.stops)
    throw Error('POSITION_EVALUATOR_INPUT_INVALID');
  const policy = { ...POSITION_POLICY, shadowSearchMeters: 5000, ...overrides };
  const reasons = new Set(), parsed = parseRaw(rawValues, serviceDate, target || {});
  if (!parsed.headerMatch) reasons.add('RAW_SCHEMA_MISMATCH');
  if (parsed.conflictingDuplicateCount) reasons.add('OBSERVATION_ID_CONFLICT');
  if (parsed.tokenLeak) reasons.add('TOKEN_LEAK_SUSPECTED');
  if (parsed.rawId) reasons.add('RAW_ID_SUSPECTED');
  if (parsed.rawResponse) reasons.add('RAW_RESPONSE_SUSPECTED');
  if (parsed.rows.some((row) => !row._validId || !row._vehicleHashValid)) reasons.add('RAW_ROW_CONTRACT_INVALID');
  let geometry = null;
  try { geometry = geometryContext(geometryArtifact, positionStatic, target || {}, policy); }
  catch { reasons.add('GEOMETRY_ARTIFACT_INVALID'); }
  if (!geometry) reasons.add('GEOMETRY_SOURCE_UNAVAILABLE');

  let gpsRows = 0, gpsMissing = 0, gpsStale = 0, identityMissing = 0, usable = 0;
  let matched = 0, ambiguous = 0, offRoute = 0, tripMismatch = 0, confidenceFail = 0, auxContradictions = 0;
  const distances = [], segments = new Set(), points = [], serviceDays = new Set(), independentTrips = new Set();
  for (const row of parsed.rows) {
    const lat = number(row.position_lat), lon = number(row.position_lon), age = number(row.gps_age_sec);
    const timestamp = number(row.gps_timestamp), vehicleHash = asText(row.vehicle_hash);
    if (lat === null || lon === null || !validPoint({ lat, lon })) { gpsMissing++; continue; }
    gpsRows++;
    if (!Number.isFinite(age) || age > policy.maxAgeSec || age < -policy.futureSec || !Number.isSafeInteger(timestamp)) {
      gpsStale++; continue;
    }
    if (!HMAC.test(vehicleHash)) { identityMissing++; continue; }
    usable++; serviceDays.add(asText(row.service_date));
    independentTrips.add(`${row.service_date}:${row.trip_id}:${vehicleHash}`);
    if (!geometry?.stops.rows.length) continue;
    if (positionStatic.trips?.[asText(row.trip_id)]?.chainId !== geometry.chainId) { tripMismatch++; continue; }
    const candidates = snapCandidates(geometry.shape, { lat, lon }, policy.shadowSearchMeters, policy.candidateSlackMeters);
    if (!candidates.length) { offRoute++; continue; }
    const snap = candidates[0];
    if (candidates.some((candidate) => Math.abs(candidate.along - snap.along) >= policy.ambiguityMeters)) {
      ambiguous++; continue;
    }
    distances.push(snap.distance);
    if (snap.distance > policy.routeMeters) { offRoute++; continue; }
    const nextIndex = geometry.stops.rows.findIndex((stop) => stop.along > snap.along);
    if (nextIndex < 0) { offRoute++; continue; }
    const previous = geometry.stops.rows[nextIndex - 1] || null, next = geometry.stops.rows[nextIndex];
    const confidence = Math.max(0, Math.min(1, 0.98 - 0.10 * age / policy.maxAgeSec
      - 0.10 * snap.distance / policy.routeMeters));
    if (confidence < policy.threshold) { confidenceFail++; continue; }
    matched++; if (nextIndex > 0) segments.add(nextIndex - 1);
    const stopsAway = geometry.stops.rows.length - 1 - nextIndex;
    const auxSequence = number(row.aux_stop_sequence);
    if (auxSequence !== null && ![previous?.sequence, next.sequence].includes(auxSequence)) auxContradictions++;
    points.push({ serviceDate: asText(row.service_date), tripId: asText(row.trip_id), vehicleHash,
      timestamp, along: snap.along, stopsAway });
  }
  const traces = analyzeTraces(points, policy), stopProjectionAmbiguous = Boolean(geometry?.stops.ambiguous
    || geometry?.candidate?.reasons?.includes('stop_projection_ambiguous'));
  if (stopProjectionAmbiguous) reasons.add('STOP_PROJECTION_AMBIGUOUS');
  if (!parsed.rows.length) reasons.add('NO_TARGET_OBSERVATIONS');
  if (!usable) reasons.add('NO_USABLE_GPS');
  if (geometry && geometry.candidate.eligible !== true) reasons.add('GEOMETRY_ARTIFACT_NOT_ELIGIBLE');
  if (tripMismatch) reasons.add('TRIP_GEOMETRY_MISMATCH');
  if (serviceDays.size < 3) reasons.add('MULTI_DAY_COVERAGE_INSUFFICIENT');
  if (geometry && segments.size < Math.max(0, geometry.stops.rows.length - 1)) reasons.add('SEGMENT_COVERAGE_INSUFFICIENT');
  if (traces.traces === 0) reasons.add('DIRECTION_EVIDENCE_INSUFFICIENT');
  if (traces.reverseOrJump) reasons.add('DIRECTION_CONTRADICTION_PRESENT');
  if (traces.severe) reasons.add('SEVERE_STOPS_AWAY_CONTRADICTION');
  reasons.add('PUBLIC_GATE_POLICY_UNCALIBRATED');
  reasons.add('OFFICIAL_REFERENCE_NOT_AUTOMATED');
  const fatal = ['RAW_SCHEMA_MISMATCH', 'OBSERVATION_ID_CONFLICT', 'TOKEN_LEAK_SUSPECTED', 'RAW_ID_SUSPECTED',
    'RAW_RESPONSE_SUSPECTED', 'RAW_ROW_CONTRACT_INVALID', 'GEOMETRY_ARTIFACT_INVALID'];
  const reasonCodes = [...reasons].sort(), decision = reasonCodes.some((code) => fatal.includes(code)) ? 'NO_GO' : 'HOLD';
  return finalizePositionEvaluation({
    service_date: serviceDate, evaluated_at: evaluatedAt, provider: target?.provider || '',
    direction_id: target?.directionId || '', route_id: target?.routeId || '',
    geometry_source: geometry?.sourceType || null, geometry_version: geometry?.sourceVersion || null,
    geometry_id: geometry?.geometryId || null, stage: geometry && parsed.rows.length ? 'stage_1_shadow' : 'stage_0',
    raw_rows: parsed.rows.length, unique_observations: parsed.rows.length, duplicate_count: parsed.duplicateCount,
    conflicting_duplicate_count: parsed.conflictingDuplicateCount, service_day_count: serviceDays.size,
    independent_trip_count: independentTrips.size, gps_rows: gpsRows, gps_missing_rows: gpsMissing,
    gps_stale_rows: gpsStale, identity_missing_rows: identityMissing, gps_usable_rows: usable,
    gps_usable_coverage: ratio(usable, parsed.rows.length), snap_matched_rows: matched,
    snap_ambiguous_rows: ambiguous, snap_off_route_rows: offRoute, trip_geometry_mismatch_rows: tripMismatch,
    snap_match_rate: ratio(matched, usable),
    snap_distance_p50_m: percentile(distances, 0.50), snap_distance_p80_m: percentile(distances, 0.80),
    snap_distance_p90_m: percentile(distances, 0.90), snap_distance_p95_m: percentile(distances, 0.95),
    snap_distance_max_m: percentile(distances, 1), confidence_fail_rows: confidenceFail,
    direction_trace_count: traces.traces, monotonic_trace_count: traces.monotonic,
    direction_accuracy: ratio(traces.monotonic, traces.traces), reverse_or_jump_count: traces.reverseOrJump,
    stop_count: geometry?.chain?.stops?.length || 0, stop_projection_count: geometry?.stops.rows.length || 0,
    stop_projection_order_violation_count: geometry?.stops.orderViolations || 0,
    expected_segment_count: Math.max(0, (geometry?.stops.rows.length || 0) - 1), observed_segment_count: segments.size,
    segment_coverage: ratio(segments.size, Math.max(0, (geometry?.stops.rows.length || 0) - 1)),
    stops_away_rows: points.length, stops_away_jitter_count: traces.jitter,
    severe_stops_away_contradiction_count: traces.severe, aux_sequence_contradiction_count: auxContradictions,
    token_leak_count: parsed.tokenLeak, raw_id_count: parsed.rawId, raw_response_count: parsed.rawResponse,
    header_match: parsed.headerMatch, geometry_ready: false, decision, reasonCodes
  });
}

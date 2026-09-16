import { OBSERVATION_HEADERS } from './schema.js';
import { prepareShape, snapCandidates, validPoint } from '../position/geometry.js';
import { POSITION_POLICY } from '../position/policy.js';
import { finalizePositionDaily, finalizePositionObservation } from './position-evaluator-schema.js';

const HMAC = /^veh_[a-f0-9]{32}$/;
const OBSERVATION_ID = /^obs_[a-f0-9]{32}$/;
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,200}$/;
const asText = (value) => value === null || value === undefined ? '' : String(value);
const number = (value) => value === '' || value === null || value === undefined ? null : Number(value);
const round = (value, digits = 6) => Number(Number(value).toFixed(digits));
const percentile = (values, fraction) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return round(sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))], 3);
};
const ratio = (part, total) => total ? round(part / total) : null;
const serviceDateCompact = (value) => value.replaceAll('-', '');

function parseRaw(rawValues, serviceDate, target) {
  const header = rawValues?.[0] || [], headerMatch = JSON.stringify(header) === JSON.stringify(OBSERVATION_HEADERS);
  const result = { headerMatch, rows: [], duplicateCount: 0, conflictingDuplicateCount: 0,
    tokenLeak: 0, rawId: 0, rawResponse: 0 };
  if (!headerMatch) return result;
  const seen = new Map();
  for (const row of rawValues.slice(1)) {
    if (!Array.isArray(row) || row.length > header.length) { result.conflictingDuplicateCount++; continue; }
    const value = Object.fromEntries(header.map((name, index) => [name, row[index] ?? '']));
    if (asText(value.service_date) !== serviceDateCompact(serviceDate) || asText(value.provider) !== target.provider
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
    result.rows.push({ ...value, _validId: OBSERVATION_ID.test(id), _vehicleHashValid: !vehicle || HMAC.test(vehicle),
      _observedAtValid: Number.isFinite(Date.parse(asText(value.observed_at))) });
  }
  return result;
}

function approvedStops(candidate, chain, shape) {
  if (candidate?.approvedForShadow !== true || !Array.isArray(candidate.stopProjections)
    || candidate.stopProjections.length !== chain?.stops?.length) throw Error('GEOMETRY_ARTIFACT_INVALID');
  let previousAlong = -1;
  const rows = candidate.stopProjections.map((row, index) => {
    const expected = chain.stops[index];
    if (row?.stopId !== expected.stopId || row.sequence !== expected.sequence || row.ordinal !== index
      || !Number.isFinite(row.along) || row.along < 0 || row.along > shape.total + 1
      || (index && row.along <= previousAlong + 1) || !Number.isFinite(row.distance) || row.distance < 0)
      throw Error('GEOMETRY_ARTIFACT_INVALID');
    previousAlong = row.along;
    return { id: row.stopId, sequence: row.sequence, ordinal: index, along: row.along, distance: row.distance };
  });
  return { rows, orderViolations: 0, ambiguous: false, source: 'approved_shadow_projection' };
}

function geometryContext(geometryArtifact, positionStatic, target, policy) {
  if (!geometryArtifact) return null;
  if (geometryArtifact.provider !== target.provider || geometryArtifact.staticSourceHash !== positionStatic?.sourceHash
    || geometryArtifact.routeId !== target.routeId || geometryArtifact.directionId !== target.directionId
    || geometryArtifact.approvedForShadow !== true || geometryArtifact.approvedForPublic !== false
    || geometryArtifact.geometryReady !== false) throw Error('GEOMETRY_ARTIFACT_INVALID');
  const entries = Object.entries(geometryArtifact.chains || {}).filter(([, value]) => Array.isArray(value?.points));
  if (entries.length !== 1) throw Error('GEOMETRY_ARTIFACT_INVALID');
  const [chainId, candidate] = entries[0], chain = positionStatic.chains?.[chainId];
  if (!chain) throw Error('GEOMETRY_ARTIFACT_INVALID');
  const shape = prepareShape(candidate.points), stops = approvedStops(candidate, chain, shape);
  const targetIndexes = stops.rows.flatMap((stop, index) => stop.id === target.targetStopId ? [index] : []);
  if (targetIndexes.length !== 1) throw Error('TARGET_STOP_NOT_IN_GEOMETRY');
  return { chainId, candidate, chain, shape, stops, targetIndex: targetIndexes[0],
    sourceType: geometryArtifact.sourceType, sourceVersion: geometryArtifact.sourceVersion,
    geometryId: candidate.geometryId };
}

function baseDraft(row, serviceDate, target, geometry) {
  return {
    source_observation_id: asText(row.observation_id), service_date: serviceDate,
    observed_at: asText(row.observed_at), provider: target.provider, route_id: target.routeId,
    trip_id: asText(row.trip_id), direction: target.directionId, vehicle_hmac: asText(row.vehicle_hash),
    geometry_source: geometry?.sourceType || null, geometry_version: geometry?.sourceVersion || null,
    geometry_id: geometry?.geometryId || null, snap_distance_m: null, snapped_progress: null,
    inferred_direction: 'unknown', direction_confidence: null, previous_stop_id: null, next_stop_id: null,
    stop_interval_index: null, candidate_stops_away: null, stops_away_confidence: null,
    monotonicity_status: 'not_evaluated', jitter_flag: false, severe_contradiction_flag: false,
    ambiguity_reason: null, aux_consistency: 'not_available'
  };
}

function auxiliaryConsistency(row, previous, next) {
  const sequence = number(row.aux_stop_sequence), stopId = asText(row.aux_stop_id);
  if (sequence === null && !stopId) return 'not_available';
  const sequenceMatch = sequence === null || [previous?.sequence, next?.sequence].includes(sequence);
  const stopMatch = !stopId || [previous?.id, next?.id].includes(stopId);
  return sequenceMatch && stopMatch ? 'consistent' : 'conflict';
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
    if (ordered.length < 2) {
      if (ordered[0]) ordered[0].draft.monotonicity_status = 'insufficient_history';
      continue;
    }
    traces++; let valid = true;
    ordered[0].draft.monotonicity_status = 'insufficient_history';
    for (let index = 1; index < ordered.length; index++) {
      const previous = ordered[index - 1], current = ordered[index];
      const dt = current.timestamp - previous.timestamp, delta = current.along - previous.along;
      const stopsDelta = current.stopsAway - previous.stopsAway;
      if (dt <= 0) {
        current.draft.monotonicity_status = 'duplicate_timestamp';
        current.draft.ambiguity_reason ||= 'duplicate_timestamp';
        valid = false; reverseOrJump++;
      } else if (delta < -policy.jitterMeters) {
        current.draft.monotonicity_status = 'reverse';
        current.draft.inferred_direction = 'reverse';
        current.draft.direction_confidence = current.confidence;
        current.draft.severe_contradiction_flag = true;
        valid = false; reverseOrJump++;
      } else if (delta > dt * policy.maxSpeedMps + policy.jumpAllowanceMeters) {
        current.draft.monotonicity_status = 'jump';
        current.draft.ambiguity_reason ||= 'implausible_jump';
        current.draft.severe_contradiction_flag = true;
        valid = false; reverseOrJump++;
      } else {
        current.draft.monotonicity_status = 'monotonic';
        if (delta > policy.jitterMeters) {
          current.draft.inferred_direction = 'forward';
          current.draft.direction_confidence = current.confidence;
        } else current.draft.direction_confidence = round(current.confidence * 0.5);
      }
      if (stopsDelta === 1) { current.draft.jitter_flag = true; jitter++; }
      else if (stopsDelta > 1) { current.draft.severe_contradiction_flag = true; severe++; }
    }
    if (valid) monotonic++;
  }
  return { traces, monotonic, reverseOrJump, jitter, severe };
}

function validateInput({ serviceDate, evaluatedAt, positionStatic, target }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate || '') || !Number.isFinite(Date.parse(evaluatedAt || ''))
    || !target || !['provider', 'directionId', 'routeId', 'targetStopId'].every((name) =>
      typeof target[name] === 'string' && SAFE_ID.test(target[name]))
    || !positionStatic?.sourceHash || !positionStatic?.trips || !positionStatic?.chains || !positionStatic?.stops)
    throw Error('POSITION_EVALUATOR_INPUT_INVALID');
}

export function derivePositionEvaluations({ rawValues, serviceDate, evaluatedAt, positionStatic,
  geometryArtifact, target, policy: overrides = {} } = {}) {
  validateInput({ serviceDate, evaluatedAt, positionStatic, target });
  const policy = { ...POSITION_POLICY, shadowSearchMeters: 5000, ...overrides };
  const reasons = new Set(), parsed = parseRaw(rawValues, serviceDate, target);
  if (!parsed.headerMatch) reasons.add('RAW_SCHEMA_MISMATCH');
  if (parsed.conflictingDuplicateCount) reasons.add('OBSERVATION_ID_CONFLICT');
  if (parsed.tokenLeak) reasons.add('TOKEN_LEAK_SUSPECTED');
  if (parsed.rawId) reasons.add('RAW_ID_SUSPECTED');
  if (parsed.rawResponse) reasons.add('RAW_RESPONSE_SUSPECTED');
  if (parsed.rows.some((row) => !row._validId || !row._vehicleHashValid || !row._observedAtValid))
    reasons.add('RAW_ROW_CONTRACT_INVALID');
  let geometry = null;
  try { geometry = geometryContext(geometryArtifact, positionStatic, target, policy); }
  catch (error) { reasons.add(error?.message === 'TARGET_STOP_NOT_IN_GEOMETRY'
    ? 'TARGET_STOP_NOT_IN_GEOMETRY' : 'GEOMETRY_ARTIFACT_INVALID'); }
  if (!geometry) reasons.add('GEOMETRY_SOURCE_UNAVAILABLE');

  let gpsRows = 0, gpsMissing = 0, gpsStale = 0, identityMissing = 0, usable = 0;
  let matched = 0, ambiguous = 0, offRoute = 0, tripMismatch = 0, confidenceFail = 0, auxContradictions = 0;
  const distances = [], intervals = new Set(), points = [], drafts = [], serviceDays = new Set();
  const independentTrips = new Set(), timebands = new Set();
  for (const row of parsed.rows) {
    const vehicleHash = asText(row.vehicle_hash), tripId = asText(row.trip_id);
    if (!row._validId || !row._vehicleHashValid || !row._observedAtValid || !HMAC.test(vehicleHash)
      || !SAFE_ID.test(tripId)) { identityMissing++; continue; }
    const draft = baseDraft(row, serviceDate, target, geometry); drafts.push(draft);
    const observed = new Date(Date.parse(draft.observed_at) + 9 * 3600 * 1000);
    timebands.add(observed.getUTCHours() < 12 ? 'morning' : 'evening');
    const lat = number(row.position_lat), lon = number(row.position_lon), age = number(row.gps_age_sec);
    const timestamp = number(row.gps_timestamp);
    if (lat === null || lon === null || !validPoint({ lat, lon })) {
      gpsMissing++; draft.ambiguity_reason = 'gps_missing'; continue;
    }
    gpsRows++;
    if (!Number.isFinite(age) || age > policy.maxAgeSec || age < -policy.futureSec || !Number.isSafeInteger(timestamp)) {
      gpsStale++; draft.ambiguity_reason = 'stale_gps'; continue;
    }
    usable++; serviceDays.add(asText(row.service_date));
    independentTrips.add(`${row.service_date}:${tripId}:${vehicleHash}`);
    if (!geometry?.stops.rows.length) { draft.ambiguity_reason = 'geometry_source_unavailable'; continue; }
    if (positionStatic.trips?.[tripId]?.chainId !== geometry.chainId) {
      tripMismatch++; draft.ambiguity_reason = 'trip_geometry_mismatch'; continue;
    }
    const candidates = snapCandidates(geometry.shape, { lat, lon }, policy.shadowSearchMeters, policy.candidateSlackMeters);
    if (!candidates.length) { offRoute++; draft.ambiguity_reason = 'route_snap_failed'; continue; }
    const snap = candidates[0]; draft.snap_distance_m = round(snap.distance, 3);
    draft.snapped_progress = round(snap.along / geometry.shape.total);
    distances.push(snap.distance);
    if (candidates.some((candidate) => Math.abs(candidate.along - snap.along) >= policy.ambiguityMeters)) {
      ambiguous++; draft.monotonicity_status = 'ambiguous'; draft.ambiguity_reason = 'route_crossing_ambiguous'; continue;
    }
    if (snap.distance > policy.routeMeters) { offRoute++; draft.ambiguity_reason = 'off_route'; continue; }
    const nextIndex = geometry.stops.rows.findIndex((stop) => stop.along > snap.along);
    if (nextIndex < 0 || nextIndex > geometry.targetIndex) {
      offRoute++; draft.ambiguity_reason = 'target_passed_or_route_end'; continue;
    }
    const previous = geometry.stops.rows[nextIndex - 1] || null, next = geometry.stops.rows[nextIndex];
    const confidence = round(Math.max(0, Math.min(1, 0.98 - 0.10 * age / policy.maxAgeSec
      - 0.10 * snap.distance / policy.routeMeters)));
    draft.previous_stop_id = previous?.id || null; draft.next_stop_id = next.id;
    draft.stop_interval_index = Math.max(0, nextIndex - 1);
    draft.candidate_stops_away = geometry.targetIndex - nextIndex;
    draft.aux_consistency = auxiliaryConsistency(row, previous, next);
    if (draft.aux_consistency === 'conflict') auxContradictions++;
    if (geometry.stops.ambiguous) {
      ambiguous++; draft.monotonicity_status = 'ambiguous'; draft.ambiguity_reason = 'stop_projection_ambiguous'; continue;
    }
    if (confidence < policy.threshold) {
      confidenceFail++; draft.ambiguity_reason = 'low_confidence'; continue;
    }
    matched++; intervals.add(draft.stop_interval_index); draft.stops_away_confidence = confidence;
    points.push({ serviceDate: asText(row.service_date), tripId, vehicleHash, timestamp, along: snap.along,
      stopsAway: draft.candidate_stops_away, confidence, draft });
  }

  const traces = analyzeTraces(points, policy);
  const evaluations = drafts.map((draft) => finalizePositionObservation(draft));
  const stopProjectionAmbiguous = Boolean(geometry?.stops.ambiguous);
  if (stopProjectionAmbiguous) reasons.add('STOP_PROJECTION_AMBIGUOUS');
  if (!parsed.rows.length) reasons.add('NO_TARGET_OBSERVATIONS');
  if (!usable) reasons.add('NO_USABLE_GPS');
  if (geometry && geometry.candidate.eligible !== true) reasons.add('GEOMETRY_ARTIFACT_NOT_ELIGIBLE');
  if (tripMismatch) reasons.add('TRIP_GEOMETRY_MISMATCH');
  if (serviceDays.size < 3) reasons.add('MULTI_DAY_COVERAGE_INSUFFICIENT');
  if (timebands.size < 2) reasons.add('MULTI_TIMEBAND_COVERAGE_INSUFFICIENT');
  if (geometry && intervals.size < Math.max(0, Math.min(geometry.targetIndex, geometry.stops.rows.length - 1)))
    reasons.add('STOP_INTERVAL_COVERAGE_INSUFFICIENT');
  if (traces.traces === 0) reasons.add('DIRECTION_EVIDENCE_INSUFFICIENT');
  if (traces.reverseOrJump) reasons.add('DIRECTION_CONTRADICTION_PRESENT');
  if (traces.severe) reasons.add('SEVERE_STOPS_AWAY_CONTRADICTION');
  reasons.add('PUBLIC_GATE_POLICY_UNCALIBRATED');
  reasons.add('OFFICIAL_REFERENCE_NOT_AUTOMATED');
  const fatal = new Set(['RAW_SCHEMA_MISMATCH', 'OBSERVATION_ID_CONFLICT', 'TOKEN_LEAK_SUSPECTED',
    'RAW_ID_SUSPECTED', 'RAW_RESPONSE_SUSPECTED', 'RAW_ROW_CONTRACT_INVALID', 'GEOMETRY_ARTIFACT_INVALID',
    'TARGET_STOP_NOT_IN_GEOMETRY']);
  const reasonCodes = [...reasons].sort(), decision = reasonCodes.some((code) => fatal.has(code)) ? 'NO_GO' : 'HOLD';
  const expectedIntervals = geometry ? Math.max(0, Math.min(geometry.targetIndex, geometry.stops.rows.length - 1)) : 0;
  const daily = finalizePositionDaily({
    service_date: serviceDate, evaluated_at: evaluatedAt, provider: target.provider,
    direction_id: target.directionId, route_id: target.routeId,
    geometry_source: geometry?.sourceType || null, geometry_version: geometry?.sourceVersion || null,
    geometry_id: geometry?.geometryId || null, stage: geometry && parsed.rows.length ? 'stage_1_shadow' : 'stage_0',
    raw_rows: parsed.rows.length, unique_observations: parsed.rows.length, derived_rows: evaluations.length,
    duplicate_count: parsed.duplicateCount, conflicting_duplicate_count: parsed.conflictingDuplicateCount,
    service_day_count: serviceDays.size, independent_trip_count: independentTrips.size, timeband_count: timebands.size,
    gps_rows: gpsRows, gps_missing_rows: gpsMissing, gps_stale_rows: gpsStale,
    identity_missing_rows: identityMissing, gps_usable_rows: usable,
    gps_usable_coverage: ratio(usable, parsed.rows.length), snap_matched_rows: matched,
    snap_ambiguous_rows: ambiguous, snap_off_route_rows: offRoute, trip_geometry_mismatch_rows: tripMismatch,
    snap_match_rate: ratio(matched, usable), snap_distance_p50_m: percentile(distances, 0.50),
    snap_distance_p80_m: percentile(distances, 0.80), snap_distance_p90_m: percentile(distances, 0.90),
    snap_distance_p95_m: percentile(distances, 0.95), snap_distance_max_m: percentile(distances, 1),
    confidence_fail_rows: confidenceFail, direction_trace_count: traces.traces,
    monotonic_trace_count: traces.monotonic, direction_consistency: ratio(traces.monotonic, traces.traces),
    reverse_or_jump_count: traces.reverseOrJump, stop_count: geometry?.chain?.stops?.length || 0,
    stop_projection_count: geometry?.stops.rows.length || 0,
    stop_projection_order_violation_count: geometry?.stops.orderViolations || 0,
    expected_interval_count: expectedIntervals, observed_interval_count: intervals.size,
    stop_interval_coverage: ratio(intervals.size, expectedIntervals), stops_away_rows: points.length,
    stops_away_jitter_count: traces.jitter, severe_stops_away_contradiction_count: traces.severe,
    aux_sequence_contradiction_count: auxContradictions,
    ambiguous_count: evaluations.filter((row) => row.ambiguity_reason !== null).length,
    stale_count: gpsStale, token_leak_count: parsed.tokenLeak, raw_id_count: parsed.rawId,
    raw_response_count: parsed.rawResponse, header_match: parsed.headerMatch,
    geometry_ready_candidate: false, decision, reasonCodes
  });
  return Object.freeze({ evaluations: Object.freeze(evaluations), daily });
}

export function evaluatePositionObservations(args = {}) {
  return derivePositionEvaluations(args).daily;
}

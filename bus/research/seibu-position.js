const fail = (code) => { throw new Error(code); };
const finite = Number.isFinite;
const round = (value, digits = 1) => Number(value.toFixed(digits));

export function distanceMeters(a, b) {
  if (![a?.lat, a?.lon, b?.lat, b?.lon].every(finite)) return null;
  const rad = Math.PI / 180, latitude = (a.lat + b.lat) / 2 * rad;
  const x = (b.lon - a.lon) * rad * Math.cos(latitude), y = (b.lat - a.lat) * rad;
  return Math.hypot(x, y) * 6371008.8;
}

const unsupported = () => ({ supported: false, state: null, stopsAway: null,
  previousStop: null, nextStop: null, confidence: null });

export function analyzeSeibuPositionSample({ positionIndex, vehicles, receivedAt,
  maxGpsAgeSec = 120, gpsStopToleranceMeters = 700 } = {}) {
  if (positionIndex?.provider !== 'seibu' || !positionIndex.trips || !Array.isArray(vehicles)
    || !finite(receivedAt) || !finite(maxGpsAgeSec) || maxGpsAgeSec < 0
    || !finite(gpsStopToleranceMeters) || gpsStopToleranceMeters <= 0) fail('BUS_SEIBU_POSITION_INPUT');
  const observations = [];
  for (const vehicle of vehicles) {
    const trip = positionIndex.trips[vehicle?.tripId];
    if (!trip) continue;
    const gps = vehicle.position, timestamp = vehicle.timestamp;
    const ageSec = finite(timestamp) ? receivedAt - timestamp : null;
    const stale = !finite(ageSec) || ageSec < -5 || ageSec > maxGpsAgeSec;
    const gpsMissing = !finite(gps?.lat) || !finite(gps?.lon);
    const routeMismatch = Boolean(vehicle.routeId && vehicle.routeId !== trip.routeId);
    const bySequence = Number.isInteger(vehicle.rawState?.sequence)
      ? trip.stops.find((row) => row.sequence === vehicle.rawState.sequence) : null;
    const byStop = vehicle.rawState?.stopId
      ? trip.stops.find((row) => row.stopId === vehicle.rawState.stopId) : null;
    const sequenceStopMismatch = Boolean(bySequence && byStop && bySequence.ordinal !== byStop.ordinal);
    const reference = sequenceStopMismatch ? null : bySequence || byStop || null;
    let nearest = null;
    if (!gpsMissing) for (const stop of trip.stops) {
      const distance = distanceMeters(gps, stop);
      if (!nearest || distance < nearest.distanceMeters) nearest = { stop, distanceMeters: distance };
    }
    const distanceToReported = !gpsMissing && reference ? distanceMeters(gps, reference) : null;
    const nearestOrdinalDelta = reference && nearest ? Math.abs(nearest.stop.ordinal - reference.ordinal) : null;
    const gpsConsistent = Boolean(reference && nearest && (distanceToReported <= gpsStopToleranceMeters
      || nearestOrdinalDelta <= 1));
    const stopsAwayCandidate = reference ? trip.targetOrdinal - reference.ordinal : null;
    const targetPassed = Number.isInteger(stopsAwayCandidate) && stopsAwayCandidate < 0;
    const candidateValid = !stale && !gpsMissing && !routeMismatch && !sequenceStopMismatch
      && Boolean(reference) && gpsConsistent && !targetPassed;
    const reason = stale ? 'gps_stale' : gpsMissing ? 'gps_missing' : routeMismatch ? 'route_mismatch'
      : sequenceStopMismatch ? 'sequence_stop_mismatch' : !reference ? 'sequence_stop_unresolved'
        : targetPassed ? 'target_passed' : !gpsConsistent ? 'gps_inconsistent' : null;
    observations.push({ provider: 'seibu', tripId: trip.tripId, routeId: trip.routeId,
      sourceId: trip.sourceId, targetStopId: trip.targetStopId, targetSequence: trip.targetSequence,
      timestamp, gpsAgeSec: finite(ageSec) ? round(ageSec) : null,
      rawState: { stopId: vehicle.rawState?.stopId ?? null,
        sequence: vehicle.rawState?.sequence ?? null, status: vehicle.rawState?.status ?? null },
      gps: gpsMissing ? { lat: null, lon: null, nearestStopId: null, nearestStopDistanceMeters: null,
        distanceToReportedStopMeters: null }
        : { lat: round(gps.lat, 5), lon: round(gps.lon, 5), nearestStopId: nearest?.stop.stopId ?? null,
          nearestStopDistanceMeters: nearest ? round(nearest.distanceMeters) : null,
          distanceToReportedStopMeters: finite(distanceToReported) ? round(distanceToReported) : null },
      stopsAwayCandidate: candidateValid ? stopsAwayCandidate : null,
      candidateValid, candidateMethod: candidateValid ? 'gtfs_sequence_gps_coarse_check' : null,
      statusKnown: Number.isInteger(vehicle.rawState?.status),
      publicationBlock: reason || (Number.isInteger(vehicle.rawState?.status)
        ? 'poc_not_calibrated' : 'current_status_missing'),
      position: unsupported() });
  }
  return observations;
}

export function summarizeSeibuPositionObservations(samples) {
  if (!Array.isArray(samples)) fail('BUS_SEIBU_POSITION_SAMPLES');
  const previous = new Map();
  let targetVehicles = 0, candidateValid = 0, statusPresent = 0, sameTripPairs = 0;
  let monotonicPairs = 0, sequenceRegressions = 0, gpsMovingPairs = 0;
  const reasons = {};
  for (const sample of samples) for (const row of sample.observations || []) {
    targetVehicles++;
    if (row.candidateValid) candidateValid++;
    if (row.statusKnown) statusPresent++;
    if (row.publicationBlock && !['current_status_missing', 'poc_not_calibrated'].includes(row.publicationBlock))
      reasons[row.publicationBlock] = (reasons[row.publicationBlock] || 0) + 1;
    const prior = previous.get(row.tripId);
    if (prior && finite(row.timestamp) && row.timestamp > prior.timestamp) {
      sameTripPairs++;
      if (Number.isInteger(row.rawState.sequence) && Number.isInteger(prior.rawState.sequence)) {
        if (row.rawState.sequence >= prior.rawState.sequence) monotonicPairs++;
        else sequenceRegressions++;
      }
      const moved = distanceMeters(row.gps, prior.gps);
      if (finite(moved) && moved >= 10) gpsMovingPairs++;
    }
    if (!prior || finite(row.timestamp) && row.timestamp >= prior.timestamp) previous.set(row.tripId, row);
  }
  return { samples: samples.length, targetVehicles, candidateValid, statusPresent, sameTripPairs,
    monotonicPairs, sequenceRegressions, gpsMovingPairs, reasons, publicSupported: 0 };
}

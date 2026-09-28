// Aggregates already-derived shadow evidence. It never consumes or publishes raw GPS.
const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || '');
const number = (value) => value === '' || value === null || value === undefined ? null : Number(value);
const unique = (values) => [...new Set(values)];
const fail = () => { throw Error('POSITION_ACCUMULATED_INPUT_INVALID'); };

export function evaluateAccumulatedPosition({ dailyRows, observationRows, positionStatic,
  geometryArtifact, throughDate } = {}) {
  if (!Array.isArray(dailyRows) || !Array.isArray(observationRows) || !positionStatic?.trips
    || !isDate(throughDate) || geometryArtifact?.approvedForShadow !== true
    || geometryArtifact.approvedForPublic !== false || geometryArtifact.geometryReady !== false
    || typeof geometryArtifact.routeId !== 'string' || typeof geometryArtifact.directionId !== 'string') fail();
  const routeId = geometryArtifact.routeId, directionId = geometryArtifact.directionId;
  const days = dailyRows.filter((row) => isDate(row.service_date) && row.service_date <= throughDate
    && row.route_id === routeId && row.direction_id === directionId);
  const rows = observationRows.filter((row) => isDate(row.service_date) && row.service_date <= throughDate
    && row.route_id === routeId && row.direction === directionId);
  const dailyIds = new Set(), rowIds = new Set();
  for (const row of days) {
    if (!row.daily_id || dailyIds.has(row.daily_id)) fail();
    dailyIds.add(row.daily_id);
  }
  for (const row of rows) {
    if (!row.evaluation_id || rowIds.has(row.evaluation_id)) fail();
    rowIds.add(row.evaluation_id);
  }
  const sourceDays = unique(days.map((row) => row.service_date)).sort();
  const detailsDays = unique(rows.map((row) => row.service_date)).sort();
  const expectedIntervals = number(days.at(-1)?.expected_interval_count);
  if (expectedIntervals === null || !Number.isSafeInteger(expectedIntervals) || expectedIntervals < 1
    || days.some((row) => number(row.expected_interval_count) !== expectedIntervals)
    || JSON.stringify(sourceDays) !== JSON.stringify(detailsDays)) fail();
  const intervalSet = new Set(), tripDays = new Set(), patterns = new Map();
  let mismatch = 0, reverse = 0, unknownDirection = 0, severe = 0, ambiguous = 0;
  for (const row of rows) {
    const chainId = positionStatic.trips[row.trip_id]?.chainId || 'unmapped';
    const pattern = patterns.get(chainId) || { chainId, tripDays: new Set(), rows: 0,
      mismatch: 0, reverse: 0, unknownDirection: 0, intervals: new Set() };
    pattern.rows++; pattern.tripDays.add(`${row.service_date}:${row.trip_id}`);
    tripDays.add(`${row.service_date}:${row.trip_id}`);
    if (row.ambiguity_reason === 'trip_geometry_mismatch') { mismatch++; pattern.mismatch++; }
    if (row.inferred_direction === 'reverse' || ['reverse', 'jump'].includes(row.monotonicity_status)) {
      reverse++; pattern.reverse++;
    } else if (row.inferred_direction !== 'forward') { unknownDirection++; pattern.unknownDirection++; }
    if (row.severe_contradiction_flag === true || row.severe_contradiction_flag === 'TRUE') severe++;
    if (row.ambiguity_reason) ambiguous++;
    const interval = number(row.stop_interval_index);
    if (interval !== null && Number.isSafeInteger(interval) && interval >= 0 && interval < expectedIntervals) {
      intervalSet.add(interval); pattern.intervals.add(interval);
    }
    patterns.set(chainId, pattern);
  }
  const missingIntervals = Array.from({ length: expectedIntervals }, (_, index) => index)
    .filter((index) => !intervalSet.has(index));
  const reasonCodes = [];
  if (sourceDays.length < 3) reasonCodes.push('MULTI_DAY_COVERAGE_INSUFFICIENT');
  if (tripDays.size < 20) reasonCodes.push('INDEPENDENT_TRIPS_INSUFFICIENT');
  if (missingIntervals.length) reasonCodes.push('STOP_INTERVAL_COVERAGE_INSUFFICIENT');
  if (mismatch) reasonCodes.push('TRIP_GEOMETRY_MISMATCH');
  if (reverse) reasonCodes.push('DIRECTION_CONTRADICTION_PRESENT');
  if (severe) reasonCodes.push('SEVERE_STOPS_AWAY_CONTRADICTION');
  if (days.some((row) => row.decision === 'NO_GO' || row.header_match === false
    || row.header_match === 'FALSE')) reasonCodes.push('DAILY_INTEGRITY_FAILURE');
  reasonCodes.push('OFFICIAL_REFERENCE_NOT_AUTOMATED', 'PUBLIC_GATE_POLICY_UNCALIBRATED');
  return Object.freeze({ provider: geometryArtifact.provider, routeId, directionId, throughDate,
    stage: 'stage_1_shadow', decision: 'HOLD', geometryReadyCandidate: false,
    approvedForShadow: true, approvedForPublic: false,
    serviceDays: sourceDays.length, observationRows: rows.length, independentTripDays: tripDays.size,
    expectedIntervals, observedIntervals: intervalSet.size, missingIntervals,
    mismatch, reverse, unknownDirection, severe, ambiguous,
    patterns: [...patterns.values()].map((pattern) => ({ chainId: pattern.chainId,
      tripDays: pattern.tripDays.size, rows: pattern.rows, intervals: pattern.intervals.size,
      mismatch: pattern.mismatch, reverse: pattern.reverse, unknownDirection: pattern.unknownDirection })),
    reasonCodes: unique(reasonCodes).sort() });
}

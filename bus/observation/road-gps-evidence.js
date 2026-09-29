import { createHash } from 'node:crypto';
import { OBSERVATION_HEADERS, RAW_SHEET } from './schema.js';

const POSITION_KINDS = new Set(['position', 'departure_position']);
const VEHICLE_HASH = /^veh_[a-f0-9]{32}$/;
const column = (name) => String.fromCharCode(64 + OBSERVATION_HEADERS.indexOf(name) + 1);

export function indexCandidatePositionRows({ headers, kindValues, routeTripDateValues, tripIndex } = {}) {
  if (JSON.stringify(headers) !== JSON.stringify(OBSERVATION_HEADERS)
    || !Array.isArray(kindValues) || !Array.isArray(routeTripDateValues) || !(tripIndex instanceof Map))
    throw Error('ROAD_GPS_RAW_SCHEMA_INVALID');
  const count = Math.max(kindValues.length, routeTripDateValues.length), rows = [];
  for (let index = 1; index < count; index++) {
    const kind = String(kindValues[index]?.[0] ?? '');
    const [routeId, tripId, serviceDate] = routeTripDateValues[index] || [];
    if (!POSITION_KINDS.has(kind) || typeof tripId !== 'string') continue;
    const target = tripIndex.get(tripId);
    if (!target || String(routeId ?? '') !== target.routeId) continue;
    rows.push(Object.freeze({ sheetRow: index + 1, routeId: String(routeId), tripId,
      serviceDate: String(serviceDate ?? ''), chainId: target.chainId }));
  }
  return Object.freeze(rows);
}

export function positionTripIndex(positionStatic, candidateChainIds) {
  if (!positionStatic?.trips || !Array.isArray(candidateChainIds)) throw Error('ROAD_GPS_STATIC_INVALID');
  const chains = new Set(candidateChainIds), index = new Map();
  for (const [tripId, trip] of Object.entries(positionStatic.trips)) {
    if (chains.has(trip?.chainId) && typeof trip?.routeId === 'string')
      index.set(tripId, Object.freeze({ chainId: trip.chainId, routeId: trip.routeId }));
  }
  return index;
}

export function buildCandidateRowRanges(rows, sheetName = RAW_SHEET) {
  if (!Array.isArray(rows) || rows.some((row) => !Number.isInteger(row?.sheetRow) || row.sheetRow < 2))
    throw Error('ROAD_GPS_ROW_INDEX_INVALID');
  const ordered = [...rows].sort((a, b) => a.sheetRow - b.sheetRow), runs = [];
  for (const row of ordered) {
    const run = runs.at(-1);
    if (run && row.sheetRow === run.end + 1) { run.end = row.sheetRow; run.rows.push(row); }
    else runs.push({ start: row.sheetRow, end: row.sheetRow, rows: [row] });
  }
  const quoted = `'${sheetName.replaceAll("'", "''")}'`;
  return Object.freeze(runs.map((run) => Object.freeze({ ...run, ranges: Object.freeze([
    `${quoted}!${column('observed_at')}${run.start}:${column('observed_at')}${run.end}`,
    `${quoted}!${column('gps_age_sec')}${run.start}:${column('gps_age_sec')}${run.end}`,
    `${quoted}!${column('vehicle_hash')}${run.start}:${column('position_lon')}${run.end}`
  ]) })));
}

const cell = (valueRange, offset, columnOffset = 0) => valueRange?.values?.[offset]?.[columnOffset] ?? '';
const safeNumber = (value) => value === '' || value === null || value === undefined ? NaN : Number(value);

export function mapCandidateGpsSamples({ rows, runs, valueRanges } = {}) {
  if (!Array.isArray(rows) || !Array.isArray(runs) || !Array.isArray(valueRanges))
    throw Error('ROAD_GPS_RESPONSE_INVALID');
  const samples = [];
  let rangeIndex = 0;
  for (const run of runs) {
    const [observedValues, ageValues, identityPositionValues] = valueRanges.slice(rangeIndex, rangeIndex + 3);
    rangeIndex += 3;
    if (!observedValues || !ageValues || !identityPositionValues) throw Error('ROAD_GPS_RESPONSE_INVALID');
    for (const row of run.rows) {
      const offset = row.sheetRow - run.start, observedAt = cell(observedValues, offset);
      const gpsAge = safeNumber(cell(ageValues, offset));
      const vehicleHash = String(cell(identityPositionValues, offset, 0));
      const timestamp = safeNumber(cell(identityPositionValues, offset, 1));
      const lat = safeNumber(cell(identityPositionValues, offset, 2));
      const lon = safeNumber(cell(identityPositionValues, offset, 3));
      const receivedAt = Date.parse(String(observedAt)) / 1000;
      const identity = VEHICLE_HASH.test(vehicleHash) ? vehicleHash : 'identity-missing';
      const tripKey = createHash('sha256').update(`${row.serviceDate}\u001f${row.tripId}\u001f${identity}`).digest('hex');
      samples.push({ tripKey, serviceDay: row.serviceDate, timestamp, receivedAt, lat, lon,
        gpsAgeSec: gpsAge, identityValid: VEHICLE_HASH.test(vehicleHash), chainId: row.chainId, routeId: row.routeId });
    }
  }
  if (rangeIndex !== valueRanges.length) throw Error('ROAD_GPS_RESPONSE_INVALID');
  return samples;
}

export function safeRoadValidationSummary({ chainId, routeId, relationId, relationVersion, validation, sampleCount, gaps } = {}) {
  const evidence = validation?.evidence || {}, gps = evidence.gps || {}, stops = evidence.stops || {};
  return Object.freeze({ chainId, routeId, relationId, relationVersion, sampleCount,
    gaps: gaps ?? null, pointCount: Array.isArray(validation?.points) ? validation.points.length : null,
    stopCount: stops.total ?? null, projectedStops: stops.projected ?? null,
    stopMaxDistanceMeters: stops.maxDistanceMeters ?? null,
    gps: Object.freeze({ evaluated: gps.evaluated ?? 0, matched: gps.matched ?? 0,
      matchRate: gps.matchRate ?? null, p95DistanceMeters: gps.p95DistanceMeters ?? null,
      maxDistanceMeters: gps.maxDistanceMeters ?? null, serviceDayCount: gps.serviceDays?.length ?? 0,
      independentTrips: gps.independentTrips ?? 0, monotonicTrips: gps.monotonicTrips ?? 0,
      segmentCount: gps.segments?.length ?? 0,
      coveredSegments: gps.segments?.filter((segment) => segment.independentTrips > 0).length ?? 0 }),
    officialRoad: Object.freeze({ lineCount: evidence.officialRoad?.lines ?? 0,
      matchRate: evidence.officialRoad?.matchRate ?? null,
      p95DistanceMeters: evidence.officialRoad?.p95DistanceMeters ?? null }),
    eligible: validation?.eligible === true, geometryReady: validation?.geometryReady === true,
    reasons: Object.freeze([...(validation?.reasons || [])]) });
}

export const roadGpsSheetFields = Object.freeze({ sheet: RAW_SHEET,
  headerRange: `'${RAW_SHEET}'!A1:AH1`, kindRange: `'${RAW_SHEET}'!D:D`, tripIndexRange: `'${RAW_SHEET}'!H:J` });

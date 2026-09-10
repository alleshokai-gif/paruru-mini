import { createHash } from 'node:crypto';
import { FAVORITES } from '../config/settings.js';
import { clockSeconds } from '../core/time.js';
const fail = (code) => { throw Error(code); };
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
export const configHash = () => sha256(JSON.stringify(FAVORITES));
export const validDate = (s) => typeof s === 'string' && /^\d{8}$/.test(s)
  && new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}T00:00:00Z`).toISOString().slice(0, 10).replaceAll('-', '') === s;
export function validateP0Static(index) {
  if (index?.schemaVersion !== 1 || !Number.isFinite(index.fetchedAt)) fail('STATIC_SCHEMA');
  if (!validDate(index.feedInfo?.feed_start_date) || !validDate(index.feedInfo?.feed_end_date)
    || index.feedInfo.feed_start_date > index.feedInfo.feed_end_date || !index.feedInfo.feed_version) fail('STATIC_FEED_DATES');
  const serviceIds = new Set();
  const exceptionKeys = new Set();
  for (const row of index.calendar) {
    if (!row.service_id || serviceIds.has(row.service_id) || !validDate(row.start_date) || !validDate(row.end_date)
      || row.start_date > row.end_date || ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].some((d) => !['0','1'].includes(row[d]))) fail('STATIC_CALENDAR');
    serviceIds.add(row.service_id);
  }
  for (const row of index.calendarDates) {
    const key = `${row.service_id}|${row.date}`;
    if (!row.service_id || !validDate(row.date) || !['1','2'].includes(row.exception_type) || exceptionKeys.has(key)) fail('STATIC_CALENDAR_EXCEPTION');
    serviceIds.add(row.service_id); exceptionKeys.add(key);
  }
  if (Object.keys(index.directions).sort().join() !== FAVORITES.map((f) => f.id).sort().join()) fail('STATIC_DIRECTIONS');
  for (const f of FAVORITES) {
    for (const id of [...f.fromStopIds, ...f.toStopIds]) if (index.stops?.[id]?.stopId !== id || !index.stops[id].name) fail('STATIC_STOP_CONFIG');
    for (const id of f.routeIds) if (index.routes?.[id]?.routeId !== id || !index.routes[id].label) fail('STATIC_ROUTE_CONFIG');
    const rows = index.directions[f.id]; if (!Array.isArray(rows) || !rows.length) fail('STATIC_DIRECTION_EMPTY');
    const trips = new Set();
    for (const row of rows) {
      if (!row.tripId || trips.has(row.tripId) || !serviceIds.has(row.serviceId)) fail('STATIC_TRIP_SERVICE');
      trips.add(row.tripId);
      if (!f.fromStopIds.includes(row.fromStopId) || !f.toStopIds.includes(row.toStopId) || !f.routeIds.includes(row.routeId)
        || row.routeLabel !== index.routes[row.routeId].label) fail('STATIC_ROW_REFERENCE');
      if (!Number.isInteger(row.stopSequence) || row.stopSequence < 0 || !Number.isInteger(row.alightSequence) || row.alightSequence <= row.stopSequence) fail('STATIC_SEQUENCE');
      if (!Number.isInteger(row.scheduledSeconds) || row.scheduledSeconds < 0 || clockSeconds(row.startTime) === null
        || clockSeconds(row.startTime) > row.scheduledSeconds) fail('STATIC_SCHEDULE_MISSING');
      if (![null, '0', '1'].includes(row.directionId)) fail('STATIC_DIRECTION_ID');
    }
  }
  return index;
}
export function validateArtifact(index, sourceDate) {
  validateP0Static(index);
  if (index.artifactVersion !== 1 || index.sourceDate !== sourceDate || index.configHash !== configHash()
    || JSON.stringify(index.directionConfig) !== JSON.stringify(FAVORITES) || !/^[a-f0-9]{64}$/.test(index.sourceHash || '')
    || index.sourceVersion !== index.feedInfo.feed_version || !Number.isFinite(Date.parse(index.generatedAt))) fail('STATIC_ARTIFACT_METADATA');
  return index;
}

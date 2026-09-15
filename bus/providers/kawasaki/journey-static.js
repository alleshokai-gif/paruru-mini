import { sha256, validDate } from '../../runtime/static-artifact.js';
import { resolveQuerySet } from '../../core/queries.js';
import { KAWASAKI_CONTEXT } from './context.js';
import { KAWASAKI_JOURNEY_QUERIES } from './journey-config.js';

const fail = (code) => { throw new Error(code); };
const queryHash = () => sha256(JSON.stringify(KAWASAKI_JOURNEY_QUERIES));

export function validateKawasakiJourneyArtifact(index, expectedSourceDate = null) {
  if (index?.artifactVersion !== 1 || index.schemaVersion !== 1 || !Number.isFinite(index.fetchedAt)
    || !validDate(index.sourceDate) || expectedSourceDate && index.sourceDate !== expectedSourceDate
    || index.sourceVersion !== index.feedInfo?.feed_version || !/^[a-f0-9]{64}$/.test(index.sourceHash || '')
    || index.queryHash !== queryHash() || !Number.isFinite(Date.parse(index.generatedAt || '')))
    fail('BUS_KAWASAKI_JOURNEY_ARTIFACT_INVALID');
  const resolved = resolveQuerySet(index, KAWASAKI_JOURNEY_QUERIES, KAWASAKI_CONTEXT);
  if (resolved.length !== KAWASAKI_JOURNEY_QUERIES.length) fail('BUS_KAWASAKI_JOURNEY_ARTIFACT_INVALID');
  const rows = index.directions?.mukougaoka_to_kibukihoncho;
  if (!Array.isArray(rows) || !rows.length || rows.some((row) => row.routeId !== '10037'
    || row.routeLabel !== '溝１９' || row.directionId !== '0' || row.fromStopId !== '474_5'
    || row.toStopId !== '184_1' || row.stopSequence >= row.alightSequence
    || row.platform !== '5番' || row.headsign !== '溝口駅南口(おし沼)'))
    fail('BUS_KAWASAKI_JOURNEY_ROUTE_INVALID');
  const westbound = index.directions?.kibukihoncho_to_miyamae_washigamine;
  const expectedRoutes = ['10032', '10033', '10034', '10035', '10036', '10044', '10045'];
  if (!Array.isArray(westbound) || !westbound.length || westbound.some((row) => !expectedRoutes.includes(row.routeId)
    || row.directionId !== '1' || row.fromStopId !== '184_3' || row.toStopId !== '469_2'
    || row.stopSequence >= row.alightSequence || row.platform !== '3番'
    || typeof row.headsign !== 'string' || !row.headsign.trim())
    || JSON.stringify([...new Set(westbound.map((row) => row.routeId))].sort()) !== JSON.stringify(expectedRoutes))
    fail('BUS_KAWASAKI_JOURNEY_ROUTE_INVALID');
  const serviceIds = new Set([...(index.calendar || []), ...(index.calendarDates || [])].map((row) => row.service_id));
  if ([...rows, ...westbound].some((row) => !serviceIds.has(row.serviceId))) fail('BUS_KAWASAKI_JOURNEY_SERVICE_INVALID');
  return index;
}

function mergeNamed(primary, extension, key) {
  const result = { ...(primary[key] || {}) };
  for (const [id, value] of Object.entries(extension[key] || {})) {
    if (result[id] && JSON.stringify(result[id]) !== JSON.stringify(value)) fail('BUS_KAWASAKI_JOURNEY_MERGE_CONFLICT');
    result[id] = value;
  }
  return result;
}

function mergeRows(primary, extension, keyOf) {
  const result = [...(primary || [])], seen = new Map(result.map((row) => [keyOf(row), JSON.stringify(row)]));
  for (const row of extension || []) {
    const key = keyOf(row), encoded = JSON.stringify(row);
    if (seen.has(key) && seen.get(key) !== encoded) fail('BUS_KAWASAKI_JOURNEY_MERGE_CONFLICT');
    if (!seen.has(key)) { seen.set(key, encoded); result.push(row); }
  }
  return result;
}

export function mergeKawasakiStatic(primary, extension) {
  if (primary?.sourceHash !== extension?.sourceHash || primary?.sourceVersion !== extension?.sourceVersion
    || JSON.stringify(primary?.feedInfo) !== JSON.stringify(extension?.feedInfo))
    fail('BUS_KAWASAKI_JOURNEY_SOURCE_MISMATCH');
  return {
    ...primary,
    directions: { ...primary.directions, ...extension.directions },
    stops: mergeNamed(primary, extension, 'stops'),
    routes: mergeNamed(primary, extension, 'routes'),
    calendar: mergeRows(primary.calendar, extension.calendar, (row) => row.service_id),
    calendarDates: mergeRows(primary.calendarDates, extension.calendarDates, (row) => `${row.service_id}|${row.date}`)
  };
}

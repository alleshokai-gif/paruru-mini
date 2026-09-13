import {
  API_ROOT, CALENDARS, KIBUKIHONCHO_TO_KAJIGAYA, PROVIDER_ID, STATIC_CACHE_SEC,
  STATIC_MAX_BYTES, STATIC_REQUEST_TIMEOUT_MS, STATIC_SCHEMA_VERSION, TOKYU_HUB_DIRECTIONS
} from './config.js';
import { ATTRIBUTION } from './attribution.js';
import { resolveTokyuServiceCalendar } from './calendar.js';

const DAY = 86400;
const JST = 9 * 3600;
const text = (value) => typeof value === 'string' && value.length > 0;
const fail = (code) => { throw new Error(code); };

function exactArray(value, expected) {
  return Array.isArray(value) && value.length === 1 && value[0] === expected;
}

async function readBoundedJson(response) {
  if (!response.ok) fail('BUS_TOKYU_UPSTREAM_HTTP');
  if (Number(response.headers.get('content-length')) > STATIC_MAX_BYTES) fail('BUS_TOKYU_UPSTREAM_SIZE');
  if (!response.body?.getReader) fail('BUS_TOKYU_UPSTREAM_BODY');
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > STATIC_MAX_BYTES) { await reader.cancel(); fail('BUS_TOKYU_UPSTREAM_SIZE'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!Array.isArray(value)) fail('BUS_TOKYU_STATIC_INVALID');
    return value;
  } catch (error) {
    if (/^BUS_TOKYU_/.test(error?.message || '')) throw error;
    fail('BUS_TOKYU_STATIC_INVALID');
  }
}

export async function fetchOdptStatic(type, parameters, token, fetcher = fetch) {
  if (!text(token) || /\s/.test(token)) fail('BUS_SECRET_MISSING');
  const url = new URL(`${API_ROOT}${type}`);
  url.searchParams.set('acl:consumerKey', token);
  for (const [name, value] of Object.entries(parameters)) url.searchParams.set(name, value);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STATIC_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(url.href, { redirect: 'manual', signal: controller.signal });
    return await readBoundedJson(response);
  } catch (error) {
    // Fetch errors can contain the authenticated URL. Only controlled codes cross this boundary.
    if (/^BUS_(?:TOKYU_|SECRET_)[A-Z_]+$/.test(error?.message || '')) throw error;
    fail('BUS_TOKYU_UPSTREAM_FETCH');
  } finally { clearTimeout(timer); }
}

function parseClock(value) {
  const match = /^(\d{2}):([0-5]\d)$/.exec(value || '');
  if (!match) fail('BUS_TOKYU_TIMETABLE_INVALID');
  const hour = Number(match[1]);
  if (hour > 23) fail('BUS_TOKYU_TIMETABLE_INVALID');
  return hour * 3600 + Number(match[2]) * 60;
}

function sourceTimestamp(rows) {
  const values = rows.map((row) => Date.parse(row?.['dc:date']) / 1000).filter(Number.isFinite);
  if (!values.length) fail('BUS_TOKYU_STATIC_INVALID');
  return Math.max(...values);
}

export function normalizeTokyuStatic({ query = KIBUKIHONCHO_TO_KAJIGAYA, stops, patterns, timetables, fetchedAt }) {
  const q = query;
  if (!Number.isFinite(fetchedAt) || stops.length !== 1 || patterns.length !== 1 || timetables.length !== 3)
    fail('BUS_TOKYU_STATIC_INVALID');
  const stop = stops[0], pattern = patterns[0];
  if (stop?.['owl:sameAs'] !== q.fromStopId || !exactArray(stop?.['odpt:operator'], q.operatorId)
    || stop?.['dc:title'] !== q.fromStopName || stop?.['odpt:busstopPoleNumber'] !== q.platform
    || pattern?.['owl:sameAs'] !== q.routePatternId || pattern?.['odpt:operator'] !== q.operatorId
    || pattern?.['odpt:busroute'] !== q.routeId || pattern?.['dc:title'] !== q.routeLabel)
    fail('BUS_TOKYU_STATIC_INVALID');
  const order = pattern['odpt:busstopPoleOrder'];
  if (!Array.isArray(order) || order.find((row) => row?.['odpt:index'] === q.fromStopIndex)?.['odpt:busstopPole'] !== q.fromStopId
    || order.at(-1)?.['odpt:busstopPole'] !== q.destinationStopId) fail('BUS_TOKYU_ROUTE_INVALID');

  const expectedCalendars = new Set(Object.values(CALENDARS)), calendars = {};
  for (const timetable of timetables) {
    const calendar = timetable?.['odpt:calendar'];
    if (!expectedCalendars.delete(calendar) || timetable?.['odpt:operator'] !== q.operatorId
      || !exactArray(timetable?.['odpt:busroute'], q.routeId) || timetable?.['odpt:busstopPole'] !== q.fromStopId
      || !exactArray(timetable?.['odpt:busDirection'], q.directionId)) fail('BUS_TOKYU_TIMETABLE_INVALID');
    const values = timetable['odpt:busstopPoleTimetableObject'];
    if (!Array.isArray(values) || !values.length) fail('BUS_TOKYU_TIMETABLE_INVALID');
    calendars[calendar] = values.map((entry) => {
      if (entry?.['odpt:busroutePattern'] !== q.routePatternId
        || entry?.['odpt:destinationBusstopPole'] !== q.destinationStopId
        || entry?.['odpt:isMidnight'] !== false) fail('BUS_TOKYU_TIMETABLE_INVALID');
      return parseClock(entry['odpt:departureTime']);
    });
    if (calendars[calendar].some((value, index, all) => index && value <= all[index - 1]))
      fail('BUS_TOKYU_TIMETABLE_INVALID');
  }
  if (expectedCalendars.size) fail('BUS_TOKYU_TIMETABLE_INVALID');
  return Object.freeze({ schemaVersion: STATIC_SCHEMA_VERSION, provider: PROVIDER_ID, query: q, fetchedAt,
    sourceUpdatedAt: sourceTimestamp([stop, pattern, ...timetables]), calendars: Object.freeze(calendars) });
}

function dayStart(epoch) {
  return Math.floor((epoch + JST) / DAY) * DAY - JST;
}

function serviceDate(start) {
  return new Date((start + JST) * 1000).toISOString().slice(0, 10).replaceAll('-', '');
}

export function buildTokyuArrivals(staticData, now, limit = 3, calendarResolver = resolveTokyuServiceCalendar) {
  if (staticData?.schemaVersion !== STATIC_SCHEMA_VERSION || !Number.isFinite(now)
    || !Number.isInteger(limit) || limit < 1 || limit > 10) fail('BUS_TOKYU_BUILD_INVALID');
  const q = staticData.query, values = [];
  if (!q || !TOKYU_HUB_DIRECTIONS.includes(q) || typeof calendarResolver !== 'function') fail('BUS_TOKYU_BUILD_INVALID');
  const firstDay = dayStart(now);
  for (let offset = 0; offset < 3 && values.length < limit; offset++) {
    const start = firstDay + offset * DAY, resolved = calendarResolver(start);
    if (!resolved) continue;
    const departures = staticData.calendars[resolved.calendar];
    if (!Array.isArray(departures)) fail('BUS_TOKYU_TIMETABLE_INVALID');
    for (const seconds of departures) {
      const scheduledDeparture = start + seconds;
      if (scheduledDeparture < now) continue;
      values.push({
        id: `${PROVIDER_ID}:${serviceDate(start)}:${seconds}:${q.routePatternId}`,
        sourceId: q.sourceId, provider: PROVIDER_ID, routeId: q.routeId, routeLabel: q.routeLabel,
        destination: q.destinationName,
        originStop: { id: q.fromStopId, name: q.fromStopName },
        targetStop: { id: q.fromStopId, name: q.fromStopName },
        scheduledDeparture, estimatedDeparture: null, effectiveDeparture: null,
        etaMinutes: null, delayMinutes: null, platform: q.platform,
        realtimeState: 'static_only', departureState: 'scheduled', actionability: null, confidence: null,
        position: { supported: false, state: null, stopsAway: null, previousStop: null, nextStop: null, confidence: null }
      });
      if (values.length === limit) break;
    }
  }
  return values;
}

export function createTokyuStaticProvider({ token, fetcher = fetch, now = () => Date.now() / 1000,
  cacheSeconds = STATIC_CACHE_SEC, calendarResolver = resolveTokyuServiceCalendar } = {}) {
  if (!text(token) || /\s/.test(token) || !Number.isFinite(cacheSeconds) || cacheSeconds < 0)
    fail('BUS_TOKYU_PROVIDER_INVALID');
  let cached = null, pending = null;
  async function load() {
    const age = cached ? now() - cached.fetchedAt : Infinity;
    if (cached && age >= 0 && age < cacheSeconds) return cached;
    if (pending) return pending;
    pending = (async () => {
      const fetchedAt = now();
      const directions = await Promise.all(TOKYU_HUB_DIRECTIONS.map(async (q) => {
        const [stops, patterns, timetables] = await Promise.all([
          fetchOdptStatic('odpt:BusstopPole', { 'owl:sameAs': q.fromStopId }, token, fetcher),
          fetchOdptStatic('odpt:BusroutePattern', { 'owl:sameAs': q.routePatternId }, token, fetcher),
          fetchOdptStatic('odpt:BusstopPoleTimetable', { 'odpt:operator': q.operatorId,
            'odpt:busstopPole': q.fromStopId }, token, fetcher)
        ]);
        return normalizeTokyuStatic({ query: q, stops, patterns, timetables, fetchedAt });
      }));
      cached = Object.freeze({ fetchedAt, directions: Object.freeze(directions),
        sourceUpdatedAt: Math.max(...directions.map((value) => value.sourceUpdatedAt)) });
      return cached;
    })();
    try { return await pending; } finally { pending = null; }
  }
  return {
    async getArrivals() {
      const data = await load();
      return { provider: PROVIDER_ID, arrivals: data.directions.flatMap((value) =>
        buildTokyuArrivals(value, now(), 3, calendarResolver)),
        retrievedAt: data.fetchedAt, sourceUpdatedAt: data.sourceUpdatedAt, attribution: ATTRIBUTION };
    }
  };
}

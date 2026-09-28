import { CALENDARS, MUKOUGAOKA_TO_KIBUKIHONCHO, PROVIDER_ID } from './config.js';
import { resolveTokyuServiceCalendar } from './calendar.js';
import { fetchOdptStatic } from './static.js';

const DAY = 86400, JST = 9 * 3600;
const fail = () => { throw Error('BUS_TOKYU_JOURNEY_INVALID'); };
const dayStart = (epoch) => Math.floor((epoch + JST) / DAY) * DAY - JST;
const serviceDate = (start) => new Date((start + JST) * 1000).toISOString().slice(0, 10).replaceAll('-', '');
const timetableCalendar = Object.freeze({
  [CALENDARS.weekday]: 'odpt.Calendar:Weekday',
  [CALENDARS.saturday]: 'odpt.Calendar:Saturday',
  // For this exact route pattern, 38 Sunday pole departures equal the 38 Holiday trip departures.
  [CALENDARS.sunday]: 'odpt.Calendar:Holiday'
});

function parseClock(value) {
  const match = /^(\d{2}):([0-5]\d)$/.exec(value || '');
  if (!match || Number(match[1]) > 23) fail();
  return Number(match[1]) * 3600 + Number(match[2]) * 60;
}

export function normalizeTokyuJourneyTimetables(rows, query = MUKOUGAOKA_TO_KIBUKIHONCHO) {
  if (!Array.isArray(rows) || query !== MUKOUGAOKA_TO_KIBUKIHONCHO) fail();
  const calendars = {}, seenTripIds = new Set(), expected = new Set(Object.values(timetableCalendar));
  for (const row of rows) {
    if (row?.['odpt:operator'] !== query.operatorId
      || row['odpt:busroutePattern'] !== query.routePatternId
      || !expected.has(row['odpt:calendar']) || typeof row['owl:sameAs'] !== 'string'
      || !Array.isArray(row['odpt:busTimetableObject'])) fail();
    const tripId = row['owl:sameAs'], objects = row['odpt:busTimetableObject'];
    if (!tripId || seenTripIds.has(tripId)) fail();
    seenTripIds.add(tripId);
    const from = objects.filter((stop) => stop?.['odpt:index'] === query.fromStopIndex),
      to = objects.filter((stop) => stop?.['odpt:index'] === query.targetStopIndex);
    if (from.length !== 1 || to.length !== 1 || from[0]['odpt:busstopPole'] !== query.fromStopId
      || to[0]['odpt:busstopPole'] !== query.targetStopId) fail();
    const departureSeconds = parseClock(from[0]['odpt:departureTime']);
    const arrivalSeconds = parseClock(to[0]['odpt:arrivalTime']);
    if (arrivalSeconds <= departureSeconds) fail();
    (calendars[row['odpt:calendar']] ??= []).push(Object.freeze({
      tripId, departureSeconds, arrivalSeconds
    }));
  }
  for (const calendar of expected) {
    const values = calendars[calendar];
    if (!values?.length) fail();
    values.sort((a, b) => a.departureSeconds - b.departureSeconds);
    if (values.some((value, index) => index && value.departureSeconds === values[index - 1].departureSeconds)) fail();
  }
  return Object.freeze({ provider: PROVIDER_ID, queryId: query.sourceId, routePatternId: query.routePatternId,
    calendars: Object.freeze(calendars) });
}

export async function fetchTokyuJourneyTimetables(token, fetcher = fetch) {
  const query = MUKOUGAOKA_TO_KIBUKIHONCHO;
  const rows = await fetchOdptStatic('odpt:BusTimetable', {
    'odpt:operator': query.operatorId, 'odpt:busroutePattern': query.routePatternId
  }, token, fetcher);
  return normalizeTokyuJourneyTimetables(rows, query);
}

export function getFutureTokyuBuses({ index, now, boardingAt, limit = 12, horizonSec = 6 * 3600,
  calendarResolver = resolveTokyuServiceCalendar } = {}) {
  if (index?.provider !== PROVIDER_ID || index.queryId !== MUKOUGAOKA_TO_KIBUKIHONCHO.sourceId
    || !Number.isFinite(now) || !Number.isFinite(boardingAt) || boardingAt < now
    || boardingAt > now + 2 * DAY || !Number.isSafeInteger(limit) || limit < 1 || limit > 100
    || !Number.isSafeInteger(horizonSec) || horizonSec < 60 || horizonSec > DAY
    || typeof calendarResolver !== 'function') fail();
  const query = MUKOUGAOKA_TO_KIBUKIHONCHO, options = [];
  for (let offset = 0; offset < 3; offset++) {
    const start = dayStart(boardingAt) + offset * DAY, resolved = calendarResolver(start);
    if (!resolved) continue;
    const calendar = timetableCalendar[resolved.calendar], rows = index.calendars[calendar];
    if (!Array.isArray(rows)) fail();
    for (const row of rows) {
      const departureAt = start + row.departureSeconds;
      if (departureAt < boardingAt || departureAt > boardingAt + horizonSec) continue;
      options.push({ provider: PROVIDER_ID, queryId: query.sourceId,
        tripId: `${serviceDate(start)}:${row.tripId}`, routeId: query.routeId,
        routeLabel: query.routeLabel, destination: query.destinationName,
        fromStopId: query.fromStopId, toStopId: query.targetStopId, platform: query.platform,
        scheduledDeparture: departureAt, estimatedDeparture: null, departureAt,
        scheduledArrival: start + row.arrivalSeconds, estimatedArrival: start + row.arrivalSeconds,
        delayMinutes: null, timingQuality: 'static_only', departureState: 'scheduled',
        recommendable: true });
    }
  }
  options.sort((a, b) => a.departureAt - b.departureAt || a.tripId.localeCompare(b.tripId));
  return options.slice(0, limit);
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildTokyuArrivals, createTokyuStaticProvider, normalizeTokyuStatic,
  selectTokyuTimetables } from '../providers/tokyu/static.js';
import { CALENDARS, KIBUKIHONCHO_TO_KAJIGAYA, KIBUKIHONCHO_TO_MUKOUGAOKA,
  MUKOUGAOKA_TO_KIBUKIHONCHO, TOKYU_HUB_DIRECTIONS } from '../providers/tokyu/config.js';
import { HOLIDAY_SOURCE, resolveTokyuServiceCalendar, VERIFIED_HOLIDAY_DATES } from '../providers/tokyu/calendar.js';

const NOW = Date.parse('2026-09-13T07:00:00+09:00') / 1000;
const times = {
  [CALENDARS.weekday]: ['07:00', '07:20', '07:40'],
  [CALENDARS.saturday]: ['07:06', '07:32', '07:58'],
  [CALENDARS.sunday]: ['07:05', '07:31', '07:57']
};

function records(query) {
  const stop = { 'owl:sameAs': query.fromStopId, 'odpt:operator': [query.operatorId], 'dc:title': query.fromStopName,
    'dc:date': '2026-09-01T15:11:05+09:00', 'odpt:busstopPoleNumber': query.platform };
  const stopCount = query.routePatternId === KIBUKIHONCHO_TO_KAJIGAYA.routePatternId ? 18 : 16;
  const sharedKajigayaPattern = query.routePatternId === KIBUKIHONCHO_TO_KAJIGAYA.routePatternId;
  const order = Array.from({ length: stopCount }, (_, index) => ({ 'odpt:index': index + 1,
    'odpt:busstopPole': sharedKajigayaPattern && index + 1 === MUKOUGAOKA_TO_KIBUKIHONCHO.fromStopIndex
      ? MUKOUGAOKA_TO_KIBUKIHONCHO.fromStopId
      : sharedKajigayaPattern && index + 1 === KIBUKIHONCHO_TO_KAJIGAYA.fromStopIndex
        ? KIBUKIHONCHO_TO_KAJIGAYA.fromStopId
        : index + 1 === query.fromStopIndex ? query.fromStopId
          : index + 1 === query.targetStopIndex ? query.targetStopId
            : index + 1 === stopCount ? query.destinationStopId : `synthetic:${query.routePatternId}:${index + 1}` }));
  const pattern = { 'owl:sameAs': query.routePatternId, 'odpt:operator': query.operatorId, 'odpt:busroute': query.routeId,
    'dc:title': query.routeLabel, 'dc:date': '2026-09-01T15:11:05+09:00', 'odpt:busstopPoleOrder': order };
  const timetables = Object.entries(times).map(([calendar, values], index) => ({
    'owl:sameAs': `synthetic:${query.sourceId}:${index}`, 'odpt:operator': query.operatorId,
    'odpt:busroute': [query.routeId], 'odpt:busstopPole': query.fromStopId,
    'odpt:busDirection': [query.directionId], 'odpt:calendar': calendar,
    'dc:date': '2026-09-01T15:11:05+09:00',
    'odpt:busstopPoleTimetableObject': values.map((departureTime) => ({
      'odpt:busroutePattern': query.routePatternId, 'odpt:departureTime': departureTime,
      'odpt:destinationBusstopPole': query.destinationStopId, 'odpt:isMidnight': false
    }))
  }));
  return { stops: [stop], patterns: [pattern], timetables };
}

function staticFor(query) {
  return normalizeTokyuStatic({ query, ...records(query), fetchedAt: NOW });
}

test('Tokyu exact ODPT records normalize both platform directions to schedule-only arrivals', () => {
  for (const query of TOKYU_HUB_DIRECTIONS) {
    const arrivals = buildTokyuArrivals(staticFor(query), NOW);
    assert.deepEqual(arrivals.map((row) => row.scheduledDeparture), times[CALENDARS.sunday]
      .map((value) => Date.parse(`2026-09-13T${value}:00+09:00`) / 1000));
    for (const row of arrivals) {
      assert.equal(row.sourceId, query.sourceId); assert.equal(row.provider, 'tokyu');
      assert.equal(row.routeId, query.routeId); assert.equal(row.routeLabel, '向０１');
      assert.equal(row.platform, query.platform); assert.equal(row.destination, query.destinationName);
      assert.equal(row.targetStop.id, query.targetStopId || query.fromStopId);
      assert.equal(row.realtimeState, 'static_only'); assert.equal(row.estimatedDeparture, null);
      assert.equal(row.etaMinutes, null); assert.equal(row.delayMinutes, null); assert.equal(row.position.supported, false);
    }
  }
});

test('Tokyu calendar resolves weekday, Saturday, Sunday and a Cabinet Office holiday explicitly', () => {
  const cases = [
    ['2026-09-14T06:00:00+09:00', CALENDARS.weekday, 'weekday'],
    ['2026-09-19T06:00:00+09:00', CALENDARS.saturday, 'saturday'],
    ['2026-09-20T06:00:00+09:00', CALENDARS.sunday, 'sunday'],
    ['2026-09-21T06:00:00+09:00', CALENDARS.sunday, 'holiday']
  ];
  for (const [iso, calendar, serviceDayType] of cases) {
    const epoch = Date.parse(iso) / 1000;
    assert.deepEqual(resolveTokyuServiceCalendar(epoch), { calendar, serviceDayType, date: iso.slice(0, 10) });
    for (const query of TOKYU_HUB_DIRECTIONS) {
      const rows = buildTokyuArrivals(staticFor(query), epoch);
      assert.deepEqual(rows.map((row) => row.scheduledDeparture), times[calendar]
        .map((value) => Date.parse(`${iso.slice(0, 10)}T${value}:00+09:00`) / 1000));
    }
  }
  assert.ok(VERIFIED_HOLIDAY_DATES.includes('2026-09-21'));
  assert.equal(HOLIDAY_SOURCE.coveredThrough, '2027-12-31');
  assert.equal(resolveTokyuServiceCalendar(Date.parse('2028-01-03T06:00:00+09:00') / 1000), null);
});

test('Tokyu Provider deduplicates eight exact static requests, caches them, and never creates Mizonokuchi', async () => {
  const fixtures = new Map(TOKYU_HUB_DIRECTIONS.map((query) => [query.sourceId, records(query)]));
  let calls = 0;
  const fetcher = async (input) => {
    calls++;
    const url = new URL(input);
    assert.equal(url.searchParams.get('acl:consumerKey'), 'synthetic-token');
    let fixture, value;
    if (url.pathname.endsWith('/odpt:BusstopPole')) {
      const id = url.searchParams.get('owl:sameAs');
      const query = TOKYU_HUB_DIRECTIONS.find((row) => row.fromStopId === id); fixture = fixtures.get(query?.sourceId);
      value = fixture?.stops;
    } else if (url.pathname.endsWith('/odpt:BusroutePattern')) {
      const id = url.searchParams.get('owl:sameAs');
      const query = TOKYU_HUB_DIRECTIONS.find((row) => row.routePatternId === id); fixture = fixtures.get(query?.sourceId);
      value = fixture?.patterns;
    } else {
      assert.ok(url.pathname.endsWith('/odpt:BusstopPoleTimetable'));
      assert.equal(url.searchParams.get('odpt:operator'), 'odpt.Operator:TokyuBus');
      const id = url.searchParams.get('odpt:busstopPole');
      const query = TOKYU_HUB_DIRECTIONS.find((row) => row.fromStopId === id); fixture = fixtures.get(query?.sourceId);
      value = fixture?.timetables;
    }
    assert.ok(value); return new Response(JSON.stringify(value));
  };
  const provider = createTokyuStaticProvider({ token: 'synthetic-token', fetcher, now: () => NOW });
  const [first, second] = await Promise.all([provider.getArrivals(), provider.getArrivals()]);
  assert.equal(calls, 8); assert.equal(first.arrivals.length, 9); assert.deepEqual(first, second);
  assert.equal(first.retrievedAt, NOW); assert.ok(Number.isFinite(first.sourceUpdatedAt));
  assert.deepEqual([...new Set(first.arrivals.map((row) => row.platform))].sort(), ['6', 'a', 'b']);
  const fromYuen = first.arrivals.filter((row) => row.sourceId === MUKOUGAOKA_TO_KIBUKIHONCHO.sourceId);
  assert.equal(fromYuen.length, 3); assert.ok(fromYuen.every((row) => row.targetStop.name === '神木本町'));
  assert.doesNotMatch(JSON.stringify(first), /Mizonokuchi|溝の口|realtime[^S]/i);
  await provider.getArrivals(); assert.equal(calls, 8);
});

test('Tokyu timetable selection removes unrelated platform services before strict normalization', () => {
  const query = MUKOUGAOKA_TO_KIBUKIHONCHO;
  const source = records(query).timetables;
  const unrelated = { ...structuredClone(source[0]), 'owl:sameAs': 'synthetic:unrelated',
    'odpt:busroute': ['odpt.Busroute:TokyuBus.Unrelated'] };
  assert.deepEqual(selectTokyuTimetables([...source, unrelated], query), source);
  assert.throws(() => selectTokyuTimetables(source.slice(0, 2), query), /BUS_TOKYU_TIMETABLE_INVALID/);
});

test('Tokyu Provider rejects direction-specific route, stop, timetable, and oversized response contradictions', async () => {
  const invalid = records(KIBUKIHONCHO_TO_MUKOUGAOKA); invalid.patterns[0]['odpt:busroute'] = 'synthetic:wrong';
  assert.throws(() => normalizeTokyuStatic({ query: KIBUKIHONCHO_TO_MUKOUGAOKA, ...invalid, fetchedAt: NOW }),
    /BUS_TOKYU_STATIC_INVALID/);
  const fixture = records(KIBUKIHONCHO_TO_KAJIGAYA);
  fixture.timetables[0]['odpt:busstopPoleTimetableObject'][0]['odpt:destinationBusstopPole'] = 'synthetic:wrong';
  assert.throws(() => normalizeTokyuStatic({ query: KIBUKIHONCHO_TO_KAJIGAYA, ...fixture, fetchedAt: NOW }),
    /BUS_TOKYU_TIMETABLE_INVALID/);
  const provider = createTokyuStaticProvider({ token: 'synthetic-token', now: () => NOW,
    fetcher: async () => new Response('[]', { headers: { 'content-length': String(2 * 1024 * 1024 + 1) } }) });
  await assert.rejects(provider.getArrivals(), /BUS_TOKYU_UPSTREAM_SIZE/);
});

test('Tokyu runtime source has no realtime, bus-location, scraping, or Mizonokuchi dependency', async () => {
  const source = await Promise.all(['config.js', 'static.js', 'calendar.js', 'attribution.js'].map((name) =>
    readFile(new URL(`../providers/tokyu/${name}`, import.meta.url), 'utf8')));
  const code = source.join('\n');
  assert.doesNotMatch(code, /bus-location|navitime|Mizonokuchi|溝の口|TripUpdates|VehiclePosition|odpt:Bus\b/);
  assert.doesNotMatch(code, /estimatedDeparture:\s*scheduled|etaMinutes:\s*\d|delayMinutes:\s*\d/);
});

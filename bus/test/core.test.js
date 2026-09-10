import test from 'node:test';
import assert from 'node:assert/strict';
import { getArrivals, serviceActive } from '../core/arrivals.js';
import { csvReader } from '../providers/kawasaki/static.js';
import { parseRealtime, fetchRealtime, createKawasakiAdapter } from '../providers/kawasaki/adapter.js';
import { fetchStatic } from '../providers/kawasaki/static-source.js';
import { NOW, indexFixture, realtimeFixture, protoFixture } from './fixtures.js';
const result = (realtime, index = indexFixture(), now = NOW) => getArrivals({ index, realtime, now });
const first = (data) => data.directions[0].arrivals[0];

test('runtime Adapter fetches and decodes RT only', async () => {
  let calls = 0;
  const adapter = createKawasakiAdapter({ token: 'synthetic-only', now: () => NOW, fetcher: async (url) => {
    calls++; assert.equal(new URL(url).pathname, '/api/v4/gtfs/realtime/odpt_TransportationBureau_CityOfKawasaki_AllLines_trip_update');
    return new Response(protoFixture());
  } });
  assert.equal(adapter.getStatic, undefined);
  assert.equal((await adapter.getRealtime()).updates.length, 1); assert.equal(calls, 1);
});

test('static ZIP joins four exact directions and platform evidence', () => {
  const data = result(null); assert.equal(data.directions.length, 4);
  assert.equal(first(data).scheduledTime, '07:54'); assert.equal(first(data).etaMinutes, null);
  assert.equal(first(data).platform, '2番'); assert.equal(data.directions[2].arrivals[0].platform, '登05のりば');
  assert.equal(first(data).headsign, '合成の行先'); assert.equal(data.positionUiEnabled, false);
  assert.deepEqual(first(data).position, { supported: false, status: null, stopsAway: null, previousStop: null, nextStop: null });
});
test('same departure time wins, delay recomputed, mismatch stays visible in metadata', () => {
  const row = first(result(realtimeFixture({ delay: 999 })));
  assert.equal(row.estimatedTime, '07:57'); assert.equal(row.delaySeconds, 180); assert.equal(row.etaMinutes, 7);
  assert.equal(row.delayConsistent, false);
});
test('delay-only and explicit zero differ from missing event', () => {
  assert.equal(first(result(realtimeFixture({ time: null, delay: 0 }))).etaMinutes, 4);
  assert.equal(first(result(realtimeFixture({ time: null, delay: null }))).etaMinutes, null);
  const decoded = parseRealtime(protoFixture(), NOW);
  assert.equal(decoded.updates[0].stops[0].departure.delay, 0);
  assert.equal(decoded.updates[0].stops[0].departure.time, null);
  assert.equal(decoded.updates[0].stops[1].departure.delay, null);
  assert.equal(decoded.vehicles[0].status, 1);
});
test('estimated order replaces scheduled order and keeps delayed past-scheduled trip', () => {
  const index = indexFixture(); const row = index.directions.home_to_noborito[0];
  index.directions.home_to_noborito.push({ ...row, tripId: 'synthetic-second', scheduledSeconds: row.scheduledSeconds + 60 });
  let rows = result(realtimeFixture(), index).directions[0].arrivals;
  assert.equal(rows[0].tripId, '20260910:synthetic-second');
  rows = result(realtimeFixture({ timestamp: NOW + 330 }), index, NOW + 330).directions[0].arrivals;
  assert.equal(rows[0].scheduledTime, '07:54'); assert.equal(rows[0].etaMinutes, 2);
});
test('past ETA excluded, fresh same-trip STOPPED_AT is prediction pending with null ETA', () => {
  const rt = realtimeFixture({ timestamp: NOW + 600 });
  assert(!result(rt, indexFixture(), NOW + 600).directions[0].arrivals.some((r) => r.tripId.startsWith('20260910:')));
  rt.vehicles.push({ trip: rt.updates[0].trip, timestamp: NOW + 600, stopId: '184_2', sequence: 1, status: 1 });
  const row = first(result(rt, indexFixture(), NOW + 600));
  assert.equal(row.state, 'prediction_pending'); assert.equal(row.etaMinutes, null); assert.equal(row.estimatedTime, null);
});
test('feed stale, entity stale, wrong date/route, duplicate update never become live ETA', () => {
  for (const mutate of [
    (r) => { r.timestamp = NOW - 121; },
    (r) => { r.updates[0].timestamp = NOW - 181; },
    (r) => { r.updates[0].trip.startDate = '20260909'; },
    (r) => { r.updates[0].trip.routeId = 'wrong'; },
    (r) => { r.updates.push(structuredClone(r.updates[0])); }
  ]) { const rt = realtimeFixture(); mutate(rt); assert.equal(first(result(rt)).etaMinutes, null); }
});
test('cancelled trip and skipped boarding stop withheld; NO_DATA uses schedule', () => {
  assert.equal(first(result(realtimeFixture({ relationship: 3 }))).tripId, '20260911:synthetic-0');
  const cancelled = realtimeFixture({ relationship: 3 }); cancelled.updates[0].timestamp = null;
  assert.equal(first(result(cancelled)).tripId, '20260911:synthetic-0');
  const rt = realtimeFixture(); rt.updates[0].stops[0].relationship = 1;
  assert.equal(first(result(rt)).tripId, '20260911:synthetic-0');
  rt.updates[0].stops[0].relationship = 2;
  assert.equal(first(result(rt)).state, 'static_fallback');
});
test('expired static feed fails explicitly instead of declaring no upcoming buses', () => {
  const index = indexFixture(); index.feedInfo.feed_end_date = '20260909';
  assert.throws(() => result(null, index), /BUS_STATIC_OUT_OF_RANGE/);
});
test('service exceptions override weekday and duplicate exceptions fail closed', () => {
  const index = indexFixture(); assert(serviceActive(index, 'weekday', NOW));
  index.calendarDates.push({ service_id: 'weekday', date: '20260910', exception_type: '2' });
  assert.equal(serviceActive(index, 'weekday', NOW), false);
  index.calendarDates.push({ service_id: 'weekday', date: '20260910', exception_type: '1' });
  assert.equal(serviceActive(index, 'weekday', NOW), false);
});
test('previous service day 24+ hour schedule joins at midnight', () => {
  const index = indexFixture(); index.directions.home_to_noborito[0].scheduledSeconds = 25 * 3600;
  const row = first(result(null, index, Date.parse('2026-09-11T00:50:00+09:00') / 1000));
  assert.equal(row.scheduledTime, '01:00'); assert.equal(row.tripId, '20260910:synthetic-0');
});
test('CSV quoted comma, escaped quote, multiline and split UTF text', () => {
  const rows = []; const read = csvReader((r) => rows.push(r));
  read('a,"b'); read(',""c""\r\nd"\r'); read('\nx,y', true);
  assert.deepEqual(rows, [['a', 'b,"c"\r\nd'], ['x', 'y']]);
});
test('ODPT redirects are allowlisted; original authentication not forwarded or returned in errors', async () => {
  const requests = []; const secret = ['synthetic', 'credential'].join('-');
  await fetchStatic(secret, '20260828', async (url) => {
    requests.push(url);
    return requests.length === 1 ? new Response(null, { status: 302, headers: { location: 'https://dataodpt.blob.core.windows.net/files-dc-public/odpt/TransportationBureau_CityOfKawasaki/AllLines-20260828.zip?sig=synthetic' } }) : new Response(new Uint8Array([1]));
  });
  assert(!requests[1].includes(secret));
  await assert.rejects(fetchStatic(secret, '20260828', async () => new Response(null, { status: 302, headers: { location: 'https://example.com/' } })), /BUS_REDIRECT_REJECTED/);
  await assert.rejects(fetchRealtime(secret, async () => { throw new Error(secret); }), /^Error: BUS_UPSTREAM_FETCH$/);
});

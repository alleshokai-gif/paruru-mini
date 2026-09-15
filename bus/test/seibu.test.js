import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import bindings from 'gtfs-realtime-bindings';
import { strToU8, zipSync } from 'fflate';
import { aggregateHub } from '../hub/aggregator.js';
import { createHubService } from '../hub/service.js';
import { SHOWA_DAIICHI_GAKUEN_HUB, TACHIKAWA_EKIKITAGUCHI_HUB } from '../hub/config.js';
import { TARGET_ROUTES, STOPS, SCHOOL_TO_TACHIKAWA_SOURCE, TACHIKAWA_TO_SCHOOL_SOURCE } from '../providers/seibu/config.js';
import { buildSeibuPositionResearchIndex, buildSeibuStatic } from '../providers/seibu/static-build.js';
import { buildSeibuArrivals, createSeibuProvider } from '../providers/seibu/provider.js';
import { parseSeibuRealtime } from '../providers/seibu/realtime.js';
import { analyzeSeibuPositionSample, summarizeSeibuPositionObservations } from '../research/seibu-position.js';

const NOW = Date.parse('2026-09-14T07:00:00+09:00') / 1000;
const csv = (headers, rows) => `${headers.join(',')}\r\n${rows.map((row) => headers.map((key) => row[key] ?? '').join(',')).join('\r\n')}\r\n`;

function gtfsFixture() {
  const stopNames = {
    [STOPS.tachikawaPlatform6]: ['立川駅北口', '6'], [STOPS.tachikawaPlatform7Primary]: ['立川駅北口', '7'],
    [STOPS.tachikawaPlatform7Secondary]: ['立川駅北口', '7'], [STOPS.tachikawaPlatform8]: ['立川駅北口', '8'],
    [STOPS.tachikawaPlatform9]: ['立川駅北口', '9'], [STOPS.tachikawaArrival]: ['立川駅北口', ''],
    [STOPS.schoolOutbound]: ['昭和第一学園', ''], [STOPS.schoolInbound]: ['昭和第一学園', ''],
    [STOPS.schoolWestOutbound]: ['昭和第一学園西門', ''], [STOPS.schoolWestInbound]: ['昭和第一学園西門', '']
  };
  const routes = TARGET_ROUTES.map((row) => ({ route_id: row.routeId,
    route_short_name: row.routeLabel === '系統番号なし' ? '' : row.routeLabel,
    route_long_name: `${row.routeLabel} route`, route_type: '3' }));
  const trips = [], stopTimes = [];
  TARGET_ROUTES.forEach((route, index) => {
    const outboundMinute = String(5 + index).padStart(2, '0');
    const inboundMinute = String(20 + index).padStart(2, '0');
    const outboundTrip = `out-${index}`;
    trips.push({ route_id: route.routeId, service_id: 'weekday', trip_id: outboundTrip,
      trip_headsign: `目的地 ${index}`, direction_id: '1' });
    stopTimes.push({ trip_id: outboundTrip, arrival_time: `07:${outboundMinute}:00`, departure_time: `07:${outboundMinute}:00`,
      stop_id: route.outboundFrom, stop_sequence: '1' },
    { trip_id: outboundTrip, arrival_time: `07:${String(12 + index).padStart(2, '0')}:00`, departure_time: `07:${String(12 + index).padStart(2, '0')}:00`,
      stop_id: route.outboundTo, stop_sequence: '7' });
    if (!route.inboundFrom) return;
    const inboundTrip = `in-${index}`;
    trips.push({ route_id: route.routeId, service_id: 'weekday', trip_id: inboundTrip,
      trip_headsign: '立川駅北口', direction_id: '2' });
    stopTimes.push({ trip_id: inboundTrip, arrival_time: `07:${inboundMinute}:00`, departure_time: `07:${inboundMinute}:00`,
      stop_id: route.inboundFrom, stop_sequence: '7' },
    { trip_id: inboundTrip, arrival_time: `07:${String(33 + index).padStart(2, '0')}:00`, departure_time: `07:${String(33 + index).padStart(2, '0')}:00`,
      stop_id: STOPS.tachikawaArrival, stop_sequence: '13' });
  });
  const values = {
    'agency.txt': csv(['agency_id', 'agency_name', 'agency_url', 'agency_timezone'], [{ agency_id: 's', agency_name: '西武バス', agency_url: 'https://example.invalid', agency_timezone: 'Asia/Tokyo' }]),
    'stops.txt': csv(['stop_id', 'stop_name', 'stop_lat', 'stop_lon', 'location_type', 'platform_code'], Object.entries(stopNames).map(([stop_id, [stop_name, platform_code]], index) => ({ stop_id, stop_name, stop_lat: 35.69 + index / 1000, stop_lon: 139.41 + index / 1000, location_type: '0', platform_code }))),
    'routes.txt': csv(['route_id', 'route_short_name', 'route_long_name', 'route_type'], routes),
    'trips.txt': csv(['route_id', 'service_id', 'trip_id', 'trip_headsign', 'direction_id'], trips),
    'stop_times.txt': csv(['trip_id', 'arrival_time', 'departure_time', 'stop_id', 'stop_sequence'], stopTimes),
    'calendar.txt': csv(['service_id', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'start_date', 'end_date'], [{ service_id: 'weekday', monday: '1', tuesday: '1', wednesday: '1', thursday: '1', friday: '1', saturday: '1', sunday: '1', start_date: '20260901', end_date: '20261031' }]),
    'calendar_dates.txt': 'service_id,date,exception_type\r\n',
    'feed_info.txt': csv(['feed_publisher_name', 'feed_publisher_url', 'feed_lang', 'feed_start_date', 'feed_end_date', 'feed_version'], [{ feed_publisher_name: '西武バス', feed_publisher_url: 'https://example.invalid', feed_lang: 'ja', feed_start_date: '20260901', feed_end_date: '20261031', feed_version: 'fixture' }])
  };
  return zipSync(Object.fromEntries(Object.entries(values).map(([name, value]) => [name, strToU8(value)])));
}

function artifactFixture() {
  return buildSeibuStatic(gtfsFixture(), { now: NOW - 3600 });
}

function realtimeFixture() {
  const update = bindings.transit_realtime.FeedMessage.create({ header: { gtfsRealtimeVersion: '2.0', timestamp: NOW }, entity: [{
    id: 'tu', tripUpdate: { trip: { tripId: 'out-0', routeId: TARGET_ROUTES[0].routeId }, timestamp: NOW,
      vehicle: { id: 'private-vehicle' }, stopTimeUpdate: [{ stopSequence: 1, stopId: TARGET_ROUTES[0].outboundFrom,
        departure: { time: NOW + 480, delay: 180 } }] }
  }] });
  const vehicle = bindings.transit_realtime.FeedMessage.create({ header: { gtfsRealtimeVersion: '2.0', timestamp: NOW }, entity: [{
    id: 'vp', vehicle: { trip: { tripId: 'out-0', routeId: TARGET_ROUTES[0].routeId }, timestamp: NOW,
      vehicle: { id: 'private-vehicle' }, currentStopSequence: 1, stopId: TARGET_ROUTES[0].outboundFrom,
      position: { latitude: 35.7, longitude: 139.42 } }
  }] });
  return {
    tripUpdatesBytes: bindings.transit_realtime.FeedMessage.encode(update).finish(),
    vehicleBytes: bindings.transit_realtime.FeedMessage.encode(vehicle).finish()
  };
}

test('Seibu GTFS build fixes all verified 6/7/8/9 platform routes and both school stop variants', () => {
  const artifact = artifactFixture();
  assert.equal(artifact.stats.routeCount, 13);
  assert.deepEqual(artifact.stats.selectedTrips, {
    [TACHIKAWA_TO_SCHOOL_SOURCE]: 13, [SCHOOL_TO_TACHIKAWA_SOURCE]: 12
  });
  assert.deepEqual([...new Set(artifact.directions[TACHIKAWA_TO_SCHOOL_SOURCE].map((row) => row.platform))].sort(), ['6', '7', '8', '9']);
  assert.ok(artifact.directions[TACHIKAWA_TO_SCHOOL_SOURCE].some((row) => row.toStopId === STOPS.schoolWestOutbound));
  assert.ok(artifact.directions[SCHOOL_TO_TACHIKAWA_SOURCE].some((row) => row.fromStopId === STOPS.schoolWestInbound));
  assert.equal(artifact.routes['251006'].label, '系統番号なし');
});

test('Seibu GTFS-RT retains internal GPS and reconstructs scheduled, estimated, ETA and delay', () => {
  const bytes = realtimeFixture();
  const realtime = parseSeibuRealtime({ ...bytes, fetchedAt: NOW });
  assert.equal(realtime.updates[0].trip.startDate, null);
  assert.ok(Math.abs(realtime.vehicles[0].position.lat - 35.7) < 0.00001);
  assert.ok(Math.abs(realtime.vehicles[0].position.lon - 139.42) < 0.00001);
  assert.deepEqual(realtime.vehicles[0].rawState, { stopId: TARGET_ROUTES[0].outboundFrom, sequence: 1, status: null });
  const arrivals = buildSeibuArrivals({ artifact: artifactFixture(), realtime, now: NOW });
  const live = arrivals.find((row) => row.id.endsWith(':out-0'));
  assert.equal(live.scheduledDeparture, NOW + 300);
  assert.equal(live.estimatedDeparture, NOW + 480);
  assert.equal(live.etaMinutes, 8);
  assert.equal(live.delayMinutes, 3);
  assert.equal(live.platform, '7番');
  assert.equal(live.realtimeState, 'realtime');
  assert.deepEqual(live.position, { supported: false, state: null, stopsAway: null, previousStop: null, nextStop: null, confidence: null });
  assert.doesNotMatch(JSON.stringify(arrivals), /private-vehicle|"lat"|"lon"/);
});

test('Seibu Provider shares its two-feed cache and falls back to static without fabricating ETA', async () => {
  const bytes = realtimeFixture(); let calls = 0;
  const provider = createSeibuProvider({ artifact: artifactFixture(), token: 'synthetic-token', now: () => NOW,
    fetcher: async (input) => {
      calls++; const url = new URL(input);
      assert.equal(url.searchParams.get('acl:consumerKey'), 'synthetic-token');
      return new Response(url.pathname.endsWith('SeibuBus_vehicle') ? bytes.vehicleBytes : bytes.tripUpdatesBytes);
    } });
  const [first, second] = await Promise.all([provider.getArrivals(), provider.getArrivals()]);
  assert.equal(calls, 2); assert.equal(first.arrivals.length, 6); assert.deepEqual(first, second);
  assert.ok(Math.abs(provider.getInternalVehicles()[0].position.lat - 35.7) < 0.00001);
  assert.ok(Math.abs(provider.getInternalVehicles()[0].position.lon - 139.42) < 0.00001);
  const fallback = createSeibuProvider({ artifact: artifactFixture(), token: 'synthetic-token', now: () => NOW,
    fetcher: async () => new Response('', { status: 503 }) });
  const failed = await fallback.getArrivals();
  assert.equal(failed.arrivals.length, 6);
  assert.ok(failed.arrivals.every((row) => row.realtimeState === 'static_fallback'
    && row.estimatedDeparture === null && row.etaMinutes === null && row.delayMinutes === null));
});

const arrival = (changes = {}) => ({ id: 'seibu-a', sourceId: TACHIKAWA_TO_SCHOOL_SOURCE, provider: 'seibu',
  routeId: '301004', routeLabel: '立３５', destination: '東村山駅西口',
  originStop: { id: STOPS.tachikawaPlatform6, name: '立川駅北口' },
  targetStop: { id: STOPS.tachikawaPlatform6, name: '立川駅北口' },
  scheduledDeparture: NOW + 300, estimatedDeparture: NOW + 360, effectiveDeparture: null,
  etaMinutes: 6, delayMinutes: 1, platform: '6', realtimeState: 'realtime', departureState: 'realtime',
  actionability: 'catchable', confidence: null,
  position: { supported: false, state: null, stopsAway: null, previousStop: null, nextStop: null, confidence: null },
  ...changes });

test('Tachikawa Hub ranks 6/7/8/9 platforms as one decision and school Hub combines main/west stops', () => {
  const outbound = ['6番', '7番', '8番', '9番'].map((platform, index) => arrival({ id: `out-${platform}`,
    routeId: TARGET_ROUTES[index].routeId, routeLabel: TARGET_ROUTES[index].routeLabel, platform,
    scheduledDeparture: NOW + (index + 1) * 60, estimatedDeparture: NOW + (index + 2) * 60, etaMinutes: index + 2 }));
  const tachikawa = aggregateHub({ hub: TACHIKAWA_EKIKITAGUCHI_HUB, generatedAt: NOW,
    providerResults: [{ provider: 'seibu', arrivals: outbound }] });
  assert.equal(tachikawa.decisionGroups.length, 1);
  assert.deepEqual(tachikawa.decisionGroups[0].arrivals.map((row) => row.platform), ['6番', '7番', '8番']);
  assert.equal(tachikawa.decisionGroups[0].recommendedArrivalId, 'out-6番');
  const inbound = [STOPS.schoolInbound, STOPS.schoolWestInbound].map((stopId, index) => arrival({
    id: `in-${index}`, sourceId: SCHOOL_TO_TACHIKAWA_SOURCE, destination: '立川駅北口', platform: null,
    originStop: { id: stopId, name: index ? '昭和第一学園西門' : '昭和第一学園' },
    targetStop: { id: stopId, name: index ? '昭和第一学園西門' : '昭和第一学園' },
    scheduledDeparture: NOW + (index + 1) * 120, estimatedDeparture: null, etaMinutes: null,
    delayMinutes: null, realtimeState: 'static_fallback', departureState: 'scheduled', actionability: null }));
  const school = aggregateHub({ hub: SHOWA_DAIICHI_GAKUEN_HUB, generatedAt: NOW,
    providerResults: [{ provider: 'seibu', arrivals: inbound }] });
  assert.deepEqual(school.decisionGroups[0].arrivals.map((row) => row.originStop.name), ['昭和第一学園', '昭和第一学園西門']);
});

test('Seibu failure is isolated and does not introduce Provider logic into Hub core', async () => {
  const service = createHubService({ hubs: [TACHIKAWA_EKIKITAGUCHI_HUB], now: () => NOW,
    providerLoaders: { seibu: async () => { throw new Error('private upstream message'); } } });
  const result = await service.getHub('tachikawa-ekikitaguchi');
  assert.equal(result.decisionGroups[0].arrivals.length, 0);
  assert.deepEqual(result.providers, [{ provider: 'seibu', state: 'unavailable', code: 'SOURCE_UNAVAILABLE', invalidCount: 0 }]);
  const hubCore = await Promise.all(['aggregator.js', 'model.js', 'ranking.js'].map((name) =>
    readFile(new URL(`../hub/${name}`, import.meta.url), 'utf8')));
  assert.doesNotMatch(hubCore.join('\n'), /Seibu|西武|providers\/seibu/);
});

test('Seibu runtime uses only official ODPT endpoints and keeps Position public gate closed', async () => {
  const code = (await Promise.all(['config.js', 'provider.js', 'realtime.js', 'static-source.js'].map((name) =>
    readFile(new URL(`../providers/seibu/${name}`, import.meta.url), 'utf8')))).join('\n');
  assert.match(code, /api\.odpt\.org/);
  assert.doesNotMatch(code, /transfer-cloud|navitime|scrap|bus-location/);
  assert.doesNotMatch(code, /supported:\s*true/);
});

test('Seibu Position research index keeps the complete stop order outside the runtime graph', () => {
  const index = buildSeibuPositionResearchIndex(gtfsFixture());
  const outbound = index.trips['out-0'], inbound = index.trips['in-0'];
  assert.equal(outbound.sourceId, TACHIKAWA_TO_SCHOOL_SOURCE);
  assert.equal(outbound.targetStopId, TARGET_ROUTES[0].outboundFrom);
  assert.deepEqual(outbound.stops.map((row) => row.sequence), [1, 7]);
  assert.equal(inbound.sourceId, SCHOOL_TO_TACHIKAWA_SOURCE);
  assert.equal(inbound.targetStopId, TARGET_ROUTES[0].inboundFrom);
  assert.deepEqual(inbound.stops.map((row) => row.sequence), [7, 13]);
});

test('sequence difference remains a candidate while missing current_status keeps Public Position unsupported', () => {
  const index = buildSeibuPositionResearchIndex(gtfsFixture()), trip = index.trips['in-0'];
  const start = trip.stops[0];
  const rows = analyzeSeibuPositionSample({ positionIndex: index, receivedAt: NOW, vehicles: [{
    tripId: trip.tripId, routeId: trip.routeId, timestamp: NOW - 10,
    position: { lat: start.lat, lon: start.lon },
    rawState: { stopId: start.stopId, sequence: start.sequence, status: null }
  }] });
  assert.equal(rows[0].candidateValid, true);
  assert.equal(rows[0].stopsAwayCandidate, 0);
  assert.equal(rows[0].publicationBlock, 'current_status_missing');
  assert.deepEqual(rows[0].position, { supported: false, state: null, stopsAway: null,
    previousStop: null, nextStop: null, confidence: null });
  assert.doesNotMatch(JSON.stringify(rows), /vehicleId/);
});

test('stale, contradictory and regressing Seibu sequence evidence fails safe', () => {
  const index = buildSeibuPositionResearchIndex(gtfsFixture()), trip = index.trips['in-0'];
  const [first, second] = trip.stops;
  const base = { tripId: trip.tripId, routeId: trip.routeId, timestamp: NOW - 10,
    position: { lat: first.lat, lon: first.lon }, rawState: { stopId: first.stopId, sequence: first.sequence, status: null } };
  const stale = analyzeSeibuPositionSample({ positionIndex: index, receivedAt: NOW,
    vehicles: [{ ...base, timestamp: NOW - 500 }] })[0];
  const mismatch = analyzeSeibuPositionSample({ positionIndex: index, receivedAt: NOW,
    vehicles: [{ ...base, rawState: { ...base.rawState, stopId: second.stopId } }] })[0];
  assert.equal(stale.candidateValid, false); assert.equal(stale.publicationBlock, 'gps_stale');
  assert.equal(mismatch.candidateValid, false); assert.equal(mismatch.publicationBlock, 'sequence_stop_mismatch');
  const summary = summarizeSeibuPositionObservations([
    { observations: [{ ...base, candidateValid: true, statusKnown: false, publicationBlock: 'current_status_missing', gps: base.position }] },
    { observations: [{ ...base, timestamp: NOW, rawState: { ...base.rawState, sequence: first.sequence - 1 },
      candidateValid: false, statusKnown: false, publicationBlock: 'sequence_stop_mismatch', gps: base.position }] }
  ]);
  assert.equal(summary.sameTripPairs, 1); assert.equal(summary.sequenceRegressions, 1);
  assert.equal(summary.publicSupported, 0);
});

import { zipSync, strToU8 } from 'fflate';
import bindings from 'gtfs-realtime-bindings';
import { FAVORITES } from '../config/settings.js';
import { P0_QUERIES } from '../config/queries.js';
import { KAWASAKI_CONTEXT } from '../providers/kawasaki/context.js';
export const P0_INPUT = Object.freeze({ queries: P0_QUERIES, providerContext: KAWASAKI_CONTEXT });
import { parseStatic } from '../providers/kawasaki/static.js';
export const NOW = Date.parse('2026-09-10T07:50:00+09:00') / 1000;
const csv = (rows) => strToU8(rows.map((row) => row.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(',')).join('\r\n'));
export function staticZip() {
  const stops = [...new Set(FAVORITES.flatMap((f) => [...f.fromStopIds, ...f.toStopIds]))];
  const routes = [...new Set(FAVORITES.flatMap((f) => f.routeIds))];
  return zipSync({
    'agency.txt': csv([['agency_timezone'], ['Asia/Tokyo']]),
    'stops.txt': csv([['stop_id', 'stop_name', 'location_type'], ...stops.map((id) => [id, '合成停留所', 0])]),
    'routes.txt': csv([['route_id', 'route_short_name'], ...routes.map((id) => [id, `合成${id}`])]),
    'trips.txt': csv([['trip_id', 'route_id', 'service_id', 'trip_headsign'], ...FAVORITES.map((f, i) => [`synthetic-${i}`, f.routeIds[0], 'weekday', ''])]),
    'stop_times.txt': csv([['trip_id', 'stop_sequence', 'stop_id', 'departure_time', 'pickup_type', 'drop_off_type', 'stop_headsign'], ...FAVORITES.flatMap((f, i) => [
      [`synthetic-${i}`, 1, f.fromStopIds[0], '07:54:00', 0, 0, '合成の行先'],
      [`synthetic-${i}`, 9, f.toStopIds[0], '08:10:00', 0, 0, '合成の行先']])]),
    'calendar.txt': csv([['service_id', 'start_date', 'end_date', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'], ['weekday', '20260101', '20261231', 1, 1, 1, 1, 1, 0, 0]]),
    'calendar_dates.txt': csv([['service_id', 'date', 'exception_type']]),
    'feed_info.txt': csv([['feed_version', 'feed_start_date', 'feed_end_date'], ['synthetic', '20260101', '20261231']])
  });
}
export const indexFixture = () => parseStatic(staticZip(), NOW, P0_QUERIES);
export function realtimeFixture({ delay = 180, time = NOW + 420, timestamp = NOW, relationship = 0 } = {}) {
  return { schemaVersion: KAWASAKI_CONTEXT.realtimeSchemaVersion, fetchedAt: NOW, timestamp, vehicles: [], updates: FAVORITES.map((f, i) => ({
    trip: { tripId: `synthetic-${i}`, startDate: '20260910', startTime: '07:54:00', routeId: f.routeIds[0], relationship },
    timestamp, stops: [{ stopId: f.fromStopIds[0], sequence: 1, relationship: 0, departure: { time, delay, uncertainty: null } }] })) };
}
export function protoFixture() {
  const message = bindings.transit_realtime.FeedMessage.create({ header: { gtfsRealtimeVersion: '2.0', timestamp: NOW, incrementality: 0 }, entity: [
    { id: 'synthetic-tu', tripUpdate: { trip: { tripId: 'synthetic-0', startDate: '20260910' }, timestamp: NOW,
      stopTimeUpdate: [{ stopSequence: 1, stopId: '184_2', departure: { delay: 0 } }, { stopSequence: 9, stopId: '362_1', departure: {} }] } },
    { id: 'synthetic-vp', vehicle: { trip: { tripId: 'synthetic-0', startDate: '20260910' }, currentStopSequence: 1, currentStatus: 1, stopId: '184_2', timestamp: NOW } }
  ] });
  return bindings.transit_realtime.FeedMessage.encode(message).finish();
}

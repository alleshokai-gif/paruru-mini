import bindings from 'gtfs-realtime-bindings';
import { LIMITS } from '../../config/policy.js';
import { API_ROOT, TRIP_UPDATE_PATH, VEHICLE_PATH } from './config.js';

const own = (value, name) => value && Object.hasOwn(value, name);
const number = (value) => {
  const result = Number(value);
  return Number.isSafeInteger(result) ? result : null;
};
const epoch = (value) => {
  const result = number(value);
  return result !== null && result >= 0 && result <= 8640000000000 ? result : null;
};
const coordinate = (value, bound) => Number.isFinite(value) && Math.abs(value) <= bound ? value : null;
const fail = (code) => { throw new Error(code); };

async function fetchFeed(path, token, fetcher) {
  if (!token || /\s/.test(token)) fail('BUS_SECRET_MISSING');
  const url = new URL(path, API_ROOT);
  url.searchParams.set('acl:consumerKey', token);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIMITS.requestTimeoutMs);
  try {
    const response = await fetcher(url.href, { redirect: 'manual', signal: controller.signal });
    if (!response.ok) fail('BUS_SEIBU_RT_HTTP');
    if (Number(response.headers.get('content-length')) > LIMITS.rtMaxBytes) fail('BUS_SEIBU_RT_SIZE');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > LIMITS.rtMaxBytes) fail('BUS_SEIBU_RT_SIZE');
    return bytes;
  } catch (error) {
    if (/^BUS_(?:SEIBU_|SECRET_)[A-Z_]+$/.test(error?.message || '')) throw error;
    fail('BUS_SEIBU_RT_FETCH');
  } finally { clearTimeout(timer); }
}

function decode(bytes) {
  let feed;
  try { feed = bindings.transit_realtime.FeedMessage.decode(bytes); }
  catch { fail('BUS_SEIBU_RT_DECODE'); }
  if ((number(feed.header?.incrementality) ?? 0) !== 0 || !epoch(feed.header?.timestamp)) fail('BUS_SEIBU_RT_HEADER');
  return feed;
}

function descriptor(value) {
  if (!value?.tripId) return null;
  return { tripId: value.tripId, routeId: value.routeId || null,
    startDate: /^\d{8}$/.test(value.startDate || '') ? value.startDate : null,
    startTime: value.startTime || null, relationship: number(value.scheduleRelationship) ?? 0 };
}

function stopEvent(value) {
  if (!value) return null;
  return { time: own(value, 'time') ? epoch(value.time) : null,
    delay: own(value, 'delay') ? number(value.delay) : null };
}

function vehicleId(value) {
  return typeof value?.id === 'string' && value.id.length > 0 && value.id.length <= 128
    && !/[\u0000-\u001f\u007f]/.test(value.id) ? value.id : null;
}

export function parseSeibuRealtime({ tripUpdatesBytes, vehicleBytes, fetchedAt }) {
  if (!(tripUpdatesBytes instanceof Uint8Array) || !(vehicleBytes instanceof Uint8Array) || !Number.isFinite(fetchedAt))
    fail('BUS_SEIBU_RT_INPUT');
  const updatesFeed = decode(tripUpdatesBytes), vehicleFeed = decode(vehicleBytes);
  const updates = [], vehicles = [];
  for (const entity of updatesFeed.entity || []) {
    if (entity.isDeleted) continue;
    const value = entity.tripUpdate, trip = descriptor(value?.trip);
    if (!trip) continue;
    updates.push({ trip, vehicleId: vehicleId(value.vehicle), timestamp: epoch(value.timestamp),
      stops: (value.stopTimeUpdate || []).map((stop) => ({ stopId: stop.stopId || null,
        sequence: own(stop, 'stopSequence') ? number(stop.stopSequence) : null,
        relationship: number(stop.scheduleRelationship) ?? 0,
        arrival: stopEvent(stop.arrival), departure: stopEvent(stop.departure) })) });
  }
  for (const entity of vehicleFeed.entity || []) {
    if (entity.isDeleted) continue;
    const value = entity.vehicle, trip = descriptor(value?.trip);
    if (!trip) continue;
    vehicles.push({ provider: 'seibu', tripId: trip.tripId, routeId: trip.routeId,
      timestamp: epoch(value.timestamp), vehicleId: vehicleId(value.vehicle),
      position: { lat: own(value.position, 'latitude') ? coordinate(value.position.latitude, 90) : null,
        lon: own(value.position, 'longitude') ? coordinate(value.position.longitude, 180) : null },
      rawState: { stopId: value.stopId || null,
        sequence: own(value, 'currentStopSequence') ? number(value.currentStopSequence) : null,
        status: own(value, 'currentStatus') ? number(value.currentStatus) : null } });
  }
  return { fetchedAt, timestamp: Math.min(Number(updatesFeed.header.timestamp), Number(vehicleFeed.header.timestamp)),
    updateTimestamp: Number(updatesFeed.header.timestamp), vehicleTimestamp: Number(vehicleFeed.header.timestamp),
    updates, vehicles };
}

export async function fetchSeibuRealtime(token, fetcher = fetch, now = () => Date.now() / 1000) {
  const [tripUpdatesBytes, vehicleBytes] = await Promise.all([
    fetchFeed(TRIP_UPDATE_PATH, token, fetcher), fetchFeed(VEHICLE_PATH, token, fetcher)
  ]);
  return parseSeibuRealtime({ tripUpdatesBytes, vehicleBytes, fetchedAt: now() });
}

\n
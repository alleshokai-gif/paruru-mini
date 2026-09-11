import bindings from 'gtfs-realtime-bindings';
import { LIMITS } from '../../config/policy.js';
import { API_ROOT, REALTIME_PATH, REALTIME_SCHEMA_VERSION } from './config.js';

const own = (value, name) => value && Object.hasOwn(value, name);
const num = (value, name) => own(value, name) && Number.isSafeInteger(Number(value[name])) ? Number(value[name]) : null;
const epoch = (value, name) => { const n = num(value, name); return n !== null && n >= 0 && n <= 8640000000000 ? n : null; };
const fail = (code) => { throw new Error(code); };

export async function fetchRealtime(token, fetcher = fetch) {
  if (!token || /\s/.test(token)) fail('BUS_SECRET_MISSING');
  const url = new URL(REALTIME_PATH, API_ROOT);
  url.searchParams.set('acl:consumerKey', token);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIMITS.requestTimeoutMs);
  try {
    let response = await fetcher(url.href, { redirect: 'manual', signal: controller.signal });
    if (!response.ok) fail('BUS_UPSTREAM_HTTP');
    const max = LIMITS.rtMaxBytes;
    if (Number(response.headers.get('content-length')) > max) fail('BUS_UPSTREAM_SIZE');
    const reader = response.body.getReader(); const chunks = []; let size = 0;
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length; if (size > max) { await reader.cancel(); fail('BUS_UPSTREAM_SIZE'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
  } catch (error) {
    // Never expose upstream messages: fetch errors can include authenticated URLs.
    if (/^BUS_[A-Z_]+$/.test(error?.message || '')) throw error;
    fail('BUS_UPSTREAM_FETCH');
  } finally { clearTimeout(timer); }
}
function descriptor(value) {
  if (!value?.tripId || !/^\d{8}$/.test(value.startDate || '')) return null;
  return { tripId: value.tripId, startDate: value.startDate, startTime: value.startTime || null,
    routeId: value.routeId || null, relationship: num(value, 'scheduleRelationship') ?? 0 };
}
function event(value) {
  if (!value) return null;
  return { time: epoch(value, 'time'), delay: num(value, 'delay'), uncertainty: num(value, 'uncertainty') };
}
function coordinate(value, name, bound) {
  // Protobuf prototype defaults are not observed coordinates. Preserve an explicit zero.
  if (!own(value, name)) return null;
  const n = value[name];
  return Number.isFinite(n) && Math.abs(n) <= bound ? n : null;
}
export function parseRealtime(bytes, fetchedAt) {
  let feed; try { feed = bindings.transit_realtime.FeedMessage.decode(bytes); } catch { fail('BUS_RT_DECODE'); }
  if ((num(feed.header, 'incrementality') ?? 0) !== 0 || !epoch(feed.header, 'timestamp')) fail('BUS_RT_HEADER');
  const updates = [], vehicles = [];
  for (const entity of feed.entity || []) {
    if (entity.isDeleted) continue;
    const tu = entity.tripUpdate, vp = entity.vehicle;
    const trip = descriptor(tu?.trip);
    if (trip) updates.push({ trip, timestamp: epoch(tu, 'timestamp'), stops: (tu.stopTimeUpdate || []).map((s) => ({
      stopId: s.stopId || null, sequence: num(s, 'stopSequence'), relationship: num(s, 'scheduleRelationship') ?? 0,
      departure: event(s.departure) })) });
    const vehicleTrip = descriptor(vp?.trip);
    if (vehicleTrip) vehicles.push({ trip: vehicleTrip, timestamp: epoch(vp, 'timestamp'), stopId: vp.stopId || null,
      sequence: num(vp, 'currentStopSequence'), status: num(vp, 'currentStatus'),
      position: { lat: coordinate(vp.position, 'latitude', 90), lon: coordinate(vp.position, 'longitude', 180) } });
  }
  // Coordinates are internal only. Public DTO construction is an explicit allowlist in Core.
  return { schemaVersion: REALTIME_SCHEMA_VERSION, fetchedAt, timestamp: Number(feed.header.timestamp), updates, vehicles };
}
export function createKawasakiAdapter({ token, fetcher = fetch, now = () => Date.now() / 1000, measure = () => {} }) {
  return {
    async getRealtime() {
      const begin = performance.now(); let bytes;
      measure({ odptFetches: 1 });
      try { bytes = await fetchRealtime(token, fetcher); }
      finally { measure({ odptFetchMs: performance.now() - begin }); }
      const decode = performance.now();
      try { return parseRealtime(bytes, now()); }
      finally { measure({ rtDecodeMs: performance.now() - decode }); }
    }
  };
}

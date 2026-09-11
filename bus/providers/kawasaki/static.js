import { Unzip, UnzipInflate } from 'fflate';
import { LIMITS } from '../../config/policy.js';
import { PROVIDER_ID, resolvePlatform } from './config.js';
import { clockSeconds } from '../../core/time.js';

const REQUIRED = ['agency', 'stops', 'routes', 'trips', 'stop_times', 'feed_info'];
const META = new Set(['agency', 'stops', 'routes', 'trips', 'calendar', 'calendar_dates', 'feed_info', 'frequencies']);
const fail = (code) => { throw new Error(code); };

// Incremental RFC4180 reader. No whole expanded stop_times string or table is retained.
export function csvReader(onRow) {
  let row = [], value = '', quoted = false, pendingQuote = false, skipLF = false;
  const field = () => { row.push(value); value = ''; };
  const end = () => { field(); if (row.some((v) => v !== '')) onRow(row); row = []; };
  return (text, final = false) => {
    for (const c of text) {
      if (skipLF) { skipLF = false; if (c === '\n') continue; }
      if (quoted) {
        if (pendingQuote) {
          pendingQuote = false;
          if (c === '"') { value += c; continue; }
          quoted = false;
        } else {
          if (c === '"') pendingQuote = true; else value += c;
          continue;
        }
      }
      if (c === '"' && value === '') quoted = true;
      else if (c === ',') field();
      else if (c === '\r' || c === '\n') { end(); skipLF = c === '\r'; }
      else value += c;
      if (value.length > 65536 || row.length > 200) fail('STATIC_CSV_LIMIT');
    }
    if (final) {
      if (quoted && !pendingQuote) fail('STATIC_CSV_QUOTE');
      if (value || row.length) end();
    }
  };
}

function readZip(bytes, wanted, accept) {
  const seen = new Set(); let expanded = 0;
  const unzip = new Unzip((file) => {
    const name = file.name.split('/').at(-1)?.replace(/\.txt$/, '');
    if (!wanted.has(name)) return;
    if (seen.has(name)) fail('STATIC_DUPLICATE_TABLE');
    seen.add(name);
    let columns;
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const csv = csvReader((values) => {
      if (!columns) { columns = values; if (new Set(columns).size !== columns.length) fail('STATIC_HEADERS'); return; }
      if (values.length !== columns.length) fail('STATIC_CSV_WIDTH');
      accept(name, columns, values);
    });
    file.ondata = (error, data, final) => {
      if (error) fail('STATIC_ZIP_INVALID');
      expanded += data.length;
      if (expanded > LIMITS.expandedMaxBytes) fail('STATIC_EXPANSION_LIMIT');
      csv(decoder.decode(data, { stream: !final }), final);
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  for (let i = 0; i < bytes.length; i += 16384) unzip.push(bytes.subarray(i, i + 16384), i + 16384 >= bytes.length);
  return seen;
}
const object = (columns, values) => Object.fromEntries(columns.map((key, i) => [key, values[i]]));

export function parseStatic(bytes, fetchedAt, queries) {
  if (!Array.isArray(queries) || !queries.length || queries.some(q => q.type !== 'favorite' || q.provider !== PROVIDER_ID)) fail('STATIC_QUERY_CONFIG');
  const stops = new Map(), routes = new Map(), trips = new Map();
  const tables = { agency: [], calendar: [], calendar_dates: [], feed_info: [], frequencies: [] };
  const routeIds = new Set(queries.flatMap((q) => q.routeIds));
  const stopIds = new Set(queries.flatMap((q) => [...q.fromStopIds, ...q.toStopIds]));
  const rowCounts = {};
  const seen = readZip(bytes, META, (name, columns, values) => {
    rowCounts[name] = (rowCounts[name] || 0) + 1;
    if (name === 'trips' && !routeIds.has(values[columns.indexOf('route_id')])) return;
    const row = object(columns, values);
    if (['stops', 'routes', 'trips'].includes(name)) {
      const [map, key] = name === 'stops' ? [stops, 'stop_id'] : name === 'routes' ? [routes, 'route_id'] : [trips, 'trip_id'];
      if (!row[key] || map.has(row[key])) fail('STATIC_DUPLICATE_ID');
      map.set(row[key], row);
    } else tables[name].push(row);
  });
  if (REQUIRED.filter((n) => n !== 'stop_times').some((n) => !seen.has(n))) fail('STATIC_TABLE_MISSING');
  if (!tables.agency.length || tables.agency.some((a) => a.agency_timezone !== 'Asia/Tokyo')) fail('STATIC_TIMEZONE');
  if (!tables.calendar.length && !tables.calendar_dates.length) fail('STATIC_CALENDAR_MISSING');
  if (tables.feed_info.length !== 1) fail('STATIC_FEED_INFO');
  if (!/^\d{8}$/.test(tables.feed_info[0].feed_start_date || '') || !/^\d{8}$/.test(tables.feed_info[0].feed_end_date || '')) fail('STATIC_FEED_DATES');
  for (const id of stopIds) if (!stops.has(id) || !['', '0'].includes(stops.get(id).location_type || '')) fail('STATIC_STOP_CONFIG');
  for (const id of routeIds) if (!routes.get(id)?.route_short_name) fail('STATIC_ROUTE_CONFIG');
  const frequency = new Set(tables.frequencies.map((r) => r.trip_id));
  const selected = new Map(), starts = new Map();
  const seenTimes = readZip(bytes, new Set(['stop_times']), (name, columns, values) => {
    rowCounts[name] = (rowCounts[name] || 0) + 1;
    const id = values[columns.indexOf('trip_id')];
    if (!trips.has(id) || frequency.has(id)) return;
    const seq = Number(values[columns.indexOf('stop_sequence')]);
    if (!Number.isInteger(seq) || seq < 0) fail('STATIC_SEQUENCE');
    const stopId = values[columns.indexOf('stop_id')];
    const start = starts.get(id);
    if (!start || seq < start.sequence) starts.set(id, { sequence: seq, time: values[columns.indexOf('departure_time')] });
    if (!stopIds.has(stopId)) return;
    const row = object(columns, values);
    row.sequence = seq;
    if (!selected.has(id)) selected.set(id, []);
    selected.get(id).push(row);
  });
  if (!seenTimes.has('stop_times')) fail('STATIC_TABLE_MISSING');
  const directions = Object.fromEntries(queries.map((q) => [q.id, []]));
  for (const [tripId, chain] of selected) {
    const trip = trips.get(tripId);
    if (new Set(chain.map((s) => s.sequence)).size !== chain.length) fail('STATIC_DUPLICATE_SEQUENCE');
    for (const f of queries) {
      if (!f.routeIds.includes(trip.route_id)) continue;
      const pairs = [];
      for (const from of chain) for (const to of chain) {
        if (f.fromStopIds.includes(from.stop_id) && f.toStopIds.includes(to.stop_id)
          && from.sequence < to.sequence && ['', '0'].includes(from.pickup_type || '') && ['', '0'].includes(to.drop_off_type || '')) pairs.push([from, to]);
      }
      // Loop/ambiguous stop visits are not silently collapsed to one boarding event.
      if (pairs.length > 1) fail('STATIC_AMBIGUOUS_VISIT');
      if (!pairs.length) continue;
      const [from, to] = pairs[0]; const seconds = clockSeconds(from.departure_time);
      if (seconds === null || !trip.service_id || clockSeconds(starts.get(tripId)?.time) === null) fail('STATIC_SCHEDULE_MISSING');
      if (clockSeconds(to.departure_time) === null || clockSeconds(to.departure_time) < seconds) fail('STATIC_TIME_ORDER');
      if (!['', '0', '1'].includes(trip.direction_id || '')) fail('STATIC_DIRECTION_ID');
      directions[f.id].push({ tripId, routeId: trip.route_id, routeLabel: routes.get(trip.route_id).route_short_name,
        serviceId: trip.service_id, directionId: trip.direction_id || null, startTime: starts.get(tripId).time, fromStopId: from.stop_id, toStopId: to.stop_id,
        stopSequence: from.sequence, alightSequence: to.sequence, scheduledSeconds: seconds,
        headsign: from.stop_headsign || trip.trip_headsign || null, platform: resolvePlatform(from.stop_id) });
    }
  }
  if (Object.values(directions).some((rows) => !rows.length)) fail('STATIC_DIRECTION_EMPTY');
  const serviceIds = new Set(Object.values(directions).flatMap((rows) => rows.map((r) => r.serviceId)));
  return { schemaVersion: 1, fetchedAt, directions,
    stops: Object.fromEntries([...stopIds].map((id) => [id, { stopId: id, name: stops.get(id).stop_name, platformCode: stops.get(id).platform_code || null }])),
    routes: Object.fromEntries([...routeIds].map((id) => [id, { routeId: id, label: routes.get(id).route_short_name }])),
    calendar: tables.calendar.filter((r) => serviceIds.has(r.service_id)), calendarDates: tables.calendar_dates.filter((r) => serviceIds.has(r.service_id)),
    feedInfo: tables.feed_info[0], stats: { zipBytes: bytes.length, rowCounts, selectedRows: Object.fromEntries(Object.entries(directions).map(([k, v]) => [k, v.length])) } };
}

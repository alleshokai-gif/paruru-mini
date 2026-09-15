import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { clockSeconds } from '../../core/time.js';
import { ARTIFACT_SCHEMA_VERSION, DIRECTIONS, PROVIDER_ID, STOPS, TARGET_ROUTES,
  SCHOOL_TO_TACHIKAWA_SOURCE, TACHIKAWA_TO_SCHOOL_SOURCE } from './config.js';

const fail = (code) => { throw new Error(code); };
const hash = (value) => createHash('sha256').update(value).digest('hex');

function parseCsv(bytes) {
  const text = strFromU8(bytes), rows = [];
  let row = [], value = '', quoted = false;
  const finishField = () => { row.push(value); value = ''; };
  const finishRow = () => { finishField(); if (row.some((entry) => entry !== '')) rows.push(row); row = []; };
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { value += '"'; index++; }
      else if (char === '"') quoted = false;
      else value += char;
    } else if (char === '"' && value === '') quoted = true;
    else if (char === ',') finishField();
    else if (char === '\r' || char === '\n') { if (char === '\r' && text[index + 1] === '\n') index++; finishRow(); }
    else value += char;
  }
  if (quoted) fail('BUS_SEIBU_STATIC_CSV');
  if (value || row.length) finishRow();
  const columns = rows.shift();
  if (!columns?.length || new Set(columns).size !== columns.length) fail('BUS_SEIBU_STATIC_HEADERS');
  return rows.map((values) => {
    if (values.length !== columns.length) fail('BUS_SEIBU_STATIC_CSV');
    return Object.fromEntries(columns.map((name, index) => [name, values[index]]));
  });
}

function table(files, name, optional = false) {
  const found = Object.entries(files).find(([path]) => path.split('/').at(-1) === `${name}.txt`)?.[1];
  if (!found) { if (optional) return []; fail('BUS_SEIBU_STATIC_TABLE'); }
  return parseCsv(found);
}

function pairFor(route, chain) {
  const pairs = [];
  const add = (sourceId, fromId, toId) => {
    if (!fromId || !toId) return;
    for (const from of chain) for (const to of chain) {
      if (from.stop_id === fromId && to.stop_id === toId && Number(from.stop_sequence) < Number(to.stop_sequence))
        pairs.push({ sourceId, from, to });
    }
  };
  add(TACHIKAWA_TO_SCHOOL_SOURCE, route.outboundFrom, route.outboundTo);
  add(SCHOOL_TO_TACHIKAWA_SOURCE, route.inboundFrom, STOPS.tachikawaArrival);
  if (pairs.length > 1) fail('BUS_SEIBU_STATIC_AMBIGUOUS');
  return pairs[0] || null;
}

export function validateSeibuArtifact(value) {
  if (value?.schemaVersion !== ARTIFACT_SCHEMA_VERSION || value.provider !== PROVIDER_ID
    || !Number.isFinite(value.generatedAtEpoch) || !/^\d{8}$/.test(value.feedInfo?.feed_start_date || '')
    || !/^\d{8}$/.test(value.feedInfo?.feed_end_date || '') || !Array.isArray(value.calendar)
    || !Array.isArray(value.calendarDates) || !value.stops || !value.routes || !value.directions)
    fail('BUS_SEIBU_ARTIFACT_INVALID');
  for (const direction of DIRECTIONS) {
    const rows = value.directions[direction.id];
    if (!Array.isArray(rows) || !rows.length) fail('BUS_SEIBU_ARTIFACT_DIRECTION');
    for (const row of rows) {
      if (!row.tripId || !row.routeId || !row.routeLabel || !row.serviceId
        || !value.stops[row.fromStopId] || !value.stops[row.toStopId] || !value.routes[row.routeId]
        || !Number.isInteger(row.stopSequence) || !Number.isInteger(row.alightSequence)
        || row.stopSequence >= row.alightSequence || !Number.isFinite(row.scheduledSeconds)
        || row.platform != null && typeof row.platform !== 'string') fail('BUS_SEIBU_ARTIFACT_ROW');
    }
  }
  return value;
}

export function buildSeibuStatic(bytes, { now = Date.now() / 1000 } = {}) {
  if (!(bytes instanceof Uint8Array) || !Number.isFinite(now)) fail('BUS_SEIBU_STATIC_INPUT');
  let files; try { files = unzipSync(bytes); } catch { fail('BUS_SEIBU_STATIC_ZIP'); }
  const agency = table(files, 'agency'), stopsRows = table(files, 'stops'), routesRows = table(files, 'routes');
  const tripsRows = table(files, 'trips'), stopTimes = table(files, 'stop_times');
  const calendar = table(files, 'calendar', true), calendarDates = table(files, 'calendar_dates', true);
  const feedInfoRows = table(files, 'feed_info');
  if (!agency.length || agency.some((row) => row.agency_timezone !== 'Asia/Tokyo')
    || !calendar.length && !calendarDates.length || feedInfoRows.length !== 1) fail('BUS_SEIBU_STATIC_METADATA');
  const feedInfo = feedInfoRows[0];
  const routeConfig = new Map(TARGET_ROUTES.map((row) => [row.routeId, row]));
  const routes = new Map(routesRows.filter((row) => routeConfig.has(row.route_id)).map((row) => [row.route_id, row]));
  if (routes.size !== TARGET_ROUTES.length) fail('BUS_SEIBU_STATIC_ROUTE');
  for (const config of TARGET_ROUTES) {
    const row = routes.get(config.routeId);
    if ((row.route_short_name || '系統番号なし') !== config.routeLabel) fail('BUS_SEIBU_STATIC_ROUTE');
  }
  const trips = new Map(tripsRows.filter((row) => routeConfig.has(row.route_id)).map((row) => [row.trip_id, row]));
  const chains = new Map();
  for (const row of stopTimes) if (trips.has(row.trip_id)) {
    if (!chains.has(row.trip_id)) chains.set(row.trip_id, []);
    chains.get(row.trip_id).push(row);
  }
  const stopMap = new Map(stopsRows.map((row) => [row.stop_id, row]));
  const directions = Object.fromEntries(DIRECTIONS.map((row) => [row.id, []]));
  const selectedStopIds = new Set(), selectedRouteIds = new Set(), serviceIds = new Set();
  for (const [tripId, chainValue] of chains) {
    const trip = trips.get(tripId), config = routeConfig.get(trip.route_id);
    const chain = chainValue.toSorted((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence));
    const pair = pairFor(config, chain);
    if (!pair) continue;
    const fromSequence = Number(pair.from.stop_sequence), toSequence = Number(pair.to.stop_sequence);
    const scheduledSeconds = clockSeconds(pair.from.departure_time);
    if (!Number.isInteger(fromSequence) || !Number.isInteger(toSequence) || scheduledSeconds === null
      || !trip.service_id || !stopMap.has(pair.from.stop_id) || !stopMap.has(pair.to.stop_id)) fail('BUS_SEIBU_STATIC_TRIP');
    const route = routes.get(trip.route_id), fromStop = stopMap.get(pair.from.stop_id);
    const headsign = pair.from.stop_headsign || trip.trip_headsign || route.route_long_name;
    if (!headsign) fail('BUS_SEIBU_STATIC_HEADSIGN');
    directions[pair.sourceId].push({ tripId, routeId: trip.route_id, routeLabel: config.routeLabel,
      serviceId: trip.service_id, directionId: trip.direction_id || null,
      fromStopId: pair.from.stop_id, toStopId: pair.to.stop_id,
      stopSequence: fromSequence, alightSequence: toSequence, scheduledSeconds,
      headsign, platform: fromStop.platform_code || null });
    selectedStopIds.add(pair.from.stop_id); selectedStopIds.add(pair.to.stop_id);
    selectedRouteIds.add(trip.route_id); serviceIds.add(trip.service_id);
  }
  for (const direction of DIRECTIONS) directions[direction.id].sort((a, b) => a.scheduledSeconds - b.scheduledSeconds
    || a.tripId.localeCompare(b.tripId));
  const artifact = {
    schemaVersion: ARTIFACT_SCHEMA_VERSION, provider: PROVIDER_ID,
    generatedAt: new Date(now * 1000).toISOString(), generatedAtEpoch: now,
    sourceVersion: feedInfo.feed_version, sourceHash: hash(bytes), feedInfo,
    directions,
    stops: Object.fromEntries([...selectedStopIds].sort().map((id) => [id, { stopId: id,
      name: stopMap.get(id).stop_name, lat: Number(stopMap.get(id).stop_lat), lon: Number(stopMap.get(id).stop_lon),
      platformCode: stopMap.get(id).platform_code || null }])),
    routes: Object.fromEntries([...selectedRouteIds].sort().map((id) => [id, { routeId: id,
      label: routeConfig.get(id).routeLabel, longName: routes.get(id).route_long_name || null }])),
    calendar: calendar.filter((row) => serviceIds.has(row.service_id)),
    calendarDates: calendarDates.filter((row) => serviceIds.has(row.service_id)),
    stats: { zipBytes: bytes.length, selectedTrips: Object.fromEntries(DIRECTIONS.map((row) =>
      [row.id, directions[row.id].length])), routeCount: selectedRouteIds.size, stopCount: selectedStopIds.size }
  };
  return validateSeibuArtifact(artifact);
}

// Research-only index used to test GTFS-RT sequence/GPS consistency. Runtime arrivals use the
// smaller artifact above and never import this parser.
export function buildSeibuPositionResearchIndex(bytes) {
  if (!(bytes instanceof Uint8Array)) fail('BUS_SEIBU_POSITION_STATIC_INPUT');
  let files; try { files = unzipSync(bytes); } catch { fail('BUS_SEIBU_STATIC_ZIP'); }
  const stopsRows = table(files, 'stops'), tripsRows = table(files, 'trips');
  const stopTimes = table(files, 'stop_times'), feedInfoRows = table(files, 'feed_info');
  if (feedInfoRows.length !== 1) fail('BUS_SEIBU_STATIC_METADATA');
  const routeConfig = new Map(TARGET_ROUTES.map((row) => [row.routeId, row]));
  const trips = new Map(tripsRows.filter((row) => routeConfig.has(row.route_id)).map((row) => [row.trip_id, row]));
  const stops = new Map(stopsRows.map((row) => [row.stop_id, row])), chains = new Map();
  for (const row of stopTimes) if (trips.has(row.trip_id)) {
    if (!chains.has(row.trip_id)) chains.set(row.trip_id, []);
    chains.get(row.trip_id).push(row);
  }
  const selected = {};
  for (const [tripId, sourceChain] of chains) {
    const trip = trips.get(tripId), config = routeConfig.get(trip.route_id);
    const chain = sourceChain.toSorted((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence));
    const pair = pairFor(config, chain);
    if (!pair) continue;
    const normalized = chain.map((row, ordinal) => {
      const stop = stops.get(row.stop_id), sequence = Number(row.stop_sequence);
      const lat = Number(stop?.stop_lat), lon = Number(stop?.stop_lon);
      if (!stop || !Number.isInteger(sequence) || !Number.isFinite(lat) || !Number.isFinite(lon)
        || Math.abs(lat) > 90 || Math.abs(lon) > 180) fail('BUS_SEIBU_POSITION_STATIC_ROW');
      return { stopId: row.stop_id, name: stop.stop_name, sequence, ordinal, lat, lon };
    });
    if (new Set(normalized.map((row) => row.sequence)).size !== normalized.length) fail('BUS_SEIBU_POSITION_STATIC_ROW');
    const target = normalized.find((row) => row.stopId === pair.from.stop_id
      && row.sequence === Number(pair.from.stop_sequence));
    if (!target) fail('BUS_SEIBU_POSITION_STATIC_TARGET');
    selected[tripId] = { tripId, routeId: trip.route_id, directionId: trip.direction_id || null,
      sourceId: pair.sourceId, targetStopId: target.stopId, targetSequence: target.sequence,
      targetOrdinal: target.ordinal, stops: normalized };
  }
  if (!Object.keys(selected).length) fail('BUS_SEIBU_POSITION_STATIC_EMPTY');
  return { schemaVersion: 1, provider: PROVIDER_ID, sourceVersion: feedInfoRows[0].feed_version,
    feedInfo: feedInfoRows[0], trips: selected };
}

export function publishSeibuStatic(artifact, output) {
  validateSeibuArtifact(artifact);
  const body = `${JSON.stringify(artifact)}\n`, folder = dirname(output);
  mkdirSync(folder, { recursive: true });
  const temporary = join(folder, `${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, body, { flag: 'wx', encoding: 'utf8', flush: true });
    validateSeibuArtifact(JSON.parse(readFileSync(temporary, 'utf8')));
    if (existsSync(output)) copyFileSync(output, join(folder, `previous-seibu-${hash(readFileSync(output)).slice(0, 16)}.json`));
    renameSync(temporary, output);
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
  return { bytes: Buffer.byteLength(body), sha256: hash(body), counts: artifact.stats };
}

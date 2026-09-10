// Research-only bounded capture. Navi is a comparison reference, never a runtime source.
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { setTimeout as wait } from 'node:timers/promises';
import bindings from 'gtfs-realtime-bindings';
import { readLocalToken } from './local-secret.js';
import { fetchRealtime } from '../providers/kawasaki/adapter.js';
import { FAVORITES } from '../config/settings.js';
import { iso, serviceActive } from '../core/arrivals.js';
const ENDPOINT = 'https://kcbn.bus-navigation.jp/wgsys/wgp/busMarkImg.htm';
const NAMES = { '登戸': '登戸駅（生田緑地口）', '溝の口駅南口': '溝口駅南口' };
const SAMPLE_COUNT = 8, INTERVAL_MS = 31000, MAX_MARKERS = 24, MAX_VEHICLES = 60;
// After departure the origin query loses the bus. These are reference views only;
// ODPT selection still uses the original four P0 directions.
const RETURN_REFERENCE = process.argv.slice(2).includes('--return-reference');
const REFERENCES = RETURN_REFERENCE ? {
  noborito_to_home: { from: '神木本町', to: '菅生車庫' },
  mizonokuchi_to_home: { from: '神木本町', to: '鷲ヶ峰営業所前' }
} : {};
const own = (v, k) => v && Object.hasOwn(v, k) ? v[k] : null;
const number = (v, k) => own(v, k) !== null && Number.isFinite(Number(v[k])) ? Number(v[k]) : null;
const event = (v) => v ? { time: number(v, 'time'), delay: number(v, 'delay') } : null;

async function reference(favorite) {
  const startedAt = iso(Date.now() / 1000);
  const query = REFERENCES[favorite.id] || favorite;
  try {
    const url = new URL(ENDPOINT);
    url.search = new URLSearchParams({ locale: 'ja', from: NAMES[query.from] || query.from,
      fromType: '1', to: NAMES[query.to] || query.to, toType: '1', existYn: 'N' });
    const r = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!r.ok || !r.headers.get('content-type')?.includes('json')) throw Error();
    const reader = r.body.getReader(), chunks = []; let length = 0;
    for (;;) { const part = await reader.read(); if (part.done) break;
      length += part.value.length; if (length > 1048576) { await reader.cancel(); throw Error(); } chunks.push(part.value); }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const markers = (data.mapDataList || []).filter(v => v.type === '3');
    return { status: 'ok', referenceFrom: query.from, referenceTo: query.to,
      startedAt, receivedAt: iso(Date.now() / 1000), pageLoadTime: data.pageLoadTime,
      markerCount: markers.length, truncated: markers.length > MAX_MARKERS,
      markers: markers.slice(0, MAX_MARKERS).map(v => ({ content: v.content, lat: v.lat, lon: v.lng,
        route: v.rollsignName, destination: v.destinationName, transit: v.transitName,
        fromSignpoleKey: v.signpoleKeyFrom, toSignpoleKey: v.signpoleKeyTo })) };
  } catch { return { status: 'reference_unavailable', startedAt, receivedAt: iso(Date.now() / 1000), markers: [] }; }
}

try {
  const token = readLocalToken(), index = JSON.parse(readFileSync(new URL('../generated/p0-static.json', import.meta.url), 'utf8'));
  const start = Date.now() / 1000, day = Math.floor((start + 9 * 3600) / 86400) * 86400 - 9 * 3600;
  const date = iso(start).slice(0, 10).replaceAll('-', '');
  const directionRows = Object.fromEntries(FAVORITES.map(f => [f.id, new Map(index.directions[f.id]
    .filter(r => serviceActive(index, r.serviceId, day)).map(r => [r.tripId, r]))]));
  const captureId = iso(start).slice(0,19).replaceAll(/[-:]/g, '');
  const target = new URL(`../generated/position-p0-${captureId}.json`, import.meta.url), tmp = new URL(target.href + '.tmp');
  const result = { researchOnly: true, captureId, startedAt: iso(start), sourceVersion: index.sourceVersion,
    positionUiEnabled: false, exactNaviTripJoinProven: false, intendedSamples: SAMPLE_COUNT, intervalMs: INTERVAL_MS, samples: [] };
  for (let sample = 0; sample < SAMPLE_COUNT; sample++) {
    if (sample) await wait(INTERVAL_MS);
    const startedAt = iso(Date.now() / 1000);
    const [raw, refs] = await Promise.all([fetchRealtime(token), Promise.all(FAVORITES.map(reference))]);
    const receivedAt = iso(Date.now() / 1000), feed = bindings.transit_realtime.FeedMessage.decode(raw);
    const vp = feed.entity.map(e => e.vehicle).filter(Boolean), tu = feed.entity.map(e => e.tripUpdate).filter(Boolean);
    const directions = FAVORITES.map((f, i) => {
      const rows = directionRows[f.id], matches = vp.filter(v => {
        const row = rows.get(v.trip?.tripId);
        return row && v.trip.startDate === date && (!v.trip.routeId || v.trip.routeId === row.routeId)
          && (!v.trip.startTime || v.trip.startTime === row.startTime)
          && row.scheduledSeconds + day >= start - 1800 && row.scheduledSeconds + day <= start + 3600;
      });
      return { id: f.id, navi: refs[i], vehicleCount: matches.length, truncated: matches.length > MAX_VEHICLES,
        vehicles: matches.slice(0, MAX_VEHICLES).map(v => {
          const row = rows.get(v.trip.tripId), updates = tu.filter(u => u.trip?.tripId === v.trip.tripId && u.trip.startDate === date);
          return { tripId: v.trip.tripId, startDate: v.trip.startDate, routeId: row.routeId, routeLabel: row.routeLabel,
            headsign: row.headsign, scheduled: iso(day + row.scheduledSeconds), fromStopId: row.fromStopId, toStopId: row.toStopId,
            targetSequence: row.stopSequence, alightSequence: row.alightSequence,
            timestamp: number(v, 'timestamp'), lat: number(v.position, 'latitude'), lon: number(v.position, 'longitude'),
            bearing: number(v.position, 'bearing'), speed: number(v.position, 'speed'),
            auxiliary: { sequence: number(v, 'currentStopSequence'), status: number(v, 'currentStatus'), stopId: own(v, 'stopId') },
            update: updates.length === 1 ? { timestamp: number(updates[0], 'timestamp'),
              stops: updates[0].stopTimeUpdate.filter(s => [row.fromStopId, row.toStopId].includes(s.stopId)).map(s => ({
                stopId: s.stopId, arrival: event(s.arrival), departure: event(s.departure) })) } : null };
        }) };
    });
    result.samples.push({ sample, startedAt, receivedAt, feedTimestamp: number(feed.header, 'timestamp'), directions });
    const encoded = JSON.stringify(result, null, 2) + '\n';
    if ([token, encodeURIComponent(token)].some(s => encoded.includes(s))) throw Error();
    writeFileSync(tmp, encoded, { encoding: 'utf8', flush: true }); renameSync(tmp, target);
    console.log(JSON.stringify({ captureId, sample, startedAt, receivedAt, feedTimestamp: number(feed.header, 'timestamp'),
      directions: directions.map(d => ({ id: d.id, naviStatus: d.navi.status, naviMarkers: d.navi.markerCount,
        content: d.navi.markers.map(v => `${v.route}:${v.content}`), vehicles: d.vehicleCount })) }));
  }
} catch { console.log('{"status":"POSITION_P0_CAPTURE_STOPPED","previousSamplesPreserved":true}'); process.exitCode = 1; }

// Bounded research ONLY. The internal Navi endpoint is never a production data source.
// Request keys/values were observed in public JS and official platform links.
import { writeFileSync, readFileSync } from 'node:fs';
import { setTimeout as wait } from 'node:timers/promises';
import bindings from 'gtfs-realtime-bindings';
import { readLocalToken } from './local-secret.js';
import { fetchRealtime } from '../providers/kawasaki/adapter.js';
const REFERENCE = { endpoint: 'https://kcbn.bus-navigation.jp/wgsys/wgp/busMarkImg.htm',
  query: { locale: 'ja', from: '神木本町', fromType: '1', to: '鷲ヶ峰営業所前', toType: '1', fromSignpoleKey: '144819', existYn: 'N' } };
const SAMPLE_COUNT = 3, INTERVAL_MS = 31000;
const present = (v, key) => v && Object.hasOwn(v, key) ? v[key] : null;
try {
  const token = readLocalToken(), tripId = process.argv[2];
  const index = JSON.parse(readFileSync(new URL('../generated/p0-static.json', import.meta.url), 'utf8'));
  const trip = index.directions.mizonokuchi_to_home.find((r) => r.tripId === tripId);
  if (!trip) throw Error();
  const results = [];
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    if (i) await wait(INTERVAL_MS);
    const url = new URL(REFERENCE.endpoint); url.search = new URLSearchParams(REFERENCE.query);
    const startedAt = new Date().toISOString();
    const [r, bytes] = await Promise.all([fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) }), fetchRealtime(token)]);
    if (!r.ok || !r.headers.get('content-type')?.includes('json')) throw Error();
    const body = await r.text(); if (Buffer.byteLength(body) > 1048576) throw Error();
    const data = JSON.parse(body), feed = bindings.transit_realtime.FeedMessage.decode(bytes);
    const candidates = feed.entity.map(e => e.vehicle).filter(v => v?.trip.tripId === tripId);
    const vp = candidates.length === 1 ? candidates[0] : null;
    const sample = { startedAt, receivedAt: new Date().toISOString(), navi: { pageLoadTime: data.pageLoadTime,
      // A Navi marker has no proven GTFS trip_id. Keep candidates, never label the join exact.
      candidates: (data.mapDataList || []).filter(v => v.type === '3' && v.rollsignName === trip.routeLabel).slice(0,5).map(v => ({
        content: v.content, lat: v.lat, lon: v.lng, route: v.rollsignName, destination: v.destinationName, transit: v.transitName,
        fromSignpoleKey: v.signpoleKeyFrom, toSignpoleKey: v.signpoleKeyTo })) },
      odpt: { feedTimestamp: Number(feed.header.timestamp), tripId, vehicle: vp ? {
        timestamp: Number(vp.timestamp), lat: present(vp.position, 'latitude'), lon: present(vp.position, 'longitude'),
        // Auxiliary observations only: NOT the basis for segment classification.
        sequence: present(vp, 'currentStopSequence'), status: present(vp, 'currentStatus'), stopId: present(vp, 'stopId') } : null } };
    const text = JSON.stringify(sample); if (text.includes(token)) throw Error();
    results.push(sample); console.log(text);
  }
  const summary = JSON.stringify({ researchOnly: true, exactTripJoinProven: false, reference: REFERENCE.query, results }, null, 2);
  if (summary.includes(token)) throw Error();
  writeFileSync(new URL('../generated/position-reference-summary.json', import.meta.url), summary + '\n');
} catch { console.log('{"status":"POSITION_REFERENCE_OBSERVATION_FAILED"}'); process.exitCode = 1; }

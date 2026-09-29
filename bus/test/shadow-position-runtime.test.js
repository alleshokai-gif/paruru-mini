import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadShadowPosition } from '../runtime/shadow-position.js';
import { publicPosition } from '../position/engine.js';

const bundle = JSON.parse(readFileSync(new URL('../release-static/position-shadow-geometry.json', import.meta.url), 'utf8'));
const source = bundle.sources[0], [chainId, candidate] = Object.entries(source.chains)[0];
const tripId = 'approved-shadow-trip', date = '20260929';
const serviceDay = Date.parse('2026-09-29T00:00:00+09:00') / 1000;
const stopRows = candidate.stopProjections.map(row => ({ stopId: row.stopId, sequence: row.sequence }));
const positionStatic = {
  provider: 'kawasaki', sourceHash: bundle.staticSourceHash,
  chains: { [chainId]: { stops: stopRows } },
  stops: Object.fromEntries(stopRows.map(row => [row.stopId,
    { name: `stop-${row.stopId}`, position: candidate.points[0] }])),
  trips: { [tripId]: { tripId, chainId, routeId: '10044' } }
};
const target = stopRows.find(row => row.stopId === '184_2');
const index = {
  directions: { home_to_noborito: [{ tripId, routeId: '10044', fromStopId: target.stopId,
    stopSequence: target.sequence, serviceId: 'weekday', startTime: '07:00:00' }] },
  calendar: [{ service_id: 'weekday', start_date: '20260901', end_date: '20261031',
    sunday: '1', monday: '1', tuesday: '1', wednesday: '1', thursday: '1', friday: '1', saturday: '1' }],
  calendarDates: []
};

test('approved geometry loads into one internal Shadow chain without enabling Public Position', () => {
  const loaded = loadShadowPosition({ index, positionStatic });
  assert.equal(loaded.status, 'shadow_geometry_loaded');
  assert.equal(loaded.stats.supportedChains, 1);
  assert.deepEqual(loaded.stats.geometrySources, ['validated_road_geometry']);
  assert.equal(loaded.stats.approvedForPublic, false);
  assert.equal(loaded.stats.geometryReady, false);
  assert.equal(candidate.eligible, false);
  assert.equal(publicPosition().supported, false);
});

test('three fresh matched GPS points can support only the internal Shadow result', () => {
  const loaded = loadShadowPosition({ index, positionStatic });
  const base = serviceDay + 7 * 3600;
  for (let sample = 0; sample < 3; sample++) {
    const timestamp = base + sample * 32;
    loaded.observer.observe({ now: timestamp, realtime: { timestamp, vehicles: [{
      trip: { tripId, routeId: '10044', startDate: date, startTime: '07:00:00', relationship: 0 },
      timestamp, position: candidate.points[132 + sample]
    }] } });
    assert.equal(loaded.observer.summary().supported, sample === 2 ? 1 : 0);
  }
  assert.equal(loaded.observer.positionFor({ tripId, date,
    stopId: target.stopId, sequence: target.sequence }).supported, true);
  assert.equal(publicPosition().supported, false);
  loaded.observer.observe({ now: base + 120, realtime: { timestamp: base + 120, vehicles: [] } });
  assert.equal(loaded.observer.positionFor({ tripId, date,
    stopId: target.stopId, sequence: target.sequence }), null);
});

test('12:39-style longer trip uses only the exact approved suffix after entering it', () => {
  const longer = structuredClone(positionStatic), longerIndex = structuredClone(index);
  const longerTripId = 'longer-1239-trip', longerChainId = 'longer-chain';
  longer.chains[longerChainId] = { stops: [
    ...[1, 2, 3, 4].map(sequence => ({ stopId: `prefix-${sequence}`, sequence })),
    ...stopRows.map(stop => ({ stopId: stop.stopId, sequence: stop.sequence + 4 }))
  ] };
  longer.trips[longerTripId] = { tripId: longerTripId, chainId: longerChainId, routeId: '10044' };
  longerIndex.directions.home_to_noborito.push({ tripId: longerTripId, routeId: '10044',
    fromStopId: target.stopId, stopSequence: target.sequence + 4,
    serviceId: 'weekday', startTime: '07:00:00' });
  const loaded = loadShadowPosition({ index: longerIndex, positionStatic: longer });
  assert.equal(loaded.stats.supportedChains, 2);
  assert.equal(loaded.stats.sharedCorridorChains, 1);
  const base = serviceDay + 7 * 3600;
  loaded.observer.observe({ now: base, realtime: { timestamp: base, vehicles: [{
    trip: { tripId: longerTripId, routeId: '10044', startDate: date,
      startTime: '07:00:00', relationship: 0 },
    timestamp: base, sequence: 4, position: candidate.points[132]
  }] } });
  assert.equal(loaded.observer.summary().reasons.shared_corridor_not_entered, 1);
  for (let sample = 0; sample < 3; sample++) {
    const timestamp = base + 32 * (sample + 1);
    loaded.observer.observe({ now: timestamp, realtime: { timestamp, vehicles: [{
      trip: { tripId: longerTripId, routeId: '10044', startDate: date,
        startTime: '07:00:00', relationship: 0 },
      timestamp, sequence: target.sequence + 4, position: candidate.points[132 + sample]
    }] } });
  }
  assert.equal(loaded.observer.summary().supported, 1);
  assert.equal(loaded.observer.positionFor({ tripId: longerTripId, date,
    stopId: target.stopId, sequence: target.sequence + 4 }).supported, true);
  const noSequence = base + 128;
  loaded.observer.observe({ now: noSequence, realtime: { timestamp: noSequence, vehicles: [{
    trip: { tripId: longerTripId, routeId: '10044', startDate: date,
      startTime: '07:00:00', relationship: 0 },
    timestamp: noSequence, position: candidate.points[135]
  }] } });
  assert.equal(loaded.observer.summary().reasons.shared_corridor_not_entered, 1);
  assert.equal(publicPosition().supported, false);
});

test('terminal shared corridors reuse approved geometry only after entry, including shorter trips', () => {
  const expanded = structuredClone(positionStatic), expandedIndex = structuredClone(index);
  const variants = [
    { id: 'shorter-suffix', approvedStart: 8, prefix: 0 },
    { id: 'partial-longer-suffix', approvedStart: 4, prefix: 8 }
  ];
  for (const variant of variants) {
    const suffix = stopRows.slice(variant.approvedStart).map((stop, ordinal) =>
      ({ stopId: stop.stopId, sequence: ordinal + variant.prefix + 1 }));
    expanded.chains[variant.id] = { stops: [
      ...Array.from({ length: variant.prefix }, (_, ordinal) =>
        ({ stopId: `prefix-${variant.id}-${ordinal}`, sequence: ordinal + 1 })), ...suffix
    ] };
    expanded.trips[variant.id] = { tripId: variant.id, chainId: variant.id, routeId: '10044' };
    expandedIndex.directions.home_to_noborito.push({ tripId: variant.id, routeId: '10044',
      fromStopId: target.stopId,
      stopSequence: suffix.find((stop) => stop.stopId === target.stopId).sequence,
      serviceId: 'weekday', startTime: '07:00:00' });
  }
  const loaded = loadShadowPosition({ index: expandedIndex, positionStatic: expanded });
  assert.equal(loaded.stats.supportedChains, 3);
  assert.equal(loaded.stats.sharedCorridorChains, 2);
  const base = serviceDay + 7 * 3600;
  loaded.observer.observe({ now: base, realtime: { timestamp: base, vehicles: [{
    trip: { tripId: 'shorter-suffix', routeId: '10044', startDate: date,
      startTime: '07:00:00', relationship: 0 },
    timestamp: base, sequence: 5, position: candidate.points[0]
  }] } });
  assert.equal(loaded.observer.summary().reasons.shared_corridor_gps_outside, 1);
  for (const variant of variants) {
    const row = expandedIndex.directions.home_to_noborito.find((item) => item.tripId === variant.id);
    loaded.observer.observe({ now: base, realtime: { timestamp: base, vehicles: [{
      trip: { tripId: variant.id, routeId: '10044', startDate: date,
        startTime: '07:00:00', relationship: 0 },
      timestamp: base, sequence: variant.prefix + 1, position: candidate.points[132]
    }] } });
    assert.equal(loaded.observer.summary().reasons.shared_corridor_not_entered, 1);
    for (let sample = 0; sample < 3; sample++) {
      const timestamp = base + (sample + 1) * 32;
      loaded.observer.observe({ now: timestamp, realtime: { timestamp, vehicles: [{
        trip: { tripId: variant.id, routeId: '10044', startDate: date,
          startTime: '07:00:00', relationship: 0 },
        timestamp, sequence: row.stopSequence, position: candidate.points[132 + sample]
      }] } });
    }
    assert.equal(loaded.observer.positionFor({ tripId: variant.id, date,
      stopId: target.stopId, sequence: row.stopSequence }).supported, true);
  }
  assert.equal(publicPosition().supported, false);
});

test('a different suffix remains unsupported even with matching route and fresh GPS', () => {
  const other = structuredClone(positionStatic), otherIndex = structuredClone(index);
  const otherTripId = 'different-suffix-trip', otherChainId = 'different-suffix-chain';
  other.chains[otherChainId] = { stops: [
    { stopId: 'prefix', sequence: 1 },
    ...stopRows.map(stop => ({ stopId: stop.stopId, sequence: stop.sequence + 1 }))
  ] };
  other.chains[otherChainId].stops.at(-2).stopId = 'different-stop';
  other.trips[otherTripId] = { tripId: otherTripId, chainId: otherChainId, routeId: '10044' };
  otherIndex.directions.home_to_noborito.push({ tripId: otherTripId, routeId: '10044',
    fromStopId: target.stopId, stopSequence: target.sequence + 1,
    serviceId: 'weekday', startTime: '07:00:00' });
  const loaded = loadShadowPosition({ index: otherIndex, positionStatic: other });
  assert.equal(loaded.stats.supportedChains, 1);
  const timestamp = serviceDay + 7 * 3600;
  loaded.observer.observe({ now: timestamp, realtime: { timestamp, vehicles: [{
    trip: { tripId: otherTripId, routeId: '10044', startDate: date,
      startTime: '07:00:00', relationship: 0 },
    timestamp, sequence: target.sequence + 1, position: candidate.points[132]
  }] } });
  assert.equal(loaded.observer.summary().reasons.trip_static_mismatch, 1);
});

test('stale, wrong Static hash and missing geometry fail closed', () => {
  const loaded = loadShadowPosition({ index, positionStatic });
  loaded.observer.observe({ now: serviceDay + 7 * 3600 + 200,
    realtime: { timestamp: serviceDay + 7 * 3600, vehicles: [] } });
  assert.equal(loaded.observer.summary().reasons.feed_stale, 1);
  assert.equal(loadShadowPosition({ index, positionStatic: { ...positionStatic, sourceHash: 'wrong' } }).stats.supportedChains, 0);
  assert.equal(loadShadowPosition({ index, positionStatic, read: () => '{bad' }).status, 'shadow_geometry_unavailable');
});

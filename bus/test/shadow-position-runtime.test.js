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

test('stale, wrong Static hash and missing geometry fail closed', () => {
  const loaded = loadShadowPosition({ index, positionStatic });
  loaded.observer.observe({ now: serviceDay + 7 * 3600 + 200,
    realtime: { timestamp: serviceDay + 7 * 3600, vehicles: [] } });
  assert.equal(loaded.observer.summary().reasons.feed_stale, 1);
  assert.equal(loadShadowPosition({ index, positionStatic: { ...positionStatic, sourceHash: 'wrong' } }).stats.supportedChains, 0);
  assert.equal(loadShadowPosition({ index, positionStatic, read: () => '{bad' }).status, 'shadow_geometry_unavailable');
});

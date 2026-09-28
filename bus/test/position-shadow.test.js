import test from 'node:test';
import assert from 'node:assert/strict';
import { shadowPosition } from '../position/shadow.js';

const artifact = { approvedForShadow: true, approvedForPublic: false, geometryReady: false };
const result = { supported: true, method: 'gps_validated_road_geometry_snap', state: 'between_stops',
  confidence: 0.92, conflicts: [], stopsAway: 2,
  previousStop: { id: 'x', name: '長尾橋' }, nextStop: { id: 'y', name: '神木本町' },
  position: { lat: 35.6, lon: 139.5 } };

test('Stage 1 shadow describes a supported stop interval without leaking GPS', () => {
  const value = shadowPosition(result, artifact);
  assert.deepEqual(value, { supported: true, state: 'between_stops', previousStop: '長尾橋',
    nextStop: '神木本町', stopsAway: 2, confidence: 0.92, shadowReady: true });
  assert.doesNotMatch(JSON.stringify(value), /lat|lon|vehicleId|tripId/);
});

test('unsupported, contradictory and unapproved evidence stays unknown', () => {
  for (const candidate of [{ ...result, supported: false }, { ...result, confidence: 0.5 },
    { ...result, conflicts: ['raw_sequence'] }, { ...result, nextStop: null },
    { ...result, stopsAway: -1 }, { ...result, method: 'sequence_only' }])
    assert.equal(shadowPosition(candidate, artifact).supported, false);
  assert.equal(shadowPosition(result, { ...artifact, approvedForShadow: false }).supported, false);
  assert.equal(shadowPosition(result, { ...artifact, approvedForPublic: true }).supported, false);
  assert.equal(shadowPosition(result, { ...artifact, geometryReady: true }).supported, false);
});

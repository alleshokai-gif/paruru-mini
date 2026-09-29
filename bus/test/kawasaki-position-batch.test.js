import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyKawasakiPositionBatch } from '../scripts/kawasaki-position-batch.js';

const read = name => JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));
const p0 = read('../generated/p0-static.json');
const journey = read('../generated/kawasaki-p2-5-static.json');
const position = read('../generated/p1-position-static.json');
const bundle = read('../release-static/position-shadow-geometry.json');
const selected = new Set(Object.values(p0.directions).flat().map(row => row.tripId));
const priorTrips = Object.fromEntries(Object.entries(position.trips).filter(([id]) => selected.has(id)));
const priorChainIds = new Set(Object.values(priorTrips).map(trip => trip.chainId));
const priorPosition = { ...position,
  trips: priorTrips,
  chains: Object.fromEntries(Object.entries(position.chains).filter(([id]) => priorChainIds.has(id))),
  directions: Object.fromEntries(Object.entries(p0.directions).map(([id, rows]) => [id, rows.map(row => row.tripId)])) };
const previous = { p0, journey, position: priorPosition };
const next = { p0, journey, position };

test('one-source batch expands the sidecar to every P0 and Journey query without changing old chains', () => {
  const result = verifyKawasakiPositionBatch(previous, next, bundle);
  assert.equal(result.stats.priorTrips, 8856);
  assert.equal(result.stats.allTrips, 9124);
  assert.equal(result.stats.priorChains, 34);
  assert.equal(result.stats.allChains, 40);
  assert.equal(result.stats.journeyOnlyTrips, 268);
  assert.equal(Object.keys(position.directions).length, 8);
  assert.equal(result.bundle.sources[0].approvedForPublic, false);
  assert.equal(result.bundle.sources[0].geometryReady, false);
});

test('changed stop chain fails closed before publication', () => {
  const chainId = Object.keys(priorPosition.chains)[0];
  const changed = structuredClone(position);
  changed.chains[chainId].stops[0].stopId = 'missing';
  assert.throws(() => verifyKawasakiPositionBatch(previous, { ...next, position: changed }, bundle),
    /POSITION_INDEX_INVALID|POSITION_BATCH_CHAIN_CHANGED/);
});

test('unapproved or mismatched shadow geometry fails closed before publication', () => {
  const changed = structuredClone(bundle);
  const candidate = Object.values(changed.sources[0].chains)[0];
  candidate.approvedForPublic = true;
  assert.throws(() => verifyKawasakiPositionBatch(previous, next, changed), /POSITION_BATCH_SHADOW_CHAIN_CHANGED/);
  candidate.approvedForPublic = false;
  candidate.stopProjections[0].stopId = 'missing';
  assert.throws(() => verifyKawasakiPositionBatch(previous, next, changed), /POSITION_BATCH_SHADOW_CHAIN_CHANGED/);
});

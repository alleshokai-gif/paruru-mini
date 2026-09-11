import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import bindings from 'gtfs-realtime-bindings';
import baseline from './p0-dto-baseline.json' with { type: 'json' };
import { p0Cases } from './p0-cases.js';
import { NOW, P0_INPUT, indexFixture, realtimeFixture } from './fixtures.js';
import { getArrivals } from '../core/arrivals.js';
import { createBusService } from '../core/service.js';
import { parseRealtime } from '../providers/kawasaki/adapter.js';
import { createKawasakiContext } from '../providers/kawasaki/context.js';

const run = (input = {}) => getArrivals({ index: indexFixture(), now: NOW, ...P0_INPUT, ...input });
const query = (changes = {}) => ({ ...P0_INPUT.queries[0], ...changes });

for (const { name, input } of p0Cases()) test(`P0 complete DTO unchanged: ${name}`, () => {
  const actual = createHash('sha256').update(JSON.stringify(run(input))).digest('hex');
  assert.equal(actual, baseline.results.find(r => r.name === name)?.sha256);
});

test('Core dependency graph contains neither fixed queries nor Provider/runtime dependencies', async () => {
  const result = await build({ entryPoints: [fileURLToPath(new URL('../core/service.js', import.meta.url))],
    bundle: true, platform: 'neutral', format: 'esm', write: false, metafile: true, logLevel: 'silent' });
  const paths = Object.keys(result.metafile.inputs).join('\n');
  for (const forbidden of ['favorites', 'settings', 'config/queries', 'providers/', 'runtime/', 'worker/']) assert.ok(!paths.includes(forbidden), forbidden);
  const code = result.outputFiles[0].text;
  for (const forbidden of ['FAVORITES', 'kawasaki', '川崎', 'ODPT', '184_2', 'home_to_', 'caches.default']) assert.ok(!code.includes(forbidden), forbidden);
});

test('injected query IDs, order and filters work independently of P0 storage keys', () => {
  const index = indexFixture(), expected = run({ index });
  const queries = [query({ ...P0_INPUT.queries[3], id: 'new-query-3' }), query({ id: 'new-query-0' })];
  const renamed = run({ index, queries });
  assert.deepEqual(renamed.directions.map(d => d.id), ['new-query-3', 'new-query-0']);
  assert.deepEqual(renamed.directions.map(d => d.arrivals), [expected.directions[3].arrivals, expected.directions[0].arrivals]);
  // Reuse the same immutable index with different Query contents and flat normalized rows.
  assert.deepEqual(run({ index, queries: [query()] }).directions[0], expected.directions[0]);
  const flat = { ...index, rows: Object.values(index.directions).flat() }; delete flat.directions;
  assert.deepEqual(run({ index: flat, queries }), renamed);
});

test('a synthetic Provider supplies its own identities, labels, attribution and platforms', () => {
  const index = indexFixture(), row = index.directions.home_to_noborito[0];
  index.rows = [{ ...row, tripId: 'demo-trip', fromStopId: 'demo-a', toStopId: 'demo-b', routeId: 'demo-line', routeLabel: 'DEMO', headsign: 'B' }];
  delete index.directions;
  index.stops = { 'demo-a': { stopId: 'demo-a', name: 'A' }, 'demo-b': { stopId: 'demo-b', name: 'B' } };
  index.routes = { 'demo-line': { routeId: 'demo-line' } };
  const providerContext = { id: 'synthetic-provider', realtimeSchemaVersion: 7,
    attribution: { provider: 'Synthetic operator', distributor: 'Synthetic distributor', url: 'https://example.invalid', internal: 'never-public' },
    platformResolver(stopId, receivedIndex) { assert.equal(receivedIndex, index); assert.equal(stopId, 'demo-a'); return 'Demo platform'; } };
  const queries = [{ id: 'demo-query', type: 'favorite', provider: providerContext.id, label: 'A → B',
    fromStopIds: ['demo-a'], toStopIds: ['demo-b'], routeIds: ['demo-line'] }];
  const data = run({ index, queries, providerContext });
  assert.equal(data.directions[0].provider, providerContext.id);
  assert.equal(data.directions[0].from, 'A'); assert.equal(data.directions[0].to, 'B');
  assert.equal(data.directions[0].arrivals[0].platform, 'Demo platform');
  assert.equal(data.directions[0].arrivals[0].routeLabel, 'DEMO');
  assert.deepEqual(data.attribution, { provider: 'Synthetic operator', distributor: 'Synthetic distributor', url: 'https://example.invalid' });
  const replacement = run({ index, queries, providerContext: { ...providerContext, platformResolver: () => null,
    attribution: { ...providerContext.attribution, provider: 'Replacement' } } });
  assert.equal(replacement.directions[0].arrivals[0].platform, null);
  assert.equal(replacement.attribution.provider, 'Replacement');
});

test('unsupported, malformed and ambiguous queries fail before source fetching', () => {
  let calls = 0;
  const create = (queries, index = indexFixture(), providerContext = P0_INPUT.providerContext) => createBusService({
    index, queries, providerContext, version: 'test', adapter: { getRealtime() { calls++; return realtimeFixture(); } } });
  for (const queries of [undefined, [], [query({ id: '' })], [query(), query()], [query({ from: { lat: 1 } })],
    [query({ provider: 'unknown' })], [query({ fromStopIds: ['unknown'] })], [query({ routeIds: ['unknown'] })],
    ...['hub', 'platform', 'nearby'].map(type => [query({ type })])]) assert.throws(() => create(queries), /BUS_QUER/);
  assert.throws(() => create([query()], indexFixture(), {}), /BUS_PROVIDER_CONTEXT_INVALID/);
  assert.throws(() => create([query({ toStopIds: ['184_3'] })]), /BUS_QUERY_STATIC_UNAVAILABLE/);
  const index = indexFixture(), row = index.directions.home_to_noborito[0];
  index.directions.home_to_noborito.push({ ...row, stopSequence: 2 });
  assert.throws(() => create([query()], index), /BUS_QUERY_AMBIGUOUS_VISIT/);
  const conflict = indexFixture();
  conflict.directions.home_to_noborito.push({ ...conflict.directions.home_to_noborito[0], scheduledSeconds: 123 });
  assert.throws(() => create([query()], conflict), /BUS_STATIC_AMBIGUOUS/);
  assert.equal(calls, 0);
});

function vehicleFeed(position) {
  const vehicle = { trip: { tripId: 'synthetic-0', routeId: '10044', startDate: '20260910' }, timestamp: NOW,
    currentStopSequence: 5, currentStatus: 2, stopId: 'synthetic-next' };
  if (position !== undefined) vehicle.position = position;
  const feed = bindings.transit_realtime.FeedMessage.create({ header: { gtfsRealtimeVersion: '2.0', timestamp: NOW },
    entity: [{ id: 'synthetic-vp', vehicle }] });
  return parseRealtime(bindings.transit_realtime.FeedMessage.encode(feed).finish(), NOW);
}

test('Vehicle model preserves observed coordinates and identifiers without inference', () => {
  const [v] = vehicleFeed({ latitude: 35.5, longitude: 139.5 }).vehicles;
  assert.deepEqual(v.position, { lat: 35.5, lon: 139.5 });
  assert.deepEqual(v.trip, { tripId: 'synthetic-0', routeId: '10044', startDate: '20260910', startTime: null, relationship: 0 });
  assert.equal(v.timestamp, NOW); assert.equal(v.sequence, 5); assert.equal(v.status, 2); assert.equal(v.stopId, 'synthetic-next');
  assert.deepEqual(vehicleFeed({ latitude: 0, longitude: 0 }).vehicles[0].position, { lat: 0, lon: 0 });
});

test('missing Vehicle position is null; invalid coordinates are not fabricated or clamped', () => {
  assert.deepEqual(vehicleFeed().vehicles[0].position, { lat: null, lon: null });
  for (const n of [NaN, Infinity, 91, -91]) assert.equal(vehicleFeed({ latitude: n, longitude: 139.5 }).vehicles[0].position.lat, null);
  for (const n of [NaN, Infinity, 181, -181]) assert.equal(vehicleFeed({ latitude: 35.5, longitude: n }).vehicles[0].position.lon, null);
});

test('Public DTO never exposes internal Vehicle/static coordinates; Position remains disabled', () => {
  const index = indexFixture(), rt = realtimeFixture();
  rt.vehicles = vehicleFeed({ latitude: 35.5, longitude: 139.5 }).vehicles;
  index.directions.home_to_noborito[0].internalPosition = { lat: 35.5, lon: 139.5 };
  const data = run({ index, realtime: rt });
  assert.equal(data.positionUiEnabled, false);
  for (const d of data.directions) for (const a of d.arrivals) assert.deepEqual(a.position,
    { supported: false, status: null, stopsAway: null, previousStop: null, nextStop: null });
  assert.ok(!/"(?:lat|lon|latitude|longitude|vehicles|sequence|internalPosition)"/.test(JSON.stringify(data)));
  assert.deepEqual(rt.vehicles[0].position, { lat: 35.5, lon: 139.5 });
});

test('Position Static seam requires a version-matched complete trip chain and stays internal', () => {
  const index = indexFixture(), row = index.directions.home_to_noborito[0];
  const source = { sourceVersion: index.feedInfo.feed_version, trips: { [row.tripId]: { tripId: row.tripId, routeId: row.routeId,
    complete: true, shapeId: 'synthetic-shape', stops: [
      { stopId: row.fromStopId, sequence: 1, position: { lat: 35.5, lon: 139.5 } },
      { stopId: 'intermediate', sequence: 5, position: { lat: null, lon: null } },
      { stopId: row.toStopId, sequence: 9, position: { lat: 35.6, lon: 139.6 } }] } } };
  assert.equal(createKawasakiContext().resolvePositionStatic(index, row.tripId), null);
  const context = createKawasakiContext({ positionStatic: source });
  const result = context.resolvePositionStatic(index, row.tripId);
  assert.equal(result.shapeId, 'synthetic-shape'); assert.equal(result.stops.length, 3);
  assert.equal(result.stops[1].position.lat, null); assert.ok(!Object.hasOwn(result, 'complete'));
  assert.deepEqual(run({ index, providerContext: context }), run({ index }));
  for (const mutate of [s => { s.sourceVersion = 'wrong'; }, s => { s.trips[row.tripId].complete = false; },
    s => { s.trips[row.tripId].routeId = 'wrong'; }, s => { s.trips[row.tripId].stops[1].sequence = 1; },
    s => { s.trips[row.tripId].stops[1].position.lat = 999; }]) {
    const invalid = structuredClone(source); mutate(invalid);
    assert.equal(createKawasakiContext({ positionStatic: invalid }).resolvePositionStatic(index, row.tripId), null);
  }
});

test('Provider RT cache is shared across query sets, with immutable Service query snapshots', async () => {
  const stored = new Map(); let calls = 0;
  const cache = { async read(key) { return stored.get(key); }, async write(key, data) { stored.set(key, data); } };
  const base = { index: indexFixture(), providerContext: P0_INPUT.providerContext, version: 'test', now: () => NOW, cache,
    adapter: { async getRealtime() { calls++; return realtimeFixture(); } } };
  const firstQueries = [query({ id: 'first' })], service = createBusService({ ...base, queries: firstQueries });
  firstQueries[0].id = 'mutated-after-creation';
  assert.equal((await service.getArrivals()).directions[0].id, 'first');
  const next = await createBusService({ ...base, queries: [query({ ...P0_INPUT.queries[1], id: 'second' })] }).getArrivals();
  assert.equal(next.directions[0].id, 'second'); assert.equal(calls, 1);
  assert.equal(stored.size, 1);
});

test('pre-GPS RT cache schema is rejected instead of masquerading as the new internal model', async () => {
  let calls = 0;
  const old = { ...realtimeFixture(), schemaVersion: 1 };
  const service = createBusService({ index: indexFixture(), ...P0_INPUT, version: 'test', now: () => NOW,
    cache: { async read() { return old; }, async write() {} },
    adapter: { async getRealtime() { calls++; return realtimeFixture(); } } });
  assert.equal((await service.getArrivals()).fetchError, false); assert.equal(calls, 1);
  const incompatible = createBusService({ index: indexFixture(), ...P0_INPUT, version: 'test', now: () => NOW,
    adapter: { async getRealtime() { return old; } } });
  const result = await incompatible.getArrivals();
  assert.equal(result.fetchError, true); assert.equal(result.directions[0].state, 'static_fallback');
});

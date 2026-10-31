import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCommuteOnboardService, normalizeCommuteTrips, decisionStations } from '../rail/commute-onboard.js';
import { getFutureBuses } from '../journey/future-bus.js';
import { P0_QUERIES } from '../config/queries.js';
import { KAWASAKI_CONTEXT } from '../providers/kawasaki/context.js';
import { createHttpHandler } from '../http/handler.js';

const json = path => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const artifact = json('../release-static/kazu-commute-static.json');
const index = json('../generated/p0-static.json');
const at = time => Date.parse(`2026-09-30T${time}:00+09:00`) / 1000;
const metro = '2026-09-30:metro:weekday:odpt.Train:TokyoMetro.Chiyoda.A705S';
const local = '2026-09-30:odakyu:weekday:odakyu-81ff0062';
const load = ({ boardingAt, now }) => getFutureBuses({ index,
  queries: P0_QUERIES.filter(q => q.id === 'noborito_to_home'), providerContext: KAWASAKI_CONTEXT,
  now, boardingAt, limit: 100 }).results.flatMap(g => g.arrivals);
const serviceAt = (time, loadBuses = load) => createCommuteOnboardService({ artifact, clock: () => at(time), loadBuses });

test('saved provider IDs reconstruct only consistent trips; Metro is never time-joined to Odakyu', () => {
  const { trips, rejected } = normalizeCommuteTrips(artifact);
  assert.ok(trips.length > 1000); assert.ok(rejected.length > 0);
  const chiyoda = trips.find(t => t.id === metro.slice(11)), odakyu = trips.find(t => t.id === local.slice(11));
  assert.equal(chiyoda.stops.at(-1).arrival, 496);
  assert.equal(chiyoda.continuation, undefined);
  assert.equal(chiyoda.boundary.identity, 'unknown');
  assert.equal(odakyu.stops.find(s => s.station === 'SeijogakuenMae').arrival, 512);
  assert.equal(odakyu.stops.at(-1).arrival, 522);
  assert.deepEqual(decisionStations(odakyu, 480).map(s => s.id), ['SeijogakuenMae', 'Noborito']);
  assert.deepEqual(decisionStations(odakyu, 516).map(s => s.id), ['Noborito']);
});

test('real Hibiya 08:00 → Uehara 08:16: rapid at 08:24 connects; later and no-rapid paths survive', async () => {
  const result = await serviceAt('08:00').evaluate({ trainId: metro, stationId: 'YoyogiUehara' });
  const nob = result.results[0];
  const rapid = nob.routes.find(r => r.transfers === 1 && r.legs[0].trainId.endsWith('0067'));
  assert.equal(rapid.legs[0].departure, 504); assert.equal(rapid.legs[0].alightTime, 496);
  assert.equal(rapid.connection, 'likely'); assert.equal(rapid.arrival, 517);
  assert.equal(rapid.buses[0].departureTime, '08:51');
  assert.equal(rapid.buses[0].homeArrivalTime, '08:59');
  assert.equal(rapid.buses[0].walkMinutes, 8); assert.equal(rapid.buses[0].waitMinutes, 6);
  assert.ok(nob.routes.some(r => !r.usesRapidExpress && r.differenceMinutes > 0));
  assert.ok(nob.routes.every(r => r.legs.every(l => l.connection.status !== 'difficult')));
  assert.equal(result.results[1].routes.length, 0);
  assert.equal(nob.baselineArrival, null); // No invented through continuation.
  assert.equal(new Set(nob.routes.map(r => r.id)).size, nob.routes.length);
});

test('changing the decision station recomputes after arrival; passed/nonstop/unrecorded stations are rejected', async () => {
  const service = serviceAt('08:20');
  const seijo = await service.evaluate({ trainId: local, stationId: 'SeijogakuenMae' });
  assert.equal(seijo.decisionStation.arrival, '08:32');
  assert.ok(seijo.results[0].routes.every(r => r.legs.every(l => l.station !== 'YoyogiUehara' && l.alightTime >= 512)));
  assert.ok(seijo.results[0].routes.some(r => r.transfers === 0 && r.arrival === 522));
  const nob = await service.evaluate({ trainId: local, stationId: 'Noborito' });
  assert.equal(nob.results[0].routes.length, 1);
  assert.equal(nob.results[0].routes[0].transfers, 0);
  await assert.rejects(service.evaluate({ trainId: local, stationId: 'Kyodo' }));
  await assert.rejects(service.evaluate({ trainId: local.replace('2026-09-30', '2026-09-29'), stationId: 'Noborito' }));
  await assert.rejects(serviceAt('08:36').evaluate({ trainId: local, stationId: 'SeijogakuenMae' }));
  await assert.rejects(serviceAt('08:20').evaluate({ trainId: metro, stationId: 'YoyogiUehara' }));
});

test('bus failure preserves real rail comparison; stale realtime does not shift the saved 08:51 bus', async () => {
  const failed = await serviceAt('08:00', async () => { throw Error('unavailable'); })
    .evaluate({ trainId: metro, stationId: 'YoyogiUehara' });
  assert.ok(failed.results[0].routes.length > 0); assert.equal(failed.results[0].busStatus, 'unavailable');
  const stale = getFutureBuses({ index, queries: P0_QUERIES.filter(q => q.id === 'noborito_to_home'),
    providerContext: KAWASAKI_CONTEXT, now: at('08:00'), boardingAt: at('08:45'),
    realtime: { timestamp: at('07:00'), updates: [] } });
  assert.equal(stale.results[0].arrivals[0].departureTime, '08:51');
  assert.equal(stale.results[0].arrivals[0].timingQuality, 'static_only');
});

test('onboard read-only HTTP validates query keys and preserves the old commute endpoint', async () => {
  const handler = createHttpHandler(() => ({}), { kazuRouteServiceFactory: () => ({
    getTrainChoices: () => ({ trains: [] }), evaluateOnboard: async value => value,
    evaluate: async mode => ({ mode }) }) });
  const call = path => handler.fetch(new Request(`https://bus.invalid/api/bus/${path}`), { ODPT_ACCESS_TOKEN: 'test' });
  assert.equal((await call('commute-trains')).status, 200);
  assert.equal((await call('commute-trains?extra=1')).status, 404);
  assert.equal((await call(`commute-onboard?trainId=${metro}&stationId=YoyogiUehara`)).status, 200);
  assert.equal((await call(`commute-onboard?trainId=${metro}&stationId=Hibiya`)).status, 404);
  assert.equal((await call(`commute-onboard?trainId=${metro}&stationId=Noborito&stationId=Kyodo`)).status, 404);
  assert.equal((await call('commute-route?mode=hibiya')).status, 200);
});

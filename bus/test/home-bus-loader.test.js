import test from 'node:test';
import assert from 'node:assert/strict';
import { createHomeBusLoader } from '../journey/home-bus-loader.js';

test('One Provider failure leaves the other source available without inventing a bus', async () => {
  const load = createHomeBusLoader({
    'kawasaki:from_station': async () => [{ provider: 'kawasaki', queryId: 'from_station' }],
    'tokyu:from_station': async () => { throw Error('UPSTREAM_UNAVAILABLE'); }
  });
  const result = await load({ sourceIds: ['kawasaki:from_station', 'tokyu:from_station'],
    boardingAt: 100 });
  assert.equal(result.arrivals.length, 1);
  assert.deepEqual(result.sourceStates, {
    'kawasaki:from_station': 'available', 'tokyu:from_station': 'unavailable'
  });
});

test('Missing or mislabeled source is unavailable; empty valid source is available', async () => {
  const load = createHomeBusLoader({
    'kawasaki:a': async () => [],
    'tokyu:b': async () => [{ provider: 'kawasaki', queryId: 'a' }]
  });
  const result = await load({ sourceIds: ['kawasaki:a', 'tokyu:b', 'kawasaki:c'], boardingAt: 100 });
  assert.deepEqual(result.arrivals, []);
  assert.deepEqual(Object.values(result.sourceStates), ['available', 'unavailable', 'unavailable']);
});

test('Duplicate source requests fail before invoking any loader', async () => {
  let calls = 0;
  const load = createHomeBusLoader({ 'kawasaki:a': async () => { calls++; return []; } });
  await assert.rejects(load({ sourceIds: ['kawasaki:a', 'kawasaki:a'], boardingAt: 100 }),
    /HOME_BUS_QUERY_INVALID/);
  assert.equal(calls, 0);
});

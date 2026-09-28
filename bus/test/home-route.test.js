import test from 'node:test';
import assert from 'node:assert/strict';
import { compareHomeRoutes, HOME_ROUTE_TEMPLATES } from '../journey/home-route.js';

const epoch = (time) => Date.parse(`2026-09-28T${time}:00+09:00`) / 1000;
const base = { now: epoch('18:00'), selectedTrain: { id: 'selected-by-user',
  arrivals: { noborito: epoch('18:18'), mukougaoka: epoch('18:21'), musashi_mizonokuchi: epoch('18:30') } },
transferMinutes: { 'noborito-normal': 8, 'noborito-tamagawa': 11, mukougaoka: 5, mizonokuchi: 6 } };
const bus = (provider, queryId, departure, home, changes = {}) => ({ provider, queryId,
  tripId: `${provider}:${queryId}:${departure}`, routeLabel: provider === 'tokyu' ? '向０１' : '登０５',
  platform: '2番', departureAt: epoch(departure), estimatedArrival: epoch(home),
  timingQuality: 'realtime_arrival', departureState: 'scheduled', recommendable: true, ...changes });

test('University compares selected train arrivals plus separate station transfer times', async () => {
  const sources = {
    'noborito-normal': [bus('kawasaki', 'noborito_to_home', '18:31', '18:44')],
    'noborito-tamagawa': [bus('kawasaki', 'noborito_tamagawa_to_kibukihoncho', '18:32', '18:46')],
    mukougaoka: [bus('tokyu', 'mukougaoka_to_kibukihoncho', '18:27', '18:39',
      { timingQuality: 'static_only' })]
  };
  const result = await compareHomeRoutes({ ...base, journeyId: 'university',
    loadBuses: async ({ placeId }) => sources[placeId] });
  assert.equal(result.status, 'available');
  assert.equal(result.fastest.placeId, 'mukougaoka');
  assert.equal(result.fastest.homeArrivalAt, epoch('18:39'));
  assert.equal(result.fastest.timingQuality, 'static_only');
  assert.equal(result.alternate.placeId, 'noborito-normal');
  assert.equal(result.differenceMinutes, 5);
  assert.equal(result.options.find((row) => row.placeId === 'noborito-tamagawa').boardingAt, epoch('18:29'));
});

test('High school compares Noborito and Mizonokuchi without assuming a train from GPS', async () => {
  const result = await compareHomeRoutes({ ...base, journeyId: 'high_school',
    loadBuses: async ({ placeId }) => ({ 'noborito-normal': [bus('kawasaki', 'noborito_to_home', '18:31', '18:44')],
      'noborito-tamagawa': [], mizonokuchi: [bus('kawasaki', 'mizonokuchi_to_home', '18:41', '18:54')]
    })[placeId] });
  assert.deepEqual([result.fastest.placeId, result.alternate.placeId, result.differenceMinutes],
    ['noborito-normal', 'mizonokuchi', 10]);
});

test('Uncertain buses are retained as explanation but never selected as fastest', async () => {
  const result = await compareHomeRoutes({ ...base, journeyId: 'university',
    loadBuses: async ({ placeId }) => placeId === 'mukougaoka'
      ? [bus('kawasaki', 'mukougaoka_to_kibukihoncho', '18:27', '18:37',
        { departureState: 'departure_uncertain', recommendable: false })]
      : placeId === 'noborito-normal' ? [bus('kawasaki', 'noborito_to_home', '18:31', '18:44')] : [] });
  assert.equal(result.fastest.placeId, 'noborito-normal');
  assert.equal(result.alternate, null);
  assert.equal(result.options.find((row) => row.placeId === 'mukougaoka').recommendable, false);
});

test('A failed source is explicitly partial and unknown home arrival is not ranked', async () => {
  const result = await compareHomeRoutes({ ...base, journeyId: 'high_school',
    loadBuses: async ({ placeId }) => {
      if (placeId === 'mizonokuchi') throw Error('UPSTREAM_UNAVAILABLE');
      return placeId === 'noborito-normal' ? [bus('kawasaki', 'noborito_to_home', '18:31', '18:44')]
        : [bus('kawasaki', 'noborito_tamagawa_to_kibukihoncho', '18:32', '18:46',
          { estimatedArrival: null, recommendable: false })];
    } });
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.unavailablePlaces, ['mizonokuchi']);
  assert.equal(result.fastest.placeId, 'noborito-normal');
  assert.equal(result.alternate, null);
});

test('Missing transfer evidence fails before any source call', async () => {
  let calls = 0;
  await assert.rejects(compareHomeRoutes({ ...base, journeyId: 'university',
    transferMinutes: { ...base.transferMinutes, 'noborito-tamagawa': undefined },
    loadBuses: async () => { calls++; return []; } }), /HOME_ROUTE_INPUT_INVALID/);
  assert.equal(calls, 0);
  assert.equal(HOME_ROUTE_TEMPLATES.university.length, 3);
});

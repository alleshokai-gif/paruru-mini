import test from 'node:test';
import assert from 'node:assert/strict';
import { buildJrNambuStatic } from '../rail/jr-nambu-static.js';
import { listRailTrains } from '../rail/static-provider.js';
import { attachJrNambuLocations } from '../rail/jr-challenge-provider.js';
import { fetchChallengeRows, readChallengeToken } from '../rail/challenge-client.js';
import { compareHomeRoutes } from '../journey/home-route.js';

const at = (time) => Date.parse(`2026-09-28T${time}:00+09:00`) / 1000;
const row = (calendar, number, times) => ({ 'odpt:operator': 'odpt.Operator:JR-East',
  'odpt:railway': 'odpt.Railway:JR-East.Nambu',
  'odpt:railDirection': 'odpt.RailDirection:Inbound',
  'odpt:calendar': `odpt.Calendar:${calendar}`, 'odpt:trainNumber': number,
  'odpt:trainType': 'odpt.TrainType:JR-East.Rapid',
  'odpt:destinationStation': ['odpt.Station:JR-East.Nambu.Kawasaki'],
  'odpt:trainTimetableObject': ['Tachikawa', 'Noborito', 'MusashiMizonokuchi']
    .map((station, index) => ({ 'odpt:departureStation': `odpt.Station:JR-East.Nambu.${station}`,
      'odpt:departureTime': times[index] })) });
const artifact = () => buildJrNambuStatic([
  row('Weekday', '4554F', ['15:54', '16:15', '16:21']),
  row('Weekday', '2360F', ['23:44', '00:12', '00:20']),
  row('SaturdayHoliday', '5554F', ['15:56', '16:17', '16:23']),
  row('Weekday', '0900F', ['09:00', '09:21', '09:27'])
]);
const location = (changes = {}) => ({ 'odpt:operator': 'odpt.Operator:JR-East',
  'odpt:railway': 'odpt.Railway:JR-East.Nambu',
  'odpt:railDirection': 'odpt.RailDirection:Inbound', 'odpt:trainNumber': '4554F',
  'dc:date': '2026-09-28T16:00:00+09:00', 'dct:valid': '2026-09-28T16:05:00+09:00',
  'odpt:delay': 120, 'odpt:fromStation': 'odpt.Station:JR-East.Nambu.Tachikawa',
  'odpt:toStation': 'odpt.Station:JR-East.Nambu.Nishikunitachi', ...changes });

test('Challenge token is isolated from ordinary Bus token and errors reveal no credential', async () => {
  assert.equal(await readChallengeToken({ ODPT_ACCESS_TOKEN: 'ordinary-bus-token' }), null);
  assert.equal(await readChallengeToken({ ODPT_CHALLENGE_ACCESS_TOKEN: 'challenge-test-token',
    ODPT_ACCESS_TOKEN: 'ordinary-bus-token' }), 'challenge-test-token');
  let request = null;
  const rows = await fetchChallengeRows('odpt:Train', { token: 'challenge-test-token',
    fetchImpl: async (url) => { request = url; return { ok: true, json: async () => [] }; } });
  assert.deepEqual(rows, []);
  assert.equal(request.searchParams.get('odpt:railway'), 'odpt.Railway:JR-East.Nambu');
  assert.equal(request.searchParams.get('acl:consumerKey'), 'challenge-test-token');
  await assert.rejects(fetchChallengeRows('odpt:Train', { token: 'challenge-test-token',
    fetchImpl: async () => ({ ok: false, status: 403 }) }),
  (error) => error.message === 'CHALLENGE_HTTP_403'
    && !error.message.includes('challenge-test-token'));
});

test('Challenge mapper retains only after-noon trains and real departure provenance', () => {
  const built = artifact();
  assert.equal(built.trains.length, 3);
  assert.equal(built.sample, false);
  assert.equal(built.trains[0].destination, '川崎');
  assert.equal(built.trains[0].destinationStationId, 'odpt.Station:JR-East.Nambu.Kawasaki');
  const weekday = listRailTrains({ artifact: built, journeyId: 'high_school', now: at('16:00') });
  assert.equal(weekday.trains[0].trainNumber, '4554F');
  assert.deepEqual(weekday.trains[0].candidateStations.map((s) => s.station),
    ['noborito', 'musashi_mizonokuchi']);
  assert.deepEqual(weekday.trains[0].candidateStations.map((s) => s.stationTimeSource),
    ['departure', 'departure']);
  assert.equal(weekday.trains[0].stationTimes.noborito, at('16:15'));
  assert.equal(weekday.trains[0].stationTimes.musashi_mizonokuchi, at('16:21'));
  assert.match(weekday.trains[0].label, /登戸16:15発／武蔵溝ノ口16:21発/);
  assert.equal(listRailTrains({ artifact: built, journeyId: 'high_school',
    now: Date.parse('2026-10-03T16:00:00+09:00') / 1000 }).trains[0].trainNumber, '5554F');
  const night = listRailTrains({ artifact: built, journeyId: 'high_school', now: at('23:50') });
  assert.equal(night.trains[0].stationTimes.noborito,
    Date.parse('2026-09-29T00:12:00+09:00') / 1000);
});

test('reverse order, duplicate train and absent published time fail closed', () => {
  const rows = [row('Weekday', '4554F', ['15:54', '16:15', '16:21']),
    row('SaturdayHoliday', '5554F', ['15:56', '16:17', '16:23'])];
  assert.throws(() => buildJrNambuStatic([rows[0], rows[0], rows[1]]), /JR_NAMBU_STATIC_INVALID/);
  assert.throws(() => buildJrNambuStatic([row('Weekday', '4554F', ['15:54', '16:21', '16:15']), rows[1]]),
    /JR_NAMBU_STATIC_INVALID/);
  assert.throws(() => buildJrNambuStatic([row('Weekday', '4554F', ['15:54', null, '16:21']), rows[1]]),
    /JR_NAMBU_STATIC_INVALID/);
});

test('exact unique fresh train number joins position and confirmed delay', () => {
  const train = listRailTrains({ artifact: artifact(), journeyId: 'high_school', now: at('16:00') }).trains[0];
  const [matched] = attachJrNambuLocations([train], [location()], at('16:01'));
  assert.equal(matched.railRealtimeState, 'confirmed_delay');
  assert.equal(matched.delaySeconds, 120);
  assert.equal(matched.effectiveStationTimes.noborito, at('16:17'));
  assert.equal(matched.position.toStation, 'odpt.Station:JR-East.Nambu.Nishikunitachi');
  const [onTime] = attachJrNambuLocations([train], [location({ 'odpt:delay': 0 })], at('16:01'));
  assert.equal(onTime.delaySeconds, 0);
  assert.equal(onTime.effectiveStationTimes.noborito, train.stationTimes.noborito);
  for (const [rows, now, reason] of [
    [[], at('16:01'), 'unmatched'],
    [[location(), location()], at('16:01'), 'ambiguous'],
    [[location()], at('16:10'), 'stale'],
    [[location({ 'odpt:delay': null })], at('16:01'), 'invalid_delay']
  ]) {
    const [fallback] = attachJrNambuLocations([train], rows, now);
    assert.equal(fallback.railRealtimeState, 'static_fallback');
    assert.equal(fallback.railRealtimeReason, reason);
    assert.equal(fallback.effectiveStationTimes, null);
  }
});

test('Home Route Core uses departure marker plus confirmed delay as an estimate', async () => {
  const train = listRailTrains({ artifact: artifact(), journeyId: 'high_school', now: at('16:00') }).trains[0];
  const [selectedTrain] = attachJrNambuLocations([train], [location()], at('16:01'));
  const sourceIds = {
    'noborito-normal': 'kawasaki:noborito_to_home',
    'noborito-tamagawa': 'kawasaki:noborito_tamagawa_to_kibukihoncho',
    mizonokuchi: 'kawasaki:mizonokuchi_to_home'
  };
  const result = await compareHomeRoutes({ journeyId: 'high_school', selectedTrain,
    now: at('16:01'), transferMinutes: { 'noborito-normal': 8,
      'noborito-tamagawa': 11, mizonokuchi: 6 },
    loadBuses: async ({ placeId, boardingAt }) => ({
      sourceStates: { [sourceIds[placeId]]: 'available' },
      arrivals: [{ provider: 'kawasaki', queryId: sourceIds[placeId].split(':')[1],
        tripId: placeId, routeLabel: '登０５', platform: '2番',
        departureAt: boardingAt + 60, estimatedArrival: boardingAt + 900,
        timingQuality: 'static_only', departureState: 'scheduled', recommendable: true }]
    }) });
  assert.equal(result.status, 'available');
  assert.equal(result.options.find((o) => o.stationId === 'noborito').boardingAt, at('16:25'));
  assert.ok(result.options.every((o) => o.stationTimeSource === 'departure'
    && o.stationArrivalAt === null && o.railTimingQuality === 'delay_projection'));
});

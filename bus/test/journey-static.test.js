import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { buildP2_5KawasakiStatic } from '../scripts/p2-5-kawasaki-static.js';
import { mergeKawasakiStatic, validateKawasakiJourneyArtifact } from '../providers/kawasaki/journey-static.js';
import { indexFixture, NOW } from './fixtures.js';

const csv = (rows) => strToU8(rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(','))
  .join('\r\n'));

function journeyZip() {
  return zipSync({
    'agency.txt': csv([['agency_timezone'], ['Asia/Tokyo']]),
    'stops.txt': csv([['stop_id', 'stop_name', 'location_type'], ['474_5', '向丘遊園駅南口', 0],
      ['184_1', '神木本町', 0], ['999_1', '対象外', 0]]),
    'routes.txt': csv([['route_id', 'route_short_name'], ['10037', '溝１９']]),
    'trips.txt': csv([['trip_id', 'route_id', 'service_id', 'trip_headsign', 'direction_id'],
      ['through-kibuki', '10037', 'weekday', '溝口駅南口(おし沼)', 0],
      ['not-through-kibuki', '10037', 'weekday', '対象外', 0]]),
    'stop_times.txt': csv([['trip_id', 'stop_sequence', 'stop_id', 'departure_time', 'pickup_type', 'drop_off_type', 'stop_headsign'],
      ['through-kibuki', 1, '474_5', '07:00:00', 0, 0, '溝口駅南口(おし沼)'],
      ['through-kibuki', 12, '184_1', '07:20:00', 0, 0, '溝口駅南口(おし沼)'],
      ['not-through-kibuki', 1, '474_5', '07:10:00', 0, 0, '対象外'],
      ['not-through-kibuki', 2, '999_1', '07:15:00', 0, 0, '対象外']]),
    'calendar.txt': csv([['service_id', 'start_date', 'end_date', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
      ['weekday', '20260101', '20261231', 1, 1, 1, 1, 1, 0, 0]]),
    'calendar_dates.txt': csv([['service_id', 'date', 'exception_type']]),
    'feed_info.txt': csv([['feed_version', 'feed_start_date', 'feed_end_date'], ['synthetic', '20260101', '20261231']])
  });
}

test('P2.5 Kawasaki builder retains only 474_5 to 184_1 trips with the verified route and platform', () => {
  const artifact = buildP2_5KawasakiStatic(journeyZip(), { now: NOW, sourceDate: '20260828' });
  validateKawasakiJourneyArtifact(artifact, '20260828');
  const rows = artifact.directions.mukougaoka_to_kibukihoncho;
  assert.equal(rows.length, 1); assert.equal(rows[0].tripId, 'through-kibuki');
  assert.deepEqual([rows[0].fromStopId, rows[0].toStopId, rows[0].routeId, rows[0].platform],
    ['474_5', '184_1', '10037', '5番']);
  assert.equal(rows[0].directionId, '0'); assert.equal(rows[0].headsign, '溝口駅南口(おし沼)');
  assert.ok(!JSON.stringify(artifact).includes('not-through-kibuki'));
});

test('P0 and P2.5 Static merge requires the exact same feed and preserves P0 directions', () => {
  const primary = { ...indexFixture(), sourceHash: 'a'.repeat(64), sourceVersion: 'synthetic' };
  const extension = { ...primary, directions: { mukougaoka_to_kibukihoncho: [{ tripId: 'new' }] },
    stops: { ...primary.stops, '474_5': { stopId: '474_5', name: '向丘遊園駅南口' } } };
  const merged = mergeKawasakiStatic(primary, extension);
  assert.deepEqual(Object.keys(merged.directions).sort(),
    [...Object.keys(primary.directions), 'mukougaoka_to_kibukihoncho'].sort());
  assert.equal(merged.stops['474_5'].name, '向丘遊園駅南口');
  assert.throws(() => mergeKawasakiStatic(primary, { ...extension, sourceHash: 'b'.repeat(64) }),
    /BUS_KAWASAKI_JOURNEY_SOURCE_MISMATCH/);
});

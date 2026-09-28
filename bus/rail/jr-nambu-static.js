import { validateRailStatic } from './static-provider.js';

const OPERATOR = 'odpt.Operator:JR-East';
const RAILWAY = 'odpt.Railway:JR-East.Nambu';
const DIRECTION = 'odpt.RailDirection:Inbound';
const STATIONS = Object.freeze([
  ['Tachikawa', 'tachikawa'], ['Noborito', 'noborito'],
  ['MusashiMizonokuchi', 'musashi_mizonokuchi']
]);
const CALENDARS = Object.freeze({
  'odpt.Calendar:Weekday': 'weekday',
  'odpt.Calendar:SaturdayHoliday': 'weekend'
});
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const NUMBER = /^[0-9A-Za-z-]+$/;
const DESTINATIONS = Object.freeze({ Kawasaki: '川崎', MusashiNakahara: '武蔵中原' });
const fail = () => { throw Error('JR_NAMBU_STATIC_INVALID'); };
const suffix = (value, key) => typeof value === 'string' && value.endsWith(`.${key}`);

// Only the three published departure markers are used. No arrival is inferred.
export function buildJrNambuStatic(rows, { generatedAt = new Date().toISOString(),
  sourceCheckedAt = generatedAt } = {}) {
  if (!Array.isArray(rows) || !rows.length) fail();
  const trains = [], ids = new Set();
  for (const row of rows) {
    if (row?.['odpt:operator'] !== OPERATOR || row['odpt:railway'] !== RAILWAY
      || row['odpt:railDirection'] !== DIRECTION) continue;
    const calendarType = CALENDARS[row['odpt:calendar']];
    if (!calendarType) continue;
    const objects = row['odpt:trainTimetableObject'];
    if (!Array.isArray(objects)) fail();
    const indexes = STATIONS.map(([name]) => objects.findIndex((object) =>
      suffix(object?.['odpt:departureStation'], name)));
    if (indexes.some((index) => index < 0)) continue;
    if (!(indexes[0] < indexes[1] && indexes[1] < indexes[2])) fail();
    const times = indexes.map((index) => objects[index]['odpt:departureTime']);
    if (!times.every((time) => TIME.test(time))) fail();
    if (times[0] < '12:00') continue;
    const ordered = times.map((time, index) => Number(time.slice(0, 2)) * 60
      + Number(time.slice(3)) + (index > 0 && time < times[0] ? 1440 : 0));
    if (!(ordered[0] < ordered[1] && ordered[1] < ordered[2])
      || ordered[2] - ordered[0] > 120) fail();
    const trainNumber = row['odpt:trainNumber'];
    if (typeof trainNumber !== 'string' || !NUMBER.test(trainNumber)) fail();
    const id = `${calendarType}:${trainNumber}`;
    if (ids.has(id)) fail();
    ids.add(id);
    const typeId = row['odpt:trainType'];
    const trainType = suffix(typeId, 'Rapid') ? '快速' : suffix(typeId, 'Local') ? '各駅停車' : null;
    if (!trainType) fail();
    const destinationId = row['odpt:destinationStation'];
    if (!Array.isArray(destinationId) || destinationId.length !== 1
      || typeof destinationId[0] !== 'string') fail();
    const destinationCode = destinationId[0].split('.').at(-1);
    const destination = DESTINATIONS[destinationCode];
    if (!destination) fail();
    trains.push({ provider: 'jr_east', route: 'tachikawa_to_mizonokuchi', railway: RAILWAY,
      calendarType, sourceStation: 'tachikawa', sourceDeparture: times[0], trainNumber,
      trainType, destination, destinationStationId: destinationId[0],
      internalTripId: `jr-nambu-${calendarType}-${trainNumber}`,
      candidateStations: STATIONS.slice(1).map(([, station], index) => ({
        station, stationTime: times[index + 1], stationTimeSource: 'departure'
      })) });
  }
  if (!trains.length || !trains.some((row) => row.calendarType === 'weekday')
    || !trains.some((row) => row.calendarType === 'weekend')) fail();
  trains.sort((a, b) => a.calendarType.localeCompare(b.calendarType)
    || a.sourceDeparture.localeCompare(b.sourceDeparture)
    || a.trainNumber.localeCompare(b.trainNumber));
  const artifact = { schemaVersion: 1, timezone: 'Asia/Tokyo', management: 'challenge_generated',
    sample: false, timetableVersion: 'jr-east-nambu-challenge-2026', generatedAt,
    sourceCheckedAt, sourceMetadata: { operator: OPERATOR, railway: RAILWAY,
      endpoint: 'odpt:TrainTimetable', stationTimeSource: 'departure',
      serviceCalendars: ['weekday', 'weekend'], earliestSourceDeparture: '12:00' },
    calendarOverrides: {}, trains };
  validateRailStatic(artifact);
  return artifact;
}

export const JR_NAMBU_IDS = Object.freeze({ operator: OPERATOR, railway: RAILWAY,
  direction: DIRECTION });

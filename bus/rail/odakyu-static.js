import { validateRailStatic } from './static-provider.js';

const OPERATOR = 'odpt.Operator:Odakyu';
const RAILWAY = 'odpt.Railway:Odakyu.Odawara';
const STATION = 'odpt.Station:Odakyu.Odawara.TamagawagakuenMae';
const DIRECTION = 'odpt.RailDirection:Inbound';
const CALENDARS = Object.freeze({
  'odpt.Calendar:Weekday': 'weekday',
  'odpt.Calendar:SaturdayHoliday': 'weekend'
});
const TYPES = Object.freeze({ 'odpt.TrainType:Odakyu.Local': '各停' });
const DESTINATIONS = Object.freeze({
  'odpt.Station:Odakyu.Odawara.Shinjuku': '新宿',
  'odpt.Station:Odakyu.Odawara.SeijogakuenMae': '成城学園前',
  'odpt.Station:Odakyu.Odawara.MukogaokaYuen': '向ヶ丘遊園'
});
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const fail = () => { throw Error('ODAKYU_STATIC_INVALID'); };

// These are links exposed by the official Odakyu station timetable UI, not an internal API.
export function extractOdakyuDetailLinks(html) {
  if (typeof html !== 'string' || !html.includes('StopListDiagram')) fail();
  const links = [], seen = new Map();
  for (const match of html.matchAll(/window\.open\("([^"\n]*StopListDiagram[^"\n]+)"/g)) {
    const url = new URL(match[1].replaceAll('&amp;', '&'), 'https://transfer.navitime.biz');
    if (url.origin !== 'https://transfer.navitime.biz'
      || url.pathname !== '/odakyu-transit/smart/diagram/StopListDiagram') fail();
    const dateTime = url.searchParams.get('datetime');
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00$/.test(dateTime)) fail();
    const sourceDeparture = dateTime.slice(11, 16);
    if (sourceDeparture < '12:00') continue;
    const day = new Date(`${dateTime.slice(0, 10)}T00:00:00Z`).getUTCDay();
    const calendarType = day === 0 || day === 6 ? 'weekend' : 'weekday';
    const key = `${calendarType}:${sourceDeparture}`;
    if (seen.has(key)) {
      if (seen.get(key) !== url.href) fail();
      continue; // The public page repeats the identical holiday links in two tabs.
    }
    seen.set(key, url.href);
    links.push({ calendarType, sourceDeparture, url: url.href });
  }
  if (!links.some((link) => link.calendarType === 'weekday')
    || !links.some((link) => link.calendarType === 'weekend')) fail();
  return links;
}

export function extractOdakyuDetail(html, link) {
  if (typeof html !== 'string' || !link || !TIME.test(link.sourceDeparture)) fail();
  const title = html.match(/(\d{2}:\d{2})発\s*([^<\s]+)行/);
  if (!title || title[1] !== link.sourceDeparture) fail();
  const station = (name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = html.match(new RegExp(`<div class="name">\\s*${escaped}\\s*</div>[\\s\\S]{0,500}?<div class="time">\\s*(\\d{2}:\\d{2})<span class="landing">\\s*([着発])`));
    if (!match || !TIME.test(match[1])) return null;
    return { stationTime: match[1], stationTimeSource: match[2] === '着' ? 'arrival' : 'departure' };
  };
  return {
    calendarType: link.calendarType, sourceDeparture: link.sourceDeparture,
    destination: title[2], mukougaoka: station('向ヶ丘遊園'), noborito: station('登戸')
  };
}

export function buildOdakyuStatic(rows, details, { generatedAt = new Date().toISOString(),
  sourceCheckedAt = generatedAt } = {}) {
  if (!Array.isArray(rows) || !rows.length || !Array.isArray(details) || !details.length) fail();
  const source = rows.filter((row) => row?.['odpt:operator'] === OPERATOR
    && row['odpt:railway'] === RAILWAY && row['odpt:station'] === STATION
    && row['odpt:railDirection'] === DIRECTION && CALENDARS[row['odpt:calendar']]);
  if (source.length !== 2 || new Set(source.map((row) => row['odpt:calendar'])).size !== 2) fail();
  const detailByKey = new Map();
  for (const detail of details) {
    const key = `${detail.calendarType}:${detail.sourceDeparture}`;
    if (detailByKey.has(key)) fail();
    detailByKey.set(key, detail);
  }
  const trains = [], used = new Set(), skippedTerminating = [];
  for (const row of source) {
    const calendarType = CALENDARS[row['odpt:calendar']];
    if (!Array.isArray(row['odpt:stationTimetableObject'])) fail();
    for (const object of row['odpt:stationTimetableObject']) {
      const sourceDeparture = object?.['odpt:departureTime'];
      if (!TIME.test(sourceDeparture)) fail();
      if (sourceDeparture < '12:00') continue;
      const key = `${calendarType}:${sourceDeparture}`;
      const detail = detailByKey.get(key);
      if (!detail || used.has(key)) fail();
      used.add(key);
      const trainType = TYPES[object['odpt:trainType']];
      const destinationId = object['odpt:destinationStation'];
      if (!trainType || !Array.isArray(destinationId) || destinationId.length !== 1
        || !DESTINATIONS[destinationId[0]]) fail();
      const destination = DESTINATIONS[destinationId[0]];
      if (detail.destination !== destination || !detail.mukougaoka) fail();
      // A train terminating at Mukougaoka cannot be compared at Noborito.
      if (destination === '向ヶ丘遊園' && detail.noborito === null) {
        skippedTerminating.push(key);
        continue;
      }
      if (!detail.noborito) fail();
      trains.push({ provider: 'odakyu', route: 'tamagawa_to_noborito',
        calendarType, sourceStation: 'tamagawagakuenmae', sourceDeparture,
        trainType, destination, internalTripId: `odakyu-${calendarType}-${sourceDeparture.replace(':', '')}`,
        candidateStations: [
          { station: 'mukougaoka', ...detail.mukougaoka },
          { station: 'noborito', ...detail.noborito }
        ] });
    }
  }
  if (used.size !== details.length || !trains.some((train) => train.calendarType === 'weekday')
    || !trains.some((train) => train.calendarType === 'weekend')) fail();
  trains.sort((a, b) => a.calendarType.localeCompare(b.calendarType)
    || a.sourceDeparture.localeCompare(b.sourceDeparture));
  const checkedDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo',
    year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(sourceCheckedAt));
  const artifact = { schemaVersion: 1, timezone: 'Asia/Tokyo', management: 'user',
    sample: false, timetableVersion: `odakyu-official-checked-${checkedDate}`, generatedAt,
    sourceCheckedAt, sourceMetadata: {
      departureSource: 'ODPT Challenge 2026 StationTimetable',
      stationTimeSource: 'Odakyu official train stop detail (displayed arrival/departure)',
      sourcePage: 'https://www.odakyu.jp/station/tamagawagakuen_mae/timetable/up/',
      earliestSourceDeparture: '12:00', skippedTerminating
    }, calendarOverrides: {}, trains };
  validateRailStatic(artifact);
  return artifact;
}

export const ODAKYU_IDS = Object.freeze({ operator: OPERATOR, railway: RAILWAY,
  station: STATION, direction: DIRECTION });

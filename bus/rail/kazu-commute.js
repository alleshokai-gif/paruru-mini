const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const CALENDAR = Object.freeze({ 'odpt.Calendar:Weekday': 'weekday',
  'odpt.Calendar:SaturdayHoliday': 'weekend' });
const fail = () => { throw Error('KAZU_RAIL_STATIC_INVALID'); };
const TRAIN_TYPES = Object.freeze({ Local: '各停', Rapid: '快速', Express: '急行',
  SemiExpress: '準急', CommuterExpress: '通勤急行', LimitedExpress: '特急',
  CommuterRapid: '通勤快速' });

// Fixed family corridor legs, not a general route-search graph.
export const KAZU_SEGMENTS = Object.freeze({
  chiyoda: ['TokyoMetro.Chiyoda.Hibiya', 'TokyoMetro.Chiyoda.YoyogiUehara'],
  mita_jimbocho: ['Toei.Mita.Hibiya', 'Toei.Mita.Jimbocho'],
  hanzomon: ['TokyoMetro.Hanzomon.Jimbocho', 'TokyoMetro.Hanzomon.Shibuya'],
  mita_meguro: ['Toei.Mita.Hibiya', 'Toei.Mita.Meguro'],
  keihin_tohoku: ['JR-East.KeihinTohokuNegishi.Tamachi', 'JR-East.KeihinTohokuNegishi.Oimachi'],
  odakyu_uehara_noborito: ['yoyogiuehara', 'noborito'],
  odakyu_uehara_seijo: ['yoyogiuehara', 'seijogakuenmae'],
  odakyu_seijo_noborito: ['seijogakuenmae', 'noborito'],
  denentoshi: ['shibuya', 'mizonokuchi'],
  meguro: ['meguro', 'ookayama'],
  oimachi_from_ookayama: ['ookayama', 'mizonokuchi'],
  oimachi_from_oimachi: ['oimachi', 'mizonokuchi']
});
export const KAZU_MODES = Object.freeze(['hibiya', 'tamachi', 'pharmacy']);

export function minutes(value) {
  if (!TIME.test(value)) fail();
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}

export function validateKazuStatic(artifact) {
  if (artifact?.schemaVersion !== 1 || artifact.timezone !== 'Asia/Tokyo'
    || artifact.sample !== false || !Array.isArray(artifact.legs)
    || !artifact.legs.length || typeof artifact.sourceCheckedAt !== 'string') fail();
  const seen = new Set();
  for (const leg of artifact.legs) {
    if (!KAZU_SEGMENTS[leg.segment] || !['weekday', 'weekend'].includes(leg.calendarType)
      || !TIME.test(leg.departure) || !TIME.test(leg.stationTime)
      || !['arrival', 'departure'].includes(leg.stationTimeSource)
      || !leg.trainId || !leg.trainType || !leg.destination || !leg.source
      || (minutes(leg.stationTime) - minutes(leg.departure) + 1440) % 1440 === 0
      || (minutes(leg.stationTime) - minutes(leg.departure) + 1440) % 1440 > 120) fail();
    const key = `${leg.segment}:${leg.calendarType}:${leg.trainId}`;
    if (seen.has(key)) fail();
    seen.add(key);
  }
  return artifact;
}

const station = (object, kind, name) => String(object?.[`odpt:${kind}Station`] || '').endsWith(`.${name}`);

export function extractOdptLegs(rows, segment, { earliest = '00:00' } = {}) {
  const endpoints = KAZU_SEGMENTS[segment];
  if (!endpoints || !Array.isArray(rows)) fail();
  const [from, to] = endpoints.map((id) => id.split('.').at(-1));
  const result = [];
  for (const row of rows) {
    const calendarType = CALENDAR[row?.['odpt:calendar']];
    const stops = row?.['odpt:trainTimetableObject'];
    if (!calendarType || !Array.isArray(stops)) continue;
    const fromIndex = stops.findIndex((item) => station(item, 'departure', from));
    const toIndex = stops.findIndex((item, index) => index > fromIndex
      && (station(item, 'arrival', to) || station(item, 'departure', to)));
    if (fromIndex < 0 || toIndex < 0) continue;
    const departure = stops[fromIndex]['odpt:departureTime'];
    const target = stops[toIndex];
    const stationTimeSource = TIME.test(target['odpt:arrivalTime']) ? 'arrival' : 'departure';
    const stationTime = target[`odpt:${stationTimeSource}Time`];
    if (!TIME.test(departure) || !TIME.test(stationTime)) fail();
    const travel = (minutes(stationTime) - minutes(departure) + 1440) % 1440;
    if (departure < earliest || travel === 0 || travel > 120) continue;
    const trainId = row['odpt:train'] || `${row['odpt:operator']}:${row['odpt:trainNumber']}`;
    if (!trainId || typeof trainId !== 'string') fail();
    const typeKey = String(row['odpt:trainType'] || '').split('.').at(-1);
    result.push({ segment, calendarType, departure, stationTime, stationTimeSource,
      trainId, trainType: TRAIN_TYPES[typeKey] || (typeKey || '種別未提供'),
      destination: String(row['odpt:destinationStation']?.[0] || '').split('.').at(-1) || '行先未提供',
      source: 'odpt:TrainTimetable' });
  }
  return result;
}

// The public train-detail page identifies one train. Never pair nearby times.
export function extractOfficialStops(html) {
  if (typeof html !== 'string') fail();
  const stops = [];
  for (const match of html.matchAll(/<div class="stop-info[^\"]*"[^>]*>\s*<div class="name">([^<]+)<\/div>([\s\S]*?)(?=<div class="stop-info|<\/section>|$)/g)) {
    for (const value of match[2].matchAll(/<span aria-hidden="true">(\d{2}:\d{2})<\/span>\s*<span class="landing" aria-hidden="true">([着発])<\/span>/g))
      stops.push({ name: match[1].trim(), time: value[1],
        source: value[2] === '着' ? 'arrival' : 'departure' });
  }
  if (!stops.length) for (const value of html.matchAll(/<div class="name">\s*([^<]+)<\/div>[\s\S]{0,400}?<div class="time">\s*(\d{2}:\d{2})<span class="landing">\s*([着発])/g))
    stops.push({ name: value[1].trim(), time: value[2],
      source: value[3] === '着' ? 'arrival' : 'departure' });
  if (!stops.length) fail();
  return stops;
}

export function officialLeg({ segment, calendarType, trainId, trainType, destination,
  stops, fromName, toName, source, departureOverride = null }) {
  const fromIndex = stops.findIndex((stop) => stop.name === fromName
    && (departureOverride !== null || stop.source === 'departure'));
  const toIndex = stops.findIndex((stop, index) => index > fromIndex && stop.name === toName);
  if (fromIndex < 0 || toIndex < 0 || departureOverride !== null && !TIME.test(departureOverride)) return null;
  if (departureOverride !== null) {
    const dwell = (minutes(departureOverride) - minutes(stops[fromIndex].time) + 1440) % 1440;
    if (dwell > 5) return null;
  }
  return { segment, calendarType, trainId, trainType, destination,
    departure: departureOverride ?? stops[fromIndex].time, stationTime: stops[toIndex].time,
    stationTimeSource: stops[toIndex].source, source };
}

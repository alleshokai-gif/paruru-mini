// Offline, bounded Static update. Credentials remain in this process; the artifact contains only times.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extractOdptLegs, extractOfficialStops, officialLeg, minutes,
  validateKazuStatic } from '../rail/kazu-commute.js';

const OUTPUT = fileURLToPath(new URL('../release-static/kazu-commute-static.json', import.meta.url));
const WEB_BASE = 'https://transfer.navitime.biz';
const DATES = Object.freeze({ weekday: '2026-09-30', weekend: '2026-10-04' });
const ODPT = Object.freeze([
  { segment: 'chiyoda', operator: 'TokyoMetro', railway: 'TokyoMetro.Chiyoda' },
  { segment: 'mita_jimbocho', operator: 'Toei', railway: 'Toei.Mita' },
  { segment: 'mita_meguro', operator: 'Toei', railway: 'Toei.Mita' },
  { segment: 'hanzomon', operator: 'TokyoMetro', railway: 'TokyoMetro.Hanzomon' },
  { segment: 'keihin_tohoku', operator: 'JR-East', railway: 'JR-East.KeihinTohokuNegishi', challenge: true }
]);
const TOKYU = Object.freeze([
  { station: '大井町', code: '00005517', route: '00000787',
    legs: [['oimachi_from_oimachi', '大井町', '溝の口〔東急線〕']] },
  { station: '大岡山', code: '00005529', route: '00000787',
    legs: [['oimachi_from_ookayama', '大岡山', '溝の口〔東急線〕']] },
  { station: '渋谷', code: '00003544', route: '00000789',
    legs: [['denentoshi', '渋谷', '溝の口〔東急線〕']] },
  { station: '目黒', code: '00008684', route: '00000791',
    legs: [['meguro', '目黒', '大岡山']] }
]);
const clean = (text) => text.replace(/\s+/g, ' ').trim();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function read(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000),
    headers: { 'User-Agent': 'PALURU family timetable static updater' } });
  if (!response.ok) throw Error(`KAZU_SOURCE_HTTP_${response.status}`);
  return response;
}
async function bounded(items, worker) {
  const result = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      result[index] = await worker(items[index]);
      await delay(80);
    }
  }));
  return result.flat();
}
function detailUrl(raw, prefix) {
  const url = new URL(raw.replaceAll('&amp;', '&'), WEB_BASE);
  if (url.origin !== WEB_BASE || !url.pathname.startsWith(prefix)) throw Error('KAZU_SOURCE_URL_INVALID');
  return url;
}
async function odptLegs() {
  const groups = new Map();
  const output = [];
  for (const config of ODPT) {
    const key = `${config.operator}:${config.railway}`;
    if (!groups.has(key)) {
      const rows = [];
      for (const calendar of ['Weekday', 'SaturdayHoliday']) {
        const token = config.challenge ? process.env.ODPT_CHALLENGE_ACCESS_TOKEN : process.env.ODPT_ACCESS_TOKEN;
        if (!token || /\s/.test(token)) throw Error('KAZU_CREDENTIAL_UNAVAILABLE');
        const url = new URL(config.challenge
          ? 'https://api-challenge.odpt.org/api/v4/odpt:TrainTimetable'
          : 'https://api.odpt.org/api/v4/odpt:TrainTimetable');
        url.searchParams.set('odpt:operator', `odpt.Operator:${config.operator}`);
        url.searchParams.set('odpt:railway', `odpt.Railway:${config.railway}`);
        url.searchParams.set('odpt:calendar', `odpt.Calendar:${calendar}`);
        url.searchParams.set('acl:consumerKey', token);
        const data = await (await read(url)).json();
        if (!Array.isArray(data) || !data.length) throw Error('KAZU_ODPT_EMPTY');
        rows.push(...data);
      }
      groups.set(key, rows);
    }
    output.push(...extractOdptLegs(groups.get(key), config.segment));
  }
  return output;
}
async function tokyuLegs() {
  const output = [];
  for (const config of TOKYU) for (const [calendarType, date] of Object.entries(DATES)) {
    const url = new URL('/tokyu/pc/diagram/TrainDiagram', WEB_BASE);
    url.searchParams.set('rrCd', config.route);
    url.searchParams.set('stCd', config.code);
    url.searchParams.set('updown', '1');
    url.searchParams.set('datetime', `${date}T17:00:00`);
    const page = await (await read(url)).text();
    const links = [...page.matchAll(/href="([^"]*TrainRouteTimetable\?[^"]+)"/g)]
      .map((match) => detailUrl(match[1], '/tokyu/pc/diagram/TrainRouteTimetable'))
      .filter((item) => item.searchParams.get('year') === date.slice(0, 4)
        && item.searchParams.get('month') === date.slice(5, 7)
        && item.searchParams.get('day') === date.slice(8, 10)
        && item.searchParams.get('stCd') === config.code);
    const unique = [...new Map(links.map((item) => [item.href, item])).values()];
    if (!unique.length || unique.length > 400) throw Error('KAZU_TOKYU_LINKS_INVALID');
    const found = await bounded(unique, async (item) => {
      const stops = extractOfficialStops(await (await read(item)).text());
      const trainId = `tokyu-${config.route}-${item.searchParams.get('trCd')}`;
      const trainType = decodeURIComponent(item.searchParams.get('kind') || '').replace(/^東急[^線]+線/, '') || '各停';
      const destination = clean((await Promise.resolve(stops.at(-1)?.name)) || '行先未提供');
      return config.legs.map(([segment, fromName, toName]) => officialLeg({
        segment, calendarType, trainId, trainType, destination, stops, fromName, toName,
        source: 'Tokyu official train detail',
        departureOverride: `${item.searchParams.get('hour')}:${item.searchParams.get('minutes')}` })).filter(Boolean);
    });
    output.push(...found);
  }
  return output;
}
async function odakyuLegs() {
  const url = new URL('/odakyu-transit/smart/diagram/Search', WEB_BASE);
  for (const [key, value] of Object.entries({ startId: '00005508', linkId: '00000686',
    direction: 'down', nodeType: 'train', initDispWeekdayTab: 'weekday' })) url.searchParams.set(key, value);
  const page = await (await read(url)).text();
  const seijoUrl = new URL(url);
  seijoUrl.searchParams.set('startId', '00004633');
  const seijoPage = await (await read(seijoUrl)).text();
  const seijoByTrain = new Map([...seijoPage.matchAll(/window\.open\("([^"\n]*StopListDiagram[^"\n]+)"/g)]
    .map((match) => detailUrl(match[1], '/odakyu-transit/smart/diagram/StopListDiagram'))
    .map((item) => [`${item.searchParams.get('datetime')?.slice(0, 10)}:${item.searchParams.get('tCode')}`,
      item.searchParams.get('datetime')?.slice(11, 16)]));
  const links = [...page.matchAll(/window\.open\("([^"\n]*StopListDiagram[^"\n]+)"/g)]
    .map((match) => detailUrl(match[1], '/odakyu-transit/smart/diagram/StopListDiagram'))
    .filter((item) => Object.values(DATES).includes(item.searchParams.get('datetime')?.slice(0, 10)));
    const unique = [...new Map(links.map((item) => [item.href, item])).values()];
  if (!unique.length || unique.length > 1000) throw Error('KAZU_ODAKYU_LINKS_INVALID');
  return bounded(unique, async (item) => {
    const stops = extractOfficialStops(await (await read(item)).text());
    const calendarType = item.searchParams.get('datetime').slice(0, 10) === DATES.weekday
      ? 'weekday' : 'weekend';
    const trainId = `odakyu-${item.searchParams.get('tCode')}`;
    const trainType = decodeURIComponent(item.searchParams.get('kind') || '').replace(/^小田急小田原線/, '') || '各停';
    const destination = stops.at(-1)?.name || '行先未提供';
    const ueharaDeparture = item.searchParams.get('datetime')?.slice(11, 16);
    const seijoDeparture = seijoByTrain.get(`${item.searchParams.get('datetime')?.slice(0, 10)}:${item.searchParams.get('tCode')}`);
    return [
      ['odakyu_uehara_noborito', '代々木上原', '登戸', ueharaDeparture],
      ['odakyu_uehara_seijo', '代々木上原', '成城学園前', ueharaDeparture],
      ['odakyu_seijo_noborito', '成城学園前', '登戸', seijoDeparture]
    ].filter((entry) => entry[3]).map(([segment, fromName, toName, departureOverride]) =>
      officialLeg({ segment, calendarType, trainId, trainType, destination, stops,
        fromName, toName, departureOverride, source: 'Odakyu official train detail' })).filter(Boolean);
  });
}

const collected = [...await odptLegs(), ...await tokyuLegs(), ...await odakyuLegs()];
const legs = [...new Map(collected.map((leg) => [`${leg.segment}:${leg.calendarType}:${leg.trainId}`, leg])).values()]
  .sort((a, b) => a.segment.localeCompare(b.segment) || a.calendarType.localeCompare(b.calendarType)
    || a.departure.localeCompare(b.departure) || a.trainId.localeCompare(b.trainId));
const invalidTimes = legs.filter((leg) => {
  const travel = (minutes(leg.stationTime) - minutes(leg.departure) + 1440) % 1440;
  return travel === 0 || travel > 120;
});
if (invalidTimes.length) throw Error(`KAZU_STATIC_TIME_INVALID:${JSON.stringify(invalidTimes.slice(0, 8)
  .map((leg) => ({ segment: leg.segment, calendarType: leg.calendarType,
    departure: leg.departure, stationTime: leg.stationTime })))}`);
const artifact = validateKazuStatic({ schemaVersion: 1, timezone: 'Asia/Tokyo', sample: false,
  sourceCheckedAt: new Date().toISOString(), sourceDates: DATES,
  sources: ['ODPT TrainTimetable', 'Tokyu official train detail', 'Odakyu official train detail'], legs });
const missing = Object.keys(DATES).flatMap((calendarType) =>
  [...new Set(ODPT.map((row) => row.segment).concat(TOKYU.flatMap((row) => row.legs.map((leg) => leg[0])),
    ['odakyu_uehara_noborito', 'odakyu_uehara_seijo', 'odakyu_seijo_noborito']))]
    .filter((segment) => !legs.some((leg) => leg.segment === segment && leg.calendarType === calendarType))
    .map((segment) => `${segment}:${calendarType}`));
if (missing.length) throw Error(`KAZU_STATIC_COVERAGE_MISSING:${missing.join(',')}`);
let prior = null;
try { prior = JSON.parse(await readFile(OUTPUT, 'utf8')); } catch { /* first build */ }
const content = `${JSON.stringify(artifact, null, 2)}\n`;
if (prior && JSON.stringify(prior.legs) === JSON.stringify(artifact.legs)) {
  console.log(JSON.stringify({ status: 'KAZU_STATIC_UNCHANGED', count: legs.length }));
} else {
  await writeFile(OUTPUT, content, { mode: 0o600 });
  console.log(JSON.stringify({ status: 'KAZU_STATIC_BUILT', count: legs.length,
    coverage: Object.fromEntries([...new Set(legs.map((leg) => leg.segment))].map((segment) =>
      [segment, Object.fromEntries(Object.keys(DATES).map((day) =>
        [day, legs.filter((leg) => leg.segment === segment && leg.calendarType === day).length]))])) }));
}

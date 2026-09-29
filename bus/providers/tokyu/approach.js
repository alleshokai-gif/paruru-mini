import { KIBUKIHONCHO_TO_KAJIGAYA, KIBUKIHONCHO_TO_MUKOUGAOKA } from './config.js';

const NAVI_URL = 'https://tokyu.bus-location.jp/blsys/navi?VID=rsi&EID=st&CID=rtl&FID=rtl&RAMK=64&DOF=9&SKF=3072&SSC=1';
const MAX_HTML_BYTES = 256 * 1024;
const TIMEOUT_MS = 3500;
const CACHE_SECONDS = 25;
const MAX_AGE_SECONDS = 90;
const JST_SECONDS = 9 * 3600;

const clean = (value) => value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;|&#xA0;/gi, ' ')
  .replace(/\s+/g, ' ').trim();

function pageTime(html, now) {
  const matches = [...html.matchAll(/([01]\d|2[0-3]):([0-5]\d)\s*時点の情報/g)];
  if (!matches.length || matches.some((value) => value[0] !== matches[0][0])) return null;
  const dayStart = Math.floor((now + JST_SECONDS) / 86400) * 86400 - JST_SECONDS;
  let observedAt = dayStart + Number(matches[0][1]) * 3600 + Number(matches[0][2]) * 60;
  if (observedAt > now + 5) observedAt -= 86400;
  return now - observedAt <= MAX_AGE_SECONDS ? observedAt : null;
}

function cell(row, className) {
  return row.match(new RegExp(`<td\\b[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/td>`, 'i'))?.[1] || '';
}

function stopRow(row) {
  return clean(cell(row, 'stopName'));
}

function busBlocks(row, side) {
  return [...cell(row, side).matchAll(/<dl\b[^>]*>([\s\S]*?)<\/dl>/gi)]
    .filter((match) => /<img\b[^>]*alt=["']バス["']/i.test(match[1]))
    .map((match) => clean(match[1].match(/<dd\b[^>]*>([\s\S]*?)<\/dd>/i)?.[1] || ''));
}

function selectApproach(rows, selectedIndex, { side, source, destination, heading }) {
  const candidates = [];
  for (let index = 0; index < rows.length; index++) {
    if (side === 'balloonR' && index >= selectedIndex || side === 'balloonL' && index <= selectedIndex) continue;
    const count = rows.reduce((total, row, stopIndex) => total + (stopRow(row)
      && (side === 'balloonR' ? stopIndex > index && stopIndex <= selectedIndex
        : stopIndex >= selectedIndex && stopIndex < index) ? 1 : 0), 0);
    if (count < 1 || count > 6) continue;
    for (const label of busBlocks(rows[index], side)) {
      if (label.startsWith('(折)') || label.startsWith('（折）')) continue;
      if (!label.includes(heading)) continue;
      const wait = label.match(/(?:^|\s)(\d{1,2})分待ち(?:\s|$)/);
      candidates.push({ waitMinutes: wait ? Number(wait[1]) : null, stopsAwayMin: count - 1,
        stopsAwayMax: count, source, destination });
    }
  }
  if (candidates.length !== 1 || !Number.isInteger(candidates[0].waitMinutes)
    || candidates[0].waitMinutes > 60) return null;
  return candidates[0];
}

// The public page has no trip/vehicle key. This is an independent stop-level approach,
// never a realtime prediction for any scheduled departure.
export function parseTokyuApproaches(html, now) {
  if (typeof html !== 'string' || html.length > MAX_HTML_BYTES || !Number.isFinite(now)
    || !/<h3>\s*向01\s*<\/h3>/.test(html)) return {};
  const retrievedAt = pageTime(html, now);
  if (retrievedAt == null) return {};
  const table = html.match(/<table\b[^>]*class=["'][^"']*\brouteListTbl\b[^"']*["'][^>]*>[\s\S]*?<\/table>/i)?.[0];
  if (!table) return {};
  const rows = [...table.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)].map((value) => value[0]);
  const selected = rows.flatMap((row, index) => /<tr\b[^>]*class=["'][^"']*\b\w*Select\b[^"']*["']/i.test(row)
    && stopRow(row) === '神木本町' ? [index] : []);
  if (selected.length !== 1) return {};
  const directions = [
    { side: 'balloonR', source: KIBUKIHONCHO_TO_MUKOUGAOKA, destination: '向ヶ丘遊園駅南口', heading: '向丘駅行' },
    { side: 'balloonL', source: KIBUKIHONCHO_TO_KAJIGAYA, destination: '梶が谷駅', heading: '梶谷駅行' }
  ];
  return Object.fromEntries(directions.flatMap((direction) => {
    const result = selectApproach(rows, selected[0], direction);
    if (!result) return [];
    return [[direction.source.sourceId, { matchedTripId: null, uniqueNext: true,
      routeLabel: direction.source.routeLabel, destination: direction.destination,
      boardingStopId: direction.source.fromStopId, waitMinutes: result.waitMinutes,
      stopsAwayMin: result.stopsAwayMin, stopsAwayMax: result.stopsAwayMax, retrievedAt }]];
  }));
}

async function readBoundedHtml(response) {
  if (!response.ok || Number(response.headers.get('content-length')) > MAX_HTML_BYTES
    || !/^text\/html(?:;|$)/i.test(response.headers.get('content-type') || '')
    || !response.body?.getReader) return null;
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_HTML_BYTES) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return null; }
}

export function createTokyuApproachSource({ fetcher = fetch, now = () => Date.now() / 1000 } = {}) {
  let cached = null, pending = null;
  return {
    async getApproaches() {
      if (cached && now() - cached.at >= 0 && now() - cached.at < CACHE_SECONDS) return cached.value;
      if (pending) return pending;
      pending = (async () => {
        let value = {};
        try {
          const response = await fetcher(NAVI_URL, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
          const html = await readBoundedHtml(response);
          if (html) value = parseTokyuApproaches(html, now());
        } catch { /* Official approach is optional; retain ODPT Static when unavailable. */ }
        cached = { at: now(), value };
        return value;
      })();
      try { return await pending; } finally { pending = null; }
    }
  };
}

export function withTokyuApproaches(staticResult, approaches) {
  return { ...staticResult, arrivals: staticResult.arrivals.map((row) => ({ ...row,
    officialApproach: approaches?.[row.sourceId] ?? null })) };
}

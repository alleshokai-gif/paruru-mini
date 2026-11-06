import { buildP0Static } from '../scripts/p0-static.js';
import { buildP2_5KawasakiStatic } from '../scripts/p2-5-kawasaki-static.js';
import { buildPositionStatic } from '../scripts/position-static.js';
import { fetchStatic } from '../providers/kawasaki/static-source.js';
import { mergeKawasakiStatic } from '../providers/kawasaki/journey-static.js';
import { buildSeibuStatic } from '../providers/seibu/static-build.js';
import { fetchSeibuResource } from '../providers/seibu/static-source.js';
import { fetchTokyuSnapshot } from '../providers/tokyu/static.js';
import { fetchTokyuJourneyTimetables } from '../providers/tokyu/journey-static.js';
import { validDate } from '../runtime/static-artifact.js';
import { serviceActive } from '../core/arrivals.js';
import { effectiveAt, jstDate, sha } from '../runtime/schedule-store.js';

const catalog = 'https://ckan.odpt.org/dataset/transportation_bureau_city_of_kawasaki_all_lines';
const DAY_MS = 86400000;

export function kawasakiCatalogDates(html) {
  return [...new Set(Array.from(html.matchAll(/川崎市バス-(\d{8})(?!\d)/g), m => m[1]).filter(validDate))].sort();
}

function requireServiceWeek(index, from) {
  for (const rows of Object.values(index.directions)) {
    for (let offset = 0; offset < 7; offset++) {
      const day = from + offset * DAY_MS;
      if (jstDate(day) > index.feedInfo.feed_end_date) throw Error('SCHEDULE_COVERAGE_TOO_SHORT');
      if (!rows.some(row => serviceActive(index, row.serviceId, day / 1000))) throw Error('SCHEDULE_DIRECTION_EMPTY');
    }
  }
}

function firstServiceAt(index, day) {
  let first = Infinity;
  for (const rows of Object.values(index.directions)) for (const row of rows) {
    if (serviceActive(index,row.serviceId,day / 1000)) first = Math.min(first,row.scheduledSeconds);
  }
  if (!Number.isFinite(first) || first < 0 || first >= 86400) throw Error('SCHEDULE_FIRST_SERVICE');
  return day + first * 1000;
}

export function createDiscoverers({ token, fetcher = fetch, now = Date.now() }) {
  return {
    async kawasaki(state) {
      const r = await fetcher(catalog, { signal:AbortSignal.timeout(15000), redirect:'error' });
      if (!r.ok || Number(r.headers.get('content-length')) > 512000) throw Error('SCHEDULE_CATALOG_HTTP');
      const html = await r.text();
      const dates = html.length <= 512000 ? kawasakiCatalogDates(html) : [];
      if (!dates.length) throw Error('SCHEDULE_CATALOG_EMPTY');
      const today = jstDate(now);
      const current = dates.filter(date => date <= today).at(-1);
      const future = dates.find(date => date > today);
      const date = current && (!state.active || effectiveAt(current) > state.active.effectiveAt) ? current : future;
      if (!date || state.sourceTag === date || state.pending?.effectiveAt === effectiveAt(date)) return null;
      const bytes = await fetchStatic(token,date,fetcher);
      const p0 = buildP0Static(bytes,{ sourceDate:date, now:now/1000 });
      const journey = buildP2_5KawasakiStatic(bytes,{ sourceDate:date, now:now/1000 });
      const index = mergeKawasakiStatic(p0,journey);
      const start = effectiveAt([date,index.feedInfo.feed_start_date].sort().at(-1));
      requireServiceWeek(index,Math.max(start,effectiveAt(today)));
      const position = buildPositionStatic(bytes,{ index,provider:'kawasaki',now });
      return { payload:{p0,journey,position}, sourceTag:date, sourceHash:p0.sourceHash, version:p0.sourceVersion,
        effectiveAt:firstServiceAt(index,start), fetchedAt:now,endDate:p0.feedInfo.feed_end_date };
    },
    async seibu(state) {
      const resource = await fetchSeibuResource(token,fetcher,state.sourceTag);
      if (!resource) return null;
      const sourceHash = sha(resource.bytes);
      if (sourceHash === (state.pending || state.active)?.sourceHash) return null;
      const artifact = buildSeibuStatic(resource.bytes,{now:now/1000});
      const start = effectiveAt(artifact.feedInfo.feed_start_date);
      requireServiceWeek(artifact,Math.max(start,effectiveAt(jstDate(now))));
      return { payload:{artifact}, sourceTag:resource.etag, sourceHash, version:artifact.sourceVersion,
        effectiveAt:firstServiceAt(artifact,start), fetchedAt:now,endDate:artifact.feedInfo.feed_end_date };
    },
    async tokyu(state) {
      // The published ODPT API is the active timetable, not a GTFS file with a planned service window.
      const [snapshot,journey] = await Promise.all([fetchTokyuSnapshot(token,fetcher,now/1000),
        fetchTokyuJourneyTimetables(token,fetcher)]);
      const outbound = snapshot.directions.find(d => d.query.sourceId === 'mukougaoka_to_kibukihoncho');
      // Ensure the return-route trip timetable and its pole timetable were published together.
      if (!outbound) throw Error('SCHEDULE_TOKYU_COVERAGE');
      for (const [pole, trip] of [['Weekday','Weekday'],['Saturday','Saturday'],['Sunday','Holiday']]) {
        if (JSON.stringify(outbound.calendars['odpt.Calendar:'+pole])
          !== JSON.stringify(journey.calendars['odpt.Calendar:'+trip]?.map(row=>row.departureSeconds)))
          throw Error('SCHEDULE_TOKYU_INCONSISTENT');
      }
      const sourceHash = sha(JSON.stringify([snapshot.directions.map(d=>[d.query.sourceId,d.calendars]),journey]));
      if (sourceHash === (state.pending || state.active)?.sourceHash) return null;
      return { payload:{snapshot,journey},sourceHash,version:`ODPT-${jstDate(snapshot.sourceUpdatedAt*1000)}-${sourceHash.slice(0,8)}`,
        effectiveAt:Math.max(now,snapshot.sourceUpdatedAt*1000),fetchedAt:now,endDate:null };
    }
  };
}

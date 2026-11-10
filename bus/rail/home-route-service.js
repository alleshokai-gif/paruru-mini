import { validateRailStatic, listRailTrains } from './static-provider.js';
import { attachJrNambuLocations, loadJrNambuLocations } from './jr-challenge-provider.js';
import { createHomeBusLoader } from '../journey/home-bus-loader.js';
import { compareHomeRoutes } from '../journey/home-route.js';
import { getFutureBuses } from '../journey/future-bus.js';
import { fetchTokyuJourneyTimetables, getFutureTokyuBuses } from '../providers/tokyu/journey-static.js';
import { SCHOOL_TO_TACHIKAWA_SOURCE, STOPS } from '../providers/seibu/config.js';

// The four values accepted in the product Preview are transfer-time estimates, in minutes.
// They stay separate for Noborito's two exits; they are not measured walking times.
export const HOME_TRANSFER_MINUTES = Object.freeze({
  'noborito-normal': 8, 'noborito-tamagawa': 11, mukougaoka: 5, mizonokuchi: 6
});
export const HOME_RUSH_TRANSFER_MINUTES = Object.freeze({
  // 登戸（生田緑地口）は、急げば6分乗換を候補として残す。
  // Other exits retain their normal allowance until a measured rush time exists.
  'noborito-normal': 6
});

const SOURCE_IDS = Object.freeze([
  'noborito_to_home', 'noborito_tamagawa_to_kibukihoncho',
  'mukougaoka_to_kibukihoncho', 'mizonokuchi_to_home'
]);
const SCHOOL_ACCESS_MINUTES = Object.freeze({
  universityWalk: 20, universityPlatform: 3, tachikawaPlatform: 5,
  // The school map confirms both stops. The main stop is published as a
  // one-minute walk; use planning allowances for walking and boarding.
  seibuStops: Object.freeze({ [STOPS.schoolInbound]: 3, [STOPS.schoolWestInbound]: 5 })
});
const SCHOOL_SEARCH_SEC = 2 * 3600, DAY_SEC = 86400, JST_SEC = 9 * 3600;

export function createRailHomeRouteService({ odakyuStatic, jrStatic, futureIndex,
  futureQueries, providerContext, adapter, odptToken, challengeEnv = process.env,
  clock = () => Date.now() / 1000, loadAccessBuses = null,
  loadTokyuIndex = () => fetchTokyuJourneyTimetables(odptToken) } = {}) {
  validateRailStatic(odakyuStatic);
  validateRailStatic(jrStatic);
  const queries = new Map(futureQueries.map((query) => [query.id, query]));
  if (SOURCE_IDS.some((id) => !queries.has(id)) || !adapter?.getRealtime || !odptToken)
    throw Error('HOME_ROUTE_RUNTIME_INVALID');
  let locationCache = null, tokyuCache = null, tokyuPending = null;

  async function locations(now) {
    if (locationCache && Date.now() - locationCache.at < 30000) return locationCache.rows;
    let rows = [];
    try { rows = (await loadJrNambuLocations({ now, env: challengeEnv }))?.rows ?? []; }
    catch { /* Missing or stale Challenge data keeps the Static train unchanged. */ }
    locationCache = { at: Date.now(), rows };
    return rows;
  }

  async function tokyuIndex() {
    if (tokyuCache && Date.now() - tokyuCache.at < 3600000) return tokyuCache.index;
    tokyuPending ??= Promise.resolve().then(loadTokyuIndex).then((index) => {
      tokyuCache = { at: Date.now(), index };
      return index;
    }).finally(() => { tokyuPending = null; });
    return tokyuPending;
  }

  async function getTrainChoices(journeyId, page = 0, now = clock()) {
    const artifact = journeyId === 'university' ? odakyuStatic
      : journeyId === 'high_school' ? jrStatic : null;
    if (!artifact) throw Error('HOME_ROUTE_JOURNEY_INVALID');
    const rows = journeyId === 'high_school' ? await locations(now) : [];
    return listRailTrains({ artifact, journeyId, now, page,
      enrichTrain: (train) => journeyId === 'high_school'
        ? attachJrNambuLocations([train], rows, now)[0] : train });
  }

  async function busLoader(now) {
    let realtime = null;
    try { realtime = await adapter.getRealtime(); }
    catch { /* The existing Future Bus Query retains a Static fallback. */ }
    const sourceLoaders = Object.fromEntries(SOURCE_IDS.map((id) => [
      `kawasaki:${id}`, ({ boardingAt }) => getFutureBuses({
        index: futureIndex, queries: [queries.get(id)], providerContext,
        now, boardingAt, realtime
      }).results[0].arrivals
    ]));
    sourceLoaders['tokyu:mukougaoka_to_kibukihoncho'] = async ({ boardingAt }) =>
      getFutureTokyuBuses({ index: await tokyuIndex(), now, boardingAt });
    return createHomeBusLoader(sourceLoaders);
  }

  function compare({ journeyId, selectedTrain, stationId, now, loadBuses }) {
    return compareHomeRoutes({ journeyId, selectedTrain, stationId,
      transferMinutes: HOME_TRANSFER_MINUTES, rushTransferMinutes: HOME_RUSH_TRANSFER_MINUTES,
      loadBuses, now });
  }

  async function evaluateSchool(journeyId, now) {
    const until = now + SCHOOL_SEARCH_SEC;
    const university = journeyId === 'university';
    if (!university && journeyId !== 'high_school') throw Error('HOME_ROUTE_JOURNEY_INVALID');
    const [accessBuses, liveTrains, loadBuses] = await Promise.all([
      university || !loadAccessBuses ? [] : loadAccessBuses({
        at: now, until, sourceId: SCHOOL_TO_TACHIKAWA_SOURCE, walkMinutes: SCHOOL_ACCESS_MINUTES.seibuStops
      }).catch(() => []),
      university ? [] : locations(now),
      busLoader(now)
    ]);
    const bus = accessBuses[0] ?? null;
    const railReadyAt = university
      ? now + (SCHOOL_ACCESS_MINUTES.universityWalk + SCHOOL_ACCESS_MINUTES.universityPlatform) * 60
      : bus ? bus.arrivalAt + SCHOOL_ACCESS_MINUTES.tachikawaPlatform * 60 : null;
    const access = university
      ? { mode: 'walk', walkMinutes: SCHOOL_ACCESS_MINUTES.universityWalk, railReadyAt }
      : bus ? { mode: 'seibu', ...bus, railReadyAt } : null;
    const trains = [];
    if (railReadyAt != null && railReadyAt <= until) {
      const nextDay = Math.floor((railReadyAt + JST_SEC) / DAY_SEC + 1) * DAY_SEC - JST_SEC;
      for (const from of [railReadyAt, nextDay].filter((value) => value <= until)) {
        for (let page = 0; page <= 50; page++) {
          const choices = listRailTrains({ artifact: university ? odakyuStatic : jrStatic,
            journeyId, now: from, page, enrichTrain: (train) => university
              ? train : attachJrNambuLocations([train], liveTrains, now)[0] });
          trains.push(...choices.trains.filter((train) => train.sourceDepartureAt <= until));
          if (!choices.hasNext || choices.trains.at(-1)?.sourceDepartureAt > until) break;
        }
      }
    }
    const results = await Promise.all(trains.map(async (train) => {
      const result = await compare({ journeyId, selectedTrain: train, now, loadBuses });
      return result.options.filter((row) => row.recommendable).map((row) => ({
        ...row, trainId: train.id, sourceDepartureAt: train.sourceDepartureAt
      }));
    }));
    const options = results.flat().sort((a, b) => (a.homeArrivalAt ?? Infinity) - (b.homeArrivalAt ?? Infinity)
      || (a.transferMode === 'rush') - (b.transferMode === 'rush')
      || a.departureAt - b.departureAt || a.sourceDepartureAt - b.sourceDepartureAt);
    const fastest = options.find((row) => row.homeArrivalAt != null) ?? null;
    const alternate = fastest ? options.find((row) => row.homeArrivalAt != null && row.stationId !== fastest.stationId) ?? null : null;
    return { journeyId, from: 'school', access, fastest, alternate, options };
  }

  async function evaluate({ journeyId, trainId, page = 0, stationId, from } = {}) {
    const now = clock();
    if (from === 'school') return evaluateSchool(journeyId, now);
    let selectedTrain;
    if (!stationId) {
      const choices = await getTrainChoices(journeyId, page, now);
      selectedTrain = choices.trains.find((train) => train.id === trainId);
      if (!selectedTrain) throw Error('HOME_ROUTE_TRAIN_INVALID');
    }
    return compare({ journeyId, selectedTrain, stationId, now, loadBuses: await busLoader(now) });
  }

  return Object.freeze({ getTrainChoices, evaluate });
}

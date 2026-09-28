import { validateRailStatic, listRailTrains } from './static-provider.js';
import { attachJrNambuLocations, loadJrNambuLocations } from './jr-challenge-provider.js';
import { createHomeBusLoader } from '../journey/home-bus-loader.js';
import { compareHomeRoutes } from '../journey/home-route.js';
import { getFutureBuses } from '../journey/future-bus.js';
import { fetchTokyuJourneyTimetables, getFutureTokyuBuses } from '../providers/tokyu/journey-static.js';

// The four values accepted in the product Preview are transfer-time estimates, in minutes.
// They stay separate for Noborito's two exits; they are not measured walking times.
export const HOME_TRANSFER_MINUTES = Object.freeze({
  'noborito-normal': 8, 'noborito-tamagawa': 11, mukougaoka: 5, mizonokuchi: 6
});

const SOURCE_IDS = Object.freeze([
  'noborito_to_home', 'noborito_tamagawa_to_kibukihoncho',
  'mukougaoka_to_kibukihoncho', 'mizonokuchi_to_home'
]);

export function createRailHomeRouteService({ odakyuStatic, jrStatic, futureIndex,
  futureQueries, providerContext, adapter, odptToken, challengeEnv = process.env,
  clock = () => Date.now() / 1000,
  loadTokyuIndex = () => fetchTokyuJourneyTimetables(odptToken) } = {}) {
  validateRailStatic(odakyuStatic);
  validateRailStatic(jrStatic);
  const queries = new Map(futureQueries.map((query) => [query.id, query]));
  if (SOURCE_IDS.some((id) => !queries.has(id)) || !adapter?.getRealtime || !odptToken)
    throw Error('HOME_ROUTE_RUNTIME_INVALID');
  let locationCache = null, tokyuCache = null;

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
    const index = await loadTokyuIndex();
    tokyuCache = { at: Date.now(), index };
    return index;
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

  async function evaluate({ journeyId, trainId, page = 0 } = {}) {
    const now = clock(), choices = await getTrainChoices(journeyId, page, now);
    const selectedTrain = choices.trains.find((train) => train.id === trainId);
    if (!selectedTrain) throw Error('HOME_ROUTE_TRAIN_INVALID');
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
    return compareHomeRoutes({ journeyId, selectedTrain,
      transferMinutes: HOME_TRANSFER_MINUTES, loadBuses: createHomeBusLoader(sourceLoaders), now });
  }

  return Object.freeze({ getTrainChoices, evaluate });
}

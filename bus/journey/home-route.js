const fail = () => { throw Error('HOME_ROUTE_INPUT_INVALID'); };

// Fixed family journeys. Rail data stays above Bus; transfer times are supplied per station exit.
export const HOME_ROUTE_TEMPLATES = Object.freeze({
  university: Object.freeze([
    Object.freeze({ placeId: 'noborito-normal', stationId: 'noborito',
      label: '登戸駅（生田緑地口）', sourceIds: Object.freeze(['kawasaki:noborito_to_home']) }),
    Object.freeze({ placeId: 'noborito-tamagawa', stationId: 'noborito',
      label: '登戸駅多摩川口', sourceIds: Object.freeze(['kawasaki:noborito_tamagawa_to_kibukihoncho']) }),
    Object.freeze({ placeId: 'mukougaoka', stationId: 'mukougaoka',
      label: '向ヶ丘遊園駅南口', sourceIds: Object.freeze([
        'kawasaki:mukougaoka_to_kibukihoncho', 'tokyu:mukougaoka_to_kibukihoncho']) })
  ]),
  high_school: Object.freeze([
    Object.freeze({ placeId: 'noborito-normal', stationId: 'noborito',
      label: '登戸駅（生田緑地口）', sourceIds: Object.freeze(['kawasaki:noborito_to_home']) }),
    Object.freeze({ placeId: 'noborito-tamagawa', stationId: 'noborito',
      label: '登戸駅多摩川口', sourceIds: Object.freeze(['kawasaki:noborito_tamagawa_to_kibukihoncho']) }),
    Object.freeze({ placeId: 'mizonokuchi', stationId: 'musashi_mizonokuchi',
      label: '溝の口駅南口', sourceIds: Object.freeze(['kawasaki:mizonokuchi_to_home']) })
  ])
});

const knownState = new Set(['scheduled', 'realtime', 'departure_pending', 'departure_overdue',
  'departure_uncertain', 'unknown']);
const uncertainty = new Set(['departure_uncertain', 'unknown']);
const validTime = (value) => Number.isFinite(value) && value >= 0;

export async function compareHomeRoutes({ journeyId, selectedTrain, transferMinutes, loadBuses, now } = {}) {
  const places = HOME_ROUTE_TEMPLATES[journeyId];
  if (!places || !selectedTrain?.id || !validTime(now) || typeof loadBuses !== 'function'
    || !transferMinutes || typeof transferMinutes !== 'object') fail();
  for (const place of places) {
    const stationArrivalAt = selectedTrain.arrivals?.[place.stationId], transfer = transferMinutes[place.placeId];
    if (!validTime(stationArrivalAt) || stationArrivalAt < now || !Number.isFinite(transfer)
      || transfer < 0 || transfer > 60) fail();
  }
  const tasks = places.map(async (place) => {
    const stationArrivalAt = selectedTrain.arrivals?.[place.stationId], transfer = transferMinutes[place.placeId];
    const boardingAt = stationArrivalAt + transfer * 60;
    const buses = await loadBuses({ placeId: place.placeId, boardingAt, sourceIds: place.sourceIds });
    if (!Array.isArray(buses)) fail();
    return buses.filter((bus) => {
      if (!place.sourceIds.includes(`${bus.provider}:${bus.queryId}`) || !validTime(bus.departureAt)
        || !knownState.has(bus.departureState) || bus.estimatedArrival !== null
          && !validTime(bus.estimatedArrival)) fail();
      return bus.departureAt >= boardingAt;
    }).map((bus) => ({ placeId: place.placeId, stationId: place.stationId, stationLabel: place.label,
      stationArrivalAt, transferMinutes: transfer, boardingAt,
      provider: bus.provider, routeLabel: bus.routeLabel, tripId: bus.tripId,
      platform: bus.platform, departureAt: bus.departureAt, homeArrivalAt: bus.estimatedArrival,
      timingQuality: bus.timingQuality, departureState: bus.departureState,
      recommendable: bus.recommendable === true && !uncertainty.has(bus.departureState) }));
  });
  const settled = await Promise.allSettled(tasks), options = [], unavailable = [];
  for (let index = 0; index < settled.length; index++) {
    if (settled[index].status === 'fulfilled') options.push(...settled[index].value);
    else unavailable.push(places[index].placeId);
  }
  const eligible = options.filter((option) => option.recommendable && validTime(option.homeArrivalAt)
    && option.homeArrivalAt >= option.departureAt);
  eligible.sort((a, b) => a.homeArrivalAt - b.homeArrivalAt
    || a.departureAt - b.departureAt || a.tripId.localeCompare(b.tripId));
  const fastest = eligible[0] ?? null, alternate = eligible.find((option) => option.stationId !== fastest?.stationId) ?? null;
  return Object.freeze({ journeyId, selectedTrainId: selectedTrain.id,
    status: fastest ? unavailable.length ? 'partial' : 'available' : 'insufficient_data',
    fastest, alternate, differenceMinutes: fastest && alternate
      ? Math.round((alternate.homeArrivalAt - fastest.homeArrivalAt) / 60) : null,
    options, unavailablePlaces: unavailable });
}

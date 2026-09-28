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
    const stationTimeAt = (selectedTrain.effectiveStationTimes ?? selectedTrain.stationTimes
      ?? selectedTrain.arrivals)?.[place.stationId], transfer = transferMinutes[place.placeId];
    if (!validTime(stationTimeAt) || stationTimeAt < now || !Number.isFinite(transfer)
      || transfer < 0 || transfer > 60) fail();
  }
  const tasks = places.map(async (place) => {
    const stationTimeAt = (selectedTrain.effectiveStationTimes ?? selectedTrain.stationTimes
      ?? selectedTrain.arrivals)[place.stationId], transfer = transferMinutes[place.placeId];
    const stationTimeSource = selectedTrain.stationTimeSources?.[place.stationId] ?? 'arrival';
    const boardingAt = stationTimeAt + transfer * 60;
    const loaded = await loadBuses({ placeId: place.placeId, boardingAt, sourceIds: place.sourceIds });
    const sourceStates = loaded?.sourceStates;
    if (!Array.isArray(loaded?.arrivals) || !sourceStates || typeof sourceStates !== 'object'
      || Array.isArray(sourceStates) || Object.keys(sourceStates).length !== place.sourceIds.length
      || place.sourceIds.some((id) => !['available', 'unavailable'].includes(sourceStates[id]))) fail();
    const unavailableSources = place.sourceIds.filter((id) => sourceStates[id] === 'unavailable');
    const options = loaded.arrivals.filter((bus) => {
      if (!place.sourceIds.includes(`${bus.provider}:${bus.queryId}`) || !validTime(bus.departureAt)
        || !knownState.has(bus.departureState) || bus.estimatedArrival !== null
          && !validTime(bus.estimatedArrival)
        || sourceStates[`${bus.provider}:${bus.queryId}`] !== 'available') fail();
      return bus.departureAt >= boardingAt;
    }).map((bus) => ({ placeId: place.placeId, stationId: place.stationId, stationLabel: place.label,
      stationTimeAt, stationTimeSource,
      stationArrivalAt: stationTimeSource === 'arrival' ? stationTimeAt : null,
      railTimingQuality: selectedTrain.railRealtimeState === 'confirmed_delay'
        && selectedTrain.delaySeconds > 0
        ? 'delay_projection' : 'static_only',
      railDelaySeconds: selectedTrain.railRealtimeState === 'confirmed_delay'
        ? selectedTrain.delaySeconds : null,
      transferMinutes: transfer, boardingAt,
      provider: bus.provider, routeLabel: bus.routeLabel, tripId: bus.tripId,
      platform: bus.platform, departureAt: bus.departureAt, homeArrivalAt: bus.estimatedArrival,
      timingQuality: bus.timingQuality, departureState: bus.departureState,
      recommendable: bus.recommendable === true && !uncertainty.has(bus.departureState) }));
    return { options, unavailableSources };
  });
  const settled = await Promise.allSettled(tasks), options = [], unavailable = [], unavailableSources = [];
  for (let index = 0; index < settled.length; index++) {
    if (settled[index].status === 'fulfilled') {
      options.push(...settled[index].value.options);
      unavailableSources.push(...settled[index].value.unavailableSources);
      if (settled[index].value.unavailableSources.length === places[index].sourceIds.length)
        unavailable.push(places[index].placeId);
    } else {
      unavailable.push(places[index].placeId);
      unavailableSources.push(...places[index].sourceIds);
    }
  }
  const eligible = options.filter((option) => option.recommendable && validTime(option.homeArrivalAt)
    && option.homeArrivalAt >= option.departureAt);
  eligible.sort((a, b) => a.homeArrivalAt - b.homeArrivalAt
    || a.departureAt - b.departureAt || a.tripId.localeCompare(b.tripId));
  const fastest = eligible[0] ?? null, alternate = eligible.find((option) => option.stationId !== fastest?.stationId) ?? null;
  return Object.freeze({ journeyId, selectedTrainId: selectedTrain.id,
    status: fastest ? unavailableSources.length ? 'partial' : 'available' : 'insufficient_data',
    fastest, alternate, differenceMinutes: fastest && alternate
      ? Math.round((alternate.homeArrivalAt - fastest.homeArrivalAt) / 60) : null,
    options, unavailablePlaces: unavailable, unavailableSources });
}

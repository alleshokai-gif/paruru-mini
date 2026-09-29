const JST_SECONDS = 9 * 3600;
const DAY_SECONDS = 24 * 3600;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/i;
const fail = () => { throw Error('RAIL_STATIC_INVALID'); };

// These are PALURU's fixed family routes, not a railway timetable or data source.
export const RAIL_ROUTES = Object.freeze({
  university: Object.freeze({
    provider: 'odakyu', route: 'tamagawa_to_noborito',
    sourceStation: 'tamagawagakuenmae', sourceLabel: '玉川学園前',
    candidates: Object.freeze([
      Object.freeze({ station: 'mukougaoka', label: '向ヶ丘遊園' }),
      Object.freeze({ station: 'noborito', label: '登戸' })
    ])
  }),
  high_school: Object.freeze({
    provider: 'jr_east', route: 'tachikawa_to_mizonokuchi',
    sourceStation: 'tachikawa', sourceLabel: '立川',
    candidates: Object.freeze([
      Object.freeze({ station: 'noborito', label: '登戸' }),
      Object.freeze({ station: 'musashi_mizonokuchi', label: '武蔵溝ノ口' })
    ])
  })
});

function minutes(value) {
  const match = TIME_PATTERN.exec(value);
  if (!match) fail();
  return Number(match[1]) * 60 + Number(match[2]);
}

function validDate(value) {
  return DATE_PATTERN.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

export function validateRailStatic(artifact) {
  if (!artifact || artifact.schemaVersion !== 1 || artifact.timezone !== 'Asia/Tokyo'
    || !['user', 'challenge_generated'].includes(artifact.management)
    || typeof artifact.sample !== 'boolean'
    || typeof artifact.timetableVersion !== 'string' || !artifact.timetableVersion.trim()
    || !Array.isArray(artifact.trains) || !artifact.trains.length
    || !artifact.calendarOverrides || typeof artifact.calendarOverrides !== 'object'
    || Array.isArray(artifact.calendarOverrides)) fail();
  for (const [date, type] of Object.entries(artifact.calendarOverrides))
    if (!validDate(date) || !['weekday', 'weekend'].includes(type)) fail();
  const ids = new Set();
  for (const train of artifact.trains) {
    const route = Object.values(RAIL_ROUTES).find((candidate) =>
      candidate.provider === train?.provider && candidate.route === train?.route);
    if (!route || !['weekday', 'weekend'].includes(train.calendarType)
      || train.sourceStation !== route.sourceStation || !ID_PATTERN.test(train.internalTripId)
      || typeof train.trainType !== 'string' || !train.trainType.trim()
      || typeof train.destination !== 'string' || !train.destination.trim()
      || !Array.isArray(train.candidateStations)
      || train.candidateStations.length !== route.candidates.length) fail();
    if (artifact.management === 'challenge_generated'
      && (train.provider !== 'jr_east' || train.railway !== 'odpt.Railway:JR-East.Nambu'
        || typeof train.trainNumber !== 'string' || !train.trainNumber.trim()
        || artifact.sample !== false)) fail();
    const id = `${train.calendarType}:${train.internalTripId}`;
    if (ids.has(id)) fail();
    ids.add(id);
    let previous = minutes(train.sourceDeparture);
    for (let index = 0; index < route.candidates.length; index++) {
      const station = train.candidateStations[index];
      if (station?.station !== route.candidates[index].station) fail();
      if (station.stationTimeSource !== 'arrival' && station.stationTimeSource !== 'departure') fail();
      if (train.provider === 'jr_east' && station.stationTimeSource !== 'departure') fail();
      let stationTime = minutes(station.stationTime);
      if (stationTime <= previous && previous >= 22 * 60 && stationTime <= 2 * 60)
        stationTime += 1440;
      if (stationTime <= previous || stationTime - minutes(train.sourceDeparture) > 120) fail();
      previous = stationTime;
    }
  }
  return artifact;
}

export function listRailTrains({ artifact, journeyId, now, page = 0, pageSize = 5,
  enrichTrain = (train) => train } = {}) {
  validateRailStatic(artifact);
  const route = RAIL_ROUTES[journeyId];
  if (!route || !Number.isFinite(now) || !Number.isSafeInteger(page) || Math.abs(page) > 50
    || !Number.isSafeInteger(pageSize) || pageSize < 3 || pageSize > 5
    || typeof enrichTrain !== 'function') fail();
  const local = new Date((now + JST_SECONDS) * 1000);
  const serviceDate = local.toISOString().slice(0, 10);
  const calendarType = artifact.calendarOverrides[serviceDate]
    || ([0, 6].includes(local.getUTCDay()) ? 'weekend' : 'weekday');
  const dayStart = Math.floor((now + JST_SECONDS) / DAY_SECONDS) * DAY_SECONDS - JST_SECONDS;
  const rows = artifact.trains.filter((train) => train.provider === route.provider
    && train.route === route.route && train.calendarType === calendarType).map((train) => {
    const sourceDepartureAt = dayStart + minutes(train.sourceDeparture) * 60;
    const sourceMinutes = minutes(train.sourceDeparture);
    const stationTimes = Object.fromEntries(train.candidateStations.map((station) => {
      const stationMinutes = minutes(station.stationTime);
      return [station.station, dayStart + (stationMinutes < sourceMinutes
        ? stationMinutes + 1440 : stationMinutes) * 60];
    }));
    const stationTimeSources = Object.fromEntries(train.candidateStations.map((station) =>
      [station.station, station.stationTimeSource]));
    return {
      id: `${serviceDate}:${train.internalTripId}`, sourceDepartureAt,
      sourceDeparture: train.sourceDeparture, sourceStation: route.sourceLabel,
      trainType: train.trainType, destination: train.destination,
      provider: train.provider, railway: train.railway ?? null, trainNumber: train.trainNumber ?? null,
      serviceDate, stationTimes, stationTimeSources,
      railRealtimeState: 'static_fallback', delaySeconds: null, position: null,
      label: `${train.sourceDeparture} ${route.sourceLabel}発・${train.trainType}・${route.candidates
        .map((candidate, index) => `${candidate.label}${train.candidateStations[index].stationTime}${
          train.candidateStations[index].stationTimeSource === 'departure' ? '発' : '着'}`).join('／')}`,
      candidateStations: route.candidates.map((candidate, index) => ({
        station: candidate.station, label: candidate.label,
        stationTime: train.candidateStations[index].stationTime,
        stationTimeSource: train.candidateStations[index].stationTimeSource
      }))
    };
  }).map(enrichTrain)
    .sort((a, b) => a.sourceDepartureAt - b.sourceDepartureAt || a.id.localeCompare(b.id));
  // Signed pages are anchored at the first source departure at/after now.
  // 0 is the next five, -1 the preceding five, +1 the following five.
  const nextIndex = rows.findIndex((train) => train.sourceDepartureAt >= now);
  const anchor = nextIndex < 0 ? rows.length : nextIndex;
  const end = page < 0 ? Math.max(0, anchor + (page + 1) * pageSize) : null;
  const start = page < 0 ? Math.max(0, end - pageSize) : Math.min(rows.length, anchor + page * pageSize);
  const pageEnd = end ?? Math.min(rows.length, start + pageSize);
  return {
    journeyId, serviceDate, calendarType, sample: artifact.sample,
    stationTimeSource: journeyId === 'high_school' ? 'departure' : 'arrival',
    trains: rows.slice(start, pageEnd),
    hasPrevious: start > 0, hasNext: pageEnd < rows.length
  };
}

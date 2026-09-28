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
    || artifact.management !== 'user' || typeof artifact.sample !== 'boolean'
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
    const id = `${train.calendarType}:${train.internalTripId}`;
    if (ids.has(id)) fail();
    ids.add(id);
    let previous = minutes(train.sourceDeparture);
    for (let index = 0; index < route.candidates.length; index++) {
      const station = train.candidateStations[index];
      if (station?.station !== route.candidates[index].station) fail();
      const arrival = minutes(station.arrival);
      if (arrival <= previous) fail();
      previous = arrival;
    }
  }
  return artifact;
}

export function listRailTrains({ artifact, journeyId, now, page = 0, pageSize = 5 } = {}) {
  validateRailStatic(artifact);
  const route = RAIL_ROUTES[journeyId];
  if (!route || !Number.isFinite(now) || !Number.isSafeInteger(page) || page < 0
    || !Number.isSafeInteger(pageSize) || pageSize < 3 || pageSize > 5) fail();
  const local = new Date((now + JST_SECONDS) * 1000);
  const serviceDate = local.toISOString().slice(0, 10);
  const calendarType = artifact.calendarOverrides[serviceDate]
    || ([0, 6].includes(local.getUTCDay()) ? 'weekend' : 'weekday');
  const dayStart = Math.floor((now + JST_SECONDS) / DAY_SECONDS) * DAY_SECONDS - JST_SECONDS;
  const rows = artifact.trains.filter((train) => train.provider === route.provider
    && train.route === route.route && train.calendarType === calendarType).map((train) => {
    const sourceDepartureAt = dayStart + minutes(train.sourceDeparture) * 60;
    const arrivals = Object.fromEntries(train.candidateStations.map((station) =>
      [station.station, dayStart + minutes(station.arrival) * 60]));
    return {
      id: `${serviceDate}:${train.internalTripId}`, sourceDepartureAt,
      sourceDeparture: train.sourceDeparture, sourceStation: route.sourceLabel,
      trainType: train.trainType, destination: train.destination, arrivals,
      label: `${train.sourceDeparture} ${route.sourceLabel}発・${train.trainType}・${route.candidates
        .map((candidate, index) => `${candidate.label}${train.candidateStations[index].arrival}着`).join('／')}`,
      candidateStations: route.candidates.map((candidate, index) => ({
        station: candidate.station, label: candidate.label,
        arrival: train.candidateStations[index].arrival
      }))
    };
  }).filter((train) => train.arrivals[route.candidates[0].station] >= now)
    .sort((a, b) => a.sourceDepartureAt - b.sourceDepartureAt || a.id.localeCompare(b.id));
  const start = page * pageSize;
  return {
    journeyId, serviceDate, calendarType, sample: artifact.sample,
    trains: rows.slice(start, start + pageSize),
    hasPrevious: page > 0, hasNext: start + pageSize < rows.length
  };
}

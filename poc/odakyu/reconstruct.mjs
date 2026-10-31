import { minutes, TYPES } from './core.mjs';

const TYPE_CODES = Object.freeze({ '各停': 'Local', '準急': 'SemiExpress', '急行': 'Express', '快速急行': 'RapidExpress' });
const SEGMENTS = Object.freeze({
  odakyu_uehara_noborito: ['YoyogiUehara', 'Noborito'],
  odakyu_uehara_seijo: ['YoyogiUehara', 'SeijogakuenMae'],
  odakyu_seijo_noborito: ['SeijogakuenMae', 'Noborito']
});
const CALENDARS = Object.freeze({ weekday: 'Weekday', weekend: 'SaturdayHoliday' });

// Reuse accepted, provider-ID keyed static legs. Never infer identity from similar times.
// The provider code is NOT a railway operating train number or an ODPT Train ID.
export function reconstructTrips(artifact, model, { segments = SEGMENTS } = {}) {
  if (!segments || Object.values(segments).some(pair => !Array.isArray(pair) || pair.length !== 2 || pair[0] === pair[1])) throw Error('SEGMENT_CONFIG_INVALID');
  if (artifact?.sample !== false || artifact.timezone !== 'Asia/Tokyo'
      || !Array.isArray(artifact.legs) || !Number.isFinite(Date.parse(artifact.sourceCheckedAt))) {
    throw Error('PROVIDER_ARTIFACT_INVALID');
  }
  const stations = new Map(model.stations.map(s => [s.id, s]));
  const departureIndex = new Map();
  const departureKey = row => [row.calendar, row.station, row.type, row.destinationName, row.time].join('|');
  for (const event of model.departures) {
    const key = departureKey(event);
    if (!departureIndex.has(key)) departureIndex.set(key, []);
    departureIndex.get(key).push(event);
  }
  const groups = new Map();
  for (const leg of artifact.legs.filter(l => Object.hasOwn(segments, l.segment))) {
    if (!leg.trainId || !CALENDARS[leg.calendarType] || !TYPE_CODES[leg.trainType]
        || leg.source !== 'Odakyu official train detail' || leg.stationTimeSource !== 'arrival') {
      throw Error('PROVIDER_LEG_INVALID');
    }
    const id = `${CALENDARS[leg.calendarType]}:${leg.trainId}`;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(leg);
  }
  const trips = [], rejected = [];
  let checked = 0, mismatches = 0, ambiguous = 0;
  for (const [id, legs] of groups) {
    const first = legs[0], stops = new Map(), reasons = [], sourceSegments = new Set();
    const calendar = CALENDARS[first.calendarType], type = TYPE_CODES[first.trainType];
    function put(station, field, time) {
      if (!stations.has(station)) throw Error('PROVIDER_STATION_UNKNOWN');
      if (!stops.has(station)) stops.set(station, { station, index: stations.get(station).index,
        arrival: null, departure: null, platform: null, stop: true });
      const row = stops.get(station);
      if (row[field] !== null && row[field] !== time) reasons.push('CONFLICTING_PROVIDER_TIME');
      row[field] = time;
    }
    for (const leg of legs) {
      if (sourceSegments.has(leg.segment)) reasons.push('DUPLICATE_PROVIDER_SEGMENT');
      sourceSegments.add(leg.segment);
      if (leg.trainType !== first.trainType || leg.destination !== first.destination) reasons.push('PROVIDER_ID_CONFLICT');
      const [from, to] = segments[leg.segment];
      const departure = minutes(leg.departure), arrival = minutes(leg.stationTime);
      if (arrival <= departure || arrival - departure > 120) reasons.push('NON_MONOTONIC_PROVIDER_TIME');
      const key = departureKey({ calendar, station: from, type, destinationName: leg.destination, time: departure });
      const matches = departureIndex.get(key) || [];
      checked++;
      if (matches.length === 0) { mismatches++; reasons.push('ODPT_DEPARTURE_MISMATCH'); }
      if (matches.length > 1) { ambiguous++; reasons.push('ODPT_DEPARTURE_AMBIGUOUS'); }
      put(from, 'departure', departure);
      put(to, 'arrival', arrival);
    }
    const ordered = [...stops.values()].sort((a, b) => a.index - b.index);
    for (let i = 0; i < ordered.length; i++) {
      const stop = ordered[i];
      if (stop.arrival !== null && stop.departure !== null && stop.arrival > stop.departure) reasons.push('NEGATIVE_DWELL');
      if (i && (ordered[i - 1].departure ?? ordered[i - 1].arrival) >= (stop.arrival ?? stop.departure)) reasons.push('STOP_ORDER_CONFLICT');
    }
    if (reasons.length) { rejected.push({ id, reasons: [...new Set(reasons)] }); continue; }
    const anchor = ordered[0];
    const sourceEvent = (departureIndex.get(departureKey({ calendar, station: anchor.station, type,
      destinationName: first.destination, time: anchor.departure })) || [])[0];
    trips.push({ id: `provider:${id}`, sourceTrainId: first.trainId, trainNumber: null,
      calendar, type, destination: first.destination, origin: anchor.station,
      throughChiyoda: sourceEvent?.isOrigin ? false : 'unknown', stops: ordered,
      knownPasses: type === 'RapidExpress' ? ['SeijogakuenMae', 'MukogaokaYuen'].filter(id => stations.has(id)) : [],
      identityBasis: 'provider_id', confidence: 'provider_static', coverage: 'explicit_stops_only',
      checkedAt: artifact.sourceCheckedAt, sourceServiceDate: artifact.sourceDates?.[first.calendarType] ?? null,
      source: '既存通勤Static / 小田急個別列車詳細',
      independentDepartureCheck: true, independentArrivalCheck: false });
  }
  trips.sort((a, b) => a.calendar.localeCompare(b.calendar) || a.stops[0].departure - b.stops[0].departure);
  return { trips, report: { sourceTrainCount: groups.size, accepted: trips.length,
    rejected: rejected.length, departureChecks: checked, departureMismatches: mismatches,
    departureAmbiguities: ambiguous, operatingTrainNumbers: 0, independentArrivalChecks: 0,
    explicitArrivalStations: [...new Set(trips.flatMap(t => t.stops.filter(s => s.arrival !== null).map(s => s.station)))],
    sourceCheckedAt: artifact.sourceCheckedAt, sourceDates: artifact.sourceDates,
    coverage: [...new Set(trips.flatMap(t => t.stops.map(s => stations.get(s.station).name || s.station)))].join('・') + 'の明示された着発のみ。全駅通しダイヤではない', rejectedTrains: rejected } };
}

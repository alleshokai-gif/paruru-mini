// Selected-train comparison over existing, saved Kazu legs. No proximity joins.
import { minutes, validateKazuStatic } from './kazu-commute.js';
import { planNavigation } from './transfer-planner.js';
import { HOME_TRANSFER_MINUTES, HOME_RUSH_TRANSFER_MINUTES } from './home-route-service.js';

export const COMMUTE_STATIONS = Object.freeze({
  'Chiyoda.Hibiya': '日比谷', YoyogiUehara: '代々木上原', ShimoKitazawa: '下北沢',
  Kyodo: '経堂', SeijogakuenMae: '成城学園前', Noborito: '登戸', MukogaokaYuen: '向ヶ丘遊園'
});
const SEGMENTS = Object.freeze({ chiyoda: ['Chiyoda.Hibiya', 'YoyogiUehara'],
  odakyu_uehara_noborito: ['YoyogiUehara', 'Noborito'],
  odakyu_uehara_seijo: ['YoyogiUehara', 'SeijogakuenMae'],
  odakyu_seijo_noborito: ['SeijogakuenMae', 'Noborito'] });
const ORDER = ['Chiyoda.Hibiya', 'YoyogiUehara', 'ShimoKitazawa', 'Kyodo', 'SeijogakuenMae', 'Noborito', 'MukogaokaYuen'];
const EXCHANGE = new Set(ORDER.slice(1, -1));
const TYPE = Object.freeze({ '各停': 'Local', '各駅停車': 'Local', '急行': 'Express', '快速急行': 'RapidExpress' });
const DESTINATION = Object.freeze({ YoyogiUehara: '代々木上原', SeijogakuenMae: '成城学園前',
  MukogaokaYuen: '向ヶ丘遊園', Karakida: '唐木田', HonAtsugi: '本厚木', Isehara: '伊勢原',
  SagamiOno: '相模大野', Abiko: '我孫子', Toride: '取手', Ayase: '綾瀬' });
const known = Number.isInteger;
const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const dateOf = epoch => new Date((epoch + 32400) * 1000).toISOString().slice(0, 10);
const dayOf = epoch => Math.floor((epoch + 32400) / 86400) * 86400 - 32400;
const minuteOf = epoch => Math.floor((epoch - dayOf(epoch)) / 60);

export function normalizeCommuteTrips(artifact) {
  validateKazuStatic(artifact);
  const groups = new Map();
  for (const leg of artifact.legs) {
    if (!SEGMENTS[leg.segment]) continue;
    const operator = leg.segment === 'chiyoda' ? 'metro' : 'odakyu';
    const key = `${operator}:${leg.calendarType}:${leg.trainId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(leg);
  }
  const trips = [], rejected = [];
  for (const [id, legs] of groups) {
    const stops = new Map(), first = legs[0]; let conflict = false;
    for (const leg of legs) {
      if (leg.trainType !== first.trainType || leg.destination !== first.destination) conflict = true;
      const [from, to] = SEGMENTS[leg.segment];
      for (const [station, field, time] of [[from, 'departure', leg.departure],
        [to, leg.stationTimeSource === 'arrival' ? 'arrival' : 'departure', leg.stationTime]]) {
        if (!stops.has(station)) stops.set(station, { station, index: ORDER.indexOf(station), stop: true, arrival: null, departure: null });
        const stop = stops.get(station), value = minutes(time);
        if (stop[field] !== null && stop[field] !== value) conflict = true;
        stop[field] = value;
      }
    }
    const ordered = [...stops.values()].sort((a, b) => a.index - b.index);
    for (let i = 0; i < ordered.length; i++) {
      const stop = ordered[i], previous = ordered[i - 1];
      if (known(stop.arrival) && known(stop.departure) && stop.arrival > stop.departure
        || previous && (previous.departure ?? previous.arrival) > (stop.arrival ?? stop.departure)) conflict = true;
    }
    if (conflict) { rejected.push(id); continue; }
    trips.push({ id, providerId: first.trainId, calendar: first.calendarType, type: TYPE[first.trainType] || first.trainType,
      typeLabel: first.trainType, destination: DESTINATION[first.destination] || first.destination,
      datasetId: artifact.sourceCheckedAt, dataKind: 'saved_static', identityBasis: 'provider_id', stops: ordered,
      sources: [...new Set(legs.map(l => l.source))],
      ...(id.startsWith('metro:') ? { approach: { terminatesAtUehara: first.destination === 'YoyogiUehara' },
        boundary: { identity: 'unknown' } } : {}) });
  }
  return { trips, rejected };
}

export function decisionStations(train, nowMinute) {
  return train.stops.filter(s => s.stop === true && EXCHANGE.has(s.station) && known(s.arrival)
    && (s.arrival >= nowMinute || known(s.departure) && s.departure >= nowMinute))
    .map(s => ({ id: s.station, name: COMMUTE_STATIONS[s.station], arrival: hhmm(s.arrival),
      arrivalMinute: s.arrival, departureMinute: s.departure }));
}

export function createCommuteOnboardService({ artifact, loadBuses, clock = () => Date.now() / 1000 }) {
  const { trips, rejected } = normalizeCommuteTrips(artifact);
  const context = () => {
    const now = clock(), serviceDate = dateOf(now);
    const calendarType = artifact.calendarOverrides?.[serviceDate]
      || ([0, 6].includes(new Date((now + 32400) * 1000).getUTCDay()) ? 'weekend' : 'weekday');
    return { now, minute: minuteOf(now), day: dayOf(now), serviceDate, calendarType,
      referenceDate: artifact.sourceDates?.[calendarType] ?? null,
      timetableCheckedAt: artifact.sourceCheckedAt, currentTimetableVerified: false };
  };
  const available = c => trips.filter(t => t.calendar === c.calendarType && decisionStations(t, c.minute).length
    && t.stops[0].departure <= c.minute + 60 && (t.stops.at(-1).arrival ?? 0) >= c.minute);
  const describe = (train, c) => ({ id: `${c.serviceDate}:${train.id}`, serviceDate: c.serviceDate,
    providerId: train.providerId, type: train.typeLabel,
    destination: train.destination, origin: COMMUTE_STATIONS[train.stops[0].station],
    departure: hhmm(train.stops[0].departure), boarded: train.stops[0].departure <= c.minute,
    decisionStations: decisionStations(train, c.minute), onwardIdentity: train.boundary?.identity ?? 'within_provider' });
  return Object.freeze({
    getTrainChoices() {
      const c = context();
      return { ...c, trains: available(c).sort((a, b) => a.stops[0].departure - b.stops[0].departure)
        .map(t => describe(t, c)), rejectedTrips: rejected.length,
        coverage: { shinjuku: false, mukougaoka: false, throughIdentity: false } };
    },
    async evaluate({ trainId, stationId, target = 'home' }) {
      if (!['home', 'noborito', 'mukougaoka'].includes(target)) throw Error('COMMUTE_TARGET_INVALID');
      const c = context(), selected = available(c).find(t => `${c.serviceDate}:${t.id}` === trainId);
      const station = selected && decisionStations(selected, c.minute).find(s => s.id === stationId);
      if (!station) throw Error('COMMUTE_DECISION_STATION_INVALID_OR_PASSED');
      const decisionStop = selected.stops.find(s => s.station === station.id);
      const anchor = Math.max(c.minute, station.arrivalMinute);
      const names = new Map(trips.map(t => [t.id, t]));
      const results = ['Noborito', 'MukogaokaYuen'].map(destination => {
        const plan = planNavigation(trips, selected.id, destination, anchor,
          { strictArrival: true, decisionIndex: decisionStop.index, includeAllAlternatives: true });
        const baseline = plan.baseline?.arrival ?? null;
        const routes = [...(plan.baseline ? [plan.baseline] : []), ...plan.alternatives].map(route => {
          const ridden = [selected, ...route.legs.map(l => names.get(l.trainId))];
          return { ...route, id: `${destination}:${route.legs.length ? route.legs.map(l => `${l.station}:${l.trainId}:${l.departure}`).join('>') : 'stay'}`, destination, arrivalAt: c.day + route.arrival * 60,
            differenceMinutes: baseline === null ? null : route.arrival - baseline,
            usesRapidExpress: ridden.some(t => t.type === 'RapidExpress'),
            legs: route.legs.map(l => ({ ...l, stationName: COMMUTE_STATIONS[l.station],
              remaining: c.minute > l.alightTime, train: describe(names.get(l.trainId), c) })), buses: [] };
        });
        const reference = routes.find(r => r.transfers === 0) || routes.filter(r => !r.usesRapidExpress && r.connection === 'likely')
          .sort((a, b) => a.transfers - b.transfers || a.arrival - b.arrival)[0] || null;
        for (const route of routes) route.differenceMinutes = reference ? route.arrival - reference.arrival : null;
        return { destination, name: COMMUTE_STATIONS[destination], status: plan.status,
          baselineArrival: baseline, referenceRouteId: reference?.id ?? null, routes };
      });
      for (const result of target === 'home' ? results : []) {
        if (!result.routes.length) continue;
        const terminal = result.destination === 'Noborito' ? 'noborito' : 'mukougaoka';
        const earliest = Math.min(...result.routes.map(r => r.arrivalAt));
        // The same existing loader serves every route once; its freshness rules remain authoritative.
        let rows;
        const normalPlace = terminal === 'noborito' ? 'noborito-normal' : 'mukougaoka';
        try { rows = await loadBuses({ terminal, boardingAt: earliest + (HOME_RUSH_TRANSFER_MINUTES[normalPlace] ?? HOME_TRANSFER_MINUTES[normalPlace]) * 60, now: c.now }); }
        catch { result.busStatus = 'unavailable'; continue; }
        if (!Array.isArray(rows)) { result.busStatus = 'unavailable'; continue; }
        result.busStatus = 'available';
        result.busUnavailableSources = rows.unavailableSources || [];
        for (const route of result.routes) {
          const valid = rows.filter(bus => Number.isFinite(bus.departureAt)
            && ['scheduled'].includes(bus.departureState ?? 'scheduled')
            && (bus.recommendable === true || bus.estimatedArrival === null && bus.timingQuality === 'arrival_unknown'));
          route.buses = valid.map(bus => {
            const place = bus.queryId === 'noborito_tamagawa_to_kibukihoncho' ? 'noborito-tamagawa' : normalPlace;
            const normal = HOME_TRANSFER_MINUTES[place], rush = HOME_RUSH_TRANSFER_MINUTES[place] ?? normal;
            const gap = Math.floor((bus.departureAt - route.arrivalAt) / 60);
            const walkMinutes = gap >= normal ? normal : rush;
            return { ...bus, boardingAt: route.arrivalAt + walkMinutes * 60, walkMinutes, waitMinutes: Math.floor((bus.departureAt - route.arrivalAt) / 60) - walkMinutes,
              transferMode: gap >= normal ? 'normal' : 'rush', connection: gap > normal ? 'likely' : 'tight',
              homeArrivalAt: Number.isFinite(bus.estimatedArrival) ? bus.estimatedArrival : null };
          }).filter(bus => bus.waitMinutes >= 0 && bus.departureAt >= c.now)
            .sort((a, b) => a.departureAt - b.departureAt).slice(0, 2);
        }
        const stay = result.routes.find(r => r.id === result.referenceRouteId);
        for (const route of result.routes) {
          route.sameBusAsStay = Boolean(stay?.buses[0]?.tripId && route.buses[0]?.tripId
            && stay.buses[0].provider === route.buses[0].provider && stay.buses[0].tripId === route.buses[0].tripId
            && stay.buses[0].departureAt === route.buses[0].departureAt);
          route.homeDifferenceMinutes = Number.isFinite(stay?.buses[0]?.homeArrivalAt) && Number.isFinite(route.buses[0]?.homeArrivalAt)
            ? Math.round((route.buses[0].homeArrivalAt - stay.buses[0].homeArrivalAt) / 60) : null;
        }
      }
      return { ...c, target, selectedTrain: describe(selected, c), decisionStation: station, results,
        coverage: { shinjuku: false, mukougaoka: false, throughIdentity: false } };
    }
  });
}

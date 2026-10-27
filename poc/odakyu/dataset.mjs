// Contract for locally supplied, explicit trip timetables. No provider fetch or time-based joins.
export function validateDataset(input) {
  const d = structuredClone(input);
  const fail = () => { throw Error('DATASET_INVALID'); };
  const time = t => t === null || Number.isInteger(t) && t >= 0 && t < 2880;
  if (d?.schemaVersion !== 1 || !['demo', 'additional'].includes(d.kind) || typeof d.id !== 'string'
      || !d.id || d.timezone !== 'Asia/Tokyo' || !Array.isArray(d.stations) || !d.stations.length
      || !Array.isArray(d.trips) || !d.trips.length || d.trips.length > 5000) fail();
  if (d.serviceDates !== undefined && (!Array.isArray(d.serviceDates) || d.serviceDates.some(date => typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)))) fail();
  if (d.kind === 'additional' && (d.rights?.status !== 'confirmed' || d.rights?.useScope !== 'local-only'
      || typeof d.rights?.evidenceRef !== 'string' || !d.rights.evidenceRef.trim()
      || !Number.isFinite(Date.parse(d.rights.validUntil)) || Date.parse(d.rights.validUntil) < Date.now())) throw Error('DATASET_RIGHTS_UNCONFIRMED');
  if (d.kind === 'demo' && d.rights?.status !== 'synthetic') fail();
  const stations = new Map(), ids = new Set(), indices = new Set();
  for (const station of d.stations) {
    if (typeof station.id !== 'string' || !station.id || typeof station.name !== 'string' || !station.name || !Number.isInteger(station.index) || station.index < 0 || stations.has(station.id) || indices.has(station.index)) fail();
    stations.set(station.id, station); indices.add(station.index);
  }
  d.stations.sort((a, b) => a.index - b.index);
  for (const t of d.trips) {
    if (typeof t.id !== 'string' || !t.id || ids.has(t.id) || !['Weekday', 'SaturdayHoliday'].includes(t.calendar)
        || !['Local', 'SemiExpress', 'Express', 'RapidExpress'].includes(t.type)
        || typeof t.destination !== 'string' || !t.destination || !Array.isArray(t.stops) || !t.stops.length
        || !['provider_id', 'explicit_trip'].includes(t.identityBasis)) fail();
    ids.add(t.id); t.datasetId = d.id; t.dataKind = d.kind;
    if (d.kind === 'demo' && !t.id.startsWith('demo:') || d.kind !== 'demo' && t.id.startsWith('demo:')) fail();
    let lastIndex = -1, lastTime = -1;
    for (const s of t.stops) {
      if (!stations.has(s.station) || s.index !== stations.get(s.station).index || s.index <= lastIndex
          || typeof s.stop !== 'boolean' || !time(s.arrival) || !time(s.departure)
          || s.stop && s.arrival === null && s.departure === null
          || !s.stop && (s.arrival !== null || s.departure !== null)
          || s.arrival !== null && s.departure !== null && s.arrival > s.departure) fail();
      if (s.stop) {
        const first = s.arrival ?? s.departure, last = s.departure ?? s.arrival;
        if (first < lastTime) fail(); lastTime = last;
      }
      lastIndex = s.index;
    }
    if (!t.stops[0].stop || t.origin !== t.stops[0].station || !Array.isArray(t.knownPasses) || t.knownPasses.some(id => !stations.has(id) || t.stops.some(s => s.station === id && s.stop))) fail();
    if (t.boundary && (!stations.has(t.boundary.station) || !['explicit', 'unknown'].includes(t.boundary.identity))) fail();
  }
  const byId = new Map(d.trips.map(t => [t.id, t]));
  for (const t of d.trips) if (t.continuation) {
    const link = t.continuation, next = byId.get(link.nextTripId), end = t.stops.at(-1), begin = next?.stops[0];
    if (link.evidence !== 'explicit_same_train' || !next || next.id === t.id || next.calendar !== t.calendar
        || end.station !== link.station || begin.station !== link.station || !end.stop || !begin.stop
        || end.arrival === null || begin.departure === null || end.arrival > begin.departure
        || t.boundary?.identity === 'unknown') fail();
    const seen = new Set([t.id]); let cursor = next;
    while (cursor) { if (seen.has(cursor.id)) fail(); seen.add(cursor.id); cursor = byId.get(cursor.continuation?.nextTripId); }
  }
  if (d.example && (!ids.has(d.example.selectedId) || !Number.isInteger(d.example.compareAt) || d.example.compareAt < 0 || d.example.compareAt >= 2880 || d.example.destination !== undefined && !['Noborito', 'MukogaokaYuen'].includes(d.example.destination))) fail();
  return d;
}

export function datasetModel(dataset) {
  const d = validateDataset(dataset);
  return { schemaVersion: 1, timezone: d.timezone, stations: d.stations, trips: d.trips, departures: [],
    dataset: { id: d.id, kind: d.kind, title: d.title || d.id, rights: { status: d.rights.status, useScope: d.rights.useScope, validUntil: d.rights.validUntil }, serviceDates: d.serviceDates || [],
      coverage: d.coverage || '明示着発のみ', dailyReady: false },
    capabilities: { realtimePosition: false, delay: false },
    reconstruction: { accepted: d.trips.length, departureChecks: 0, departureMismatches: 0 },
    arrivalVerification: { status: 'not_checked', matched: 0, mismatched: 0 }, example: d.example || null };
}

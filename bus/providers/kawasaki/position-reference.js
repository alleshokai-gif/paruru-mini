// Optional complete stop-chain sidecar, never constructed from the two P0 endpoints.
// No GPS matching, sequence interpretation, shape snapping or public DTO work happens here.
export function createPositionStaticResolver(source = null) {
  return (index, tripId) => {
    if (!source || source.sourceVersion !== (index.sourceVersion ?? index.feedInfo?.feed_version)) return null;
    const trip = source.trips?.[tripId];
    if (!trip || trip.tripId !== tripId || trip.complete !== true || !Array.isArray(trip.stops) || trip.stops.length < 2) return null;
    const rows = index.rows ?? Object.values(index.directions || {}).flat();
    if (!rows.some(r => r.tripId === tripId && r.routeId === trip.routeId)) return null;
    let previous = -1;
    for (const stop of trip.stops) {
      if (!stop.stopId || !Number.isInteger(stop.sequence) || stop.sequence <= previous) return null;
      previous = stop.sequence;
      for (const [axis, bound] of [['lat', 90], ['lon', 180]]) {
        const value = stop.position?.[axis];
        if (value !== null && (!Number.isFinite(value) || Math.abs(value) > bound)) return null;
      }
    }
    return { tripId, routeId: trip.routeId, shapeId: typeof trip.shapeId === 'string' ? trip.shapeId : null,
      stops: trip.stops.map(s => ({ stopId: s.stopId, sequence: s.sequence,
        position: { lat: s.position.lat, lon: s.position.lon } })) };
  };
}

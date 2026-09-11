// Query selection is above Providers. The legacy directions keys are storage keys only.
const indexes = new WeakMap(), selections = new WeakMap();
const fail = (code) => { throw Error(code); };
const text = value => typeof value === 'string' && value.trim().length > 0;
const ids = value => Array.isArray(value) && value.length > 0 && value.every(text) && new Set(value).size === value.length;

export function validateProviderContext(context) {
  if (!text(context?.id) || typeof context.platformResolver !== 'function'
    || !Number.isInteger(context.realtimeSchemaVersion) || context.realtimeSchemaVersion < 1
    || !['provider', 'distributor', 'url'].every(k => text(context.attribution?.[k]))) fail('BUS_PROVIDER_CONTEXT_INVALID');
}
function candidates(index) {
  if (indexes.has(index)) return indexes.get(index);
  const byFrom = new Map(), unique = new Map();
  for (const row of index.rows ?? Object.values(index.directions || {}).flat()) {
    const key = JSON.stringify([row.tripId, row.serviceId, row.fromStopId, row.toStopId, row.stopSequence, row.alightSequence]);
    if (unique.has(key)) {
      if (JSON.stringify(unique.get(key)) !== JSON.stringify(row)) fail('BUS_STATIC_AMBIGUOUS');
      continue;
    }
    unique.set(key, row);
    if (!byFrom.has(row.fromStopId)) byFrom.set(row.fromStopId, []);
    byFrom.get(row.fromStopId).push(row);
  }
  indexes.set(index, byFrom); return byFrom;
}

export function resolveQuerySet(index, queries, providerContext) {
  validateProviderContext(providerContext);
  if (!Array.isArray(queries) || !queries.length) fail('BUS_QUERIES_REQUIRED');
  const queryIds = new Set();
  for (const q of queries) {
    if (q?.type !== 'favorite') fail('BUS_QUERY_TYPE_UNSUPPORTED');
    if (!text(q.id) || !text(q.label) || queryIds.has(q.id) || !ids(q.fromStopIds) || !ids(q.toStopIds) || !ids(q.routeIds)
      || ['group', 'from', 'to'].some(k => q[k] != null && !text(q[k]))) fail('BUS_QUERY_INVALID');
    if (q.provider !== providerContext.id) fail('BUS_QUERY_PROVIDER_MISMATCH');
    for (const id of [...q.fromStopIds, ...q.toStopIds]) if (index.stops?.[id]?.stopId !== id) fail('BUS_QUERY_STOP_UNSUPPORTED');
    for (const id of q.routeIds) if (index.routes?.[id]?.routeId !== id) fail('BUS_QUERY_ROUTE_UNSUPPORTED');
    queryIds.add(q.id);
  }
  // One cached selection per immutable index, so changing Query content cannot reuse stale results.
  const signature = JSON.stringify(queries), old = selections.get(index);
  if (old?.signature === signature && old.provider === providerContext.id) return old.value;
  const byFrom = candidates(index);
  const value = queries.map(q => {
    const groups = new Map(), trips = new Set();
    for (const from of q.fromStopIds) for (const row of byFrom.get(from) || []) {
      if (!q.toStopIds.includes(row.toStopId) || !q.routeIds.includes(row.routeId)) continue;
      if (trips.has(row.tripId)) fail('BUS_QUERY_AMBIGUOUS_VISIT');
      trips.add(row.tripId);
      if (!groups.has(row.serviceId)) groups.set(row.serviceId, []);
      groups.get(row.serviceId).push(row);
    }
    if (!groups.size) fail('BUS_QUERY_STATIC_UNAVAILABLE');
    const names = stopIds => [...new Set(stopIds.map(id => index.stops[id].name))].join(' / ');
    return { query: { id: q.id, provider: q.provider, group: q.group ?? null,
      from: q.from ?? names(q.fromStopIds), to: q.to ?? names(q.toStopIds) }, groups };
  });
  selections.set(index, { signature, provider: providerContext.id, value }); return value;
}

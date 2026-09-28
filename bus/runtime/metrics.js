import { AsyncLocalStorage } from 'node:async_hooks';
export const requestMetrics = new AsyncLocalStorage();
export function recordStages(values) {
  const current = requestMetrics.getStore();
  if (!current) return;
  for (const key of ['staticMs', 'realtimeMs', 'positionMs', 'departureMs', 'joinMs', 'totalMs', 'odptFetchMs', 'rtDecodeMs', 'odptFetches']) {
    if (Number.isFinite(values[key])) current[key] = values[key];
  }
  const shadow = values.shadowPosition;
  if (shadow && Number.isInteger(shadow.evaluated) && Number.isInteger(shadow.supported)) {
    const safe = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,100}$/.test(value);
    current.shadowPosition = { feedVehicleCount: Number.isInteger(shadow.feedVehicleCount)
      ? shadow.feedVehicleCount : null, evaluated: shadow.evaluated, supported: shadow.supported,
      details: (shadow.details || []).filter(row => safe(row.tripId) && safe(row.routeId)
        && safe(row.targetStopId) && (row.reason == null || safe(row.reason)))
        .slice(0, 12).map(row => ({ tripId: row.tripId, routeId: row.routeId,
          targetStopId: row.targetStopId, supported: row.supported === true,
          reason: row.reason ?? null })) };
  }
}

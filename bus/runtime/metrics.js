import { AsyncLocalStorage } from 'node:async_hooks';
export const requestMetrics = new AsyncLocalStorage();
export function recordStages(values) {
  const current = requestMetrics.getStore();
  if (!current) return;
  for (const key of ['staticMs', 'realtimeMs', 'joinMs', 'totalMs', 'odptFetchMs', 'rtDecodeMs', 'odptFetches']) {
    if (Number.isFinite(values[key])) current[key] = values[key];
  }
}

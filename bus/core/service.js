import { getArrivals } from './arrivals.js';
import { LIMITS } from '../config/settings.js';

export function createBusService({ index, adapter, cache = null, now = () => Date.now() / 1000, version, provider = 'kawasaki', measure = () => {} }) {
  const memory = new Map(), pending = new Map(), retryAfter = new Map();
  async function load(kind, refresh, maxAge, loader) {
    if (pending.has(kind)) return pending.get(kind);
    const task = (async () => {
      const key = `${provider}:${version}:${kind}`;
      let previous = memory.get(kind);
      if (!previous && cache) {
        try {
          const data = await cache.read(key);
          if (data) {
            if (data.schemaVersion === 1 && Number.isFinite(data.fetchedAt)) previous = data;
          }
        } catch { /* Cache eviction/failure is independent of the upstream source. */ }
      }
      if (previous) memory.set(kind, previous);
      const age = previous ? now() - previous.fetchedAt : Infinity;
      if (age >= 0 && age < refresh) return { data: previous, error: false, stale: false };
      if ((retryAfter.get(kind) || 0) > now()) {
        if (previous && age <= maxAge) return { data: previous, error: true, stale: true };
        throw new Error('BUS_SOURCE_UNAVAILABLE');
      }
      try {
        const data = await loader(); memory.set(kind, data);
        retryAfter.delete(kind);
        if (cache) {
          try { await cache.write(key, data, maxAge); } catch { /* In-memory result is still usable. */ }
        }
        return { data, error: false, stale: false };
      } catch {
        retryAfter.set(kind, now() + LIMITS.rtCacheSec);
        if (previous && age >= 0 && age <= maxAge) return { data: previous, error: true, stale: true };
        throw new Error('BUS_SOURCE_UNAVAILABLE');
      }
    })();
    pending.set(kind, task);
    try { return await task; } finally { pending.delete(kind); }
  }
  return {
    async getArrivals() {
      const started = performance.now();
      // This is an object reference. There is no network/file/ZIP/CSV work for Static here.
      const staticIndex = index;
      const staticMs = performance.now() - started;
      const rtStarted = performance.now();
      let rt;
      try { rt = await load('realtime', LIMITS.rtCacheSec, LIMITS.feedMaxAgeSec, () => adapter.getRealtime()); }
      catch { rt = { data: null, error: true }; }
      const realtimeMs = performance.now() - rtStarted;
      const joinStarted = performance.now();
      const data = getArrivals({ index: staticIndex, realtime: rt.data, now: now(), fetchError: rt.error });
      measure({ staticMs, realtimeMs, joinMs: performance.now() - joinStarted, totalMs: performance.now() - started });
      return data;
    }
  };
}

// Legacy Workers persistence adapter. Cloud Run uses core/service.js directly.
import { createBusService as createSharedService } from '../core/service.js';
export function createBusService(options) {
  const cache = options.cache ? {
    async read(key) {
      const response = await options.cache.match(new Request(`https://paluru-bus-cache.invalid/v2/${encodeURIComponent(key)}`));
      return response ? response.json() : null;
    },
    async write(key, data, maxAge) {
      await options.cache.put(new Request(`https://paluru-bus-cache.invalid/v2/${encodeURIComponent(key)}`),
        new Response(JSON.stringify(data), { headers: { 'Cache-Control': `max-age=${maxAge}`, 'Content-Type': 'application/json' } }));
    }
  } : null;
  return createSharedService({ ...options, cache });
}

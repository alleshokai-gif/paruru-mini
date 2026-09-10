// Measurement-only composition root. Never selected by production Wrangler config.
// Invoked sequentially by remote-probe.js; response headers contain timings/counts only.
import index from '../generated/p0-static.json' with { type: 'json' };
import { createWorker } from '../worker/index.js';
import { createBusService } from '../worker/service.js';
import { createKawasakiAdapter } from '../providers/kawasaki/adapter.js';
import { prepareStatic } from '../core/arrivals.js';
prepareStatic(index);
let service, measurements;
const worker = createWorker((env) => {
  if (!service) {
    const upstream = createKawasakiAdapter({ token: env.ODPT_ACCESS_TOKEN });
    service = createBusService({ index, cache: caches.default, version: index.sourceHash,
      adapter: { async getRealtime() {
        measurements.odptFetches++;
        const start = performance.now();
        try { return await upstream.getRealtime(); }
        finally { measurements.odptFetchDecodeMs = performance.now() - start; }
      } }, measure: (values) => Object.assign(measurements, values) });
  }
  return service;
});
export default {
  async fetch(request, env) {
    measurements = { odptFetches: 0, odptFetchDecodeMs: 0 };
    const response = await worker.fetch(request, env);
    const headers = new Headers(response.headers);
    headers.set('X-Bus-Probe-Timing', JSON.stringify(measurements));
    return new Response(response.body, { status: response.status, headers });
  }
};

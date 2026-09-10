// Local workerd integration with synthetic protobuf; no network or real credential.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import bindings from 'gtfs-realtime-bindings';
import { Miniflare, Log, LogLevel, convertV4MiniflareOptions } from 'miniflare';
import { NOW, indexFixture, realtimeFixture } from '../test/fixtures.js';

let runtime;
try {
  const prod = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  const index = indexFixture();
  for (const rows of Object.values(index.directions)) {
    const row = rows[0];
    rows.push({ ...row, tripId: `${row.tripId}-next`, scheduledSeconds: row.scheduledSeconds + 600 },
      { ...row, tripId: `${row.tripId}-third`, scheduledSeconds: row.scheduledSeconds + 1200 });
  }
  const rt = realtimeFixture();
  const bytes = bindings.transit_realtime.FeedMessage.encode({ header: { gtfsRealtimeVersion: '2.0', timestamp: NOW },
    entity: rt.updates.map((u, i) => ({ id: `synthetic-${i}`, tripUpdate: { trip: u.trip, timestamp: NOW,
      stopTimeUpdate: u.stops.map((s) => ({ stopId: s.stopId, stopSequence: s.sequence, departure: s.departure })) } })) }).finish();
  const source = `import { createWorker } from './worker/index.js';
    import { createBusService } from './worker/service.js';
    import { createKawasakiAdapter } from './providers/kawasaki/adapter.js';
    const index = ${JSON.stringify(index)};
    let service;
    export default createWorker(env => service ??= createBusService({index, version:'synthetic', now:()=>${NOW},
      adapter:createKawasakiAdapter({token:env.ODPT_ACCESS_TOKEN, now:()=>${NOW}})}));`;
  const bundle = await build({ stdin: { contents: source, resolveDir: fileURLToPath(new URL('../', import.meta.url)) },
    bundle: true, write: false, format: 'esm', platform: 'browser', logLevel: 'silent' });
  const results = [];
  for (const scenario of ['realtime', 'upstream-failure']) {
    let fetches = 0;
    runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text,
      compatibilityDate: prod.compatibility_date, log: new Log(LogLevel.NONE),
      bindings: { ...prod.vars, ODPT_ACCESS_TOKEN: 'synthetic-only' }, outboundService: async (request) => {
        fetches++;
        assert.equal(new URL(request.url).pathname, '/api/v4/gtfs/realtime/odpt_TransportationBureau_CityOfKawasaki_AllLines_trip_update');
        return scenario === 'realtime' ? new Response(bytes) : new Response(null, { status: 503 });
      } }));
    await runtime.ready;
    const call = (origin = prod.vars.ALLOWED_ORIGINS) => runtime.dispatchFetch('https://bus.example/api/bus/arrivals', { headers: { Origin: origin } });
    for (let i = 0; i < 2; i++) {
      const response = await call(); assert.equal(response.status, 200);
      assert.equal(response.headers.get('Access-Control-Allow-Origin'), prod.vars.ALLOWED_ORIGINS);
      const data = await response.json(); assert.equal(data.directions.length, 4); assert.equal(data.positionUiEnabled, false);
      assert.equal(data.fetchError, scenario !== 'realtime');
      for (const d of data.directions) {
        assert.equal(d.arrivals.length, 3);
        const first = d.arrivals[0]; assert.equal(first.realtime, scenario === 'realtime');
        assert.equal(first.scheduledTime, '07:54');
        assert.equal(first.estimatedTime, scenario === 'realtime' ? '07:57' : null);
        assert.equal(first.delayMinutes, scenario === 'realtime' ? 3 : null);
        assert.equal(first.etaMinutes, scenario === 'realtime' ? 7 : null);
        assert.equal(first.position.supported, false);
      }
    }
    assert.equal(fetches, 1); // Both success cache and failure backoff suppress a second upstream call.
    for (const origin of ['http://localhost:8788', 'https://wrong.example', '*']) assert.equal((await call(origin)).status, 403);
    results.push({ scenario, directions: 4, rowsPerDirection: 3, rtFetches: fetches, productionCors: 'PASS' });
    await runtime.dispose(); runtime = null;
  }
  console.log(JSON.stringify({ status: 'WORKER_INTEGRATION_PASS', results, realNetworkRequests: 0 }));
} catch { console.log('{"error":"WORKER_INTEGRATION_FAILED"}'); process.exitCode = 1; }
finally { await runtime?.dispose(); }

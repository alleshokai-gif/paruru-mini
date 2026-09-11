import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { getArrivals, iso } from '../core/arrivals.js';
import { indexFixture, realtimeFixture, NOW } from '../test/fixtures.js';
import { P0_INPUT } from '../test/fixtures.js';
import { readLocalConfig } from './local-config.js';
const config = readLocalConfig();
const uiOrigin = new URL(config.vars.ALLOWED_ORIGINS.split(',')[0]);
const apiUrl = `http://${config.dev.ip}:${config.dev.port}/api/bus/arrivals`;
// An allowlist, not a repository file server: .dev.vars, server code and dependencies are never exposed.
const files = new Map([
  ['/', ['../test/browser.html', 'text/html']],
  ['/browser-harness.js', ['../test/browser-harness.js', 'text/javascript']],
  ['/features/bus/bus.js', ['../../features/bus/bus.js', 'text/javascript']],
  ['/features/bus/bus.css', ['../../features/bus/bus.css', 'text/css']],
  ['/style.css', ['../../style.css', 'text/css']]
]);
const server = createServer(async (request, response) => {
  try {
    response.setHeader('Cache-Control', 'no-store');
    if (request.method !== 'GET') { response.writeHead(405).end(); return; }
    if (request.url === '/features/bus/config.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(`globalThis.PALURU_BUS_API_URL=${JSON.stringify(apiUrl)};`); return;
    }
    if (['/fixture/fixture', '/fixture/static', '/fixture/stale', '/fixture/error'].includes(request.url)) {
      response.setHeader('Content-Type', 'application/json');
      if (request.url === '/fixture/error') { response.writeHead(503).end('{"success":false}'); return; }
      const data = getArrivals({ index: indexFixture(), realtime: request.url === '/fixture/static' ? null : realtimeFixture(), now: NOW, ...P0_INPUT });
      // Keep deterministic service-date fixtures in the future relative to receipt; UI uses generatedAt.
      for (const d of data.directions) {
        const row = d.arrivals[0];
        d.arrivals = [0, 1, 2].map((i) => ({ ...structuredClone(row), tripId: `${row.tripId}:${i}`,
          scheduledAt: iso(Date.parse(row.scheduledAt) / 1000 + i * 600), scheduledTime: ['07:54', '08:04', '08:14'][i],
          estimatedAt: row.estimatedAt ? iso(Date.parse(row.estimatedAt) / 1000 + i * 600) : null }));
        if (request.url === '/fixture/stale') { d.state = 'realtime_stale'; d.dataAgeSec = 200; }
      }
      if (request.url === '/fixture/stale') data.fetchError = true;
      response.end(JSON.stringify(data)); return;
    }
    const entry = files.get(request.url);
    if (!entry) { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type', `${entry[1]}; charset=utf-8`);
    response.end(await readFile(new URL(entry[0], import.meta.url)));
  } catch { response.writeHead(500).end('LOCAL_UI_ERROR'); }
});
server.listen(Number(uiOrigin.port), uiOrigin.hostname, () => console.log(`BUS_LOCAL_UI_READY ${uiOrigin.host}`));

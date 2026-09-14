import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { getArrivals, iso } from '../core/arrivals.js';
import { indexFixture, realtimeFixture, NOW } from '../test/fixtures.js';
import { P0_INPUT } from '../test/fixtures.js';
import { readLocalConfig } from './local-config.js';
const config = readLocalConfig();
const uiOrigin = new URL(config.vars.ALLOWED_ORIGINS.split(',')[0]);
const apiUrl = `http://${config.dev.ip}:${config.dev.port}/api/bus/arrivals`;
function journeyFixture() {
  const now = Math.floor(Date.now() / 1000);
  const arrival = (id, provider, minutes) => ({ id, sourceId: provider === 'tokyu'
    ? 'mukougaoka_to_kibukihoncho' : id.startsWith('n') ? 'noborito_to_home' : 'mukougaoka_to_kibukihoncho',
    provider, routeId: provider === 'tokyu' ? 'odpt.Busroute:TokyuBus.Kou01' : id.startsWith('n') ? '10044' : '10037',
    routeLabel: provider === 'tokyu' ? '向０１' : id.startsWith('n') ? '登０５' : '溝１９',
    destination: provider === 'tokyu' ? '梶が谷駅' : id.startsWith('n') ? '菅生車庫(蔵敷)' : '溝口駅南口(おし沼)',
    originStop: { id: provider === 'tokyu' ? 'odpt.BusstopPole:TokyuBus.MukougaokayuuenEkiminamiguchi.00240650.6'
      : id.startsWith('n') ? '362_1' : '474_5', name: id.startsWith('n') ? '登戸駅' : '向ヶ丘遊園駅南口' },
    targetStop: { id: '184_1', name: '神木本町' }, scheduledDeparture: now + minutes * 60,
    estimatedDeparture: provider === 'tokyu' ? null : now + (minutes + 2) * 60, effectiveDeparture: null,
    etaMinutes: provider === 'tokyu' ? null : minutes + 2, delayMinutes: provider === 'tokyu' ? null : 2,
    platform: provider === 'tokyu' ? '6' : id.startsWith('n') ? '登05のりば' : '5番',
    realtimeState: provider === 'tokyu' ? 'static_only' : 'realtime', departureState: 'scheduled',
    actionability: provider === 'tokyu' ? null : 'catchable', confidence: null,
    recommendable: true, recommendationQuality: provider === 'tokyu' ? 'static_only' : 'realtime',
    rankingBasis: provider === 'tokyu' ? 'scheduled_departure' : 'eta', rankingTime: now + minutes * 60,
    recommendationTier: provider === 'tokyu' ? 2 : 0,
    position: { supported: false, state: null, stopsAway: null, previousStop: null, nextStop: null, confidence: null } });
  const noborito = [arrival('n1', 'kawasaki', 4), arrival('n2', 'kawasaki', 14), arrival('n3', 'kawasaki', 24)];
  const mukougaoka = [arrival('m1', 'kawasaki', 5), arrival('m2', 'tokyu', 9), arrival('m3', 'kawasaki', 17)];
  return { success: true, journeyGroupId: 'noborito-mukougaoka', journeyGroupLabel: '登戸・遊園', generatedAt: now,
    children: [{ id: 'noborito', hubId: 'noborito-eki', label: '登戸駅', purposeLabel: '神木本町方面', state: 'available',
      providers: [], decisionGroup: { id: 'noborito_kibukihoncho', recommendedArrivalId: 'n1', arrivals: noborito } },
    { id: 'mukougaoka', hubId: 'mukougaoka-yuen-minamiguchi', label: '向ヶ丘遊園駅南口', purposeLabel: '神木本町方面',
      state: 'available', providers: [], decisionGroup: { id: 'mukougaoka_kibukihoncho', recommendedArrivalId: 'm1', arrivals: mukougaoka } }],
    attributions: [] };
}
// An allowlist, not a repository file server: .dev.vars, server code and dependencies are never exposed.
const files = new Map([
  ['/', ['../test/browser.html', 'text/html']],
  ['/browser-harness.js', ['../test/browser-harness.js', 'text/javascript']],
  ['/features/bus/bus.js', ['../../features/bus/bus.js', 'text/javascript']],
  ['/features/bus/bus.css', ['../../features/bus/bus.css', 'text/css']],
  ['/features/bus/hub.js', ['../../features/bus/hub.js', 'text/javascript']],
  ['/features/bus/hub.css', ['../../features/bus/hub.css', 'text/css']],
  ['/features/bus/journey.js', ['../../features/bus/journey.js', 'text/javascript']],
  ['/features/bus/journey.css', ['../../features/bus/journey.css', 'text/css']],
  ['/style.css', ['../../style.css', 'text/css']]
]);
const server = createServer(async (request, response) => {
  try {
    response.setHeader('Cache-Control', 'no-store');
    if (request.method !== 'GET') { response.writeHead(405).end(); return; }
    if (request.url === '/features/bus/config.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(`globalThis.PALURU_BUS_API_URL=${JSON.stringify(apiUrl)};globalThis.PALURU_BUS_HUB_UI_ENABLED=true;globalThis.PALURU_BUS_LEGACY_UI_ENABLED=false;globalThis.PALURU_BUS_JOURNEY_UI_ENABLED=true;globalThis.PALURU_BUS_JOURNEYS=Object.freeze([Object.freeze({id:'noborito-mukougaoka',label:'登戸・遊園'})]);globalThis.PALURU_BUS_HUBS=Object.freeze([Object.freeze({id:'kibukihoncho',label:'神木本町',selectorLabel:'神木本町'}),Object.freeze({id:'mizonokuchi-minamiguchi',label:'溝の口駅南口',selectorLabel:'溝の口'}),Object.freeze({id:'tachikawa-ekikitaguchi',label:'立川駅北口',selectorLabel:'立川駅'}),Object.freeze({id:'showa-daiichi-gakuen',label:'昭和第一学園',selectorLabel:'学校'}),Object.freeze({id:'noborito-mukougaoka',label:'登戸・遊園',selectorLabel:'登戸・遊園',kind:'journey'})]);`); return;
    }
    if (request.url === '/fixture/journey') {
      response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(journeyFixture())); return;
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

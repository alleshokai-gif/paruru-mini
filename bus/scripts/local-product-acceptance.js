// Loopback-only product acceptance: real PALURU markup and Kawasaki GTFS, explicit synthetic rail/position input.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep, extname } from 'node:path';
import { mergeKawasakiStatic } from '../providers/kawasaki/journey-static.js';
import { P0_QUERIES } from '../config/queries.js';
import { KAWASAKI_JOURNEY_QUERIES } from '../providers/kawasaki/journey-config.js';
import { KAWASAKI_CONTEXT } from '../providers/kawasaki/context.js';
import { getFutureBuses } from '../journey/future-bus.js';
import { createHomeBusLoader } from '../journey/home-bus-loader.js';
import { compareHomeRoutes } from '../journey/home-route.js';
import { shadowPosition } from '../position/shadow.js';

const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const epoch = (time) => Date.parse(`2026-09-28T${time}:00+09:00`) / 1000;
const now = epoch('18:00');
const transferMinutes = Object.freeze({ 'noborito-normal': 8, 'noborito-tamagawa': 11,
  mukougaoka: 5, mizonokuchi: 6 }); // Test inputs, not measured transfer times.
const trains = Object.freeze({
  university: Object.freeze([{ id: 'university-test-1', label: 'テスト列車：登戸18:18・遊園18:21着',
    arrivals: { noborito: epoch('18:18'), mukougaoka: epoch('18:21') } }]),
  high_school: Object.freeze([{ id: 'school-test-1', label: 'テスト列車：登戸18:18・武蔵溝ノ口18:30着',
    arrivals: { noborito: epoch('18:18'), musashi_mizonokuchi: epoch('18:30') } }])
});
const p0 = JSON.parse(await readFile(new URL('../generated/p0-static.json', import.meta.url)));
const journey = JSON.parse(await readFile(new URL('../generated/kawasaki-p2-5-static.json', import.meta.url)));
const index = mergeKawasakiStatic(p0, journey);
const queries = [...P0_QUERIES, ...KAWASAKI_JOURNEY_QUERIES];
const sourceLoaders = Object.fromEntries([
  'noborito_to_home', 'noborito_tamagawa_to_kibukihoncho',
  'mukougaoka_to_kibukihoncho', 'mizonokuchi_to_home'
].map((id) => [`kawasaki:${id}`, ({ boardingAt }) => getFutureBuses({ index,
  queries: [queries.find((query) => query.id === id)], providerContext: KAWASAKI_CONTEXT,
  now, boardingAt, realtime: null }).results[0].arrivals]));
const loadBuses = createHomeBusLoader(sourceLoaders); // Tokyu is explicitly unavailable in this offline fixture.
let positionMode = 'safe', shadowEnabled = true;
const artifact = Object.freeze({ approvedForShadow: true, approvedForPublic: false, geometryReady: false });
const positionResult = () => shadowPosition({ supported: true, confidence: positionMode === 'safe' ? 0.92 : 0.4,
  method: 'gps_shape_snap', state: 'between_stops', conflicts: [],
  previousStop: { name: '長尾橋' }, nextStop: { name: '神木本町' }, stopsAway: 2 }, artifact);
const json = (response, value, status = 200) => {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
};
const hub = () => {
  const time = Math.floor(Date.now() / 1000);
  return { success: true, hubId: 'kibukihoncho', hubLabel: '神木本町', generatedAt: time,
    providers: [{ provider: 'kawasaki', state: 'available', retrievedAt: time, sourceUpdatedAt: time }],
    attributions: [{ provider: 'kawasaki', providerName: '川崎市交通局',
      distributor: '公共交通オープンデータセンター', url: 'https://www.odpt.org/' }],
    decisionGroups: [{ id: 'shadow-acceptance', hubId: 'kibukihoncho', label: '位置表示の受入用',
      destinations: ['登戸駅'], providers: ['kawasaki'], recommendedArrivalId: null,
      arrivals: [{ id: 'shadow-fixture', provider: 'kawasaki', routeLabel: '登０５', destination: '登戸駅',
        scheduledDeparture: time + 600, estimatedDeparture: null, etaMinutes: null,
        delayMinutes: null, realtimeState: 'static_fallback', platform: '2番',
        position: positionResult() }] }] };
};
const safeAsset = (pathname) => pathname === '/index.html' || pathname === '/style.css'
  || pathname === '/build.js' || pathname === '/app.js' || pathname === '/manifest.json'
  || /^\/(features|assets)\/[a-zA-Z0-9_./-]+$/.test(pathname)
    && !pathname.split('/').includes('..')
    && ['.js', '.css', '.png', '.svg', '.json', '.webp'].includes(extname(pathname));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const configOverride = () => `\n;globalThis.PALURU_BUS_API_URL='/api/bus/arrivals';
globalThis.PALURU_BUS_HOME_ROUTE_ENABLED=true;
globalThis.PALURU_BUS_POSITION_SHADOW_ENABLED=${shadowEnabled};
globalThis.PALURU_BUS_HUBS=Object.freeze([Object.freeze({id:'kibukihoncho',label:'神木本町',selectorLabel:'神木本町'})]);
globalThis.PALURU_BUS_HOME_ROUTE_SOURCE={
 getTrainChoices:async(journeyId)=>{const r=await fetch('/acceptance/trains?journeyId='+encodeURIComponent(journeyId));if(!r.ok)throw Error('TRAIN_UNAVAILABLE');return r.json()},
 evaluate:async({journeyId,trainId})=>{const r=await fetch('/acceptance/home-route?journeyId='+encodeURIComponent(journeyId)+'&trainId='+encodeURIComponent(trainId));if(!r.ok)throw Error('ROUTE_UNAVAILABLE');return r.json()}
};`;
const bootstrap = `<style>#splash,#authLock,#homeView,.bottom-nav,.app-topbar,.app-drawer{display:none!important}main.app-shell,#busView{display:block!important}body{overflow:auto!important}</style>
<div style="padding:8px;background:#fff3d0">ローカル製品受入：列車・位置は合成入力／バス時刻は公式GTFS</div>
<script>window.addEventListener('DOMContentLoaded',()=>{const v=document.querySelector('#busView');document.querySelector('.app-shell').style.setProperty('display','block','important');v.hidden=false;v.classList.add('is-active');window.PALURUBusHub?.setActive(true);window.PALURUBusHomeRoute?.setActive(true)})</script>`;
const server = createServer(async (request, response) => {
  try {
    if (request.method !== 'GET') return json(response, { error: 'METHOD_NOT_ALLOWED' }, 405);
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/acceptance/trains') return json(response, trains[url.searchParams.get('journeyId')] || []);
    if (url.pathname === '/acceptance/home-route') {
      const journeyId = url.searchParams.get('journeyId');
      const selectedTrain = trains[journeyId]?.find((train) => train.id === url.searchParams.get('trainId'));
      if (!selectedTrain) return json(response, { error: 'TRAIN_INVALID' }, 400);
      return json(response, await compareHomeRoutes({ journeyId, selectedTrain, transferMinutes, loadBuses, now }));
    }
    if (url.pathname === '/api/bus/hub' && url.searchParams.get('id') === 'kibukihoncho') return json(response, hub());
    if (url.pathname === '/features/bus/config.js') {
      const base = await readFile(resolve(root, 'features/bus/config.js'), 'utf8');
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(base + configOverride()); return;
    }
    if (url.pathname === '/') {
      positionMode = url.searchParams.get('position') === 'weak' ? 'weak' : 'safe';
      shadowEnabled = url.searchParams.get('shadow') !== 'off';
      const html = await readFile(resolve(root, 'index.html'), 'utf8');
      // The local acceptance page uses PALURU's exact Bus markup and assets, without starting its auth/GAS shell.
      const busOnly = html.replace(/<script src="\.\/[^\"]+" defer><\/script>/g, (tag) =>
        /features\/bus\/(config|bus|journey|hub|home-route)\.js/.test(tag) ? tag : '');
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(busOnly.replace('</body>', `${bootstrap}</body>`)); return;
    }
    if (!safeAsset(url.pathname)) return json(response, { error: 'NOT_FOUND' }, 404);
    const file = resolve(root, `.${url.pathname}`);
    if (!file.startsWith(root + sep)) return json(response, { error: 'NOT_FOUND' }, 404);
    const body = await readFile(file);
    response.writeHead(200, { 'Content-Type': `${mime[extname(file)] || 'application/octet-stream'}; charset=utf-8`,
      'Cache-Control': 'no-store' }); response.end(body);
  } catch { json(response, { error: 'LOCAL_ACCEPTANCE_UNAVAILABLE' }, 503); }
});
server.listen(8791, '127.0.0.1', () => console.log('BUS_PRODUCT_ACCEPTANCE_READY 127.0.0.1:8791'));

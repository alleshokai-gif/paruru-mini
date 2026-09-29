// PALURU Bus UI acceptance preview. Never included by index.html or a production build.
// Serves the feature-branch PALURU markup/CSS and read-only validation API through a local IAM proxy.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, resolve, sep } from 'node:path';
import { shadowPosition } from '../position/shadow.js';
import { mergeKawasakiStatic } from '../providers/kawasaki/journey-static.js';
import { P0_QUERIES } from '../config/queries.js';
import { KAWASAKI_JOURNEY_QUERIES } from '../providers/kawasaki/journey-config.js';
import { KAWASAKI_CONTEXT } from '../providers/kawasaki/context.js';
import { getFutureBuses } from '../journey/future-bus.js';
import { createHomeBusLoader } from '../journey/home-bus-loader.js';
import { compareHomeRoutes } from '../journey/home-route.js';
import { listRailTrains } from '../rail/static-provider.js';
import { attachJrNambuLocations, loadJrNambuLocations } from '../rail/jr-challenge-provider.js';

const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const port = Number(process.env.PALURU_BUS_PREVIEW_PORT || 8792);
const validationProxy = 'http://127.0.0.1:8789';
const scenarios = Object.freeze([
  ['live', '通常Bus（validation）'],
  ['tamagawa', '多摩川口・往復'],
  ['position-safe', 'バスロケ・位置表示'],
  ['position-weak', 'バスロケ・確認中'],
  ['position-off', 'バスロケ・OFF'],
  ['five', '帰宅最速・大学'],
  ['tie', '帰宅最速・高校'],
  ['partial', '帰宅最速・partial']
]);
const scenarioIds = new Set(scenarios.map(([id]) => id));
const mime = Object.freeze({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' });
const allowAsset = (path) => path === '/style.css' || path === '/manifest.json'
  || path === '/features/kaz-os/personal.css'
  || /^\/features\/bus\/[a-zA-Z0-9_-]+\.(js|css)$/.test(path)
  || /^\/assets\/[a-zA-Z0-9_./-]+$/.test(path) && !path.split('/').includes('..')
    && ['.png', '.svg', '.webp'].includes(extname(path));
const responseJson = (res, value, status = 200) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
};
const railStaticFile = process.env.PALURU_RAIL_STATIC_PATH
  || fileURLToPath(new URL('../generated/rail-odakyu-static.json', import.meta.url));
const jrStaticFile = process.env.PALURU_JR_NAMBU_STATIC_PATH
  || fileURLToPath(new URL('../generated/rail-nambu-challenge-static.json', import.meta.url));
const transferMinutes = Object.freeze({ 'noborito-normal': 8, 'noborito-tamagawa': 11,
  mukougaoka: 5, mizonokuchi: 6 }); // Preview-only user-editable estimates, not measured walking times.
const p0Static = JSON.parse(await readFile(new URL('../generated/p0-static.json', import.meta.url)));
const journeyStatic = JSON.parse(await readFile(new URL('../generated/kawasaki-p2-5-static.json', import.meta.url)));
const futureIndex = mergeKawasakiStatic(p0Static, journeyStatic);
const futureQueries = [...P0_QUERIES, ...KAWASAKI_JOURNEY_QUERIES];
const futureSourceIds = ['noborito_to_home', 'noborito_tamagawa_to_kibukihoncho',
  'mukougaoka_to_kibukihoncho', 'mizonokuchi_to_home'];
const futureQueryMap = new Map(futureQueries.map((query) => [query.id, query]));
const previewNow = (url) => {
  const at = url.searchParams.get('at');
  if (at === null) return Math.floor(Date.now() / 1000);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/.test(at)) throw Error('PREVIEW_TIME_INVALID');
  const value = Date.parse(at) / 1000;
  if (!Number.isFinite(value)) throw Error('PREVIEW_TIME_INVALID');
  return value;
};
let jrLocationCache = null;
async function jrLocations(now) {
  if (jrLocationCache && Date.now() - jrLocationCache.loadedAt < 30000)
    return jrLocationCache.rows;
  try {
    const result = await loadJrNambuLocations({ now });
    jrLocationCache = { loadedAt: Date.now(), rows: result?.rows ?? [] };
  } catch {
    jrLocationCache = { loadedAt: Date.now(), rows: [] };
  }
  return jrLocationCache.rows;
}
async function railChoices(journeyId, now, page = 0) {
  const artifact = JSON.parse(await readFile(journeyId === 'high_school'
    ? jrStaticFile : railStaticFile, 'utf8'));
  const locations = journeyId === 'high_school' ? await jrLocations(now) : [];
  return listRailTrains({ artifact, journeyId, now, page,
    enrichTrain: (train) => journeyId === 'high_school'
      ? attachJrNambuLocations([train], locations, now)[0] : train });
}
function futureBusLoader(now) {
  const sourceLoaders = Object.fromEntries(futureSourceIds.map((id) => [
    `kawasaki:${id}`, ({ boardingAt }) => getFutureBuses({
      index: futureIndex, queries: [futureQueryMap.get(id)], providerContext: KAWASAKI_CONTEXT,
      now, boardingAt, realtime: null
    }).results[0].arrivals
  ]));
  // Tokyu future-time data is unavailable in this local preview and remains explicitly partial.
  return createHomeBusLoader(sourceLoaders);
}
const shadowArtifact = Object.freeze({ approvedForShadow: true, approvedForPublic: false, geometryReady: false });
function positionFixture(scenario) {
  return shadowPosition({ supported: true, confidence: scenario === 'position-safe' ? 0.92 : 0.4,
    method: 'gps_shape_snap', state: 'between_stops', conflicts: [],
    previousStop: { name: '長尾橋' }, nextStop: { name: '宿河原' }, stopsAway: 2 }, shadowArtifact);
}
function tamagawaRow(direction) {
  const outbound = direction === 'outbound';
  const key = outbound ? 'kibukihoncho_to_noborito_tamagawa' : 'noborito_tamagawa_to_kibukihoncho';
  const staticRow = journeyStatic.directions[key].find((row) => row.routeId === '10045');
  if (!staticRow) throw Error('TAMAGAWA_STATIC_UNAVAILABLE');
  return { id: `preview-${key}`, provider: 'kawasaki', routeId: staticRow.routeId,
    routeLabel: staticRow.routeLabel, destination: staticRow.headsign,
    originStop: { id: staticRow.fromStopId, name: outbound ? '神木本町' : '登戸駅多摩川口' },
    targetStop: { id: staticRow.toStopId, name: outbound ? '登戸駅多摩川口' : '神木本町' },
    scheduledDeparture: Math.floor(Date.now() / 1000) + 420, estimatedDeparture: null,
    etaMinutes: null, delayMinutes: null, realtimeState: 'static_fallback',
    platform: staticRow.platform, areaBadge: '多摩川口', isOrigin: staticRow.isOrigin,
    position: { supported: false, status: null, stopsAway: null, previousStop: null, nextStop: null } };
}
function overlay(data, path, scenario) {
  if (scenario === 'tamagawa') {
    if (path === '/api/bus/hub' && data.hubId === 'kibukihoncho') {
      const group = data.decisionGroups.find((row) => row.id === 'kibukihoncho_north');
      if (group) { group.arrivals = [tamagawaRow('outbound'), ...group.arrivals].slice(0, 3);
        group.recommendedArrivalId = null; }
    }
    if (path === '/api/bus/journey') {
      const child = data.children?.find((row) => row.id === 'noborito');
      if (child?.decisionGroup) { child.decisionGroup.arrivals =
        [tamagawaRow('inbound'), ...child.decisionGroup.arrivals].slice(0, 3);
        child.decisionGroup.recommendedArrivalId = null; }
    }
  }
  if (['position-safe', 'position-weak'].includes(scenario) && path === '/api/bus/hub'
    && data.hubId === 'kibukihoncho') {
    const north = data.decisionGroups.find((row) => row.id === 'kibukihoncho_north');
    const kawasaki = north?.arrivals.find((row) => row.provider === 'kawasaki');
    if (kawasaki) kawasaki.position = positionFixture(scenario);
  }
  return data;
}
async function validation(path, search, scenario) {
  const target = new URL(path + search, validationProxy);
  const result = await fetch(target, { signal: AbortSignal.timeout(15000),
    headers: { Origin: 'https://alleshokai-gif.github.io' } });
  if (!result.ok) return { status: result.status, body: { error: 'VALIDATION_API_UNAVAILABLE' } };
  return { status: 200, body: overlay(await result.json(), path, scenario) };
}
function bootstrap(scenario) {
  const label = scenarios.find(([id]) => id === scenario)?.[1];
  const note = scenario === 'live'
    ? 'Hubはvalidation実データ。大学列車は小田急公式表示とChallenge発時刻から生成したローカルStatic、南武線はChallengeから生成したローカルStaticです。バス比較はGTFS Staticです。'
    : `${label}。大学列車は小田急公式表示とChallenge発時刻から生成したローカルStatic、南武線はChallengeから生成したローカルStaticです。バス比較はGTFS Staticです。${scenario === 'tamagawa' ? ' 多摩川口の比較カードは表示確認用fixtureです。' : ''}`;
  return `<style>
    #splash,#authLock{display:none!important}body{overflow:auto!important}
    .bus-preview-note{margin:0 0 10px;color:#526579;font-size:11px;line-height:1.4}
    .menu-toggle{visibility:hidden!important}
  </style>
  <script>
    (()=>{
      const previewCase=${JSON.stringify(scenario)};
      const originalFetch=window.fetch.bind(window);
      window.fetch=(input,options)=>{
        const url=new URL(input instanceof Request?input.url:input,location.href);
        if(url.origin===location.origin && ['/api/bus/hub','/api/bus/journey'].includes(url.pathname)){
          url.searchParams.set('previewCase',previewCase);
          return originalFetch(url,options);
        }
        return originalFetch(input,options);
      };
      if(previewCase==='tamagawa'||previewCase.startsWith('position-'))
        sessionStorage.setItem('paluru.bus.hub.selected.v1','kibukihoncho');
      window.addEventListener('DOMContentLoaded',()=>{
        document.body.classList.add('is-authenticated');
        const bus=document.querySelector('#busView');
        document.querySelectorAll('.app-view').forEach(view=>{view.hidden=view!==bus;view.classList.toggle('is-active',view===bus)});
        const note=document.createElement('p');
        note.className='bus-preview-note';
        const railAt=new URLSearchParams(location.search).get('at');
        note.textContent=${JSON.stringify(note)}+(railAt?' 帰宅比較の検証時刻: '+railAt.replace('T',' ').slice(0,16)+' JST。通常Busカードは現在時刻です。':'');
        bus.prepend(note);
        window.PALURUBusHub?.setActive(true);
        window.PALURUBusHomeRoute?.setActive(true);
      });
    })();
  </script>`;
}
const configOverride = (scenario) => `\n;globalThis.PALURU_BUS_API_URL='/api/bus/arrivals';
globalThis.PALURU_BUS_HOME_ROUTE_ENABLED=true;
globalThis.PALURU_BUS_POSITION_SHADOW_ENABLED=${scenario !== 'position-off'};
globalThis.PALURU_BUS_HOME_ROUTE_SOURCE={
 getTrainChoices:async(journeyId,page=0)=>{const q=new URLSearchParams({journeyId,page:String(page)});const at=new URLSearchParams(location.search).get('at');if(at)q.set('at',at);const r=await fetch('/preview/trains?'+q);if(!r.ok)throw Error('TRAIN_UNAVAILABLE');return r.json()},
 evaluate:async({journeyId,trainId,page=0})=>{const q=new URLSearchParams({journeyId,trainId,page:String(page),case:${JSON.stringify(scenario)}});const at=new URLSearchParams(location.search).get('at');if(at)q.set('at',at);const r=await fetch('/preview/home-route?'+q);if(!r.ok)throw Error('ROUTE_UNAVAILABLE');return r.json()}
};`;
const server = createServer(async (req, res) => {
  try {
    // This temporary preview is reachable only from this PC or its home LAN.
    const peer = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    if (!['127.0.0.1', '::1'].includes(peer) && !/^192\.168\.1\.\d{1,3}$/.test(peer))
      return responseJson(res, { error: 'PREVIEW_NETWORK_DENIED' }, 403);
    if (req.method !== 'GET') return responseJson(res, { error: 'METHOD_NOT_ALLOWED' }, 405);
    const url = new URL(req.url, 'http://127.0.0.1');
    const scenario = scenarioIds.has(url.searchParams.get('previewCase')) ? url.searchParams.get('previewCase')
      : scenarioIds.has(url.searchParams.get('case')) ? url.searchParams.get('case') : 'live';
    if (url.pathname === '/preview/trains' || url.pathname === '/preview/home-route') {
      const page = Number(url.searchParams.get('page') || 0);
      if (!Number.isSafeInteger(page) || page < 0 || page > 50)
        return responseJson(res, { error: 'PAGE_INVALID' }, 400);
      const journeyId = url.searchParams.get('journeyId');
      const now = previewNow(url);
      const choices = await railChoices(journeyId, now, page);
      if (url.pathname === '/preview/trains') return responseJson(res, choices);
      const selectedTrain = choices.trains.find((row) => row.id === url.searchParams.get('trainId'));
      if (!selectedTrain) return responseJson(res, { error: 'TRAIN_INVALID' }, 400);
      const decision = await compareHomeRoutes({ journeyId, selectedTrain, transferMinutes,
        loadBuses: futureBusLoader(now), now });
      const tamagawa = scenario === 'tamagawa' && decision.fastest?.placeId !== 'noborito-tamagawa'
        ? decision.options.find((option) => option.placeId === 'noborito-tamagawa'
          && Number.isFinite(option.homeArrivalAt)) : null;
      return responseJson(res, tamagawa
        ? { ...decision, alternate: tamagawa, differenceMinutes: null } : decision);
    }
    if (['/health', '/api/bus/arrivals', '/api/bus/hub', '/api/bus/journey'].includes(url.pathname)) {
      const search = new URLSearchParams(url.searchParams); search.delete('previewCase'); search.delete('case');
      const result = await validation(url.pathname, search.size ? `?${search}` : '', scenario);
      return responseJson(res, result.body, result.status);
    }
    if (url.pathname === '/features/bus/config.js') {
      const base = await readFile(resolve(root, 'features/bus/config.js'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(base + configOverride(scenario)); return;
    }
    if (url.pathname === '/') {
      const html = await readFile(resolve(root, 'index.html'), 'utf8');
      const busOnly = html.replace(/<script src="\.\/[^\"]+" defer><\/script>/g,
        (tag) => /features\/bus\/(config|bus|journey|hub|home-route)\.js/.test(tag) ? tag : '');
      const body = busOnly.replace('features/bus/config.js?v=', `features/bus/config.js?case=${scenario}&v=`)
        .replace('</body>', `${bootstrap(scenario)}</body>`);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'self' data:; connect-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'" });
      res.end(body); return;
    }
    if (!allowAsset(url.pathname)) return responseJson(res, { error: 'NOT_FOUND' }, 404);
    const file = resolve(root, `.${url.pathname}`);
    if (!file.startsWith(root + sep)) return responseJson(res, { error: 'NOT_FOUND' }, 404);
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': `${mime[extname(file)] || 'application/octet-stream'}; charset=utf-8`,
      'Cache-Control': 'no-store' }); res.end(body);
  } catch { responseJson(res, { error: 'PREVIEW_UNAVAILABLE' }, 503); }
});
server.listen(port, '0.0.0.0', () => console.log(`PALURU_BUS_PREVIEW_READY port=${port}`));

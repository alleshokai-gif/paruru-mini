// PALURU Bus UI acceptance preview. Never included by index.html or a production build.
// Serves the feature-branch PALURU markup/CSS and read-only validation API through a local IAM proxy.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, resolve, sep } from 'node:path';
import { shadowPosition } from '../position/shadow.js';

const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const port = Number(process.env.PALURU_BUS_PREVIEW_PORT || 8792);
const validationProxy = 'http://127.0.0.1:8789';
const scenarios = Object.freeze([
  ['live', '通常Bus（validation）'],
  ['tamagawa', '多摩川口・往復'],
  ['position-safe', 'バスロケ・位置表示'],
  ['position-weak', 'バスロケ・確認中'],
  ['position-off', 'バスロケ・OFF'],
  ['five', '帰宅最速・5分差'],
  ['tie', '帰宅最速・ほぼ同着'],
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
const jstDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric',
  month: '2-digit', day: '2-digit' }).format(new Date());
const fixtureTime = (hhmm) => Date.parse(`${jstDate()}T${hhmm}:00+09:00`) / 1000;
const trains = (journeyId) => journeyId === 'university'
  ? [{ id: 'preview-university', label: 'テスト列車：登戸18:18・遊園18:21着' }]
  : journeyId === 'high_school'
    ? [{ id: 'preview-school', label: 'テスト列車：登戸18:18・武蔵溝ノ口18:30着' }]
    : [];
function homeRouteFixture(journeyId, scenario) {
  const school = journeyId === 'high_school';
  const first = { stationLabel: school ? '溝の口駅南口' : '向ヶ丘遊園駅南口',
    stationArrivalAt: fixtureTime(school ? '18:30' : '18:21'),
    departureAt: fixtureTime(school ? '18:37' : '18:27'),
    homeArrivalAt: fixtureTime('18:39'), provider: school ? 'kawasaki' : 'tokyu',
    routeLabel: school ? '溝１７' : '向０１', timingQuality: school ? 'departure_delay_projection' : 'static_only' };
  const second = { stationLabel: '登戸駅', stationArrivalAt: fixtureTime('18:18'),
    departureAt: fixtureTime('18:31'), homeArrivalAt: fixtureTime(scenario === 'tie' ? '18:40' : '18:44'),
    provider: 'kawasaki', routeLabel: '登０５', timingQuality: 'departure_delay_projection' };
  if (scenario === 'partial') return { status: 'partial', fastest: second, alternate: null,
    differenceMinutes: null, unavailablePlaces: [first.stationLabel], unavailableSources: [first.provider] };
  return { status: 'available', fastest: first, alternate: second,
    differenceMinutes: scenario === 'tie' ? 1 : 5, unavailablePlaces: [], unavailableSources: [] };
}
const shadowArtifact = Object.freeze({ approvedForShadow: true, approvedForPublic: false, geometryReady: false });
function positionFixture(scenario) {
  return shadowPosition({ supported: true, confidence: scenario === 'position-safe' ? 0.92 : 0.4,
    method: 'gps_shape_snap', state: 'between_stops', conflicts: [],
    previousStop: { name: '長尾橋' }, nextStop: { name: '神木本町' }, stopsAway: 2 }, shadowArtifact);
}
const journeyStatic = JSON.parse(await readFile(new URL('../generated/kawasaki-p2-5-static.json', import.meta.url)));
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
  const links = scenarios.map(([id, label]) => `<a href="/?case=${id}" ${id === scenario ? 'aria-current="page"' : ''}>${label}</a>`).join('');
  const fixture = scenario !== 'live';
  return `<style>
    #splash,#authLock{display:none!important}body{overflow:auto!important}
    .bus-preview-controls{box-sizing:border-box;max-width:100%;margin:0 0 14px;padding:12px;background:#fff4d9;border:1px solid #e5c878;border-radius:12px}
    .bus-preview-controls h1{font-size:16px;margin:0 0 5px}.bus-preview-controls p{font-size:12px;margin:0 0 9px}
    .bus-preview-links{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}
    .bus-preview-links a{box-sizing:border-box;min-width:0;min-height:48px;padding:9px 6px;border:1px solid #9caec0;border-radius:8px;background:#fff;color:#243b54;font-size:12px;font-weight:700;text-align:center;text-decoration:none;display:grid;place-items:center;overflow-wrap:anywhere}
    .bus-preview-links a[aria-current=page]{background:#334e68;color:white}
    @media(min-width:700px){.bus-preview-links{grid-template-columns:repeat(4,minmax(0,1fr))}}
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
        const controls=document.createElement('aside');
        controls.className='bus-preview-controls';
        controls.innerHTML=${JSON.stringify(`<h1>PALURU Bus Preview</h1><p>feature branchの実画面。Hubの通常便はvalidation API、帰宅最速と${fixture ? '選択ケース' : '列車入力'}はUI fixtureです。公開版ではありません。</p><div class="bus-preview-links">${links}</div>`)};
        bus.prepend(controls);
        const nav=document.querySelector('.bottom-nav');
        nav.innerHTML='<button class="nav-item is-active" type="button">Bus</button><button class="nav-item" type="button">帰宅最速</button><button class="nav-item" type="button">ケース</button>';
        nav.children[0].onclick=()=>window.scrollTo({top:0,behavior:'smooth'});
        nav.children[1].onclick=()=>document.querySelector('#busHomeRouteMount').scrollIntoView({behavior:'smooth'});
        nav.children[2].onclick=()=>controls.scrollIntoView({behavior:'smooth'});
        document.querySelector('#menuToggleButton').onclick=()=>controls.scrollIntoView({behavior:'smooth'});
        window.PALURUBusHub?.setActive(true);
        window.PALURUBusHomeRoute?.setActive(true);
      });
    })();
  </script>`;
}
const configOverride = (scenario) => `\n;globalThis.PALURU_BUS_API_URL='/api/bus/arrivals';
globalThis.PALURU_BUS_HOME_ROUTE_ENABLED=true;
globalThis.PALURU_BUS_POSITION_SHADOW_ENABLED=${['position-safe', 'position-weak'].includes(scenario)};
globalThis.PALURU_BUS_HOME_ROUTE_SOURCE={
 getTrainChoices:async(journeyId)=>{const r=await fetch('/preview/trains?journeyId='+encodeURIComponent(journeyId));if(!r.ok)throw Error('TRAIN_UNAVAILABLE');return r.json()},
 evaluate:async({journeyId,trainId})=>{const r=await fetch('/preview/home-route?journeyId='+encodeURIComponent(journeyId)+'&trainId='+encodeURIComponent(trainId)+'&previewCase=${scenario}');if(!r.ok)throw Error('ROUTE_UNAVAILABLE');return r.json()}
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
    if (url.pathname === '/preview/trains') return responseJson(res, trains(url.searchParams.get('journeyId')));
    if (url.pathname === '/preview/home-route') {
      const journeyId = url.searchParams.get('journeyId');
      if (!trains(journeyId).some((row) => row.id === url.searchParams.get('trainId')))
        return responseJson(res, { error: 'TRAIN_INVALID' }, 400);
      return responseJson(res, homeRouteFixture(journeyId, scenario));
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

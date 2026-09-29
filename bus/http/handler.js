export function createHttpHandler(serviceFactory, { health = false, hubServiceFactory = null,
  journeyServiceFactory = null, railHomeRouteServiceFactory = null } = {}) {
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      const origin = request.headers.get('Origin');
      const origins = String(env.ALLOWED_ORIGINS || '').split(',').map((v) => v.trim()).filter(Boolean);
      const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Vary': 'Origin' };
      const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
      if (origin && !origins.includes(origin)) return reply({ success: false, error: { code: 'BUS_ORIGIN_DENIED' } }, 403);
      if (origin) headers['Access-Control-Allow-Origin'] = origin;
      if (health && url.pathname === '/health' && !url.search) {
        if (request.method !== 'GET') return reply({ success: false, error: { code: 'BUS_METHOD_NOT_ALLOWED' } }, 405);
        return reply({ status: 'ok', service: 'paluru-bus-api' });
      }
      const arrivalsPath = url.pathname === '/api/bus/arrivals' && !url.search;
      const hubPath = url.pathname === '/api/bus/hub';
      const journeyPath = url.pathname === '/api/bus/journey';
      const railTrainsPath = url.pathname === '/api/bus/trains';
      const homeRoutePath = url.pathname === '/api/bus/home-route';
      const hubId = url.searchParams.get('id');
      const hubQuery = hubPath && [...url.searchParams.keys()].length === 1 && typeof hubId === 'string' && hubId.length > 0;
      const journeyId = url.searchParams.get('id');
      const journeyQuery = journeyPath && [...url.searchParams.keys()].length === 1
        && typeof journeyId === 'string' && journeyId.length > 0;
      const railKeys = [...url.searchParams.keys()];
      const railQuery = (railTrainsPath || homeRoutePath)
        && railKeys.every((key) => ['journeyId', 'page', 'trainId'].includes(key))
        && railKeys.length === new Set(railKeys).size
        && ['university', 'high_school'].includes(url.searchParams.get('journeyId'))
        && (!railTrainsPath || !railKeys.includes('trainId'))
        && (!homeRoutePath || /^[a-zA-Z0-9:_-]{1,100}$/.test(url.searchParams.get('trainId') || ''))
        && (!railKeys.includes('page') || /^(?:0|-?[1-9]\d?)$/.test(url.searchParams.get('page'))
          && Math.abs(Number(url.searchParams.get('page'))) <= 50);
      if (!arrivalsPath && !hubQuery && !journeyQuery && !railQuery)
        return reply({ success: false, error: { code: 'BUS_NOT_FOUND' } }, 404);
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '600' } });
      if (request.method !== 'GET') return reply({ success: false, error: { code: 'BUS_METHOD_NOT_ALLOWED' } }, 405);
      if (!env.ODPT_ACCESS_TOKEN) return reply({ success: false, error: { code: 'BUS_NOT_CONFIGURED' } }, 503);
      try {
        if (railQuery) {
          if (typeof railHomeRouteServiceFactory !== 'function')
            return reply({ success: false, error: { code: 'BUS_NOT_FOUND' } }, 404);
          const railService = railHomeRouteServiceFactory(env);
          const page = Number(url.searchParams.get('page') || 0);
          return reply(railTrainsPath
            ? await railService.getTrainChoices(url.searchParams.get('journeyId'), page)
            : await railService.evaluate({ journeyId: url.searchParams.get('journeyId'),
              trainId: url.searchParams.get('trainId'), page }));
        }
        if (journeyPath) {
          if (typeof journeyServiceFactory !== 'function')
            return reply({ success: false, error: { code: 'BUS_NOT_FOUND' } }, 404);
          const journeyService = journeyServiceFactory(env);
          if (typeof journeyService?.hasJourney !== 'function' || !journeyService.hasJourney(journeyId))
            return reply({ success: false, error: { code: 'BUS_NOT_FOUND' } }, 404);
          return reply(await journeyService.getJourney(journeyId));
        }
        if (hubPath) {
          if (typeof hubServiceFactory !== 'function') return reply({ success: false, error: { code: 'BUS_NOT_FOUND' } }, 404);
          const hubService = hubServiceFactory(env);
          if (typeof hubService?.hasHub !== 'function' || !hubService.hasHub(hubId))
            return reply({ success: false, error: { code: 'BUS_NOT_FOUND' } }, 404);
          return reply(await hubService.getHub(hubId));
        }
        return reply(await serviceFactory(env).getArrivals());
      }
      catch { return reply({ success: false, error: { code: 'BUS_UNAVAILABLE' } }, 503); }
    }
  };
}

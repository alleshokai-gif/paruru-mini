export function createHttpHandler(serviceFactory, { health = false } = {}) {
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
      if (url.pathname !== '/api/bus/arrivals' || url.search) return reply({ success: false, error: { code: 'BUS_NOT_FOUND' } }, 404);
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '600' } });
      if (request.method !== 'GET') return reply({ success: false, error: { code: 'BUS_METHOD_NOT_ALLOWED' } }, 405);
      if (!env.ODPT_ACCESS_TOKEN) return reply({ success: false, error: { code: 'BUS_NOT_CONFIGURED' } }, 503);
      try { return reply(await serviceFactory(env).getArrivals()); }
      catch { return reply({ success: false, error: { code: 'BUS_UNAVAILABLE' } }, 503); }
    }
  };
}

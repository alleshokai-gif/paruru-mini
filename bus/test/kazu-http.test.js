import test from 'node:test';
import assert from 'node:assert/strict';
import { createHttpHandler } from '../http/handler.js';

const origins = 'https://alleshokai-gif.github.io';
const env = { ALLOWED_ORIGINS: origins, ODPT_ACCESS_TOKEN: 'synthetic' };
const service = { async evaluate(mode) { return { mode, routes: [], status: 'insufficient_data' }; } };
const handler = createHttpHandler(() => ({ getArrivals: async () => ({}) }), {
  kazuRouteServiceFactory: () => service
});
const call = (query, method = 'GET', origin = origins) => handler.fetch(new Request(
  `https://bus.invalid/api/bus/commute-route${query}`, { method, headers: { Origin: origin } }), env);

test('Kazu read-only endpoint accepts only fixed modes and approved origin', async () => {
  for (const mode of ['hibiya', 'tamachi', 'pharmacy']) {
    const result = await call(`?mode=${mode}`);
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('access-control-allow-origin'), origins);
    assert.equal((await result.json()).mode, mode);
  }
  assert.equal((await call('?mode=other')).status, 404);
  assert.equal((await call('?mode=hibiya&extra=1')).status, 404);
  assert.equal((await call('?mode=hibiya&mode=tamachi')).status, 404);
  assert.equal((await call('?mode=hibiya', 'POST')).status, 405);
  assert.equal((await call('?mode=hibiya', 'GET', 'https://other.invalid')).status, 403);
});

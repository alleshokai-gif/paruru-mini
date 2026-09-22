'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

(async () => {
  const listeners = {};
  const deleted = [];
  const messages = [];
  let claimed = 0;
  let fetchFails = false;
  const cachedFallback = { ok: true, source: 'cache', clone() { return this; } };
  const networkResponse = { ok: true, source: 'network', clone() { return this; } };
  const cache = {
    async addAll() {},
    async put() {},
    async match(request) {
      const url = String(request && request.url || request || '');
      return url.includes('app.js') ? cachedFallback : null;
    },
  };
  const self = {
    location: { origin: 'https://paluru.example', href: 'https://paluru.example/sw.js' },
    registration: { scope: 'https://paluru.example/' },
    addEventListener(name, handler) { listeners[name] = handler; },
    skipWaiting() {},
    clients: {
      async claim() { claimed++; },
      async matchAll() { return [{ postMessage: message => messages.push(message) }]; },
    },
  };
  const context = {
    BUILD_ID: 'v-test-transition',
    URL,
    Request,
    Promise,
    console,
    importScripts() {},
    self,
    caches: {
      async keys() { return ['paruru-mini-v-old', 'paruru-mini-v-test-transition']; },
      async delete(key) { deleted.push(key); return true; },
      async open() { return cache; },
    },
    async fetch() {
      if (fetchFails) throw new TypeError('offline');
      return networkResponse;
    },
    globalThis: null,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'sw.js' });

  let activation;
  listeners.activate({ waitUntil(promise) { activation = promise; } });
  await activation;
  assert.deepEqual(deleted, ['paruru-mini-v-old'], 'activation must delete only the old cache');
  assert.equal(claimed, 1, 'activation must claim clients once');
  assert(messages.some(message => message.type === 'PALURU_TRANSPORT_DIAGNOSTIC'
    && message.detail.backendStage === 'ACTIVATED'
    && message.detail.outcome === 'updated'), 'version transition diagnostic missing');

  fetchFails = true;
  const response = await context.networkFirst({
    method: 'GET',
    url: 'https://paluru.example/app.js?v=v-test-transition',
    mode: 'same-origin',
    destination: 'script',
  });
  assert.equal(response, cachedFallback, 'network-first fallback did not return cached app shell');
  assert(messages.some(message => message.detail.backendStage === 'NETWORK_FIRST_CACHE_HIT'
    && message.detail.outcome === 'cache_fallback'), 'cache fallback diagnostic missing');

  console.log('PASS deterministic service-worker transition and cache fallback diagnostics');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

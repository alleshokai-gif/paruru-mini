'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { ConsoleError, safeError } = require('./errors');

const MAX_BODY_BYTES = 4096;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const STATIC_ROUTES = Object.freeze({
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
  '/styles.css': { file: 'styles.css', type: 'text/css; charset=utf-8' }
});

function createSafeLogger() {
  const entries = [];
  return {
    entries,
    write(entry) {
      entries.push(Object.freeze({
        method: entry.method,
        path: entry.path,
        status: entry.status,
        request_id: entry.request_id
      }));
    }
  };
}

function commonHeaders(contentType) {
  return {
    'Content-Type': contentType,
    'Cache-Control': 'no-store, private',
    'Pragma': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
  };
}

function sendJson(response, status, payload, requestId) {
  const body = Buffer.from(JSON.stringify({ ...payload, request_id: requestId }), 'utf8');
  response.writeHead(status, {
    ...commonHeaders('application/json; charset=utf-8'),
    'Content-Length': body.length
  });
  response.end(body);
}

function sendStatic(response, route) {
  const body = fs.readFileSync(path.join(PUBLIC_DIR, route.file));
  response.writeHead(200, {
    ...commonHeaders(route.type),
    'Content-Length': body.length
  });
  response.end(body);
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    const contentType = String(request.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (contentType !== 'application/json') {
      reject(new ConsoleError('CONTENT_TYPE_INVALID', 415));
      return;
    }
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    request.on('data', (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        reject(new ConsoleError('REQUEST_TOO_LARGE', 413));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (tooLarge) return;
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(parsed);
      } catch (_error) {
        reject(new ConsoleError('REQUEST_INVALID'));
      }
    });
    request.on('error', () => reject(new ConsoleError('REQUEST_INVALID')));
  });
}

function assertEmptyBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 0) {
    throw new ConsoleError('REQUEST_INVALID');
  }
}

function decodeSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch (_error) {
    throw new ConsoleError('NOT_FOUND', 404);
  }
}

function createHttpApp({ service, logger = createSafeLogger() }) {
  const idempotency = new Map();

  async function routeApi(request, pathname) {
    const method = request.method || 'GET';
    let match;

    if (method === 'GET' && pathname === '/api/credentials') {
      return { status: 200, data: { items: service.listCredentials() } };
    }
    if (method === 'GET' && (match = pathname.match(/^\/api\/credentials\/([^/]+)$/))) {
      return { status: 200, data: service.getCredential(decodeSegment(match[1])) };
    }
    if (method === 'POST' && pathname === '/api/rotations') {
      return { status: 201, data: service.prepareRotation(await readJson(request)) };
    }
    if (method === 'GET' && (match = pathname.match(/^\/api\/rotations\/([^/]+)$/))) {
      return { status: 200, data: service.getRotation(decodeSegment(match[1])) };
    }
    if (method === 'POST' && (match = pathname.match(/^\/api\/credentials\/([^/]+)\/stage$/))) {
      return {
        status: 200,
        data: service.stageCredential(decodeSegment(match[1]), await readJson(request))
      };
    }
    if (method === 'POST' && (match = pathname.match(/^\/api\/credentials\/([^/]+)\/probe$/))) {
      assertEmptyBody(await readJson(request));
      return { status: 200, data: service.probeCredential(decodeSegment(match[1])) };
    }
    if (method === 'POST' && (match = pathname.match(/^\/api\/rotations\/([^/]+)\/(distribute|verify|approve|disable-old|regression-check|rollback)$/))) {
      const rotationId = decodeSegment(match[1]);
      const action = match[2];
      const body = await readJson(request);
      if (action === 'disable-old') return { status: 200, data: service.disableOld(rotationId, body) };
      assertEmptyBody(body);
      if (action === 'distribute') return { status: 200, data: service.distribute(rotationId) };
      if (action === 'verify') return { status: 200, data: service.verify(rotationId) };
      if (action === 'approve') return { status: 200, data: service.approve(rotationId) };
      if (action === 'regression-check') return { status: 200, data: service.regressionCheck(rotationId) };
      return { status: 200, data: service.rollback(rotationId, body) };
    }
    throw new ConsoleError('NOT_FOUND', 404);
  }

  return {
    logger,
    async handler(request, response) {
      const requestId = `req_${crypto.randomUUID()}`;
      let pathname = '/';
      let status = 500;
      try {
        const url = new URL(request.url || '/', 'http://127.0.0.1');
        pathname = url.pathname;
        if (url.search) throw new ConsoleError('REQUEST_INVALID');

        if ((request.method || 'GET') === 'GET' && STATIC_ROUTES[pathname]) {
          sendStatic(response, STATIC_ROUTES[pathname]);
          status = 200;
          return;
        }
        if (!pathname.startsWith('/api/')) throw new ConsoleError('NOT_FOUND', 404);

        const mutation = (request.method || 'GET') === 'POST';
        let cacheKey = null;
        if (mutation) {
          const key = String(request.headers['idempotency-key'] || '');
          if (!/^[A-Za-z0-9_-]{12,120}$/.test(key)) throw new ConsoleError('REQUEST_INVALID');
          cacheKey = `${request.method}:${pathname}:${key}`;
          if (idempotency.has(cacheKey)) {
            const cached = idempotency.get(cacheKey);
            status = cached.status;
            sendJson(response, cached.status, cached.payload, requestId);
            return;
          }
        }

        const result = await routeApi(request, pathname);
        const payload = { success: true, data: result.data };
        if (cacheKey) idempotency.set(cacheKey, { status: result.status, payload });
        status = result.status;
        sendJson(response, result.status, payload, requestId);
      } catch (error) {
        const safe = safeError(error);
        status = safe.status;
        sendJson(response, safe.status, safe.body, requestId);
      } finally {
        logger.write({ method: request.method || 'GET', path: pathname, status, request_id: requestId });
      }
    }
  };
}

module.exports = { createHttpApp, createSafeLogger, MAX_BODY_BYTES, STATIC_ROUTES };

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { requestMetrics } from './metrics.js';

export function createNodeServer({ handler, env, measure = () => {} }) {
  const server = createServer({ maxHeaderSize: 16384 }, (incoming, outgoing) => {
    const requestId = randomUUID(), started = performance.now();
    requestMetrics.run({}, async () => {
      let responseBytes = 0;
      try {
        // Use a fixed local base: never trust Host/forwarded headers as upstream routing input.
        if (!incoming.url?.startsWith('/') || incoming.url.startsWith('//')) throw Error('BUS_BAD_TARGET');
        const headers = new Headers();
        if (incoming.headers.origin) headers.set('Origin', incoming.headers.origin);
        const request = new Request(new URL(incoming.url, 'http://bus.local'), { method: incoming.method, headers });
        const response = await handler.fetch(request, env);
        const body = Buffer.from(await response.arrayBuffer()); responseBytes = body.length;
        outgoing.writeHead(response.status, { ...Object.fromEntries(response.headers), 'X-Request-Id': requestId });
        outgoing.end(body);
      } catch {
        const body = '{"success":false,"error":{"code":"BUS_HTTP_ERROR"}}'; responseBytes = Buffer.byteLength(body);
        if (!outgoing.headersSent) outgoing.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Request-Id': requestId });
        outgoing.end(body);
      } finally {
        incoming.resume();
        const event = { event: 'bus_request', requestId, status: outgoing.statusCode,
          responseBytes, elapsedMs: performance.now() - started, rssBytes: process.memoryUsage().rss,
          stages: { ...requestMetrics.getStore() } };
        try { measure(event); } catch { /* Diagnostics do not alter Bus responses. */ }
      }
    });
  });
  server.requestTimeout = 25000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000;
  server.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'));
  return server;
}

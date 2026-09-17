'use strict';

const { AuthError } = require('./oidc-verifier');
const { BrokerError } = require('./broker');

const MAX_BODY_BYTES = 4096;

function writeJson(response, status, body) {
  const encoded = body === null ? '' : JSON.stringify(body);
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(encoded),
    'x-content-type-options': 'nosniff',
  });
  response.end(encoded);
}

async function readJson(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      throw new BrokerError('REQUEST_TOO_LARGE', 413);
    }
    chunks.push(chunk);
  }
  if (total === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new Error('object required');
    }
    return parsed;
  } catch {
    throw new BrokerError('INVALID_JSON', 400);
  }
}

function createHttpHandler({ verifier, broker, logger = () => undefined }) {
  return async function privateBrokerHandler(request, response) {
    let principal = null;
    let operationAlias = null;
    try {
      principal = await verifier.verifyAuthorization(request.headers.authorization);
      const url = new URL(request.url, 'http://private-broker.invalid');
      if (url.search !== '') {
        throw new BrokerError('QUERY_NOT_ALLOWED', 400);
      }

      let result;
      if (request.method === 'POST' && url.pathname === '/v1/operations/poll') {
        await readJson(request);
        result = { operation: await broker.poll(principal.principalAlias) };
      } else if (request.method === 'POST' && url.pathname === '/v1/operations/lease') {
        const body = await readJson(request);
        operationAlias = body.operation_alias;
        result = { operation: await broker.lease(principal.principalAlias, operationAlias) };
      } else if (request.method === 'POST' && url.pathname === '/v1/operations/redeem') {
        const body = await readJson(request);
        operationAlias = body.operation_alias;
        result = await broker.redeem(principal.principalAlias, operationAlias, body.lease_alias);
      } else if (request.method === 'POST' && url.pathname === '/v1/operations/ack') {
        const body = await readJson(request);
        operationAlias = body.operation_alias;
        result = { operation: await broker.acknowledge(principal.principalAlias, operationAlias, body.lease_alias) };
      } else if (request.method === 'GET') {
        const match = /^\/v1\/operations\/([A-Za-z0-9][A-Za-z0-9._-]{0,127})\/status$/.exec(url.pathname);
        if (!match) throw new BrokerError('ROUTE_NOT_FOUND', 404);
        operationAlias = match[1];
        result = { operation: await broker.status(principal.principalAlias, operationAlias) };
      } else {
        throw new BrokerError('ROUTE_NOT_FOUND', 404);
      }

      logger(Object.freeze({
        event: 'broker_request',
        operation_alias: typeof operationAlias === 'string' ? operationAlias : null,
        safe_code: 'OK',
        status: 200,
      }));
      writeJson(response, 200, result);
    } catch (error) {
      const known = error instanceof AuthError || error instanceof BrokerError;
      const status = known ? error.status : 500;
      const code = known ? error.code : 'INTERNAL_ERROR';
      logger(Object.freeze({
        event: 'broker_request_rejected',
        operation_alias: typeof operationAlias === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(operationAlias)
          ? operationAlias
          : null,
        safe_code: code,
        status,
      }));
      writeJson(response, status, { success: false, error: { code } });
    }
  };
}

module.exports = { createHttpHandler };

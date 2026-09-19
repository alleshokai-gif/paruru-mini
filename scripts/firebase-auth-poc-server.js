'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const host = '127.0.0.1';
const port = 5000;
const serverConfigPath = path.join(root, 'features', 'auth', 'firebase-auth-poc-server.local.json');
const staticFiles = Object.freeze({
  '/': ['auth-poc.html', 'text/html; charset=utf-8'],
  '/auth-poc.html': ['auth-poc.html', 'text/html; charset=utf-8'],
  '/features/auth/firebase-auth.js': ['features/auth/firebase-auth.js', 'text/javascript; charset=utf-8'],
  '/features/auth/firebase-auth-poc.js': ['features/auth/firebase-auth-poc.js', 'text/javascript; charset=utf-8'],
  '/features/auth/firebase-auth-poc-config.local.json': ['features/auth/firebase-auth-poc-config.local.json', 'application/json; charset=utf-8'],
});

function loadServerConfig() {
  let value;
  try { value = JSON.parse(fs.readFileSync(serverConfigPath, 'utf8')); }
  catch (error) { throw new Error('AUTH_POC_SERVER_CONFIG_MISSING'); }
  const projectId = String(value.firebaseProjectId || '').trim();
  const webApiKey = String(value.firebaseWebApiKey || '').trim();
  const mappings = Array.isArray(value.mappings) ? value.mappings : [];
  if (!/^[a-z0-9][a-z0-9-]{4,61}[a-z0-9]$/.test(projectId) || !webApiKey || mappings.length === 0) {
    throw new Error('AUTH_POC_SERVER_CONFIG_INVALID');
  }
  return { projectId, webApiKey, mappings };
}

function createSheet(values) {
  return {
    getLastColumn: () => values[0].length,
    getDataRange: () => ({ getValues: () => values.map((row) => row.slice()) }),
    getRange: (row, column, rowCount, columnCount) => ({
      getValues: () => values.slice(row - 1, row - 1 + rowCount).map((item) => item.slice(column - 1, column - 1 + columnCount)),
    }),
  };
}

function createGasContext(config) {
  const identityRows = [['homeId', 'memberUserId', 'provider', 'providerSubject', 'status', 'createdAt', 'updatedAt']];
  const memberRows = [['homeId', 'memberUserId', 'displayName', 'role', 'status', 'createdAt', 'updatedAt']];
  for (const mapping of config.mappings) {
    identityRows.push([
      String(mapping.homeId || ''), String(mapping.memberUserId || ''), `firebase:${config.projectId}`,
      String(mapping.firebaseUid || ''), String(mapping.status || ''), '', '',
    ]);
    memberRows.push([
      String(mapping.homeId || ''), String(mapping.memberUserId || ''), String(mapping.displayName || ''),
      String(mapping.role || ''), String(mapping.status || ''), '', '',
    ]);
  }
  const sheets = { Home_Identities: createSheet(identityRows), Home_Members: createSheet(memberRows) };
  const context = {
    Date, JSON, Math, Number, Object, Array, String, RegExp, Error, encodeURIComponent,
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: (name) => sheets[name] || null }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => '' }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (_algorithm, value) => Array.from(crypto.createHash('sha256').update(String(value)).digest()),
      base64Decode: (value) => Array.from(Buffer.from(String(value), 'base64')),
      newBlob: (bytes) => ({ getDataAsString: () => Buffer.from(bytes).toString('utf8') }),
    },
  };
  vm.createContext(context);
  const source = [
    'gas/HomeMemberPolicy.js',
    'gas/HomeMembershipService.js',
    'gas/FirebaseAuthVerifier.js',
    'gas/HomeIdentityService.js',
    'gas/AuthenticatedActorService.js',
  ].map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
  new vm.Script(source, { filename: 'firebase-auth-poc-gas-bundle.js' }).runInContext(context);
  return context;
}

async function lookupFirebaseAccount(idToken, config) {
  let response;
  try {
    response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(config.webApiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });
  } catch (error) {
    throw Object.assign(new Error('AUTH_VERIFIER_UNAVAILABLE'), { code: 'AUTH_VERIFIER_UNAVAILABLE' });
  }
  if (response.status === 408 || response.status === 429 || response.status >= 500) {
    throw Object.assign(new Error('AUTH_VERIFIER_UNAVAILABLE'), { code: 'AUTH_VERIFIER_UNAVAILABLE' });
  }
  if (!response.ok) throw Object.assign(new Error('AUTH_TOKEN_INVALID'), { code: 'AUTH_TOKEN_INVALID' });
  const payload = await response.json();
  if (!payload || !Array.isArray(payload.users) || payload.users.length !== 1) {
    throw Object.assign(new Error('AUTH_TOKEN_INVALID'), { code: 'AUTH_TOKEN_INVALID' });
  }
  return payload.users[0];
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16_384) throw Object.assign(new Error('INVALID_REQUEST'), { code: 'INVALID_REQUEST' });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch (error) { throw Object.assign(new Error('INVALID_REQUEST'), { code: 'INVALID_REQUEST' }); }
}

function sendJson(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

function sendStatic(response, pathname) {
  const entry = staticFiles[pathname];
  if (!entry) return false;
  response.writeHead(200, {
    'Content-Type': entry[1],
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' https://www.gstatic.com https://accounts.google.com; connect-src 'self' https://accounts.google.com/gsi/ https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com; frame-src https://accounts.google.com; img-src 'self' data: https://*.googleusercontent.com; style-src 'self' 'unsafe-inline' https://accounts.google.com",
    'Referrer-Policy': 'no-referrer-when-downgrade',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(fs.readFileSync(path.join(root, entry[0])));
  return true;
}

async function handleResolve(request, response, config, gas) {
  try {
    const body = await readJsonBody(request);
    if (!body || body.action !== 'authPocResolve') return sendJson(response, 400, { success: false, error: { code: 'INVALID_REQUEST' } });
    const token = String(body.auth && body.auth.idToken || '');
    const account = await lookupFirebaseAccount(token, config);
    const result = gas.authPocResolve_(body, {
      verifier: {
        config: { projectId: config.projectId, webApiKey: config.webApiKey },
        nowSeconds: () => Math.floor(Date.now() / 1000),
        lookupAccount: () => account,
      },
    });
    return sendJson(response, result.success ? 200 : 401, result);
  } catch (error) {
    const code = String(error && error.code || 'AUTHENTICATION_FAILED').replace(/[^A-Z0-9_]/g, '').slice(0, 80) || 'AUTHENTICATION_FAILED';
    return sendJson(response, code === 'INVALID_REQUEST' ? 400 : 401, { success: false, data: {}, error: { code }, message: code });
  }
}

function start() {
  const config = loadServerConfig();
  const gas = createGasContext(config);
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${host}:${port}`);
    if (request.method === 'POST' && url.pathname === '/auth-poc/resolve') return handleResolve(request, response, config, gas);
    if (request.method === 'GET' && sendStatic(response, url.pathname)) return;
    sendJson(response, 404, { success: false, error: { code: 'NOT_FOUND' } });
  });
  server.listen(port, host, () => console.log(`PALURU Firebase Auth P2 PoC: http://localhost:${port}/auth-poc.html`));
  return server;
}

if (require.main === module) start();

module.exports = { createGasContext, loadServerConfig, lookupFirebaseAccount, start };

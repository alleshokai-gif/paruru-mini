'use strict';

const http = require('node:http');
const { SyntheticRegistry } = require('./registry');
const { SyntheticSecretBackend } = require('./synthetic-backend');
const { SyntheticAuditStore } = require('./audit-store');
const { SecretConsoleService } = require('./console-service');
const { createHttpApp, createSafeLogger } = require('./http-app');

function buildPrototype() {
  const registry = new SyntheticRegistry();
  const backend = new SyntheticSecretBackend(registry);
  const audit = new SyntheticAuditStore();
  const service = new SecretConsoleService({ registry, backend, audit });
  const logger = createSafeLogger();
  const app = createHttpApp({ service, logger });
  return { registry, backend, audit, service, logger, app };
}

if (require.main === module) {
  const port = Number.parseInt(process.env.PORT || '4177', 10);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('PORT must be an integer between 1024 and 65535');
  }
  const prototype = buildPrototype();
  const server = http.createServer(prototype.app.handler);
  server.listen(port, '127.0.0.1', () => {
    process.stdout.write(`PALURU Secret Console synthetic prototype: http://127.0.0.1:${port}\n`);
  });
}

module.exports = { buildPrototype };

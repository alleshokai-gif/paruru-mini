'use strict';

const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const {
  DurableOperationStore,
  PrivateBrokerService,
  SafeAudit,
  SyntheticSecretStore,
} = require('./broker');
const { createHttpHandler } = require('./http-app');
const { OidcVerifier } = require('./oidc-verifier');

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main() {
  const audience = requiredEnvironment('POC_OIDC_AUDIENCE');
  const ownerSubjectSha256 = requiredEnvironment('POC_OWNER_SUBJECT_SHA256');
  const stateFile = requiredEnvironment('POC_STATE_FILE');
  const secretFile = requiredEnvironment('POC_SYNTHETIC_SECRET_FILE');
  const secretDocument = JSON.parse(await fs.readFile(secretFile, 'utf8'));
  const operationAlias = secretDocument.operation_alias;
  const secretVersionAlias = secretDocument.secret_version_alias;
  const payload = secretDocument.synthetic_payload;
  if (typeof payload !== 'string' || payload.length === 0 || payload.length > 4096) {
    throw new Error('synthetic secret file has an invalid payload');
  }

  const audit = new SafeAudit();
  const store = new DurableOperationStore(path.resolve(stateFile));
  const secretStore = new SyntheticSecretStore({ [secretVersionAlias]: payload });
  const broker = new PrivateBrokerService({ store, secretStore, audit });
  await broker.prepareSyntheticOperation({ operationAlias, secretVersionAlias });

  const verifier = new OidcVerifier({ audience, ownerSubjectSha256 });
  const handler = createHttpHandler({
    verifier,
    broker,
    logger: (safeEntry) => process.stdout.write(`${JSON.stringify(safeEntry)}\n`),
  });
  const server = http.createServer(handler);
  const port = Number(process.env.PORT || 8080);
  const host = process.env.HOST || '0.0.0.0';
  server.listen(port, host, () => {
    process.stdout.write(`${JSON.stringify({ event: 'broker_started', port })}\n`);
  });
}

main().catch(() => {
  // Startup details can include paths or malformed synthetic input. Keep them out of logs.
  process.stderr.write(`${JSON.stringify({ event: 'broker_start_failed', safe_code: 'STARTUP_FAILED' })}\n`);
  process.exitCode = 1;
});

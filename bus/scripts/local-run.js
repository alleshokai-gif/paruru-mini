// Local secret loading is deliberately absent from the production entry and Docker context.
import { readLocalToken } from './local-secret.js';
import { readLocalConfig } from './local-config.js';
import { start } from '../runtime/start.js';
try {
  const local = readLocalConfig();
  start({ env: { ...process.env, NODE_ENV: 'development', PORT: String(local.dev.port),
    ALLOWED_ORIGINS: local.vars.ALLOWED_ORIGINS, ODPT_ACCESS_TOKEN: readLocalToken() } });
}
catch { console.error('{"error":"BUS_LOCAL_RUN_FAILED"}'); process.exitCode = 1; }

// Local secret loading is deliberately absent from the production entry and Docker context.
import { readLocalToken } from './local-secret.js';
import { start } from '../runtime/start.js';
try { start({ env: { ...process.env, NODE_ENV: 'development', ODPT_ACCESS_TOKEN: readLocalToken() } }); }
catch { console.error('{"error":"BUS_LOCAL_RUN_FAILED"}'); process.exitCode = 1; }

// Memory-only bundle/bindings/cache. No credential, full feed or generated bundle is written to disk.
import { buildWorker } from './bundle.js';
import { Miniflare, Log, LogLevel, convertV4MiniflareOptions } from 'miniflare';
import { readLocalToken } from './local-secret.js';
import { readLocalConfig } from './local-config.js';
let runtime, phase = 'bundle';
try {
  const config = readLocalConfig();
  const bundle = await buildWorker();
  phase = 'runtime';
  runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.text,
    compatibilityDate: config.compatibility_date, host: config.dev.ip, port: config.dev.port,
    log: new Log(LogLevel.NONE), bindings: { ...config.vars, ODPT_ACCESS_TOKEN: readLocalToken() } }));
  await runtime.ready;
  console.log(`BUS_LOCAL_WORKER_READY ${config.dev.ip}:${config.dev.port}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await runtime.dispose(); process.exit(0); });
} catch (error) {
  const safe = (value) => /^[A-Z_a-z0-9]+$/.test(value || '') ? value : null;
  console.log(JSON.stringify({ error: 'BUS_LOCAL_WORKER_START_FAILED', phase, type: safe(error?.name), code: safe(error?.code), causeCode: safe(error?.cause?.code),
    issues: (error?.cause?.issues || []).map((i) => ({ path: i.path.map(safe), code: safe(i.code) })) }));
  await runtime?.dispose(); process.exitCode = 1;
}

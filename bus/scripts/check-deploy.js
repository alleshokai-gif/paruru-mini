// Two local-only Wrangler operations. There is no path in this script to a real deployment.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readLocalToken } from './local-secret.js';
try {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const token = readLocalToken();
  mkdirSync(new URL('../.local/deploy-check/', import.meta.url), { recursive: true });
  const env = { ...process.env, WRANGLER_WRITE_LOGS: 'false', WRANGLER_SEND_METRICS: 'false' };
  delete env.ODPT_ACCESS_TOKEN;
  const commands = [
    ['deploy', '--dry-run', '--config', 'wrangler.jsonc', '--outfile', '.local/deploy-check/worker.bundle'],
    ['check', 'startup', '--config', 'wrangler.jsonc', '--worker', '.local/deploy-check/worker.bundle', '--outfile', '.local/deploy-check/startup.cpuprofile']
  ];
  for (const args of commands) {
    const result = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...args], { cwd: root, env, encoding: 'utf8', timeout: 60000 });
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    if (output.includes(token)) throw Error('BUS_SECRET_LEAK');
    // Output only measurements/validation markers, never raw diagnostics or variable tables.
    const lines = output.split(/\r?\n/).filter((line) => /Total Upload:|Bundle:|Profile window:|Sampled time:|Active:|Idle:|Samples:|dry-run: exiting now|STATIC_PREFLIGHT_PASS/.test(line));
    console.log(JSON.stringify({ operation: args[0] === 'deploy' ? 'dry-run' : 'local-startup-profile', exitCode: result.status, evidence: lines }));
    if (result.status !== 0) throw Error('DEPLOY_CHECK_FAILED');
  }
  for (const name of ['worker.bundle', 'startup.cpuprofile']) {
    if (readFileSync(new URL(`../.local/deploy-check/${name}`, import.meta.url)).includes(Buffer.from(token))) throw Error('BUS_SECRET_LEAK');
  }
  console.log('{"status":"DEPLOY_LOCAL_PREFLIGHT_PASS","secretLeak":false,"deployed":false}');
} catch (error) {
  console.log(JSON.stringify({ error: /^[A-Z_]+$/.test(error?.message || '') ? error.message : 'DEPLOY_CHECK_FAILED' }));
  process.exitCode = 1;
}

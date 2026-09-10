// Report counts/booleans only. Never print matching contents, the credential, or file names of leaks.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { readLocalToken } from './local-secret.js';
import { buildWorker } from './bundle.js';
try {
  const root = fileURLToPath(new URL('../../', import.meta.url)), token = readLocalToken();
  const needles = [...new Set([token, encodeURIComponent(token)])].map((s) => Buffer.from(s));
  const names = execFileSync('git', ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8', stdio: 'pipe' }).split('\0').filter(Boolean);
  let scanned = 0, leaks = 0;
  const scan = (bytes) => { scanned++; if (needles.some((n) => bytes.includes(n))) leaks++; };
  for (const name of new Set(names)) scan(readFileSync(join(root, name)));
  for (const name of readdirSync(new URL('../generated/', import.meta.url))) if (name.endsWith('.json')) scan(readFileSync(new URL(`../generated/${name}`, import.meta.url)));
  scan(Buffer.from((await buildWorker()).text));
  // Cloud Run-only checkouts need not contain historical Worker profiling artifacts.
  for (const name of ['worker.bundle', 'startup.cpuprofile']) {
    const path = new URL(`../.local/deploy-check/${name}`, import.meta.url);
    if (existsSync(path)) scan(readFileSync(path));
  }
  const localDir = new URL('../.local/', import.meta.url);
  for (const name of existsSync(localDir) ? readdirSync(localDir) : []) {
    if (/^remote-probe(?:-exact)?-summary\.json$/.test(name)) scan(readFileSync(new URL(`../.local/${name}`, import.meta.url)));
  }
  console.log(JSON.stringify({ status: leaks ? 'SECRET_SCAN_FAILED' : 'SECRET_SCAN_PASS', scanned, matches: leaks }));
  if (leaks) process.exitCode = 1;
} catch { console.log('{"error":"SECRET_SCAN_FAILED"}'); process.exitCode = 1; }

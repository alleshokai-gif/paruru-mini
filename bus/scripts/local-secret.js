import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
export function readLocalToken() {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  try {
    execFileSync('git', ['-C', root, 'check-ignore', '--quiet', 'bus/.dev.vars'], { stdio: 'pipe' });
    if (execFileSync('git', ['-C', root, 'ls-files', 'bus/.dev.vars'], { encoding: 'utf8', stdio: 'pipe' }).trim()) throw Error();
    const rows = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)
      .filter((line) => /^\s*ODPT_ACCESS_TOKEN\s*=/.test(line));
    if (rows.length !== 1) throw Error();
    const token = rows[0].slice(rows[0].indexOf('=') + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    if (!token || /\s/.test(token) || (process.env.ODPT_ACCESS_TOKEN && process.env.ODPT_ACCESS_TOKEN !== token)) throw Error();
    return token;
  } catch { throw new Error('BUS_LOCAL_SECRET_INVALID'); }
}

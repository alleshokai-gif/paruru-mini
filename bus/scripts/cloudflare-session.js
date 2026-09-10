// CLI-managed OAuth only; capture credentials privately, never print child output or raw API errors.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
export const ACCOUNT_ID = 'fefb5053df43957c88be306bf60db824';
export function cloudflareSession() {
  const env = { ...process.env, WRANGLER_WRITE_LOGS: 'false', WRANGLER_SEND_METRICS: 'false' };
  delete env.ODPT_ACCESS_TOKEN;
  const cwd = fileURLToPath(new URL('../', import.meta.url));
  let auth;
  try {
    auth = JSON.parse(execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'auth', 'token', '--json'],
      { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', windowsHide: true, timeout: 60000 }));
  } catch { throw Error('CF_AUTH_UNAVAILABLE'); }
  if (!['oauth', 'api_token'].includes(auth.type) || !auth.token) throw Error('CF_AUTH_UNAVAILABLE');
  return {
    async api(path, { method = 'GET', json, body } = {}) {
      if (!/^\/workers\//.test(path)) throw Error('CF_PATH_DENIED');
      const headers = { Authorization: `Bearer ${auth.token}` };
      if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
      const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}${path}`, {
        method, headers, body, redirect: 'error', signal: AbortSignal.timeout(60000)
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        const error = Error('CF_API_FAILED');
        error.httpStatus = response.status; error.apiCodes = result.errors?.map((e) => e.code);
        throw error;
      }
      return result.result;
    },
    safe(value, extraSecrets = []) {
      const output = JSON.stringify(value);
      if ([auth.token, ...extraSecrets].some((secret) => secret && output.includes(secret))) throw Error('CF_SECRET_OUTPUT_REJECTED');
      return output;
    }
  };
}

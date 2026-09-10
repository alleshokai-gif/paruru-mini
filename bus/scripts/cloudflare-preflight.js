// Read-only Cloudflare checks. OAuth credentials stay in a private child-process pipe.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cwd = fileURLToPath(new URL('../', import.meta.url));
const env = { ...process.env, WRANGLER_WRITE_LOGS: 'false', WRANGLER_SEND_METRICS: 'false' };
delete env.ODPT_ACCESS_TOKEN;
try {
  const run = (args) => JSON.parse(execFileSync(process.execPath,
    ['node_modules/wrangler/bin/wrangler.js', ...args, '--json'],
    { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', windowsHide: true, timeout: 60000 }));
  const identity = run(['whoami']);
  const expectedId = 'fefb5053df43957c88be306bf60db824';
  const account = identity.accounts?.find((a) => a.id === expectedId);
  if (!identity.loggedIn || !account) throw Error('CF_ACCOUNT_NOT_VERIFIED');
  const auth = run(['auth', 'token']);
  if (!['oauth', 'api_token'].includes(auth.type) || !auth.token) throw Error('CF_AUTH_UNAVAILABLE');
  const kinds = ['workers/scripts', 'workers/subdomain', 'workers/account-settings', 'subscriptions'];
  const results = await Promise.all(kinds.map(async (kind) => {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${expectedId}/${kind}`, {
      headers: { Authorization: `Bearer ${auth.token}` }, redirect: 'error', signal: AbortSignal.timeout(30000)
    });
    const body = await response.json();
    const base = { check: kind, httpStatus: response.status, success: body.success,
      errorCodes: body.errors?.map((e) => e.code) };
    if (!response.ok || !body.success) return base;
    if (kind === 'workers/scripts') return { ...base, totalWorkers: body.result.length,
      targetExists: body.result.some((w) => w.id === 'paluru-bus-api'), resultInfo: body.result_info };
    if (kind === 'workers/subdomain') return { ...base, subdomain: body.result.subdomain };
    if (kind === 'workers/account-settings') return { ...base, defaultUsageModel: body.result.default_usage_model };
    return { ...base, subscriptions: body.result.map((s) => ({ state: s.state, frequency: s.frequency,
      ratePlan: { id: s.rate_plan?.id, publicName: s.rate_plan?.public_name },
      componentNames: s.component_values?.map((c) => c.name) })) };
  }));
  const output = JSON.stringify({ checkedAt: new Date().toISOString(), account: { id: account.id, name: account.name }, results });
  if (output.includes(auth.token)) throw Error('CF_SECRET_OUTPUT_REJECTED');
  console.log(output);
} catch { console.error('CF_PREFLIGHT_FAILED'); process.exitCode = 1; }

import { LIMITS } from '../../config/policy.js';
import { API_ROOT, STATIC_PATH } from './config.js';

const fail = (code) => { throw new Error(code); };

export async function fetchSeibuStatic(token, fetcher = fetch) {
  if (!token || /\s/.test(token)) fail('BUS_SECRET_MISSING');
  const url = new URL(STATIC_PATH, API_ROOT);
  url.searchParams.set('acl:consumerKey', token);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIMITS.requestTimeoutMs);
  try {
    const response = await fetcher(url.href, { redirect: 'follow', signal: controller.signal });
    if (!response.ok) fail('BUS_SEIBU_STATIC_HTTP');
    if (Number(response.headers.get('content-length')) > LIMITS.zipMaxBytes) fail('BUS_SEIBU_STATIC_SIZE');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > LIMITS.zipMaxBytes) fail('BUS_SEIBU_STATIC_SIZE');
    return bytes;
  } catch (error) {
    if (/^BUS_(?:SEIBU_|SECRET_)[A-Z_]+$/.test(error?.message || '')) throw error;
    fail('BUS_SEIBU_STATIC_FETCH');
  } finally { clearTimeout(timer); }
}

\n
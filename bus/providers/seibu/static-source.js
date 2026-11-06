import { LIMITS } from '../../config/policy.js';
import { API_ROOT, STATIC_PATH } from './config.js';

const fail = (code) => { throw new Error(code); };

export async function fetchSeibuStatic(token, fetcher = fetch) {
  return (await fetchSeibuResource(token, fetcher)).bytes;
}

export async function fetchSeibuResource(token, fetcher = fetch, etag = null) {
  if (!token || /\s/.test(token)) fail('BUS_SECRET_MISSING');
  const url = new URL(STATIC_PATH, API_ROOT);
  url.searchParams.set('acl:consumerKey', token);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const options = { redirect:'manual', signal:controller.signal,
      headers: typeof etag === 'string' && /^"[^"\r\n]{1,120}"$/.test(etag) ? {'If-None-Match':etag} : {} };
    let response = await fetcher(url.href,options);
    if ([302,303,307,308].includes(response.status)) {
      const delivery = new URL(response.headers.get('location'));
      if (delivery.origin !== 'https://dataodpt.blob.core.windows.net' || delivery.username || delivery.password || delivery.hash
        || delivery.pathname !== '/files-dc-public/SeibuBus/data/SeibuBus-GTFS.zip'
        || !delivery.searchParams.has('sig') || [...delivery.searchParams.keys()].some(k=>!['se','sig','sp','sr','st','sv'].includes(k)))
        fail('BUS_SEIBU_STATIC_REDIRECT');
      await response.body?.cancel();
      response = await fetcher(delivery.href,options);
    }
    if (response.status === 304) { if (!etag) fail('BUS_SEIBU_STATIC_HTTP'); return null; }
    if (!response.ok) fail('BUS_SEIBU_STATIC_HTTP');
    if (Number(response.headers.get('content-length')) > LIMITS.zipMaxBytes) fail('BUS_SEIBU_STATIC_SIZE');
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > LIMITS.zipMaxBytes) fail('BUS_SEIBU_STATIC_SIZE');
      chunks.push(chunk);
    }
    if (!size) fail('BUS_SEIBU_STATIC_SIZE');
    return { bytes: Buffer.concat(chunks), etag: response.headers.get('etag') };
  } catch (error) {
    if (/^BUS_(?:SEIBU_|SECRET_)[A-Z_]+$/.test(error?.message || '')) throw error;
    fail('BUS_SEIBU_STATIC_FETCH');
  } finally { clearTimeout(timer); }
}

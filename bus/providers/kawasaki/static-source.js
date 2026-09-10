// Build-time only. This module must never enter the Worker runtime graph.
import { LIMITS } from '../../config/settings.js';
const API = 'https://api.odpt.org/api/v4/';
const STATIC_PATH = 'files/odpt/TransportationBureau_CityOfKawasaki/AllLines.zip';
const fail = (code) => { throw new Error(code); };

export async function fetchStatic(token, date, fetcher = fetch) {
  if (!token || /\s/.test(token)) fail('BUS_SECRET_MISSING');
  if (!/^\d{8}$/.test(date)) fail('BUS_STATIC_DATE_INVALID');
  const url = new URL(STATIC_PATH, API);
  url.searchParams.set('acl:consumerKey', token);
  url.searchParams.set('date', date);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIMITS.requestTimeoutMs);
  try {
    let response = await fetcher(url.href, { redirect: 'manual', signal: controller.signal });
    if ([302, 303, 307, 308].includes(response.status)) {
      let delivery; try { delivery = new URL(response.headers.get('location')); } catch { fail('BUS_REDIRECT_REJECTED'); }
      const allowedQuery = new Set(['se', 'sig', 'sp', 'sr', 'st', 'sv']);
      if (delivery.protocol !== 'https:' || delivery.hostname !== 'dataodpt.blob.core.windows.net' || delivery.port || delivery.username || delivery.password || delivery.hash
        || delivery.pathname !== `/files-dc-public/odpt/TransportationBureau_CityOfKawasaki/AllLines-${date}.zip`
        || !delivery.searchParams.has('sig') || [...delivery.searchParams.keys()].some((k) => !allowedQuery.has(k))) fail('BUS_REDIRECT_REJECTED');
      await response.body?.cancel();
      response = await fetcher(delivery.href, { redirect: 'manual', signal: controller.signal });
    }
    if (!response.ok) fail('BUS_UPSTREAM_HTTP');
    const max = LIMITS.zipMaxBytes;
    if (Number(response.headers.get('content-length')) > max) fail('BUS_UPSTREAM_SIZE');
    const reader = response.body.getReader(); const chunks = []; let size = 0;
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length; if (size > max) { await reader.cancel(); fail('BUS_UPSTREAM_SIZE'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
  } catch (error) {
    // Never expose upstream messages: fetch errors can include authenticated URLs.
    if (/^BUS_[A-Z_]+$/.test(error?.message || '')) throw error;
    fail('BUS_UPSTREAM_FETCH');
  } finally { clearTimeout(timer); }
}

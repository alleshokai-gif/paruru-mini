import { fileURLToPath } from 'node:url';
import source from '../config/static-source.json' with { type: 'json' };
import { fetchStatic } from '../providers/kawasaki/static-source.js';
import { readLocalToken } from './local-secret.js';
import { buildP0Static, publishStatic } from './p0-static.js';
try {
  const token = readLocalToken(), started = performance.now();
  const bytes = await fetchStatic(token, source.sourceDate);
  const fetched = performance.now();
  const index = buildP0Static(bytes, { sourceDate: source.sourceDate, now: Date.now() / 1000 });
  if (JSON.stringify(index).includes(token)) throw Error('BUS_SECRET_LEAK');
  const result = publishStatic(index, fileURLToPath(new URL('../generated/p0-static.json', import.meta.url)));
  console.log(JSON.stringify({ status: 'STATIC_BUILD_PASS', generatedAt: index.generatedAt, sourceDate: index.sourceDate,
    sourceVersion: index.sourceVersion, sourceZipBytes: bytes.length, ...result,
    fetchMs: Math.round(fetched - started), buildMs: Math.round(performance.now() - fetched) }));
} catch (error) {
  console.log(JSON.stringify({ error: /^[A-Z_]+$/.test(error?.message || '') ? error.message : 'STATIC_BUILD_FAILED' }));
  process.exitCode = 1;
}

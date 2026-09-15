import { fileURLToPath } from 'node:url';
import { readLocalToken } from './local-secret.js';
import { fetchSeibuStatic } from '../providers/seibu/static-source.js';
import { buildSeibuStatic, publishSeibuStatic } from '../providers/seibu/static-build.js';

try {
  const token = readLocalToken(), started = performance.now();
  const bytes = await fetchSeibuStatic(token), fetched = performance.now();
  const artifact = buildSeibuStatic(bytes);
  if (JSON.stringify(artifact).includes(token)) throw new Error('BUS_SECRET_LEAK');
  const result = publishSeibuStatic(artifact,
    fileURLToPath(new URL('../generated/seibu-p2-4-static.json', import.meta.url)));
  console.log(JSON.stringify({ status: 'SEIBU_STATIC_BUILD_PASS', sourceVersion: artifact.sourceVersion,
    ...result, fetchMs: Math.round(fetched - started), buildMs: Math.round(performance.now() - fetched) }));
} catch (error) {
  console.log(JSON.stringify({ status: 'SEIBU_STATIC_BUILD_FAILED',
    code: /^BUS_[A-Z0-9_]+$/.test(error?.message || '') ? error.message : 'BUS_SEIBU_STATIC_BUILD_FAILED' }));
  process.exitCode = 1;
}

import { fileURLToPath } from 'node:url';
import source from '../config/static-source.json' with { type: 'json' };
import { fetchStatic } from '../providers/kawasaki/static-source.js';
import { readLocalToken } from './local-secret.js';
import { buildP2_5KawasakiStatic, publishP2_5KawasakiStatic } from './p2-5-kawasaki-static.js';

try {
  const token = readLocalToken(), started = performance.now();
  const bytes = await fetchStatic(token, source.sourceDate), fetched = performance.now();
  const artifact = buildP2_5KawasakiStatic(bytes, { sourceDate: source.sourceDate, now: Date.now() / 1000 });
  if (JSON.stringify(artifact).includes(token)) throw new Error('BUS_SECRET_LEAK');
  const published = publishP2_5KawasakiStatic(artifact,
    fileURLToPath(new URL('../generated/kawasaki-p2-5-static.json', import.meta.url)));
  console.log(JSON.stringify({ status: 'P2_5_KAWASAKI_STATIC_BUILD_PASS', sourceDate: source.sourceDate,
    sourceVersion: artifact.sourceVersion, trips: artifact.directions.mukougaoka_to_kibukihoncho.length,
    ...published, fetchMs: Math.round(fetched - started), buildMs: Math.round(performance.now() - fetched) }));
} catch (error) {
  console.log(JSON.stringify({ error: /^BUS_[A-Z0-9_]+$/.test(error?.message || '') ? error.message : 'P2_5_STATIC_BUILD_FAILED' }));
  process.exitCode = 1;
}

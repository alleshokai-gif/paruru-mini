// Build-time only: one official ZIP produces all eight query indexes and sidecar.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import source from '../config/static-source.json' with { type: 'json' };
import { fetchStatic } from '../providers/kawasaki/static-source.js';
import { readLocalToken } from './local-secret.js';
import { publishStatic } from './p0-static.js';
import { publishP2_5KawasakiStatic } from './p2-5-kawasaki-static.js';
import { publishPositionStatic } from './position-static.js';
import { buildKawasakiPositionBatch, verifyKawasakiPositionBatch } from './kawasaki-position-batch.js';

const path = name => fileURLToPath(new URL(name, import.meta.url));
const read = name => JSON.parse(readFileSync(path(name), 'utf8'));
try {
  const previous = { p0: read('../generated/p0-static.json'),
    journey: read('../generated/kawasaki-p2-5-static.json'),
    position: read('../generated/p1-position-static.json') };
  const bundle = read('../release-static/position-shadow-geometry.json');
  const token = readLocalToken();
  const bytes = await fetchStatic(token, source.sourceDate);
  const next = buildKawasakiPositionBatch(bytes, { sourceDate: source.sourceDate });
  const verified = verifyKawasakiPositionBatch(previous, next, bundle);
  const serialized = JSON.stringify({ ...next, bundle: verified.bundle });
  if ([token, encodeURIComponent(token)].some(secret => serialized.includes(secret))) throw Error('POSITION_BATCH_SECRET_LEAK');
  publishStatic(next.p0, path('../generated/p0-static.json'));
  publishP2_5KawasakiStatic(next.journey, path('../generated/kawasaki-p2-5-static.json'));
  publishPositionStatic(next.position, verified.index, path('../generated/p1-position-static.json'));
  const shadowText = JSON.stringify(verified.bundle, null, 2) + '\n';
  if (readFileSync(path('../release-static/position-shadow-geometry.json'), 'utf8') !== shadowText) {
    writeFileSync(path('../release-static/position-shadow-geometry.json'), shadowText);
  }
  console.log(JSON.stringify({ status: 'KAWASAKI_POSITION_BATCH_PASS',
    sourceVersion: next.position.sourceVersion, sourceHash: next.position.sourceHash,
    ...verified.stats, shadowApprovedForPublic: false, geometryReady: false }));
} catch (error) {
  const code = /^POSITION_BATCH_[A-Z_]+$/.test(error?.message || '') ? error.message : 'POSITION_BATCH_UNAVAILABLE';
  console.log(JSON.stringify({ status: 'KAWASAKI_POSITION_BATCH_FAILED', code }));
  process.exitCode = 1;
}

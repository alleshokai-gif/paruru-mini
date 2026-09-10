// Local preflight only: no network, credentials, or generated artifact mutation.
import { readFileSync } from 'node:fs';
import source from '../config/static-source.json' with { type: 'json' };
import { validateArtifact } from './p0-static.js';
import { getArrivals } from '../core/arrivals.js';
try {
  const text = readFileSync(new URL('../generated/p0-static.json', import.meta.url), 'utf8');
  const index = validateArtifact(JSON.parse(text), source.sourceDate);
  const data = getArrivals({ index, now: Date.now() / 1000 });
  if (data.directions.some((d) => !d.arrivals.length)) throw Error('STATIC_NEXT_TRIP_MISSING');
  console.log(JSON.stringify({ status: 'STATIC_PREFLIGHT_PASS', sourceVersion: index.sourceVersion,
    bytes: Buffer.byteLength(text), counts: index.stats.selectedRows }));
} catch (error) {
  console.log(JSON.stringify({ error: /^[A-Z_]+$/.test(error?.message || '') ? error.message : 'STATIC_PREFLIGHT_FAILED' }));
  process.exitCode = 1;
}

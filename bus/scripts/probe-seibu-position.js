// Research-only sequence/GPS observer. It does not change runtime DTOs or feature gates.
import { renameSync, writeFileSync } from 'node:fs';
import { setTimeout as wait } from 'node:timers/promises';
import { readLocalToken } from './local-secret.js';
import { fetchSeibuStatic } from '../providers/seibu/static-source.js';
import { buildSeibuPositionResearchIndex } from '../providers/seibu/static-build.js';
import { fetchSeibuRealtime } from '../providers/seibu/realtime.js';
import { analyzeSeibuPositionSample, summarizeSeibuPositionObservations } from '../research/seibu-position.js';

const integer = (value, fallback, min, max) => {
  const result = value == null || value === '' ? fallback : Number(value);
  if (!Number.isInteger(result) || result < min || result > max) throw Error('BUS_SEIBU_POSITION_CONFIG');
  return result;
};

let phase = 'config';
try {
  const token = readLocalToken();
  const sampleCount = integer(process.env.SEIBU_POSITION_SAMPLE_COUNT, 5, 1, 10);
  const intervalSec = integer(process.env.SEIBU_POSITION_INTERVAL_SEC, 32, 30, 35);
  phase = 'static';
  const staticBytes = await fetchSeibuStatic(token);
  const positionIndex = buildSeibuPositionResearchIndex(staticBytes);
  const captureId = new Date().toISOString().slice(0, 19).replaceAll(/[-:]/g, '');
  const samples = [];
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
    if (sampleIndex) await wait(intervalSec * 1000);
    phase = 'realtime';
    const receivedAt = Date.now() / 1000, realtime = await fetchSeibuRealtime(token);
    const observations = analyzeSeibuPositionSample({ positionIndex, vehicles: realtime.vehicles, receivedAt });
    samples.push({ sampleIndex, receivedAt, feedTimestamp: realtime.vehicleTimestamp, observations });
  }
  const summary = summarizeSeibuPositionObservations(samples);
  const result = { researchOnly: true, productionInput: false, publicPositionEnabled: false,
    captureId, sourceVersion: positionIndex.sourceVersion, sampleCount, intervalSec, samples, summary };
  const encoded = `${JSON.stringify(result, null, 2)}\n`;
  if (encoded.includes(token) || /vehicleId|consumerKey/.test(encoded)) throw Error('BUS_SEIBU_POSITION_SECRET');
  const target = new URL(`../generated/seibu-position-poc-${captureId}.json`, import.meta.url);
  const temporary = new URL(`${target.href}.tmp`);
  phase = 'write'; writeFileSync(temporary, encoded, { encoding: 'utf8', flush: true });
  renameSync(temporary, target);
  console.log(JSON.stringify({ status: 'SEIBU_POSITION_POC_PASS', captureId,
    sourceVersion: positionIndex.sourceVersion, ...summary }));
} catch (error) {
  const code = /^BUS_SEIBU_POSITION_[A-Z_]+$/.test(error?.message || '')
    ? error.message : 'BUS_SEIBU_POSITION_FAILED';
  console.log(JSON.stringify({ status: 'SEIBU_POSITION_POC_STOPPED', phase, code }));
  process.exitCode = 1;
}

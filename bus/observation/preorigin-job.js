import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import source from '../config/static-source.json' with { type: 'json' };
import { validateArtifact } from '../runtime/static-artifact.js';
import { fetchRealtime } from '../providers/kawasaki/adapter.js';
import { preoriginObservationConfig } from './preorigin-config.js';
import { createPreoriginObservationCollector } from './preorigin-collector.js';
import { createPreoriginSheetsStore } from './preorigin-sheets.js';
import { runPreoriginObservation } from './preorigin-runner.js';

const safeCode = (error) => /^PREORIGIN_[A-Z_]+$/.test(error?.message || '') ? error.message : 'PREORIGIN_FAILED';
export async function startPreoriginObservationJob({ env = process.env,
  log = (value) => console.log(JSON.stringify(value)), fetchRaw = null,
  storeFactory = createPreoriginSheetsStore, clock = () => Date.now() / 1000, sleep } = {}) {
  const config = preoriginObservationConfig(env), runConfig = Object.freeze({ ...config, runId: config.runId || randomUUID() });
  const index = validateArtifact(JSON.parse(readFileSync(new URL('../generated/p0-static.json', import.meta.url), 'utf8')),
    source.sourceDate);
  const positionStatic = JSON.parse(readFileSync(new URL('../generated/p1-position-static.json', import.meta.url), 'utf8'));
  const collector = createPreoriginObservationCollector({ index, positionStatic, hashKey: config.hashKey });
  const store = storeFactory({ spreadsheetId: config.spreadsheetId });
  log({ event: 'preorigin_start', runId: runConfig.runId, sampleCount: runConfig.sampleCount,
    intervalSec: config.intervalSec, maxRunSec: config.maxRunSec, targetTrips: collector.targetCount(clock()) });
  return runPreoriginObservation({ config: runConfig, fetchRaw: fetchRaw || (() => fetchRealtime(config.token)),
    collector, store, clock, sleep, log });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await startPreoriginObservationJob(); }
  catch (error) { console.error(JSON.stringify({ event: 'preorigin_failed', code: safeCode(error) })); process.exitCode = 1; }
}

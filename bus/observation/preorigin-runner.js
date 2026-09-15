import { randomUUID } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';
import { withinTimeBands } from './config.js';

export async function runPreoriginObservation({ config, fetchRaw, collector, store, clock = () => Date.now() / 1000,
  sleep = (seconds) => wait(seconds * 1000), log = () => {} } = {}) {
  if (!config || typeof fetchRaw !== 'function' || typeof collector?.collect !== 'function'
    || typeof collector?.activeTargetCount !== 'function' || typeof store?.append !== 'function')
    throw Error('PREORIGIN_RUNNER_CONFIG_INVALID');
  const startedAt = clock(), runId = config.runId || randomUUID();
  if (!withinTimeBands(startedAt, config.timeBands)) {
    const result = { status: 'skipped', reason: 'outside_time_band', samples: 0, fetched: 0, rows: 0, inserted: 0, duplicates: 0 };
    log({ event: 'preorigin_skipped', runId, reason: result.reason }); return result;
  }
  if (!collector.targetCount(startedAt)) {
    const result = { status: 'skipped', reason: 'no_target_service', samples: 0, fetched: 0, rows: 0, inserted: 0, duplicates: 0 };
    log({ event: 'preorigin_skipped', runId, reason: result.reason }); return result;
  }
  const totals = { status: 'success', reason: null, samples: 0, fetched: 0, rows: 0, inserted: 0, duplicates: 0 };
  for (let sampleIndex = 0; sampleIndex < config.sampleCount; sampleIndex++) {
    const now = clock(), elapsed = now - startedAt;
    if (elapsed >= config.maxRunSec) { totals.status = 'bounded'; totals.reason = 'max_run_reached'; break; }
    if (!withinTimeBands(now, config.timeBands)) { totals.status = 'bounded'; totals.reason = 'time_band_ended'; break; }
    if (!collector.activeTargetCount(now)) { totals.status = 'bounded'; totals.reason = 'no_active_target'; break; }
    const fetchStarted = performance.now(), bytes = await fetchRaw();
    const fetchMs = performance.now() - fetchStarted; totals.fetched++;
    const observedAt = clock(), collectStarted = performance.now();
    const collected = collector.collect({ bytes, now: observedAt, runId, sampleIndex });
    const collectMs = performance.now() - collectStarted, writeStarted = performance.now();
    const write = await store.append(collected.rows), writeMs = performance.now() - writeStarted;
    totals.samples++; totals.rows += collected.rows.length; totals.inserted += write.inserted; totals.duplicates += write.duplicates;
    log({ event: 'preorigin_sample', runId, sampleIndex, activeTargets: collector.activeTargetCount(observedAt),
      rows: collected.rows.length, inserted: write.inserted, duplicates: write.duplicates,
      rawVehicleEntities: collected.summary?.entities ?? 0, tripless: collected.summary?.tripIdMissing ?? 0,
      partialDescriptors: collected.summary?.partialAssignments ?? 0, stale: collected.summary?.stale ?? 0,
      gpsMissing: collected.summary?.gpsMissing ?? 0, fetchMs: Number(fetchMs.toFixed(3)),
      collectMs: Number(collectMs.toFixed(3)), writeMs: Number(writeMs.toFixed(3)) });
    if (sampleIndex === config.sampleCount - 1) break;
    const nextAt = startedAt + (sampleIndex + 1) * config.intervalSec, delay = Math.max(0, nextAt - clock());
    if (clock() - startedAt + delay >= config.maxRunSec) { totals.status = 'bounded'; totals.reason = 'max_run_reached'; break; }
    await sleep(delay);
  }
  log({ event: 'preorigin_complete', runId, samples: totals.samples, fetched: totals.fetched, rows: totals.rows,
    inserted: totals.inserted, duplicates: totals.duplicates, status: totals.status, reason: totals.reason });
  return totals;
}

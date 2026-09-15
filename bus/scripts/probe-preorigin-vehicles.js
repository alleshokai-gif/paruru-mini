// Research-only raw VehiclePosition classifier. It never changes the runtime adapter or Public API.
import { randomBytes } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { setTimeout as wait } from 'node:timers/promises';
import { readLocalToken } from './local-secret.js';
import { fetchRealtime } from '../providers/kawasaki/adapter.js';
import { classifyRawVehiclePositions, createPreoriginTracker, distanceMeters,
  extractKibukihonchoOriginTrips } from '../research/preorigin.js';

const JST = 9 * 3600, DAY = 86400;
const dayStart = (seconds) => Math.floor((seconds + JST) / DAY) * DAY - JST;
const dateKey = (seconds) => new Date((seconds + JST) * 1000).toISOString().slice(0, 10).replaceAll('-', '');
const boundedInteger = (value, fallback, min, max) => {
  const parsed = value == null || value === '' ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw Error('PREORIGIN_CONFIG_INVALID');
  return parsed;
};

let phase = 'config';
try {
  const token = readLocalToken(), hashKey = randomBytes(32).toString('hex');
  phase = 'static';
  const index = JSON.parse(readFileSync(new URL('../generated/p0-static.json', import.meta.url), 'utf8'));
  const positionStatic = JSON.parse(readFileSync(new URL('../generated/p1-position-static.json', import.meta.url), 'utf8'));
  const origin = positionStatic?.stops?.['184_1']?.position;
  if (positionStatic?.sourceVersion !== index.sourceVersion || !Number.isFinite(origin?.lat)
    || !Number.isFinite(origin?.lon)) throw Error('PREORIGIN_STATIC_INVALID');
  const intendedSamples = boundedInteger(process.env.PREORIGIN_SAMPLE_COUNT, 1, 1, 40);
  const intervalSec = boundedInteger(process.env.PREORIGIN_INTERVAL_SEC, 32, 30, 35);
  const startedAt = Date.now() / 1000, start = dayStart(startedAt), serviceDate = dateKey(startedAt);
  const staticRows = extractKibukihonchoOriginTrips(index, { serviceDayStart: start });
  const targets = staticRows.map((row) => ({ tripId: row.tripId, serviceDate,
    scheduledDeparture: start + row.scheduledSeconds }));
  const tracker = targets.length ? createPreoriginTracker({ origin, targetTrips: targets }) : null;
  const captureId = new Date().toISOString().slice(0, 19).replaceAll(/[-:]/g, '');
  const target = new URL(`../generated/preorigin-poc-${captureId}.json`, import.meta.url);
  const temporary = new URL(`${target.href}.tmp`), samples = [], trajectories = [];
  let latestRecords = [], transitions = 0;
  for (let sampleIndex = 0; sampleIndex < intendedSamples; sampleIndex++) {
    if (sampleIndex) await wait(intervalSec * 1000);
    const receivedAt = Date.now() / 1000; phase = 'realtime_fetch';
    const source = await fetchRealtime(token);
    phase = 'raw_classification';
    const classified = classifyRawVehiclePositions(source, { hashKey, receivedAt });
    const observed = tracker ? tracker.observe({ sample: classified, now: receivedAt }) : { records: [], transitions: [] };
    latestRecords = observed.records; transitions += observed.transitions.length;
    const targetKeys = new Set(targets.map((value) => `${value.serviceDate}:${value.tripId}`));
    for (const vehicle of classified.vehicles) {
      const distance = Number.isFinite(vehicle.position.lat) && Number.isFinite(vehicle.position.lon)
        ? distanceMeters(vehicle.position, origin) : null;
      const isTarget = targetKeys.has(`${vehicle.startDate || ''}:${vehicle.tripId || ''}`);
      if ((vehicle.classification !== 'assigned' && Number.isFinite(distance) && distance <= 4000) || isTarget)
        trajectories.push({ sampleIndex, vehicleHash: vehicle.vehicleHash, classification: vehicle.classification,
          timestamp: vehicle.timestamp, tripId: vehicle.tripId, routeId: vehicle.routeId, startDate: vehicle.startDate,
          lat: vehicle.position.lat, lon: vehicle.position.lon,
          distanceToOriginMeters: Number.isFinite(distance) ? Number(distance.toFixed(1)) : null });
    }
    samples.push({ sampleIndex, receivedAt, feedTimestamp: classified.feedTimestamp, ...classified.summary,
      activeTargetWindows: targets.filter((value) => receivedAt >= value.scheduledDeparture - 900
        && receivedAt <= value.scheduledDeparture + 300).length, transitions: observed.transitions.length });
  }
  const result = { researchOnly: true, productionInput: false, runtimeAdapterChanged: false,
    captureId, startedAt: new Date(startedAt * 1000).toISOString(), hashScope: 'capture_ephemeral',
    sourceVersion: index.sourceVersion, serviceDate, scheduledOriginTrips: staticRows,
    intendedSamples, intervalSec, samples, records: latestRecords, trajectories,
    summary: { samples: samples.length, rawVehicleEntities: samples.reduce((sum, value) => sum + value.entities, 0),
      unassignedCandidates: samples.reduce((sum, value) => sum + value.unassignedCandidates, 0),
      partialAssignments: samples.reduce((sum, value) => sum + value.partialAssignments, 0),
      droppedByRuntimeParser: samples.reduce((sum, value) => sum + value.droppedByRuntimeParser, 0),
      nearbyPreoriginTrajectories: trajectories.length, vehicleToTargetTripTransitions: transitions,
      levelA: latestRecords.filter((value) => value.level === 'A').length,
      levelB: latestRecords.filter((value) => value.level === 'B').length } };
  phase = 'write'; const encoded = JSON.stringify(result, null, 2) + '\n';
  if (encoded.includes(token) || encoded.includes(hashKey)) throw Error('PREORIGIN_SECRET_LEAK');
  writeFileSync(temporary, encoded, { encoding: 'utf8', flush: true }); renameSync(temporary, target);
  console.log(JSON.stringify({ status: 'PREORIGIN_POC_PASS', captureId, serviceDate,
    scheduledOriginTrips: staticRows.length, ...result.summary }));
} catch (error) {
  const code = /^(?:PREORIGIN|BUS)_[A-Z_]+$/.test(error?.message || '') ? error.message : 'PREORIGIN_POC_FAILED';
  console.log(JSON.stringify({ status: 'PREORIGIN_POC_STOPPED', phase, code })); process.exitCode = 1;
}

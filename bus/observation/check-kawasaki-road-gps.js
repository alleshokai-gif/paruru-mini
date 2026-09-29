import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { GoogleAuth } from 'google-auth-library';
import { PREORIGIN_SCHEDULER_CONFIG } from './preorigin-scheduler.js';
import { OBSERVATION_HEADERS, RAW_SHEET } from './schema.js';
import { buildCandidateRowRanges, indexCandidatePositionRows, mapCandidateGpsSamples, positionTripIndex } from './road-gps-evidence.js';

const JOB = 'paluru-bus-observer';
const SCOPES = ['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/spreadsheets.readonly'];
const MAX_TARGET_ROWS = 12000;
const RUNS_PER_REQUEST = 60;
const SHEETS_ROOT = 'https://sheets.googleapis.com/v4/spreadsheets/';

function jobContainers(job) {
  return job?.template?.template?.containers || [];
}

function spreadsheetIdFromJob(job) {
  const env = new Map((jobContainers(job)[0]?.env || []).map((item) => [item.name, item]));
  const value = env.get('PALURU_BUS_OBSERVATION_SPREADSHEET_ID')?.value;
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{20,128}$/.test(value))
    throw Error('ROAD_GPS_SHEET_CONFIG_UNAVAILABLE');
  return value;
}

async function valuesGet(client, spreadsheetId, range) {
  const url = `${SHEETS_ROOT}${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`
    + '?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE';
  return (await client.request({ url })).data;
}

async function valuesBatchGet(client, spreadsheetId, ranges) {
  const query = new URLSearchParams({ majorDimension: 'ROWS', valueRenderOption: 'UNFORMATTED_VALUE' });
  for (const range of ranges) query.append('ranges', range);
  const url = `${SHEETS_ROOT}${encodeURIComponent(spreadsheetId)}/values:batchGet?${query}`;
  const result = (await client.request({ url })).data?.valueRanges;
  if (!Array.isArray(result) || result.length !== ranges.length) throw Error('ROAD_GPS_SHEET_RESPONSE_INVALID');
  return result;
}

function candidateCounts(rows, samples, chainIds) {
  return chainIds.map((chainId) => {
    const selected = rows.filter((row) => row.chainId === chainId);
    const points = samples.filter((sample) => sample.chainId === chainId);
    const validGps = points.filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon)
      && Math.abs(point.lat) <= 90 && Math.abs(point.lon) <= 180);
    const validTime = points.filter((point) => Number.isFinite(point.timestamp) && Number.isFinite(point.receivedAt));
    return { chainId, observationRows: selected.length, gpsRows: validGps.length,
      timestampRows: validTime.length, validHmacRows: points.filter((point) => point.identityValid).length };
  });
}

export async function readKawasakiRoadGpsEvidence({ candidateChainIds, positionStatic,
  auth = new GoogleAuth({ scopes: SCOPES }) } = {}) {
  if (!Array.isArray(candidateChainIds) || !candidateChainIds.length || candidateChainIds.length > 40)
    throw Error('ROAD_GPS_CHAIN_SET_INVALID');
  const client = await auth.getClient();
  const jobUrl = `https://run.googleapis.com/v2/projects/${PREORIGIN_SCHEDULER_CONFIG.project}`
    + `/locations/${PREORIGIN_SCHEDULER_CONFIG.region}/jobs/${JOB}`;
  const job = (await client.request({ url: jobUrl })).data;
  const spreadsheetId = spreadsheetIdFromJob(job);
  const headerData = await valuesGet(client, spreadsheetId, `'${RAW_SHEET}'!A1:AH1`);
  const headers = headerData.values?.[0] || [];
  if (JSON.stringify(headers) !== JSON.stringify(OBSERVATION_HEADERS)) throw Error('ROAD_GPS_RAW_SCHEMA_INVALID');
  const [kinds, routeTrips] = await Promise.all([
    valuesGet(client, spreadsheetId, `'${RAW_SHEET}'!D:D`),
    valuesGet(client, spreadsheetId, `'${RAW_SHEET}'!H:J`)
  ]);
  const tripIndex = positionTripIndex(positionStatic, candidateChainIds);
  const rows = indexCandidatePositionRows({ headers,
    kindValues: kinds.values || [], routeTripDateValues: routeTrips.values || [], tripIndex });
  if (rows.length > MAX_TARGET_ROWS) throw Error('ROAD_GPS_TARGET_ROW_LIMIT');
  const runs = buildCandidateRowRanges(rows), samples = [];
  for (let start = 0; start < runs.length; start += RUNS_PER_REQUEST) {
    const chunk = runs.slice(start, start + RUNS_PER_REQUEST), ranges = chunk.flatMap((run) => run.ranges);
    const values = await valuesBatchGet(client, spreadsheetId, ranges);
    samples.push(...mapCandidateGpsSamples({ rows: chunk.flatMap((run) => run.rows), runs: chunk, valueRanges: values }));
  }
  const counts = candidateCounts(rows, samples, candidateChainIds);
  return Object.freeze({ status: 'KAWASAKI_ROAD_GPS_READ_ONLY', rawSchema: 'match',
    indexRowsScanned: Math.max((kinds.values || []).length, (routeTrips.values || []).length) - 1,
    candidateChainCount: candidateChainIds.length, candidateTripCount: tripIndex.size,
    selectedObservationRows: rows.length, selectedGpsRows: samples.filter((point) => Number.isFinite(point.lat)
      && Number.isFinite(point.lon)).length, candidateCounts: counts,
    samplesByChain: new Map(candidateChainIds.map((chainId) => [chainId, samples.filter((point) => point.chainId === chainId)])) });
}

async function main() {
  const ids = (process.argv[2] || '').split(',').map((value) => value.trim()).filter(Boolean);
  const positionStatic = JSON.parse(readFileSync(new URL('../generated/p1-position-static.json', import.meta.url), 'utf8'));
  const result = await readKawasakiRoadGpsEvidence({ candidateChainIds: ids, positionStatic });
  const { samplesByChain, ...safe } = result;
  console.log(JSON.stringify(safe));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await main(); }
  catch (error) {
    const code = /^ROAD_GPS_[A-Z_]+$/.test(error?.message || '') ? error.message : 'ROAD_GPS_READ_FAILED';
    console.log(JSON.stringify({ status: 'KAWASAKI_ROAD_GPS_READ_FAILED', code }));
    process.exitCode = 1;
  }
}

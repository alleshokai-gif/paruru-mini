import { parseTimeBands } from './config.js';

const integer = (value, fallback, min, max, code) => {
  const number = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw Error(code);
  return number;
};

export function preoriginObservationConfig(env = process.env) {
  const token = env.ODPT_ACCESS_TOKEN, hashKey = env.OBSERVATION_HMAC_KEY;
  const spreadsheetId = env.PALURU_BUS_OBSERVATION_SPREADSHEET_ID;
  if (typeof token !== 'string' || !token || /\s/.test(token)) throw Error('PREORIGIN_ODPT_SECRET_MISSING');
  if (typeof hashKey !== 'string' || hashKey.length < 32 || /\s/.test(hashKey))
    throw Error('PREORIGIN_HASH_SECRET_INVALID');
  if (typeof spreadsheetId !== 'string' || !/^[A-Za-z0-9_-]{20,128}$/.test(spreadsheetId))
    throw Error('PREORIGIN_SPREADSHEET_ID_INVALID');
  const sampleCount = integer(env.PREORIGIN_SAMPLE_COUNT, 10, 1, 10, 'PREORIGIN_SAMPLE_COUNT_INVALID');
  const intervalSec = integer(env.PREORIGIN_INTERVAL_SEC, 32, 30, 35, 'PREORIGIN_INTERVAL_INVALID');
  const maxRunSec = integer(env.PREORIGIN_MAX_RUN_SEC, 310, 60, 330, 'PREORIGIN_MAX_RUN_INVALID');
  if ((sampleCount - 1) * intervalSec >= maxRunSec) throw Error('PREORIGIN_BOUNDS_INVALID');
  const timeBands = parseTimeBands(env.PREORIGIN_TIME_BANDS || '06:35-08:56');
  if (timeBands.length !== 1) throw Error('PREORIGIN_TIME_BANDS_INVALID');
  const execution = env.CLOUD_RUN_EXECUTION;
  const runId = typeof execution === 'string' && /^[a-z][a-z0-9-]{0,62}$/.test(execution) ? execution : null;
  return Object.freeze({ token, hashKey, spreadsheetId, sampleCount, intervalSec, maxRunSec, timeBands, runId });
}

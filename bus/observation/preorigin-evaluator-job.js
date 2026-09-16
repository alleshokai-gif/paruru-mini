import { GoogleAuth } from 'google-auth-library';
import { pathToFileURL } from 'node:url';
import { PREORIGIN_HEADERS, PREORIGIN_RAW_SHEET } from './preorigin-schema.js';
import { PREORIGIN_SCHEDULER_CONFIG } from './preorigin-scheduler.js';
import { preoriginEvaluatorConfig } from './preorigin-evaluator-config.js';
import { evaluatePreoriginCanary } from './preorigin-evaluator.js';
import { createPreoriginDailyStore } from './preorigin-evaluator-sheets.js';

const SCOPES = ['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/spreadsheets'];
const MAX_PAGES = 10, MAX_ROWS = 250000;
const safeCode = (error) => /^PREORIGIN_EVALUATOR_[A-Z_]+$/.test(error?.message || '')
  ? error.message : 'PREORIGIN_EVALUATOR_FAILED';
const localDate = (now) => new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 10);
const dayBounds = (date) => ({
  start: new Date(Date.parse(`${date}T00:00:00+09:00`)).toISOString(),
  end: new Date(Date.parse(`${date}T00:00:00+09:00`) + 24 * 3600 * 1000).toISOString()
});
const columnName = (count) => {
  let value = count, result = '';
  while (value) { value--; result = String.fromCharCode(65 + value % 26) + result; value = Math.floor(value / 26); }
  return result;
};

async function paged(client, requestForPage, key) {
  const rows = []; let token = '';
  for (let page = 0; page < MAX_PAGES; page++) {
    const response = await requestForPage(token), values = response.data?.[key] || [];
    rows.push(...values); token = response.data?.nextPageToken || ''; if (!token) return rows;
  }
  throw Error('PREORIGIN_EVALUATOR_PAGE_LIMIT');
}

async function schedulerResources(client, config) {
  return Promise.all(PREORIGIN_SCHEDULER_CONFIG.schedules.map(async ({ id }) => (await client.request({
    url: `https://cloudscheduler.googleapis.com/v1/projects/${config.project}/locations/${config.region}/jobs/${id}`
  })).data));
}

async function loggingEntries(client, { project, filter }) {
  return paged(client, (pageToken) => client.request({ url: 'https://logging.googleapis.com/v2/entries:list',
    method: 'POST', data: { resourceNames: [`projects/${project}`], filter, orderBy: 'timestamp asc',
      pageSize: 1000, ...(pageToken ? { pageToken } : {}) } }), 'entries');
}

async function executionRows(client, config, bounds) {
  const base = `https://run.googleapis.com/v2/projects/${config.project}/locations/${config.region}/jobs/${config.sourceJob}/executions`;
  const rows = []; let token = '';
  for (let page = 0; page < MAX_PAGES; page++) {
    const response = await client.request({
      url: `${base}?pageSize=100${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`
    });
    const values = response.data?.executions || [];
    rows.push(...values); token = response.data?.nextPageToken || '';
    const oldest = Date.parse(values.at(-1)?.createTime || '');
    // Cloud Run v2 documents execution results in descending creation-time order.
    // Once a page reaches the previous JST day, later pages cannot contain target-day rows.
    if (!token || Number.isFinite(oldest) && oldest < Date.parse(bounds.start)) return rows;
  }
  throw Error('PREORIGIN_EVALUATOR_PAGE_LIMIT');
}

async function rawValues(client, spreadsheetId, targetDate) {
  const root = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`;
  const metadata = (await client.request({ url: `${root}?fields=sheets.properties.title` })).data;
  if (!(metadata.sheets || []).some((sheet) => sheet.properties?.title === PREORIGIN_RAW_SHEET))
    return [];
  const lastColumn = columnName(PREORIGIN_HEADERS.length);
  const headerRange = encodeURIComponent(`'${PREORIGIN_RAW_SHEET}'!A1:${lastColumn}1`);
  const headerData = (await client.request({
    url: `${root}/values/${headerRange}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`
  })).data;
  const header = headerData.values?.[0] || [];
  if (JSON.stringify(header.map(String)) !== JSON.stringify(PREORIGIN_HEADERS)) return [header];
  const dateColumn = columnName(PREORIGIN_HEADERS.indexOf('service_date') + 1);
  const dateRange = encodeURIComponent(`'${PREORIGIN_RAW_SHEET}'!${dateColumn}2:${dateColumn}`);
  const dates = (await client.request({
    url: `${root}/values/${dateRange}?majorDimension=COLUMNS&valueRenderOption=UNFORMATTED_VALUE`
  })).data.values?.[0] || [];
  const compactDate = targetDate.replaceAll('-', ''), matchingRows = [];
  for (let index = 0; index < dates.length; index++) if (String(dates[index] ?? '') === compactDate)
    matchingRows.push(index + 2);
  if (!matchingRows.length) return [header];
  const first = Math.min(...matchingRows), last = Math.max(...matchingRows);
  if (last - first + 1 > MAX_ROWS) throw Error('PREORIGIN_EVALUATOR_RAW_TOO_LARGE');
  const rowsRange = encodeURIComponent(`'${PREORIGIN_RAW_SHEET}'!A${first}:${lastColumn}${last}`);
  const rowData = (await client.request({
    url: `${root}/values/${rowsRange}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`
  })).data;
  return [header, ...(rowData.values || [])];
}

export async function startPreoriginEvaluatorJob({ env = process.env, now = () => Date.now(),
  auth = new GoogleAuth({ scopes: SCOPES }), storeFactory = createPreoriginDailyStore,
  log = (value) => console.log(JSON.stringify(value)) } = {}) {
  const config = preoriginEvaluatorConfig(env), targetDate = localDate(now()), bounds = dayBounds(targetDate);
  const client = await auth.getClient(), scheduler = await schedulerResources(client, config);
  const schedulerFilter = `resource.type="cloud_scheduler_job" AND timestamp>="${bounds.start}" AND timestamp<"${bounds.end}" AND (`
    + PREORIGIN_SCHEDULER_CONFIG.schedules.map(({ id }) => `resource.labels.job_id="${id}"`).join(' OR ') + ')';
  const runFilter = `resource.type="cloud_run_job" AND resource.labels.job_name="${config.sourceJob}" `
    + `AND timestamp>="${bounds.start}" AND timestamp<"${bounds.end}" AND (`
    + ['preorigin_start', 'preorigin_sample', 'preorigin_complete', 'preorigin_skipped', 'preorigin_failed']
      .map((event) => `jsonPayload.event="${event}"`).join(' OR ') + ')';
  const [schedulerLogEntries, executions, runLogEntries, values] = await Promise.all([
    loggingEntries(client, { project: config.project, filter: schedulerFilter }), executionRows(client, config, bounds),
    loggingEntries(client, { project: config.project, filter: runFilter }),
    rawValues(client, config.spreadsheetId, targetDate)
  ]);
  const result = evaluatePreoriginCanary({ targetDate, evaluatedAt: new Date(now()).toISOString(),
    schedulerResources: scheduler, schedulerLogEntries, executions, runLogEntries, rawValues: values });
  const write = await storeFactory({ client, spreadsheetId: config.spreadsheetId }).append(result);
  log({ event: 'preorigin_evaluator_complete', targetDate, decision: result.decision,
    reasonCodes: JSON.parse(result.reason_codes), expectedRuns: result.expected_runs, actualRuns: result.actual_runs,
    actualSamples: result.actual_samples, targetTrips: result.target_trips_observed,
    inserted: write.inserted, duplicate: write.duplicate });
  return Object.freeze({ result, write });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await startPreoriginEvaluatorJob(); }
  catch (error) { console.error(JSON.stringify({ event: 'preorigin_evaluator_failed', code: safeCode(error) })); process.exitCode = 1; }
}

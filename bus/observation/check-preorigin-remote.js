import { GoogleAuth } from 'google-auth-library';
import { pathToFileURL } from 'node:url';
import { PREORIGIN_HEADERS, PREORIGIN_RAW_SHEET } from './preorigin-schema.js';
import { PREORIGIN_SCHEDULER_CONFIG, validatePreoriginSchedulerConfig } from './preorigin-scheduler.js';
import { summarizePreoriginExecutions, summarizePreoriginRows } from './preorigin-report.js';

const SCOPES = ['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/spreadsheets.readonly'];
const MAX_SHEET_BYTES = 32 * 1024 * 1024;
const localDate = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const safeCode = (error) => /^PREORIGIN_[A-Z_]+$/.test(error?.message || '') ? error.message : 'PREORIGIN_REMOTE_CHECK_FAILED';

const containers = (job) => job?.template?.template?.containers || job?.spec?.template?.spec?.template?.spec?.containers || [];
export function deployedPreoriginConfig(job) {
  const container = containers(job)[0], env = new Map((container?.env || []).map((value) => [value.name, value]));
  const literal = (name) => String(env.get(name)?.value ?? '');
  const secret = (name) => Boolean(env.get(name)?.valueSource?.secretKeyRef || env.get(name)?.valueFrom?.secretKeyRef);
  const spreadsheetId = literal('PALURU_BUS_OBSERVATION_SPREADSHEET_ID');
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(spreadsheetId) || literal('PREORIGIN_SAMPLE_COUNT') !== '10'
    || literal('PREORIGIN_INTERVAL_SEC') !== '32' || literal('PREORIGIN_MAX_RUN_SEC') !== '310'
    || literal('PREORIGIN_TIME_BANDS') !== '06:35-08:56' || !secret('ODPT_ACCESS_TOKEN')
    || !secret('OBSERVATION_HMAC_KEY')) throw Error('PREORIGIN_DEPLOYED_CONFIG_INVALID');
  return Object.freeze({ spreadsheetId, image: String(container.image || ''), configured: true });
}

async function allExecutions(client, config) {
  const base = `https://run.googleapis.com/v2/projects/${config.project}/locations/${config.region}/jobs/${config.job}/executions`;
  const result = []; let token = '';
  for (let page = 0; page < 5; page++) {
    const url = `${base}?pageSize=100${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`;
    const response = await client.request({ url }); result.push(...(response.data?.executions || []));
    token = response.data?.nextPageToken || ''; if (!token) break;
  }
  return result;
}

async function sheetValues(client, spreadsheetId) {
  const metadataUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties.title`;
  const metadata = await client.request({ url: metadataUrl });
  if (!(metadata.data?.sheets || []).some((sheet) => sheet.properties?.title === PREORIGIN_RAW_SHEET))
    return [PREORIGIN_HEADERS];
  const range = encodeURIComponent(`'${PREORIGIN_RAW_SHEET}'!A1:AJ`);
  const response = await client.request({ url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${range}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE` });
  if (Buffer.byteLength(JSON.stringify(response.data || {})) > MAX_SHEET_BYTES) throw Error('PREORIGIN_REMOTE_SHEET_TOO_LARGE');
  return response.data?.values || [];
}

export async function checkPreoriginRemote({ targetDate = process.env.PREORIGIN_CHECK_DATE || localDate(),
  auth = new GoogleAuth({ scopes: SCOPES }) } = {}) {
  const config = validatePreoriginSchedulerConfig(), client = await auth.getClient();
  const jobName = `projects/${config.project}/locations/${config.region}/jobs/${config.job}`;
  const job = (await client.request({ url: `https://run.googleapis.com/v2/${jobName}` })).data;
  const deployed = deployedPreoriginConfig(job), executions = await allExecutions(client, config);
  const values = await sheetValues(client, deployed.spreadsheetId);
  const result = Object.freeze({ status: values.length > 1 ? 'PREORIGIN_REMOTE_REPORT' : 'PREORIGIN_REMOTE_NO_DATA',
    targetDate, jobConfigured: deployed.configured, schedulerTimeZone: config.timeZone,
    executions: summarizePreoriginExecutions(executions, targetDate), rows: summarizePreoriginRows(values, targetDate),
    classification: 'postprocess_same_daily_hmac', publicUiChanged: false });
  const encoded = JSON.stringify(result);
  if (encoded.includes(deployed.spreadsheetId) || /position_lat|position_lon|veh_[a-f0-9]{32}/.test(encoded))
    throw Error('PREORIGIN_REMOTE_REPORT_EXPOSED_PRIVATE_DATA');
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await checkPreoriginRemote())); }
  catch (error) { console.log(JSON.stringify({ status: 'PREORIGIN_REMOTE_CHECK_FAILED', code: safeCode(error) })); process.exitCode = 1; }
}

import { GoogleAuth } from 'google-auth-library';
import { PREORIGIN_HEADERS, PREORIGIN_RAW_SHEET, preoriginObservationValues } from './preorigin-schema.js';
import { columnName } from './sheets.js';

const API = 'https://sheets.googleapis.com/v4/spreadsheets/';
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const range = (value) => encodeURIComponent(`'${PREORIGIN_RAW_SHEET}'!${value}`);
const fail = (code) => { throw Error(code); };

async function jsonResponse(response, code) {
  if (!response?.ok) fail(code);
  const length = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) fail('PREORIGIN_SHEETS_RESPONSE_TOO_LARGE');
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) fail('PREORIGIN_SHEETS_RESPONSE_TOO_LARGE');
  try { return text ? JSON.parse(text) : {}; } catch { fail('PREORIGIN_SHEETS_RESPONSE_INVALID'); }
}

export function createPreoriginAccessTokenProvider({ auth = new GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
}) } = {}) {
  let client = null;
  return async () => {
    client ??= await auth.getClient();
    const value = await client.getAccessToken(), token = typeof value === 'string' ? value : value?.token;
    if (typeof token !== 'string' || !token) fail('PREORIGIN_GOOGLE_AUTH_FAILED');
    return token;
  };
}

export function createPreoriginSheetsStore({ spreadsheetId, fetcher = fetch,
  tokenProvider = createPreoriginAccessTokenProvider(), timeoutMs = 20000 } = {}) {
  if (typeof spreadsheetId !== 'string' || !/^[A-Za-z0-9_-]{20,128}$/.test(spreadsheetId)
    || typeof fetcher !== 'function' || typeof tokenProvider !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1000)
    fail('PREORIGIN_SHEETS_CONFIG_INVALID');
  const spreadsheet = `${API}${encodeURIComponent(spreadsheetId)}`;
  const values = `${spreadsheet}/values/`;
  let known = null;
  async function request(url, options = {}, code = 'PREORIGIN_SHEETS_REQUEST_FAILED') {
    const token = await tokenProvider(), controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(url, { ...options, signal: controller.signal, headers: {
        Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {})
      } });
      return await jsonResponse(response, code);
    } catch (error) {
      if (/^PREORIGIN_[A-Z_]+$/.test(error?.message || '')) throw error;
      fail(code);
    } finally { clearTimeout(timer); }
  }
  async function writeHeader() {
    const last = columnName(PREORIGIN_HEADERS.length);
    await request(`${values}${range(`A1:${last}1`)}?valueInputOption=RAW`, {
      method: 'PUT', body: JSON.stringify({ majorDimension: 'ROWS', values: [PREORIGIN_HEADERS] })
    }, 'PREORIGIN_SHEETS_HEADER_WRITE_FAILED');
  }
  async function initialize() {
    if (known) return;
    const metadata = await request(`${spreadsheet}?fields=sheets.properties.title`, {}, 'PREORIGIN_SHEETS_METADATA_FAILED');
    const exists = (metadata.sheets || []).some((sheet) => sheet.properties?.title === PREORIGIN_RAW_SHEET);
    if (!exists) {
      await request(`${spreadsheet}:batchUpdate`, { method: 'POST', body: JSON.stringify({
        requests: [{ addSheet: { properties: { title: PREORIGIN_RAW_SHEET } } }]
      }) }, 'PREORIGIN_SHEETS_CREATE_FAILED');
      await writeHeader();
    } else {
      const header = await request(`${values}${range('1:1')}?majorDimension=ROWS`, {}, 'PREORIGIN_SHEETS_HEADER_READ_FAILED');
      const actual = header.values?.[0] || [];
      if (!actual.length) await writeHeader();
      else if (JSON.stringify(actual) !== JSON.stringify(PREORIGIN_HEADERS)) fail('PREORIGIN_SHEETS_SCHEMA_MISMATCH');
    }
    const ids = await request(`${values}${range('A2:A')}?majorDimension=COLUMNS`, {}, 'PREORIGIN_SHEETS_IDS_READ_FAILED');
    known = new Set((ids.values?.[0] || []).filter((value) => /^pre_[a-f0-9]{32}$/.test(value)));
  }
  async function append(rows) {
    if (!Array.isArray(rows)) fail('PREORIGIN_SHEETS_ROWS_INVALID');
    await initialize();
    const seen = new Set(), missing = [];
    for (const row of rows) if (!known.has(row.preorigin_observation_id) && !seen.has(row.preorigin_observation_id)) {
      missing.push(row); seen.add(row.preorigin_observation_id);
    }
    if (!missing.length) return { attempted: rows.length, inserted: 0, duplicates: rows.length };
    const last = columnName(PREORIGIN_HEADERS.length);
    const result = await request(`${values}${range(`A:${last}`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS&includeValuesInResponse=false`, {
      method: 'POST', body: JSON.stringify({ majorDimension: 'ROWS', values: missing.map(preoriginObservationValues) })
    }, 'PREORIGIN_SHEETS_APPEND_FAILED');
    if (result.updates?.updatedRows !== missing.length) fail('PREORIGIN_SHEETS_APPEND_UNCONFIRMED');
    for (const row of missing) known.add(row.preorigin_observation_id);
    return { attempted: rows.length, inserted: missing.length, duplicates: rows.length - missing.length };
  }
  return { initialize, append, knownCount: () => known?.size ?? null };
}

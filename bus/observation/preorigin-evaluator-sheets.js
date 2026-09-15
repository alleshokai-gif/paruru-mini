import { PREORIGIN_DAILY_HEADERS, PREORIGIN_DAILY_SHEET, preoriginDailyValues,
  validatePreoriginDaily } from './preorigin-evaluator-schema.js';

const API = 'https://sheets.googleapis.com/v4/spreadsheets/';
const MAX_BYTES = 8 * 1024 * 1024;
const fail = (code) => { throw Error(code); };
const columnName = (count) => {
  let value = count, result = '';
  while (value) { value--; result = String.fromCharCode(65 + value % 26) + result; value = Math.floor(value / 26); }
  return result;
};
const encodedRange = (value) => encodeURIComponent(`'${PREORIGIN_DAILY_SHEET}'!${value}`);

export function createPreoriginDailyStore({ client, spreadsheetId } = {}) {
  if (typeof client?.request !== 'function' || typeof spreadsheetId !== 'string'
    || !/^[A-Za-z0-9_-]{20,128}$/.test(spreadsheetId)) fail('PREORIGIN_EVALUATOR_SHEETS_CONFIG_INVALID');
  const root = `${API}${encodeURIComponent(spreadsheetId)}`, values = `${root}/values/`;
  let known = null;
  async function request(options, code) {
    try {
      const response = await client.request(options), encoded = JSON.stringify(response.data || {});
      if (Buffer.byteLength(encoded) > MAX_BYTES) fail('PREORIGIN_EVALUATOR_SHEETS_RESPONSE_TOO_LARGE');
      return response.data || {};
    } catch (error) {
      if (/^PREORIGIN_EVALUATOR_[A-Z_]+$/.test(error?.message || '')) throw error;
      fail(code);
    }
  }
  async function titles() {
    const data = await request({ url: `${root}?fields=sheets.properties.title` },
      'PREORIGIN_EVALUATOR_SHEETS_METADATA_FAILED');
    return (data.sheets || []).map((sheet) => sheet.properties?.title).filter(Boolean);
  }
  async function initialize() {
    if (known) return;
    if (!(await titles()).includes(PREORIGIN_DAILY_SHEET)) {
      await request({ url: `${root}:batchUpdate`, method: 'POST', data: {
        requests: [{ addSheet: { properties: { title: PREORIGIN_DAILY_SHEET } } }]
      } }, 'PREORIGIN_EVALUATOR_SHEET_CREATE_FAILED');
      await request({ url: `${values}${encodedRange(`A1:${columnName(PREORIGIN_DAILY_HEADERS.length)}1`)}?valueInputOption=RAW`,
        method: 'PUT', data: { majorDimension: 'ROWS', values: [PREORIGIN_DAILY_HEADERS] } },
      'PREORIGIN_EVALUATOR_HEADER_WRITE_FAILED');
    }
    const header = await request({ url: `${values}${encodedRange('1:1')}?majorDimension=ROWS` },
      'PREORIGIN_EVALUATOR_HEADER_READ_FAILED');
    if (JSON.stringify(header.values?.[0] || []) !== JSON.stringify(PREORIGIN_DAILY_HEADERS))
      fail('PREORIGIN_EVALUATOR_SCHEMA_MISMATCH');
    const ids = await request({ url: `${values}${encodedRange('A2:A')}?majorDimension=COLUMNS` },
      'PREORIGIN_EVALUATOR_IDS_READ_FAILED');
    known = new Set(ids.values?.[0] || []);
  }
  async function append(row) {
    validatePreoriginDaily(row); await initialize();
    if (known.has(row.evaluation_id)) return Object.freeze({ inserted: 0, duplicate: 1 });
    const last = columnName(PREORIGIN_DAILY_HEADERS.length);
    const data = await request({
      url: `${values}${encodedRange(`A:${last}`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS&includeValuesInResponse=false`,
      method: 'POST', data: { majorDimension: 'ROWS', values: [preoriginDailyValues(row)] }
    }, 'PREORIGIN_EVALUATOR_APPEND_FAILED');
    if (data.updates?.updatedRows !== 1) fail('PREORIGIN_EVALUATOR_APPEND_UNCONFIRMED');
    known.add(row.evaluation_id); return Object.freeze({ inserted: 1, duplicate: 0 });
  }
  return Object.freeze({ initialize, append, knownCount: () => known?.size ?? null });
}

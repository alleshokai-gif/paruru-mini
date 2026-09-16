import { POSITION_DAILY_HEADERS, POSITION_DAILY_SHEET, POSITION_EVALUATION_HEADERS,
  POSITION_EVALUATION_SHEET, positionDailyValues, positionObservationValues,
  validatePositionDaily, validatePositionObservation } from './position-evaluator-schema.js';

const API = 'https://sheets.googleapis.com/v4/spreadsheets/';
const MAX_BYTES = 8 * 1024 * 1024;
const fail = (code) => { throw Error(code); };
const columnName = (count) => {
  let value = count, result = '';
  while (value) { value--; result = String.fromCharCode(65 + value % 26) + result; value = Math.floor(value / 26); }
  return result;
};
const encodedRange = (sheet, value) => encodeURIComponent(`'${sheet}'!${value}`);
const normalizedRow = (row, width) => Array.from({ length: width }, (_, index) =>
  row?.[index] === null || row?.[index] === undefined ? '' : row[index]);

export function createPositionEvaluationStore({ client, spreadsheetId } = {}) {
  if (typeof client?.request !== 'function' || typeof spreadsheetId !== 'string'
    || !/^[A-Za-z0-9_-]{20,128}$/.test(spreadsheetId)) fail('POSITION_EVALUATOR_SHEETS_CONFIG_INVALID');
  const root = `${API}${encodeURIComponent(spreadsheetId)}`, values = `${root}/values/`;
  const state = new Map();
  async function request(options, code) {
    try {
      const response = await client.request(options), encoded = JSON.stringify(response.data || {});
      if (Buffer.byteLength(encoded) > MAX_BYTES) fail('POSITION_EVALUATOR_SHEETS_RESPONSE_TOO_LARGE');
      return response.data || {};
    } catch (error) {
      if (/^POSITION_EVALUATOR_[A-Z_]+$/.test(error?.message || '')) throw error;
      fail(code);
    }
  }
  async function titles() {
    const data = await request({ url: `${root}?fields=sheets.properties.title` },
      'POSITION_EVALUATOR_SHEETS_METADATA_FAILED');
    return (data.sheets || []).map((sheet) => sheet.properties?.title).filter(Boolean);
  }
  async function initializeSheet(sheet, headers) {
    if (state.has(sheet)) return;
    if (!(await titles()).includes(sheet)) {
      await request({ url: `${root}:batchUpdate`, method: 'POST', data: {
        requests: [{ addSheet: { properties: { title: sheet } } }]
      } }, 'POSITION_EVALUATOR_SHEET_CREATE_FAILED');
      await request({ url: `${values}${encodedRange(sheet, `A1:${columnName(headers.length)}1`)}?valueInputOption=RAW`,
        method: 'PUT', data: { majorDimension: 'ROWS', values: [headers] } },
      'POSITION_EVALUATOR_HEADER_WRITE_FAILED');
    }
    const last = columnName(headers.length), fingerprintIndex = headers.indexOf('source_fingerprint');
    if (fingerprintIndex < 1) fail('POSITION_EVALUATOR_SCHEMA_MISMATCH');
    const headerData = await request({
      url: `${values}${encodedRange(sheet, `A1:${last}1`)}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`
    }, 'POSITION_EVALUATOR_HEADER_READ_FAILED');
    if (JSON.stringify(normalizedRow(headerData.values?.[0] || [], headers.length)) !== JSON.stringify(headers))
      fail('POSITION_EVALUATOR_SCHEMA_MISMATCH');
    const fingerprintColumn = columnName(fingerprintIndex + 1);
    const [idData, fingerprintData] = await Promise.all([
      request({ url: `${values}${encodedRange(sheet, 'A2:A')}?majorDimension=COLUMNS&valueRenderOption=UNFORMATTED_VALUE` },
        'POSITION_EVALUATOR_IDS_READ_FAILED'),
      request({ url: `${values}${encodedRange(sheet, `${fingerprintColumn}2:${fingerprintColumn}`)}?majorDimension=COLUMNS&valueRenderOption=UNFORMATTED_VALUE` },
        'POSITION_EVALUATOR_FINGERPRINTS_READ_FAILED')
    ]);
    const ids = idData.values?.[0] || [], fingerprints = fingerprintData.values?.[0] || [];
    const known = new Map();
    for (let index = 0; index < ids.length; index++) {
      const id = String(ids[index] || ''), fingerprint = String(fingerprints[index] || '');
      if (!id || !/^[a-f0-9]{32}$/.test(fingerprint)) fail('POSITION_EVALUATOR_STORED_ROW_INVALID');
      if (known.has(id) && known.get(id) !== fingerprint) fail('POSITION_EVALUATOR_ID_CONFLICT');
      known.set(id, fingerprint);
    }
    state.set(sheet, known);
  }
  async function appendRows({ sheet, headers, rows, validate, valuesFor }) {
    await initializeSheet(sheet, headers);
    const known = state.get(sheet), pending = [], batch = new Map(); let duplicate = 0;
    const fingerprintIndex = headers.indexOf('source_fingerprint');
    for (const row of rows) {
      validate(row); const valuesRow = valuesFor(row), id = String(valuesRow[0]);
      const fingerprint = String(valuesRow[fingerprintIndex] || '');
      if (known.has(id)) {
        if (known.get(id) !== fingerprint) fail('POSITION_EVALUATOR_ID_CONFLICT');
        duplicate++; continue;
      }
      if (batch.has(id)) {
        if (batch.get(id) !== fingerprint) fail('POSITION_EVALUATOR_ID_CONFLICT');
        duplicate++; continue;
      }
      batch.set(id, fingerprint); pending.push(valuesRow);
    }
    if (!pending.length) return Object.freeze({ inserted: 0, duplicate });
    const last = columnName(headers.length);
    const data = await request({
      url: `${values}${encodedRange(sheet, `A:${last}`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS&includeValuesInResponse=false`,
      method: 'POST', data: { majorDimension: 'ROWS', values: pending }
    }, 'POSITION_EVALUATOR_APPEND_FAILED');
    if (data.updates?.updatedRows !== pending.length) fail('POSITION_EVALUATOR_APPEND_UNCONFIRMED');
    for (const [id, fingerprint] of batch) known.set(id, fingerprint);
    return Object.freeze({ inserted: pending.length, duplicate });
  }
  async function initialize() {
    await initializeSheet(POSITION_EVALUATION_SHEET, POSITION_EVALUATION_HEADERS);
    await initializeSheet(POSITION_DAILY_SHEET, POSITION_DAILY_HEADERS);
  }
  return Object.freeze({
    initialize,
    appendEvaluations: (rows) => appendRows({ sheet: POSITION_EVALUATION_SHEET,
      headers: POSITION_EVALUATION_HEADERS, rows, validate: validatePositionObservation,
      valuesFor: positionObservationValues }),
    appendDaily: (row) => appendRows({ sheet: POSITION_DAILY_SHEET, headers: POSITION_DAILY_HEADERS,
      rows: [row], validate: validatePositionDaily, valuesFor: positionDailyValues }),
    knownCounts: () => Object.freeze({
      evaluations: state.get(POSITION_EVALUATION_SHEET)?.size ?? null,
      daily: state.get(POSITION_DAILY_SHEET)?.size ?? null
    })
  });
}

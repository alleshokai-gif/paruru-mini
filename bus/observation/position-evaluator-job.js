import { GoogleAuth } from 'google-auth-library';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { OBSERVATION_HEADERS, RAW_SHEET } from './schema.js';
import { positionEvaluatorConfig } from './position-evaluator-config.js';
import { selectPositionGeometry, validatePositionGeometryBundle } from './position-evaluator-geometry.js';
import { derivePositionEvaluations } from './position-evaluator.js';
import { createPositionEvaluationStore } from './position-evaluator-sheets.js';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const MAX_ROWS = 250000;
const safeCode = (error) => /^POSITION_EVALUATOR_[A-Z_]+$/.test(error?.message || '')
  || /^POSITION_GEOMETRY_[A-Z_]+$/.test(error?.message || '') ? error.message : 'POSITION_EVALUATOR_FAILED';
const localDate = (now) => new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 10);
const columnName = (count) => {
  let value = count, result = '';
  while (value) { value--; result = String.fromCharCode(65 + value % 26) + result; value = Math.floor(value / 26); }
  return result;
};
const readJson = (url) => JSON.parse(readFileSync(url, 'utf8'));

export async function readPositionObservationRaw({ client, spreadsheetId, targetDate }) {
  const root = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`;
  const metadata = (await client.request({ url: `${root}?fields=sheets.properties.title` })).data;
  if (!(metadata.sheets || []).some((sheet) => sheet.properties?.title === RAW_SHEET)) return [];
  const lastColumn = columnName(OBSERVATION_HEADERS.length);
  const headerRange = encodeURIComponent(`'${RAW_SHEET}'!A1:${lastColumn}1`);
  const headerData = (await client.request({
    url: `${root}/values/${headerRange}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`
  })).data;
  const header = headerData.values?.[0] || [];
  if (JSON.stringify(header.map(String)) !== JSON.stringify(OBSERVATION_HEADERS)) return [header];
  const dateColumn = columnName(OBSERVATION_HEADERS.indexOf('service_date') + 1);
  const dateRange = encodeURIComponent(`'${RAW_SHEET}'!${dateColumn}2:${dateColumn}`);
  const dates = (await client.request({
    url: `${root}/values/${dateRange}?majorDimension=COLUMNS&valueRenderOption=UNFORMATTED_VALUE`
  })).data.values?.[0] || [];
  const compactDate = targetDate.replaceAll('-', ''), matchingRows = [];
  for (let index = 0; index < dates.length; index++) if (String(dates[index] ?? '') === compactDate)
    matchingRows.push(index + 2);
  if (!matchingRows.length) return [header];
  const first = Math.min(...matchingRows), last = Math.max(...matchingRows);
  if (last - first + 1 > MAX_ROWS) throw Error('POSITION_EVALUATOR_RAW_TOO_LARGE');
  const rowsRange = encodeURIComponent(`'${RAW_SHEET}'!A${first}:${lastColumn}${last}`);
  const rowData = (await client.request({
    url: `${root}/values/${rowsRange}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`
  })).data;
  return [header, ...(rowData.values || [])];
}

export async function startPositionEvaluatorJob({ env = process.env, now = () => Date.now(),
  auth = new GoogleAuth({ scopes: SCOPES }), storeFactory = createPositionEvaluationStore,
  loadPositionStatic = () => readJson(new URL('../generated/p1-position-static.json', import.meta.url)),
  loadGeometryBundle = () => readJson(new URL('./position-shadow-geometry.json', import.meta.url)),
  log = (value) => console.log(JSON.stringify(value)) } = {}) {
  const config = positionEvaluatorConfig(env), targetDate = localDate(now()), client = await auth.getClient();
  const [rawValues, positionStatic, geometryBundle] = await Promise.all([
    readPositionObservationRaw({ client, spreadsheetId: config.spreadsheetId, targetDate }),
    Promise.resolve(loadPositionStatic()), Promise.resolve(loadGeometryBundle())
  ]);
  validatePositionGeometryBundle(geometryBundle, positionStatic);
  const store = storeFactory({ client, spreadsheetId: config.spreadsheetId });
  await store.initialize();
  const summaries = [];
  for (const target of config.targets) {
    const geometryArtifact = selectPositionGeometry({ bundle: geometryBundle, positionStatic, target });
    const result = derivePositionEvaluations({ rawValues, serviceDate: targetDate,
      evaluatedAt: new Date(now()).toISOString(), positionStatic, geometryArtifact, target });
    const evaluationWrite = await store.appendEvaluations(result.evaluations);
    const dailyWrite = await store.appendDaily(result.daily);
    const summary = Object.freeze({ provider: target.provider, directionId: target.directionId,
      routeId: target.routeId, stage: result.daily.stage, decision: result.daily.decision,
      reasonCodes: JSON.parse(result.daily.reason_codes), rawRows: result.daily.raw_rows,
      derivedRows: result.daily.derived_rows, evaluationInserted: evaluationWrite.inserted,
      evaluationDuplicate: evaluationWrite.duplicate, dailyInserted: dailyWrite.inserted,
      dailyDuplicate: dailyWrite.duplicate });
    summaries.push(summary);
    log({ event: 'position_evaluator_target_complete', targetDate, ...summary });
  }
  log({ event: 'position_evaluator_complete', targetDate, targets: summaries.length,
    insertedEvaluations: summaries.reduce((sum, row) => sum + row.evaluationInserted, 0),
    insertedDaily: summaries.reduce((sum, row) => sum + row.dailyInserted, 0) });
  return Object.freeze({ targetDate, summaries: Object.freeze(summaries) });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await startPositionEvaluatorJob(); }
  catch (error) {
    console.error(JSON.stringify({ event: 'position_evaluator_failed', code: safeCode(error) }));
    process.exitCode = 1;
  }
}

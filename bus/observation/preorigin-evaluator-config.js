import { PREORIGIN_SCHEDULER_CONFIG } from './preorigin-scheduler.js';

export const PREORIGIN_EVALUATOR_FORBIDDEN_ENV = Object.freeze([
  'ODPT_ACCESS_TOKEN',
  'OBSERVATION_HMAC_KEY'
]);

export function preoriginEvaluatorConfig(env = process.env) {
  const spreadsheetId = env.PALURU_BUS_OBSERVATION_SPREADSHEET_ID;
  if (typeof spreadsheetId !== 'string' || !/^[A-Za-z0-9_-]{20,128}$/.test(spreadsheetId))
    throw Error('PREORIGIN_EVALUATOR_CONFIG_INVALID');
  if (PREORIGIN_EVALUATOR_FORBIDDEN_ENV.some((name) => Object.prototype.hasOwnProperty.call(env, name)))
    throw Error('PREORIGIN_EVALUATOR_SECRET_BOUNDARY_INVALID');
  return Object.freeze({
    spreadsheetId,
    project: PREORIGIN_SCHEDULER_CONFIG.project,
    region: PREORIGIN_SCHEDULER_CONFIG.region,
    sourceJob: PREORIGIN_SCHEDULER_CONFIG.job
  });
}

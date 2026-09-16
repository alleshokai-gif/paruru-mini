import { POSITION_SHADOW_TARGETS, validatePositionShadowTargets } from './position-evaluator-targets.js';

export const POSITION_EVALUATOR_FORBIDDEN_ENV = Object.freeze([
  'ODPT_ACCESS_TOKEN',
  'OBSERVATION_HMAC_KEY'
]);

export function positionEvaluatorConfig(env = process.env) {
  const spreadsheetId = env.PALURU_BUS_OBSERVATION_SPREADSHEET_ID;
  if (typeof spreadsheetId !== 'string' || !/^[A-Za-z0-9_-]{20,128}$/.test(spreadsheetId))
    throw Error('POSITION_EVALUATOR_CONFIG_INVALID');
  if (POSITION_EVALUATOR_FORBIDDEN_ENV.some((name) => Object.prototype.hasOwnProperty.call(env, name)))
    throw Error('POSITION_EVALUATOR_SECRET_BOUNDARY_INVALID');
  return Object.freeze({ spreadsheetId, targets: validatePositionShadowTargets(POSITION_SHADOW_TARGETS) });
}

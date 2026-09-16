import { POSITION_EVALUATOR_FORBIDDEN_ENV } from './position-evaluator-config.js';

const PROJECT = 'paluru-bus';
const REGION = 'asia-northeast1';
const EVALUATOR_JOB = 'paluru-bus-position-evaluator';
const RUNTIME_SA = `paluru-bus-position-evaluator@${PROJECT}.iam.gserviceaccount.com`;
const SCHEDULER_SA = `paluru-bus-scheduler@${PROJECT}.iam.gserviceaccount.com`;
const TARGET_URI = `https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/jobs/${EVALUATOR_JOB}:run`;

export const POSITION_EVALUATOR_SCHEDULE = Object.freeze({
  id: 'paluru-bus-position-evaluator-1945',
  cron: '45 19 * * 1-5',
  timeZone: 'Asia/Tokyo',
  latestSourceStartJst: '19:30',
  sourceMaxRunSec: 330,
  safetyMarginSec: 570
});

export const POSITION_EVALUATOR_INFRA = Object.freeze({
  project: PROJECT,
  region: REGION,
  evaluatorJob: EVALUATOR_JOB,
  runtimeServiceAccount: RUNTIME_SA,
  schedulerServiceAccount: SCHEDULER_SA,
  imageRepository: `${REGION}-docker.pkg.dev/${PROJECT}/paluru-bus/paluru-bus-position-evaluator`,
  runtime: Object.freeze({
    taskCount: 1,
    parallelism: 1,
    maxRetries: 0,
    timeoutSec: 300,
    envNames: Object.freeze(['NODE_ENV', 'PALURU_BUS_OBSERVATION_SPREADSHEET_ID']),
    forbiddenEnvNames: POSITION_EVALUATOR_FORBIDDEN_ENV
  }),
  scheduler: Object.freeze({
    id: POSITION_EVALUATOR_SCHEDULE.id,
    cron: POSITION_EVALUATOR_SCHEDULE.cron,
    timeZone: POSITION_EVALUATOR_SCHEDULE.timeZone,
    targetUri: TARGET_URI,
    method: 'POST',
    retryCount: 0,
    attemptDeadlineSec: 60
  }),
  iam: Object.freeze({
    evaluatorInvokerRole: 'roles/run.invoker',
    spreadsheetAccess: 'target_file_editor',
    runtimeProjectRoles: Object.freeze([]),
    secretManagerRoles: Object.freeze([])
  })
});

const same = (actual, expected) => JSON.stringify([...(actual || [])].sort()) === JSON.stringify([...expected].sort());

export function validatePositionEvaluatorInfrastructure(snapshot) {
  const expected = POSITION_EVALUATOR_INFRA;
  const job = snapshot?.job || {}, scheduler = snapshot?.scheduler || {}, iam = snapshot?.iam || {};
  if (job.name !== expected.evaluatorJob || job.serviceAccount !== expected.runtimeServiceAccount
    || !String(job.image || '').startsWith(`${expected.imageRepository}@sha256:`)
    || !/@sha256:[a-f0-9]{64}$/.test(String(job.image || ''))
    || job.taskCount !== expected.runtime.taskCount || job.parallelism !== expected.runtime.parallelism
    || job.maxRetries !== expected.runtime.maxRetries || job.timeoutSec !== expected.runtime.timeoutSec
    || !same(job.envNames, expected.runtime.envNames) || (job.secretEnvNames || []).length
    || expected.runtime.forbiddenEnvNames.some((name) => (job.envNames || []).includes(name)))
    throw Error('POSITION_EVALUATOR_JOB_CONFIG_INVALID');
  if (scheduler.name !== expected.scheduler.id || scheduler.schedule !== expected.scheduler.cron
    || scheduler.timeZone !== expected.scheduler.timeZone || scheduler.state !== 'ENABLED'
    || scheduler.method !== expected.scheduler.method || scheduler.uri !== expected.scheduler.targetUri
    || scheduler.oauthServiceAccount !== expected.schedulerServiceAccount
    || scheduler.retryCount !== expected.scheduler.retryCount
    || scheduler.attemptDeadlineSec !== expected.scheduler.attemptDeadlineSec)
    throw Error('POSITION_EVALUATOR_SCHEDULER_CONFIG_INVALID');
  if (iam.runtimeServiceAccount !== expected.runtimeServiceAccount
    || iam.evaluatorJob !== expected.evaluatorJob || iam.invokerServiceAccount !== expected.schedulerServiceAccount
    || iam.invokerRole !== expected.iam.evaluatorInvokerRole
    || iam.spreadsheetAccess !== expected.iam.spreadsheetAccess
    || !same(iam.runtimeProjectRoles, expected.iam.runtimeProjectRoles)
    || !same(iam.secretManagerRoles, expected.iam.secretManagerRoles))
    throw Error('POSITION_EVALUATOR_IAM_INVALID');
  return snapshot;
}

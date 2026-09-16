import { PREORIGIN_EVALUATOR_FORBIDDEN_ENV } from './preorigin-evaluator-config.js';
import { PREORIGIN_EVALUATOR_SCHEDULE } from './preorigin-evaluator-schema.js';
import { PREORIGIN_SCHEDULER_CONFIG } from './preorigin-scheduler.js';

const PROJECT = PREORIGIN_SCHEDULER_CONFIG.project;
const REGION = PREORIGIN_SCHEDULER_CONFIG.region;
const EVALUATOR_JOB = 'paluru-bus-preorigin-evaluator';
const RUNTIME_SA = `paluru-bus-preorigin-evaluator@${PROJECT}.iam.gserviceaccount.com`;
const SCHEDULER_SA = PREORIGIN_SCHEDULER_CONFIG.schedulerServiceAccount;
const EVIDENCE_ROLE = `projects/${PROJECT}/roles/paluruBusPreoriginEvaluatorEvidenceReader`;
const TARGET_URI = `https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/jobs/${EVALUATOR_JOB}:run`;

export const PREORIGIN_EVALUATOR_INFRA = Object.freeze({
  project: PROJECT,
  region: REGION,
  sourceJob: PREORIGIN_SCHEDULER_CONFIG.job,
  evaluatorJob: EVALUATOR_JOB,
  runtimeServiceAccount: RUNTIME_SA,
  schedulerServiceAccount: SCHEDULER_SA,
  imageRepository: `${REGION}-docker.pkg.dev/${PROJECT}/paluru-bus/paluru-bus-preorigin-evaluator`,
  runtime: Object.freeze({
    taskCount: 1,
    parallelism: 1,
    maxRetries: 0,
    timeoutSec: 300,
    envNames: Object.freeze(['NODE_ENV', 'PALURU_BUS_OBSERVATION_SPREADSHEET_ID']),
    forbiddenEnvNames: PREORIGIN_EVALUATOR_FORBIDDEN_ENV
  }),
  scheduler: Object.freeze({
    id: PREORIGIN_EVALUATOR_SCHEDULE.id,
    cron: PREORIGIN_EVALUATOR_SCHEDULE.cron,
    timeZone: PREORIGIN_EVALUATOR_SCHEDULE.timeZone,
    targetUri: TARGET_URI,
    method: 'POST',
    retryCount: 0,
    attemptDeadlineSec: 60
  }),
  iam: Object.freeze({
    sourceJobRole: 'roles/run.viewer',
    evaluatorInvokerRole: 'roles/run.invoker',
    evidenceReaderRole: EVIDENCE_ROLE,
    evidenceReaderPermissions: Object.freeze([
      'cloudscheduler.jobs.get',
      'logging.logEntries.list'
    ]),
    spreadsheetAccess: 'target_file_editor'
  })
});

const same = (actual, expected) => JSON.stringify([...(actual || [])].sort()) === JSON.stringify([...expected].sort());

export function validatePreoriginEvaluatorInfrastructure(snapshot) {
  const expected = PREORIGIN_EVALUATOR_INFRA;
  const job = snapshot?.job || {}, scheduler = snapshot?.scheduler || {}, iam = snapshot?.iam || {};
  if (job.name !== expected.evaluatorJob || job.serviceAccount !== expected.runtimeServiceAccount
    || !String(job.image || '').startsWith(`${expected.imageRepository}@sha256:`)
    || !/@sha256:[a-f0-9]{64}$/.test(String(job.image || ''))
    || job.taskCount !== expected.runtime.taskCount || job.parallelism !== expected.runtime.parallelism
    || job.maxRetries !== expected.runtime.maxRetries || job.timeoutSec !== expected.runtime.timeoutSec
    || !same(job.envNames, expected.runtime.envNames) || (job.secretEnvNames || []).length
    || expected.runtime.forbiddenEnvNames.some((name) => (job.envNames || []).includes(name)))
    throw Error('PREORIGIN_EVALUATOR_JOB_CONFIG_INVALID');
  if (scheduler.name !== expected.scheduler.id || scheduler.schedule !== expected.scheduler.cron
    || scheduler.timeZone !== expected.scheduler.timeZone || scheduler.state !== 'ENABLED'
    || scheduler.method !== expected.scheduler.method || scheduler.uri !== expected.scheduler.targetUri
    || scheduler.oauthServiceAccount !== expected.schedulerServiceAccount
    || scheduler.retryCount !== expected.scheduler.retryCount)
    throw Error('PREORIGIN_EVALUATOR_SCHEDULER_CONFIG_INVALID');
  if (iam.runtimeServiceAccount !== expected.runtimeServiceAccount
    || iam.sourceJob !== expected.sourceJob || iam.sourceJobRole !== expected.iam.sourceJobRole
    || iam.evaluatorJob !== expected.evaluatorJob || iam.invokerServiceAccount !== expected.schedulerServiceAccount
    || iam.invokerRole !== expected.iam.evaluatorInvokerRole
    || iam.evidenceReaderRole !== expected.iam.evidenceReaderRole
    || !same(iam.evidenceReaderPermissions, expected.iam.evidenceReaderPermissions)
    || !same(iam.secretManagerRoles, []))
    throw Error('PREORIGIN_EVALUATOR_IAM_INVALID');
  return snapshot;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PREORIGIN_EVALUATOR_INFRA, validatePreoriginEvaluatorInfrastructure }
  from '../observation/preorigin-evaluator-infra.js';

const infraSnapshot = () => ({
  job: {
    name: PREORIGIN_EVALUATOR_INFRA.evaluatorJob,
    serviceAccount: PREORIGIN_EVALUATOR_INFRA.runtimeServiceAccount,
    image: `${PREORIGIN_EVALUATOR_INFRA.imageRepository}@sha256:${'a'.repeat(64)}`,
    taskCount: 1, parallelism: 1, maxRetries: 1, timeoutSec: 600,
    envNames: ['PALURU_BUS_OBSERVATION_SPREADSHEET_ID', 'NODE_ENV'], secretEnvNames: []
  },
  scheduler: {
    name: PREORIGIN_EVALUATOR_INFRA.scheduler.id,
    schedule: PREORIGIN_EVALUATOR_INFRA.scheduler.cron,
    timeZone: 'Asia/Tokyo', state: 'ENABLED', method: 'POST',
    uri: PREORIGIN_EVALUATOR_INFRA.scheduler.targetUri,
    oauthServiceAccount: PREORIGIN_EVALUATOR_INFRA.schedulerServiceAccount, retryCount: 0
  },
  iam: {
    runtimeServiceAccount: PREORIGIN_EVALUATOR_INFRA.runtimeServiceAccount,
    sourceJob: PREORIGIN_EVALUATOR_INFRA.sourceJob, sourceJobRole: 'roles/run.viewer',
    evaluatorJob: PREORIGIN_EVALUATOR_INFRA.evaluatorJob,
    invokerServiceAccount: PREORIGIN_EVALUATOR_INFRA.schedulerServiceAccount,
    invokerRole: 'roles/run.invoker', evidenceReaderRole: PREORIGIN_EVALUATOR_INFRA.iam.evidenceReaderRole,
    evidenceReaderPermissions: ['logging.logEntries.list', 'cloudscheduler.jobs.get'], secretManagerRoles: []
  }
});

test('Evaluator infrastructure pins one digest, one task, dedicated identities and 09:10 JST', () => {
  const snapshot = infraSnapshot();
  assert.equal(validatePreoriginEvaluatorInfrastructure(snapshot), snapshot);
  assert.equal(PREORIGIN_EVALUATOR_INFRA.scheduler.cron, '10 9 * * 1-5');
  assert.equal(PREORIGIN_EVALUATOR_INFRA.scheduler.attemptDeadlineSec, 180);
  assert.equal(PREORIGIN_EVALUATOR_INFRA.iam.spreadsheetAccess, 'target_file_editor');
});

test('Evaluator infrastructure rejects mutable images, secret bindings and broad evidence roles', () => {
  const mutable = infraSnapshot(); mutable.job.image = `${PREORIGIN_EVALUATOR_INFRA.imageRepository}:latest`;
  assert.throws(() => validatePreoriginEvaluatorInfrastructure(mutable), /JOB_CONFIG_INVALID/);
  const secret = infraSnapshot(); secret.job.secretEnvNames = ['ODPT_ACCESS_TOKEN'];
  assert.throws(() => validatePreoriginEvaluatorInfrastructure(secret), /JOB_CONFIG_INVALID/);
  const broad = infraSnapshot(); broad.iam.evidenceReaderPermissions.push('secretmanager.versions.access');
  assert.throws(() => validatePreoriginEvaluatorInfrastructure(broad), /IAM_INVALID/);
  const role = readFileSync(new URL('../observation/preorigin-evaluator-evidence-reader-role.yaml', import.meta.url), 'utf8');
  assert.match(role, /cloudscheduler\.jobs\.get/);
  assert.match(role, /logging\.logEntries\.list/);
  assert.doesNotMatch(role, /secretmanager|run\.jobs\.run|spreadsheets/i);
});

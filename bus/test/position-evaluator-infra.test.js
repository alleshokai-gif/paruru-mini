import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BUS_POSITION_UI_ENABLED } from '../config/policy.js';
import { POSITION_EVALUATOR_INFRA, POSITION_EVALUATOR_SCHEDULE,
  validatePositionEvaluatorInfrastructure } from '../observation/position-evaluator-infra.js';

const digest = `sha256:${'a'.repeat(64)}`;
function snapshot() {
  const infra = POSITION_EVALUATOR_INFRA;
  return {
    job: {
      name: infra.evaluatorJob,
      serviceAccount: infra.runtimeServiceAccount,
      image: `${infra.imageRepository}@${digest}`,
      taskCount: 1,
      parallelism: 1,
      maxRetries: 0,
      timeoutSec: 300,
      envNames: ['NODE_ENV', 'PALURU_BUS_OBSERVATION_SPREADSHEET_ID'],
      secretEnvNames: []
    },
    scheduler: {
      name: infra.scheduler.id,
      schedule: infra.scheduler.cron,
      timeZone: infra.scheduler.timeZone,
      state: 'ENABLED',
      method: 'POST',
      uri: infra.scheduler.targetUri,
      oauthServiceAccount: infra.schedulerServiceAccount,
      retryCount: 0,
      attemptDeadlineSec: 60
    },
    iam: {
      runtimeServiceAccount: infra.runtimeServiceAccount,
      evaluatorJob: infra.evaluatorJob,
      invokerServiceAccount: infra.schedulerServiceAccount,
      invokerRole: 'roles/run.invoker',
      spreadsheetAccess: 'target_file_editor',
      runtimeProjectRoles: [],
      secretManagerRoles: []
    }
  };
}

test('Position evaluator infrastructure is digest-pinned, isolated, and scheduled after observer completion', () => {
  assert.equal(POSITION_EVALUATOR_SCHEDULE.cron, '45 19 * * 1-5');
  assert.equal(POSITION_EVALUATOR_SCHEDULE.timeZone, 'Asia/Tokyo');
  assert.equal(POSITION_EVALUATOR_SCHEDULE.safetyMarginSec, 15 * 60 - 330);
  assert.equal(validatePositionEvaluatorInfrastructure(snapshot()).job.maxRetries, 0);
  assert.equal(BUS_POSITION_UI_ENABLED, false);
});

test('Position evaluator infrastructure rejects mutable images, secrets, broad roles, and scheduler drift', () => {
  const mutable = snapshot(); mutable.job.image = `${POSITION_EVALUATOR_INFRA.imageRepository}:latest`;
  assert.throws(() => validatePositionEvaluatorInfrastructure(mutable), /JOB_CONFIG_INVALID/);
  const secret = snapshot(); secret.job.secretEnvNames = ['ODPT_ACCESS_TOKEN'];
  assert.throws(() => validatePositionEvaluatorInfrastructure(secret), /JOB_CONFIG_INVALID/);
  const broad = snapshot(); broad.iam.runtimeProjectRoles = ['roles/viewer'];
  assert.throws(() => validatePositionEvaluatorInfrastructure(broad), /IAM_INVALID/);
  const secretRole = snapshot(); secretRole.iam.secretManagerRoles = ['roles/secretmanager.secretAccessor'];
  assert.throws(() => validatePositionEvaluatorInfrastructure(secretRole), /IAM_INVALID/);
  const drift = snapshot(); drift.scheduler.schedule = '40 19 * * 1-5';
  assert.throws(() => validatePositionEvaluatorInfrastructure(drift), /SCHEDULER_CONFIG_INVALID/);
});

test('Position evaluator image and Cloud Build remain separate from collection and deployment', () => {
  const docker = readFileSync(new URL('../observation/Dockerfile.position-evaluator', import.meta.url), 'utf8');
  const build = readFileSync(new URL('../observation/cloudbuild.position-evaluator.yaml', import.meta.url), 'utf8');
  assert.match(docker, /position-evaluator-job\.js/);
  assert.match(docker, /p1-position-static\.json/);
  assert.doesNotMatch(docker, /observation\/job\.js|preorigin-job\.js|providers\/kawasaki|generated\/p0-static/);
  assert.doesNotMatch(build, /gcloud\s+(?:run|scheduler|projects|iam)|run\s+jobs\s+deploy|scheduler\s+jobs/);
});

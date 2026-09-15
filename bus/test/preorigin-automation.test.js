import test from 'node:test';
import assert from 'node:assert/strict';
import { PREORIGIN_SCHEDULER_CONFIG, preoriginScheduledStartMinutes,
  validatePreoriginSchedulerConfig } from '../observation/preorigin-scheduler.js';

test('two automatic schedules cover weekday 06:35 through 08:55 and the runner guards the 08:56 boundary', () => {
  assert.equal(validatePreoriginSchedulerConfig(), PREORIGIN_SCHEDULER_CONFIG);
  const starts = preoriginScheduledStartMinutes();
  assert.equal(starts.length, 29); assert.equal(starts[0], 395); assert.equal(starts.at(-1), 535);
  assert.ok(starts.every((value, index) => index === 0 || value - starts[index - 1] === 5));
  assert.deepEqual(PREORIGIN_SCHEDULER_CONFIG.schedules.map(({ id, cron }) => [id, cron]), [
    ['paluru-bus-preorigin-0635', '35-55/5 6 * * 1-5'],
    ['paluru-bus-preorigin-0700', '*/5 7,8 * * 1-5']
  ]);
  assert.equal(PREORIGIN_SCHEDULER_CONFIG.schedulerServiceAccount,
    'paluru-bus-scheduler@paluru-bus.iam.gserviceaccount.com');
  assert.ok(starts.at(-1) < 8 * 60 + 56);
  assert.ok(starts.at(-1) * 60 + (PREORIGIN_SCHEDULER_CONFIG.sampleCount - 1)
    * PREORIGIN_SCHEDULER_CONFIG.intervalSec >= (8 * 60 + 56) * 60);
  assert.equal(PREORIGIN_SCHEDULER_CONFIG.timeZone, 'Asia/Tokyo');
  assert.equal(PREORIGIN_SCHEDULER_CONFIG.maxRetryAttempts, 0);
  assert.equal(PREORIGIN_SCHEDULER_CONFIG.attemptDeadlineSec, 60);
});

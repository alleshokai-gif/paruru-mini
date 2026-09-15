export const PREORIGIN_SCHEDULER_CONFIG = Object.freeze({
  project: 'paluru-bus',
  region: 'asia-northeast1',
  job: 'paluru-bus-preorigin-observer',
  timeZone: 'Asia/Tokyo',
  schedulerServiceAccount: 'paluru-bus-scheduler@paluru-bus.iam.gserviceaccount.com',
  targetUri: 'https://run.googleapis.com/v2/projects/paluru-bus/locations/asia-northeast1/jobs/paluru-bus-preorigin-observer:run',
  schedules: Object.freeze([
    Object.freeze({ id: 'paluru-bus-preorigin-0635', cron: '35-55/5 6 * * 1-5' }),
    Object.freeze({ id: 'paluru-bus-preorigin-0700', cron: '*/5 7,8 * * 1-5' })
  ]),
  sampleCount: 10,
  intervalSec: 32,
  maxRunSec: 310,
  timeBand: '06:35-08:56',
  maxRetryAttempts: 0,
  attemptDeadlineSec: 60
});

export function preoriginScheduledStartMinutes() {
  const result = [];
  for (let minute = 35; minute <= 55; minute += 5) result.push(6 * 60 + minute);
  for (const hour of [7, 8]) for (let minute = 0; minute <= 55; minute += 5) result.push(hour * 60 + minute);
  return Object.freeze(result);
}

export function validatePreoriginSchedulerConfig(config = PREORIGIN_SCHEDULER_CONFIG) {
  const starts = preoriginScheduledStartMinutes();
  const lastSampleOffset = (config.sampleCount - 1) * config.intervalSec;
  const timeBandEndMinute = 8 * 60 + 56;
  const expectedSchedules = [
    ['paluru-bus-preorigin-0635', '35-55/5 6 * * 1-5'],
    ['paluru-bus-preorigin-0700', '*/5 7,8 * * 1-5']
  ];
  if (config.project !== 'paluru-bus' || config.region !== 'asia-northeast1'
    || config.job !== 'paluru-bus-preorigin-observer' || config.timeZone !== 'Asia/Tokyo'
    || config.schedulerServiceAccount !== 'paluru-bus-scheduler@paluru-bus.iam.gserviceaccount.com'
    || config.targetUri !== 'https://run.googleapis.com/v2/projects/paluru-bus/locations/asia-northeast1/jobs/paluru-bus-preorigin-observer:run'
    || config.timeBand !== '06:35-08:56' || config.sampleCount !== 10 || config.intervalSec !== 32
    || config.maxRunSec !== 310 || config.maxRetryAttempts !== 0 || config.attemptDeadlineSec !== 60
    || config.schedules?.length !== 2
    || config.schedules.some((value, index) => value.id !== expectedSchedules[index][0]
      || value.cron !== expectedSchedules[index][1])
    || starts.length !== 29 || starts[0] !== 6 * 60 + 35 || starts.at(-1) !== 8 * 60 + 55
    || starts.some((value) => value >= timeBandEndMinute) || lastSampleOffset >= config.maxRunSec)
    throw Error('PREORIGIN_SCHEDULER_CONFIG_INVALID');
  return config;
}

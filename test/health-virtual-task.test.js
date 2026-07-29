'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { resolveNextHealthTask } = require('../features/nurse-okan/health-routine.js');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const start = appSource.indexOf('let healthTaskCache = null;');
const end = appSource.indexOf('setParuruState("loading");', start);
assert(start >= 0 && end > start, 'health task source boundary missing');

let requests = [];
const context = {
  Date,
  Intl,
  window: { PALURUHealthRoutine: { resolveNextHealthTask } },
  TOKYO_TIME_ZONE: 'Asia/Tokyo',
  appAuthenticationState: 'active_member',
  normalPwaInitialized: true,
  activeMembershipContext: null,
  callAuthenticatedHealth_: async (_action, payload) => {
    requests.push(payload);
    return { slots: {} };
  },
  debugLog() {},
};
vm.createContext(context);
vm.runInContext(appSource.slice(start, end), context);

async function nextFor(role, slots) {
  requests = [];
  context.activeMembershipContext = { memberUserId: 'member-1', role };
  context.callAuthenticatedHealth_ = async (_action, payload) => {
    requests.push(payload);
    return { slots };
  };
  return context.fetchNextHealthTask_();
}

(async () => {
  assert.strictEqual(await nextFor('admin', {}), null, 'admin TOP produced a health task');
  assert.strictEqual(requests.length, 0, 'admin TOP called health.daily.get');

  assert.strictEqual(await nextFor('guardian', {}), null, 'guardian TOP produced a health task');
  assert.strictEqual(requests.length, 0, 'guardian TOP called health.daily.get');

  const pending = await nextFor('self_record', {});
  assert(pending && pending.slot === 'morning', 'self_record pending slot did not produce one task');
  assert.strictEqual(requests.length, 1, 'self_record pending slot did not call health.daily.get once');
  assert.strictEqual(requests[0].targetMemberUserId, 'member-1', 'health task used a different target member');

  const complete = {
    morning: { morningStaple:'normal',morningWater:true,morningMedication:true,morningCondition:true },
    lunch: { lunchAmount:'all',lunchWater:true,lunchCondition:true },
    post_training: { postTrainingProteinSource:'protein',postTrainingOnigiriCount:1,postTrainingWater:true,postTrainingCondition:true },
    dinner: { dinnerRiceBowls:1,dinnerMedication:true,bedtime:true },
    condition: { recordedAt: '2026-07-29T22:00:00+09:00' },
  };
  assert.strictEqual(await nextFor('self_record', complete), null, 'complete self_record day produced a task');

  const handler = appSource.slice(appSource.indexOf('todayParuruList.addEventListener'), appSource.indexOf('todayParuruAllButton.addEventListener'));
  assert(handler.indexOf('item.dataset.healthAction === "daily"') < handler.indexOf('openNotificationDetail'), 'virtual health click can reach Inbox detail/update flow');
  console.log('PASS health virtual task role gate and virtual click routing');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

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
  assert.strictEqual(pending.targetUserId, 'member-1', 'health task did not retain its target member');
  assert.strictEqual(requests.length, 1, 'self_record pending slot did not call health.daily.get once');
  assert.strictEqual(requests[0].targetMemberUserId, 'member-1', 'health task used a different target member');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(context.resolveHealthTaskNavigation_('morning'))), {
    action: 'daily', slot: 'morning', targetUserId: 'member-1',
  }, 'TOP health task does not preserve its server-resolved slot and target');
  assert.strictEqual(context.resolveHealthTaskNavigation_('lunch'), null, 'client slot spoof escaped the cached health task');
  vm.runInContext("healthTaskCache={action:'daily',slot:'lunch',targetUserId:'member-1'}", context);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(context.resolveHealthTaskNavigation_('lunch'))), {
    action: 'daily', slot: 'lunch', targetUserId: 'member-1',
  }, 'TOP lunch reminder does not open the matching lunch slot');
  assert.strictEqual(context.resolveHealthTaskNavigation_('morning'), null, 'TOP lunch reminder was redirected to a different slot');

  const complete = {
    morning: { recordedAt: '2026-07-29T08:00:00+09:00', morningStaple:'normal',morningWater:true,morningMedication:true,morningCondition:true },
    lunch: { recordedAt: '2026-07-29T12:00:00+09:00', lunchAmount:'all',lunchWater:true,lunchCondition:true },
    post_training: { recordedAt: '2026-07-29T17:00:00+09:00', postTrainingProteinSource:'protein',postTrainingOnigiriCount:1,postTrainingWater:true,postTrainingCondition:true },
    dinner: { recordedAt: '2026-07-29T20:00:00+09:00', dinnerRiceBowls:1,dinnerMedication:true,bedtime:true },
    condition: { recordedAt: '2026-07-29T22:00:00+09:00' },
  };
  assert.strictEqual(await nextFor('self_record', complete), null, 'complete self_record day produced a task');

  const handler = appSource.slice(appSource.indexOf('todayParuruList.addEventListener'), appSource.indexOf('todayParuruAllButton.addEventListener'));
  assert(handler.indexOf('item.dataset.healthAction === "daily"') < handler.indexOf('openNotificationDetail'), 'virtual health click can reach Inbox detail/update flow');
  assert(handler.includes('resolveHealthTaskNavigation_(item.dataset.healthSlot)'), 'virtual health task does not resolve through the cached server task');
  assert(!handler.includes('item.dataset.healthTargetUserId'), 'DOM target value is trusted by virtual health navigation');
  assert(!appSource.includes('data-health-target-user-id='), 'server-resolved target leaked into mutable DOM routing metadata');
  console.log('PASS health virtual task role gate and virtual click routing');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

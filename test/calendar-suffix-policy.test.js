'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const codeSource = fs.readFileSync(path.join(__dirname, '..', 'gas', 'Code.js'), 'utf8');
const policySource = fs.readFileSync(path.join(__dirname, '..', 'gas', 'HomeMemberPolicy.js'), 'utf8');
const homeAgentSource = fs.readFileSync(path.join(__dirname, '..', 'gas', 'HomeAgentCore.js'), 'utf8');
const writes = [];
let savedItem = null;
let calendarTarget = null;
let calendarEvent = null;
let currentItem = null;
const calendarCapabilities = [];

const context = {
  Array, Boolean, Date, Error, JSON, Math, Number, Object, RegExp, String,
  Utilities: { getUuid: () => 'item-id', formatDate: () => '2026-07-27T00:00:00+09:00' },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  SpreadsheetApp: { flush() {} },
};

vm.createContext(context);
vm.runInContext(policySource, context);
vm.runInContext(codeSource, context);
vm.runInContext(homeAgentSource, context);
Object.assign(context, {
  json_: (value) => value,
  debugLog_: () => {},
  nowTokyoString_: () => '2026-07-27T00:00:00+09:00',
  resolveMemoActor_: (body) => ({
    homeId: 'home-a',
    memberUserId: body && body.deviceId === 'unknown-device' ? 'unknown_member' : 'father',
    displayName: '父',
    role: 'admin',
    deviceId: String((body && body.deviceId) || 'father-device'),
  }),
  authorizeCapability_: (_actor, capability) => { calendarCapabilities.push(capability); return true; },
  assertMemoIdentityFieldsAbsent_: () => {},
  validateAnalyzedItem_: (item) => item,
  normalizeTagsForSheet_: (value) => value,
  normalizeBooleanForSheet_: (value) => Boolean(value),
  getFollowupInputTypeForItem_: () => '',
  normalizeVisibility_: (value) => value || 'private',
  normalizePriority_: (value) => value || '',
  normalizeNumberForSheet_: (value) => value || '',
  analyzeMemoWithAI_: () => ({ title: 'AI予定（り）', category: 'event', priority: 'Normal', tags: [], needsFollowup: false }),
  enforceFollowupRules_: (value) => value,
  appendNewItem_: (item) => { savedItem = Object.assign({ id: 'item-id' }, item); return savedItem; },
  getInitialCalendarSyncStatus_: (item) => String(item.type || '').toLowerCase() === 'event' ? 'pending' : 'not_required',
  getInboxSheet_: () => ({}),
  getHeaderIndex_: () => ({ calendarSuffix: 0 }),
  findRowNumberById_: () => 2,
  getOwnedMemoItem_: (_id, actor) => currentItem && currentItem.ownerUserId === actor.memberUserId ? ({ item: currentItem, sheet: {}, rowNumber: 2, index: { calendarSuffix: 0 } }) : null,
  normalizeValueForSheet_: (_field, value) => value,
  setSheetValueForField_: (_sheet, _row, _column, field, value) => { currentItem[field] = value; writes.push({ field, value }); },
  updateRowFields_: (_sheet, _row, _index, updates) => { Object.assign(currentItem, updates); },
  hasCalendarRelevantChanges_: () => true,
  sanitizeItemForClient_: (item) => item,
  assertRequiredHeaders_: () => {},
  getCalendarConfig_: () => ({ calendarId: 'calendar-id' }),
  getCalendarByConfig_: () => ({
    getName: () => 'Family',
    createAllDayEvent: (title) => { calendarTarget = title; return { getId: () => 'event-id' }; },
    getEventById: () => calendarEvent,
  }),
  buildCalendarDescription_: () => '',
  parseDateOnly_: () => new Date('2026-07-27T00:00:00+09:00'),
  addDays_: (date) => date,
  parseTokyoDateTime_: () => new Date('2026-07-27T09:00:00+09:00'),
  addMinutesToTime_: () => '10:00',
  normalizeCalendarTarget_: (value) => value || 'family',
  normalizeCalendarSyncStatus_: (value) => value || '',
  buildCalendarResponseItem_: (item) => item,
  sanitizeCalendarError_: (error) => error.message,
});

assert.strictEqual(context.getCalendarSuffixForMember_('father'), '（父）');
assert.strictEqual(context.getCalendarSuffixForMember_('mother'), '（母）');
assert.strictEqual(context.getCalendarSuffixForMember_('eldest_son'), '（理）');
assert.strictEqual(context.getCalendarSuffixForMember_('eldest_daughter'), '（は）');
assert.strictEqual(context.getCalendarSuffixForMember_('second_son'), '（ふ）');
assert.strictEqual(context.getCalendarSuffixForMember_('youngest_daughter'), '（り）');
assert.throws(() => context.getCalendarSuffixForMember_('unknown_member'), (error) => error.code === 'UNKNOWN_CALENDAR_MEMBER');
assert.strictEqual(context.buildCalendarTitle_('会議（父）（母）（理）（は）（ふ）（り）', '（父）'), '会議（父）');
assert.strictEqual(context.buildCalendarTitle_('会議（母）', '（父）'), '会議（父）');

context.createItem_({ deviceId: 'father-device', memo: '予定', title: '新規（母）', calendarSuffix: '（母）', calendarTitle: '偽タイトル（り）', type: 'event' });
assert.strictEqual(savedItem.calendarSuffix, '（父）');
assert.strictEqual(savedItem.calendarTitle, '新規（父）');

context.createItemWithAIResult_({ calendarSuffix: '（母）', calendarTitle: '偽タイトル（り）' }, 'AIメモ', {
  identity: { memberUserId: 'father', displayName: '父', deviceId: 'father-device' },
});
assert.strictEqual(savedItem.calendarSuffix, '（父）');
assert.strictEqual(savedItem.calendarTitle, 'AI予定（父）');

currentItem = { id: 'item-id', ownerUserId: 'father', userId: 'father', title: '更新（母）', memo: '更新', type: 'event', calendarSuffix: '（母）', calendarEventId: 'event-id', calendarSyncStatus: 'synced' };
writes.length = 0;
context.updateItem_({ deviceId: 'father-device', id: 'item-id', calendarSuffix: '（り）' });
assert.strictEqual(currentItem.calendarSuffix, '（父）');
assert.deepStrictEqual(writes, [{ field: 'calendarSuffix', value: '（父）' }]);

currentItem = { id: 'item-id', ownerUserId: 'father', userId: 'father', title: '同期（母）（り）', memo: '同期', type: 'event', calendarSuffix: '（母）', calendarEventId: '', calendarSyncStatus: 'pending' };
calendarTarget = null;
context.syncCalendar_({ deviceId: 'father-device', id: 'item-id', calendarSuffix: '（り）', calendarTitle: '偽タイトル（母）', startDate: '2026-07-27', allDay: true });
assert.strictEqual(calendarTarget, '同期（父）');
assert.strictEqual(currentItem.calendarSuffix, '（父）');
assert.deepStrictEqual(calendarCapabilities.splice(0), ['calendar.family.create']);

calendarEvent = { setTitle: (title) => { calendarTarget = title; }, setDescription() {}, setAllDayDates() {} };
currentItem = { id: 'item-id', ownerUserId: 'father', userId: 'father', title: '更新予定（理）（は）', memo: '更新', type: 'event', calendarSuffix: '（母）', calendarEventId: 'event-id', calendarSyncStatus: 'update_required' };
calendarTarget = null;
context.updateCalendar_({ deviceId: 'father-device', id: 'item-id', calendarSuffix: '（り）', calendarTitle: '偽タイトル（母）', startDate: '2026-07-27', allDay: true });
assert.strictEqual(calendarTarget, '更新予定（父）');
assert.strictEqual(currentItem.calendarSuffix, '（父）');
assert.deepStrictEqual(calendarCapabilities.splice(0), ['calendar.family.edit_own']);

currentItem = { id: 'other-item', ownerUserId: 'second_son', userId: 'second_son', title: '他人予定', memo: '更新', type: 'event', calendarEventId: '', calendarSyncStatus: 'pending' };
calendarTarget = null;
const otherOwnerResult = context.syncCalendar_({ deviceId: 'father-device', id: 'other-item', startDate: '2026-07-27', allDay: true });
assert.strictEqual(otherOwnerResult.success, false);
assert.strictEqual(calendarTarget, null);

assert.throws(() => context.createItem_({ deviceId: 'unknown-device', memo: '予定' }), (error) => error.code === 'UNKNOWN_CALENDAR_MEMBER');
const personalEvents = context.filterHomeAgentPersonalEvents_({
  message: '私の予定',
  calendarSuffix: '（母）',
  _authenticatedActor: { memberUserId: 'father' },
}, [{ title: '父予定（父）' }, { title: '母予定（母）' }]);
assert.deepStrictEqual(JSON.parse(JSON.stringify(personalEvents)), [{ title: '父予定（父）' }]);
assert.throws(() => context.filterHomeAgentPersonalEvents_({ message: '私の予定', _authenticatedActor: { memberUserId: 'unknown_member' } }, []), (error) => error.code === 'UNKNOWN_CALENDAR_MEMBER');

console.log('PASS calendar suffix policy, spoof rejection, write normalization, and Home Agent actor filtering');

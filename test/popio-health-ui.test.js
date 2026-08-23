'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const featurePath = path.join(root, 'features', 'popio-health', 'popio-health.js');
const featureSource = fs.readFileSync(featurePath, 'utf8');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const cssSource = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const membershipSource = fs.readFileSync(path.join(root, 'gas', 'HomeMembershipService.js'), 'utf8');
const swSource = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const api = require(featurePath);

function plain(value) { return JSON.parse(JSON.stringify(value)); }
function uuid(n) { return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`; }

// PH-U01 - PH-U06: every manual form emits only the Pet event contract.
assert.deepStrictEqual(plain(api.buildEventPayload_('meal', {
  mealSlot: 'breakfast', amountG: '20', completion: 'finished', note: ' 朝ごはん ',
})), { eventType: 'meal', mealSlot: 'breakfast', completion: 'finished', amountG: 20, note: '朝ごはん' }, 'PH-U01 meal payload');
assert.deepStrictEqual(plain(api.buildEventPayload_('stool', {
  stoolForm: 'banana', stoolAmount: 'normal', coprophagy: true,
})), { eventType: 'stool', stoolForm: 'banana', stoolAmount: 'normal', coprophagy: true }, 'PH-U02 stool payload');
assert.deepStrictEqual(plain(api.buildEventPayload_('stool', {})), { eventType: 'stool' }, 'stool-only record must remain valid');
assert.deepStrictEqual(plain(api.buildEventPayload_('water', { amountMl: '150' })), { eventType: 'water', amountMl: 150 }, 'PH-U03 water payload');
assert.deepStrictEqual(plain(api.buildEventPayload_('urine', { urineStatus: 'concern' })), { eventType: 'urine', urineStatus: 'concern' }, 'PH-U04 urine payload');
assert.deepStrictEqual(plain(api.buildEventPayload_('urine', {})), { eventType: 'urine' }, 'urine-only record must remain valid');
assert.deepStrictEqual(plain(api.buildEventPayload_('weight', { weightKg: '2.300' })), { eventType: 'weight', weightKg: 2.3 }, 'PH-U05 weight payload');
assert.deepStrictEqual(plain(api.buildEventPayload_('observation', {
  energy: 'low', appetite: 'normal', flags: ['pain_behavior', 'vomiting'], note: '様子を見る',
})), { eventType: 'observation', energy: 'low', appetite: 'normal', flags: ['vomiting', 'pain_behavior'], note: '様子を見る' }, 'PH-U06 observation payload');
assert.throws(() => api.buildEventPayload_('observation', {}), (error) => error.code === 'INVALID_INPUT');
assert.throws(() => api.buildEventPayload_('meal', { mealSlot: 'breakfast', completion: 'refused', amountG: '20' }), (error) => error.code === 'INVALID_INPUT');

// PH-U07 - PH-U08: identity, authorization, source and server fields never enter the feature request.
const recordRequest = api.buildRecordRequest_(uuid(1), api.buildEventPayload_('meal', {
  mealSlot: 'breakfast', completion: 'finished', amountG: '20', homeId: 'spoof', source: 'agent',
}));
assert.deepStrictEqual(Object.keys(recordRequest), ['petId', 'clientRequestId', 'event']);
['homeId','actorUserId','recordedBy','role','capabilities','source','serviceToken','deviceId','pairingToken'].forEach((key) => {
  assert(!Object.hasOwn(recordRequest, key), `PH-U07/U08 prohibited request field: ${key}`);
  assert(!Object.hasOwn(recordRequest.event, key), `PH-U07/U08 prohibited event field: ${key}`);
});
assert(!Object.hasOwn(recordRequest.event, 'occurredAt'), 'manual UI must use server_default occurredAt');

// PH-CU01 - PH-CU08: correction/void requests are explicit operations, retain
// the normal idempotency lifecycle, and never expose server-owned fields.
const correctionRequest = api.buildCorrectionRequest_(uuid(2), uuid(1), { eventType: 'meal', mealSlot: 'breakfast', completion: 'finished', amountG: 18 });
assert.deepStrictEqual(plain(correctionRequest), { petId: 'popio', clientRequestId: uuid(2), correctionOfEventId: uuid(1), event: { eventType: 'meal', mealSlot: 'breakfast', completion: 'finished', amountG: 18 } }, 'PH-CU04 correction payload');
const voidRequest = api.buildVoidRequest_(uuid(3), uuid(1));
assert.deepStrictEqual(plain(voidRequest), { petId: 'popio', clientRequestId: uuid(3), correctionOfEventId: uuid(1) }, 'PH-CU05 void payload has no business event');
['homeId','actorUserId','recordedBy','role','capabilities','source','serviceToken','deviceId','pairingToken'].forEach((key) => {
  assert(!Object.hasOwn(correctionRequest, key), `PH-CU04 prohibited correction field: ${key}`);
  assert(!Object.hasOwn(voidRequest, key), `PH-CU05 prohibited void field: ${key}`);
});
assert(featureSource.includes('data-popio-correction-event-id') && featureSource.includes('data-popio-void') && featureSource.includes('data-popio-correction-cancel'), 'PH-CU01/05 correction controls are missing');
assert(featureSource.includes('enterCorrectionMode_') && featureSource.includes('setCorrectionOccurredAt_'), 'PH-CU02/03 correction prefill or timestamp edit is missing');
assert(featureSource.includes("window.confirm('この記録を取り消しますか？')"), 'PH-CU05 void confirmation is missing');
assert(featureSource.includes("action: 'pet.health.correct'") && featureSource.includes("action: 'pet.health.void'"), 'PH-CU04/07 correction operations are not selected by the form');
assert(featureSource.includes("loadDashboard_({ quiet: true })"), 'PH-CU06/07 correction success does not refresh Dashboard once');
assert(featureSource.includes('交換後のボトル量'), 'PH-CU09 water bottle label was not corrected');
assert(featureSource.includes('defaultNewFillMl'), 'PH-CU10 previous fill default was removed');

// PH-TUI01 - PH-TUI06: timestamps are opt-in, Tokyo based, and never permit a future manual hour.
const timestampNow = new Date('2026-08-21T08:37:00+09:00');
function reminderSummary(breakfast, dinner) {
  return { meal: { bySlot: { breakfast: { eventCount: breakfast }, dinner: { eventCount: dinner } } } };
}
assert.deepStrictEqual(plain(api.buildEventPayload_('stool', {}, timestampNow)), { eventType: 'stool' }, 'PH-TUI01 default must omit occurredAt');
assert.strictEqual(api.buildOccurredAt_({ occurredAtMode: 'explicit', occurredAtDate: 'today', occurredAtHour: '2' }, timestampNow), '2026-08-21T02:00:00+09:00', 'PH-TUI02 today timestamp');
assert.strictEqual(api.buildOccurredAt_({ occurredAtMode: 'explicit', occurredAtDate: 'yesterday', occurredAtHour: '23' }, timestampNow), '2026-08-20T23:00:00+09:00', 'PH-TUI03 yesterday timestamp');
assert.strictEqual(api.buildOccurredAt_({ occurredAtMode: 'explicit', occurredAtDate: 'custom', occurredAtCustomDate: '2026-08-19', occurredAtHour: '7' }, timestampNow), '2026-08-19T07:00:00+09:00', 'PH-TUI04 custom past date');
assert.throws(() => api.buildOccurredAt_({ occurredAtMode: 'explicit', occurredAtDate: 'today', occurredAtHour: '10' }, timestampNow), (error) => error.code === 'INVALID_INPUT' && error.message === '未来の時刻は記録できません', 'PH-TUI05 future hour must fail locally');
assert.strictEqual(api.buildOccurredAt_({ occurredAtMode: 'explicit', occurredAtDate: 'today', occurredAtHour: '8' }, timestampNow), '2026-08-21T08:00:00+09:00', 'PH-TUI06 current hour must pass');
assert.strictEqual(api.timestampLabel_({ occurredAtMode: 'explicit', occurredAtDate: 'yesterday', occurredAtHour: '23' }, timestampNow), '昨日 23時', 'timestamp label uses Tokyo-relative day');

// PH-WU01 - PH-WU08: water-bottle UI uses server summary context and sends only one water_bottle event.
const emptyBottleModel = api.waterBottleUiModel_({ waterBottle: { eventCount: 0, latest: null, latestInterval: null } }, 'loaded');
assert.deepStrictEqual(plain(emptyBottleModel), {
  ready: true, canReload: false, hasPrevious: false, message: 'まだ交換記録なし。最初の水量を記録します。', defaultNewFillMl: '', latestInterval: null,
}, 'PH-WU01 first-set UI model');
const previousBottleModel = api.waterBottleUiModel_({
  waterBottle: {
    eventCount: 1,
    latest: { eventId: 'bottle-1', occurredAt: '2026-08-20T08:00:00+09:00', newFillMl: 400 },
    latestInterval: null,
  },
}, 'loaded');
assert.strictEqual(previousBottleModel.previousFillMl, 400, 'PH-WU02 previous fill');
assert.strictEqual(previousBottleModel.defaultNewFillMl, '400', 'PH-WU03 default new fill');
assert.deepStrictEqual(plain(api.buildEventPayload_('water_bottle', { newFillMl: '400', remainingMl: '130' }, timestampNow)), {
  eventType: 'water_bottle', newFillMl: 400, remainingMl: 130,
}, 'PH-WU04 bottle payload');
const bottlePreview = api.waterBottlePreview_(previousBottleModel ? { occurredAt: previousBottleModel.previousOccurredAt, newFillMl: previousBottleModel.previousFillMl } : null, {
  occurredAtMode: 'explicit', occurredAtDate: 'today', occurredAtHour: '2', remainingMl: '130',
}, timestampNow);
assert.deepStrictEqual(plain(bottlePreview), { bottleDecreaseMl: 270, elapsedHours: 18, normalized24hMl: 360, shortInterval: false }, 'PH-WU05/06 bottle preview');
assert.strictEqual(api.waterBottlePreview_({ occurredAt: '2026-08-20T08:00:00+09:00', newFillMl: 400 }, {
  occurredAtMode: 'explicit', occurredAtDate: 'today', occurredAtHour: '2', remainingMl: '401',
}, timestampNow).error, '今の残りは前回セット量以下で入力してください', 'PH-WU07 invalid remaining');
assert.strictEqual(api.buildEventPayload_('water_bottle', {
  occurredAtMode: 'explicit', occurredAtDate: 'today', occurredAtHour: '2', newFillMl: '400', remainingMl: '130',
}, timestampNow).occurredAt, '2026-08-21T02:00:00+09:00', 'PH-WU08 timestamp integration');
assert.strictEqual(api.formatOccurredAt_('2026-08-20T08:00:00+09:00', timestampNow), '昨日 8時', 'water bottle previous timestamp label');
const failedBottleModel = api.waterBottleUiModel_(null, 'failed');
assert.strictEqual(failedBottleModel.ready, false, 'PH-SF05 failed summary must keep bottle form disabled');
assert.strictEqual(failedBottleModel.canReload, true, 'PH-SF05 failed summary must expose Read-only reload');

// PH-M01 - PH-M08: only scheduled breakfast/dinner records can become missing.
assert.deepStrictEqual(plain(api.recordingReminderModel_(reminderSummary(0, 0), 'loaded', new Date('2026-08-21T09:00:00+09:00')).items), [], 'PH-M01 breakfast reminder before 10:00');
assert.deepStrictEqual(plain(api.recordingReminderModel_(reminderSummary(0, 0), 'loaded', new Date('2026-08-21T10:00:00+09:00')).items.map((item) => item.slot)), ['breakfast'], 'PH-M02 breakfast reminder at 10:00');
assert.deepStrictEqual(plain(api.recordingReminderModel_(reminderSummary(1, 0), 'loaded', new Date('2026-08-21T10:00:00+09:00')).items), [], 'PH-M03 recorded breakfast');
const refusedBreakfastSummary = reminderSummary(1, 0);
refusedBreakfastSummary.meal.completionCounts = { finished: 0, partial: 0, refused: 1 };
assert.deepStrictEqual(plain(api.recordingReminderModel_(refusedBreakfastSummary, 'loaded', new Date('2026-08-21T12:00:00+09:00')).items), [], 'PH-M04 refused breakfast is still represented by an eventCount');
assert.deepStrictEqual(plain(api.recordingReminderModel_(reminderSummary(1, 0), 'loaded', new Date('2026-08-21T21:00:00+09:00')).items), [], 'PH-M05 dinner reminder before 22:00');
assert.deepStrictEqual(plain(api.recordingReminderModel_(reminderSummary(1, 0), 'loaded', new Date('2026-08-21T22:00:00+09:00')).items.map((item) => item.slot)), ['dinner'], 'PH-M06 dinner reminder at 22:00');
assert.deepStrictEqual(plain(api.recordingReminderModel_(reminderSummary(1, 1), 'loaded', new Date('2026-08-21T22:00:00+09:00')).items), [], 'PH-M07 recorded dinner');
assert.strictEqual(api.recordingReminderModel_(null, 'failed', new Date('2026-08-21T22:00:00+09:00')).known, false, 'PH-M08 failed summary must not assert missing');

const historyEvents = [
  { eventId: 'meal', eventType: 'meal', occurredAt: '2026-08-21T08:00:00+09:00', localDate: '2026-08-21', recordedAt: '2026-08-21T08:01:00+09:00', mealSlot: 'breakfast', amountG: 20, completion: 'finished' },
  { eventId: 'stool', eventType: 'stool', occurredAt: '2026-08-21T12:00:00+09:00', localDate: '2026-08-21', recordedAt: '2026-08-21T12:01:00+09:00', stoolForm: 'banana', stoolAmount: 'normal' },
  { eventId: 'bottle', eventType: 'water_bottle', occurredAt: '2026-08-20T18:00:00+09:00', localDate: '2026-08-20', recordedAt: '2026-08-20T18:01:00+09:00', remainingMl: 130, newFillMl: 400, bottleDecreaseMl: 270, elapsedHours: 18, normalized24hMl: 360 },
  { eventId: 'water', eventType: 'water', occurredAt: '2026-08-19T07:00:00+09:00', localDate: '2026-08-19', recordedAt: '2026-08-19T07:01:00+09:00', amountMl: 150 },
  { eventId: 'urine', eventType: 'urine', occurredAt: '2026-08-18T06:00:00+09:00', localDate: '2026-08-18', recordedAt: '2026-08-18T06:01:00+09:00', urineStatus: 'concern' },
  { eventId: 'weight', eventType: 'weight', occurredAt: '2026-08-17T09:00:00+09:00', localDate: '2026-08-17', recordedAt: '2026-08-17T09:01:00+09:00', weightKg: 2.3 },
  { eventId: 'observation', eventType: 'observation', occurredAt: '2026-08-15T10:00:00+09:00', localDate: '2026-08-15', recordedAt: '2026-08-15T10:01:00+09:00', flags: ['vomiting'], note: '様子見' },
];
const historyModel = api.historyViewModel_(historyEvents, 'loaded', new Date('2026-08-21T13:00:00+09:00'));
assert.strictEqual(historyModel.groups.reduce((count, group) => count + group.items.length, 0), 7, 'PH-H01 seven-day events');
assert.deepStrictEqual(plain(historyModel.groups.map((group) => group.localDate)), ['2026-08-21','2026-08-20','2026-08-19','2026-08-18','2026-08-17','2026-08-15'], 'PH-H02 date groups');
assert.deepStrictEqual(plain(historyModel.groups[0].items.map((item) => item.eventId)), ['stool','meal'], 'PH-H03 occurredAt DESC');
assert.deepStrictEqual(historyEvents.map(api.recentEventLabel_), ['🍚 朝 20g 完食','💩 バナナ / 普通','💧 270mL減 / 18h','💧 水 150mL','🚽 おしっこ / 気になる','⚖️ 2.3kg','👀 体調 / 嘔吐 📝'], 'PH-H04 event labels');
assert.strictEqual(api.historyViewModel_([], 'loaded', timestampNow).state, 'empty', 'PH-H05 empty state');
assert.strictEqual(api.historyViewModel_([], 'failed', timestampNow).state, 'failed', 'PH-H06 failure state');
assert.strictEqual(api.historyViewModel_(historyEvents, 'loaded', timestampNow).state, 'loaded', 'PH-H07 summary failure must not affect history model');
assert.strictEqual(api.summaryDisplayModel_({ meal: { eventCount: 1, totalAmountG: 20 }, water: { eventCount: 0 }, stool: { count: 0 }, latestWeight: null }, 'loaded').meal, '20g', 'PH-H08 recent failure must not affect summary model');

// PH-WK01 - PH-WK06: Water KPI represents the most recently confirmed bottle interval, not a calendar-day total.
const waterBottleIntervalSummary = { water: { eventCount: 1, totalAmountMl: 300 }, waterBottle: { latest: { newFillMl: 400 }, latestInterval: { bottleDecreaseMl: 270, elapsedHours: 18, normalized24hMl: 234 } } };
const waterBottleIntervalModel = api.summaryDisplayModel_(waterBottleIntervalSummary, 'loaded');
assert.strictEqual(waterBottleIntervalModel.water, '234mL', 'PH-WK01 latest bottle interval must render normalized water without duplicating its period');
assert.strictEqual(waterBottleIntervalModel.waterHint, '直近区間を24h換算', 'PH-WK01 bottle interval hint missing');
assert.strictEqual(api.summaryDisplayModel_({ waterBottle: { latest: { newFillMl: 400 }, latestInterval: { bottleDecreaseMl: 0, elapsedHours: 18, normalized24hMl: 0 } } }, 'loaded').water, '0mL', 'PH-WK02 zero bottle interval is a valid value');
const firstBottleSetModel = api.summaryDisplayModel_({ waterBottle: { latest: { newFillMl: 400 }, latestInterval: null } }, 'loaded');
assert.strictEqual(firstBottleSetModel.water, '計測中', 'PH-WK03 first bottle set must not pretend to be a measured amount');
assert.strictEqual(firstBottleSetModel.waterHint, '次回交換で算出', 'PH-WK03 first bottle set hint missing');
assert.strictEqual(api.summaryDisplayModel_({ water: { eventCount: 2, totalAmountMl: 300 }, waterBottle: { latest: null, latestInterval: null } }, 'loaded').water, '300mL', 'PH-WK04 legacy water remains available without bottle data');
assert.strictEqual(api.summaryDisplayModel_({ water: { eventCount: 0, totalAmountMl: null }, waterBottle: { latest: null, latestInterval: null } }, 'loaded').water, '--', 'PH-WK05 missing water data must not appear as zero');
assert.strictEqual(api.summaryDisplayModel_({ water: { eventCount: 2, totalAmountMl: 300 }, waterBottle: { latest: { newFillMl: 400 }, latestInterval: { bottleDecreaseMl: 270, elapsedHours: 3, normalized24hMl: 2160 } } }, 'loaded').water, '2160mL', 'PH-WK06 bottle interval must take priority over legacy water');
assert.strictEqual(api.summaryDisplayModel_({ waterBottle: { latest: { newFillMl: 400 }, latestInterval: { bottleDecreaseMl: 270, elapsedHours: 3, normalized24hMl: 2160 } } }, 'loaded').waterHint, '短時間データのため参考', 'PH-WK06 short interval hint missing');
assert(featureSource.includes('id="popioSummaryWaterHint"') && featureSource.includes("setText_('popioSummaryWaterHint', model.waterHint)"), 'PH-WK01 water KPI hint render boundary missing');
assert(cssSource.includes('.popio-summary-water strong') && cssSource.includes('.popio-summary-water small') && cssSource.includes('overflow-wrap: anywhere;'), 'PH-WK01 water KPI mobile text contract missing');

// PH-COLL01 - PH-COLL08: collapsing is PWA-only presentation state.
let collapsed = api.collapsibleSectionState_({ historyExpanded: false, observationExpanded: false }, 'history');
assert.deepStrictEqual(plain(collapsed), { historyExpanded: true, observationExpanded: false }, 'PH-COLL01/02 history starts collapsed then opens');
collapsed = api.collapsibleSectionState_(collapsed, 'history');
assert.deepStrictEqual(plain(collapsed), { historyExpanded: false, observationExpanded: false }, 'PH-COLL03 history closes');
collapsed = api.collapsibleSectionState_(collapsed, 'observation');
assert.deepStrictEqual(plain(collapsed), { historyExpanded: false, observationExpanded: true }, 'PH-COLL04/05 observation starts collapsed then opens');
collapsed = api.collapsibleSectionState_(collapsed, 'observation');
assert.deepStrictEqual(plain(collapsed), { historyExpanded: false, observationExpanded: false }, 'PH-COLL06 observation closes');
assert.deepStrictEqual(plain(api.collapsibleSectionState_(collapsed, 'unknown')), collapsed, 'unknown section cannot change collapse state');
assert(featureSource.includes('data-popio-section-toggle="history"') && featureSource.includes('data-popio-section-toggle="observation"') && featureSource.includes('aria-expanded="false"'), 'PH-COLL08 collapsible headers must expose aria-expanded');
const collapseSlice = featureSource.slice(featureSource.indexOf('function toggleCollapsibleSection_'), featureSource.indexOf('function handleTimestampClick_'));
assert(collapseSlice.includes('content.hidden = !section.expanded') && !collapseSlice.includes('loadDashboard_') && !collapseSlice.includes('call_('), 'PH-COLL07 collapse state must not call the Dashboard API');

const trendFixture = {
  rangeDays: 30, fromLocalDate: '2026-07-23', toLocalDate: '2026-08-21',
  weight: { items: [{ localDate: '2026-08-20', occurredAt: '2026-08-20T08:00:00+09:00', weightKg: 2.3 }], latestWeightKg: 2.3, changeFromFirstKg: 0 },
  meal: { daily: [
    { localDate: '2026-08-15', knownAmountG: 70, amountStatus: 'complete' },
    { localDate: '2026-08-16', knownAmountG: 60, amountStatus: 'partial' },
    { localDate: '2026-08-17', knownAmountG: 0, amountStatus: 'no_events' },
  ] },
  stool: { daily: [{ localDate: '2026-08-20', count: 3, forms: { pellet: 0, formed: 1, banana: 2, soft: 0, watery: 0 } }] },
};
const trendSeven = api.observationTrendModel_(trendFixture, 7);
assert.strictEqual(trendSeven.state, 'loaded', 'PH-TU01 observation model loads');
assert.strictEqual(trendSeven.period, 7, 'PH-TU02 seven days is the default period');
assert.strictEqual(api.observationPeriod_('30'), 30, 'PH-TU03 thirty-day toggle');
assert.strictEqual(trendSeven.weight.length, 1, 'PH-TU04/05 one weight point is retained');
assert.strictEqual(api.observationMealLabel_(trendSeven.meal.find((item) => item.localDate === '2026-08-17')), '--', 'PH-TU06 missing meal stays a gap');
assert.strictEqual(api.observationMealLabel_({ knownAmountG: 60, amountStatus: 'partial' }), '60g+', 'PH-TU07 partial meal label');
assert.deepStrictEqual(plain(trendSeven.stool.find((item) => item.localDate === '2026-08-20')), { localDate: '2026-08-20', count: 3, forms: { pellet: 0, formed: 1, banana: 2, soft: 0, watery: 0 }, formLabel: 'バナナ' }, 'PH-TU08 stool count and dominant form');
assert.strictEqual(api.observationTrendModel_(trendFixture, 30).localDates.length, 30, 'PH-TU03 thirty-day model range');
assert.strictEqual(api.observationTrendModel_(null, 7).state, 'unavailable', 'PH-TU09 unavailable trend state');
const weightAxis = api.weightAxisModel_([{ weightKg: 2.1 }, { weightKg: 2.4 }]);
assert(weightAxis && weightAxis.maximum - weightAxis.minimum >= 1, 'PH-WA01 weight axis must retain at least a 1kg range');
assert.deepStrictEqual(weightAxis.ticks.map((tick) => tick.label), ['3.0', '2.5', '2.0'], 'PH-WA02/03 weight axis ticks must be max mid min with one decimal label');
assert.strictEqual(api.weightAxisModel_([{ weightKg: 2.3 }]).ticks.length, 3, 'PH-WA05 one weight point must still receive three ticks');
assert.strictEqual(api.weightAxisModel_([{ weightKg: 2.3 }]).maximum - api.weightAxisModel_([{ weightKg: 2.3 }]).minimum >= 1, true, 'PH-WA08 same weight must retain a valid minimum range');
assert.strictEqual(api.weightAxisModel_([{ weightKg: -1 }, { weightKg: NaN }]), null, 'PH-WA07 invalid or negative weights must not create an axis');
assert.strictEqual(api.observationTrendModel_({ ...trendFixture, weight: { items: [{ localDate: '2026-08-20', occurredAt: '2026-08-20T08:00:00+09:00', weightKg: -1 }] } }, 7).weight.length, 0, 'PH-WA07 invalid weight must not enter the trend');
assert(featureSource.includes('id="popioObservationToggle"') && featureSource.includes('data-popio-observation-period="7"') && featureSource.includes('data-popio-observation-period="30"'), 'PH-TU01 observation section and period controls missing');
assert(featureSource.includes('renderWeightTrend_') && featureSource.includes('renderMealTrend_') && featureSource.includes('renderStoolTrend_'), 'PH-TU04/06/08 observation renderers missing');
assert(featureSource.includes("if (model.weight.length > 1)") && featureSource.includes("popio-weight-guide") && featureSource.includes("popio-weight-tick"), 'PH-WA04/05 weight chart must render guides and omit a one-point line');
assert(cssSource.includes('.popio-weight-guide') && cssSource.includes('stroke: #dce7de;') && cssSource.includes('.popio-weight-tick') && cssSource.includes('fill: var(--muted);'), 'PH-WA04 weight guide visual contract missing');
assert(featureSource.includes('<h3>💩 うんち</h3>') && !featureSource.includes('<h3>💩 便</h3>'), 'PH-TU08 stool trend label must use うんち');
assert(cssSource.includes('.popio-observation-card') && cssSource.includes('.popio-weight-chart') && cssSource.includes('.popio-trend-row') && cssSource.includes('grid-template-columns: 40px minmax(0, 1fr) auto auto;'), 'PH-TU01/04/06/08 observation mobile styles missing');
const periodControlsCss = cssSource.slice(cssSource.indexOf('.popio-observation-periods {'), cssSource.indexOf('.popio-observation-periods button[aria-pressed="true"]'));
assert(periodControlsCss.includes('min-width: 0;') && periodControlsCss.includes('flex-wrap: nowrap;') && periodControlsCss.includes('overflow-x: visible;'), 'PH-COLL09 period container can force horizontal overflow');
assert(periodControlsCss.includes('width: 64px;') && periodControlsCss.includes('max-width: 64px;') && periodControlsCss.includes('min-width: 64px;') && periodControlsCss.includes('flex: 0 0 64px;') && periodControlsCss.includes('flex-shrink: 0;') && periodControlsCss.includes('white-space: nowrap;'), 'PH-COLL09/10 period buttons can stretch or wrap');
assert(64 * 2 + 8 <= 360 - 48 - 30, 'PH-COLL10 two fixed period buttons exceed the 360px mobile content contract');
assert(featureSource.includes("loadDashboard_({ quiet: true })"), 'PH-TU10 correction save no longer refreshes Dashboard');

function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }

async function run() {
  const correctionIds = [];
  let correctionCalls = 0;
  const correctionFlow = api.createPetHealthSaveFlow_({
    createRequestId: () => uuid(300 + correctionCalls),
    isOnline: () => true,
    call: async (request, action) => { correctionCalls += 1; correctionIds.push({ id: request.clientRequestId, action, target: request.correctionOfEventId }); if (correctionCalls === 1) throw new Error('network'); return { event: { eventId: 'correction-1' } }; },
  });
  const correctionEvent = { eventType: 'meal', mealSlot: 'breakfast', completion: 'finished', amountG: 18, occurredAt: '2026-08-20T08:00:00+09:00' };
  assert.strictEqual((await correctionFlow.save('meal', correctionEvent, { action: 'pet.health.correct', correctionOfEventId: uuid(301) })).saved, false, 'PH-CU08 correction failure retains request ID');
  assert.strictEqual((await correctionFlow.save('meal', correctionEvent, { action: 'pet.health.correct', correctionOfEventId: uuid(301) })).saved, true, 'PH-CU04 correction retry succeeds');
  assert.deepStrictEqual(correctionIds, [{ id: uuid(300), action: 'pet.health.correct', target: uuid(301) }, { id: uuid(300), action: 'pet.health.correct', target: uuid(301) }], 'PH-CU08 correction retry changed request identity');

  const voidCalls = [];
  const voidFlow = api.createPetHealthSaveFlow_({
    createRequestId: () => uuid(302),
    isOnline: () => true,
    call: async (request, action) => { voidCalls.push({ request: plain(request), action }); return { event: { eventId: 'void-1' } }; },
  });
  assert.strictEqual((await voidFlow.save('meal', null, { action: 'pet.health.void', correctionOfEventId: uuid(301) })).saved, true, 'PH-CU07 void save succeeds');
  assert.deepStrictEqual(voidCalls, [{ request: { petId: 'popio', clientRequestId: uuid(302), correctionOfEventId: uuid(301) }, action: 'pet.health.void' }], 'PH-CU07 void sends no business payload');

  // PH-U09/U10: double submit is skipped and success releases the request ID.
  const gate = deferred();
  let calls = 0;
  const sent = [];
  let summaryRefreshes = 0;
  const flow = api.createPetHealthSaveFlow_({
    createRequestId: () => uuid(10 + calls),
    isOnline: () => true,
    call: async (request) => { calls += 1; sent.push(plain(request)); return gate.promise; },
    onSuccess: async () => { summaryRefreshes += 1; },
  });
  const event = { eventType: 'stool' };
  const first = flow.save('stool', event);
  const second = await flow.save('stool', event);
  assert.strictEqual(second.skipped, true, 'PH-U09 double submit reached API');
  assert.strictEqual(calls, 1, 'PH-U09 API count');
  const activeRequestId = flow.requestId('stool');
  assert(activeRequestId, 'request ID missing while saving');
  gate.resolve({ event: { eventId: 'event-1' } });
  assert.strictEqual((await first).saved, true);
  assert.strictEqual(flow.requestId('stool'), '', 'PH-U10 success retained request ID');
  assert.strictEqual(summaryRefreshes, 1, 'PH-U17 success did not refresh summary');

  // PH-U11/U12: failure preserves the input and the same ID is reused for an unchanged retry.
  const retainedInput = { eventType: 'water', amountMl: 150 };
  const retryIds = [];
  let failureCalls = 0;
  const retryFlow = api.createPetHealthSaveFlow_({
    createRequestId: () => uuid(21 + failureCalls),
    isOnline: () => true,
    call: async (request) => {
      failureCalls += 1; retryIds.push(request.clientRequestId);
      if (failureCalls === 1) throw new Error('network');
      return { event: { eventId: 'event-2' } };
    },
  });
  assert.strictEqual((await retryFlow.save('water', retainedInput)).saved, false);
  assert.deepStrictEqual(retainedInput, { eventType: 'water', amountMl: 150 }, 'PH-U11 input mutated on failure');
  assert(retryFlow.requestId('water'), 'PH-U12 failed request ID was discarded');
  assert.strictEqual((await retryFlow.save('water', retainedInput)).saved, true);
  assert.strictEqual(retryIds[0], retryIds[1], 'PH-U12 retry used a new request ID');

  // PH-U13: editing failed content explicitly retires the old ID.
  let editCalls = 0;
  const editedIds = [];
  const editFlow = api.createPetHealthSaveFlow_({
    createRequestId: () => uuid(31 + editCalls),
    isOnline: () => true,
    call: async (request) => { editCalls += 1; editedIds.push(request.clientRequestId); throw new Error('network'); },
  });
  await editFlow.save('weight', { eventType: 'weight', weightKg: 2.3 });
  editFlow.contentChanged('weight');
  await editFlow.save('weight', { eventType: 'weight', weightKg: 2.4 });
  assert.notStrictEqual(editedIds[0], editedIds[1], 'PH-U13 edited save reused prior request ID');

  // PH-TUI07/08: an unchanged explicit timestamp retries with one ID; changing it retires that ID.
  const timestampRetryIds = [];
  let timestampRetryCalls = 0;
  const timestampRetryFlow = api.createPetHealthSaveFlow_({
    createRequestId: () => uuid(41 + timestampRetryCalls),
    isOnline: () => true,
    call: async (request) => {
      timestampRetryCalls += 1;
      timestampRetryIds.push({ id: request.clientRequestId, occurredAt: request.event.occurredAt });
      if (timestampRetryCalls === 1) throw new Error('network');
      return { event: { eventId: 'event-3' } };
    },
  });
  const explicitStool = api.buildEventPayload_('stool', { occurredAtMode: 'explicit', occurredAtDate: 'today', occurredAtHour: '2' }, timestampNow);
  await timestampRetryFlow.save('stool', explicitStool);
  await timestampRetryFlow.save('stool', explicitStool);
  assert.deepStrictEqual(timestampRetryIds, [
    { id: uuid(41), occurredAt: '2026-08-21T02:00:00+09:00' },
    { id: uuid(41), occurredAt: '2026-08-21T02:00:00+09:00' },
  ], 'PH-TUI07 retry changed its timestamp or request ID');

  const timestampEditIds = [];
  let timestampEditCalls = 0;
  const timestampEditFlow = api.createPetHealthSaveFlow_({
    createRequestId: () => uuid(51 + timestampEditCalls),
    isOnline: () => true,
    call: async (request) => { timestampEditCalls += 1; timestampEditIds.push(request.clientRequestId); throw new Error('network'); },
  });
  await timestampEditFlow.save('stool', explicitStool);
  timestampEditFlow.contentChanged('stool');
  const changedExplicitStool = api.buildEventPayload_('stool', { occurredAtMode: 'explicit', occurredAtDate: 'today', occurredAtHour: '3' }, timestampNow);
  await timestampEditFlow.save('stool', changedExplicitStool);
  assert.notStrictEqual(timestampEditIds[0], timestampEditIds[1], 'PH-TUI08 changed timestamp reused its request ID');

  // PH-WU09/10: water-bottle save refreshes on success and retains one ID on failure/retry.
  let bottleRefreshes = 0;
  const savedBottle = { eventType: 'water_bottle', newFillMl: 400 };
  const bottleSuccessFlow = api.createPetHealthSaveFlow_({
    createRequestId: () => uuid(61),
    isOnline: () => true,
    call: async () => ({ event: { eventId: 'bottle-1' } }),
    onSuccess: async () => { bottleRefreshes += 1; },
  });
  assert.strictEqual((await bottleSuccessFlow.save('water_bottle', savedBottle)).saved, true, 'PH-WU09 bottle save');
  assert.strictEqual(bottleRefreshes, 1, 'PH-WU09 bottle save refresh');
  const bottleRetryIds = [];
  let bottleRetryCalls = 0;
  const bottleRetryFlow = api.createPetHealthSaveFlow_({
    createRequestId: () => uuid(70 + bottleRetryCalls),
    isOnline: () => true,
    call: async (request) => { bottleRetryCalls += 1; bottleRetryIds.push(request.clientRequestId); if (bottleRetryCalls === 1) throw new Error('network'); return { event: { eventId: 'bottle-2' } }; },
  });
  assert.strictEqual((await bottleRetryFlow.save('water_bottle', savedBottle)).saved, false, 'PH-WU10 first failure');
  assert.strictEqual((await bottleRetryFlow.save('water_bottle', savedBottle)).saved, true, 'PH-WU10 retry success');
  assert.strictEqual(bottleRetryIds[0], bottleRetryIds[1], 'PH-WU10 retry changed request ID');

  // PH-SF01/02/07: a saved Write is final even when the following Read refresh fails.
  const postSaveResults = [];
  const saveStatuses = [];
  const saveIds = [];
  let saveSequence = 80;
  const postSaveFlow = api.createPetHealthSaveFlow_({
    createRequestId: () => uuid(saveSequence++),
    isOnline: () => true,
    call: async (request) => { saveIds.push(request.clientRequestId); return { event: { eventId: 'saved-meal' } }; },
    onSuccess: async () => ({ writeSaved: true, summaryRefreshed: false }),
    onSaved: (_key, _data, postSave) => { postSaveResults.push(plain(postSave)); saveStatuses.push(api.savedStatusMessage_(postSave)); },
  });
  const mealSave = await postSaveFlow.save('meal', { eventType: 'meal', mealSlot: 'breakfast', completion: 'finished' });
  assert.strictEqual(mealSave.saved, true, 'PH-SF02 refresh failure must not revert a saved Write');
  assert.deepStrictEqual(plain(mealSave.postSave), { writeSaved: true, summaryRefreshed: false }, 'PH-SF02 save outcome');
  assert.strictEqual(postSaveFlow.requestId('meal'), '', 'PH-SF02 saved Write retained request ID');
  assert.deepStrictEqual(postSaveResults, [{ writeSaved: true, summaryRefreshed: false }], 'PH-SF02 saved outcome was not delivered');
  assert.deepStrictEqual(saveStatuses, ['保存しました。最新表示を更新できませんでした。'], 'PH-SF02 saved message must not say Write failed');
  assert.strictEqual(postSaveFlow.isSaving('meal'), false, 'PH-RCA02 summary failure left the save flow busy');
  const secondMealSave = await postSaveFlow.save('meal', { eventType: 'meal', mealSlot: 'breakfast', completion: 'finished' });
  assert.strictEqual(secondMealSave.saved, true, 'PH-SF08 later new save remains possible');
  assert.notStrictEqual(saveIds[0], saveIds[1], 'PH-SF08 summary failure reused a saved Write request ID');
  assert.strictEqual(api.savedStatusMessage_({ writeSaved: true, summaryRefreshed: true }), '保存しました', 'PH-SF01 success message');

  // PH-SF03 - PH-SF06: the recovery control is Read-only and only appears for a failed summary.
  assert(featureSource.includes('type="button" data-popio-water-bottle-reload'), 'PH-SF03 reload must never submit a record');
  assert(featureSource.includes("reload.hidden = !model.canReload") && featureSource.includes("reload.disabled = !model.canReload || Boolean(saveFlow_ && saveFlow_.isSaving('water_bottle'))"), 'PH-SF05/06 reload visibility is not bound to summary state');
  const retryActions = [];
  const retryLoader = api.createPetHealthSummaryLoader_({
    localDate: () => '2026-08-21',
    call: async (action, body) => { retryActions.push({ action, body: plain(body) }); return { petId: 'popio' }; },
  });
  await retryLoader.load();
  assert.deepStrictEqual(retryActions, [{ action: 'pet.health.getDailySummary', body: { petId: 'popio', localDate: '2026-08-21' } }], 'PH-SF04 retry must issue one summary Read only');
  const restoredBottleModel = api.waterBottleUiModel_({ waterBottle: { eventCount: 1, latest: { eventId: 'bottle-restored', occurredAt: '2026-08-21T08:00:00+09:00', newFillMl: 400 }, latestInterval: null } }, 'loaded');
  assert.strictEqual(restoredBottleModel.ready, true, 'PH-SF05 successful retry must re-enable water bottle input');
  assert.strictEqual(restoredBottleModel.canReload, false, 'PH-SF05 successful retry must hide reload');
  assert.strictEqual(api.waterBottleUiModel_(null, 'failed').canReload, true, 'PH-SF06 failed retry keeps Read-only retry available');

  // PH-RCA01: navigator.onLine is only a hint. A Summary Read must still reach
  // the authenticated gateway, while offline Writes retain the existing guard.
  assert.strictEqual(api.shouldBlockPetHealthOffline_('pet.health.getDailySummary', false), false, 'PH-RCA01 offline hint blocked Summary Read locally');
  assert.strictEqual(api.shouldBlockPetHealthOffline_('pet.health.listRecentEvents', false), false, 'PH-RCA01 offline hint blocked Recent Read locally');
  assert.strictEqual(api.shouldBlockPetHealthOffline_('pet.health.record', false), true, 'PH-RCA01 offline Write guard was weakened');
  assert.strictEqual(api.shouldBlockPetHealthOffline_('pet.health.getDailySummary', true), false, 'PH-RCA01 online Summary Read was blocked');
  assert(featureSource.includes("shouldBlockPetHealthOffline_(action, navigator.onLine)"), 'PH-RCA01 call_ does not use the action-aware offline guard');

  // PH-U14: initial summary loader uses only petId and Tokyo localDate.
  const summaryCalls = [];
  const loader = api.createPetHealthSummaryLoader_({
    localDate: () => '2026-08-20',
    call: async (action, body) => { summaryCalls.push({ action, body: plain(body) }); return { petId: 'popio' }; },
  });
  await loader.load();
  assert.deepStrictEqual(summaryCalls, [{ action: 'pet.health.getDailySummary', body: { petId: 'popio', localDate: '2026-08-20' } }], 'PH-U14 summary request');

  const recentCalls = [];
  await api.createPetHealthRecentLoader_({ call: async (action, body) => { recentCalls.push({ action, body: plain(body) }); return { events: [] }; } }).load();
  assert.deepStrictEqual(recentCalls, [{ action: 'pet.health.listRecentEvents', body: { petId: 'popio', days: 7 } }], 'PH-H01 recent request');

  // PH-DU01/02: the Popio view uses one Dashboard Read, not the two legacy Read operations.
  const dashboardFixture = {
    petId: 'popio', localDate: '2026-08-21', timezone: 'Asia/Tokyo',
    summary: { meal: { bySlot: { breakfast: { eventCount: 1 }, dinner: { eventCount: 1 } } }, water: {}, waterBottle: { eventCount: 0, latest: null, latestInterval: null }, stool: {}, urine: {}, latestWeight: null, notableObservations: [] },
    recentEvents: [{ eventId: 'dashboard-event', eventType: 'meal', occurredAt: '2026-08-21T08:00:00+09:00', localDate: '2026-08-21', recordedAt: '2026-08-21T08:01:00+09:00', mealSlot: 'breakfast', completion: 'finished' }],
    trends: trendFixture,
  };
  const dashboardCalls = [];
  const dashboardLoader = api.createPetHealthDashboardLoader_({ localDate: () => '2026-08-21', call: async (action, body) => { dashboardCalls.push({ action, body: plain(body) }); return dashboardFixture; } });
  assert.deepStrictEqual(plain(await dashboardLoader.load()), dashboardFixture, 'PH-DU01 dashboard loader result');
  assert.deepStrictEqual(dashboardCalls, [{ action: 'pet.health.getDashboard', body: { petId: 'popio', localDate: '2026-08-21' } }], 'PH-DU01 view open makes one Dashboard API call');
  const openSlice = featureSource.slice(featureSource.indexOf('async function open_'), featureSource.indexOf('function createPetHealthSummaryLoader_'));
  assert(openSlice.includes('loadDashboard_()') && !openSlice.includes('refreshPetHealthReads_()'), 'PH-DU02 view open still uses individual Reads');
  assert.strictEqual(api.dashboardDataValid_(dashboardFixture), true, 'PH-DU03 cache accepts a valid Dashboard');
  assert.deepStrictEqual(plain(api.dashboardSnapshotState_(dashboardFixture, false)), { dashboard: dashboardFixture, summary: dashboardFixture.summary, summaryStatus: 'loaded', recentEvents: dashboardFixture.recentEvents, recentStatus: 'loaded', dashboardFresh: false }, 'PH-DU03 cache renders immediately as stale');
  assert.deepStrictEqual(plain(api.dashboardSnapshotState_(dashboardFixture, true)).dashboard, dashboardFixture, 'PH-DU04 fresh success replaces the cached snapshot');
  assert.deepStrictEqual(plain(api.dashboardSnapshotState_(dashboardFixture, false)).dashboard.trends, trendFixture, 'PH-TU09 cached Dashboard retains trend data');
  assert.deepStrictEqual(plain(api.dashboardFailureState_(dashboardFixture)).summary, dashboardFixture.summary, 'PH-DU05 fresh failure keeps last-good summary');
  assert.deepStrictEqual(plain(api.dashboardFailureState_(null)), { dashboard: null, summary: null, summaryStatus: 'failed', recentEvents: [], recentStatus: 'failed', dashboardFresh: false }, 'PH-DU06 cacheless failure is a settled failed state');
  assert(featureSource.includes('dashboardLoad_ = null'), 'PH-DU07 Dashboard loading does not always settle');
  assert(featureSource.includes("const refreshed = await loadDashboard_({ quiet: true });"), 'PH-DU08 save success does not issue one Dashboard refresh');
  assert.strictEqual(api.savedStatusMessage_({ writeSaved: true, dashboardRefreshed: false }), '保存しました。最新表示を更新できませんでした。', 'PH-DU09 failed Dashboard refresh must preserve Write success');
  assert.strictEqual(api.waterBottleUiModel_(dashboardFixture.summary, 'loaded', false).ready, false, 'PH-DU10 cached Dashboard must keep water bottle Write disabled');
  assert.strictEqual(api.waterBottleUiModel_(dashboardFixture.summary, 'loaded', true).ready, true, 'PH-DU11 fresh Dashboard enables water bottle Write');
  assert.strictEqual(api.reminderIcon_({ known: true, items: [{ slot: 'breakfast' }] }), '⚠️', 'PH-DU12 reminder icon');
  assert.strictEqual(api.reminderIcon_({ known: true, items: [] }), '✅', 'PH-DU13 clear reminder icon');
  assert.strictEqual(api.reminderIcon_({ known: false, items: [] }), '◻️', 'PH-DU14 unknown reminder icon');

  const refreshCalls = [];
  const refreshResult = await api.createPetHealthReadRefresher_({
    loadSummary: async () => { refreshCalls.push('summary'); return false; },
    loadRecent: async () => { refreshCalls.push('recent'); return true; },
  }).load({ quiet: true });
  assert.deepStrictEqual(plain(refreshResult), { summary: false, recent: true }, 'PH-H07/H09 independent refresh outcomes');
  assert.deepStrictEqual(refreshCalls.sort(), ['recent','summary'], 'PH-H09 save refresh must call both Reads');

  const shortcutState = { scrolled: false, focused: false };
  const reminderInput = { checked: false, focus() { shortcutState.focused = true; } };
  const reminderDetails = { open: false, scrollIntoView() { shortcutState.scrolled = true; } };
  const reminderForm = { querySelector: () => reminderInput, closest: () => reminderDetails };
  assert.strictEqual(api.applyMealReminderShortcut_({ querySelector: () => reminderForm }, 'dinner'), true, 'PH-H10 shortcut application');
  assert.strictEqual(reminderInput.checked, true, 'PH-H10 meal slot was not selected');
  assert.deepStrictEqual(shortcutState, { scrolled: true, focused: true }, 'PH-H10 form was not focused/scrolled');

  // PH-U15/U16: a successful zero summary is distinct from a failed/unavailable summary.
  const emptyModel = api.summaryDisplayModel_({
    meal: { eventCount: 0, totalAmountG: null }, water: { eventCount: 0, totalAmountMl: null }, stool: { count: 0 }, latestWeight: null,
  }, 'loaded');
  assert.deepStrictEqual(plain(emptyModel), { meal: '0g', water: '--', waterHint: '', stool: '0回', weight: '--' }, 'PH-U15 zero summary');
  assert.deepStrictEqual(plain(api.summaryDisplayModel_(null, 'failed')), { meal: '--', water: '--', waterHint: '', stool: '--', weight: '--' }, 'PH-U16 failed summary');

  // PH-U18/U19: feature receives only facade + public auth context; it cannot read or transport raw credentials itself.
  assert(!featureSource.includes('localStorage'), 'PH-U19 feature reads storage');
  assert(!featureSource.includes('pairingToken'), 'PH-U19 feature refers to raw token');
  assert(!featureSource.includes('fetch('), 'PH-U19 feature bypasses authenticated facade');
  assert(featureSource.includes("state.petHealthApi = typeof detail.petHealthApi === 'function'"), 'PH-U18 facade handoff missing');
  assert(featureSource.includes("if (!state.authContext || !state.petHealthApi)"), 'PH-U18 missing facade blocks were removed');

  const authSlice = appSource.slice(
    appSource.indexOf('function buildAuthenticatedPetHealthPayload_'),
    appSource.indexOf('function showAuthenticationState'),
  );
  const authContext = { Object, Set, Error };
  vm.createContext(authContext);
  vm.runInContext(authSlice, authContext);
  const summaryPayload = plain(authContext.buildAuthenticatedPetHealthPayload_('pet.health.getDailySummary', {
    petId: 'popio', localDate: '2026-08-20', homeId: 'spoof', source: 'agent', serviceToken: 'spoof',
  }));
  assert.deepStrictEqual(summaryPayload, { action: 'pet.health.getDailySummary', petId: 'popio', localDate: '2026-08-20' });
  const recordPayload = plain(authContext.buildAuthenticatedPetHealthPayload_('pet.health.record', {
    petId: 'popio', clientRequestId: uuid(99), event: { eventType: 'stool' }, actorUserId: 'spoof', role: 'admin',
  }));
  assert.deepStrictEqual(recordPayload, { action: 'pet.health.record', petId: 'popio', clientRequestId: uuid(99), event: { eventType: 'stool' } });
  const correctPayload = plain(authContext.buildAuthenticatedPetHealthPayload_('pet.health.correct', {
    petId: 'popio', clientRequestId: uuid(101), correctionOfEventId: uuid(99), event: { eventType: 'stool' }, homeId: 'spoof', actorUserId: 'spoof', source: 'agent', serviceToken: 'spoof',
  }));
  assert.deepStrictEqual(correctPayload, { action: 'pet.health.correct', petId: 'popio', clientRequestId: uuid(101), correctionOfEventId: uuid(99), event: { eventType: 'stool' } }, 'PH-CU04 PWA correction payload leaked a server field');
  const voidPayload = plain(authContext.buildAuthenticatedPetHealthPayload_('pet.health.void', {
    petId: 'popio', clientRequestId: uuid(102), correctionOfEventId: uuid(99), homeId: 'spoof', actorUserId: 'spoof', source: 'agent', serviceToken: 'spoof',
  }));
  assert.deepStrictEqual(voidPayload, { action: 'pet.health.void', petId: 'popio', clientRequestId: uuid(102), correctionOfEventId: uuid(99) }, 'PH-CU05 PWA void payload leaked a server field');
  const recentPayload = plain(authContext.buildAuthenticatedPetHealthPayload_('pet.health.listRecentEvents', {
    petId: 'popio', days: 7, homeId: 'spoof', actorUserId: 'spoof', serviceToken: 'spoof',
  }));
  assert.deepStrictEqual(recentPayload, { action: 'pet.health.listRecentEvents', petId: 'popio', days: 7 }, 'PH-RG03 recent PWA payload leaked server identity');
  const dashboardPayload = plain(authContext.buildAuthenticatedPetHealthPayload_('pet.health.getDashboard', {
    petId: 'popio', localDate: '2026-08-21', homeId: 'spoof', actorUserId: 'spoof', serviceToken: 'spoof',
  }));
  assert.deepStrictEqual(dashboardPayload, { action: 'pet.health.getDashboard', petId: 'popio', localDate: '2026-08-21' }, 'PH-DU01 Dashboard PWA payload leaked server identity');
  assert(appSource.includes('petHealthApi: callAuthenticatedPetHealth_'), 'authenticated event does not pass Pet facade');
  assert(appSource.includes('petHealthDashboardCache: petHealthDashboardCacheFacade_()'), 'Dashboard cache facade is not passed separately from credentials');
  const cacheSlice = appSource.slice(appSource.indexOf('function loadPetHealthDashboardCache_'), appSource.indexOf('function showAuthenticationState'));
  assert(cacheSlice.includes('PET_HEALTH_DASHBOARD_CACHE_STORAGE_KEY') && cacheSlice.includes('dashboard,') && cacheSlice.includes('fetchedAt') && cacheSlice.includes('schemaVersion'), 'PH-DU03 Dashboard cache shape is incomplete');
  assert(!cacheSlice.includes('pairingToken') && !cacheSlice.includes('deviceId'), 'PH-DU03 Dashboard cache stores credentials');
  assert(appSource.includes('const PET_HEALTH_DASHBOARD_TIMEOUT_MS = 12000;') && appSource.includes('withPetHealthDashboardTimeout_'), 'PH-DU07 Dashboard Read timeout is missing');
  assert(appSource.indexOf('document.dispatchEvent(new CustomEvent("paruru:authenticated"') < appSource.indexOf('void switchView(activeView);'), 'PH-DU01 authenticated Pet facade is installed after view opening');

  assert(htmlSource.includes('id="popioHealthView"') && htmlSource.includes('id="popioHealthMount"'), 'Pet Health view/mount missing');
  assert(htmlSource.includes('data-target-view="popio-health"'), 'Pet Health drawer navigation missing');
  assert(htmlSource.includes('features/popio-health/popio-health.js'), 'Pet Health feature script missing');
  assert(membershipSource.match(/popio-health/g)?.length === 3, 'Pet Health view is not allowed for all three roles');
  assert(swSource.includes('versioned("features/popio-health/popio-health.js")'), 'Pet Health feature missing from PWA app shell');
  assert(featureSource.includes('data-event-type="water_bottle"') && featureSource.includes('data-popio-water-bottle-previous'), 'water-bottle form missing');
  assert(featureSource.includes('id="popioReminderList"') && featureSource.includes('id="popioHistoryList"'), 'Reminder/History UI mount missing');

  // PH-TUI09 - PH-TUI12: success resets to now, each form owns a timestamp control, and no server fields leak.
  assert(featureSource.includes('form.reset(); resetTimestampControl_(form);'), 'PH-TUI09 success does not reset timestamp state');
  assert.strictEqual((featureSource.match(/\$\{timestampControl_\(\)\}/g) || []).length, 6, 'PH-TUI10 forms do not have independent timestamp controls');
  assert.strictEqual(api.buildOccurredAt_({ occurredAtMode: 'now' }, timestampNow), '', 'PH-TUI11 now reset must omit occurredAt');
  const explicitRequest = api.buildRecordRequest_(uuid(100), api.buildEventPayload_('stool', {
    occurredAtMode: 'explicit', occurredAtDate: 'today', occurredAtHour: '2', homeId: 'spoof', source: 'agent',
  }, timestampNow));
  assert.deepStrictEqual(plain(explicitRequest), {
    petId: 'popio', clientRequestId: uuid(100), event: { eventType: 'stool', occurredAt: '2026-08-21T02:00:00+09:00' },
  }, 'PH-TUI12 explicit payload leaked a client/server field');
  assert(!Object.hasOwn(explicitRequest, 'localDate') && !Object.hasOwn(explicitRequest.event, 'localDate'), 'PH-TUI12 sent localDate');

  // Responsive contract: full-size text controls/buttons and full-size choice labels.
  assert(cssSource.includes('.popio-health input:not([type="radio"]):not([type="checkbox"])') && cssSource.includes('min-height: 48px;'), 'Pet text controls lack 48px contract');
  assert(cssSource.includes('.popio-health button') && cssSource.includes('font-size: 16px;'), 'Pet controls lack 16px contract');
  assert(cssSource.includes('.popio-choice span') && cssSource.includes('.popio-check') && cssSource.includes('min-height: 48px;'), 'Pet choices lack 48px tap targets');
  assert(cssSource.includes('.popio-occurred-at-panel') && cssSource.includes('grid-template-columns: repeat(2, minmax(0, 1fr));'), 'timestamp panel lacks the mobile grid contract');
  assert(cssSource.includes('.popio-water-bottle-previous') && cssSource.includes('.popio-water-bottle-preview'), 'water-bottle mobile styles missing');
  assert(cssSource.includes('.popio-reminder-item') && cssSource.includes('.popio-history-item'), 'Reminder/History mobile styles missing');

  console.log('PASS PH-U01-PH-U19, PH-TUI01-PH-TUI12, PH-WU01-PH-WU10, PH-M01-PH-M08, PH-H01-PH-H10, PH-TU01-PH-TU10, and PH-COLL01-PH-COLL10 Pet Health UI contracts');
}

run().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

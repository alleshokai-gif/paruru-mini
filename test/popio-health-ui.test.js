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

function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }

async function run() {
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

  // PH-U14: initial summary loader uses only petId and Tokyo localDate.
  const summaryCalls = [];
  const loader = api.createPetHealthSummaryLoader_({
    localDate: () => '2026-08-20',
    call: async (action, body) => { summaryCalls.push({ action, body: plain(body) }); return { petId: 'popio' }; },
  });
  await loader.load();
  assert.deepStrictEqual(summaryCalls, [{ action: 'pet.health.getDailySummary', body: { petId: 'popio', localDate: '2026-08-20' } }], 'PH-U14 summary request');

  // PH-U15/U16: a successful zero summary is distinct from a failed/unavailable summary.
  const emptyModel = api.summaryDisplayModel_({
    meal: { eventCount: 0, totalAmountG: null }, water: { eventCount: 0, totalAmountMl: null }, stool: { count: 0 }, latestWeight: null,
  }, 'loaded');
  assert.deepStrictEqual(plain(emptyModel), { meal: '0g', water: '0mL', stool: '0回', weight: '--' }, 'PH-U15 zero summary');
  assert.deepStrictEqual(plain(api.summaryDisplayModel_(null, 'failed')), { meal: '--', water: '--', stool: '--', weight: '--' }, 'PH-U16 failed summary');

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
  assert(appSource.includes('petHealthApi: callAuthenticatedPetHealth_'), 'authenticated event does not pass Pet facade');

  assert(htmlSource.includes('id="popioHealthView"') && htmlSource.includes('id="popioHealthMount"'), 'Pet Health view/mount missing');
  assert(htmlSource.includes('data-target-view="popio-health"'), 'Pet Health drawer navigation missing');
  assert(htmlSource.includes('features/popio-health/popio-health.js'), 'Pet Health feature script missing');
  assert(membershipSource.match(/popio-health/g)?.length === 3, 'Pet Health view is not allowed for all three roles');
  assert(swSource.includes('versioned("features/popio-health/popio-health.js")'), 'Pet Health feature missing from PWA app shell');

  // Responsive contract: full-size text controls/buttons and full-size choice labels.
  assert(cssSource.includes('.popio-health input:not([type="radio"]):not([type="checkbox"])') && cssSource.includes('min-height: 48px;'), 'Pet text controls lack 48px contract');
  assert(cssSource.includes('.popio-health button') && cssSource.includes('font-size: 16px;'), 'Pet controls lack 16px contract');
  assert(cssSource.includes('.popio-choice span') && cssSource.includes('.popio-check') && cssSource.includes('min-height: 48px;'), 'Pet choices lack 48px tap targets');

  console.log('PASS PH-U01-PH-U19 Pet Health UI payload, save lifecycle, summary, auth, and responsive contracts');
}

run().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

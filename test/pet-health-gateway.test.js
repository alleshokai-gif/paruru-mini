'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HEALTH_URL = 'https://script.google.com/macros/s/test-health-deployment/exec';
const SERVER_TOKEN = 'server-test-token';
const roles = ['admin', 'guardian', 'self_record'];
let passed = 0;

function test(id, name, fn) {
  fn();
  passed += 1;
  console.log(`PASS ${id} ${name}`);
}

function backendRecord(overrides) {
  return Object.assign({
    success: true,
    status: 'SUCCESS',
    operation: 'pet.health.record',
    data: {
      event: { eventId: 'event-1', petId: 'popio', eventType: 'stool' },
      idempotency: { replayed: false },
    },
    warnings: [],
    error: null,
    schemaVersion: 'pet-health-1.0',
  }, overrides || {});
}

function backendSummary(overrides) {
  return Object.assign({
    success: true,
    status: 'SUCCESS',
    operation: 'pet.health.getDailySummary',
    data: {
      petId: 'popio',
      localDate: '2026-08-19',
      timezone: 'Asia/Tokyo',
      meal: {},
      water: {},
      waterBottle: { eventCount: 0, latest: null, latestInterval: null },
      stool: {},
      urine: {},
      latestWeight: null,
      notableObservations: [],
    },
    warnings: [],
    error: null,
    schemaVersion: 'pet-health-1.0',
  }, overrides || {});
}

function backendRecent(overrides) {
  return Object.assign({
    success: true,
    status: 'SUCCESS',
    operation: 'pet.health.listRecentEvents',
    data: {
      petId: 'popio', days: 7, fromLocalDate: '2026-08-15', toLocalDate: '2026-08-21', timezone: 'Asia/Tokyo',
      events: [{ eventId: 'event-recent', eventType: 'meal', occurredAt: '2026-08-21T08:00:00+09:00', localDate: '2026-08-21', recordedAt: '2026-08-21T08:01:00+09:00', mealSlot: 'breakfast', amountG: 20, completion: 'finished' }],
    },
    warnings: [],
    error: null,
    schemaVersion: 'pet-health-1.0',
  }, overrides || {});
}

function setup(options) {
  const state = Object.assign({
    actor: { homeId: 'home-server', memberUserId: 'member-server', role: 'admin', deviceId: 'device-server' },
    properties: { HEALTH_WEBAPP_URL: HEALTH_URL, HEALTH_SERVICE_TOKEN: SERVER_TOKEN },
    responseCode: 200,
    responseText: JSON.stringify(backendRecord()),
    fetchError: null,
    forwarded: [],
    authorizedCapabilities: [],
    resolvedCredentials: [],
  }, options || {});
  const context = {
    console,
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: (key) => state.properties[key] || '' }),
    },
    UrlFetchApp: {
      fetch: (_url, request) => {
        if (state.fetchError) throw state.fetchError;
        state.forwarded.push(JSON.parse(request.payload));
        return {
          getResponseCode: () => state.responseCode,
          getContentText: () => state.responseText,
        };
      },
    },
    json_: (value) => value,
    verifyHomeControlDevicePairing_: () => ({ handled: true, authorized: true }),
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'gas', 'HomeMembershipService.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'gas', 'HealthGatewayService.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'gas', 'PetHealthGatewayService.js'), 'utf8'), context);
  context.resolveAuthenticatedActor_ = (deviceId, pairingToken) => {
    state.resolvedCredentials.push({ deviceId, pairingToken });
    return Object.assign({}, state.actor);
  };
  const realAuthorize = context.authorizeCapability_;
  context.authorizeCapability_ = (actor, capability) => {
    state.authorizedCapabilities.push(capability);
    return realAuthorize(actor, capability);
  };
  return { api: context, state };
}

function recordInput(extra) {
  return Object.assign({
    action: 'pet.health.record',
    deviceId: 'browser-device',
    pairingToken: 'browser-pairing',
    petId: 'popio',
    clientRequestId: '01234567-89ab-4def-8123-456789abcdef',
    event: { eventType: 'stool' },
  }, extra || {});
}

function summaryInput(extra) {
  return Object.assign({
    action: 'pet.health.getDailySummary',
    deviceId: 'browser-device',
    pairingToken: 'browser-pairing',
    petId: 'popio',
    localDate: '2026-08-19',
  }, extra || {});
}

function recentInput(extra) {
  return Object.assign({
    action: 'pet.health.listRecentEvents',
    deviceId: 'browser-device',
    pairingToken: 'browser-pairing',
    petId: 'popio',
    days: 7,
  }, extra || {});
}

roles.forEach((role, index) => {
  test(`PH-G0${index * 2 + 1}`, `${role} read`, () => {
    const { api, state } = setup({ actor: { homeId: 'home-server', memberUserId: `${role}-member`, role, deviceId: 'device-server' }, responseText: JSON.stringify(backendSummary()) });
    const result = api.petHealthGateway_(summaryInput());
    assert.strictEqual(result.success, true);
    assert.strictEqual(api.hasRoleCapability_(state.actor, 'pet.health.read'), true);
    assert.deepStrictEqual(state.authorizedCapabilities, ['pet.health.read']);
  });
  test(`PH-G0${index * 2 + 2}`, `${role} record`, () => {
    const { api, state } = setup({ actor: { homeId: 'home-server', memberUserId: `${role}-member`, role, deviceId: 'device-server' } });
    const result = api.petHealthGateway_(recordInput());
    assert.strictEqual(result.success, true);
    assert.strictEqual(api.hasRoleCapability_(state.actor, 'pet.health.record'), true);
    assert.deepStrictEqual(state.authorizedCapabilities, ['pet.health.record']);
  });
});

test('PH-G07', 'missing capability is forbidden', () => {
  const { api, state } = setup();
  api.hasRoleCapability_ = () => false;
  const result = api.petHealthGateway_(recordInput());
  assert.strictEqual(result.error.code, 'FORBIDDEN');
  assert.deepStrictEqual(state.authorizedCapabilities, ['pet.health.record']);
  assert.strictEqual(state.forwarded.length, 0);
});

test('PH-G08', 'client home spoof is rejected', () => {
  const { api, state } = setup();
  const result = api.petHealthGateway_(recordInput({ homeId: 'home-spoofed' }));
  assert.strictEqual(result.error.code, 'INVALID_INPUT');
  assert.strictEqual(state.forwarded.length, 0);
});

test('PH-G09', 'client actor spoof is rejected', () => {
  const { api, state } = setup();
  const result = api.petHealthGateway_(recordInput({ actorUserId: 'attacker' }));
  assert.strictEqual(result.error.code, 'INVALID_INPUT');
  assert.strictEqual(state.forwarded.length, 0);
});

test('PH-G10', 'client role spoof cannot grant capability', () => {
  const { api, state } = setup();
  api.hasRoleCapability_ = () => false;
  const result = api.petHealthGateway_(recordInput({ role: 'admin' }));
  assert.strictEqual(result.error.code, 'FORBIDDEN');
  assert.strictEqual(state.forwarded.length, 0);
});

test('PH-G11', 'public source agent is rejected', () => {
  const { api, state } = setup();
  const result = api.petHealthGateway_(recordInput({ source: 'agent' }));
  assert.strictEqual(result.error.code, 'INVALID_INPUT');
  assert.strictEqual(state.forwarded.length, 0);
});

test('PH-G12', 'pairing token is not forwarded', () => {
  const { api, state } = setup();
  assert.strictEqual(api.petHealthGateway_(recordInput()).success, true);
  assert.strictEqual(Object.hasOwn(state.forwarded[0], 'pairingToken'), false);
});

test('PH-G13', 'device ID is not forwarded', () => {
  const { api, state } = setup();
  assert.strictEqual(api.petHealthGateway_(recordInput()).success, true);
  assert.strictEqual(Object.hasOwn(state.forwarded[0], 'deviceId'), false);
});

test('PH-G14', 'record forwards exact trusted payload', () => {
  const { api, state } = setup();
  assert.strictEqual(api.petHealthGateway_(recordInput()).success, true);
  assert.deepStrictEqual(state.forwarded[0], {
    operation: 'pet.health.record',
    serviceToken: SERVER_TOKEN,
    homeId: 'home-server',
    actorUserId: 'member-server',
    petId: 'popio',
    source: 'manual',
    clientRequestId: '01234567-89ab-4def-8123-456789abcdef',
    event: { eventType: 'stool' },
  });
  assert.deepStrictEqual(state.resolvedCredentials, [{ deviceId: 'browser-device', pairingToken: 'browser-pairing' }]);
});

test('PH-G15', 'summary forwards exact trusted payload', () => {
  const { api, state } = setup({ responseText: JSON.stringify(backendSummary()) });
  assert.strictEqual(api.petHealthGateway_(summaryInput()).success, true);
  assert.deepStrictEqual(state.forwarded[0], {
    operation: 'pet.health.getDailySummary',
    serviceToken: SERVER_TOKEN,
    homeId: 'home-server',
    actorUserId: 'member-server',
    petId: 'popio',
    localDate: '2026-08-19',
  });
});

test('PH-G16', 'service token comes only from server configuration', () => {
  const { api, state } = setup();
  const rejected = api.petHealthGateway_(recordInput({ serviceToken: 'client-token' }));
  assert.strictEqual(rejected.error.code, 'INVALID_INPUT');
  assert.strictEqual(state.forwarded.length, 0);
  assert.strictEqual(api.petHealthGateway_(recordInput()).success, true);
  assert.strictEqual(state.forwarded[0].serviceToken, SERVER_TOKEN);
});

['INVALID_INPUT', 'IDEMPOTENCY_CONFLICT', 'DATA_INTEGRITY_ERROR'].forEach((code, index) => {
  test(`PH-G${17 + index}`, `backend ${code} is preserved`, () => {
    const responseText = JSON.stringify({ success: false, error: { code } });
    const { api } = setup({ responseText });
    assert.strictEqual(api.petHealthGateway_(recordInput()).error.code, code);
  });
});

test('PH-G20', 'fetch failure is unavailable', () => {
  const { api } = setup({ fetchError: new Error('transport details') });
  assert.strictEqual(api.petHealthGateway_(recordInput()).error.code, 'PET_HEALTH_UNAVAILABLE');
});

test('PH-G21', 'malformed response is unavailable', () => {
  const { api } = setup({ responseText: JSON.stringify({ success: true }) });
  assert.strictEqual(api.petHealthGateway_(recordInput()).error.code, 'PET_HEALTH_UNAVAILABLE');
});

test('PH-G22', 'missing configuration is configuration error', () => {
  [
    { HEALTH_WEBAPP_URL: '', HEALTH_SERVICE_TOKEN: SERVER_TOKEN },
    { HEALTH_WEBAPP_URL: 'https://example.invalid/exec', HEALTH_SERVICE_TOKEN: SERVER_TOKEN },
    { HEALTH_WEBAPP_URL: HEALTH_URL, HEALTH_SERVICE_TOKEN: '' },
  ].forEach((properties) => {
    const { api, state } = setup({ properties });
    assert.strictEqual(api.petHealthGateway_(recordInput()).error.code, 'CONFIGURATION_ERROR');
    assert.strictEqual(state.forwarded.length, 0);
  });
});

test('PH-G23', 'unknown Pet operation is fail-closed', () => {
  const { api, state } = setup();
  assert.strictEqual(api.petHealthGateway_({ action: 'pet.health.delete', deviceId: 'x', pairingToken: 'y' }).error.code, 'FORBIDDEN');
  assert.strictEqual(state.forwarded.length, 0);
});

test('PH-G24', 'non-2xx and invalid JSON are unavailable', () => {
  let fixture = setup({ responseCode: 503 });
  assert.strictEqual(fixture.api.petHealthGateway_(recordInput()).error.code, 'PET_HEALTH_UNAVAILABLE');
  fixture = setup({ responseText: '{' });
  assert.strictEqual(fixture.api.petHealthGateway_(recordInput()).error.code, 'PET_HEALTH_UNAVAILABLE');
});

test('PH-G25', 'backend unauthorized is configuration error and unknown errors are hidden', () => {
  let fixture = setup({ responseText: JSON.stringify({ success: false, error: { code: 'UNAUTHORIZED' } }) });
  assert.strictEqual(fixture.api.petHealthGateway_(recordInput()).error.code, 'CONFIGURATION_ERROR');
  fixture = setup({ responseText: JSON.stringify({ success: false, error: { code: 'SPREADSHEET_SECRET' } }) });
  assert.strictEqual(fixture.api.petHealthGateway_(recordInput()).error.code, 'PET_HEALTH_UNAVAILABLE');
});

test('PH-G26', 'trusted internal source is separate from public input', () => {
  const { api, state } = setup();
  const input = recordInput();
  delete input.deviceId;
  delete input.pairingToken;
  assert.strictEqual(api.petHealthGatewayForTrustedActor_(input, state.actor, 'agent').success, true);
  assert.strictEqual(state.forwarded[0].source, 'agent');
});

test('PH-G27', 'Mini dispatch owns pet.health namespace', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'gas', 'Code.js'), 'utf8');
  const body = recordInput();
  let dispatched = null;
  const context = {
    petHealthGateway_: (input) => { dispatched = input; return { gateway: 'pet' }; },
    healthGateway_: () => { throw new Error('Human Health gateway received Pet operation'); },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (text) => ({ text, setMimeType() { return this; } }),
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  assert.deepStrictEqual(context.doPost({ postData: { contents: JSON.stringify(body) } }), { gateway: 'pet' });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(dispatched)), body);
});

test('PH-G28', 'unexpected warnings make a success envelope malformed', () => {
  const { api } = setup({ responseText: JSON.stringify(backendRecord({ warnings: [{ detail: 'private' }] })) });
  assert.strictEqual(api.petHealthGateway_(recordInput()).error.code, 'PET_HEALTH_UNAVAILABLE');
});

test('PH-G29', 'all remaining privileged client fields are rejected', () => {
  ['recordedBy', 'capabilities'].forEach((field) => {
    const { api, state } = setup();
    const result = api.petHealthGateway_(recordInput({ [field]: field === 'capabilities' ? ['pet.health.record'] : 'attacker' }));
    assert.strictEqual(result.error.code, 'INVALID_INPUT');
    assert.strictEqual(state.forwarded.length, 0);
  });
});

test('PH-G30', 'additive water-bottle summary data passes through unchanged', () => {
  const { api } = setup({ responseText: JSON.stringify(backendSummary({
    data: {
      petId: 'popio', localDate: '2026-08-19', timezone: 'Asia/Tokyo', meal: {}, water: {},
      waterBottle: { eventCount: 1, latest: { eventId: 'bottle-1', occurredAt: '2026-08-19T08:00:00+09:00', newFillMl: 400 }, latestInterval: null },
      stool: {}, urine: {}, latestWeight: null, notableObservations: [],
    },
  })) });
  const result = api.petHealthGateway_(summaryInput());
  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(result.data.waterBottle)), { eventCount: 1, latest: { eventId: 'bottle-1', occurredAt: '2026-08-19T08:00:00+09:00', newFillMl: 400 }, latestInterval: null });
});

test('PH-RG01', 'recent events requires pet.health.read', () => {
  const { api, state } = setup({ responseText: JSON.stringify(backendRecent()) });
  assert.strictEqual(api.petHealthGateway_(recentInput()).success, true);
  assert.deepStrictEqual(state.authorizedCapabilities, ['pet.health.read']);
});

test('PH-RG02', 'recent events uses the server-resolved actor', () => {
  const { api, state } = setup({ actor: { homeId: 'resolved-home', memberUserId: 'resolved-member', role: 'guardian', deviceId: 'resolved-device' }, responseText: JSON.stringify(backendRecent()) });
  assert.strictEqual(api.petHealthGateway_(recentInput()).success, true);
  assert.strictEqual(state.forwarded[0].homeId, 'resolved-home');
  assert.strictEqual(state.forwarded[0].actorUserId, 'resolved-member');
  assert.deepStrictEqual(state.resolvedCredentials, [{ deviceId: 'browser-device', pairingToken: 'browser-pairing' }]);
});

test('PH-RG03', 'recent events rejects spoofed identity', () => {
  const { api, state } = setup({ responseText: JSON.stringify(backendRecent()) });
  assert.strictEqual(api.petHealthGateway_(recentInput({ homeId: 'spoofed' })).error.code, 'INVALID_INPUT');
  assert.strictEqual(api.petHealthGateway_(recentInput({ actorUserId: 'spoofed' })).error.code, 'INVALID_INPUT');
  assert.strictEqual(state.forwarded.length, 0);
});

test('PH-RG04', 'recent events forwards the fixed trusted request', () => {
  const { api, state } = setup({ responseText: JSON.stringify(backendRecent()) });
  const result = api.petHealthGateway_(recentInput());
  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(state.forwarded[0], { operation: 'pet.health.listRecentEvents', serviceToken: SERVER_TOKEN, homeId: 'home-server', actorUserId: 'member-server', petId: 'popio', days: 7 });
  assert.strictEqual(Object.hasOwn(result.data.events[0], 'homeId'), false);
});

console.log(`PASS pet health gateway suite (${passed} assertions)`);

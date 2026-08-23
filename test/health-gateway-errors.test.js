'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const context = {
  JSON, Error, String, Object, Array,
  PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => key === 'HEALTH_WEBAPP_URL' ? 'https://script.google.com/macros/s/abc/exec' : 'service-token' }) },
  resolveAuthenticatedActor_: () => ({ homeId: 'home-a', memberUserId: 'second_son', role: 'self_record' }),
  hasRoleCapability_: () => false,
  getActiveSelfRecordMembers_: () => [],
  getHomeMember_: (_homeId, userId) => ({ memberUserId: userId, displayName: userId, status: 'active', role: 'self_record' }),
  authorizeTargetOperation_: () => true,
  UrlFetchApp: { fetch: () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify({ success: false, error: { code: 'IDEMPOTENCY_CONFLICT' } }) }) },
  json_: (value) => value,
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('gas/HealthGatewayService.js', 'utf8'), context);

const response = context.healthGateway_({ action: 'health.weight.correct', deviceId: 'device', pairingToken: 'pairing', targetMemberUserId: 'second_son', recordId: '11111111-1111-4111-8111-111111111111', measuredDate: '2026-08-23', weightKg: 53.2, clientRequestId: '22222222-2222-4222-8222-222222222222' });
assert.strictEqual(response.success, false);
assert.strictEqual(response.error.code, 'IDEMPOTENCY_CONFLICT', 'Mini must preserve a known idempotency conflict from Health GAS');
console.log('PASS Health Gateway preserves idempotency conflicts');

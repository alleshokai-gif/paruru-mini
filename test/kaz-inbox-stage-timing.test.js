'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const inboxSource = fs.readFileSync(path.join(root, 'gas', 'KazOsInbox.js'), 'utf8');
const progressSource = fs.readFileSync(path.join(root, 'gas', 'KazOsProgress.js'), 'utf8');
const codeSource = fs.readFileSync(path.join(root, 'gas', 'Code.js'), 'utf8');
const logs = [];
let nowMs = 1000;
let fetches = 0;
class ClockDate extends Date { static now() { return nowMs; } }
const context = {
  Date: ClockDate, Logger: { log: value => logs.push(String(value)) },
  PropertiesService: { getScriptProperties: () => {
    nowMs += 2;
    return { getProperty: key => {
      nowMs += 1;
      return key === 'KAZ_OS_INBOX_READ_URL' ? 'https://gateway.example/v1/inbox' : 't'.repeat(32);
    } };
  } },
  isKazOsLiveEnabled_: () => true,
  resolveFirebaseAuthenticatedActorForRead_: () => { nowMs += 20; return { role: 'admin' }; },
  authorizeKazOsOwner_: () => {},
  buildKazOsCalendarCapture_: () => { nowMs += 7; return { response: { events: [] } }; },
  buildKazOsTodayPlanningClassifications_: () => { nowMs += 30; return []; },
  buildKazOsTodayPlanningEvidence_: () => { nowMs += 40; return { preferences: [], daily_estimates: [] }; },
  UrlFetchApp: { fetch: () => {
    fetches += 1;
    nowMs += 111;
    return { getResponseCode: () => 200, getContentText: () => '{"inbox_items":[]}' };
  } },
  sanitizeKazOsInbox_: value => { nowMs += 5; return value; },
  applyKazOsDecisionLedger_: value => { nowMs += 25; return value; },
  json_: value => { nowMs += 3; return value; },
  homeMembershipError_: code => Object.assign(new Error(code), { code }),
};
vm.createContext(context);
vm.runInContext(inboxSource, context, { filename: 'gas/KazOsInbox.js' });
vm.runInContext(progressSource, context, { filename: 'gas/KazOsProgress.js' });
context.authorizeKazOsOwner_ = () => {};
context.buildKazOsCalendarCapture_ = () => { nowMs += 7; return { response: { events: [] } }; };
context.sanitizeKazOsInbox_ = value => { nowMs += 5; return value; };

const requestId = '123e4567-e89b-42d3-a456-426614174000';
const trace = context.createKazOsInboxTrace_(requestId);
trace.gas_started_at_ms = 990;
const result = context.kazOsProgress_({ action: 'kazOs.inbox.get' }, trace, null);
assert.equal(result.success, true, result.error && result.error.code);
assert.equal(fetches, 1);
const timingLines = logs.filter(line => line.startsWith('[KAZ_OS_INBOX_TIMING] '));
assert.equal(timingLines.length, 1, 'one safe timing record per request');
const timing = JSON.parse(timingLines[0].slice('[KAZ_OS_INBOX_TIMING] '.length));
assert.deepEqual(Object.keys(timing), ['request_id', 'auth_ms', 'config_ms', 'calendar_ms',
  'decision_ledger_ms', 'gateway_post_ms', 'response_ms', 'gas_total_ms']);
assert.equal(timing.request_id, requestId);
assert.equal(timing.auth_ms, 20);
assert.equal(timing.config_ms, 4);
assert.equal(timing.calendar_ms, 7);
assert.equal(timing.decision_ledger_ms, 95);
assert.equal(timing.gateway_post_ms, 111);
assert.equal(timing.response_ms, 8);
assert.equal(timing.gas_total_ms, nowMs - 990);
for (const secret of ['t'.repeat(32), 'gateway.example', 'admin', 'inbox_items', 'preferences']) {
  assert(!timingLines[0].includes(secret), 'timing log leaked request or configuration data');
}
context.logKazOsInboxTiming_(trace);
assert.equal(logs.filter(line => line.startsWith('[KAZ_OS_INBOX_TIMING] ')).length, 1);
context.recordKazOsInboxTiming_(trace, 'unlisted_ms', 100);
assert(!Object.hasOwn(trace.timing_ms, 'unlisted_ms'));

assert(codeSource.includes('const gasStartedAtMs = Date.now();'));
assert(codeSource.includes('trace.gas_started_at_ms = gasStartedAtMs;'));
assert.match(inboxSource, /const options = \{[\s\S]*?const gatewayStart = Date\.now\(\);\s*try \{\s*response = UrlFetchApp\.fetch\(url, options\);\s*\} finally \{\s*recordKazOsInboxTiming_\(trace, 'gateway_post_ms', Date\.now\(\) - gatewayStart\);/);

logs.length = 0;
fetches = 0;
nowMs = 2000;
context.UrlFetchApp.fetch = () => { fetches += 1; nowMs += 9; throw Error('private transport detail'); };
const failedTrace = context.createKazOsInboxTrace_(requestId);
const failed = context.kazOsProgress_({ action: 'kazOs.inbox.get' }, failedTrace, null);
assert.equal(failed.success, false);
assert.equal(failed.error.code, 'KAZ_SOURCE_FAILED');
assert.equal(fetches, 1, 'failed read was retried');
const failedTiming = logs.filter(line => line.startsWith('[KAZ_OS_INBOX_TIMING] '));
assert.equal(failedTiming.length, 1);
assert.equal(JSON.parse(failedTiming[0].slice('[KAZ_OS_INBOX_TIMING] '.length)).gateway_post_ms, 9);
assert(!failedTiming[0].includes('private transport detail'));

console.log('PASS Kaz OS INBOX isolated stage timings, fetch boundary, and safe log fields');

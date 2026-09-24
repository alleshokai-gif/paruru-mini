'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const diagnostics = read('gas/TransportDiagnostics.js');
const code = read('gas/Code.js');
const actor = read('gas/AuthenticatedActorService.js');
const session = read('gas/PaluruUserAccountService.js');
const progress = read('gas/KazOsProgress.js');
const projects = read('gas/KazOsProjects.js');
const work = read('gas/KazOsWork.js');
const today = read('gas/KazOsToday.js');
const inbox = read('gas/KazOsInbox.js');
const answer = read('gas/KazOsInboxAnswer.js');
const app = read('app.js');

const actionStages = {
  'auth.config.get': [
    'GAS_EXECUTION_START', 'CONFIG_READ_START', 'CONFIG_READ_END', 'RESPONSE_READY'
  ],
  'auth.session.resolve': [
    'GAS_EXECUTION_START', 'FIREBASE_VERIFY_START', 'FIREBASE_VERIFY_END',
    'USER_ACCOUNT_SHEET_START', 'USER_ACCOUNT_SHEET_END',
    'MEMBERSHIP_SHEET_START', 'MEMBERSHIP_SHEET_END', 'ACTOR_RESOLVE_END', 'RESPONSE_READY'
  ],
  'kazOs.projects.get': [
    'GAS_EXECUTION_START', 'AUTH_RESOLVE_START', 'AUTH_RESOLVE_END',
    'CLOUD_RUN_START', 'CLOUD_RUN_END', 'SANITIZE_START', 'SANITIZE_END', 'RESPONSE_READY'
  ],
  'kazOs.work.get': [
    'GAS_EXECUTION_START', 'AUTH_RESOLVE_START', 'AUTH_RESOLVE_END',
    'CLOUD_RUN_START', 'CLOUD_RUN_END', 'SANITIZE_START', 'SANITIZE_END', 'RESPONSE_READY'
  ],
  'kazOs.today.get': [
    'GAS_EXECUTION_START', 'AUTH_RESOLVE_START', 'AUTH_RESOLVE_END',
    'CALENDAR_CAPTURE_START', 'CALENDAR_CAPTURE_END',
    'DECISION_LEDGER_READ_START', 'DECISION_LEDGER_READ_END',
    'CLOUD_RUN_START', 'CLOUD_RUN_END', 'SANITIZE_START', 'SANITIZE_END', 'RESPONSE_READY'
  ],
  'kazOs.inbox.get': [
    'GAS_EXECUTION_START', 'AUTH_RESOLVE_START', 'AUTH_RESOLVE_END',
    'CALENDAR_CAPTURE_START', 'CALENDAR_CAPTURE_END',
    'CLOUD_RUN_START', 'CLOUD_RUN_END', 'SANITIZE_START', 'SANITIZE_END',
    'DECISION_LEDGER_READ_START', 'DECISION_LEDGER_READ_END', 'RESPONSE_READY'
  ],
};

for (const [action, stages] of Object.entries(actionStages)) {
  assert(diagnostics.includes(`'${action}': Object.freeze([`), `${action} stage allowlist missing`);
  let offset = diagnostics.indexOf(`'${action}': Object.freeze([`);
  for (const stage of stages) {
    const next = diagnostics.indexOf(`'${stage}'`, offset);
    assert(next > offset, `${action} stage order missing ${stage}`);
    offset = next;
  }
}

assert(code.includes("recordCodeTransport_(transportTrace, 'GAS_EXECUTION_START'"));
assert(code.includes("recordCodeTransport_(transportTrace, 'CONFIG_READ_START'"));
assert(code.includes("recordCodeTransport_(transportTrace, 'CONFIG_READ_END'"));
assert(code.includes("recordCodeTransport_(transportTrace, 'RESPONSE_READY'"));

for (const stage of [
  'FIREBASE_VERIFY_START', 'FIREBASE_VERIFY_END', 'USER_ACCOUNT_SHEET_START',
  'USER_ACCOUNT_SHEET_END', 'MEMBERSHIP_SHEET_START', 'MEMBERSHIP_SHEET_END', 'ACTOR_RESOLVE_END'
]) assert(actor.includes(`'${stage}'`), `auth stage not wired: ${stage}`);
assert(session.includes("recordAuthTransport_(transportTrace, 'RESPONSE_READY'"));
assert(session.includes("recordAuthTransport_(transportTrace, 'AUTH_SESSION_REJECTED'"));

for (const stage of ['AUTH_RESOLVE_START', 'AUTH_RESOLVE_END', 'SANITIZE_START', 'SANITIZE_END', 'RESPONSE_READY', 'KAZ_READ_FAILED']) {
  assert(progress.includes(`'${stage}'`), `Kaz stage not wired: ${stage}`);
}
for (const source of [projects, work, today, inbox]) {
  assert(source.includes("'CLOUD_RUN_START'"), 'Cloud Run start timing missing');
  assert(source.includes("'CLOUD_RUN_END'"), 'Cloud Run end timing missing');
}
for (const source of [today, inbox]) {
  assert(source.includes("'CALENDAR_CAPTURE_START'") && source.includes("'CALENDAR_CAPTURE_END'"), 'Calendar timing missing');
}
assert(today.includes("'DECISION_LEDGER_READ_START'") && today.includes("'DECISION_LEDGER_READ_END'"));
assert(progress.includes("'DECISION_LEDGER_READ_START'") && progress.includes("'DECISION_LEDGER_READ_END'"));

const forbiddenDiagnosticFields = [
  'idToken', 'providerSubject', 'userId', 'memberUserId', 'calendarId',
  'eventTitle', 'payload', 'responseBody', 'notionContent'
];
const entryBlock = diagnostics.slice(diagnostics.indexOf('const entry = {'), diagnostics.indexOf('try {', diagnostics.indexOf('const entry = {')));
for (const field of forbiddenDiagnosticFields) {
  assert(!entryBlock.includes(field), `private field leaked into stage diagnostic entry: ${field}`);
}
assert(diagnostics.includes("allowedStages.indexOf(safeStage) < 0"), 'stage allowlist is not enforced');
assert(diagnostics.includes('requestIdSuffix: requestId.replace(/-/g, \'\').slice(-8)'), 'request suffix correlation changed');
assert(diagnostics.includes('stageElapsedMs') && diagnostics.includes('cumulativeMs'), 'stage/cumulative timing fields missing');
assert(diagnostics.includes('httpStatusCategory'), 'HTTP status category missing');

assert(progress.includes("recordKazOsTransport_(transportTrace, 'KAZ_READ_FAILED'"), 'Kaz failure terminal stage missing');
assert(session.includes("recordAuthTransport_(transportTrace, 'AUTH_SESSION_REJECTED'"), 'auth failure terminal stage missing');
assert(code.includes("recordCodeTransport_(transportTrace, 'UNHANDLED_FAILURE'"), 'router failure terminal stage missing');

assert(!answer.includes('resolveFirebaseAuthenticatedActorForRead_'), 'write auth behavior changed to read cache');
assert(!app.includes('callHomeControlWriteApiWithRetry_'), 'write retry helper was introduced');
assert((app.match(/callHomeControlReadOnlyApi_/g) || []).length > 0, 'read retry wrapper unexpectedly removed');

const changedRuntimeSources = [diagnostics, code, actor, session, progress, projects, work, today, inbox].join('\n');
assert(!changedRuntimeSources.includes('CacheService.getScriptCache()') || actor.includes('FIREBASE_READ_ACTOR_CACHE_TTL_SECONDS = 8'),
  'observability patch changed the existing bounded actor cache contract');
assert(!changedRuntimeSources.includes('setTimeout('), 'timeout behavior was added to GAS');
assert(!changedRuntimeSources.includes('Utilities.sleep('), 'timing instrumentation blocks request execution');

console.log('PASS GAS latency stage timing allowlist, order, correlation, privacy, and behavior guards');

const MINI_TRANSPORT_DIAGNOSTIC_ACTIONS_ = Object.freeze({
  'auth.config.get': 'auth_read',
  'auth.session.resolve': 'auth_read',
  'kazOs.projects.get': 'kaz_read',
  'kazOs.work.get': 'kaz_read',
  'kazOs.today.get': 'kaz_read',
  'kazOs.inbox.get': 'kaz_read',
  'kazOs.inbox.answer': 'kaz_answer'
});

const MINI_TRANSPORT_DIAGNOSTIC_STAGES_ = Object.freeze({
  'auth.config.get': Object.freeze([
    'GAS_EXECUTION_START', 'CONFIG_READ_START', 'CONFIG_READ_END', 'RESPONSE_READY', 'UNHANDLED_FAILURE'
  ]),
  'auth.session.resolve': Object.freeze([
    'GAS_EXECUTION_START', 'FIREBASE_VERIFY_START', 'FIREBASE_VERIFY_END',
    'USER_ACCOUNT_SHEET_START', 'USER_ACCOUNT_SHEET_END',
    'MEMBERSHIP_SHEET_START', 'MEMBERSHIP_SHEET_END',
    'ACTOR_RESOLVE_END', 'RESPONSE_READY', 'AUTH_SESSION_REJECTED', 'UNHANDLED_FAILURE'
  ]),
  'kazOs.projects.get': Object.freeze([
    'GAS_EXECUTION_START', 'AUTH_RESOLVE_START', 'AUTH_RESOLVE_END',
    'CLOUD_RUN_START', 'CLOUD_RUN_END', 'SANITIZE_START', 'SANITIZE_END',
    'RESPONSE_READY', 'KAZ_READ_FAILED', 'UNHANDLED_FAILURE'
  ]),
  'kazOs.work.get': Object.freeze([
    'GAS_EXECUTION_START', 'AUTH_RESOLVE_START', 'AUTH_RESOLVE_END',
    'CLOUD_RUN_START', 'CLOUD_RUN_END', 'SANITIZE_START', 'SANITIZE_END',
    'RESPONSE_READY', 'KAZ_READ_FAILED', 'UNHANDLED_FAILURE'
  ]),
  'kazOs.today.get': Object.freeze([
    'GAS_EXECUTION_START', 'AUTH_RESOLVE_START', 'AUTH_RESOLVE_END',
    'CALENDAR_CAPTURE_START', 'CALENDAR_CAPTURE_END',
    'DECISION_LEDGER_READ_START', 'DECISION_LEDGER_READ_END',
    'CLOUD_RUN_START', 'CLOUD_RUN_END', 'SANITIZE_START', 'SANITIZE_END',
    'RESPONSE_READY', 'KAZ_READ_FAILED', 'UNHANDLED_FAILURE'
  ]),
  'kazOs.inbox.get': Object.freeze([
    'GAS_EXECUTION_START', 'AUTH_RESOLVE_START', 'AUTH_RESOLVE_END',
    'CALENDAR_CAPTURE_START', 'CALENDAR_CAPTURE_END',
    'CLOUD_RUN_START', 'CLOUD_RUN_END', 'SANITIZE_START', 'SANITIZE_END',
    'DECISION_LEDGER_READ_START', 'DECISION_LEDGER_READ_END',
    'RESPONSE_READY', 'KAZ_READ_FAILED', 'UNHANDLED_FAILURE'
  ]),
  // The Answer path is unchanged. These existing stages remain allowlisted so
  // adding read observability cannot alter write behavior or retry policy.
  'kazOs.inbox.answer': Object.freeze([
    'GAS_EXECUTION_START', 'ACTOR_AUTHORIZED', 'SOURCE_REVALIDATION_STARTED',
    'DURABLE_PERSISTED', 'ANSWER_FAILED', 'UNHANDLED_FAILURE'
  ])
});

function createMiniTransportTrace_(body) {
  const input = body || {};
  const action = String(input.action || '');
  const requestId = String(input.request_id || '').trim().toLowerCase();
  const attempt = Number(input.transport_attempt);
  if (!MINI_TRANSPORT_DIAGNOSTIC_ACTIONS_[action]
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestId)) return null;
  const startedAtMs = Date.now();
  return {
    requestClass: MINI_TRANSPORT_DIAGNOSTIC_ACTIONS_[action],
    action: action,
    requestIdSuffix: requestId.replace(/-/g, '').slice(-8),
    attempt: Number.isInteger(attempt) && attempt >= 1 && attempt <= 2 ? attempt : 1,
    startedAtMs: startedAtMs,
    lastStageAtMs: startedAtMs,
    lastHttpStatus: null
  };
}

function recordMiniTransportTrace_(trace, backendStage, values) {
  if (!trace) return;
  const input = values || {};
  const safeStage = String(backendStage || '').replace(/[^A-Z0-9_]/g, '').slice(0, 80);
  const allowedStages = MINI_TRANSPORT_DIAGNOSTIC_STAGES_[trace.action] || [];
  if (!safeStage || allowedStages.indexOf(safeStage) < 0) return;
  const safeCode = String(input.errorCode || '').replace(/[^A-Z0-9_]/g, '').slice(0, 80) || null;
  const inputHttpStatus = Number(input.httpStatus);
  const httpStatus = Number.isInteger(inputHttpStatus) ? inputHttpStatus : Number(trace.lastHttpStatus);
  if (Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599) trace.lastHttpStatus = httpStatus;
  const nowMs = Date.now();
  const cumulativeMs = Math.min(600000, Math.max(0, nowMs - trace.startedAtMs));
  const stageElapsedMs = Math.min(600000, Math.max(0, nowMs - trace.lastStageAtMs));
  trace.lastStageAtMs = nowMs;
  const validHttpStatus = Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599 ? httpStatus : null;
  const entry = {
    requestClass: trace.requestClass,
    action: trace.action,
    requestIdSuffix: trace.requestIdSuffix,
    attempt: trace.attempt,
    stage: safeStage,
    stageElapsedMs: stageElapsedMs,
    elapsedMs: cumulativeMs,
    cumulativeMs: cumulativeMs,
    classification: ['none', 'http', 'parse', 'business', 'unknown'].indexOf(input.classification) >= 0
      ? input.classification : (safeCode ? 'business' : 'none'),
    httpStatus: validHttpStatus,
    httpStatusCategory: validHttpStatus === null ? null : String(Math.floor(validHttpStatus / 100)) + 'xx',
    backendStage: safeStage,
    buildId: typeof PALURU_MINI_BUILD_ID === 'string' ? PALURU_MINI_BUILD_ID : '',
    outcome: ['progress', 'success', 'unresolved'].indexOf(input.outcome) >= 0
      ? input.outcome : (safeCode ? 'unresolved' : 'success'),
    errorCode: safeCode
  };
  try {
    if (typeof Logger !== 'undefined' && typeof Logger.log === 'function') {
      Logger.log('[PALURU_TRANSPORT] ' + JSON.stringify(entry));
    }
  } catch (_) {
    // Diagnostics never change request handling.
  }
}

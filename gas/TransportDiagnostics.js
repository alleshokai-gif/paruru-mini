const MINI_TRANSPORT_DIAGNOSTIC_ACTIONS_ = Object.freeze({
  'auth.config.get': 'auth_read',
  'auth.session.resolve': 'auth_read',
  'kazOs.projects.get': 'kaz_read',
  'kazOs.work.get': 'kaz_read',
  'kazOs.today.get': 'kaz_read',
  'kazOs.inbox.get': 'kaz_read',
  'kazOs.inbox.answer': 'kaz_answer'
});

function createMiniTransportTrace_(body) {
  const input = body || {};
  const action = String(input.action || '');
  const requestId = String(input.request_id || '').trim().toLowerCase();
  const attempt = Number(input.transport_attempt);
  if (!MINI_TRANSPORT_DIAGNOSTIC_ACTIONS_[action]
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestId)) return null;
  return {
    requestClass: MINI_TRANSPORT_DIAGNOSTIC_ACTIONS_[action],
    action: action,
    requestIdSuffix: requestId.replace(/-/g, '').slice(-8),
    attempt: Number.isInteger(attempt) && attempt >= 1 && attempt <= 2 ? attempt : 1,
    startedAtMs: Date.now()
  };
}

function recordMiniTransportTrace_(trace, backendStage, values) {
  if (!trace) return;
  const input = values || {};
  const safeStage = String(backendStage || '').replace(/[^A-Z0-9_]/g, '').slice(0, 80);
  if (!safeStage) return;
  const safeCode = String(input.errorCode || '').replace(/[^A-Z0-9_]/g, '').slice(0, 80) || null;
  const httpStatus = Number(input.httpStatus);
  const entry = {
    requestClass: trace.requestClass,
    action: trace.action,
    requestIdSuffix: trace.requestIdSuffix,
    attempt: trace.attempt,
    elapsedMs: Math.min(600000, Math.max(0, Date.now() - trace.startedAtMs)),
    classification: ['none', 'http', 'parse', 'business', 'unknown'].indexOf(input.classification) >= 0
      ? input.classification : (safeCode ? 'business' : 'none'),
    httpStatus: Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599 ? httpStatus : null,
    backendStage: safeStage,
    buildId: typeof PALURU_MINI_BUILD_ID === 'string' ? PALURU_MINI_BUILD_ID : '',
    outcome: ['success', 'unresolved'].indexOf(input.outcome) >= 0 ? input.outcome : (safeCode ? 'unresolved' : 'success'),
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

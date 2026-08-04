// Persistent, operator-visible trace ledger for agentChat.  This intentionally
// contains only the allowlisted fields used for incident correlation.
const PALURU_AGENT_TRACE_SHEET_NAME = 'Agent_Trace_Log';
const PALURU_AGENT_TRACE_HEADERS = [
  'recordedAt',
  'source',
  'event',
  'clientRequestIdSuffix',
  'deploymentId',
  'version',
  'action',
  'httpStatus',
  'errorCode',
  'stage',
  'reason',
  'elapsedMs',
  'openAiCallCount',
  'serviceCallCount',
  'intent',
  'service',
  'openAiErrorType',
  'openAiErrorCode',
  'openAiErrorMessage',
  'validationField',
  'validationReason'
];

function persistAgentTrace_(trace) {
  if (!trace || trace.tracePersistAttempted) return;
  trace.tracePersistAttempted = true;
  const entries = collectPersistableAgentTraceEntries_(trace);
  if (!entries.length) return;

  let lock = null;
  try {
    if (typeof SpreadsheetApp === 'undefined' || !SpreadsheetApp.getActiveSpreadsheet) {
      throw new Error('SPREADSHEET_UNAVAILABLE');
    }
    if (typeof LockService !== 'undefined' && LockService.getScriptLock) {
      lock = LockService.getScriptLock();
      lock.waitLock(5000);
    }
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = spreadsheet.getSheetByName(PALURU_AGENT_TRACE_SHEET_NAME)
      || spreadsheet.insertSheet(PALURU_AGENT_TRACE_SHEET_NAME);
    ensureAgentTraceHeaders_(sheet);
    const rows = entries.map(function(entry) {
      return PALURU_AGENT_TRACE_HEADERS.map(function(header) { return entry[header]; });
    });
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, PALURU_AGENT_TRACE_HEADERS.length).setValues(rows);
  } catch (error) {
    logAgentTracePersistenceFailure_(error);
  } finally {
    if (lock) {
      try { lock.releaseLock(); } catch (releaseError) { /* no-op */ }
    }
  }
}

function collectPersistableAgentTraceEntries_(trace) {
  const miniEntries = Array.isArray(trace && trace.entries) ? trace.entries : [];
  const agentEntries = Array.isArray(trace && trace.agentEntries) ? trace.agentEntries : [];
  return miniEntries.map(function(entry) {
    return normalizePersistableAgentTraceEntry_(entry, 'mini');
  }).concat(agentEntries.map(function(entry) {
    return normalizePersistableAgentTraceEntry_(entry, 'agent');
  })).filter(Boolean);
}

function normalizePersistableAgentTraceEntry_(entry, source) {
  const value = entry && typeof entry === 'object' ? entry : null;
  if (!value) return null;
  return {
    recordedAt: new Date().toISOString(),
    source: source === 'agent' ? 'agent' : 'mini',
    event: sanitizeAgentTraceLedgerText_(value.event),
    clientRequestIdSuffix: String(value.clientRequestIdSuffix || '').replace(/[^A-Za-z0-9_-]/g, '').slice(-8),
    deploymentId: sanitizeAgentTraceLedgerText_(value.deploymentId),
    version: sanitizeAgentTraceLedgerText_(value.version),
    action: sanitizeAgentTraceLedgerText_(value.action),
    httpStatus: sanitizeAgentTraceLedgerNumber_(value.httpStatus),
    errorCode: sanitizeAgentTraceLedgerText_(value.errorCode),
    stage: sanitizeAgentTraceLedgerText_(value.stage),
    reason: sanitizeAgentTraceLedgerText_(value.reason),
    elapsedMs: sanitizeAgentTraceLedgerNumber_(value.elapsedMs),
    openAiCallCount: sanitizeAgentTraceLedgerNumber_(value.openAiCallCount),
    serviceCallCount: sanitizeAgentTraceLedgerNumber_(value.serviceCallCount),
    intent: sanitizeAgentTraceLedgerText_(value.intent),
    service: sanitizeAgentTraceLedgerText_(value.service),
    openAiErrorType: sanitizeAgentTraceLedgerText_(value.openAiErrorType),
    openAiErrorCode: sanitizeAgentTraceLedgerText_(value.openAiErrorCode),
    openAiErrorMessage: sanitizeAgentTraceLedgerMessage_(value.openAiErrorMessage),
    validationField: sanitizeAgentTraceValidationField_(value.validationField),
    validationReason: sanitizeAgentTraceValidationReason_(value.validationReason)
  };
}

function ensureAgentTraceHeaders_(sheet) {
  const lastColumn = Math.max(1, sheet.getLastColumn());
  const current = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  const hasExpectedHeaders = PALURU_AGENT_TRACE_HEADERS.every(function(header, index) {
    return current[index] === header;
  });
  if (hasExpectedHeaders) return;

  // Header upgrades are append-only.  A known historical prefix may receive
  // only the missing tail; existing columns and rows are never rewritten.
  let presentHeaders = 0;
  while (presentHeaders < PALURU_AGENT_TRACE_HEADERS.length
    && current[presentHeaders] === PALURU_AGENT_TRACE_HEADERS[presentHeaders]) {
    presentHeaders += 1;
  }
  const hasUnexpectedTail = current.slice(presentHeaders).some(Boolean);
  if (!hasUnexpectedTail) {
    const missingHeaders = PALURU_AGENT_TRACE_HEADERS.slice(presentHeaders);
    if (missingHeaders.length) {
      sheet.getRange(1, presentHeaders + 1, 1, missingHeaders.length).setValues([missingHeaders]);
    }
    return;
  }

  if (sheet.getLastRow() > 0 || current.some(Boolean)) throw new Error('TRACE_SCHEMA_MISMATCH');
  sheet.getRange(1, 1, 1, PALURU_AGENT_TRACE_HEADERS.length).setValues([PALURU_AGENT_TRACE_HEADERS]);
  sheet.setFrozenRows(1);
}

function sanitizeAgentTraceLedgerText_(value) {
  return String(value || '').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 100);
}

function sanitizeAgentTraceLedgerMessage_(value) {
  return String(value || '')
    .replace(/(?:sk|rk)-[A-Za-z0-9_-]{8,}/g, '[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/(?:api[_-]?key|authorization)\s*[:=]\s*[^\s,;]+/gi, '[REDACTED_CREDENTIAL]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 500);
}

function sanitizeAgentTraceValidationField_(value) {
  const allowed = { period: true, scope: true };
  const normalized = String(value || '').trim();
  return allowed[normalized] ? normalized : '';
}

function sanitizeAgentTraceValidationReason_(value) {
  const allowed = {
    TODAY_PARURU_PERIOD_UNSUPPORTED: true,
    TODAY_PARURU_SCOPE_REQUIRED: true
  };
  const normalized = String(value || '').trim();
  return allowed[normalized] ? normalized : '';
}

function sanitizeAgentTraceLedgerNumber_(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : '';
}

function logAgentTracePersistenceFailure_(error) {
  if (typeof Logger === 'undefined' || typeof Logger.log !== 'function') return;
  const reason = sanitizeAgentTraceLedgerText_(error && error.message || 'TRACE_PERSIST_FAILED') || 'TRACE_PERSIST_FAILED';
  Logger.log('[PALURU_TRACE_PERSIST] ' + JSON.stringify({ event: 'TRACE_PERSIST_FAILED', reason: reason }));
}

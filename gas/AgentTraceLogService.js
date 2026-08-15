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
  'validationReason',
  'period',
  'scope',
  'roomId',
  'operation',
  'boundary',
  'boundaryHash',
  'from',
  'field',
  'value',
  'before',
  'after',
  // All fields introduced after the 8/5 boundary-trace schema are append-only.
  // Do not insert fields above this point: Agent_Trace_Log has persisted rows.
  'state',
  'sourceType', 'sourceSystem', 'sourceReason', 'freshness',
  'sourceSelected', 'sourceFallbackUsed', 'sourceObservedAt',
  'sourceRecordCount', 'sourceSelectedCount', 'calendarRecordCount', 'inboxRecordCount',
  'sourceHttpStatus', 'sourceResultCode',
  'actionSource', 'actionResult', 'stateBefore', 'stateAfter',
  'confirmationRoomLabelPresent', 'confirmationSummaryPresent',
  'confirmationRoomLabelValid', 'confirmationSummaryValid',
  // Deployment Trace is append-only. IDs are represented only by four-char
  // suffixes; Apps Script has no trustworthy runtime deployment-version API.
  'miniDeploymentSuffix', 'miniVersion',
  'agentDeploymentSuffix', 'agentVersion',
  'osDeploymentSuffix', 'osVersion',
  'hasActionConfirmation', 'confirmationRequired', 'hasSourceTrace', 'hasActionTrace',
  'osResponseHasActionConfirmation', 'sanitizedHasActionConfirmation', 'returnedHasActionConfirmation',
  'preparedHasFollowupRequired', 'preparedHasActionConfirmation', 'preparedHasSourceTrace', 'preparedHasActionTrace',
  'preparedStatus', 'preparedKeysHash',
  // Build IDs are persisted immediately after preparedKeysHash. Their
  // positions and relative order are immutable; later columns may follow.
  'miniBuildId', 'agentBuildId', 'osBuildId',
  // OS response-shape diagnostics are an append-only tail. They contain only
  // booleans, key-set hashes, and a fixed upstream error-code enum.
  'osResponseSuccess', 'osResponseHasAction', 'osResponseHasData', 'osResponseHasError',
  'osResponseHasDeploymentTrace', 'osResponseKeysHash', 'osResponseDataKeysHash', 'osResponseErrorCode',
  // Phase 1 Tool Calling trace fields are append-only after the persisted
  // 84-column schema. Do not move Build IDs or OS response-shape diagnostics.
  'routerMs', 'serviceMs', 'totalMs', 'modelMs', 'toolMs',
  'toolCallCount', 'toolNames', 'executionPath', 'resultStatus'
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
    validationReason: sanitizeAgentTraceValidationReason_(value.validationReason),
    period: sanitizeAgentTraceLedgerEnum_(value.period, { today: true, tomorrow: true, this_week: true, next_7_days: true }),
    scope: sanitizeAgentTraceLedgerEnum_(value.scope, { mine: true, family: true }),
    roomId: sanitizeAgentTraceLedgerEnum_(value.roomId, { living: true, bedroom: true, kids_room: true, outside: true }),
    operation: sanitizeAgentTraceLedgerEnum_(value.operation, { power: true, apply_settings: true, pause: true, resume: true }),
    state: sanitizeAgentTraceLedgerEnum_(value.state, { OFF: true, ON: true, COOL: true, HEAT: true, AUTO: true, UNKNOWN: true }),
    boundary: sanitizeAgentTraceLedgerEnum_(value.boundary, { OpenAI: true, Canonical: true, Router: true, Service: true, Adapter: true }),
    boundaryHash: /^[a-f0-9]{8}$/i.test(String(value.boundaryHash || '')) ? String(value.boundaryHash).toLowerCase() : '',
    from: sanitizeAgentTraceLedgerEnum_(value.from, { OpenAI: true, Canonical: true, Router: true, Service: true, Adapter: true }),
    field: sanitizeAgentTraceLedgerEnum_(value.field, { period: true, scope: true, roomId: true, operation: true }),
    value: sanitizeAgentTraceLedgerBoundaryValue_(value.value),
    before: sanitizeAgentTraceLedgerBoundaryValue_(value.before),
    after: sanitizeAgentTraceLedgerBoundaryValue_(value.after),
    sourceType: sanitizeAgentTraceLedgerEnum_(value.sourceType, { observed: true, forecast: true, calendar: true, inbox: true, calendar_inbox: true, device_state: true, generated: true, none: true }),
    sourceSystem: sanitizeAgentTraceLedgerEnum_(value.sourceSystem, { switchbot: true, mini_weather: true, google_calendar: true, mini_inbox: true, automation: true, paluru_agent: true, unknown: true }),
    sourceReason: sanitizeAgentTraceLedgerEnum_(value.sourceReason, { primary: true, fallback: true, unavailable: true, stale: true, invalid: true, not_applicable: true }),
    freshness: sanitizeAgentTraceLedgerEnum_(value.freshness, { current: true, stale: true, unknown: true, not_applicable: true }),
    sourceSelected: sanitizeAgentTraceLedgerEnum_(value.sourceSelected, { switchbot_observed: true, forecast_fallback: true, forecast: true, weather_unavailable: true, room_climate: true, room_not_found: true, climate_invalid_response: true, today_paruru_aggregate: true, aircon_status: true, confirmation_created: true, followup_required: true, outside_not_allowed: true, confirmation_executed: true, confirmation_rejected: true }),
    sourceFallbackUsed: value.sourceFallbackUsed === true,
    sourceObservedAt: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/.test(String(value.sourceObservedAt || '')) ? String(value.sourceObservedAt) : '',
    sourceRecordCount: sanitizeAgentTraceLedgerNumber_(value.sourceRecordCount),
    sourceSelectedCount: sanitizeAgentTraceLedgerNumber_(value.sourceSelectedCount),
    calendarRecordCount: sanitizeAgentTraceLedgerNumber_(value.calendarRecordCount),
    inboxRecordCount: sanitizeAgentTraceLedgerNumber_(value.inboxRecordCount),
    sourceHttpStatus: sanitizeAgentTraceLedgerNumber_(value.sourceHttpStatus),
    sourceResultCode: sanitizeAgentTraceLedgerEnum_(value.sourceResultCode, { OK: true, WEATHER_UNAVAILABLE: true, ROOM_NOT_FOUND: true, UPSTREAM_INVALID_RESPONSE: true, ACTION_NOT_ALLOWED: true, FOLLOWUP_REQUIRED: true, CONFIRMATION_EXPIRED: true, CONFIRMATION_ACTOR_MISMATCH: true, UPSTREAM_HTTP_ERROR: true, UPSTREAM_BUSINESS_ERROR: true, NO_AVAILABLE_ROOMS: true, INVALID_RESPONSE_SHAPE: true })
    ,actionSource: sanitizeAgentTraceLedgerEnum_(value.actionSource, { confirmation_created: true, confirmation_executed: true, confirmation_rejected: true, followup_required: true, room_not_found: true, outside_not_allowed: true })
    ,actionResult: sanitizeAgentTraceLedgerEnum_(value.actionResult, { OK: true, ACTION_NOT_ALLOWED: true, FOLLOWUP_REQUIRED: true, CONFIRMATION_EXPIRED: true, CONFIRMATION_ACTOR_MISMATCH: true })
    ,stateBefore: sanitizeAgentTraceLedgerEnum_(value.stateBefore, { OFF: true, ON: true, COOL: true, HEAT: true, AUTO: true, UNKNOWN: true })
    ,stateAfter: sanitizeAgentTraceLedgerEnum_(value.stateAfter, { OFF: true, ON: true, COOL: true, HEAT: true, AUTO: true, UNKNOWN: true })
    ,confirmationRoomLabelPresent: sanitizeAgentTraceLedgerBoolean_(value.confirmationRoomLabelPresent)
    ,confirmationSummaryPresent: sanitizeAgentTraceLedgerBoolean_(value.confirmationSummaryPresent)
    ,confirmationRoomLabelValid: sanitizeAgentTraceLedgerBoolean_(value.confirmationRoomLabelValid)
    ,confirmationSummaryValid: sanitizeAgentTraceLedgerBoolean_(value.confirmationSummaryValid)
    ,miniDeploymentSuffix: sanitizeAgentTraceLedgerDeploymentSuffix_(value.miniDeploymentSuffix)
    ,miniVersion: null
    ,agentDeploymentSuffix: sanitizeAgentTraceLedgerDeploymentSuffix_(value.agentDeploymentSuffix)
    ,agentVersion: null
    ,osDeploymentSuffix: sanitizeAgentTraceLedgerDeploymentSuffix_(value.osDeploymentSuffix)
    ,osVersion: null
    ,miniBuildId: sanitizeAgentTraceLedgerBuildId_(value.miniBuildId)
    ,agentBuildId: sanitizeAgentTraceLedgerBuildId_(value.agentBuildId)
    ,osBuildId: sanitizeAgentTraceLedgerBuildId_(value.osBuildId)
    ,hasActionConfirmation: sanitizeAgentTraceLedgerBoolean_(value.hasActionConfirmation)
    ,confirmationRequired: sanitizeAgentTraceLedgerBoolean_(value.confirmationRequired)
    ,hasSourceTrace: sanitizeAgentTraceLedgerBoolean_(value.hasSourceTrace)
    ,hasActionTrace: sanitizeAgentTraceLedgerBoolean_(value.hasActionTrace)
    ,osResponseHasActionConfirmation: sanitizeAgentTraceLedgerBoolean_(value.osResponseHasActionConfirmation)
    ,sanitizedHasActionConfirmation: sanitizeAgentTraceLedgerBoolean_(value.sanitizedHasActionConfirmation)
    ,returnedHasActionConfirmation: sanitizeAgentTraceLedgerBoolean_(value.returnedHasActionConfirmation)
    ,preparedHasFollowupRequired: sanitizeAgentTraceLedgerBoolean_(value.preparedHasFollowupRequired)
    ,preparedHasActionConfirmation: sanitizeAgentTraceLedgerBoolean_(value.preparedHasActionConfirmation)
    ,preparedHasSourceTrace: sanitizeAgentTraceLedgerBoolean_(value.preparedHasSourceTrace)
    ,preparedHasActionTrace: sanitizeAgentTraceLedgerBoolean_(value.preparedHasActionTrace)
    ,preparedStatus: sanitizeAgentTraceLedgerEnum_(value.preparedStatus, { FOLLOWUP_REQUIRED: true, CONFIRMATION_READY: true, TRACE_ONLY: true, EMPTY: true, INVALID: true })
    ,preparedKeysHash: /^[a-f0-9]{8}$/i.test(String(value.preparedKeysHash || '')) ? String(value.preparedKeysHash).toLowerCase() : ''
    ,osResponseSuccess: sanitizeAgentTraceLedgerBoolean_(value.osResponseSuccess)
    ,osResponseHasAction: sanitizeAgentTraceLedgerBoolean_(value.osResponseHasAction)
    ,osResponseHasData: sanitizeAgentTraceLedgerBoolean_(value.osResponseHasData)
    ,osResponseHasError: sanitizeAgentTraceLedgerBoolean_(value.osResponseHasError)
    ,osResponseHasDeploymentTrace: sanitizeAgentTraceLedgerBoolean_(value.osResponseHasDeploymentTrace)
    ,osResponseKeysHash: sanitizeAgentTraceLedgerHash_(value.osResponseKeysHash)
    ,osResponseDataKeysHash: sanitizeAgentTraceLedgerHash_(value.osResponseDataKeysHash)
    ,osResponseErrorCode: sanitizeAgentTraceLedgerOsErrorCode_(value.osResponseErrorCode)
    ,routerMs: sanitizeAgentTraceLedgerNumber_(value.routerMs)
    ,serviceMs: sanitizeAgentTraceLedgerNumber_(value.serviceMs)
    ,totalMs: sanitizeAgentTraceLedgerNumber_(value.totalMs)
    ,modelMs: sanitizeAgentTraceLedgerNumber_(value.modelMs)
    ,toolMs: sanitizeAgentTraceLedgerNumber_(value.toolMs)
    ,toolCallCount: sanitizeAgentTraceLedgerNonNegativeInteger_(value.toolCallCount)
    ,toolNames: sanitizeAgentTraceLedgerToolNames_(value.toolNames)
    ,executionPath: sanitizeAgentTraceLedgerEnum_(value.executionPath, { tool_calling: true, legacy_router: true })
    ,resultStatus: sanitizeAgentTraceLedgerEnum_(value.resultStatus, {
      SUCCESS: true, STALE: true, PARTIAL: true, NO_OP: true, FOLLOWUP_REQUIRED: true,
      INVALID_INPUT: true, FORBIDDEN: true, NOT_FOUND: true, UNAVAILABLE: true, UPSTREAM_ERROR: true
    })
  };
}

function sanitizeAgentTraceLedgerEnum_(value, allowed) {
  const normalized = String(value || '').trim();
  return allowed[normalized] ? normalized : '';
}

function sanitizeAgentTraceLedgerBoolean_(value) {
  return typeof value === 'boolean' ? value : '';
}

function sanitizeAgentTraceLedgerHash_(value) {
  const hash = String(value || '');
  return /^[a-f0-9]{8}$/i.test(hash) ? hash.toLowerCase() : '';
}

function sanitizeAgentTraceLedgerOsErrorCode_(value) {
  const code = String(value || '').trim();
  return {
    INVALID_COMMAND_INPUT: true,
    INVALID_INPUT: true,
    FOLLOWUP_REQUIRED: true,
    ACTION_NOT_ALLOWED: true,
    CONFIGURATION_ERROR: true,
    UNSUPPORTED_COMMAND: true,
    AUTOMATION_UPSTREAM_ERROR: true,
    AIRCON_UPSTREAM_UNAVAILABLE: true,
    AIRCON_UPSTREAM_HTTP_ERROR: true,
    AIRCON_UPSTREAM_INVALID_RESPONSE: true,
    AIRCON_PREVIEW_INVALID_RESPONSE: true,
    UNAUTHORIZED: true,
    ROOM_NOT_FOUND: true,
    INTERNAL_ERROR: true
  }[code] ? code : '';
}

function sanitizeAgentTraceLedgerDeploymentSuffix_(value) {
  const suffix = String(value || '').trim();
  return /^[A-Za-z0-9_-]{4}$/.test(suffix) ? suffix : '';
}

function sanitizeAgentTraceLedgerBuildId_(value) {
  const buildId = String(value || '').trim();
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(buildId) ? buildId : '';
}

function sanitizeAgentTraceLedgerBoundaryValue_(value) {
  const normalized = String(value || '').trim();
  return {
    today: true, tomorrow: true, this_week: true, next_7_days: true,
    mine: true, family: true, living: true, bedroom: true, kids_room: true,
    outside: true, power: true, apply_settings: true, pause: true, resume: true
  }[normalized] ? normalized : '';
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
  // Mirrors PALURU_VALIDATION_FIELDS in paluru-agent/gas/Code.js.  These are
  // fixed field names, never caller-provided paths.
  const allowed = {
    intent: true, confidence: true, roomId: true, period: true, scope: true, operation: true,
    settings: true, 'settings.power': true, 'settings.mode': true, 'settings.fan': true,
    'settings.setpointC': true, 'settings.durationMinutes': true, overrideMinutes: true,
    needsFollowup: true, followupQuestion: true, reply: true
  };
  const normalized = String(value || '').trim();
  return allowed[normalized] ? normalized : '';
}

function sanitizeAgentTraceValidationReason_(value) {
  const allowed = {
    TODAY_PARURU_PERIOD_UNSUPPORTED: true,
    TODAY_PARURU_SCOPE_REQUIRED: true,
    CONTRACT_OBJECT_INVALID: true,
    CONTRACT_FIELDS_INVALID: true,
    INTENT_INVALID: true,
    CONFIDENCE_INVALID: true,
    ENUM_INVALID: true,
    TEXT_INVALID: true,
    NEEDS_FOLLOWUP_INVALID: true,
    FOLLOWUP_CONTRACT_INVALID: true,
    SETTINGS_OBJECT_INVALID: true,
    SETTINGS_FIELDS_INVALID: true,
    SETTINGS_VALUE_INVALID: true,
    UNUSED_FIELD_NOT_NULL: true,
    WEATHER_PERIOD_UNSUPPORTED: true,
    WEATHER_ROOM_REQUIRED: true,
    ROOM_REQUIRED: true,
    OPERATION_REQUIRED: true,
    SETTINGS_REQUIRED: true,
    OUTSIDE_NOT_ALLOWED: true,
    OPERATION_UNSUPPORTED: true,
    ROOM_NOT_FOUND: true,
    OVERRIDE_MINUTES_INVALID: true,
    POWER_REQUIRED: true,
    POWER_SETTINGS_CONFLICT: true,
    MODE_INVALID: true,
    FAN_INVALID: true,
    SETPOINT_REQUIRED: true,
    SETPOINT_NOT_ALLOWED: true,
    DURATION_REQUIRED: true,
    DURATION_NOT_ALLOWED: true
  };
  const normalized = String(value || '').trim();
  return allowed[normalized] ? normalized : '';
}

function sanitizeAgentTraceLedgerNumber_(value) {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return '';
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : '';
}

function sanitizeAgentTraceLedgerNonNegativeInteger_(value) {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return '';
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : '';
}

function sanitizeAgentTraceLedgerToolNames_(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const allowed = {
    'weather.getForecast': true,
    'calendar.listEvents': true,
    'home.climate.get': true,
    'home.aircon.getState': true,
    'home.aircon.prepareAction': true
  };
  return text.split('|').slice(0, 3).map(function(name) {
    const normalized = String(name || '').trim();
    return allowed[normalized] ? normalized : 'invalid_tool';
  }).join('|');
}

function logAgentTracePersistenceFailure_(error) {
  if (typeof Logger === 'undefined' || typeof Logger.log !== 'function') return;
  const reason = sanitizeAgentTraceLedgerText_(error && error.message || 'TRACE_PERSIST_FAILED') || 'TRACE_PERSIST_FAILED';
  Logger.log('[PALURU_TRACE_PERSIST] ' + JSON.stringify({ event: 'TRACE_PERSIST_FAILED', reason: reason }));
}

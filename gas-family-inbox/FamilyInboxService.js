const FAMILY_INBOX_SCHEMA_VERSION = 'family-inbox-1.0';
const FAMILY_INBOX_SHEET_NAME = 'Family_Inbox';
const FAMILY_INBOX_TIME_ZONE = 'Asia/Tokyo';
const FAMILY_INBOX_MAX_FILE_BYTES = 5 * 1024 * 1024;
const FAMILY_INBOX_MAX_NOTE_CHARACTERS = 500;
const FAMILY_INBOX_MAX_ORIGINAL_NAME_CHARACTERS = 180;
const FAMILY_INBOX_PROPERTIES = Object.freeze({
  rawFolderId: 'FAMILY_INBOX_RAW_FOLDER_ID',
  spreadsheetId: 'FAMILY_INBOX_LEDGER_SPREADSHEET_ID',
  serviceToken: 'FAMILY_INBOX_SERVICE_TOKEN',
});
const FAMILY_INBOX_LEGACY_HEADERS = Object.freeze([
  'schemaVersion', 'inboxId', 'homeId', 'clientRequestId', 'receivedAt', 'updatedAt',
  'source', 'submittedByMemberId', 'subjectMemberHint', 'userNote', 'originalName',
  'mediaType', 'sizeBytes', 'originalRef', 'sha256', 'status', 'attemptCount',
  'processingStartedAt', 'processingCompletedAt', 'claimedBy', 'claimVersion',
  'leaseExpiresAt', 'retryable', 'nextAttemptAt', 'errorCode', 'duplicateOfInboxId',
]);
const FAMILY_INBOX_HEADERS = Object.freeze(FAMILY_INBOX_LEGACY_HEADERS.concat(['processingProfile']));
const FAMILY_INBOX_MEDIA = Object.freeze({
  'image/jpeg': Object.freeze({ extension: 'jpg', signature: Object.freeze([0xff, 0xd8, 0xff]) }),
  'image/png': Object.freeze({ extension: 'png', signature: Object.freeze([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) }),
  'application/pdf': Object.freeze({ extension: 'pdf', signature: Object.freeze([0x25, 0x50, 0x44, 0x46, 0x2d]) }),
});
const FAMILY_INBOX_SAFE_ERRORS = Object.freeze({
  INVALID_INPUT: true,
  UNSUPPORTED_MEDIA_TYPE: true,
  FILE_TOO_LARGE: true,
  INVALID_FILE_SIGNATURE: true,
  INVALID_MEMBER: true,
  FORBIDDEN: true,
  DUPLICATE_REQUEST: true,
  STORAGE_ERROR: true,
  LEDGER_ERROR: true,
  CONFIGURATION_ERROR: true,
  CLAIM_NOT_FOUND: true,
  CLAIM_CONFLICT: true,
  CLAIM_EXPIRED: true,
  SOURCE_READ_ERROR: true,
  INVALID_CANDIDATE: true,
  IDEMPOTENCY_CONFLICT: true,
  NOT_FOUND: true,
  REVISION_CONFLICT: true,
  INVALID_STATE: true,
  DATA_INTEGRITY_ERROR: true,
  SERVICE_UNAVAILABLE: true,
  UNSUPPORTED_DOCUMENT: true,
  AI_PROVIDER_ERROR: true,
  AI_TIMEOUT: true,
  INVALID_AI_OUTPUT: true,
  PROMPT_INJECTION_REJECTED: true,
  INTERNAL_ERROR: true,
});

function familyInboxSubmit_(body) {
  const startedAt = Date.now();
  let trace = familyInboxTraceFromBody_(body, 'familyInbox.submit');
  try {
    familyInboxAuthenticate_(body);
    const input = familyInboxValidateSubmit_(body);
    trace = Object.assign(trace, { mediaType: input.mediaType, sizeBytes: input.bytes.length, sha256Prefix: input.sha256.slice(0, 12) });
    return familyInboxPersistInput_(input, 'paluru', trace, startedAt);
  } catch (error) {
    familyInboxLog_(Object.assign(trace, { stage: 'failed', status: 'failed', errorCode: familyInboxSafeErrorCode_(error), durationMs: Date.now() - startedAt }));
    throw error;
  }
}

function familyInboxPersistInput_(input, source, trace, startedAt) {
  const normalizedSource = String(source || '').trim();
  if (normalizedSource !== 'paluru' && normalizedSource !== 'drive_drop') throw familyInboxError_('INVALID_INPUT');
  const processingProfile = familyInboxResolveProcessingProfile_(normalizedSource, input);
  const config = familyInboxLoadConfig_();
  let lock;
  try {
    lock = LockService.getScriptLock();
    lock.waitLock(30000);
    const sheetState = familyInboxOpenLedger_(config.spreadsheetId);

    const existing = familyInboxFindRow_(sheetState, function(row) {
      return row.homeId === input.homeId && row.clientRequestId === input.clientRequestId;
    });
    if (existing) {
      const originalNameMatches = normalizedSource === 'drive_drop' || existing.originalName === input.originalName;
      if (existing.sha256 !== input.sha256 || existing.source !== normalizedSource || existing.submittedByMemberId !== input.submittedByMemberId || existing.subjectMemberHint !== input.subjectMemberId || existing.userNote !== input.userNote || !originalNameMatches || existing.mediaType !== input.mediaType) {
        throw familyInboxError_('DUPLICATE_REQUEST');
      }
      const replay = familyInboxPublicSubmitResult_(existing, true);
      familyInboxLog_(Object.assign(trace, { inboxId: replay.inboxId, stage: 'completed', status: replay.status, durationMs: Date.now() - startedAt }));
      return replay;
    }

    const duplicate = familyInboxFindRow_(sheetState, function(row) {
      return row.homeId === input.homeId && row.sha256 === input.sha256;
    });
    const inboxId = familyInboxNewInboxId_();
    const now = familyInboxNow_();
    const status = duplicate ? 'duplicate' : 'pending';
    const storedName = inboxId + '.' + FAMILY_INBOX_MEDIA[input.mediaType].extension;
    let createdFile;
    try {
      const folder = DriveApp.getFolderById(config.rawFolderId);
      createdFile = folder.createFile(Utilities.newBlob(input.bytes, input.mediaType, storedName));
    } catch (_) {
      throw familyInboxError_('STORAGE_ERROR');
    }

    const record = {
      schemaVersion: FAMILY_INBOX_SCHEMA_VERSION,
      inboxId: inboxId,
      homeId: input.homeId,
      clientRequestId: input.clientRequestId,
      receivedAt: now,
      updatedAt: now,
      source: normalizedSource,
      submittedByMemberId: input.submittedByMemberId,
      subjectMemberHint: input.subjectMemberId,
      userNote: input.userNote,
      originalName: input.originalName,
      mediaType: input.mediaType,
      sizeBytes: input.bytes.length,
      originalRef: String(createdFile.getId()),
      sha256: input.sha256,
      status: status,
      attemptCount: 0,
      processingStartedAt: '',
      processingCompletedAt: '',
      claimedBy: '',
      claimVersion: '',
      leaseExpiresAt: '',
      retryable: false,
      nextAttemptAt: '',
      errorCode: '',
      duplicateOfInboxId: duplicate ? duplicate.inboxId : '',
      processingProfile: processingProfile,
    };

    try {
      familyInboxAppendRecord_(sheetState, record);
    } catch (_) {
      try { createdFile.setTrashed(true); } catch (cleanupError) {
        familyInboxLog_(Object.assign(trace, { inboxId: inboxId, stage: 'orphan_cleanup_failed', status: 'failed', errorCode: 'LEDGER_ERROR', durationMs: Date.now() - startedAt }));
      }
      throw familyInboxError_('LEDGER_ERROR');
    }

    const result = familyInboxPublicSubmitResult_(record, false);
    familyInboxLog_(Object.assign(trace, { inboxId: inboxId, stage: 'completed', status: status, durationMs: Date.now() - startedAt }));
    return result;
  } finally {
    if (lock) {
      try { lock.releaseLock(); } catch (_) {}
    }
  }
}

function familyInboxResolveProcessingProfile_(source, input) {
  if (source === 'drive_drop' && input && input.mediaType === 'application/pdf') return 'school-v1-long';
  if (source === 'paluru') return 'school-v1';
  throw familyInboxError_('CONFIGURATION_ERROR');
}

function familyInboxGetStatus_(body) {
  const startedAt = Date.now();
  const trace = familyInboxTraceFromBody_(body, 'familyInbox.getStatus');
  try {
    familyInboxAuthenticate_(body);
    const allowed = { operation: true, internalToken: true, homeId: true, inboxId: true, traceId: true };
    if (!familyInboxPlainObject_(body) || Object.keys(body).some(function(key) { return !allowed[key]; })) throw familyInboxError_('INVALID_INPUT');
    const homeId = familyInboxRequiredIdentifier_(body.homeId);
    const inboxId = String(body.inboxId || '').trim();
    if (!/^inb_[0-9a-f]{32}$/i.test(inboxId)) throw familyInboxError_('INVALID_INPUT');
    const config = familyInboxLoadConfig_();
    const sheetState = familyInboxOpenLedger_(config.spreadsheetId);
    const record = familyInboxFindRow_(sheetState, function(row) { return row.inboxId === inboxId && row.homeId === homeId; });
    if (!record) throw familyInboxError_('FORBIDDEN');
    const result = {
      inboxId: record.inboxId,
      status: record.status,
      receivedAt: record.receivedAt,
      updatedAt: record.updatedAt,
      errorCode: record.errorCode || '',
      duplicateOfInboxId: record.duplicateOfInboxId || '',
    };
    familyInboxLog_(Object.assign(trace, { inboxId: inboxId, stage: 'completed', status: result.status, durationMs: Date.now() - startedAt }));
    return result;
  } catch (error) {
    familyInboxLog_(Object.assign(trace, { stage: 'failed', status: 'failed', errorCode: familyInboxSafeErrorCode_(error), durationMs: Date.now() - startedAt }));
    throw error;
  }
}

function familyInboxAuthenticate_(body) {
  const properties = PropertiesService.getScriptProperties();
  const expected = String(properties.getProperty(FAMILY_INBOX_PROPERTIES.serviceToken) || '');
  if (!expected) throw familyInboxError_('CONFIGURATION_ERROR');
  const actual = String(body && body.internalToken || '');
  if (!actual || !familyInboxConstantTimeEquals_(expected, actual)) throw familyInboxError_('FORBIDDEN');
}

function familyInboxValidateSubmit_(body) {
  const allowed = {
    operation: true, internalToken: true, clientRequestId: true, subjectMemberId: true,
    userNote: true, file: true, homeId: true, submittedByMemberId: true, source: true, traceId: true,
  };
  if (!familyInboxPlainObject_(body) || Object.keys(body).some(function(key) { return !allowed[key]; })) throw familyInboxError_('INVALID_INPUT');
  if (body.operation !== 'familyInbox.submit' || body.source !== 'paluru' || !familyInboxPlainObject_(body.file)) throw familyInboxError_('INVALID_INPUT');
  const clientRequestId = String(body.clientRequestId || '').trim();
  if (!familyInboxUuid_(clientRequestId)) throw familyInboxError_('INVALID_INPUT');
  const homeId = familyInboxRequiredIdentifier_(body.homeId);
  const submittedByMemberId = familyInboxRequiredIdentifier_(body.submittedByMemberId);
  const subjectMemberId = familyInboxRequiredIdentifier_(body.subjectMemberId);
  const userNote = String(body.userNote || '').trim();
  if (Array.from(userNote).length > FAMILY_INBOX_MAX_NOTE_CHARACTERS) throw familyInboxError_('INVALID_INPUT');
  const originalName = familyInboxSanitizeOriginalName_(body.file.name);
  const mediaType = String(body.file.mediaType || '').trim().toLowerCase();
  if (!FAMILY_INBOX_MEDIA[mediaType]) throw familyInboxError_('UNSUPPORTED_MEDIA_TYPE');
  const base64 = String(body.file.base64 || '');
  const bytes = familyInboxDecodeBase64_(base64);
  if (!bytes.length) throw familyInboxError_('INVALID_INPUT');
  if (bytes.length > FAMILY_INBOX_MAX_FILE_BYTES) throw familyInboxError_('FILE_TOO_LARGE');
  familyInboxValidateSignature_(mediaType, bytes);
  const sha256 = familyInboxSha256_(bytes);
  return { clientRequestId: clientRequestId, homeId: homeId, submittedByMemberId: submittedByMemberId, subjectMemberId: subjectMemberId, userNote: userNote, originalName: originalName, mediaType: mediaType, bytes: bytes, sha256: sha256 };
}

function familyInboxDecodeBase64_(value) {
  const base64 = String(value || '');
  if (!base64 || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw familyInboxError_('INVALID_INPUT');
  const padding = (base64.match(/=*$/) || [''])[0].length;
  const estimatedBytes = (base64.length * 3 / 4) - padding;
  if (estimatedBytes > FAMILY_INBOX_MAX_FILE_BYTES) throw familyInboxError_('FILE_TOO_LARGE');
  try { return Utilities.base64Decode(base64); } catch (_) { throw familyInboxError_('INVALID_INPUT'); }
}

function familyInboxValidateSignature_(mediaType, bytes) {
  const signature = FAMILY_INBOX_MEDIA[mediaType].signature;
  if (bytes.length < signature.length || signature.some(function(expected, index) { return (Number(bytes[index]) & 0xff) !== expected; })) {
    throw familyInboxError_('INVALID_FILE_SIGNATURE');
  }
}

function familyInboxSha256_(bytes) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes).map(function(value) {
    return ('0' + (Number(value) & 0xff).toString(16)).slice(-2);
  }).join('');
}

function familyInboxSanitizeOriginalName_(value) {
  let name = String(value || '').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_').trim();
  name = Array.from(name).slice(0, FAMILY_INBOX_MAX_ORIGINAL_NAME_CHARACTERS).join('');
  if (!name || name === '.' || name === '..') throw familyInboxError_('INVALID_INPUT');
  return name;
}

function familyInboxLoadConfig_() {
  const properties = PropertiesService.getScriptProperties();
  const config = {
    rawFolderId: String(properties.getProperty(FAMILY_INBOX_PROPERTIES.rawFolderId) || '').trim(),
    spreadsheetId: String(properties.getProperty(FAMILY_INBOX_PROPERTIES.spreadsheetId) || '').trim(),
  };
  if (!config.rawFolderId || !config.spreadsheetId) throw familyInboxError_('CONFIGURATION_ERROR');
  return config;
}

function familyInboxOpenLedger_(spreadsheetId) {
  let sheet;
  try { sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName(FAMILY_INBOX_SHEET_NAME); } catch (_) { throw familyInboxError_('CONFIGURATION_ERROR'); }
  if (!sheet || sheet.getLastRow() < 1 || sheet.getLastColumn() < 1) throw familyInboxError_('CONFIGURATION_ERROR');
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function(value) { return String(value || '').trim(); });
  if (FAMILY_INBOX_HEADERS.some(function(header) { return headers.indexOf(header) < 0; }) || headers.some(function(header, index) { return !header || headers.indexOf(header) !== index; })) throw familyInboxError_('CONFIGURATION_ERROR');
  return { sheet: sheet, headers: headers };
}

function familyInboxFindRow_(sheetState, predicate) {
  const lastRow = sheetState.sheet.getLastRow();
  if (lastRow <= 1) return null;
  const values = sheetState.sheet.getRange(2, 1, lastRow - 1, sheetState.headers.length).getValues();
  for (let rowIndex = 0; rowIndex < values.length; rowIndex++) {
    const row = sheetState.headers.reduce(function(record, header, index) { record[header] = values[rowIndex][index]; return record; }, {});
    if (predicate(row)) return row;
  }
  return null;
}

function familyInboxAppendRecord_(sheetState, record) {
  sheetState.sheet.appendRow(sheetState.headers.map(function(header) { return Object.prototype.hasOwnProperty.call(record, header) ? record[header] : ''; }));
}

function familyInboxPublicSubmitResult_(record, replayed) {
  return {
    inboxId: String(record.inboxId || ''),
    status: String(record.status || ''),
    idempotency: { replayed: replayed === true },
    duplicateOfInboxId: String(record.duplicateOfInboxId || ''),
  };
}

function familyInboxRequiredIdentifier_(value) {
  const normalized = String(value || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(normalized)) throw familyInboxError_('INVALID_INPUT');
  return normalized;
}

function familyInboxUuid_(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function familyInboxNewInboxId_() {
  return 'inb_' + String(Utilities.getUuid()).replace(/-/g, '').toLowerCase();
}

function familyInboxNow_() {
  return Utilities.formatDate(new Date(), FAMILY_INBOX_TIME_ZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function familyInboxConstantTimeEquals_(expected, actual) {
  const length = Math.max(expected.length, actual.length);
  let difference = expected.length ^ actual.length;
  for (let index = 0; index < length; index++) {
    difference |= (expected.charCodeAt(index % Math.max(expected.length, 1)) || 0) ^ (actual.charCodeAt(index % Math.max(actual.length, 1)) || 0);
  }
  return difference === 0;
}

function familyInboxPlainObject_(value) {
  return Boolean(value) && Object.prototype.toString.call(value) === '[object Object]';
}

function familyInboxError_(code) {
  const error = new Error(String(code || 'INTERNAL_ERROR'));
  error.code = String(code || 'INTERNAL_ERROR');
  return error;
}

function familyInboxSafeErrorCode_(error) {
  return error && FAMILY_INBOX_SAFE_ERRORS[error.code] ? error.code : 'INTERNAL_ERROR';
}

function familyInboxErrorEnvelope_(error) {
  const code = familyInboxSafeErrorCode_(error);
  const rejected = ['INVALID_INPUT', 'UNSUPPORTED_MEDIA_TYPE', 'FILE_TOO_LARGE', 'INVALID_FILE_SIGNATURE', 'INVALID_MEMBER', 'DUPLICATE_REQUEST'].indexOf(code) >= 0;
  return { success: false, schemaVersion: FAMILY_INBOX_SCHEMA_VERSION, data: rejected ? { status: 'rejected' } : {}, error: { code: code }, message: 'family inbox request failed' };
}

function familyInboxTraceFromBody_(body, operation) {
  const supplied = String(body && body.traceId || '').trim();
  return { traceId: /^[A-Za-z0-9_-]{8,64}$/.test(supplied) ? supplied : 'trace_unavailable', operation: operation };
}

function familyInboxLog_(metadata) {
  if (typeof Logger === 'undefined' || typeof Logger.log !== 'function') return;
  const safe = {};
  ['traceId', 'inboxId', 'operation', 'stage', 'status', 'mediaType', 'sizeBytes', 'sha256Prefix', 'durationMs', 'errorCode', 'claimVersion', 'candidateCount', 'profile', 'model', 'result'].forEach(function(key) {
    if (Object.prototype.hasOwnProperty.call(metadata || {}, key) && metadata[key] !== '') safe[key] = metadata[key];
  });
  try { Logger.log('[FAMILY_INBOX] ' + JSON.stringify(safe)); } catch (_) {}
}

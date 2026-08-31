const FAMILY_INBOX_GATEWAY_SCHEMA_VERSION = 'family-inbox-1.0';
const FAMILY_INBOX_GATEWAY_MAX_FILE_BYTES = 5 * 1024 * 1024;
const FAMILY_INBOX_GATEWAY_MAX_NOTE_CHARACTERS = 500;
const FAMILY_INBOX_GATEWAY_MEDIA = Object.freeze({
  'image/jpeg': Object.freeze([0xff, 0xd8, 0xff]),
  'image/png': Object.freeze([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'application/pdf': Object.freeze([0x25, 0x50, 0x44, 0x46, 0x2d]),
});
const FAMILY_INBOX_GATEWAY_CAPABILITIES = Object.freeze({
  'familyInbox.submit': 'family.inbox.submit',
  'familyInbox.getStatus': 'family.inbox.read',
  'familyInbox.listReviews': 'family.inbox.review',
  'familyInbox.getReview': 'family.inbox.review',
  'familyInbox.updateCandidate': 'family.inbox.review',
  'familyInbox.approveCandidate': 'family.inbox.review',
  'familyInbox.rejectCandidate': 'family.inbox.review',
});
const FAMILY_INBOX_GATEWAY_SAFE_ERRORS = Object.freeze({
  INVALID_INPUT: true, UNSUPPORTED_MEDIA_TYPE: true, FILE_TOO_LARGE: true,
  INVALID_FILE_SIGNATURE: true, INVALID_MEMBER: true, FORBIDDEN: true,
  DUPLICATE_REQUEST: true, STORAGE_ERROR: true, LEDGER_ERROR: true,
  CONFIGURATION_ERROR: true, NOT_FOUND: true, REVISION_CONFLICT: true,
  INVALID_STATE: true, DATA_INTEGRITY_ERROR: true, IDEMPOTENCY_CONFLICT: true,
  SERVICE_UNAVAILABLE: true, INTERNAL_ERROR: true,
});
const FAMILY_INBOX_GATEWAY_REVIEW_REASONS = Object.freeze({
  incorrect: true, duplicate: true, not_relevant: true, unreadable: true, other: true,
});

function familyInboxGateway_(body) {
  const input = body || {};
  const startedAt = Date.now();
  const operation = String(input.action || '').trim();
  const traceId = familyInboxGatewayTraceId_(input.clientRequestId || input.inboxId);
  try {
    const capability = FAMILY_INBOX_GATEWAY_CAPABILITIES[operation];
    if (!capability) throw familyInboxGatewayError_('FORBIDDEN');
    const actor = resolveAuthenticatedActor_(input.deviceId, input.pairingToken);
    authorizeCapability_(actor, capability);
    const trusted = familyInboxGatewayBuildTrustedRequest_(input, actor, operation, traceId);
    const result = familyInboxGatewayCallService_(trusted, operation);
    familyInboxGatewayLog_({ traceId: traceId, operation: operation, stage: 'completed', status: result.status, mediaType: trusted.file && trusted.file.mediaType, sizeBytes: trusted.file && trusted.file.sizeBytes, durationMs: Date.now() - startedAt });
    return json_({ success: true, schemaVersion: FAMILY_INBOX_GATEWAY_SCHEMA_VERSION, data: result, error: null, message: 'ok' });
  } catch (error) {
    const code = familyInboxGatewaySafeErrorCode_(error);
    familyInboxGatewayLog_({ traceId: traceId, operation: operation, stage: 'failed', status: 'failed', durationMs: Date.now() - startedAt, errorCode: code });
    const rejected = ['INVALID_INPUT', 'UNSUPPORTED_MEDIA_TYPE', 'FILE_TOO_LARGE', 'INVALID_FILE_SIGNATURE', 'INVALID_MEMBER', 'DUPLICATE_REQUEST'].indexOf(code) >= 0;
    return json_({ success: false, schemaVersion: FAMILY_INBOX_GATEWAY_SCHEMA_VERSION, data: rejected ? { status: 'rejected' } : {}, error: { code: code }, message: 'family inbox request failed' });
  }
}

function familyInboxGatewayBuildTrustedRequest_(input, actor, operation, traceId) {
  if (operation === 'familyInbox.submit') {
    const allowed = { action: true, deviceId: true, pairingToken: true, clientRequestId: true, subjectMemberId: true, userNote: true, file: true };
    if (!familyInboxGatewayPlainObject_(input) || Object.keys(input).some(function(key) { return !allowed[key]; })) throw familyInboxGatewayError_('INVALID_INPUT');
    const subjectMemberId = String(input.subjectMemberId || '').trim();
    const subject = getHomeMember_(actor.homeId, subjectMemberId);
    if (!subject || subject.status !== 'active' || !isHomeMemberPolicyMatch_(subject)) throw familyInboxGatewayError_('INVALID_MEMBER');
    const file = familyInboxGatewayValidateFile_(input.file);
    const clientRequestId = String(input.clientRequestId || '').trim();
    const userNote = String(input.userNote || '').trim();
    if (!familyInboxGatewayUuid_(clientRequestId) || Array.from(userNote).length > FAMILY_INBOX_GATEWAY_MAX_NOTE_CHARACTERS) throw familyInboxGatewayError_('INVALID_INPUT');
    return {
      operation: operation,
      clientRequestId: clientRequestId,
      subjectMemberId: subject.memberUserId,
      userNote: userNote,
      file: file,
      homeId: actor.homeId,
      submittedByMemberId: actor.memberUserId,
      source: 'paluru',
      traceId: traceId,
    };
  }

  if (operation === 'familyInbox.listReviews') {
    const allowed = { action: true, deviceId: true, pairingToken: true };
    if (!familyInboxGatewayPlainObject_(input) || Object.keys(input).some(function(key) { return !allowed[key]; })) throw familyInboxGatewayError_('INVALID_INPUT');
    return { operation: operation, homeId: actor.homeId, traceId: traceId };
  }

  const inboxId = familyInboxGatewayInboxId_(input.inboxId);
  if (operation === 'familyInbox.getStatus' || operation === 'familyInbox.getReview') {
    const allowed = { action: true, deviceId: true, pairingToken: true, inboxId: true };
    if (!familyInboxGatewayPlainObject_(input) || Object.keys(input).some(function(key) { return !allowed[key]; })) throw familyInboxGatewayError_('INVALID_INPUT');
    return { operation: operation, homeId: actor.homeId, inboxId: inboxId, traceId: traceId };
  }

  const allowed = {
    action: true, deviceId: true, pairingToken: true, inboxId: true,
    candidateId: true, revision: true, reviewRequestId: true,
    payload: true, reviewReason: true, reviewNote: true,
  };
  if (!familyInboxGatewayPlainObject_(input) || Object.keys(input).some(function(key) { return !allowed[key]; })) throw familyInboxGatewayError_('INVALID_INPUT');
  const candidateId = String(input.candidateId || '').trim();
  const revision = Number(input.revision);
  const reviewRequestId = String(input.reviewRequestId || '').trim();
  const reviewNote = String(input.reviewNote || '').trim();
  if (!/^cand_[0-9a-f]{32}$/i.test(candidateId) || !Number.isInteger(revision) || revision < 1 || !familyInboxGatewayUuid_(reviewRequestId) || Array.from(reviewNote).length > 500) throw familyInboxGatewayError_('INVALID_INPUT');
  const trusted = {
    operation: operation,
    homeId: actor.homeId,
    reviewedByMemberId: actor.memberUserId,
    inboxId: inboxId,
    candidateId: candidateId,
    revision: revision,
    reviewRequestId: reviewRequestId,
    reviewNote: reviewNote,
    traceId: traceId,
  };
  if (operation === 'familyInbox.updateCandidate') {
    if (!familyInboxGatewayPlainObject_(input.payload) || Object.prototype.hasOwnProperty.call(input, 'reviewReason')) throw familyInboxGatewayError_('INVALID_INPUT');
    trusted.payload = input.payload;
  } else if (operation === 'familyInbox.rejectCandidate') {
    const reason = String(input.reviewReason || '').trim();
    if (!FAMILY_INBOX_GATEWAY_REVIEW_REASONS[reason] || Object.prototype.hasOwnProperty.call(input, 'payload')) throw familyInboxGatewayError_('INVALID_INPUT');
    trusted.reviewReason = reason;
  } else if (operation === 'familyInbox.approveCandidate') {
    if (Object.prototype.hasOwnProperty.call(input, 'payload') || Object.prototype.hasOwnProperty.call(input, 'reviewReason')) throw familyInboxGatewayError_('INVALID_INPUT');
  } else {
    throw familyInboxGatewayError_('FORBIDDEN');
  }
  return trusted;
}

function familyInboxGatewayValidateFile_(file) {
  if (!familyInboxGatewayPlainObject_(file)) throw familyInboxGatewayError_('INVALID_INPUT');
  const allowed = { name: true, mediaType: true, base64: true };
  if (Object.keys(file).some(function(key) { return !allowed[key]; })) throw familyInboxGatewayError_('INVALID_INPUT');
  const name = String(file.name || '').trim();
  const mediaType = String(file.mediaType || '').trim().toLowerCase();
  const base64 = String(file.base64 || '');
  if (!name || Array.from(name).length > 255 || !FAMILY_INBOX_GATEWAY_MEDIA[mediaType]) {
    if (!FAMILY_INBOX_GATEWAY_MEDIA[mediaType]) throw familyInboxGatewayError_('UNSUPPORTED_MEDIA_TYPE');
    throw familyInboxGatewayError_('INVALID_INPUT');
  }
  if (!base64 || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw familyInboxGatewayError_('INVALID_INPUT');
  const padding = (base64.match(/=*$/) || [''])[0].length;
  const estimatedBytes = (base64.length * 3 / 4) - padding;
  if (estimatedBytes > FAMILY_INBOX_GATEWAY_MAX_FILE_BYTES) throw familyInboxGatewayError_('FILE_TOO_LARGE');
  let bytes;
  try { bytes = Utilities.base64Decode(base64); } catch (_) { throw familyInboxGatewayError_('INVALID_INPUT'); }
  if (!bytes.length) throw familyInboxGatewayError_('INVALID_INPUT');
  if (bytes.length > FAMILY_INBOX_GATEWAY_MAX_FILE_BYTES) throw familyInboxGatewayError_('FILE_TOO_LARGE');
  const signature = FAMILY_INBOX_GATEWAY_MEDIA[mediaType];
  if (bytes.length < signature.length || signature.some(function(expected, index) { return (Number(bytes[index]) & 0xff) !== expected; })) throw familyInboxGatewayError_('INVALID_FILE_SIGNATURE');
  return { name: name, mediaType: mediaType, base64: base64, sizeBytes: bytes.length };
}

function familyInboxGatewayCallService_(trusted, operation) {
  const properties = PropertiesService.getScriptProperties();
  const url = String(properties.getProperty('FAMILY_INBOX_WEBAPP_URL') || '').trim();
  const serviceToken = String(properties.getProperty('FAMILY_INBOX_SERVICE_TOKEN') || '');
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url) || !serviceToken) throw familyInboxGatewayError_('CONFIGURATION_ERROR');
  const forwarded = Object.assign({}, trusted, { internalToken: serviceToken });
  if (trusted.file) forwarded.file = { name: trusted.file.name, mediaType: trusted.file.mediaType, base64: trusted.file.base64 };
  let response;
  try {
    response = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', payload: JSON.stringify(forwarded), muteHttpExceptions: true });
  } catch (_) {
    throw familyInboxGatewayError_(familyInboxGatewayIsReviewOperation_(operation) ? 'SERVICE_UNAVAILABLE' : 'INTERNAL_ERROR');
  }
  if (!response || response.getResponseCode() < 200 || response.getResponseCode() > 299) throw familyInboxGatewayError_(familyInboxGatewayIsReviewOperation_(operation) ? 'SERVICE_UNAVAILABLE' : 'INTERNAL_ERROR');
  let envelope;
  try { envelope = JSON.parse(String(response.getContentText() || '')); } catch (_) { throw familyInboxGatewayError_('INTERNAL_ERROR'); }
  if (!envelope || envelope.success !== true) throw familyInboxGatewayError_(familyInboxGatewayBackendError_(envelope));
  if (envelope.schemaVersion !== FAMILY_INBOX_GATEWAY_SCHEMA_VERSION || !familyInboxGatewayPlainObject_(envelope.data)) throw familyInboxGatewayError_('INTERNAL_ERROR');
  if (operation === 'familyInbox.submit') {
    if (!/^inb_[0-9a-f]{32}$/i.test(String(envelope.data.inboxId || '')) || ['pending', 'duplicate', 'rejected'].indexOf(envelope.data.status) < 0 || !familyInboxGatewayPlainObject_(envelope.data.idempotency) || typeof envelope.data.idempotency.replayed !== 'boolean') throw familyInboxGatewayError_('INTERNAL_ERROR');
    return { inboxId: envelope.data.inboxId, status: envelope.data.status, idempotency: { replayed: envelope.data.idempotency.replayed }, duplicateOfInboxId: String(envelope.data.duplicateOfInboxId || '') };
  }
  if (operation === 'familyInbox.listReviews') {
    if (!Array.isArray(envelope.data.items) || envelope.data.items.length > 100) throw familyInboxGatewayError_('INTERNAL_ERROR');
    return { items: envelope.data.items.map(familyInboxGatewayReviewListItem_) };
  }
  if (operation === 'familyInbox.getReview') return familyInboxGatewayReviewDetail_(envelope.data);
  if (operation === 'familyInbox.updateCandidate' || operation === 'familyInbox.approveCandidate' || operation === 'familyInbox.rejectCandidate') {
    const allowed = { candidate: true, reviewStatus: true, idempotency: true };
    if (!familyInboxGatewayExactKeys_(envelope.data, allowed) || !familyInboxGatewayPlainObject_(envelope.data.idempotency) || typeof envelope.data.idempotency.replayed !== 'boolean') throw familyInboxGatewayError_('INTERNAL_ERROR');
    if (['pending', 'reviewed'].indexOf(String(envelope.data.reviewStatus || '')) < 0) throw familyInboxGatewayError_('INTERNAL_ERROR');
    return { candidate: familyInboxGatewayReviewCandidate_(envelope.data.candidate), reviewStatus: envelope.data.reviewStatus, idempotency: { replayed: envelope.data.idempotency.replayed } };
  }
  if (!/^inb_[0-9a-f]{32}$/i.test(String(envelope.data.inboxId || '')) || ['pending', 'duplicate', 'rejected', 'processing', 'candidate_ready', 'needs_review', 'completed', 'failed'].indexOf(envelope.data.status) < 0) throw familyInboxGatewayError_('INTERNAL_ERROR');
  return { inboxId: envelope.data.inboxId, status: envelope.data.status, receivedAt: String(envelope.data.receivedAt || ''), updatedAt: String(envelope.data.updatedAt || ''), errorCode: String(envelope.data.errorCode || ''), duplicateOfInboxId: String(envelope.data.duplicateOfInboxId || '') };
}

function familyInboxGatewayReviewListItem_(value) {
  const allowed = { inboxId: true, receivedAt: true, subjectMemberId: true, originalName: true, candidateCount: true, candidateTypes: true, reviewStatus: true };
  if (!familyInboxGatewayExactKeys_(value, allowed) || !/^inb_[0-9a-f]{32}$/i.test(String(value.inboxId || '')) || !Number.isInteger(Number(value.candidateCount)) || Number(value.candidateCount) < 0 || Number(value.candidateCount) > 8 || !Array.isArray(value.candidateTypes) || ['pending', 'reviewed'].indexOf(String(value.reviewStatus || '')) < 0) throw familyInboxGatewayError_('INTERNAL_ERROR');
  return {
    inboxId: String(value.inboxId),
    receivedAt: String(value.receivedAt || ''),
    subjectMemberId: String(value.subjectMemberId || ''),
    originalName: String(value.originalName || ''),
    candidateCount: Number(value.candidateCount),
    candidateTypes: value.candidateTypes.map(String),
    reviewStatus: String(value.reviewStatus),
  };
}

function familyInboxGatewayReviewDetail_(value) {
  const allowed = { inboxId: true, subjectMemberId: true, reviewStatus: true, document: true, candidates: true };
  if (!familyInboxGatewayExactKeys_(value, allowed) || !/^inb_[0-9a-f]{32}$/i.test(String(value.inboxId || '')) || ['pending', 'reviewed'].indexOf(String(value.reviewStatus || '')) < 0 || !familyInboxGatewayPlainObject_(value.document) || !Array.isArray(value.candidates) || !value.candidates.length || value.candidates.length > 8) throw familyInboxGatewayError_('INTERNAL_ERROR');
  if (!familyInboxGatewayExactKeys_(value.document, { originalName: true, receivedAt: true })) throw familyInboxGatewayError_('INTERNAL_ERROR');
  return {
    inboxId: String(value.inboxId),
    subjectMemberId: String(value.subjectMemberId || ''),
    reviewStatus: String(value.reviewStatus),
    document: { originalName: String(value.document.originalName || ''), receivedAt: String(value.document.receivedAt || '') },
    candidates: value.candidates.map(familyInboxGatewayReviewCandidate_),
  };
}

function familyInboxGatewayReviewCandidate_(value) {
  const allowed = {
    candidateId: true, candidateType: true, revision: true, confidence: true,
    payload: true, evidenceSummary: true, warnings: true, questions: true,
    reviewStatus: true, reviewedAt: true, reviewAction: true, reviewReason: true,
  };
  if (!familyInboxGatewayExactKeys_(value, allowed) || !/^cand_[0-9a-f]{32}$/i.test(String(value.candidateId || '')) || !Number.isInteger(Number(value.revision)) || Number(value.revision) < 1 || !isFinite(Number(value.confidence)) || Number(value.confidence) < 0 || Number(value.confidence) > 1 || !familyInboxGatewayPlainObject_(value.payload) || !Array.isArray(value.evidenceSummary) || !Array.isArray(value.warnings) || !Array.isArray(value.questions) || ['pending', 'approved', 'rejected'].indexOf(String(value.reviewStatus || '')) < 0) throw familyInboxGatewayError_('INTERNAL_ERROR');
  return {
    candidateId: String(value.candidateId), candidateType: String(value.candidateType || ''),
    revision: Number(value.revision), confidence: Number(value.confidence), payload: value.payload,
    evidenceSummary: value.evidenceSummary, warnings: value.warnings.map(String), questions: value.questions.map(String),
    reviewStatus: String(value.reviewStatus), reviewedAt: String(value.reviewedAt || ''),
    reviewAction: String(value.reviewAction || ''), reviewReason: String(value.reviewReason || ''),
  };
}

function familyInboxGatewayExactKeys_(value, allowed) {
  return familyInboxGatewayPlainObject_(value) && !Object.keys(value).some(function(key) { return !allowed[key]; }) && !Object.keys(allowed).some(function(key) { return !Object.prototype.hasOwnProperty.call(value, key); });
}

function familyInboxGatewayInboxId_(value) {
  const inboxId = String(value || '').trim();
  if (!/^inb_[0-9a-f]{32}$/i.test(inboxId)) throw familyInboxGatewayError_('INVALID_INPUT');
  return inboxId;
}

function familyInboxGatewayIsReviewOperation_(operation) {
  return ['familyInbox.listReviews', 'familyInbox.getReview', 'familyInbox.updateCandidate', 'familyInbox.approveCandidate', 'familyInbox.rejectCandidate'].indexOf(operation) >= 0;
}

function familyInboxGatewayBackendError_(envelope) {
  const code = String(envelope && envelope.error && envelope.error.code || '');
  if (code === 'FORBIDDEN') return 'CONFIGURATION_ERROR';
  return FAMILY_INBOX_GATEWAY_SAFE_ERRORS[code] ? code : 'INTERNAL_ERROR';
}

function familyInboxGatewayUuid_(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function familyInboxGatewayPlainObject_(value) {
  return Boolean(value) && Object.prototype.toString.call(value) === '[object Object]';
}

function familyInboxGatewayTraceId_(value) {
  const suffix = String(value || '').replace(/[^A-Za-z0-9]/g, '').slice(-16);
  return suffix.length >= 8 ? 'fi_' + suffix : 'trace_unavailable';
}

function familyInboxGatewayError_(code) {
  const error = new Error(String(code || 'INTERNAL_ERROR'));
  error.code = String(code || 'INTERNAL_ERROR');
  return error;
}

function familyInboxGatewaySafeErrorCode_(error) {
  const code = String(error && error.code || '');
  if (code === 'UNAUTHORIZED_DEVICE' || code === 'MEMBERSHIP_NOT_FOUND') return 'FORBIDDEN';
  return FAMILY_INBOX_GATEWAY_SAFE_ERRORS[code] ? code : 'INTERNAL_ERROR';
}

function familyInboxGatewayLog_(metadata) {
  if (typeof Logger === 'undefined' || typeof Logger.log !== 'function') return;
  const safe = {};
  ['traceId', 'operation', 'stage', 'status', 'mediaType', 'sizeBytes', 'durationMs', 'errorCode'].forEach(function(key) {
    if (Object.prototype.hasOwnProperty.call(metadata || {}, key) && metadata[key] !== undefined && metadata[key] !== '') safe[key] = metadata[key];
  });
  try { Logger.log('[PALURU_FAMILY_INBOX] ' + JSON.stringify(safe)); } catch (_) {}
}

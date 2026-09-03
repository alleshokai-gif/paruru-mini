const FAMILY_INBOX_WORKER_PROPERTIES = Object.freeze({
  token: 'FAMILY_INBOX_WORKER_TOKEN',
  workerId: 'FAMILY_INBOX_WORKER_ID',
  profile: 'FAMILY_INBOX_WORKER_PROFILE',
});
const FAMILY_INBOX_CANDIDATE_SHEET_NAME = 'Family_Candidates';
const FAMILY_INBOX_WORKER_LEASE_MILLIS = 10 * 60 * 1000;
const FAMILY_INBOX_WORKER_HEARTBEAT_GRACE_MILLIS = 60 * 1000;
const FAMILY_INBOX_WORKER_RETRY_DELAY_MILLIS = 5 * 60 * 1000;
const FAMILY_INBOX_WORKER_MAX_ATTEMPTS = 3;
const FAMILY_INBOX_MAX_PUBLISH_BYTES = 128 * 1024;
const FAMILY_INBOX_MAX_EVIDENCE_QUOTE_CHARACTERS = 240;
const FAMILY_INBOX_WORKER_PROFILES = Object.freeze({
  'school-v1': Object.freeze({
    profile: 'school-v1', model: 'gpt-5.6-luna', extractorVersion: 'family-inbox-worker/1.0.0',
    promptVersion: 'school-v1/1.0.1', maxItems: 8, allowReviewItems: false,
  }),
  'school-v1-long': Object.freeze({
    profile: 'school-v1-long', model: 'gpt-5.6-luna', extractorVersion: 'family-inbox-worker/1.1.0',
    promptVersion: 'school-v1-long/1.0.2', maxItems: 40, allowReviewItems: true,
  }),
});
const FAMILY_INBOX_CANDIDATE_HEADERS = Object.freeze([
  'schemaVersion', 'candidateId', 'inboxId', 'homeId', 'candidateType', 'revision',
  'status', 'createdAt', 'updatedAt', 'subjectMemberId', 'confidence', 'sourceSha256',
  'profile', 'model', 'extractorVersion', 'promptVersion', 'payloadDigest', 'payloadJson',
  'evidenceJson', 'warningsJson', 'questionsJson', 'publishRequestId', 'claimVersion',
  'inputTokens', 'outputTokens', 'durationMs', 'reviewStatus', 'domainWriteResult',
]);
const FAMILY_INBOX_CANDIDATE_SCHEMAS = Object.freeze({
  'school.document': 'school.document/1.0',
  'schedule.event': 'schedule.event/1.0',
  'school.deadline': 'school.deadline/1.0',
  'school.belongings': 'school.belongings/1.0',
});
const FAMILY_INBOX_FAIL_CODES = Object.freeze({
  SOURCE_READ_ERROR: true,
  AI_PROVIDER_ERROR: true,
  AI_TIMEOUT: true,
  INVALID_AI_OUTPUT: true,
  UNSUPPORTED_DOCUMENT: true,
  PROMPT_INJECTION_REJECTED: true,
  INTERNAL_ERROR: true,
});

function familyInboxClaimNext_(body) {
  return familyInboxWorkerRun_('familyInbox.claimNext', body, function(context) {
    familyInboxWorkerValidateKeys_(body, { operation: true, workerToken: true, traceId: true, inboxId: true });
    const targeted = Object.prototype.hasOwnProperty.call(body, 'inboxId');
    const targetInboxId = targeted ? String(body.inboxId || '').trim() : '';
    if (targeted && !/^inb_[0-9a-f]{32}$/i.test(targetInboxId)) throw familyInboxError_('INVALID_INPUT');
    let lock;
    try {
      lock = LockService.getScriptLock();
      lock.waitLock(30000);
      const ledger = familyInboxOpenLedger_(context.config.spreadsheetId);
      const entries = familyInboxWorkerInboxEntries_(ledger);
      const now = new Date();
      const entry = targeted
        ? entries.find(function(candidate) { return String(candidate.record.inboxId || '') === targetInboxId; })
        : entries.find(function(candidate) { return familyInboxWorkerClaimEligible_(candidate.record, now); });
      if (targeted && !entry) throw familyInboxError_('CLAIM_NOT_FOUND');
      if (targeted && String(entry.record.status || '') !== 'pending') throw familyInboxError_('INVALID_STATE');
      if (!entry) return { claimed: false };
      const processingProfile = familyInboxWorkerProcessingProfile_(entry.record, context.profile);
      if (targeted && processingProfile.profile !== 'school-v1-long') throw familyInboxError_('INVALID_STATE');

      const claimVersion = familyInboxWorkerInteger_(entry.record.claimVersion, 0) + 1;
      const attemptCount = familyInboxWorkerInteger_(entry.record.attemptCount, 0) + 1;
      const nowIso = familyInboxWorkerIso_(now);
      const leaseExpiresAt = familyInboxWorkerIso_(new Date(now.getTime() + FAMILY_INBOX_WORKER_LEASE_MILLIS));
      familyInboxWorkerUpdateInbox_(ledger, entry, {
        status: 'processing',
        updatedAt: nowIso,
        attemptCount: attemptCount,
        processingStartedAt: nowIso,
        processingCompletedAt: '',
        claimedBy: context.workerId,
        claimVersion: claimVersion,
        leaseExpiresAt: leaseExpiresAt,
        retryable: false,
        nextAttemptAt: '',
        errorCode: '',
      });
      context.trace.inboxId = String(entry.record.inboxId || '');
      context.trace.claimVersion = claimVersion;
      context.trace.status = 'processing';
      return {
        claimed: true,
        inboxId: String(entry.record.inboxId || ''),
        claimVersion: claimVersion,
        mediaType: String(entry.record.mediaType || ''),
        sizeBytes: familyInboxWorkerInteger_(entry.record.sizeBytes, 0),
        subjectMemberId: String(entry.record.subjectMemberHint || ''),
        userNote: String(entry.record.userNote || ''),
        leaseExpiresAt: leaseExpiresAt,
        processingProfile: processingProfile.profile,
      };
    } finally {
      if (lock) {
        try { lock.releaseLock(); } catch (_) {}
      }
    }
  });
}

function familyInboxHeartbeat_(body) {
  return familyInboxWorkerRun_('familyInbox.heartbeat', body, function(context) {
    familyInboxWorkerValidateKeys_(body, { operation: true, workerToken: true, inboxId: true, claimVersion: true, traceId: true });
    const claim = familyInboxWorkerClaimInput_(body);
    let lock;
    try {
      lock = LockService.getScriptLock();
      lock.waitLock(30000);
      const ledger = familyInboxOpenLedger_(context.config.spreadsheetId);
      const entry = familyInboxWorkerRequireClaim_(ledger, claim, context.workerId, new Date(), true);
      const leaseExpiresAt = familyInboxWorkerIso_(new Date(Date.now() + FAMILY_INBOX_WORKER_LEASE_MILLIS));
      const nowIso = familyInboxNow_();
      familyInboxWorkerUpdateInbox_(ledger, entry, { updatedAt: nowIso, leaseExpiresAt: leaseExpiresAt });
      context.trace.inboxId = claim.inboxId;
      context.trace.claimVersion = claim.claimVersion;
      context.trace.status = 'processing';
      return { inboxId: claim.inboxId, claimVersion: claim.claimVersion, status: 'processing', leaseExpiresAt: leaseExpiresAt };
    } finally {
      if (lock) {
        try { lock.releaseLock(); } catch (_) {}
      }
    }
  });
}

function familyInboxGetClaimedSource_(body) {
  return familyInboxWorkerRun_('familyInbox.getClaimedSource', body, function(context) {
    familyInboxWorkerValidateKeys_(body, { operation: true, workerToken: true, inboxId: true, claimVersion: true, traceId: true });
    const claim = familyInboxWorkerClaimInput_(body);
    const ledger = familyInboxOpenLedger_(context.config.spreadsheetId);
    const entry = familyInboxWorkerRequireClaim_(ledger, claim, context.workerId, new Date(), false);
    let bytes;
    try {
      bytes = DriveApp.getFileById(String(entry.record.originalRef || '')).getBlob().getBytes();
    } catch (_) {
      throw familyInboxError_('SOURCE_READ_ERROR');
    }
    if (!bytes || !bytes.length || bytes.length > FAMILY_INBOX_MAX_FILE_BYTES) throw familyInboxError_('SOURCE_READ_ERROR');
    const sha256 = familyInboxSha256_(bytes);
    if (sha256 !== String(entry.record.sha256 || '')) throw familyInboxError_('SOURCE_READ_ERROR');
    context.trace.inboxId = claim.inboxId;
    context.trace.claimVersion = claim.claimVersion;
    context.trace.mediaType = String(entry.record.mediaType || '');
    context.trace.sizeBytes = bytes.length;
    context.trace.sha256Prefix = sha256.slice(0, 12);
    return {
      inboxId: claim.inboxId,
      claimVersion: claim.claimVersion,
      mediaType: String(entry.record.mediaType || ''),
      sizeBytes: bytes.length,
      base64: Utilities.base64Encode(bytes),
    };
  });
}

function familyInboxPublishCandidates_(body) {
  return familyInboxWorkerRun_('familyInbox.publishCandidates', body, function(context) {
    familyInboxWorkerValidatePublishKeys_(body);
    const requestedInboxId = String(body.inboxId || '').trim();
    if (!/^inb_[0-9a-f]{32}$/i.test(requestedInboxId)) throw familyInboxError_('INVALID_INPUT');
    let lock;
    try {
      lock = LockService.getScriptLock();
      lock.waitLock(30000);
      const inboxLedger = familyInboxOpenLedger_(context.config.spreadsheetId);
      const inboxEntry = familyInboxWorkerFindInboxEntry_(inboxLedger, requestedInboxId);
      if (!inboxEntry) throw familyInboxError_('CLAIM_NOT_FOUND');
      const input = familyInboxWorkerValidatePublish_(body, familyInboxWorkerProcessingProfile_(inboxEntry.record, context.profile));
      const candidateLedger = familyInboxOpenCandidateLedger_(context.config.spreadsheetId);
      const reviewItemLedger = input.profile.allowReviewItems ? familyInboxPcReviewOpenItemLedger_(context.config.spreadsheetId) : null;
      const existingCandidates = familyInboxWorkerFindCandidateRows_(candidateLedger, input.publishRequestId);
      const existingReviewItems = reviewItemLedger ? familyInboxPcReviewFindItemRows_(reviewItemLedger, input.publishRequestId) : [];
      const hasExisting = Boolean(existingCandidates.length || existingReviewItems.length);
      if (hasExisting) {
        const replayValid = existingCandidates.concat(existingReviewItems).every(function(entry) {
          return String(entry.record.inboxId || '') === input.inboxId &&
            String(entry.record.payloadDigest || '') === input.payloadDigest &&
            familyInboxWorkerInteger_(entry.record.claimVersion, -1) === input.claimVersion &&
            String(entry.record.profile || '') === input.profile.profile;
        });
        if (!replayValid || existingCandidates.length > input.candidates.length || existingReviewItems.length > input.reviewItems.length) throw familyInboxError_('IDEMPOTENCY_CONFLICT');
        const candidateBoundaryComplete = existingCandidates.length === 0 || existingCandidates.length === input.candidates.length;
        const reviewItemBoundaryComplete = existingReviewItems.length === 0 || existingReviewItems.length === input.reviewItems.length;
        if (!candidateBoundaryComplete || !reviewItemBoundaryComplete) throw familyInboxError_('DATA_INTEGRITY_ERROR');
        const status = String(inboxEntry.record.status || '');
        if (status === 'processing') {
          familyInboxWorkerRequireClaim_(inboxLedger, input, context.workerId, new Date(), false);
        } else if (status !== 'needs_review' && status !== 'candidate_ready') {
          throw familyInboxError_('IDEMPOTENCY_CONFLICT');
        }
        if (status !== 'processing' && (existingCandidates.length !== input.candidates.length || existingReviewItems.length !== input.reviewItems.length)) throw familyInboxError_('IDEMPOTENCY_CONFLICT');
        if (status !== 'processing') {
          context.trace.inboxId = input.inboxId;
          context.trace.claimVersion = input.claimVersion;
          context.trace.candidateCount = existingCandidates.length;
          context.trace.reviewItemCount = existingReviewItems.length;
          context.trace.status = 'needs_review';
          return {
            inboxId: input.inboxId,
            status: 'needs_review',
            candidateIds: existingCandidates.map(function(entry) { return String(entry.record.candidateId || ''); }),
            reviewItemIds: existingReviewItems.map(function(entry) { return String(entry.record.reviewItemId || ''); }),
            idempotency: { replayed: true },
          };
        }
      }

      if (!hasExisting || String(inboxEntry.record.status || '') === 'processing') {
        familyInboxWorkerRequireClaim_(inboxLedger, input, context.workerId, new Date(), false);
        const now = familyInboxNow_();
        let candidateRows = existingCandidates.map(function(entry) { return entry.record; });
        if (!candidateRows.length) {
          candidateRows = familyInboxWorkerCandidateRows_(input, inboxEntry, now);
          familyInboxWorkerAppendCandidates_(candidateLedger, candidateRows);
        }
        let reviewItemRows = existingReviewItems.map(function(entry) { return entry.record; });
        if (input.reviewItems.length && !reviewItemRows.length) {
          reviewItemRows = familyInboxPcReviewRowsFromPublish_(input, inboxEntry, now);
          familyInboxPcReviewAppendItems_(reviewItemLedger, reviewItemRows);
        }
        familyInboxWorkerCompleteInbox_(inboxLedger, inboxEntry, 'needs_review');
        context.trace.inboxId = input.inboxId;
        context.trace.claimVersion = input.claimVersion;
        context.trace.candidateCount = candidateRows.length;
        context.trace.reviewItemCount = reviewItemRows.length;
        context.trace.status = 'needs_review';
        context.trace.profile = input.profile.profile;
        context.trace.model = input.profile.model;
        return {
          inboxId: input.inboxId,
          status: 'needs_review',
          candidateIds: candidateRows.map(function(row) { return String(row.candidateId || ''); }),
          reviewItemIds: reviewItemRows.map(function(row) { return String(row.reviewItemId || ''); }),
          idempotency: { replayed: hasExisting },
        };
      }
      throw familyInboxError_('IDEMPOTENCY_CONFLICT');
    } finally {
      if (lock) {
        try { lock.releaseLock(); } catch (_) {}
      }
    }
  });
}

function familyInboxFailClaim_(body) {
  return familyInboxWorkerRun_('familyInbox.failClaim', body, function(context) {
    familyInboxWorkerValidateKeys_(body, {
      operation: true, workerToken: true, inboxId: true, claimVersion: true,
      errorCode: true, retryable: true, traceId: true,
    });
    const claim = familyInboxWorkerClaimInput_(body);
    const errorCode = String(body.errorCode || '').trim();
    if (!FAMILY_INBOX_FAIL_CODES[errorCode] || typeof body.retryable !== 'boolean') throw familyInboxError_('INVALID_INPUT');
    let lock;
    try {
      lock = LockService.getScriptLock();
      lock.waitLock(30000);
      const ledger = familyInboxOpenLedger_(context.config.spreadsheetId);
      const entry = familyInboxWorkerRequireClaim_(ledger, claim, context.workerId, new Date(), true);
      const attemptCount = familyInboxWorkerInteger_(entry.record.attemptCount, 0);
      const willRetry = body.retryable === true && attemptCount < FAMILY_INBOX_WORKER_MAX_ATTEMPTS;
      const now = new Date();
      const status = willRetry ? 'failed' : 'needs_review';
      familyInboxWorkerUpdateInbox_(ledger, entry, {
        status: status,
        updatedAt: familyInboxWorkerIso_(now),
        processingCompletedAt: familyInboxWorkerIso_(now),
        claimedBy: '',
        leaseExpiresAt: '',
        retryable: willRetry,
        nextAttemptAt: willRetry ? familyInboxWorkerIso_(new Date(now.getTime() + FAMILY_INBOX_WORKER_RETRY_DELAY_MILLIS)) : '',
        errorCode: errorCode,
      });
      context.trace.inboxId = claim.inboxId;
      context.trace.claimVersion = claim.claimVersion;
      context.trace.status = status;
      context.trace.errorCode = errorCode;
      return { inboxId: claim.inboxId, status: status, retryable: willRetry, nextAttemptAt: String(entry.record.nextAttemptAt || ''), errorCode: errorCode };
    } finally {
      if (lock) {
        try { lock.releaseLock(); } catch (_) {}
      }
    }
  });
}

function familyInboxWorkerRun_(operation, body, action) {
  const startedAt = Date.now();
  const trace = familyInboxTraceFromBody_(body, operation);
  try {
    const worker = familyInboxWorkerAuthenticate_(body);
    const config = familyInboxLoadConfig_();
    const context = { workerId: worker.workerId, profile: worker.profile, config: config, trace: trace };
    const result = action(context);
    familyInboxLog_(Object.assign(trace, { stage: 'completed', durationMs: Date.now() - startedAt }));
    return result;
  } catch (error) {
    familyInboxLog_(Object.assign(trace, { stage: 'failed', status: 'failed', errorCode: familyInboxSafeErrorCode_(error), durationMs: Date.now() - startedAt }));
    throw error;
  }
}

function familyInboxWorkerAuthenticate_(body) {
  const properties = PropertiesService.getScriptProperties();
  const expected = String(properties.getProperty(FAMILY_INBOX_WORKER_PROPERTIES.token) || '');
  const workerId = String(properties.getProperty(FAMILY_INBOX_WORKER_PROPERTIES.workerId) || '').trim();
  const profileName = String(properties.getProperty(FAMILY_INBOX_WORKER_PROPERTIES.profile) || 'school-v1').trim();
  const profile = FAMILY_INBOX_WORKER_PROFILES[profileName];
  if (!expected || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,63}$/.test(workerId) || !profile) throw familyInboxError_('CONFIGURATION_ERROR');
  const actual = String(body && body.workerToken || '');
  if (!actual || !familyInboxConstantTimeEquals_(expected, actual)) throw familyInboxError_('FORBIDDEN');
  return { workerId: workerId, profile: profile };
}

function familyInboxWorkerValidateKeys_(value, allowed) {
  if (!familyInboxPlainObject_(value) || Object.keys(value).some(function(key) { return !allowed[key]; })) throw familyInboxError_('INVALID_INPUT');
}

function familyInboxWorkerClaimInput_(body) {
  const inboxId = String(body.inboxId || '').trim();
  if (!/^inb_[0-9a-f]{32}$/i.test(inboxId)) throw familyInboxError_('INVALID_INPUT');
  const claimVersion = familyInboxWorkerInteger_(body.claimVersion, -1);
  if (claimVersion < 1 || Number(body.claimVersion) !== claimVersion) throw familyInboxError_('INVALID_INPUT');
  return { inboxId: inboxId, claimVersion: claimVersion };
}

function familyInboxWorkerInboxEntries_(sheetState) {
  const lastRow = sheetState.sheet.getLastRow();
  if (lastRow <= 1) return [];
  const values = sheetState.sheet.getRange(2, 1, lastRow - 1, sheetState.headers.length).getValues();
  return values.map(function(row, index) {
    return {
      rowNumber: index + 2,
      record: sheetState.headers.reduce(function(record, header, column) { record[header] = row[column]; return record; }, {}),
    };
  });
}

function familyInboxWorkerFindInboxEntry_(sheetState, inboxId) {
  return familyInboxWorkerInboxEntries_(sheetState).find(function(entry) { return String(entry.record.inboxId || '') === inboxId; }) || null;
}

function familyInboxWorkerClaimEligible_(record, now) {
  const status = String(record.status || '');
  if (status === 'pending') return true;
  if (status === 'processing') return familyInboxWorkerTime_(record.leaseExpiresAt) <= now.getTime();
  if (status === 'failed' && familyInboxWorkerBoolean_(record.retryable)) {
    const nextAttemptAt = familyInboxWorkerTime_(record.nextAttemptAt);
    return familyInboxWorkerInteger_(record.attemptCount, 0) < FAMILY_INBOX_WORKER_MAX_ATTEMPTS && nextAttemptAt <= now.getTime();
  }
  return false;
}

function familyInboxWorkerProcessingProfile_(record, fallbackProfile) {
  const stored = String(record && record.processingProfile || '').trim();
  if (!stored) return fallbackProfile;
  const profile = FAMILY_INBOX_WORKER_PROFILES[stored];
  if (!profile) throw familyInboxError_('CONFIGURATION_ERROR');
  return profile;
}

function familyInboxWorkerRequireClaim_(sheetState, claim, workerId, now, allowGrace) {
  const entry = familyInboxWorkerFindInboxEntry_(sheetState, claim.inboxId);
  if (!entry) throw familyInboxError_('CLAIM_NOT_FOUND');
  if (String(entry.record.status || '') !== 'processing' || String(entry.record.claimedBy || '') !== workerId || familyInboxWorkerInteger_(entry.record.claimVersion, -1) !== claim.claimVersion) {
    throw familyInboxError_('CLAIM_CONFLICT');
  }
  const lease = familyInboxWorkerTime_(entry.record.leaseExpiresAt);
  const grace = allowGrace ? FAMILY_INBOX_WORKER_HEARTBEAT_GRACE_MILLIS : 0;
  if (!lease || now.getTime() > lease + grace) throw familyInboxError_('CLAIM_EXPIRED');
  return entry;
}

function familyInboxWorkerUpdateInbox_(sheetState, entry, updates) {
  const row = sheetState.sheet.getRange(entry.rowNumber, 1, 1, sheetState.headers.length).getValues()[0];
  Object.keys(updates).forEach(function(header) {
    const column = sheetState.headers.indexOf(header);
    if (column < 0) throw familyInboxError_('CONFIGURATION_ERROR');
    row[column] = updates[header];
    entry.record[header] = updates[header];
  });
  try { sheetState.sheet.getRange(entry.rowNumber, 1, 1, sheetState.headers.length).setValues([row]); } catch (_) { throw familyInboxError_('LEDGER_ERROR'); }
}

function familyInboxWorkerCompleteInbox_(sheetState, entry, status) {
  const now = familyInboxNow_();
  familyInboxWorkerUpdateInbox_(sheetState, entry, {
    status: status,
    updatedAt: now,
    processingCompletedAt: now,
    claimedBy: '',
    leaseExpiresAt: '',
    retryable: false,
    nextAttemptAt: '',
    errorCode: '',
  });
}

function familyInboxWorkerValidatePublish_(body, profile) {
  familyInboxWorkerValidatePublishKeys_(body);
  if (!profile || !FAMILY_INBOX_WORKER_PROFILES[profile.profile]) throw familyInboxError_('CONFIGURATION_ERROR');
  const claim = familyInboxWorkerClaimInput_(body);
  const publishRequestId = String(body.publishRequestId || '').trim();
  if (!familyInboxUuid_(publishRequestId)) throw familyInboxError_('INVALID_INPUT');
  const payloadDigest = String(body.payloadDigest || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(payloadDigest)) throw familyInboxError_('INVALID_INPUT');
  if (!Array.isArray(body.candidates) || !body.candidates.length) throw familyInboxError_('INVALID_CANDIDATE');
  const suppliedReviewItems = Object.prototype.hasOwnProperty.call(body, 'reviewItems') ? body.reviewItems : [];
  if (!Array.isArray(suppliedReviewItems) || (!profile.allowReviewItems && suppliedReviewItems.length)) throw familyInboxError_('INVALID_CANDIDATE');
  if (body.candidates.length + suppliedReviewItems.length > profile.maxItems) throw familyInboxError_('INVALID_CANDIDATE');
  const candidates = body.candidates.map(familyInboxWorkerValidateCandidate_);
  const reviewItems = suppliedReviewItems.map(familyInboxPcReviewValidatePublishedItem_);
  if (candidates.filter(function(candidate) { return candidate.candidateType === 'school.document'; }).length !== 1) throw familyInboxError_('INVALID_CANDIDATE');
  const digestValue = profile.allowReviewItems ? { candidates: candidates, reviewItems: reviewItems } : candidates;
  if (Utilities.newBlob(JSON.stringify(digestValue)).getBytes().length > FAMILY_INBOX_MAX_PUBLISH_BYTES) throw familyInboxError_('INVALID_CANDIDATE');
  const calculatedDigest = familyInboxSha256_(Utilities.newBlob(familyInboxWorkerStableStringify_(digestValue)).getBytes());
  if (calculatedDigest !== payloadDigest) throw familyInboxError_('INVALID_CANDIDATE');
  const usage = familyInboxPlainObject_(body.usage) ? body.usage : {};
  familyInboxWorkerValidateKeys_(usage, { inputTokens: true, outputTokens: true });
  const inputTokens = familyInboxWorkerBoundedInteger_(usage.inputTokens, 0, 10000000);
  const outputTokens = familyInboxWorkerBoundedInteger_(usage.outputTokens, 0, 10000000);
  const durationMs = familyInboxWorkerBoundedInteger_(body.durationMs, 0, 60 * 60 * 1000);
  return Object.assign(claim, {
    publishRequestId: publishRequestId,
    payloadDigest: payloadDigest,
    candidates: candidates,
    reviewItems: reviewItems,
    profile: profile,
    usage: { inputTokens: inputTokens, outputTokens: outputTokens },
    durationMs: durationMs,
  });
}

function familyInboxWorkerValidatePublishKeys_(body) {
  familyInboxWorkerValidateKeys_(body, {
    operation: true, workerToken: true, inboxId: true, claimVersion: true,
    publishRequestId: true, payloadDigest: true, candidates: true, usage: true,
    durationMs: true, reviewItems: true, traceId: true,
  });
}

function familyInboxWorkerCandidateRows_(input, inboxEntry, now) {
  return input.candidates.map(function(candidate) {
    return {
      schemaVersion: candidate.schemaVersion,
      candidateId: familyInboxWorkerNewCandidateId_(),
      inboxId: input.inboxId,
      homeId: String(inboxEntry.record.homeId || ''),
      candidateType: candidate.candidateType,
      revision: 1,
      status: 'proposed',
      createdAt: now,
      updatedAt: now,
      subjectMemberId: String(inboxEntry.record.subjectMemberHint || ''),
      confidence: candidate.confidence,
      sourceSha256: String(inboxEntry.record.sha256 || ''),
      profile: input.profile.profile,
      model: input.profile.model,
      extractorVersion: input.profile.extractorVersion,
      promptVersion: input.profile.promptVersion,
      payloadDigest: input.payloadDigest,
      payloadJson: JSON.stringify(candidate.payload),
      evidenceJson: JSON.stringify(candidate.evidence),
      warningsJson: JSON.stringify(candidate.warnings),
      questionsJson: JSON.stringify(candidate.questions),
      publishRequestId: input.publishRequestId,
      claimVersion: input.claimVersion,
      inputTokens: input.usage.inputTokens,
      outputTokens: input.usage.outputTokens,
      durationMs: input.durationMs,
      reviewStatus: 'pending',
      domainWriteResult: '',
    };
  });
}

function familyInboxWorkerValidateCandidate_(candidate) {
  familyInboxWorkerValidateKeys_(candidate, {
    candidateType: true, schemaVersion: true, confidence: true, payload: true,
    evidence: true, warnings: true, questions: true,
  });
  const candidateType = String(candidate.candidateType || '');
  const schemaVersion = String(candidate.schemaVersion || '');
  if (!FAMILY_INBOX_CANDIDATE_SCHEMAS[candidateType] || FAMILY_INBOX_CANDIDATE_SCHEMAS[candidateType] !== schemaVersion) throw familyInboxError_('INVALID_CANDIDATE');
  const confidence = Number(candidate.confidence);
  if (!isFinite(confidence) || confidence < 0 || confidence > 1) throw familyInboxError_('INVALID_CANDIDATE');
  const evidence = familyInboxWorkerValidateEvidence_(candidate.evidence);
  const warnings = familyInboxWorkerStringArray_(candidate.warnings, 10, 200);
  const questions = familyInboxWorkerStringArray_(candidate.questions, 10, 200);
  const payload = familyInboxWorkerValidatePayload_(candidateType, candidate.payload);
  return {
    candidateType: candidateType,
    schemaVersion: schemaVersion,
    confidence: confidence,
    evidence: evidence,
    warnings: warnings,
    questions: questions,
    payload: payload,
  };
}

function familyInboxWorkerValidateEvidence_(value) {
  if (!Array.isArray(value) || value.length > 20) throw familyInboxError_('INVALID_CANDIDATE');
  return value.map(function(evidence) {
    familyInboxWorkerValidateKeys_(evidence, { page: true, quote: true, fieldPaths: true });
    const page = familyInboxWorkerBoundedInteger_(evidence.page, 1, 1000);
    const quote = familyInboxWorkerRequiredText_(evidence.quote, FAMILY_INBOX_MAX_EVIDENCE_QUOTE_CHARACTERS);
    const fieldPaths = familyInboxWorkerStringArray_(evidence.fieldPaths, 10, 120);
    if (!fieldPaths.length) throw familyInboxError_('INVALID_CANDIDATE');
    return { page: page, quote: quote, fieldPaths: fieldPaths };
  });
}

function familyInboxWorkerValidatePayload_(candidateType, payload) {
  if (!familyInboxPlainObject_(payload)) throw familyInboxError_('INVALID_CANDIDATE');
  if (candidateType === 'school.document') {
    familyInboxWorkerValidateKeys_(payload, { title: true, documentType: true, documentDate: true, relevantNotes: true });
    const documentType = String(payload.documentType || '');
    if (['notice', 'schedule', 'deadline', 'belongings', 'other'].indexOf(documentType) < 0) throw familyInboxError_('INVALID_CANDIDATE');
    return {
      title: familyInboxWorkerRequiredText_(payload.title, 200),
      documentType: documentType,
      documentDate: familyInboxWorkerNullableDate_(payload.documentDate),
      relevantNotes: familyInboxWorkerStringArray_(payload.relevantNotes, 10, 500),
    };
  }
  if (candidateType === 'schedule.event') {
    familyInboxWorkerValidateKeys_(payload, { title: true, date: true, startTime: true, endTime: true, location: true, notes: true });
    return {
      title: familyInboxWorkerRequiredText_(payload.title, 200),
      date: familyInboxWorkerDate_(payload.date),
      startTime: familyInboxWorkerNullableTime_(payload.startTime),
      endTime: familyInboxWorkerNullableTime_(payload.endTime),
      location: familyInboxWorkerNullableText_(payload.location, 200),
      notes: familyInboxWorkerNullableText_(payload.notes, 500),
    };
  }
  if (candidateType === 'school.deadline') {
    familyInboxWorkerValidateKeys_(payload, { title: true, dueDate: true, actionRequired: true });
    return {
      title: familyInboxWorkerRequiredText_(payload.title, 200),
      dueDate: familyInboxWorkerDate_(payload.dueDate),
      actionRequired: familyInboxWorkerRequiredText_(payload.actionRequired, 500),
    };
  }
  if (candidateType === 'school.belongings') {
    familyInboxWorkerValidateKeys_(payload, { date: true, items: true });
    const items = familyInboxWorkerStringArray_(payload.items, 20, 100);
    if (!items.length) throw familyInboxError_('INVALID_CANDIDATE');
    return { date: familyInboxWorkerDate_(payload.date), items: items };
  }
  throw familyInboxError_('INVALID_CANDIDATE');
}

function familyInboxOpenCandidateLedger_(spreadsheetId) {
  let sheet;
  try { sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName(FAMILY_INBOX_CANDIDATE_SHEET_NAME); } catch (_) { throw familyInboxError_('CONFIGURATION_ERROR'); }
  if (!sheet || sheet.getLastRow() < 1 || sheet.getLastColumn() < 1) throw familyInboxError_('CONFIGURATION_ERROR');
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function(value) { return String(value || '').trim(); });
  if (FAMILY_INBOX_CANDIDATE_HEADERS.some(function(header) { return headers.indexOf(header) < 0; }) || headers.some(function(header, index) { return !header || headers.indexOf(header) !== index; })) throw familyInboxError_('CONFIGURATION_ERROR');
  return { sheet: sheet, headers: headers };
}

function familyInboxWorkerFindCandidateRows_(sheetState, publishRequestId) {
  const lastRow = sheetState.sheet.getLastRow();
  if (lastRow <= 1) return [];
  const values = sheetState.sheet.getRange(2, 1, lastRow - 1, sheetState.headers.length).getValues();
  return values.map(function(row, index) {
    return { rowNumber: index + 2, record: sheetState.headers.reduce(function(record, header, column) { record[header] = row[column]; return record; }, {}) };
  }).filter(function(entry) { return String(entry.record.publishRequestId || '') === publishRequestId; });
}

function familyInboxWorkerAppendCandidates_(sheetState, records) {
  const rows = records.map(function(record) { return sheetState.headers.map(function(header) { return Object.prototype.hasOwnProperty.call(record, header) ? record[header] : ''; }); });
  try { sheetState.sheet.getRange(sheetState.sheet.getLastRow() + 1, 1, rows.length, sheetState.headers.length).setValues(rows); } catch (_) { throw familyInboxError_('LEDGER_ERROR'); }
}

function familyInboxWorkerNewCandidateId_() {
  return 'cand_' + String(Utilities.getUuid()).replace(/-/g, '').toLowerCase();
}

function familyInboxWorkerStableStringify_(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(familyInboxWorkerStableStringify_).join(',') + ']';
  return '{' + Object.keys(value).sort().map(function(key) { return JSON.stringify(key) + ':' + familyInboxWorkerStableStringify_(value[key]); }).join(',') + '}';
}

function familyInboxWorkerStringArray_(value, maxItems, maxCharacters) {
  if (!Array.isArray(value) || value.length > maxItems) throw familyInboxError_('INVALID_CANDIDATE');
  return value.map(function(item) { return familyInboxWorkerRequiredText_(item, maxCharacters); });
}

function familyInboxWorkerRequiredText_(value, maxCharacters) {
  const text = String(value === undefined || value === null ? '' : value).trim();
  if (!text || Array.from(text).length > maxCharacters) throw familyInboxError_('INVALID_CANDIDATE');
  return text;
}

function familyInboxWorkerNullableText_(value, maxCharacters) {
  if (value === null) return null;
  return familyInboxWorkerRequiredText_(value, maxCharacters);
}

function familyInboxWorkerDate_(value) {
  const text = String(value || '');
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) throw familyInboxError_('INVALID_CANDIDATE');
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.getUTCFullYear() !== Number(match[1]) || date.getUTCMonth() !== Number(match[2]) - 1 || date.getUTCDate() !== Number(match[3])) throw familyInboxError_('INVALID_CANDIDATE');
  return text;
}

function familyInboxWorkerNullableDate_(value) {
  return value === null ? null : familyInboxWorkerDate_(value);
}

function familyInboxWorkerNullableTime_(value) {
  if (value === null) return null;
  const text = String(value || '');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) throw familyInboxError_('INVALID_CANDIDATE');
  return text;
}

function familyInboxWorkerInteger_(value, fallback) {
  const number = Number(value);
  return isFinite(number) && Math.floor(number) === number ? number : fallback;
}

function familyInboxWorkerBoundedInteger_(value, minimum, maximum) {
  const number = familyInboxWorkerInteger_(value, NaN);
  if (!isFinite(number) || number < minimum || number > maximum) throw familyInboxError_('INVALID_INPUT');
  return number;
}

function familyInboxWorkerBoolean_(value) {
  return value === true || String(value || '').toLowerCase() === 'true';
}

function familyInboxWorkerTime_(value) {
  const millis = new Date(String(value || '')).getTime();
  return isFinite(millis) ? millis : 0;
}

function familyInboxWorkerIso_(date) {
  return Utilities.formatDate(date, FAMILY_INBOX_TIME_ZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

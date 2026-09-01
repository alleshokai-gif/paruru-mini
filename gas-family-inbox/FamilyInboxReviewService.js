const FAMILY_INBOX_REVIEW_EXTRA_HEADERS = Object.freeze([
  'reviewPayloadJson', 'reviewedAt', 'reviewedByMemberId', 'reviewAction',
  'reviewReason', 'reviewNote', 'reviewRequestId', 'reviewHistoryJson',
]);
const FAMILY_INBOX_PC_REVIEW_CANDIDATE_HEADERS = Object.freeze([
  'reviewedByServiceId', 'reviewChannel', 'sourceReviewItemId',
]);
const FAMILY_INBOX_REVIEW_REASONS = Object.freeze({
  incorrect: true,
  duplicate: true,
  not_relevant: true,
  unreadable: true,
  other: true,
});
const FAMILY_INBOX_REVIEW_MAX_HISTORY = 20;
const FAMILY_INBOX_REVIEW_MAX_HISTORY_BYTES = 45000;
const FAMILY_INBOX_REVIEW_MAX_NOTE_CHARACTERS = 500;

function familyInboxListReviews_(body) {
  return familyInboxReviewRun_('familyInbox.listReviews', body, function(context) {
    familyInboxWorkerValidateKeys_(body, { operation: true, internalToken: true, homeId: true, traceId: true });
    const homeId = familyInboxRequiredIdentifier_(body.homeId);
    const items = familyInboxReviewListCore_(context, homeId);
    context.trace.candidateCount = items.reduce(function(total, item) { return total + item.candidateCount; }, 0);
    context.trace.status = 'completed';
    return { items: items };
  });
}

function familyInboxGetReview_(body) {
  return familyInboxReviewRun_('familyInbox.getReview', body, function(context) {
    familyInboxWorkerValidateKeys_(body, { operation: true, internalToken: true, homeId: true, inboxId: true, traceId: true });
    const homeId = familyInboxRequiredIdentifier_(body.homeId);
    const inboxId = familyInboxReviewInboxId_(body.inboxId);
    const detail = familyInboxReviewGetCore_(context, homeId, inboxId);
    context.trace.inboxId = inboxId;
    context.trace.candidateCount = detail.candidates.length;
    context.trace.status = detail.reviewStatus;
    return detail;
  });
}

function familyInboxUpdateCandidate_(body) {
  return familyInboxReviewMutateCandidate_('familyInbox.updateCandidate', 'updated', body);
}

function familyInboxApproveCandidate_(body) {
  return familyInboxReviewMutateCandidate_('familyInbox.approveCandidate', 'approved', body);
}

function familyInboxRejectCandidate_(body) {
  return familyInboxReviewMutateCandidate_('familyInbox.rejectCandidate', 'rejected', body);
}

function familyInboxReviewMutateCandidate_(operation, action, body) {
  return familyInboxReviewRun_(operation, body, function(context) {
    const input = familyInboxReviewMutationInput_(body, action);
    return familyInboxReviewMutateCandidateCore_(context, input);
  });
}

function familyInboxReviewListCore_(context, homeId) {
  const inboxLedger = familyInboxOpenLedger_(context.config.spreadsheetId);
  const candidateLedger = familyInboxReviewOpenCandidateLedger_(context.config.spreadsheetId);
  const candidateEntries = familyInboxReviewCandidateEntries_(candidateLedger);
  return familyInboxWorkerInboxEntries_(inboxLedger)
    .filter(function(entry) { return String(entry.record.homeId || '') === homeId && String(entry.record.status || '') === 'needs_review'; })
    .map(function(entry) {
      const matches = candidateEntries.filter(function(candidate) {
        return String(candidate.record.inboxId || '') === String(entry.record.inboxId || '') && String(candidate.record.homeId || '') === homeId;
      });
      if (matches.length) familyInboxReviewAssertPublishGroup_(matches);
      const typeSeen = {};
      const candidateTypes = [];
      matches.forEach(function(candidate) {
        const type = String(candidate.record.candidateType || '');
        if (!typeSeen[type]) { typeSeen[type] = true; candidateTypes.push(type); }
      });
      return {
        inboxId: String(entry.record.inboxId || ''), receivedAt: String(entry.record.receivedAt || ''),
        subjectMemberId: String(entry.record.subjectMemberHint || ''), originalName: String(entry.record.originalName || ''),
        candidateCount: matches.length, candidateTypes: candidateTypes, reviewStatus: familyInboxReviewAggregateStatus_(matches),
      };
    })
    .sort(function(left, right) { return String(right.receivedAt || '').localeCompare(String(left.receivedAt || '')); });
}

function familyInboxReviewGetCore_(context, homeId, inboxId) {
  const inboxLedger = familyInboxOpenLedger_(context.config.spreadsheetId);
  const inboxEntry = familyInboxReviewRequireInbox_(inboxLedger, homeId, inboxId);
  const candidateLedger = familyInboxReviewOpenCandidateLedger_(context.config.spreadsheetId);
  const candidates = familyInboxReviewCandidateEntries_(candidateLedger).filter(function(entry) {
    return String(entry.record.inboxId || '') === inboxId && String(entry.record.homeId || '') === homeId;
  });
  if (!candidates.length) throw familyInboxError_('NOT_FOUND');
  familyInboxReviewAssertPublishGroup_(candidates);
  return familyInboxReviewDetailDto_(inboxEntry, candidates);
}

function familyInboxReviewMutateCandidateCore_(context, input) {
  let lock;
  try {
    lock = LockService.getScriptLock();
    lock.waitLock(30000);
    const inboxLedger = familyInboxOpenLedger_(context.config.spreadsheetId);
    familyInboxReviewRequireInbox_(inboxLedger, input.homeId, input.inboxId);
    const candidateLedger = familyInboxReviewOpenCandidateLedger_(context.config.spreadsheetId, input.reviewChannel === 'pc_backoffice');
    const inboxCandidates = familyInboxReviewCandidateEntries_(candidateLedger).filter(function(entry) {
      return String(entry.record.inboxId || '') === input.inboxId && String(entry.record.homeId || '') === input.homeId;
    });
    if (!inboxCandidates.length) throw familyInboxError_('NOT_FOUND');
    familyInboxReviewAssertPublishGroup_(inboxCandidates);
    const entry = inboxCandidates.find(function(candidate) { return String(candidate.record.candidateId || '') === input.candidateId; });
    if (!entry) throw familyInboxError_('NOT_FOUND');
    const requestDigest = familyInboxReviewRequestDigest_(input);
    const history = familyInboxReviewHistory_(entry.record.reviewHistoryJson);
    const replay = history.find(function(event) { return String(event.reviewRequestId || '') === input.reviewRequestId; });
    if (replay) {
      if (String(replay.requestDigest || '') !== requestDigest || String(replay.action || '') !== input.action) throw familyInboxError_('IDEMPOTENCY_CONFLICT');
      return { candidate: familyInboxReviewCandidateDto_(entry.record), reviewStatus: familyInboxReviewAggregateStatus_(inboxCandidates), idempotency: { replayed: true } };
    }
    const currentRevision = familyInboxWorkerInteger_(entry.record.revision, -1);
    if (currentRevision !== input.revision) throw familyInboxError_('REVISION_CONFLICT');
    if (String(entry.record.reviewStatus || 'pending') !== 'pending') throw familyInboxError_('INVALID_STATE');
    if (history.length >= FAMILY_INBOX_REVIEW_MAX_HISTORY) throw familyInboxError_('INVALID_STATE');
    const previousPayload = familyInboxReviewEffectivePayload_(entry.record);
    const correctionValidator = input.reviewChannel === 'pc_backoffice'
      ? familyInboxPcReviewValidateCanonicalCorrection_
      : familyInboxReviewValidateCorrection_;
    const nextPayload = input.action === 'updated' || (input.action === 'approved' && input.payload)
      ? correctionValidator(String(entry.record.candidateType || ''), previousPayload, input.payload)
      : previousPayload;
    const now = familyInboxNow_();
    const nextRevision = currentRevision + 1;
    const nextReviewStatus = input.action === 'approved' ? 'approved' : input.action === 'rejected' ? 'rejected' : 'pending';
    const event = {
      revision: nextRevision, action: input.action, reviewRequestId: input.reviewRequestId, requestDigest: requestDigest,
      reviewedAt: now, reviewedByMemberId: input.reviewedByMemberId || '', reviewedByServiceId: input.reviewedByServiceId || '',
      reviewChannel: input.reviewChannel || 'paluru', reviewReason: input.reviewReason, reviewNote: input.reviewNote,
      previousReviewStatus: String(entry.record.reviewStatus || 'pending'), reviewStatus: nextReviewStatus,
      previousPayload: previousPayload, payload: nextPayload,
    };
    const historyJson = JSON.stringify(history.concat([event]));
    if (Utilities.newBlob(historyJson).getBytes().length > FAMILY_INBOX_REVIEW_MAX_HISTORY_BYTES) throw familyInboxError_('INVALID_STATE');
    const updates = {
      revision: nextRevision, updatedAt: now, reviewStatus: nextReviewStatus, reviewPayloadJson: JSON.stringify(nextPayload),
      reviewedAt: input.action === 'updated' ? '' : now, reviewedByMemberId: input.reviewedByMemberId || '', reviewAction: input.action,
      reviewReason: input.reviewReason, reviewNote: input.reviewNote, reviewRequestId: input.reviewRequestId, reviewHistoryJson: historyJson,
    };
    if (candidateLedger.headers.indexOf('reviewedByServiceId') >= 0) updates.reviewedByServiceId = input.reviewedByServiceId || '';
    if (candidateLedger.headers.indexOf('reviewChannel') >= 0) updates.reviewChannel = input.reviewChannel || 'paluru';
    familyInboxReviewUpdateCandidateRow_(candidateLedger, entry, updates);
    context.trace.inboxId = input.inboxId;
    context.trace.status = familyInboxReviewAggregateStatus_(inboxCandidates);
    return { candidate: familyInboxReviewCandidateDto_(entry.record), reviewStatus: familyInboxReviewAggregateStatus_(inboxCandidates), idempotency: { replayed: false } };
  } finally {
    if (lock) { try { lock.releaseLock(); } catch (_) {} }
  }
}

function familyInboxReviewRun_(operation, body, action) {
  const startedAt = Date.now();
  const trace = familyInboxTraceFromBody_(body, operation);
  try {
    familyInboxAuthenticate_(body);
    const config = familyInboxLoadConfig_();
    const result = action({ config: config, trace: trace });
    familyInboxLog_(Object.assign(trace, { stage: 'completed', durationMs: Date.now() - startedAt }));
    return result;
  } catch (error) {
    familyInboxLog_(Object.assign(trace, { stage: 'failed', status: 'failed', errorCode: familyInboxSafeErrorCode_(error), durationMs: Date.now() - startedAt }));
    throw error;
  }
}

function familyInboxReviewMutationInput_(body, action) {
  const allowed = {
    operation: true, internalToken: true, homeId: true, reviewedByMemberId: true,
    inboxId: true, candidateId: true, revision: true, reviewRequestId: true,
    payload: true, reviewReason: true, reviewNote: true, traceId: true,
  };
  familyInboxWorkerValidateKeys_(body, allowed);
  const hasPayload = Object.prototype.hasOwnProperty.call(body, 'payload');
  const hasReason = Object.prototype.hasOwnProperty.call(body, 'reviewReason');
  if ((action === 'updated') !== hasPayload || (action === 'rejected') !== hasReason) throw familyInboxError_('INVALID_INPUT');
  const homeId = familyInboxRequiredIdentifier_(body.homeId);
  const reviewedByMemberId = familyInboxRequiredIdentifier_(body.reviewedByMemberId);
  const inboxId = familyInboxReviewInboxId_(body.inboxId);
  const candidateId = String(body.candidateId || '').trim();
  if (!/^cand_[0-9a-f]{32}$/i.test(candidateId)) throw familyInboxError_('INVALID_INPUT');
  const revision = familyInboxWorkerInteger_(body.revision, -1);
  if (revision < 1 || Number(body.revision) !== revision) throw familyInboxError_('INVALID_INPUT');
  const reviewRequestId = String(body.reviewRequestId || '').trim();
  if (!familyInboxUuid_(reviewRequestId)) throw familyInboxError_('INVALID_INPUT');
  const reviewNote = String(body.reviewNote || '').trim();
  if (Array.from(reviewNote).length > FAMILY_INBOX_REVIEW_MAX_NOTE_CHARACTERS) throw familyInboxError_('INVALID_INPUT');
  const reviewReason = action === 'rejected' ? String(body.reviewReason || '').trim() : '';
  if (action === 'rejected' && !FAMILY_INBOX_REVIEW_REASONS[reviewReason]) throw familyInboxError_('INVALID_INPUT');
  return {
    action: action,
    homeId: homeId,
    reviewedByMemberId: reviewedByMemberId,
    reviewedByServiceId: '',
    reviewChannel: 'paluru',
    inboxId: inboxId,
    candidateId: candidateId,
    revision: revision,
    reviewRequestId: reviewRequestId,
    payload: hasPayload ? body.payload : null,
    reviewReason: reviewReason,
    reviewNote: reviewNote,
  };
}

function familyInboxReviewOpenCandidateLedger_(spreadsheetId, requirePcHeaders) {
  const state = familyInboxOpenCandidateLedger_(spreadsheetId);
  if (FAMILY_INBOX_REVIEW_EXTRA_HEADERS.some(function(header) { return state.headers.indexOf(header) < 0; })) throw familyInboxError_('CONFIGURATION_ERROR');
  if (requirePcHeaders && FAMILY_INBOX_PC_REVIEW_CANDIDATE_HEADERS.some(function(header) { return state.headers.indexOf(header) < 0; })) throw familyInboxError_('CONFIGURATION_ERROR');
  return state;
}

function familyInboxReviewCandidateEntries_(sheetState) {
  const lastRow = sheetState.sheet.getLastRow();
  if (lastRow <= 1) return [];
  const values = sheetState.sheet.getRange(2, 1, lastRow - 1, sheetState.headers.length).getValues();
  return values.map(function(row, index) {
    return {
      rowNumber: index + 2,
      record: sheetState.headers.reduce(function(record, header, column) {
        record[header] = row[column];
        return record;
      }, {}),
    };
  });
}

function familyInboxReviewRequireInbox_(sheetState, homeId, inboxId) {
  const entry = familyInboxWorkerInboxEntries_(sheetState).find(function(candidate) {
    return String(candidate.record.inboxId || '') === inboxId && String(candidate.record.homeId || '') === homeId;
  });
  if (!entry) throw familyInboxError_('NOT_FOUND');
  if (String(entry.record.status || '') !== 'needs_review') throw familyInboxError_('INVALID_STATE');
  return entry;
}

function familyInboxReviewAssertPublishGroup_(entries) {
  const group = {};
  entries.forEach(function(entry) {
    const publishRequestId = String(entry.record.publishRequestId || '');
    const payloadDigest = String(entry.record.payloadDigest || '');
    const claimVersion = String(entry.record.claimVersion || '');
    group[publishRequestId + '|' + payloadDigest + '|' + claimVersion] = true;
  });
  if (Object.keys(group).length !== 1) throw familyInboxError_('DATA_INTEGRITY_ERROR');
}

function familyInboxReviewAggregateStatus_(entries) {
  if (!entries.length) return 'pending';
  return entries.every(function(entry) {
    const status = String(entry.record.reviewStatus || 'pending');
    return status === 'approved' || status === 'rejected';
  }) ? 'reviewed' : 'pending';
}

function familyInboxReviewDetailDto_(inboxEntry, candidates) {
  return {
    inboxId: String(inboxEntry.record.inboxId || ''),
    subjectMemberId: String(inboxEntry.record.subjectMemberHint || ''),
    reviewStatus: familyInboxReviewAggregateStatus_(candidates),
    document: {
      originalName: String(inboxEntry.record.originalName || ''),
      receivedAt: String(inboxEntry.record.receivedAt || ''),
    },
    candidates: candidates.map(function(entry) { return familyInboxReviewCandidateDto_(entry.record); }),
  };
}

function familyInboxReviewCandidateDto_(record) {
  return {
    candidateId: String(record.candidateId || ''),
    candidateType: String(record.candidateType || ''),
    revision: familyInboxWorkerInteger_(record.revision, 1),
    confidence: Number(record.confidence),
    payload: familyInboxReviewEffectivePayload_(record),
    evidenceSummary: familyInboxReviewEvidenceSummary_(record.evidenceJson),
    warnings: familyInboxReviewJsonArray_(record.warningsJson),
    questions: familyInboxReviewJsonArray_(record.questionsJson),
    reviewStatus: String(record.reviewStatus || 'pending'),
    reviewedAt: String(record.reviewedAt || ''),
    reviewAction: String(record.reviewAction || ''),
    reviewReason: String(record.reviewReason || ''),
  };
}

function familyInboxReviewEvidenceSummary_(value) {
  return familyInboxReviewJsonArray_(value).slice(0, 2).map(function(item) {
    if (!familyInboxPlainObject_(item)) return null;
    const quote = Array.from(String(item.quote || '')).slice(0, 120).join('');
    const fieldPaths = Array.isArray(item.fieldPaths) ? item.fieldPaths.slice(0, 3).map(String) : [];
    return quote ? { page: familyInboxWorkerInteger_(item.page, 1), quote: quote, fieldPaths: fieldPaths } : null;
  }).filter(Boolean);
}

function familyInboxReviewEffectivePayload_(record) {
  const reviewed = String(record.reviewPayloadJson || '').trim();
  const parsed = familyInboxReviewJsonObject_(reviewed || record.payloadJson);
  if (!parsed) throw familyInboxError_('DATA_INTEGRITY_ERROR');
  return parsed;
}

function familyInboxReviewValidateCorrection_(candidateType, current, supplied) {
  if (!familyInboxPlainObject_(supplied)) throw familyInboxError_('INVALID_INPUT');
  if (candidateType === 'schedule.event') {
    familyInboxWorkerValidateKeys_(supplied, { title: true, date: true, startTime: true, endTime: true, location: true });
    return Object.assign({}, current, {
      title: familyInboxWorkerRequiredText_(supplied.title, 200),
      date: familyInboxWorkerDate_(supplied.date),
      startTime: familyInboxWorkerNullableTime_(supplied.startTime),
      endTime: familyInboxWorkerNullableTime_(supplied.endTime),
      location: familyInboxWorkerNullableText_(supplied.location, 200),
    });
  }
  if (candidateType === 'school.document') {
    familyInboxWorkerValidateKeys_(supplied, { title: true, documentDate: true, documentType: true });
    const documentType = String(supplied.documentType || '');
    if (['notice', 'schedule', 'deadline', 'belongings', 'other'].indexOf(documentType) < 0) throw familyInboxError_('INVALID_INPUT');
    return Object.assign({}, current, {
      title: familyInboxWorkerRequiredText_(supplied.title, 200),
      documentDate: familyInboxWorkerNullableDate_(supplied.documentDate),
      documentType: documentType,
    });
  }
  if (candidateType === 'school.belongings') {
    familyInboxWorkerValidateKeys_(supplied, { date: true, items: true });
    const items = familyInboxWorkerStringArray_(supplied.items, 20, 100);
    if (!items.length) throw familyInboxError_('INVALID_INPUT');
    return Object.assign({}, current, { date: familyInboxWorkerDate_(supplied.date), items: items });
  }
  if (candidateType === 'school.deadline') {
    familyInboxWorkerValidateKeys_(supplied, { title: true, dueDate: true, dueTime: true, actionRequired: true });
    return Object.assign({}, current, {
      title: familyInboxWorkerRequiredText_(supplied.title, 200),
      dueDate: familyInboxWorkerDate_(supplied.dueDate),
      dueTime: familyInboxWorkerNullableTime_(supplied.dueTime),
      actionRequired: familyInboxWorkerRequiredText_(supplied.actionRequired, 500),
    });
  }
  throw familyInboxError_('INVALID_CANDIDATE');
}

function familyInboxReviewUpdateCandidateRow_(sheetState, entry, updates) {
  const row = sheetState.sheet.getRange(entry.rowNumber, 1, 1, sheetState.headers.length).getValues()[0];
  Object.keys(updates).forEach(function(header) {
    const column = sheetState.headers.indexOf(header);
    if (column < 0) throw familyInboxError_('CONFIGURATION_ERROR');
    row[column] = updates[header];
    entry.record[header] = updates[header];
  });
  try { sheetState.sheet.getRange(entry.rowNumber, 1, 1, sheetState.headers.length).setValues([row]); } catch (_) { throw familyInboxError_('LEDGER_ERROR'); }
}

function familyInboxReviewHistory_(value) {
  if (!String(value || '').trim()) return [];
  const parsed = familyInboxReviewJsonArray_(value);
  if (parsed.length > FAMILY_INBOX_REVIEW_MAX_HISTORY) throw familyInboxError_('DATA_INTEGRITY_ERROR');
  return parsed;
}

function familyInboxReviewJsonArray_(value) {
  try {
    const parsed = JSON.parse(String(value || '[]'));
    if (!Array.isArray(parsed)) throw new Error('not array');
    return parsed;
  } catch (_) {
    throw familyInboxError_('DATA_INTEGRITY_ERROR');
  }
}

function familyInboxReviewJsonObject_(value) {
  try {
    const parsed = JSON.parse(String(value || ''));
    return familyInboxPlainObject_(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

function familyInboxReviewRequestDigest_(input) {
  const digestible = {
    action: input.action,
    inboxId: input.inboxId,
    candidateId: input.candidateId,
    revision: input.revision,
    payload: input.payload,
    reviewReason: input.reviewReason,
    reviewNote: input.reviewNote,
    reviewedByServiceId: input.reviewedByServiceId || '',
    reviewChannel: input.reviewChannel || 'paluru',
  };
  return familyInboxSha256_(Utilities.newBlob(familyInboxWorkerStableStringify_(digestible)).getBytes());
}

function familyInboxReviewInboxId_(value) {
  const inboxId = String(value || '').trim();
  if (!/^inb_[0-9a-f]{32}$/i.test(inboxId)) throw familyInboxError_('INVALID_INPUT');
  return inboxId;
}

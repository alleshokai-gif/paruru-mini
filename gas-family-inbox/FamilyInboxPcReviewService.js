const FAMILY_INBOX_PC_REVIEW_PROPERTIES = Object.freeze({
  token: 'FAMILY_INBOX_PC_REVIEW_TOKEN',
  reviewId: 'FAMILY_INBOX_PC_REVIEW_ID',
});
const FAMILY_INBOX_PC_REVIEW_SHEET_NAME = 'Family_Review_Items';
const FAMILY_INBOX_PC_REVIEW_HEADERS = Object.freeze([
  'schemaVersion', 'reviewItemId', 'inboxId', 'homeId', 'reviewType', 'candidateType',
  'revision', 'status', 'createdAt', 'updatedAt', 'subjectMemberId', 'confidence',
  'sourceSha256', 'profile', 'model', 'extractorVersion', 'promptVersion', 'payloadDigest',
  'payloadJson', 'reviewPayloadJson', 'evidenceJson', 'warningsJson', 'questionsJson',
  'publishRequestId', 'claimVersion', 'fragmentCount', 'inputTokens', 'outputTokens',
  'durationMs', 'reviewedAt', 'reviewedByServiceId', 'reviewChannel', 'reviewAction',
  'reviewReason', 'reviewNote', 'reviewRequestId', 'reviewHistoryJson', 'promotedCandidateId',
]);
const FAMILY_INBOX_PC_REVIEW_SCHEMA_VERSION = 'page-fragment/1.0';

function familyInboxPcReviewList_(body) {
  return familyInboxPcReviewRun_('familyInbox.pcReview.list', body, function(context) {
    familyInboxWorkerValidateKeys_(body, { operation: true, pcReviewToken: true, traceId: true });
    const inboxLedger = familyInboxOpenLedger_(context.config.spreadsheetId);
    const candidateLedger = familyInboxReviewOpenCandidateLedger_(context.config.spreadsheetId, true);
    const itemLedger = familyInboxPcReviewOpenItemLedger_(context.config.spreadsheetId);
    const candidates = familyInboxReviewCandidateEntries_(candidateLedger);
    const reviewItems = familyInboxPcReviewEntries_(itemLedger);
    const batches = familyInboxWorkerInboxEntries_(inboxLedger)
      .filter(function(entry) { return String(entry.record.homeId || '') === context.identity.homeId && String(entry.record.status || '') === 'needs_review'; })
      .map(function(entry) {
        const inboxId = String(entry.record.inboxId || '');
        const candidateMatches = candidates.filter(function(item) { return String(item.record.inboxId || '') === inboxId && String(item.record.homeId || '') === context.identity.homeId; });
        const reviewMatches = reviewItems.filter(function(item) { return String(item.record.inboxId || '') === inboxId && String(item.record.homeId || '') === context.identity.homeId; });
        if (!candidateMatches.length && !reviewMatches.length) return null;
        const group = familyInboxPcReviewAssertGroup_(candidateMatches, reviewMatches);
        return {
          batchId: inboxId,
          inboxId: inboxId,
          subjectMemberId: String(entry.record.subjectMemberHint || ''),
          originalName: String(entry.record.originalName || ''),
          receivedAt: String(entry.record.receivedAt || ''),
          profile: group.profile,
          candidateCount: candidateMatches.length,
          reviewItemCount: reviewMatches.length,
          reviewedCount: familyInboxPcReviewReviewedCount_(candidateMatches, reviewMatches),
          status: familyInboxPcReviewAggregateStatus_(candidateMatches, reviewMatches),
        };
      })
      .filter(Boolean)
      .sort(function(left, right) { return String(right.receivedAt || '').localeCompare(String(left.receivedAt || '')); });
    context.trace.candidateCount = batches.reduce(function(total, batch) { return total + batch.candidateCount; }, 0);
    context.trace.reviewItemCount = batches.reduce(function(total, batch) { return total + batch.reviewItemCount; }, 0);
    context.trace.status = 'completed';
    return { batches: batches };
  });
}

function familyInboxPcReviewGet_(body) {
  return familyInboxPcReviewRun_('familyInbox.pcReview.get', body, function(context) {
    familyInboxWorkerValidateKeys_(body, { operation: true, pcReviewToken: true, inboxId: true, traceId: true });
    const inboxId = familyInboxReviewInboxId_(body.inboxId);
    const inboxLedger = familyInboxOpenLedger_(context.config.spreadsheetId);
    const inboxEntry = familyInboxReviewRequireInbox_(inboxLedger, context.identity.homeId, inboxId);
    const candidateLedger = familyInboxReviewOpenCandidateLedger_(context.config.spreadsheetId, true);
    const itemLedger = familyInboxPcReviewOpenItemLedger_(context.config.spreadsheetId);
    const candidates = familyInboxReviewCandidateEntries_(candidateLedger).filter(function(item) {
      return String(item.record.inboxId || '') === inboxId && String(item.record.homeId || '') === context.identity.homeId;
    });
    const reviewItems = familyInboxPcReviewEntries_(itemLedger).filter(function(item) {
      return String(item.record.inboxId || '') === inboxId && String(item.record.homeId || '') === context.identity.homeId;
    });
    if (!candidates.length && !reviewItems.length) throw familyInboxError_('NOT_FOUND');
    const group = familyInboxPcReviewAssertGroup_(candidates, reviewItems);
    const items = reviewItems.map(function(entry) { return familyInboxPcReviewItemDto_(entry.record); })
      .concat(candidates.map(function(entry) { return familyInboxPcReviewCandidateDto_(entry.record); }))
      .sort(familyInboxPcReviewItemSort_);
    context.trace.inboxId = inboxId;
    context.trace.candidateCount = candidates.length;
    context.trace.reviewItemCount = reviewItems.length;
    context.trace.status = familyInboxPcReviewAggregateStatus_(candidates, reviewItems);
    return {
      batchId: inboxId,
      inboxId: inboxId,
      subjectMemberId: String(inboxEntry.record.subjectMemberHint || ''),
      originalName: String(inboxEntry.record.originalName || ''),
      receivedAt: String(inboxEntry.record.receivedAt || ''),
      profile: group.profile,
      status: familyInboxPcReviewAggregateStatus_(candidates, reviewItems),
      items: items,
    };
  });
}

function familyInboxPcReviewUpdate_(body) { return familyInboxPcReviewMutate_('familyInbox.pcReview.update', 'updated', body); }
function familyInboxPcReviewApprove_(body) { return familyInboxPcReviewMutate_('familyInbox.pcReview.approve', 'approved', body); }
function familyInboxPcReviewReject_(body) { return familyInboxPcReviewMutate_('familyInbox.pcReview.reject', 'rejected', body); }

function familyInboxPcReviewMutate_(operation, action, body) {
  return familyInboxPcReviewRun_(operation, body, function(context) {
    const input = familyInboxPcReviewMutationInput_(body, action, context.identity);
    let result;
    if (/^cand_/i.test(input.itemId)) {
      result = familyInboxReviewMutateCandidateCore_(context, {
        action: action,
        homeId: context.identity.homeId,
        reviewedByMemberId: '',
        reviewedByServiceId: context.identity.reviewId,
        reviewChannel: 'pc_backoffice',
        inboxId: input.inboxId,
        candidateId: input.itemId,
        revision: input.revision,
        reviewRequestId: input.reviewRequestId,
        payload: input.payload,
        reviewReason: input.reviewReason,
        reviewNote: input.reviewNote,
      });
    } else {
      result = familyInboxPcReviewMutateItemCore_(context, input);
    }
    context.trace.inboxId = input.inboxId;
    context.trace.status = 'completed';
    return result;
  });
}

function familyInboxPcReviewBulkApprove_(body) {
  return familyInboxPcReviewRun_('familyInbox.pcReview.bulkApproveCanonical', body, function(context) {
    familyInboxWorkerValidateKeys_(body, { operation: true, pcReviewToken: true, inboxId: true, items: true, reviewRequestId: true, reviewNote: true, traceId: true });
    const inboxId = familyInboxReviewInboxId_(body.inboxId);
    if (!Array.isArray(body.items) || !body.items.length || body.items.length > 40) throw familyInboxError_('INVALID_INPUT');
    const requestId = familyInboxPcReviewRequestId_(body.reviewRequestId);
    const reviewNote = familyInboxPcReviewNote_(body.reviewNote);
    const seen = {};
    const inputs = body.items.map(function(item) {
      familyInboxWorkerValidateKeys_(item, { candidateId: true, revision: true });
      const candidateId = String(item.candidateId || '').trim();
      if (!/^cand_[0-9a-f]{32}$/i.test(candidateId) || seen[candidateId]) throw familyInboxError_('INVALID_INPUT');
      seen[candidateId] = true;
      const revision = familyInboxWorkerInteger_(item.revision, -1);
      if (revision < 1 || Number(item.revision) !== revision) throw familyInboxError_('INVALID_INPUT');
      return { candidateId: candidateId, revision: revision };
    });
    const results = inputs.map(function(item) {
      return familyInboxReviewMutateCandidateCore_(context, {
        action: 'approved', homeId: context.identity.homeId, reviewedByMemberId: '', reviewedByServiceId: context.identity.reviewId,
        reviewChannel: 'pc_backoffice', inboxId: inboxId, candidateId: item.candidateId, revision: item.revision,
        reviewRequestId: requestId, payload: null, reviewReason: '', reviewNote: reviewNote,
      });
    });
    context.trace.inboxId = inboxId;
    context.trace.candidateCount = results.length;
    context.trace.status = 'completed';
    return { results: results, idempotency: { replayable: true } };
  });
}

function familyInboxPcReviewRun_(operation, body, action) {
  const startedAt = Date.now();
  const trace = familyInboxTraceFromBody_(body, operation);
  try {
    const authenticated = familyInboxPcReviewAuthenticate_(body);
    const config = familyInboxLoadConfig_();
    const identity = {
      reviewId: authenticated.reviewId,
      homeId: familyInboxPcReviewResolveHomeId_(config.spreadsheetId),
    };
    const result = action({ identity: identity, config: config, trace: trace });
    familyInboxLog_(Object.assign(trace, { stage: 'completed', durationMs: Date.now() - startedAt }));
    return result;
  } catch (error) {
    familyInboxLog_(Object.assign(trace, { stage: 'failed', status: 'failed', errorCode: familyInboxSafeErrorCode_(error), durationMs: Date.now() - startedAt }));
    throw error;
  }
}

function familyInboxPcReviewAuthenticate_(body) {
  const properties = PropertiesService.getScriptProperties();
  const expected = String(properties.getProperty(FAMILY_INBOX_PC_REVIEW_PROPERTIES.token) || '');
  const reviewId = String(properties.getProperty(FAMILY_INBOX_PC_REVIEW_PROPERTIES.reviewId) || '').trim();
  if (!expected || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,63}$/.test(reviewId)) throw familyInboxError_('CONFIGURATION_ERROR');
  const actual = String(body && body.pcReviewToken || '');
  if (!actual || !familyInboxConstantTimeEquals_(expected, actual)) throw familyInboxError_('FORBIDDEN');
  return { reviewId: reviewId };
}

function familyInboxPcReviewResolveHomeId_(spreadsheetId) {
  const ledger = familyInboxOpenLedger_(spreadsheetId);
  const entries = familyInboxWorkerInboxEntries_(ledger);
  const homeIds = [];
  entries.forEach(function(entry) {
    let homeId;
    try { homeId = familyInboxRequiredIdentifier_(entry.record.homeId); } catch (_) { throw familyInboxError_('CONFIGURATION_ERROR'); }
    if (homeIds.indexOf(homeId) < 0) homeIds.push(homeId);
  });
  if (homeIds.length !== 1) throw familyInboxError_('CONFIGURATION_ERROR');
  return homeIds[0];
}

function familyInboxPcReviewOpenItemLedger_(spreadsheetId) {
  let sheet;
  try { sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName(FAMILY_INBOX_PC_REVIEW_SHEET_NAME); } catch (_) { throw familyInboxError_('CONFIGURATION_ERROR'); }
  if (!sheet || sheet.getLastRow() < 1 || sheet.getLastColumn() < 1) throw familyInboxError_('CONFIGURATION_ERROR');
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function(value) { return String(value || '').trim(); });
  if (FAMILY_INBOX_PC_REVIEW_HEADERS.some(function(header) { return headers.indexOf(header) < 0; }) || headers.some(function(header, index) { return !header || headers.indexOf(header) !== index; })) throw familyInboxError_('CONFIGURATION_ERROR');
  return { sheet: sheet, headers: headers };
}

function familyInboxPcReviewEntries_(sheetState) {
  const lastRow = sheetState.sheet.getLastRow();
  if (lastRow <= 1) return [];
  const values = sheetState.sheet.getRange(2, 1, lastRow - 1, sheetState.headers.length).getValues();
  return values.map(function(row, index) {
    return { rowNumber: index + 2, record: sheetState.headers.reduce(function(record, header, column) { record[header] = row[column]; return record; }, {}) };
  });
}

function familyInboxPcReviewFindItemRows_(sheetState, publishRequestId) {
  return familyInboxPcReviewEntries_(sheetState).filter(function(entry) { return String(entry.record.publishRequestId || '') === publishRequestId; });
}

function familyInboxPcReviewAppendItems_(sheetState, records) {
  const rows = records.map(function(record) { return sheetState.headers.map(function(header) { return Object.prototype.hasOwnProperty.call(record, header) ? record[header] : ''; }); });
  try { sheetState.sheet.getRange(sheetState.sheet.getLastRow() + 1, 1, rows.length, sheetState.headers.length).setValues(rows); } catch (_) { throw familyInboxError_('LEDGER_ERROR'); }
}

function familyInboxPcReviewRowsFromPublish_(input, inboxEntry, now) {
  return input.reviewItems.map(function(item, index) {
    return {
      schemaVersion: FAMILY_INBOX_PC_REVIEW_SCHEMA_VERSION,
      reviewItemId: familyInboxPcReviewDeterministicItemId_(input.publishRequestId, index, item.candidateType),
      inboxId: input.inboxId,
      homeId: String(inboxEntry.record.homeId || ''),
      reviewType: item.reviewType,
      candidateType: item.candidateType,
      revision: 1,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      subjectMemberId: String(inboxEntry.record.subjectMemberHint || ''),
      confidence: item.confidence,
      sourceSha256: String(inboxEntry.record.sha256 || ''),
      profile: input.profile.profile,
      model: input.profile.model,
      extractorVersion: input.profile.extractorVersion,
      promptVersion: input.profile.promptVersion,
      payloadDigest: input.payloadDigest,
      payloadJson: JSON.stringify(item.payload),
      reviewPayloadJson: '',
      evidenceJson: JSON.stringify(item.evidence),
      warningsJson: JSON.stringify(item.warnings),
      questionsJson: JSON.stringify(item.questions),
      publishRequestId: input.publishRequestId,
      claimVersion: input.claimVersion,
      fragmentCount: item.fragmentCount,
      inputTokens: input.usage.inputTokens,
      outputTokens: input.usage.outputTokens,
      durationMs: input.durationMs,
      reviewedAt: '', reviewedByServiceId: '', reviewChannel: '', reviewAction: '', reviewReason: '', reviewNote: '',
      reviewRequestId: '', reviewHistoryJson: '', promotedCandidateId: '',
    };
  });
}

function familyInboxPcReviewDeterministicItemId_(publishRequestId, index, candidateType) {
  const digest = familyInboxSha256_(Utilities.newBlob(String(publishRequestId) + '|' + String(index) + '|' + String(candidateType)).getBytes());
  return 'rvi_' + digest.slice(0, 32);
}

function familyInboxPcReviewValidatePublishedItem_(value) {
  familyInboxWorkerValidateKeys_(value, {
    reviewType: true, status: true, candidateType: true, confidence: true, fragmentCount: true,
    evidence: true, warnings: true, questions: true, payload: true,
  });
  if (String(value.reviewType || '') !== 'page_fragment' || String(value.status || '') !== 'needs_review') throw familyInboxError_('INVALID_CANDIDATE');
  const candidateType = String(value.candidateType || '');
  const confidence = Number(value.confidence);
  if (!isFinite(confidence) || confidence < 0 || confidence > 1) throw familyInboxError_('INVALID_CANDIDATE');
  const fragmentCount = familyInboxWorkerBoundedInteger_(value.fragmentCount, 1, FAMILY_INBOX_LONG_MAX_ITEMS);
  return {
    reviewType: 'page_fragment', status: 'needs_review', candidateType: candidateType, confidence: confidence, fragmentCount: fragmentCount,
    evidence: familyInboxWorkerValidateEvidence_(value.evidence),
    warnings: familyInboxWorkerStringArray_(value.warnings, 10, 200),
    questions: familyInboxWorkerStringArray_(value.questions, 10, 200),
    payload: familyInboxPcReviewValidateFragmentPayload_(candidateType, value.payload),
  };
}

function familyInboxPcReviewValidateFragmentPayload_(candidateType, payload) {
  if (!familyInboxPlainObject_(payload)) throw familyInboxError_('INVALID_CANDIDATE');
  if (candidateType === 'schedule.event') {
    familyInboxWorkerValidateKeys_(payload, { title: true, date: true, startTime: true, endTime: true, location: true, notes: true });
    return {
      title: familyInboxWorkerRequiredText_(payload.title, 200), date: familyInboxWorkerNullableDate_(payload.date),
      startTime: familyInboxWorkerNullableTime_(payload.startTime), endTime: familyInboxWorkerNullableTime_(payload.endTime),
      location: familyInboxWorkerNullableText_(payload.location, 200), notes: familyInboxWorkerNullableText_(payload.notes, 500),
    };
  }
  if (candidateType === 'school.deadline') {
    familyInboxWorkerValidateKeys_(payload, { title: true, dueDate: true, actionRequired: true });
    return {
      title: familyInboxWorkerRequiredText_(payload.title, 200), dueDate: familyInboxWorkerNullableDate_(payload.dueDate),
      actionRequired: familyInboxWorkerNullableText_(payload.actionRequired, 500),
    };
  }
  if (candidateType === 'school.belongings') {
    familyInboxWorkerValidateKeys_(payload, { date: true, items: true, relatedEventTitle: true });
    const items = familyInboxWorkerStringArray_(payload.items, 20, 100);
    if (!items.length) throw familyInboxError_('INVALID_CANDIDATE');
    return {
      date: familyInboxWorkerNullableDate_(payload.date), items: items,
      relatedEventTitle: familyInboxWorkerNullableText_(payload.relatedEventTitle, 200),
    };
  }
  if (candidateType === 'school.dismissal_time') {
    familyInboxWorkerValidateKeys_(payload, { date: true, dismissalTime: true, targetGrade: true });
    const targetGrade = Number(payload.targetGrade);
    if (!isFinite(targetGrade) || Math.floor(targetGrade) !== targetGrade || targetGrade < 1 || targetGrade > 6) throw familyInboxError_('INVALID_CANDIDATE');
    const dismissalTime = familyInboxWorkerNullableTime_(payload.dismissalTime);
    if (dismissalTime === null) throw familyInboxError_('INVALID_CANDIDATE');
    return {
      date: familyInboxWorkerDate_(payload.date), dismissalTime: dismissalTime, targetGrade: targetGrade,
    };
  }
  throw familyInboxError_('INVALID_CANDIDATE');
}

function familyInboxPcReviewMutationInput_(body, action, identity) {
  familyInboxWorkerValidateKeys_(body, {
    operation: true, pcReviewToken: true, inboxId: true, itemId: true, revision: true,
    reviewRequestId: true, payload: true, reviewReason: true, reviewNote: true, traceId: true,
  });
  const hasPayload = Object.prototype.hasOwnProperty.call(body, 'payload');
  const hasReason = Object.prototype.hasOwnProperty.call(body, 'reviewReason');
  if ((action !== 'rejected') !== hasPayload || (action === 'rejected') !== hasReason) throw familyInboxError_('INVALID_INPUT');
  const itemId = String(body.itemId || '').trim();
  if (!/^(?:cand|rvi)_[0-9a-f]{32}$/i.test(itemId)) throw familyInboxError_('INVALID_INPUT');
  const revision = familyInboxWorkerInteger_(body.revision, -1);
  if (revision < 1 || Number(body.revision) !== revision) throw familyInboxError_('INVALID_INPUT');
  const reviewReason = action === 'rejected' ? String(body.reviewReason || '').trim() : '';
  if (action === 'rejected' && !FAMILY_INBOX_REVIEW_REASONS[reviewReason]) throw familyInboxError_('INVALID_INPUT');
  return {
    action: action, inboxId: familyInboxReviewInboxId_(body.inboxId), itemId: itemId, revision: revision,
    reviewRequestId: familyInboxPcReviewRequestId_(body.reviewRequestId), payload: hasPayload ? body.payload : null,
    reviewReason: reviewReason, reviewNote: familyInboxPcReviewNote_(body.reviewNote), identity: identity,
  };
}

function familyInboxPcReviewMutateItemCore_(context, input) {
  let lock;
  try {
    lock = LockService.getScriptLock();
    lock.waitLock(30000);
    const inboxLedger = familyInboxOpenLedger_(context.config.spreadsheetId);
    const inboxEntry = familyInboxReviewRequireInbox_(inboxLedger, context.identity.homeId, input.inboxId);
    const candidateLedger = familyInboxReviewOpenCandidateLedger_(context.config.spreadsheetId, true);
    const itemLedger = familyInboxPcReviewOpenItemLedger_(context.config.spreadsheetId);
    const candidates = familyInboxReviewCandidateEntries_(candidateLedger).filter(function(item) { return String(item.record.inboxId || '') === input.inboxId && String(item.record.homeId || '') === context.identity.homeId; });
    const items = familyInboxPcReviewEntries_(itemLedger).filter(function(item) { return String(item.record.inboxId || '') === input.inboxId && String(item.record.homeId || '') === context.identity.homeId; });
    familyInboxPcReviewAssertGroup_(candidates, items);
    const entry = items.find(function(item) { return String(item.record.reviewItemId || '') === input.itemId; });
    if (!entry) throw familyInboxError_('NOT_FOUND');
    const requestDigest = familyInboxPcReviewRequestDigest_(input);
    const history = familyInboxReviewHistory_(entry.record.reviewHistoryJson);
    const replay = history.find(function(event) { return String(event.reviewRequestId || '') === input.reviewRequestId; });
    if (replay) {
      const expectedReplayAction = input.action === 'approved' ? 'promoted' : input.action;
      if (String(replay.requestDigest || '') !== requestDigest || String(replay.action || '') !== expectedReplayAction) throw familyInboxError_('IDEMPOTENCY_CONFLICT');
      return { item: familyInboxPcReviewItemDto_(entry.record), promotedCandidate: familyInboxPcReviewPromotedDto_(candidates, entry.record), idempotency: { replayed: true } };
    }
    const currentRevision = familyInboxWorkerInteger_(entry.record.revision, -1);
    if (currentRevision !== input.revision) throw familyInboxError_('REVISION_CONFLICT');
    if (String(entry.record.status || '') !== 'pending' || history.length >= FAMILY_INBOX_REVIEW_MAX_HISTORY) throw familyInboxError_('INVALID_STATE');
    const previousPayload = familyInboxPcReviewEffectiveItemPayload_(entry.record);
    const nextPayload = input.action === 'rejected' ? previousPayload : familyInboxPcReviewValidateFragmentPayload_(String(entry.record.candidateType || ''), input.payload);
    const now = familyInboxNow_();
    let promoted = null;
    let nextStatus = input.action === 'rejected' ? 'rejected' : 'pending';
    let promotedCandidateId = '';
    if (input.action === 'approved') {
      const canonicalPayload = familyInboxPcReviewCanonicalPayload_(String(entry.record.candidateType || ''), nextPayload);
      const candidate = familyInboxWorkerValidateCandidate_({
        candidateType: String(entry.record.candidateType || ''), schemaVersion: FAMILY_INBOX_CANDIDATE_SCHEMAS[String(entry.record.candidateType || '')],
        confidence: Number(entry.record.confidence), evidence: familyInboxReviewJsonArray_(entry.record.evidenceJson),
        warnings: familyInboxReviewJsonArray_(entry.record.warningsJson), questions: familyInboxReviewJsonArray_(entry.record.questionsJson), payload: canonicalPayload,
      });
      const existingPromotion = candidates.find(function(item) { return String(item.record.sourceReviewItemId || '') === input.itemId; });
      if (existingPromotion) {
        if (String(existingPromotion.record.payloadDigest || '') !== String(entry.record.payloadDigest || '')) throw familyInboxError_('DATA_INTEGRITY_ERROR');
        promoted = existingPromotion.record;
      } else {
        promoted = familyInboxPcReviewPromotedCandidateRow_(candidate, entry.record, now);
        familyInboxWorkerAppendCandidates_(candidateLedger, [promoted]);
        candidates.push({ rowNumber: candidateLedger.sheet.getLastRow(), record: promoted });
      }
      promotedCandidateId = String(promoted.candidateId || '');
      nextStatus = 'promoted';
    }
    const nextRevision = currentRevision + 1;
    const event = {
      revision: nextRevision, action: input.action === 'approved' ? 'promoted' : input.action,
      reviewRequestId: input.reviewRequestId, requestDigest: requestDigest, reviewedAt: now,
      reviewedByServiceId: context.identity.reviewId, reviewChannel: 'pc_backoffice', reviewReason: input.reviewReason,
      reviewNote: input.reviewNote, previousStatus: 'pending', status: nextStatus,
      previousPayload: previousPayload, payload: nextPayload, promotedCandidateId: promotedCandidateId,
    };
    const historyJson = JSON.stringify(history.concat([event]));
    if (Utilities.newBlob(historyJson).getBytes().length > FAMILY_INBOX_REVIEW_MAX_HISTORY_BYTES) throw familyInboxError_('INVALID_STATE');
    familyInboxPcReviewUpdateItemRow_(itemLedger, entry, {
      revision: nextRevision, updatedAt: now, status: nextStatus, reviewPayloadJson: JSON.stringify(nextPayload),
      reviewedAt: input.action === 'updated' ? '' : now, reviewedByServiceId: context.identity.reviewId,
      reviewChannel: 'pc_backoffice', reviewAction: event.action, reviewReason: input.reviewReason, reviewNote: input.reviewNote,
      reviewRequestId: input.reviewRequestId, reviewHistoryJson: historyJson, promotedCandidateId: promotedCandidateId,
    });
    return { item: familyInboxPcReviewItemDto_(entry.record), promotedCandidate: promoted ? familyInboxReviewCandidateDto_(promoted) : null, idempotency: { replayed: false } };
  } finally {
    if (lock) { try { lock.releaseLock(); } catch (_) {} }
  }
}

function familyInboxPcReviewCanonicalPayload_(candidateType, payload) {
  if (candidateType === 'school.belongings') return { date: payload.date, items: payload.items };
  return payload;
}

function familyInboxPcReviewValidateCanonicalCorrection_(candidateType, current, supplied) {
  if (!familyInboxPlainObject_(supplied)) throw familyInboxError_('INVALID_INPUT');
  return familyInboxWorkerValidatePayload_(candidateType, supplied);
}

function familyInboxPcReviewPromotedCandidateRow_(candidate, reviewRecord, now) {
  return {
    schemaVersion: candidate.schemaVersion, candidateId: familyInboxWorkerNewCandidateId_(), inboxId: String(reviewRecord.inboxId || ''),
    homeId: String(reviewRecord.homeId || ''), candidateType: candidate.candidateType, revision: 1, status: 'proposed', createdAt: now, updatedAt: now,
    subjectMemberId: String(reviewRecord.subjectMemberId || ''), confidence: candidate.confidence, sourceSha256: String(reviewRecord.sourceSha256 || ''),
    profile: String(reviewRecord.profile || ''), model: String(reviewRecord.model || ''), extractorVersion: String(reviewRecord.extractorVersion || ''),
    promptVersion: String(reviewRecord.promptVersion || ''), payloadDigest: String(reviewRecord.payloadDigest || ''), payloadJson: JSON.stringify(candidate.payload),
    evidenceJson: JSON.stringify(candidate.evidence), warningsJson: JSON.stringify(candidate.warnings), questionsJson: JSON.stringify(candidate.questions),
    publishRequestId: String(reviewRecord.publishRequestId || ''), claimVersion: reviewRecord.claimVersion,
    inputTokens: reviewRecord.inputTokens, outputTokens: reviewRecord.outputTokens, durationMs: reviewRecord.durationMs,
    reviewStatus: 'pending', domainWriteResult: '', reviewPayloadJson: '', reviewedAt: '', reviewedByMemberId: '', reviewAction: '',
    reviewReason: '', reviewNote: '', reviewRequestId: '', reviewHistoryJson: '', reviewedByServiceId: '', reviewChannel: '',
    sourceReviewItemId: String(reviewRecord.reviewItemId || ''),
  };
}

function familyInboxPcReviewUpdateItemRow_(sheetState, entry, updates) {
  const row = sheetState.sheet.getRange(entry.rowNumber, 1, 1, sheetState.headers.length).getValues()[0];
  Object.keys(updates).forEach(function(header) {
    const column = sheetState.headers.indexOf(header);
    if (column < 0) throw familyInboxError_('CONFIGURATION_ERROR');
    row[column] = updates[header];
    entry.record[header] = updates[header];
  });
  try { sheetState.sheet.getRange(entry.rowNumber, 1, 1, sheetState.headers.length).setValues([row]); } catch (_) { throw familyInboxError_('LEDGER_ERROR'); }
}

function familyInboxPcReviewAssertGroup_(candidateEntries, reviewEntries) {
  const all = candidateEntries.concat(reviewEntries);
  if (!all.length) throw familyInboxError_('NOT_FOUND');
  const group = {};
  all.forEach(function(entry) {
    const key = String(entry.record.publishRequestId || '') + '|' + String(entry.record.payloadDigest || '') + '|' + String(entry.record.claimVersion || '') + '|' + String(entry.record.profile || '');
    group[key] = true;
  });
  if (Object.keys(group).length !== 1) throw familyInboxError_('DATA_INTEGRITY_ERROR');
  const profile = String(all[0].record.profile || '');
  const policy = FAMILY_INBOX_WORKER_PROFILES[profile];
  const originalCandidateCount = candidateEntries.filter(function(entry) { return !String(entry.record.sourceReviewItemId || ''); }).length;
  if (!policy || originalCandidateCount + reviewEntries.length > policy.maxItems) throw familyInboxError_('DATA_INTEGRITY_ERROR');
  return { profile: profile, policy: policy };
}

function familyInboxPcReviewCandidateDto_(record) {
  const value = familyInboxReviewCandidateDto_(record);
  return {
    itemId: value.candidateId, origin: 'canonical', candidateType: value.candidateType, revision: value.revision,
    confidence: value.confidence, payload: value.payload, evidenceSummary: value.evidenceSummary,
    warnings: value.warnings, questions: value.questions, reviewStatus: value.reviewStatus,
    reviewedAt: value.reviewedAt, reviewAction: value.reviewAction, reviewReason: value.reviewReason,
  };
}

function familyInboxPcReviewItemDto_(record) {
  return {
    itemId: String(record.reviewItemId || ''), origin: 'review_item', reviewType: String(record.reviewType || ''),
    candidateType: String(record.candidateType || ''), revision: familyInboxWorkerInteger_(record.revision, 1),
    confidence: Number(record.confidence), payload: familyInboxPcReviewEffectiveItemPayload_(record),
    evidenceSummary: familyInboxReviewEvidenceSummary_(record.evidenceJson), warnings: familyInboxReviewJsonArray_(record.warningsJson),
    questions: familyInboxReviewJsonArray_(record.questionsJson), reviewStatus: String(record.status || 'pending'),
    reviewedAt: String(record.reviewedAt || ''), reviewAction: String(record.reviewAction || ''), reviewReason: String(record.reviewReason || ''),
    promotedCandidateId: String(record.promotedCandidateId || ''),
  };
}

function familyInboxPcReviewEffectiveItemPayload_(record) {
  const parsed = familyInboxReviewJsonObject_(String(record.reviewPayloadJson || '').trim() || record.payloadJson);
  if (!parsed) throw familyInboxError_('DATA_INTEGRITY_ERROR');
  return parsed;
}

function familyInboxPcReviewPromotedDto_(candidates, reviewRecord) {
  const promotedId = String(reviewRecord.promotedCandidateId || '');
  if (!promotedId) return null;
  const entry = candidates.find(function(item) { return String(item.record.candidateId || '') === promotedId; });
  return entry ? familyInboxReviewCandidateDto_(entry.record) : null;
}

function familyInboxPcReviewAggregateStatus_(candidateEntries, reviewEntries) {
  const candidateDone = candidateEntries.every(function(entry) { return ['approved', 'rejected'].indexOf(String(entry.record.reviewStatus || 'pending')) >= 0; });
  const reviewDone = reviewEntries.every(function(entry) { return ['promoted', 'rejected'].indexOf(String(entry.record.status || 'pending')) >= 0; });
  return candidateDone && reviewDone ? 'reviewed' : 'pending';
}

function familyInboxPcReviewReviewedCount_(candidateEntries, reviewEntries) {
  return candidateEntries.filter(function(entry) { return ['approved', 'rejected'].indexOf(String(entry.record.reviewStatus || 'pending')) >= 0; }).length +
    reviewEntries.filter(function(entry) { return ['promoted', 'rejected'].indexOf(String(entry.record.status || 'pending')) >= 0; }).length;
}

function familyInboxPcReviewItemSort_(left, right) {
  const leftRank = left.origin === 'review_item' && left.reviewStatus === 'pending' ? 0 : left.reviewStatus === 'pending' ? 1 : 2;
  const rightRank = right.origin === 'review_item' && right.reviewStatus === 'pending' ? 0 : right.reviewStatus === 'pending' ? 1 : 2;
  return leftRank - rightRank || String(left.candidateType || '').localeCompare(String(right.candidateType || ''));
}

function familyInboxPcReviewRequestId_(value) {
  const requestId = String(value || '').trim();
  if (!familyInboxUuid_(requestId)) throw familyInboxError_('INVALID_INPUT');
  return requestId;
}

function familyInboxPcReviewNote_(value) {
  const note = String(value || '').trim();
  if (Array.from(note).length > FAMILY_INBOX_REVIEW_MAX_NOTE_CHARACTERS) throw familyInboxError_('INVALID_INPUT');
  return note;
}

function familyInboxPcReviewRequestDigest_(input) {
  return familyInboxSha256_(Utilities.newBlob(familyInboxWorkerStableStringify_({
    action: input.action, inboxId: input.inboxId, itemId: input.itemId, revision: input.revision,
    payload: input.payload, reviewReason: input.reviewReason, reviewNote: input.reviewNote,
    reviewedByServiceId: input.identity.reviewId, reviewChannel: 'pc_backoffice',
  })).getBytes());
}

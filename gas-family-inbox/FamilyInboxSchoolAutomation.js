/** Reconcile typed extraction with the existing School Knowledge projection.
 * A service resolution is recorded separately from human approval. */
function familyInboxSchoolAutomationHash_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(value), Utilities.Charset.UTF_8)
    .map(function(byte) { return ('0' + (byte & 255).toString(16)).slice(-2); }).join('');
}

function familyInboxSchoolAutomationState_(config, inboxId) {
  const inbox = familyInboxOpenLedger_(config.spreadsheetId);
  const candidates = familyInboxReviewOpenCandidateLedger_(config.spreadsheetId, true);
  const reviews = familyInboxPcReviewOpenItemLedger_(config.spreadsheetId);
  const entry = familyInboxWorkerFindInboxEntry_(inbox, inboxId);
  if (!entry || entry.record.documentType !== 'school_print' || entry.record.processingProfile !== 'school-v1-long' ||
      (entry.record.status !== 'needs_review' && !(entry.record.status === 'completed' && entry.record.schoolAutomationReceiptJson))) throw familyInboxError_('INVALID_STATE');
  const candidateEntries = familyInboxReviewCandidateEntries_(candidates).filter(function(item) { return item.record.inboxId === inboxId; });
  const reviewEntries = familyInboxPcReviewEntries_(reviews).filter(function(item) { return item.record.inboxId === inboxId; });
  familyInboxPcReviewAssertGroup_(candidateEntries, reviewEntries);
  const items = candidateEntries.concat(reviewEntries).map(function(item) {
    const record = item.record;
    if (record.homeId !== entry.record.homeId || record.subjectMemberId !== entry.record.subjectMemberHint || record.sourceSha256 !== entry.record.sha256) throw familyInboxError_('DATA_INTEGRITY_ERROR');
    return {
      itemId: String(record.candidateId || record.reviewItemId), revision: Number(record.revision),
      candidateType: record.candidateType, confidence: Number(record.confidence),
      reviewStatus: String(record.candidateId ? record.reviewStatus || 'pending' : record.status),
      payload: familyInboxReviewJsonObject_(String(record.reviewPayloadJson || '').trim() || record.payloadJson),
      evidence: familyInboxReviewJsonArray_(record.evidenceJson), warnings: familyInboxReviewJsonArray_(record.warningsJson),
      questions: familyInboxReviewJsonArray_(record.questionsJson),
      schoolMetadata: familyInboxReviewOptionalJsonObject_(record.schoolMetadataJson),
    };
  });
  if (items.length > 64) throw familyInboxError_('DATA_INTEGRITY_ERROR');
  const snapshotDigest = familyInboxSchoolAutomationHash_(candidateEntries.concat(reviewEntries).map(function(item) { return item.record; }));
  return { inbox: inbox, entry: entry, candidates: candidates, reviews: reviews,
    candidateEntries: candidateEntries, reviewEntries: reviewEntries, items: items, snapshotDigest: snapshotDigest };
}

function familyInboxSchoolAutomationNext_(body) {
  return familyInboxWorkerRun_('familyInbox.schoolAutomation.next', body, function(context) {
    familyInboxWorkerValidateKeys_(body, { operation: true, workerToken: true, subjectMemberId: true, traceId: true });
    const subject = familyInboxRequiredIdentifier_(body.subjectMemberId);
    const inbox = familyInboxOpenLedger_(context.config.spreadsheetId);
    const entry = familyInboxWorkerInboxEntries_(inbox).find(function(item) {
      return familyInboxLongSchoolPrintMatchesSubject_(item.record, subject) &&
        item.record.status === 'needs_review' && !String(item.record.schoolAutomationReceiptJson || '').trim();
    });
    if (!entry) return { inboxId: null };
    const state = familyInboxSchoolAutomationState_(context.config, entry.record.inboxId);
    return { inboxId: entry.record.inboxId, subjectMemberId: subject, documentType: 'school_print', profile: 'school-v1-long',
      sourceFileId: entry.record.originalRef, sourceSha256: entry.record.sha256, items: state.items, snapshotDigest: state.snapshotDigest };
  });
}

function familyInboxSchoolAutomationComplete_(body) {
  return familyInboxWorkerRun_('familyInbox.schoolAutomation.complete', body, function(context) {
    familyInboxWorkerValidateKeys_(body, { operation: true, workerToken: true, traceId: true, inboxId: true, snapshotDigest: true,
      manifest: true, projectionDigest: true, receipt: true });
    const manifest = body.manifest;
    if (!familyInboxPlainObject_(manifest) || manifest.inboxId !== body.inboxId ||
        familyInboxSchoolAutomationHash_(manifest) !== body.projectionDigest ||
        body.receipt?.readback?.ok !== true || body.receipt?.readback?.otherRowsUnchanged !== true ||
        body.receipt.projectionDigest !== body.projectionDigest || body.receipt.sourceInboxId !== body.inboxId ||
        body.receipt.sourceSha256 !== manifest.sourceSha256 || !['APPLIED', 'REPLAYED'].includes(body.receipt.status)) throw familyInboxError_('INVALID_INPUT');
    const receiptJson = JSON.stringify({ schemaVersion: manifest.schemaVersion, projectionDigest: body.projectionDigest,
      receipt: body.receipt, period: manifest.period, targetGrade: manifest.targetGrade,
      decisions: manifest.decisions, at: familyInboxNow_() });
    const knowledgeJson = JSON.stringify(manifest.knowledge);
    const calendarConflicts = body.receipt.calendarConflicts || [];
    if (!Array.isArray(calendarConflicts) || calendarConflicts.some(function(date) { return !/^\d{4}-\d{2}-\d{2}$/.test(date); })) throw familyInboxError_('INVALID_INPUT');
    if (receiptJson.length > 45000 || knowledgeJson.length > 45000) throw familyInboxError_('INVALID_INPUT');
    const lock = LockService.getScriptLock(); lock.waitLock(30000);
    try {
      const state = familyInboxSchoolAutomationState_(context.config, body.inboxId);
      const existing = String(state.entry.record.schoolAutomationReceiptJson || '');
      if (existing) {
        if (JSON.parse(existing).projectionDigest !== body.projectionDigest) throw familyInboxError_('IDEMPOTENCY_CONFLICT');
        return { projectionDigest: body.projectionDigest, replayed: true, resolvedCount: 0 };
      }
      if (state.snapshotDigest !== body.snapshotDigest || state.entry.record.sha256 !== manifest.sourceSha256 ||
          state.entry.record.subjectMemberHint !== manifest.subjectMemberId || manifest.decisions.length !== state.items.length) throw familyInboxError_('CLAIM_CONFLICT');
      const decisions = {};
      manifest.decisions.forEach(function(decision) {
        if (decisions[decision.itemId] || !['projected', 'knowledge', 'preserved', 'exception'].includes(decision.disposition)) throw familyInboxError_('INVALID_INPUT');
        decisions[decision.itemId] = decision;
      });
      state.items.forEach(function(item) {
        if (!decisions[item.itemId] || decisions[item.itemId].revision !== item.revision) throw familyInboxError_('CLAIM_CONFLICT');
      });
      ['schoolKnowledgeJson', 'schoolAutomationReceiptJson'].forEach(function(header) {
        if (state.inbox.headers.indexOf(header) >= 0) return;
        state.inbox.headers.push(header);
        if (state.inbox.sheet.getMaxColumns() < state.inbox.headers.length) state.inbox.sheet.insertColumnAfter(state.inbox.sheet.getMaxColumns());
        state.inbox.sheet.getRange(1, state.inbox.headers.length).setValue(header);
      });
      let resolvedCount = 0;
      const now = familyInboxNow_();
      state.candidateEntries.concat(state.reviewEntries).forEach(function(entry) {
        const record = entry.record;
        const id = String(record.candidateId || record.reviewItemId);
        const decision = decisions[id];
        const statusKey = record.candidateId ? 'reviewStatus' : 'status';
        if (String(record[statusKey] || 'pending') !== 'pending' || decision.disposition === 'exception') return;
        const item = state.items.find(function(value) { return value.itemId === id; });
        if (calendarConflicts.indexOf(item.payload?.date || item.payload?.dueDate) >= 0) return;
        const history = familyInboxReviewHistory_(record.reviewHistoryJson);
        if (history.length >= FAMILY_INBOX_REVIEW_MAX_HISTORY) throw familyInboxError_('INVALID_STATE');
        history.push({ action: 'auto_resolved', reason: decision.reason, reviewedAt: now,
          serviceId: context.workerId, channel: 'school_automation', projectionDigest: body.projectionDigest,
          previousRevision: Number(record.revision), revision: Number(record.revision) + 1,
          previousReviewStatus: 'pending', reviewStatus: 'resolved' });
        const updates = { revision: Number(record.revision) + 1, updatedAt: now, reviewedAt: now,
          reviewedByServiceId: context.workerId, reviewChannel: 'school_automation', reviewAction: 'auto_resolved',
          reviewReason: decision.reason, reviewHistoryJson: JSON.stringify(history) };
        updates[statusKey] = 'resolved';
        if (record.candidateId) {
          updates.domainWriteResult = 'school_knowledge_applied';
          familyInboxReviewUpdateCandidateRow_(state.candidates, entry, updates);
        }
        else familyInboxPcReviewUpdateItemRow_(state.reviews, entry, updates);
        resolvedCount += 1;
      });
      familyInboxWorkerUpdateInbox_(state.inbox, state.entry, { schoolKnowledgeJson: knowledgeJson,
        schoolAutomationReceiptJson: receiptJson, updatedAt: now,
        status: calendarConflicts.length || manifest.decisions.some(function(item) { return item.disposition === 'exception'; }) ? 'needs_review' : 'completed' });
      return { projectionDigest: body.projectionDigest, resolvedCount: resolvedCount, replayed: false };
    } finally { lock.releaseLock(); }
  });
}

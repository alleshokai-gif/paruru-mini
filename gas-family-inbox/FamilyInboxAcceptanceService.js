// Dedicated, opt-in experiment surface. No generic Drive ID or function execution.
const FAMILY_INBOX_ACCEPTANCE_TOKEN_PROPERTY = 'FAMILY_INBOX_ACCEPTANCE_TOKEN';
const FAMILY_INBOX_ACCEPTANCE_OPERATIONS = Object.freeze({
  'familyInbox.acceptance.check': true,
  'familyInbox.acceptance.place': true,
  'familyInbox.acceptance.import': true,
  'familyInbox.acceptance.verify': true,
});

function familyInboxAcceptance_(body) {
  const operation = String(body && body.operation || '');
  const trace = familyInboxTraceFromBody_(body, FAMILY_INBOX_ACCEPTANCE_OPERATIONS[operation] ? operation : 'familyInbox.acceptance');
  try {
    const expected = String(PropertiesService.getScriptProperties().getProperty(FAMILY_INBOX_ACCEPTANCE_TOKEN_PROPERTY) || '');
    if (!expected) throw familyInboxError_('CONFIGURATION_ERROR');
    if (!familyInboxConstantTimeEquals_(expected, String(body && body.acceptanceToken || ''))) throw familyInboxError_('FORBIDDEN');
    if (['FAMILY_INBOX_SERVICE_TOKEN', 'FAMILY_INBOX_WORKER_TOKEN', 'FAMILY_INBOX_PC_REVIEW_TOKEN'].some(function(property) {
      const other = String(PropertiesService.getScriptProperties().getProperty(property) || '');
      return other && familyInboxConstantTimeEquals_(expected, other);
    })) throw familyInboxError_('CONFIGURATION_ERROR');
    if (!FAMILY_INBOX_ACCEPTANCE_OPERATIONS[operation]) throw familyInboxError_('FORBIDDEN');
    const allowed = { operation: true, acceptanceToken: true, traceId: true };
    if (operation !== 'familyInbox.acceptance.check') { allowed.runId = true; allowed.sha256 = true; }
    if (operation === 'familyInbox.acceptance.place') allowed.base64 = true;
    if (operation === 'familyInbox.acceptance.verify') {
      allowed.inboxId = true; allowed.publishRequestId = true; allowed.payloadDigest = true;
      allowed.claimVersion = true; allowed.candidateCount = true; allowed.reviewItemCount = true;
    }
    familyInboxWorkerValidateKeys_(body, allowed);
    const config = familyInboxLoadDriveDropConfig_();
    const storage = familyInboxLoadConfig_();
    // Check all three schemas before the first cloud write. Never create/migrate here.
    const ledger = familyInboxOpenLedger_(storage.spreadsheetId);
    const candidates = familyInboxReviewOpenCandidateLedger_(storage.spreadsheetId, true);
    const items = familyInboxPcReviewOpenItemLedger_(storage.spreadsheetId);
    const folder = familyInboxOpenDriveDropFolder_(config.folderId);
    if (operation === 'familyInbox.acceptance.check') return { ready: true };
    if (!familyInboxUuid_(body.runId) || !/^[0-9a-f]{64}$/.test(String(body.sha256 || ''))) throw familyInboxError_('INVALID_INPUT');
    const name = 'acceptance_' + String(body.runId).toLowerCase() + '.pdf';

    if (operation === 'familyInbox.acceptance.place') {
      const bytes = familyInboxDecodeBase64_(body.base64);
      familyInboxValidateSignature_('application/pdf', bytes);
      if (familyInboxSha256_(bytes) !== body.sha256) throw familyInboxError_('INVALID_INPUT');
      let lock;
      try {
        lock = LockService.getScriptLock(); lock.waitLock(30000);
        if (folder.getFilesByName(name).hasNext()) throw familyInboxError_('DUPLICATE_REQUEST');
        if (familyInboxFindRow_(ledger, function(row) { return row.homeId === config.homeId && row.sha256 === body.sha256; })) throw familyInboxError_('DUPLICATE_REQUEST');
        try { folder.createFile(Utilities.newBlob(bytes, 'application/pdf', name)); }
        catch (_) { throw familyInboxError_('STORAGE_ERROR'); }
        return { placed: true };
      } finally { if (lock) lock.releaseLock(); }
    }

    // Select only this run's newly named file inside the configured Drop Folder.
    // Never invoke the folder-wide scanner: another PDF/pending item is out of scope.
    const matches = folder.getFilesByName(name);
    if (!matches.hasNext()) throw familyInboxError_('NOT_FOUND');
    const file = matches.next();
    if (matches.hasNext()) throw familyInboxError_('DATA_INTEGRITY_ERROR');
    if (file.getMimeType() !== 'application/pdf') throw familyInboxError_('INVALID_INPUT');
    const input = familyInboxDriveDropInput_(file, config);
    if (input.sha256 !== body.sha256 || input.originalName !== name) throw familyInboxError_('DATA_INTEGRITY_ERROR');
    if (operation === 'familyInbox.acceptance.import') {
      const result = familyInboxPersistInput_(input, 'drive_drop', trace, Date.now());
      // A replay or SHA duplicate is never eligible for an experiment worker run.
      if (result.idempotency.replayed || result.status !== 'pending') throw familyInboxError_('DUPLICATE_REQUEST');
      const record = familyInboxFindRow_(ledger, function(row) { return row.inboxId === result.inboxId; });
      if (!record || record.processingProfile !== 'school-v1-long' || record.sha256 !== body.sha256 || record.homeId !== config.homeId) throw familyInboxError_('DATA_INTEGRITY_ERROR');
      return {
        inboxId: result.inboxId, status: record.status, processingProfile: record.processingProfile,
        sha256: record.sha256, attemptCount: Number(record.attemptCount || 0), claimVersion: Number(record.claimVersion || 0),
        created: true,
      };
    }

    if (!/^inb_[0-9a-f]{32}$/.test(String(body.inboxId || '')) || !familyInboxUuid_(body.publishRequestId) || !/^[0-9a-f]{64}$/.test(String(body.payloadDigest || '')) || !Number.isInteger(body.claimVersion) || body.claimVersion < 1 || !Number.isInteger(body.candidateCount) || body.candidateCount < 0 || !Number.isInteger(body.reviewItemCount) || body.reviewItemCount < 0 || body.candidateCount + body.reviewItemCount < 1 || body.candidateCount + body.reviewItemCount > FAMILY_INBOX_LONG_MAX_ITEMS) throw familyInboxError_('INVALID_INPUT');
    const record = familyInboxFindRow_(ledger, function(row) { return row.inboxId === body.inboxId && row.homeId === config.homeId && row.clientRequestId === input.clientRequestId; });
    if (!record || record.status !== 'needs_review' || record.processingProfile !== 'school-v1-long' || record.sha256 !== body.sha256 || Number(record.claimVersion) !== body.claimVersion) throw familyInboxError_('DATA_INTEGRITY_ERROR');
    const candidateRows = familyInboxReviewCandidateEntries_(candidates).filter(function(entry) { return entry.record.inboxId === record.inboxId; });
    const itemRows = familyInboxPcReviewEntries_(items).filter(function(entry) { return entry.record.inboxId === record.inboxId; });
    if (candidateRows.length !== body.candidateCount || itemRows.length !== body.reviewItemCount) throw familyInboxError_('DATA_INTEGRITY_ERROR');
    familyInboxPcReviewAssertGroup_(candidateRows, itemRows);
    if (!candidateRows.concat(itemRows).every(function(entry) {
      const row = entry.record;
      return row.homeId === config.homeId && row.publishRequestId === body.publishRequestId && row.payloadDigest === body.payloadDigest && Number(row.claimVersion) === body.claimVersion && row.sourceSha256 === body.sha256 && row.profile === 'school-v1-long' && !String(row.domainWriteResult || '');
    })) throw familyInboxError_('DATA_INTEGRITY_ERROR');
    return { status: 'needs_review', groupMatched: true, candidateCount: candidateRows.length, reviewItemCount: itemRows.length, claimVersion: body.claimVersion };
  } catch (error) {
    familyInboxLog_(Object.assign(trace, { stage: 'failed', status: 'failed', errorCode: familyInboxSafeErrorCode_(error) }));
    throw error;
  }
}

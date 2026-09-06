function doPost(e) {
  try {
    const body = familyInboxParseBody_(e);
    const operation = String(body.operation || '').trim();
    if (operation.indexOf('familyInbox.acceptance.') === 0) {
      return familyInboxJson_({ success: true, schemaVersion: FAMILY_INBOX_SCHEMA_VERSION, data: familyInboxAcceptance_(body) });
    }
    if (operation === 'familyInbox.submit') {
      return familyInboxJson_({ success: true, schemaVersion: FAMILY_INBOX_SCHEMA_VERSION, data: familyInboxSubmit_(body) });
    }
    if (operation === 'familyInbox.getStatus') {
      return familyInboxJson_({ success: true, schemaVersion: FAMILY_INBOX_SCHEMA_VERSION, data: familyInboxGetStatus_(body) });
    }
    if (operation === 'familyInbox.listReviews') {
      return familyInboxJson_({ success: true, schemaVersion: FAMILY_INBOX_SCHEMA_VERSION, data: familyInboxListReviews_(body) });
    }
    if (operation === 'familyInbox.getReview') {
      return familyInboxJson_({ success: true, schemaVersion: FAMILY_INBOX_SCHEMA_VERSION, data: familyInboxGetReview_(body) });
    }
    if (operation === 'familyInbox.updateCandidate') {
      return familyInboxJson_({ success: true, schemaVersion: FAMILY_INBOX_SCHEMA_VERSION, data: familyInboxUpdateCandidate_(body) });
    }
    if (operation === 'familyInbox.approveCandidate') {
      return familyInboxJson_({ success: true, schemaVersion: FAMILY_INBOX_SCHEMA_VERSION, data: familyInboxApproveCandidate_(body) });
    }
    if (operation === 'familyInbox.rejectCandidate') {
      return familyInboxJson_({ success: true, schemaVersion: FAMILY_INBOX_SCHEMA_VERSION, data: familyInboxRejectCandidate_(body) });
    }
    if (operation === 'familyInbox.pcReview.list') {
      return familyInboxJson_({ success: true, schemaVersion: FAMILY_INBOX_SCHEMA_VERSION, data: familyInboxPcReviewList_(body) });
    }
    if (operation === 'familyInbox.pcReview.get') {
      return familyInboxJson_({ success: true, schemaVersion: FAMILY_INBOX_SCHEMA_VERSION, data: familyInboxPcReviewGet_(body) });
    }
    if (operation === 'familyInbox.pcReview.update') {
      return familyInboxJson_({ success: true, schemaVersion: FAMILY_INBOX_SCHEMA_VERSION, data: familyInboxPcReviewUpdate_(body) });
    }
    if (operation === 'familyInbox.pcReview.approve') {
      return familyInboxJson_({ success: true, schemaVersion: FAMILY_INBOX_SCHEMA_VERSION, data: familyInboxPcReviewApprove_(body) });
    }
    if (operation === 'familyInbox.pcReview.reject') {
      return familyInboxJson_({ success: true, schemaVersion: FAMILY_INBOX_SCHEMA_VERSION, data: familyInboxPcReviewReject_(body) });
    }
    if (operation === 'familyInbox.pcReview.bulkApproveCanonical') {
      return familyInboxJson_({ success: true, schemaVersion: FAMILY_INBOX_SCHEMA_VERSION, data: familyInboxPcReviewBulkApprove_(body) });
    }
    if (operation === 'familyInbox.claimNext') {
      return familyInboxJson_({ success: true, schemaVersion: FAMILY_INBOX_SCHEMA_VERSION, data: familyInboxClaimNext_(body) });
    }
    if (operation === 'familyInbox.heartbeat') {
      return familyInboxJson_({ success: true, schemaVersion: FAMILY_INBOX_SCHEMA_VERSION, data: familyInboxHeartbeat_(body) });
    }
    if (operation === 'familyInbox.getClaimedSource') {
      return familyInboxJson_({ success: true, schemaVersion: FAMILY_INBOX_SCHEMA_VERSION, data: familyInboxGetClaimedSource_(body) });
    }
    if (operation === 'familyInbox.publishCandidates') {
      return familyInboxJson_({ success: true, schemaVersion: FAMILY_INBOX_SCHEMA_VERSION, data: familyInboxPublishCandidates_(body) });
    }
    if (operation === 'familyInbox.failClaim') {
      return familyInboxJson_({ success: true, schemaVersion: FAMILY_INBOX_SCHEMA_VERSION, data: familyInboxFailClaim_(body) });
    }
    throw familyInboxError_('INVALID_INPUT');
  } catch (error) {
    return familyInboxJson_(familyInboxErrorEnvelope_(error));
  }
}

function familyInboxParseBody_(e) {
  const text = e && e.postData && e.postData.contents;
  if (!text) throw familyInboxError_('INVALID_INPUT');
  let body;
  try { body = JSON.parse(text); } catch (_) { throw familyInboxError_('INVALID_INPUT'); }
  if (!familyInboxPlainObject_(body)) throw familyInboxError_('INVALID_INPUT');
  return body;
}

function familyInboxJson_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

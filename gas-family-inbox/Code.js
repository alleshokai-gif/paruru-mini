function doPost(e) {
  try {
    const body = familyInboxParseBody_(e);
    const operation = String(body.operation || '').trim();
    if (operation === 'familyInbox.submit') {
      return familyInboxJson_({ success: true, schemaVersion: FAMILY_INBOX_SCHEMA_VERSION, data: familyInboxSubmit_(body) });
    }
    if (operation === 'familyInbox.getStatus') {
      return familyInboxJson_({ success: true, schemaVersion: FAMILY_INBOX_SCHEMA_VERSION, data: familyInboxGetStatus_(body) });
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

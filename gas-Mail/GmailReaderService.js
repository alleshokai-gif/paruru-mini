function readMailMetadataForDryRun_(settings) {
  const query = buildMailDryRunQuery_(settings.lookbackHours);
  let listed;
  try {
    listed = Gmail.Users.Messages.list('me', { q: query, maxResults: settings.searchLimit });
  } catch (_) {
    throw new Error('MAIL_SEARCH_FAILED');
  }
  const candidates = Array.isArray(listed && listed.messages) ? listed.messages : [];
  const cutoffMillis = Date.now() - settings.lookbackHours * 60 * 60 * 1000;
  const messages = [];
  const seenMessageIds = {};
  let readErrorCount = 0;

  candidates.forEach(function(item) {
    if (messages.length >= settings.searchLimit || !item || !item.id || seenMessageIds[item.id]) return;
    seenMessageIds[item.id] = true;
    try {
      const message = Gmail.Users.Messages.get('me', item.id, {
        format: 'full',
        fields: 'id,threadId,internalDate,snippet,payload(headers,filename,body/attachmentId,parts(filename,body/attachmentId,parts(filename,body/attachmentId)))',
      });
      const metadata = gmailMessageToMailMetadata_(message);
      if (!metadata.receivedAtMillis || metadata.receivedAtMillis < cutoffMillis) return;
      messages.push(metadata);
    } catch (_) {
      readErrorCount += 1;
    }
  });

  messages.sort(function(left, right) { return right.receivedAtMillis - left.receivedAtMillis; });
  return {
    messages: messages,
    readErrorCount: readErrorCount,
    hasMoreLikely: candidates.length === settings.searchLimit,
  };
}

function buildMailDryRunQuery_(lookbackHours) {
  return 'newer_than:' + Math.max(1, Math.ceil(lookbackHours / 24)) + 'd -in:trash -in:spam';
}

function gmailMessageToMailMetadata_(message) {
  const headers = message && message.payload && Array.isArray(message.payload.headers) ? message.payload.headers : [];
  const from = gmailHeaderValue_(headers, 'From');
  const receivedAtMillis = Number(message && message.internalDate);
  return {
    messageId: String(message && message.id || ''),
    threadId: String(message && message.threadId || ''),
    receivedAt: mailDateToIso_(new Date(receivedAtMillis)),
    receivedAtMillis: Number.isFinite(receivedAtMillis) ? receivedAtMillis : 0,
    from: from,
    senderDomain: mailSenderDomain_(from),
    subject: gmailHeaderValue_(headers, 'Subject'),
    snippet: mailTruncate_(message && message.snippet, MAIL_DRY_RUN_LIMITS.snippetMaxLength),
    hasAttachment: gmailPayloadHasAttachment_(message && message.payload),
  };
}

function gmailHeaderValue_(headers, name) {
  const target = String(name).toLowerCase();
  const header = headers.filter(function(item) {
    return item && String(item.name || '').toLowerCase() === target;
  })[0];
  return header ? String(header.value || '') : '';
}

function gmailPayloadHasAttachment_(part) {
  if (!part || typeof part !== 'object') return false;
  if (String(part.filename || '')) return true;
  if (part.body && part.body.attachmentId) return true;
  return Array.isArray(part.parts) && part.parts.some(gmailPayloadHasAttachment_);
}

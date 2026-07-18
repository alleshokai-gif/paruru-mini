const PALURU_INBOX_API_TOKEN_PROPERTY = 'PALURU_INBOX_API_TOKEN';
const INTERNAL_MEMO_SOURCE = 'paluru-agent';
const INTERNAL_MEMO_MAX_CHARACTERS = 1000;
const INTERNAL_MEMO_ALLOWED_CATEGORIES = ['', '未分類', '家', '仕事', '買い物', '学校', '薬局', '開発', 'お金'];
const INTERNAL_MEMO_ALLOWED_PRIORITIES = ['', 'Low', 'Normal', 'High', 'Urgent'];

function createItemWithAIInternal_(body) {
  let lock;
  try {
    authenticateInternalMemoRequest_(body || {});
    const input = validateInternalMemoInput_(body || {});

    lock = LockService.getScriptLock();
    lock.waitLock(30000);

    const sheet = getInboxSheet_();
    const headers = getActualHeaders_(sheet);
    const requestColumn = headers.indexOf('clientRequestId');
    if (requestColumn < 0) {
      throw createInternalMemoError_('CONFIGURATION_ERROR');
    }

    const existing = findInternalMemoByRequestId_(sheet, headers, requestColumn + 1, input.clientRequestId);
    if (existing) {
      return json_({ success: true, item: sanitizeInternalMemoItem_(existing), duplicate: true });
    }

    const item = createItemWithAIResult_(input, input.memo, {
      source: INTERNAL_MEMO_SOURCE,
      clientRequestId: input.clientRequestId
    });
    return json_({ success: true, item: sanitizeInternalMemoItem_(item), duplicate: false });
  } catch (error) {
    return json_(buildInternalMemoError_(error));
  } finally {
    if (lock) {
      try { lock.releaseLock(); } catch (ignore) {}
    }
  }
}

function authenticateInternalMemoRequest_(body) {
  const expected = String(PropertiesService.getScriptProperties().getProperty(PALURU_INBOX_API_TOKEN_PROPERTY) || '');
  const actual = String(body.internalToken || '');
  if (!expected || !actual || !constantTimeEqualsInternal_(expected, actual)) {
    throw createInternalMemoError_('UNAUTHORIZED');
  }
}

function constantTimeEqualsInternal_(expected, actual) {
  const length = Math.max(expected.length, actual.length);
  let difference = expected.length ^ actual.length;
  for (let i = 0; i < length; i++) {
    difference |= (expected.charCodeAt(i % Math.max(expected.length, 1)) || 0) ^
      (actual.charCodeAt(i % Math.max(actual.length, 1)) || 0);
  }
  return difference === 0;
}

function validateInternalMemoInput_(body) {
  const memo = String(body.memo || '').trim();
  const clientRequestId = String(body.clientRequestId || '').trim();
  const source = String(body.source || '').trim();
  const category = String(body.category || '').trim();
  const priority = String(body.priority || '').trim();
  const visibility = String(body.visibility || 'private').trim();

  if (!memo || Array.from(memo).length > INTERNAL_MEMO_MAX_CHARACTERS || !isInternalMemoUuid_(clientRequestId)) {
    throw createInternalMemoError_('INVALID_INPUT');
  }
  if (source !== INTERNAL_MEMO_SOURCE || visibility !== 'private') {
    throw createInternalMemoError_('INVALID_INPUT');
  }
  if (INTERNAL_MEMO_ALLOWED_CATEGORIES.indexOf(category) < 0 || INTERNAL_MEMO_ALLOWED_PRIORITIES.indexOf(priority) < 0) {
    throw createInternalMemoError_('INVALID_INPUT');
  }

  return {
    memo: memo,
    clientRequestId: clientRequestId,
    source: source,
    userId: String(body.userId || '').trim(),
    userDisplayName: String(body.userDisplayName || '').trim(),
    deviceId: String(body.deviceId || '').trim(),
    visibility: visibility,
    category: category,
    priority: priority,
  };
}

function isInternalMemoUuid_(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function findInternalMemoByRequestId_(sheet, headers, columnNumber, requestId) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return null;
  const values = sheet.getRange(2, columnNumber, lastRow - 1, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0]) === requestId) {
      const row = sheet.getRange(i + 2, 1, 1, headers.length).getValues()[0];
      return headers.reduce(function(item, header, index) {
        if (header) item[header] = row[index];
        return item;
      }, {});
    }
  }
  return null;
}

function sanitizeInternalMemoItem_(item) {
  return {
    id: String(item.id || ''),
    title: String(item.title || ''),
    category: String(item.category || ''),
    type: String(item.type || ''),
    needsFollowup: item.needsFollowup === true || String(item.needsFollowup).toLowerCase() === 'true',
    followupQuestion: String(item.followupQuestion || ''),
    followupInputType: String(item.followupInputType || ''),
  };
}

function createInternalMemoError_(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function buildInternalMemoError_(error) {
  const allowed = { UNAUTHORIZED: true, INVALID_INPUT: true, CONFIGURATION_ERROR: true };
  const code = error && allowed[error.code] ? error.code : 'INTERNAL_ERROR';
  const messages = {
    UNAUTHORIZED: 'Authentication failed.',
    INVALID_INPUT: 'Invalid input.',
    CONFIGURATION_ERROR: 'Internal API is not configured.',
    INTERNAL_ERROR: 'Internal processing failed.',
  };
  return { success: false, error: { code: code, message: messages[code] } };
}

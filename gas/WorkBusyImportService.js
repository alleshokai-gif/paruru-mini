const PALURU_WORK_BUSY_SUBJECT = 'PALURU_AVAILABILITY';
const PALURU_WORK_BUSY_SOURCE = 'Gmail:PALURU_AVAILABILITY';
const PALURU_WORK_BUSY_SHEET_NAME = 'WorkBusy';
const PALURU_WORK_BUSY_HEADERS = ['source', 'generated_at', 'date', 'start', 'end'];
const PALURU_WORK_BUSY_MAX_DAYS_AHEAD = 30;
const PALURU_WORK_BUSY_TIME_ZONE = 'Asia/Tokyo';

function importLatestWorkBusyEmailV1(dependencies) {
  const result = importLatestWorkBusyEmail_(dependencies);
  let rebuild;
  try {
    const correlation = 'workbusy-sha256:' + kazOsSha256_(
      result.generated_at + '\u0000' + JSON.stringify(result.intervals));
    const request = dependencies && dependencies.rebuildRequest || requestKazOsV3Rebuild_;
    rebuild = request('WORK_BUSY_IMPORT', 'work_busy', correlation);
  } catch (_) {
    // The verified import stays durable; reconciliation can recover a missed request.
    rebuild = { status: 'request_failed' };
  }
  return Object.assign({}, result, { v3_rebuild: rebuild });
}

function importLatestWorkBusyEmail_(dependencies) {
  const deps = dependencies || {};
  const now = deps.now instanceof Date ? new Date(deps.now.getTime()) : new Date();
  const gmailApp = deps.gmailApp || GmailApp;
  const message = readLatestWorkBusyMessage_(gmailApp);
  const parsed = parseWorkBusyBody_(message.body);
  if (!parsed.length) throw workBusyImportError_('INVALID_PAYLOAD');

  const today = Utilities.formatDate(now, PALURU_WORK_BUSY_TIME_ZONE, 'yyyy-MM-dd');
  const latestDate = addWorkBusyDays_(today, PALURU_WORK_BUSY_MAX_DAYS_AHEAD);
  const currentTime = Utilities.formatDate(now, PALURU_WORK_BUSY_TIME_ZONE, 'HH:mm');
  const eligible = parsed.filter(function(item) {
    if (item.date < today || item.date > latestDate) return false;
    if (item.date === today && item.end <= currentTime) return false;
    return true;
  });

  const spreadsheet = deps.spreadsheet || SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw workBusyImportError_('STORAGE_UNAVAILABLE');
  const lock = deps.lock || (typeof LockService !== 'undefined' ? LockService.getScriptLock() : null);
  let locked = false;
  if (lock) {
    locked = lock.tryLock(10000);
    if (!locked) throw workBusyImportError_('LOCK_UNAVAILABLE');
  }

  try {
    const sheet = ensureWorkBusySheet_(spreadsheet);
    const existing = readWorkBusyRows_(sheet);
    const merged = mergeWorkBusyIntervals_(existing.concat(eligible), now);
    const generatedAt = Utilities.formatDate(now, PALURU_WORK_BUSY_TIME_ZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
    writeWorkBusyRows_(sheet, merged, generatedAt);
    const readBack = readWorkBusyRows_(sheet);
    if (!workBusyReadBackMatches_(merged, readBack, generatedAt)) {
      throw workBusyImportError_('READBACK_MISMATCH');
    }
    return {
      source: PALURU_WORK_BUSY_SOURCE,
      generated_at: generatedAt,
      intervals: readBack.map(function(item) {
        return { date: item.date, start: item.start, end: item.end };
      })
    };
  } finally {
    if (locked && lock) lock.releaseLock();
  }
}

function readLatestWorkBusyMessage_(gmailApp) {
  const app = gmailApp || GmailApp;
  let threads;
  try {
    threads = app.search('subject:' + PALURU_WORK_BUSY_SUBJECT);
  } catch (_) {
    throw workBusyImportError_('SOURCE_UNAVAILABLE');
  }
  let latestMessage = null;
  let latestTimestamp = -Infinity;
  try {
    (Array.isArray(threads) ? threads : []).forEach(function(thread) {
      const messages = thread && thread.getMessages();
      (Array.isArray(messages) ? messages : []).forEach(function(message) {
        if (!message || String(message.getSubject() || '') !== PALURU_WORK_BUSY_SUBJECT) return;
        const messageDate = message.getDate();
        const timestamp = messageDate instanceof Date
          ? messageDate.getTime() : new Date(messageDate).getTime();
        if (!Number.isFinite(timestamp) || timestamp <= latestTimestamp) return;
        latestMessage = message;
        latestTimestamp = timestamp;
      });
    });
  } catch (_) {
    throw workBusyImportError_('SOURCE_UNAVAILABLE');
  }

  if (!latestMessage) throw workBusyImportError_('SOURCE_NOT_FOUND');
  let body;
  try {
    body = String(latestMessage.getPlainBody() || latestMessage.getBody() || '');
  } catch (_) {
    throw workBusyImportError_('SOURCE_UNAVAILABLE');
  }
  if (!body) throw workBusyImportError_('INVALID_PAYLOAD');
  return { body: body };
}

function parseWorkBusyBody_(body) {
  const text = String(body || '').replace(/^\uFEFF/, '').trimStart();
  if (!/^WEEKLY_BUSY(?:\s|$)/.test(text)) return [];

  const records = [];
  const pairPattern = /\bDATE=(\d{4}-\d{2}-\d{2})\s+\bBUSY=(\d{2}:\d{2})-(\d{2}:\d{2})(?=$|\s)/g;
  let match;
  while ((match = pairPattern.exec(text)) !== null) {
    if (!isValidWorkBusyDate_(match[1])) continue;
    const start = normalizeWorkBusyTime_(match[2]);
    const end = normalizeWorkBusyTime_(match[3]);
    if (!start || !end || end <= start) continue;
    records.push({ date: match[1], start: start, end: end });
  }
  return records;
}

function isValidWorkBusyDate_(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() + 1 === Number(match[2])
    && date.getUTCDate() === Number(match[3]);
}

function normalizeWorkBusyTime_(value) {
  const match = String(value || '').match(/^(\d{2}):(\d{2})$/);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return '';
  return match[1] + ':' + match[2];
}

function addWorkBusyDays_(value, days) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw workBusyImportError_('INVALID_DATE');
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + Number(days || 0)));
  return date.toISOString().slice(0, 10);
}

function ensureWorkBusySheet_(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(PALURU_WORK_BUSY_SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(PALURU_WORK_BUSY_SHEET_NAME);
    sheet.getRange(1, 1, 1, PALURU_WORK_BUSY_HEADERS.length).setValues([PALURU_WORK_BUSY_HEADERS]);
    sheet.setFrozenRows(1);
    return sheet;
  }

  const lastColumn = sheet.getLastColumn();
  if (!lastColumn) {
    sheet.getRange(1, 1, 1, PALURU_WORK_BUSY_HEADERS.length).setValues([PALURU_WORK_BUSY_HEADERS]);
    sheet.setFrozenRows(1);
    return sheet;
  }

  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(function(value) {
    return String(value || '').trim();
  });
  const seen = {};
  headers.forEach(function(header) {
    if (!header || PALURU_WORK_BUSY_HEADERS.indexOf(header) < 0 || seen[header]) {
      throw workBusyImportError_('STORAGE_SCHEMA_ERROR');
    }
    seen[header] = true;
  });
  const missing = PALURU_WORK_BUSY_HEADERS.filter(function(header) { return !seen[header]; });
  if (missing.length) {
    sheet.getRange(1, lastColumn + 1, 1, missing.length).setValues([missing]);
    headers.push.apply(headers, missing);
  }
  if (headers.length !== PALURU_WORK_BUSY_HEADERS.length) {
    throw workBusyImportError_('STORAGE_SCHEMA_ERROR');
  }
  sheet.setFrozenRows(1);
  return sheet;
}

function readWorkBusyRows_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];
  const lastColumn = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(function(value) {
    return String(value || '').trim();
  });
  const indexes = {};
  headers.forEach(function(header, index) { indexes[header] = index; });
  return sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues().map(function(row) {
    if (row.every(function(value) { return value === '' || value === null; })) return null;
    const source = String(row[indexes.source] || '').trim();
    const generatedAt = row[indexes.generated_at];
    const date = normalizeWorkBusyDateCell_(row[indexes.date]);
    const start = normalizeWorkBusyTimeCell_(row[indexes.start]);
    const end = normalizeWorkBusyTimeCell_(row[indexes.end]);
    if (source !== PALURU_WORK_BUSY_SOURCE || !generatedAt || !isValidWorkBusyDate_(date)
        || !start || !end || end <= start) {
      throw workBusyImportError_('STORAGE_DATA_ERROR');
    }
    return { source: source, generated_at: String(generatedAt), date: date, start: start, end: end };
  }).filter(Boolean);
}

function workBusyReadBackMatches_(expected, actual, generatedAt) {
  if (!Array.isArray(expected) || !Array.isArray(actual) || expected.length !== actual.length) return false;
  return expected.every(function(item, index) {
    const row = actual[index];
    return row.source === PALURU_WORK_BUSY_SOURCE
      && row.generated_at === generatedAt
      && row.date === item.date
      && row.start === item.start
      && row.end === item.end;
  });
}

function normalizeWorkBusyDateCell_(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return Utilities.formatDate(value, PALURU_WORK_BUSY_TIME_ZONE, 'yyyy-MM-dd');
  }
  return String(value || '').trim();
}

function normalizeWorkBusyTimeCell_(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return Utilities.formatDate(value, PALURU_WORK_BUSY_TIME_ZONE, 'HH:mm');
  }
  return normalizeWorkBusyTime_(String(value || '').trim());
}

function mergeWorkBusyIntervals_(items, nowValue) {
  const now = nowValue instanceof Date ? nowValue : new Date();
  const today = Utilities.formatDate(now, PALURU_WORK_BUSY_TIME_ZONE, 'yyyy-MM-dd');
  const currentTime = Utilities.formatDate(now, PALURU_WORK_BUSY_TIME_ZONE, 'HH:mm');
  const latestDate = addWorkBusyDays_(today, PALURU_WORK_BUSY_MAX_DAYS_AHEAD);
  const candidates = (Array.isArray(items) ? items : []).filter(function(item) {
    return item && isValidWorkBusyDate_(item.date)
      && item.date >= today && item.date <= latestDate
      && normalizeWorkBusyTime_(item.start) && normalizeWorkBusyTime_(item.end)
      && item.end > item.start
      && !(item.date === today && item.end <= currentTime);
  }).map(function(item) {
    return { date: item.date, start: item.start, end: item.end };
  }).sort(function(left, right) {
    return left.date.localeCompare(right.date) || left.start.localeCompare(right.start) || left.end.localeCompare(right.end);
  });

  const merged = [];
  candidates.forEach(function(item) {
    const previous = merged[merged.length - 1];
    if (previous && previous.date === item.date && item.start <= previous.end) {
      if (item.end > previous.end) previous.end = item.end;
      return;
    }
    merged.push({ date: item.date, start: item.start, end: item.end });
  });
  return merged;
}

function writeWorkBusyRows_(sheet, intervals, generatedAt) {
  const lastColumn = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(function(value) {
    return String(value || '').trim();
  });
  const output = intervals.map(function(item) {
    const record = {
      source: PALURU_WORK_BUSY_SOURCE,
      generated_at: generatedAt,
      date: item.date,
      start: item.start,
      end: item.end
    };
    return headers.map(function(header) { return record[header]; });
  });
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, lastColumn).clearContent();
  if (!output.length) return;
  sheet.getRange(2, 1, output.length, lastColumn).setNumberFormat('@');
  sheet.getRange(2, 1, output.length, lastColumn).setValues(output);
}

function workBusyImportError_(code) {
  const error = new Error(String(code || 'WORK_BUSY_UNAVAILABLE'));
  error.code = String(code || 'WORK_BUSY_UNAVAILABLE');
  return error;
}

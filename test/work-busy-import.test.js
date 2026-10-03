'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'gas', 'WorkBusyImportService.js'), 'utf8');
const context = {
  Date, Intl, JSON, Math, Number, Object, Array, String, RegExp, Error, Buffer,
  Utilities: {
    formatDate(date, timezone, pattern) {
      const fields = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
      }).formatToParts(date).reduce((result, part) => Object.assign(result, { [part.type]: part.value }), {});
      if (pattern === 'yyyy-MM-dd') return fields.year + '-' + fields.month + '-' + fields.day;
      if (pattern === 'HH:mm') return fields.hour + ':' + fields.minute;
      if (pattern.includes('XXX')) return fields.year + '-' + fields.month + '-' + fields.day
        + 'T' + fields.hour + ':' + fields.minute + ':' + fields.second + '+09:00';
      throw new Error('unexpected date format');
    },
    base64DecodeWebSafe(value) { return Buffer.from(value, 'base64url'); },
    newBlob(value) { return { getDataAsString() { return Buffer.from(value).toString('utf8'); } }; }
  }
};
vm.createContext(context);
new vm.Script(source, { filename: 'WorkBusyImportService.js' }).runInContext(context);
const importLatest = context.importLatestWorkBusyEmail_;
const parseBody = context.parseWorkBusyBody_;
const extractBody = context.extractWorkBusyPlainText_;

function fakeSheet() {
  return {
    headers: [],
    rows: [],
    frozenRows: 0,
    getLastRow() { return this.headers.length ? this.rows.length + 1 : 0; },
    getLastColumn() { return this.headers.length; },
    setFrozenRows(value) { this.frozenRows = value; },
    getRange(row, column, rowCount, columnCount) {
      const sheet = this;
      return {
        setValues(values) {
          if (row === 1) {
            for (let index = 0; index < values[0].length; index += 1) {
              sheet.headers[column - 1 + index] = values[0][index];
            }
            return this;
          }
          for (let index = 0; index < rowCount; index += 1) {
            sheet.rows[row - 2 + index] = values[index].slice(0, columnCount);
          }
          return this;
        },
        getValues() {
          if (row === 1) return [sheet.headers.slice(column - 1, column - 1 + columnCount)];
          return Array.from({ length: rowCount }, (_, index) => {
            const value = sheet.rows[row - 2 + index] || [];
            return Array.from({ length: columnCount }, (__, cell) => value[column - 1 + cell] ?? '');
          });
        },
        clearContent() {
          sheet.rows = sheet.rows.slice(0, row - 2);
          return this;
        },
        setNumberFormat() { return this; }
      };
    }
  };
}

function fakeSpreadsheet(sheet) {
  const writes = [];
  return {
    writes,
    getSheetByName(name) {
      assert.equal(name, 'WorkBusy');
      return sheet.headers.length ? sheet : null;
    },
    insertSheet(name) {
      writes.push(name);
      assert.equal(name, 'WorkBusy');
      return sheet;
    }
  };
}

function fakeGmail(body, subject = 'PALURU_AVAILABILITY') {
  const encoded = Buffer.from(body, 'utf8').toString('base64url');
  const calls = { list: [], get: [] };
  const gmail = {
    Users: {
      Messages: {
        list(userId, options) {
          calls.list.push({ userId, options });
          return { messages: [{ id: 'message-id-not-for-storage' }] };
        },
        get(userId, id, options) {
          calls.get.push({ userId, id, options });
          return {
            payload: {
              mimeType: 'multipart/alternative',
              headers: [{ name: 'Subject', value: subject }, { name: 'From', value: 'private@example.test' }],
              parts: [{ mimeType: 'text/plain', body: { data: encoded } }]
            }
          };
        }
      }
    }
  };
  return { gmail, calls };
}

function fakeAttachmentGmail(attachments = {}) {
  const calls = [];
  return {
    calls,
    Users: {
      Messages: {
        Attachments: {
          get(userId, messageId, attachmentId) {
            calls.push({ userId, messageId, attachmentId });
            return { data: attachments[attachmentId] || '' };
          }
        }
      }
    }
  };
}

function encodeBase64Url(value) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

test('extracts inline top-level text/plain body.data', () => {
  const gmail = fakeAttachmentGmail();
  const result = extractBody('message-id', {
    mimeType: 'text/plain',
    body: { data: encodeBase64Url('TOP LEVEL INLINE BODY') }
  }, gmail);
  assert.equal(result, 'TOP LEVEL INLINE BODY');
  assert.deepEqual(gmail.calls, []);
});

test('extracts inline body.data from nested multipart parts', () => {
  const gmail = fakeAttachmentGmail();
  const result = extractBody('message-id', {
    mimeType: 'multipart/mixed',
    parts: [{
      mimeType: 'multipart/alternative',
      parts: [{
        mimeType: 'text/plain',
        body: { data: encodeBase64Url('NESTED INLINE BODY') }
      }]
    }]
  }, gmail);
  assert.equal(result, 'NESTED INLINE BODY');
  assert.deepEqual(gmail.calls, []);
});

test('fetches a text/plain body.attachmentId when body.data is absent', () => {
  const gmail = fakeAttachmentGmail({
    'plain-attachment-id': encodeBase64Url('ATTACHED PLAIN BODY')
  });
  const result = extractBody('message-id', {
    mimeType: 'multipart/alternative',
    parts: [{
      mimeType: 'text/plain',
      body: { attachmentId: 'plain-attachment-id' }
    }]
  }, gmail);
  assert.equal(result, 'ATTACHED PLAIN BODY');
  assert.deepEqual(gmail.calls, [{
    userId: 'me', messageId: 'message-id', attachmentId: 'plain-attachment-id'
  }]);
});

test('fetches and converts text/html body.attachmentId as fallback', () => {
  const gmail = fakeAttachmentGmail({
    'html-attachment-id': encodeBase64Url(
      '<div>WEEKLY_BUSY</div><p>DATE=2027-01-02 BUSY=09:00-10:00</p>'
    )
  });
  const result = extractBody('message-id', {
    mimeType: 'multipart/mixed',
    parts: [{
      mimeType: 'multipart/related',
      parts: [{
        mimeType: 'text/html',
        body: { attachmentId: 'html-attachment-id' }
      }]
    }]
  }, gmail);
  assert.equal(result, 'WEEKLY_BUSY\nDATE=2027-01-02 BUSY=09:00-10:00');
  assert.deepEqual(gmail.calls, [{
    userId: 'me', messageId: 'message-id', attachmentId: 'html-attachment-id'
  }]);
});

function runImport(body, subject) {
  const sheet = fakeSheet();
  const spreadsheet = fakeSpreadsheet(sheet);
  const now = new Date('2026-10-02T10:00:00+09:00');
  const mail = fakeGmail(body, subject);
  const lock = { acquired: 0, released: 0, tryLock() { this.acquired += 1; return true; }, releaseLock() { this.released += 1; } };
  const result = importLatest({ now, gmail: mail.gmail, spreadsheet, lock });
  return { result: JSON.parse(JSON.stringify(result)), sheet, spreadsheet, calls: mail.calls, lock };
}

test('reads one exact-subject message, normalizes intervals, writes five fields, and verifies read-back', () => {
  const body = [
    'WEEKLY_BUSY DATE=2026-10-01 BUSY=09:00-10:00',
    'DATE=2026-10-02 BUSY=08:30-09:00 DATE=2026-10-02 BUSY=09:30-10:30 DATE=2026-10-02 BUSY=10:30-11:00',
    'DATE=2026-10-02 BUSY=09:30-10:30',
    'DATE=2026-10-02 BUSY=12:00-13:00',
    'DATE=2026-10-02 BUSY=13:00-12:30',
    'DATE=2026-10-02 BUSY=24:00-25:00',
    'DATE=2026-10-03 BUSY=09:00-09:30',
    'DATE=2026-11-01 BUSY=08:30-09:00',
    'DATE=2026-11-02 BUSY=09:00-10:00',
    'Synthetic company disclaimer text is ignored.'
  ].join('\n');
  const { result, sheet, spreadsheet, calls, lock } = runImport(body);
  assert.equal(calls.list.length, 1);
  assert.equal(calls.list[0].userId, 'me');
  assert.equal(calls.list[0].options.maxResults, 1);
  assert.equal(calls.list[0].options.q, 'subject:PALURU_AVAILABILITY');
  assert.equal(calls.get.length, 1);
  assert.equal(calls.get[0].id, 'message-id-not-for-storage');
  assert.deepEqual(sheet.headers, ['source', 'generated_at', 'date', 'start', 'end']);
  assert.equal(sheet.rows.length, 4);
  assert.deepEqual(sheet.rows.map((row) => row.slice(2)), [
    ['2026-10-02', '09:30', '11:00'],
    ['2026-10-02', '12:00', '13:00'],
    ['2026-10-03', '09:00', '09:30'],
    ['2026-11-01', '08:30', '09:00']
  ]);
  assert(sheet.rows.every((row) => row.length === 5));
  assert(sheet.rows.every((row) => row[0] === 'Gmail:PALURU_AVAILABILITY'));
  assert(sheet.rows.every((row) => row[1] === '2026-10-02T10:00:00+09:00'));
  assert.deepEqual(result.intervals, sheet.rows.map((row) => ({ date: row[2], start: row[3], end: row[4] })));
  assert(!JSON.stringify(sheet.rows).includes('message-id-not-for-storage'));
  assert(!JSON.stringify(sheet.rows).includes('DATE='));
  assert.deepEqual(spreadsheet.writes, ['WorkBusy']);
  assert.equal(lock.acquired, 1);
  assert.equal(lock.released, 1);
});

test('rejects a non-exact latest subject without creating or changing WorkBusy', () => {
  const sheet = fakeSheet();
  const spreadsheet = fakeSpreadsheet(sheet);
  const mail = fakeGmail('WEEKLY_BUSY DATE=2026-10-02 BUSY=11:00-12:00', 'Re: PALURU_AVAILABILITY');
  assert.throws(() => importLatest({
    now: new Date('2026-10-02T10:00:00+09:00'),
    gmail: mail.gmail,
    spreadsheet
  }), (error) => error.code === 'SUBJECT_MISMATCH');
  assert.equal(mail.calls.list.length, 1);
  assert.equal(mail.calls.get.length, 1);
  assert.equal(sheet.headers.length, 0);
  assert.deepEqual(spreadsheet.writes, []);
});

test('ignores malformed, past, 30-day-plus, zero-minute, and reversed intervals', () => {
  const body = [
    'WEEKLY_BUSY',
    'DATE=2026-02-30 BUSY=09:00-10:00',
    'DATE=2026-10-02x BUSY=14:00-15:00',
    'DATE=2026-10-02 BUSY=08:30-09:00',
    'DATE=2026-10-02 BUSY=10:00-10:00',
    'DATE=2026-10-02 BUSY=18:00-09:00',
    'DATE=2026-10-02 BUSY=25:00-26:00',
    'DATE=2026-10-02 BUSY=11:00-12:00',
    'DATE=2026-11-02 BUSY=09:00-10:00',
    'Synthetic company disclaimer text is ignored.'
  ].join('\n');
  const { result, sheet } = runImport(body);
  assert.deepEqual(result.intervals, [{ date: '2026-10-02', start: '11:00', end: '12:00' }]);
  assert.equal(sheet.rows.length, 1);
});

test('rejects an unusable message before creating or changing WorkBusy', () => {
  const sheet = fakeSheet();
  const spreadsheet = fakeSpreadsheet(sheet);
  const mail = fakeGmail('WEEKLY_BUSY DATE=2026-10-02 BUSY=18:00-09:00');
  assert.throws(() => importLatest({
    now: new Date('2026-10-02T10:00:00+09:00'),
    gmail: mail.gmail,
    spreadsheet
  }), (error) => error.code === 'INVALID_PAYLOAD');
  assert.equal(sheet.headers.length, 0);
  assert.deepEqual(spreadsheet.writes, []);
});

test('requires the WEEKLY_BUSY header before parsing DATE/BUSY pairs', () => {
  assert.equal(parseBody('DATE=2026-10-03 BUSY=09:00-10:00').length, 0);
  assert.equal(parseBody('WEEKLY_BUSY_BAD DATE=2026-10-03 BUSY=09:00-10:00').length, 0);
});
test('public Apps Script entrypoint imports one message and returns the verified WorkBusy rows', () => {
  const sheet = fakeSheet();
  const spreadsheet = fakeSpreadsheet(sheet);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).reduce((values, part) => Object.assign(values, { [part.type]: part.value }), {});
  const tomorrow = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + 1)).toISOString().slice(0, 10);
  const mail = fakeGmail('WEEKLY_BUSY DATE=' + tomorrow + ' BUSY=10:00-11:00');
  const lock = { acquired: 0, released: 0, tryLock() { this.acquired += 1; return true; }, releaseLock() { this.released += 1; } };
  const previous = { Gmail: context.Gmail, SpreadsheetApp: context.SpreadsheetApp, LockService: context.LockService };
  context.Gmail = mail.gmail;
  context.SpreadsheetApp = { getActiveSpreadsheet() { return spreadsheet; } };
  context.LockService = { getScriptLock() { return lock; } };
  try {
    const result = JSON.parse(JSON.stringify(context.importLatestWorkBusyEmailV1()));
    assert.equal(mail.calls.list.length, 1);
    assert.equal(mail.calls.get.length, 1);
    assert.deepEqual(sheet.headers, ['source', 'generated_at', 'date', 'start', 'end']);
    assert.deepEqual(result.intervals, [{ date: tomorrow, start: '10:00', end: '11:00' }]);
    assert.deepEqual(spreadsheet.writes, ['WorkBusy']);
    assert.equal(lock.acquired, 1);
    assert.equal(lock.released, 1);
  } finally {
    if (previous.Gmail === undefined) delete context.Gmail; else context.Gmail = previous.Gmail;
    if (previous.SpreadsheetApp === undefined) delete context.SpreadsheetApp; else context.SpreadsheetApp = previous.SpreadsheetApp;
    if (previous.LockService === undefined) delete context.LockService; else context.LockService = previous.LockService;
  }
});

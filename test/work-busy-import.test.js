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
    }
  }
};
vm.createContext(context);
new vm.Script(source, { filename: 'WorkBusyImportService.js' }).runInContext(context);
const importLatest = context.importLatestWorkBusyEmail_;
const parseBody = context.parseWorkBusyBody_;
const readLatestMessage = context.readLatestWorkBusyMessage_;

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

function makeMessage(subject, date, plainBody, htmlBody) {
  const calls = { plainBody: 0, body: 0 };
  return {
    calls,
    getSubject() { return subject; },
    getDate() { return new Date(date); },
    getPlainBody() { calls.plainBody += 1; return plainBody; },
    getBody() { calls.body += 1; return htmlBody; }
  };
}

function fakeGmailApp(threadMessages) {
  const calls = { search: [], getMessages: 0 };
  const threads = threadMessages.map((messages) => ({
    getMessages() { calls.getMessages += 1; return messages; }
  }));
  return {
    calls,
    gmailApp: {
      search(query) { calls.search.push(query); return threads; }
    }
  };
}

function fakeGmail(body, subject = 'PALURU_AVAILABILITY') {
  return fakeGmailApp([[
    makeMessage(subject, '2026-10-01T00:00:00Z', body, '<html>fallback</html>')
  ]]);
}

test('prefers GmailApp plain body over HTML body', () => {
  const message = makeMessage('PALURU_AVAILABILITY', '2026-10-01T00:00:00Z', 'PLAIN', 'HTML');
  const gmail = fakeGmailApp([[message]]);
  assert.equal(readLatestMessage(gmail.gmailApp).body, 'PLAIN');
  assert.deepEqual(gmail.calls.search, ['subject:PALURU_AVAILABILITY']);
  assert.equal(message.calls.plainBody, 1);
  assert.equal(message.calls.body, 0);
});

test('uses GmailApp HTML body when plain body is empty', () => {
  const message = makeMessage('PALURU_AVAILABILITY', '2026-10-01T00:00:00Z', '', '<html>HTML</html>');
  const gmail = fakeGmailApp([[message]]);
  assert.equal(readLatestMessage(gmail.gmailApp).body, '<html>HTML</html>');
  assert.equal(message.calls.plainBody, 1);
  assert.equal(message.calls.body, 1);
});

test('selects the newest exact-subject message across search result threads', () => {
  const older = makeMessage('PALURU_AVAILABILITY', '2026-09-30T23:00:00Z', 'OLDER', '');
  const newer = makeMessage('PALURU_AVAILABILITY', '2026-10-01T01:00:00Z', 'NEWER', '');
  const gmail = fakeGmailApp([[older], [newer]]);
  assert.equal(readLatestMessage(gmail.gmailApp).body, 'NEWER');
  assert.equal(gmail.calls.getMessages, 2);
  assert.equal(older.calls.plainBody, 0);
  assert.equal(newer.calls.plainBody, 1);
});

test('excludes a newer message whose subject is not an exact match', () => {
  const exact = makeMessage('PALURU_AVAILABILITY', '2026-09-30T23:00:00Z', 'EXACT', '');
  const mismatch = makeMessage('Re: PALURU_AVAILABILITY', '2026-10-01T01:00:00Z', 'MISMATCH', '');
  const gmail = fakeGmailApp([[exact], [mismatch]]);
  assert.equal(readLatestMessage(gmail.gmailApp).body, 'EXACT');
  assert.equal(exact.calls.plainBody, 1);
  assert.equal(mismatch.calls.plainBody, 0);
});

function runImport(body, subject) {
  const sheet = fakeSheet();
  const spreadsheet = fakeSpreadsheet(sheet);
  const now = new Date('2026-10-02T10:00:00+09:00');
  const mail = fakeGmail(body, subject);
  const lock = { acquired: 0, released: 0, tryLock() { this.acquired += 1; return true; }, releaseLock() { this.released += 1; } };
  const result = importLatest({ now, gmailApp: mail.gmailApp, spreadsheet, lock });
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
  assert.deepEqual(calls.search, ['subject:PALURU_AVAILABILITY']);
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
    gmailApp: mail.gmailApp,
    spreadsheet
  }), (error) => error.code === 'SOURCE_NOT_FOUND');
  assert.deepEqual(mail.calls.search, ['subject:PALURU_AVAILABILITY']);
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
    gmailApp: mail.gmailApp,
    spreadsheet
  }), (error) => error.code === 'INVALID_PAYLOAD');
  assert.equal(sheet.headers.length, 0);
  assert.deepEqual(spreadsheet.writes, []);
});

test('requires the WEEKLY_BUSY header before parsing DATE/BUSY pairs', () => {
  assert.equal(parseBody('DATE=2026-10-03 BUSY=09:00-10:00').length, 0);
  assert.equal(parseBody('WEEKLY_BUSY_BAD DATE=2026-10-03 BUSY=09:00-10:00').length, 0);
});

test('binds each same-line BUSY interval to its preceding DATE across multiple lines and drops zero duration', () => {
  const body = [
    'WEEKLY_BUSY DATE=2026-10-03 BUSY=09:00-10:00 DATE=2026-10-04 BUSY=11:00-12:00 DATE=2026-10-05 BUSY=13:00-13:00',
    'DATE=2026-10-06 BUSY=14:00-15:00'
  ].join('\n');
  const records = JSON.parse(JSON.stringify(parseBody(body)));
  assert.deepEqual(records, [
    { date: '2026-10-03', start: '09:00', end: '10:00' },
    { date: '2026-10-04', start: '11:00', end: '12:00' },
    { date: '2026-10-06', start: '14:00', end: '15:00' }
  ]);
});

test('public Apps Script entrypoint imports one message and returns the verified WorkBusy rows', () => {
  const sheet = fakeSheet();
  const spreadsheet = fakeSpreadsheet(sheet);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).reduce((values, part) => Object.assign(values, { [part.type]: part.value }), {});
  const tomorrow = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + 1)).toISOString().slice(0, 10);
  const mail = fakeGmail('WEEKLY_BUSY DATE=' + tomorrow + ' BUSY=10:00-11:00');
  const lock = { acquired: 0, released: 0, tryLock() { this.acquired += 1; return true; }, releaseLock() { this.released += 1; } };
  const previous = { GmailApp: context.GmailApp, SpreadsheetApp: context.SpreadsheetApp, LockService: context.LockService };
  context.GmailApp = mail.gmailApp;
  context.SpreadsheetApp = { getActiveSpreadsheet() { return spreadsheet; } };
  context.LockService = { getScriptLock() { return lock; } };
  try {
    const result = JSON.parse(JSON.stringify(context.importLatestWorkBusyEmailV1()));
    assert.deepEqual(mail.calls.search, ['subject:PALURU_AVAILABILITY']);
    assert.deepEqual(sheet.headers, ['source', 'generated_at', 'date', 'start', 'end']);
    assert.deepEqual(result.intervals, [{ date: tomorrow, start: '10:00', end: '11:00' }]);
    assert.deepEqual(spreadsheet.writes, ['WorkBusy']);
    assert.equal(lock.acquired, 1);
    assert.equal(lock.released, 1);
  } finally {
    if (previous.GmailApp === undefined) delete context.GmailApp; else context.GmailApp = previous.GmailApp;
    if (previous.SpreadsheetApp === undefined) delete context.SpreadsheetApp; else context.SpreadsheetApp = previous.SpreadsheetApp;
    if (previous.LockService === undefined) delete context.LockService; else context.LockService = previous.LockService;
  }
});

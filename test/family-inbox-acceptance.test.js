'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const runId = '11111111-1111-4111-8111-111111111111';
const bytes = Buffer.from('%PDF-1.4\nsynthetic only\n%%EOF\n');
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');

function fixture() {
  const state = { logs: [], folders: {}, sheets: {}, lock: false, counter: 1, writes: 0, dropError: false, ledgerError: false };
  const properties = {
    FAMILY_INBOX_ACCEPTANCE_TOKEN: 'acceptance-secret', FAMILY_INBOX_SERVICE_TOKEN: 'mini-secret',
    FAMILY_INBOX_WORKER_TOKEN: 'worker-secret', FAMILY_INBOX_WORKER_ID: 'worker-test',
    FAMILY_INBOX_RAW_FOLDER_ID: 'raw', FAMILY_INBOX_LEDGER_SPREADSHEET_ID: 'ledger',
    FAMILY_INBOX_DRIVE_DROP_FOLDER_ID: 'drop', FAMILY_INBOX_DRIVE_DROP_HOME_ID: 'home-test',
    FAMILY_INBOX_DRIVE_DROP_SUBMITTED_BY_MEMBER_ID: 'guardian-test',
  };
  const iterator = (values) => { let index = 0; return { hasNext: () => index < values.length, next: () => values[index++] }; };
  function folder(name) {
    const files = [];
    return { files, getFilesByName: (name) => iterator(files.filter((f) => f.getName() === name)),
      getFiles: () => { throw new Error('folder-wide scan is forbidden'); },
      createFile(blob) {
        if (state.dropError && name === 'drop') throw new Error('private storage error');
        state.writes++;
        const file = { getId: () => id, getName: () => blob.name, getMimeType: () => blob.mediaType, getSize: () => blob.bytes.length, getBlob: () => ({ getBytes: () => blob.bytes.slice() }), setTrashed: () => {} };
        const id = `${name}-${files.length + 1}`; files.push(file); return file;
      },
    };
  }
  state.folders.drop = folder('drop'); state.folders.raw = folder('raw');
  const api = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => properties[key] || '' }) },
    LockService: { getScriptLock: () => ({ waitLock() { assert.equal(state.lock, false); state.lock = true; }, releaseLock() { state.lock = false; } }) },
    DriveApp: { getFolderById: (id) => { assert(['drop', 'raw'].includes(id)); return state.folders[id]; }, getFileById: (id) => state.folders.raw.files.find((file) => file.getId() === id) },
    SpreadsheetApp: { openById: (id) => { assert.equal(id, 'ledger'); return { getSheetByName: (name) => state.sheets[name] }; } },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (text) => ({ text, setMimeType() { return this; } }) },
    Utilities: {
      getUuid: () => `00000000-0000-4000-8000-${String(state.counter++).padStart(12, '0')}`,
      DigestAlgorithm: { SHA_256: 'sha256' }, computeDigest: (_, value) => Array.from(crypto.createHash('sha256').update(Buffer.from(value)).digest()),
      base64Decode: (value) => Array.from(Buffer.from(value, 'base64')), base64Encode: (value) => Buffer.from(value).toString('base64'),
      newBlob: (value, mediaType, name) => ({ bytes: Array.from(typeof value === 'string' ? Buffer.from(value) : value), mediaType, name, getBytes() { return this.bytes.slice(); } }),
      formatDate: (date) => date.toISOString(),
    },
    Logger: { log: (line) => state.logs.push(line) }, Date, Object, Array, String, Number, Error, Math, RegExp, JSON, isFinite,
  };
  vm.createContext(api);
  for (const file of ['FamilyInboxService.js', 'FamilyInboxWorkerService.js', 'FamilyInboxReviewService.js', 'FamilyInboxPcReviewService.js', 'DriveDropImporter.js', 'FamilyInboxAcceptanceService.js', 'Code.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'gas-family-inbox', file), 'utf8'), api);
  }
  const definitions = vm.runInContext('({Family_Inbox:FAMILY_INBOX_HEADERS,Family_Candidates:FAMILY_INBOX_CANDIDATE_HEADERS.concat(FAMILY_INBOX_REVIEW_EXTRA_HEADERS,FAMILY_INBOX_PC_REVIEW_CANDIDATE_HEADERS),Family_Review_Items:FAMILY_INBOX_PC_REVIEW_HEADERS})', api);
  for (const [name, headers] of Object.entries(definitions)) {
    const sheet = { values: [Array.from(headers).reverse()], getLastRow() { return this.values.length; }, getLastColumn() { return this.values[0].length; },
      appendRow(row) { if (state.ledgerError) throw new Error('private ledger error'); this.values.push(row.slice()); },
      getRange(row, col, rows, cols) {
        return { getValues: () => Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => sheet.values[row - 1 + r]?.[col - 1 + c] ?? '')),
          setValues(values) { for (let r = 0; r < rows; r++) { sheet.values[row - 1 + r] ||= Array(sheet.getLastColumn()).fill(''); for (let c = 0; c < cols; c++) sheet.values[row - 1 + r][col - 1 + c] = values[r][c]; } },
        };
      },
    };
    state.sheets[name] = sheet;
  }
  const request = (suffix, fields = {}) => ({ operation: `familyInbox.acceptance.${suffix}`, acceptanceToken: 'acceptance-secret', ...(suffix === 'check' ? {} : { runId, sha256: digest(bytes) }), ...fields });
  const post = (body) => JSON.parse(api.doPost({ postData: { contents: JSON.stringify(body) } }).text);
  const place = () => post(request('place', { base64: bytes.toString('base64') }));
  const ingest = () => post(request('import'));
  const row = (sheet, record) => sheet.values.push(sheet.values[0].map((header) => record[header] ?? ''));
  return { api, state, properties, post, request, place, ingest, row };
}

test('dedicated credential, missing config, spoofed scope and arbitrary operation fail before writes', () => {
  for (const patch of [{ acceptanceToken: '' }, { acceptanceToken: 'worker-secret' }, { homeId: 'foreign' }, { folderId: 'other' }, { processingProfile: 'school-v1' }, { operation: 'familyInbox.acceptance.executeFunction', function: 'danger' }]) {
    const f = fixture(); const response = f.post(f.request('check', patch));
    assert.equal(response.success, false); assert.equal(f.state.writes, 0);
  }
  const f = fixture(); delete f.properties.FAMILY_INBOX_ACCEPTANCE_TOKEN;
  assert.equal(f.post(f.request('check')).error.code, 'CONFIGURATION_ERROR');
  assert.equal(f.state.writes, 0);
  // Acceptance credential cannot claim, publish, or act as a reviewer.
  for (const operation of ['familyInbox.claimNext', 'familyInbox.publishCandidates', 'familyInbox.pcReview.approve']) {
    assert.equal(f.post({ operation, acceptanceToken: 'acceptance-secret' }).success, false);
  }
  const g = fixture(); g.properties.FAMILY_INBOX_WORKER_TOKEN = g.properties.FAMILY_INBOX_ACCEPTANCE_TOKEN;
  assert.equal(g.post(g.request('check')).error.code, 'CONFIGURATION_ERROR'); assert.equal(g.state.writes, 0);
  const h = fixture(); h.post(h.request('check', { operation: 'familyInbox.acceptance.private-token' }));
  assert(!h.state.logs.join('').includes('private-token'));
});

test('schema check is read-only and incomplete schemas fail closed', () => {
  const f = fixture(); assert.equal(f.post(f.request('check')).data.ready, true); assert.equal(f.state.writes, 0);
  f.state.sheets.Family_Candidates.values[0].pop();
  assert.equal(f.post(f.request('check')).error.code, 'CONFIGURATION_ERROR'); assert.equal(f.state.writes, 0);
});

test('Drop placement/import creates exactly one new pending long Inbox and leaves other pending rows unchanged', () => {
  const f = fixture();
  f.row(f.state.sheets.Family_Inbox, { inboxId: 'inb_' + 'f'.repeat(32), status: 'pending', homeId: 'home-test', sha256: 'a'.repeat(64) });
  const prior = JSON.stringify(f.state.sheets.Family_Inbox.values[1]);
  f.state.folders.drop.createFile({ name: 'other-pending.pdf', mediaType: 'application/pdf', bytes: [37, 80, 68, 70, 45, 9] });
  assert.equal(f.place().data.placed, true);
  const imported = f.ingest(); assert.equal(imported.success, true);
  assert.equal(imported.data.status, 'pending'); assert.equal(imported.data.processingProfile, 'school-v1-long');
  assert.equal(imported.data.claimVersion, 0); assert.equal(imported.data.attemptCount, 0);
  assert.equal(f.state.sheets.Family_Inbox.values.length, 3); assert.equal(f.state.folders.raw.files.length, 1);
  assert.equal(JSON.stringify(f.state.sheets.Family_Inbox.values[1]), prior);
  assert.equal(f.ingest().error.code, 'DUPLICATE_REQUEST');
  assert.equal(f.place().error.code, 'DUPLICATE_REQUEST');
  assert.equal(f.state.sheets.Family_Inbox.values.length, 3); assert.equal(f.state.folders.raw.files.length, 1);
  const headers = f.state.sheets.Family_Inbox.values[0];
  assert.equal(f.state.sheets.Family_Inbox.values[2][headers.indexOf('subjectMemberHint')], '');
  assert.equal(f.state.sheets.Family_Inbox.values[2][headers.indexOf('source')], 'drive_drop');
  for (const privateValue of ['acceptance-secret', bytes.toString('base64'), 'other-pending.pdf']) assert(!f.state.logs.join('').includes(privateValue));
});

test('hash/MIME/naming conflicts and storage/ledger failures are not hidden', () => {
  let f = fixture(); assert.equal(f.post(f.request('place', { base64: 'cHJpdmF0ZQ==' })).error.code, 'INVALID_FILE_SIGNATURE');
  f = fixture(); assert.equal(f.post(f.request('place', { base64: bytes.toString('base64'), sha256: 'a'.repeat(64) })).error.code, 'INVALID_INPUT');
  f = fixture(); f.state.dropError = true; assert.equal(f.place().error.code, 'STORAGE_ERROR'); assert.equal(f.state.sheets.Family_Inbox.values.length, 1);
  f = fixture(); f.place(); f.state.ledgerError = true; assert.equal(f.ingest().error.code, 'LEDGER_ERROR'); assert.equal(f.state.sheets.Family_Inbox.values.length, 1);
  f = fixture(); f.place(); f.state.folders.drop.files.push(f.state.folders.drop.files[0]); assert.equal(f.ingest().error.code, 'DATA_INTEGRITY_ERROR');
});

test('verify checks exact group, counts, SHA, home and needs_review across both ledgers', () => {
  const f = fixture(); f.place(); const inbox = f.ingest().data;
  const publishRequestId = '22222222-2222-4222-8222-222222222222';
  const payloadDigest = 'b'.repeat(64);
  const headers = f.state.sheets.Family_Inbox.values[0];
  const record = f.state.sheets.Family_Inbox.values[1];
  record[headers.indexOf('status')] = 'needs_review'; record[headers.indexOf('claimVersion')] = 1;
  const common = { inboxId: inbox.inboxId, homeId: 'home-test', profile: 'school-v1-long', publishRequestId, payloadDigest, claimVersion: 1, sourceSha256: digest(bytes) };
  f.row(f.state.sheets.Family_Candidates, { ...common, candidateId: 'cand_' + 'a'.repeat(32) });
  f.row(f.state.sheets.Family_Review_Items, { ...common, reviewItemId: 'rvi_' + 'a'.repeat(32) });
  const req = f.request('verify', { inboxId: inbox.inboxId, publishRequestId, payloadDigest, claimVersion: 1, candidateCount: 1, reviewItemCount: 1 });
  assert.equal(f.post(req).data.groupMatched, true);
  for (const patch of [{ candidateCount: 2 }, { payloadDigest: 'c'.repeat(64) }, { inboxId: 'inb_' + 'f'.repeat(32) }]) assert.equal(f.post({ ...req, ...patch }).success, false);
  for (const [field, value] of [['homeId', 'foreign'], ['payloadDigest', 'c'.repeat(64)], ['sourceSha256', 'c'.repeat(64)], ['claimVersion', 2], ['profile', 'school-v1']]) {
    const sheet = f.state.sheets.Family_Review_Items; const index = sheet.values[0].indexOf(field); const original = sheet.values[1][index];
    sheet.values[1][index] = value; assert.equal(f.post(req).success, false); sheet.values[1][index] = original;
  }
  const serialized = JSON.stringify(f.post(req));
  for (const forbidden of ['sourceSha256', 'originalRef', 'homeId', 'publishRequestId', 'payloadDigest']) assert(!serialized.includes(forbidden));
});

test('exact intake -> real claim/source/publish helpers -> verified two-ledger group; other pending immutable', () => {
  const f = fixture();
  f.row(f.state.sheets.Family_Inbox, { inboxId: 'inb_' + 'f'.repeat(32), status: 'pending', homeId: 'home-test', sha256: 'a'.repeat(64), processingProfile: 'school-v1-long' });
  const previous = JSON.stringify(f.state.sheets.Family_Inbox.values[1]);
  assert.equal(f.place().success, true); const inbox = f.ingest().data;
  const call = (operation, fields) => f.post({ operation, workerToken: 'worker-secret', ...fields });
  const claim = call('familyInbox.claimNext', { inboxId: inbox.inboxId });
  assert.equal(claim.success, true); assert.equal(claim.data.claimVersion, 1);
  assert.equal(claim.data.inboxId, inbox.inboxId);
  const source = call('familyInbox.getClaimedSource', { inboxId: inbox.inboxId, claimVersion: 1 });
  assert.equal(source.success, true); assert.equal(source.data.base64, bytes.toString('base64'));
  const candidates = [{ candidateType: 'school.document', schemaVersion: 'school.document/1.0', confidence: 0.98,
    evidence: [{ page: 1, quote: 'synthetic', fieldPaths: ['title'] }], warnings: [], questions: [],
    payload: { title: 'Synthetic notice', documentType: 'notice', documentDate: null, relevantNotes: [] } }];
  const reviewItems = [{ reviewType: 'page_fragment', status: 'needs_review', candidateType: 'schedule.event', confidence: 0.8, fragmentCount: 1,
    evidence: [{ page: 2, quote: 'synthetic', fieldPaths: ['title'] }], warnings: ['unresolved_required_field:date'], questions: ['confirm_event_date'],
    payload: { title: 'Synthetic event', date: null, startTime: null, endTime: null, location: null, notes: null } }];
  const payloadDigest = digest(f.api.familyInboxWorkerStableStringify_({ candidates, reviewItems }));
  const publishRequestId = '22222222-2222-4222-8222-222222222222';
  const published = call('familyInbox.publishCandidates', { inboxId: inbox.inboxId, claimVersion: 1, candidates, reviewItems, payloadDigest, publishRequestId, usage: { inputTokens: 100, outputTokens: 50 }, durationMs: 500 });
  assert.equal(published.success, true, JSON.stringify(published));
  assert.equal(published.data.candidateIds.length, 1); assert.equal(published.data.reviewItemIds.length, 1);
  const verified = f.post(f.request('verify', { inboxId: inbox.inboxId, claimVersion: 1, payloadDigest, publishRequestId, candidateCount: 1, reviewItemCount: 1 }));
  assert.equal(verified.success, true); assert.equal(verified.data.status, 'needs_review');
  assert.equal(verified.data.groupMatched, true); assert.equal(JSON.stringify(f.state.sheets.Family_Inbox.values[1]), previous);
  assert.deepEqual(Object.keys(f.state.sheets).sort(), ['Family_Candidates', 'Family_Inbox', 'Family_Review_Items']);
});

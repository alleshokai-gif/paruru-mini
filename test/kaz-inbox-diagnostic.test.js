'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'gas', 'KazOsInboxDiagnostics.js'), 'utf8');

function runCase({ read, sanitize, ledger }) {
  const logs = [];
  const context = {
    JSON, String, Number, Object, Array, Error,
    Utilities: { getUuid: () => '11111111-1111-4111-8111-111111111111' },
    Logger: { log: value => logs.push(value) },
    console: { log: value => logs.push(value) },
    createKazOsInboxTrace_: () => ({ request_id: '11111111-1111-4111-8111-111111111111' }),
    homeMembershipError_: code => Object.assign(new Error(code), { code }),
    readKazOsInbox_: read,
    sanitizeKazOsInbox_: sanitize,
    applyKazOsDecisionLedger_: ledger,
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'gas/KazOsInboxDiagnostics.js' });
  return { result: context.diagnoseKazOsInboxProduction(), logs };
}

const observed = {
  schema_version:'kaz-secretary-inbox-0.1', origin:'real_operational_sources',
  mode:'read_only_display', fixture_only:false, fixture_fallback:false,
  sources:Object.fromEntries(['inbox','projects','tasks','calendar','resolution'].map(name => [name, {
    status:'ok',complete:true,fetched_at:'2026-09-20T00:00:00+09:00',
    valid_until:'2026-09-20T00:15:00+09:00',source_revision:'rev'
  }])),
  projects:[],work_items:[],calendar_events:[],inbox_items:[],
  persistence:{kind:'none',status:'disabled'},writes:{notion:0,calendar:0,context:0}
};

{
  const {result, logs} = runCase({
    read: () => structuredClone(observed),
    sanitize: value => structuredClone(value),
    ledger: value => ({...value,mode:'controlled_proposal',persistence:{kind:'paluru_spreadsheet_append_only',status:'enabled'}}),
  });
  assert.equal(result.ok, true);
  assert.equal(result.stage, 'LEDGER_OK');
  assert.equal(result.detail.mode, 'controlled_proposal');
  assert.equal(result.detail.inbox_item_count, 0);
  assert.equal(result.detail.writes.notion, 0);
  assert(!JSON.stringify(logs).includes('Authorization'));
}

{
  const {result} = runCase({
    read: () => structuredClone(observed),
    sanitize: () => { const e = new Error('private payload'); e.code='KAZ_SOURCE_FAILED'; throw e; },
    ledger: value => value,
  });
  assert.equal(result.ok, false);
  assert.equal(result.stage, 'SANITIZE_FAILED');
  assert.deepEqual(JSON.parse(JSON.stringify(result.detail)), {error_code:'KAZ_SOURCE_FAILED'});
  assert(!JSON.stringify(result).includes('private payload'));
}

{
  const {result} = runCase({
    read: () => structuredClone(observed),
    sanitize: value => structuredClone(value),
    ledger: () => { throw new Error('sheet internals'); },
  });
  assert.equal(result.ok, false);
  assert.equal(result.stage, 'LEDGER_FAILED');
  assert.deepEqual(JSON.parse(JSON.stringify(result.detail)), {error_code:'UNCLASSIFIED_ERROR'});
  assert(!JSON.stringify(result).includes('sheet internals'));
}

console.log('PASS Kaz OS INBOX production diagnostic boundaries and redaction');

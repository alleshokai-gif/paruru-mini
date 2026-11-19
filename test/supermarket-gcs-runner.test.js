'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const date = '2026-11-20';
const prefix = 'family-supermarket/v1';
const latest = prefix+'/latest.json';
const sqlite = prefix+'/collector-state.sqlite';
const claim = prefix+'/claims/'+date+'.json';

function storeMock() {
  const objs = new Map();
  let clock = 0;
  const attempts = [];
  const reads = [];
  let dropLatest = false;
  return {
    attempts, reads,
    failNextLatest() { dropLatest = true; },
    async describe(key) {
      const o = objs.get(key);
      return o ? {generation:o.generation,size:String(o.bytes.length)} : null;
    },
    async read(key,entry) {
      const o = objs.get(key);
      assert.equal(o.generation,entry.generation);
      reads.push(key);
      return Buffer.from(o.bytes);
    },
    async put(key,bytes,type,expected) {
      attempts.push([key,expected]);
      const o = objs.get(key);
      if ((o?.generation ?? '0') !== expected) return null;
      if (key === latest && dropLatest) { dropLatest = false; throw new Error('GCS_WRITE_403'); }
      const generation = String(++clock);
      objs.set(key,{bytes:Buffer.from(bytes),generation,type});
      return {generation,size:String(bytes.length)};
    }
  };
}

// Project workflow deliberately mounts no writable filesystem. The production
// workspace still serializes private SQLite files. Here one table is enough to
// test the same SQL-based runner transitions and lock/recovery without a bypass.
async function inMemoryWorkspace() {
  const {openDb} = await import('../scripts/supermarket/collector.mjs');
  return {
    async open(bytes) {
      const db = openDb(':memory:');
      if (bytes) for (const row of JSON.parse(Buffer.from(bytes))) {
        db.prepare('INSERT INTO status VALUES (?, ?, ?, ?, ?, ?)').run(...row);
      }
      return db;
    },
    async finish(db) {
      try {
        const rows = db.prepare('SELECT store,day,state,source,evidence_id,error FROM status ORDER BY store').all();
        return Buffer.from(JSON.stringify(rows.map(row=>Object.values(row))));
      } finally { db.close(); }
    },
    async dispose() {}
  };
}

const failingCollector = async (db,date,fetch) => {
  await fetch('https://ok-corporation.jp/robots.txt');
  db.prepare("INSERT INTO status VALUES (?, ?, ?, NULL, NULL, ?)").run('ok',date,'failed','TEST_FAILURE');
  return {schema:1,date,states:{ok:'failed'},sources:[{store:'ok',state:'failed',source:null,error:'TEST_FAILURE'}],offers:[]};
};

test('one exclusive same-day claim, persists SQLite and verifies latest after put', async () => {
  const {runDaily} = await import('../scripts/supermarket/run-daily-gcs.mjs');
  const store = storeMock(); let reads = 0;
  const flags = {workspaceFactory:inMemoryWorkspace,collector:failingCollector,sourceFetch:async () => {reads++;}};
  let r = await runDaily(store,date,flags);
  assert.equal(r.disposition,'published');
  assert.equal(r.status.ok,'failed');
  assert.equal(reads,1);
  assert.deepEqual(store.attempts,[[claim,'0'],[sqlite,'0'],[latest,'0']]);
  assert.deepEqual(store.reads,[latest]);
  r = await runDaily(store,date,flags);
  assert.equal(r.disposition,'already_published');
  assert.equal(r.requests,0);
  assert.equal(reads,1);
  assert.deepEqual(store.attempts.at(-1),[claim,'0']);
});

test('repairs lost latest write from stored DB without contacting source', async () => {
  const {runDaily} = await import('../scripts/supermarket/run-daily-gcs.mjs');
  const store = storeMock(); let reads = 0;
  const flags = {workspaceFactory:inMemoryWorkspace,collector:failingCollector,sourceFetch:async () => {reads++;}};
  store.failNextLatest();
  await assert.rejects(runDaily(store,date,flags),/GCS_WRITE_403/);
  const r = await runDaily(store,date,flags);
  assert.equal(r.disposition,'recovered_publication');
  assert.equal(r.requests,0);
  assert.equal(reads,1);
});

test('rejects bucket missing public-access enforcement without reading objects', async () => {
  const {makeGcs} = await import('../scripts/supermarket/run-daily-gcs.mjs');
  const called = [];
  await assert.rejects(makeGcs('private-test',async url => {
    called.push(url);
    return url.startsWith('http://metadata.') ?
      new Response(JSON.stringify({access_token:'SYNTHETIC_TEST_TOKEN'}),{headers:{'Metadata-Flavor':'Google'}}) :
      new Response(JSON.stringify({iamConfiguration:{publicAccessPrevention:'inherited',uniformBucketLevelAccess:{enabled:true}}}));
  }),/GCS_PRIVATE_BUCKET_UNVERIFIED/);
  assert.equal(called.length,2);
  assert.ok(called[1].endsWith('?fields=iamConfiguration'));
});

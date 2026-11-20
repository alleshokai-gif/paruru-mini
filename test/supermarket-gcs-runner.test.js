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

test('new IY store uses a separate daily claim and never re-fetches OK',async()=>{
  const {runDaily}=await import('../scripts/supermarket/run-daily-gcs.mjs');
  const store=storeMock();let okCalls=0,iyCalls=0;
  const initial=async(db,day)=>{
    okCalls++;
    const set=db.prepare('INSERT INTO status VALUES(?,?,?,?,?,?)');
    set.run('ok',day,'checked','existing',null,null);
    set.run('iy',day,'held','old-held-source',null,'PUBLISHER_NOFOLLOW_MANUAL_ONLY');
    return {schema:1,date:day,states:{ok:'checked',iy:'held'},sources:[
      {store:'ok',state:'checked',source:'existing',error:null},
      {store:'iy',state:'held',source:'old-held-source',error:'PUBLISHER_NOFOLLOW_MANUAL_ONLY'}],offers:[]};
  };
  const iyCollector=async(db,day,fetch)=>{
    await fetch('https://promo.hatobase.jp/flyers/00521/1298/50089');iyCalls++;
    db.prepare("UPDATE status SET state='checked',error=NULL WHERE store='iy'").run();
    const {snapshot}=await import('../scripts/supermarket/collector.mjs');return snapshot(db,day);
  };
  const flags={workspaceFactory:inMemoryWorkspace,collector:initial,iyCollector,sourceFetch:async()=>{}};
  await runDaily(store,date,flags);
  const originalClaim=await store.describe(claim);
  const r=await runDaily(store,date,{...flags,enableIy:true});
  assert.equal(r.disposition,'store_activated');assert.equal(r.requests,1);
  assert.equal(r.status.iy,'checked');assert.equal(okCalls,1);assert.equal(iyCalls,1);
  assert.deepEqual(await store.describe(claim),originalClaim);
  const current=await store.describe(latest);
  const again=await runDaily(store,date,{...flags,enableIy:true});
  assert.equal(again.requests,0);assert.equal(iyCalls,1);assert.equal(okCalls,1);
  assert.deepEqual(await store.describe(latest),current);
});

test('ambiguous IY activation keeps its claim and cannot republish an old snapshot',async()=>{
  const {runDaily}=await import('../scripts/supermarket/run-daily-gcs.mjs');
  const store=storeMock();
  const initial=async(db,day)=>{
    const set=db.prepare('INSERT INTO status VALUES(?,?,?,?,?,?)');
    set.run('ok',day,'checked','existing',null,null);set.run('iy',day,'held','old',null,'old');
    const {snapshot}=await import('../scripts/supermarket/collector.mjs');return snapshot(db,day);
  };
  const flags={workspaceFactory:inMemoryWorkspace,collector:initial};
  await runDaily(store,date,flags);const before=await store.describe(latest);let attempts=0;
  const activate={...flags,enableIy:true,iyCollector:async()=>{attempts++;throw new Error('UNKNOWN_OUTCOME');}};
  await assert.rejects(runDaily(store,date,activate),/UNKNOWN_OUTCOME/);
  const again=await runDaily(store,date,activate);
  assert.equal(again.disposition,'store_already_claimed');assert.equal(again.requests,0);assert.equal(attempts,1);
  assert.deepEqual(await store.describe(latest),before);
});

test('an IY-disabled duplicate cannot overwrite a concurrent activation with its older DB',async()=>{
  const {runDaily}=await import('../scripts/supermarket/run-daily-gcs.mjs');
  const {snapshot}=await import('../scripts/supermarket/collector.mjs');
  const store=storeMock();
  const initial=async(db,day)=>{
    const set=db.prepare('INSERT INTO status VALUES(?,?,?,?,?,?)');
    set.run('ok',day,'checked','existing',null,null);set.run('iy',day,'held','old',null,'old');
    return snapshot(db,day);
  };
  const flags={workspaceFactory:inMemoryWorkspace,collector:initial};
  await runDaily(store,date,flags);
  let loaded,release;
  const hasLoaded=new Promise(resolve=>{loaded=resolve;});
  const gate=new Promise(resolve=>{release=resolve;});
  const pausedWorkspace=async()=>{
    const ws=await inMemoryWorkspace();
    return {...ws,async open(bytes){const db=await ws.open(bytes);loaded();await gate;return db;}};
  };
  const stale=runDaily(store,date,{...flags,workspaceFactory:pausedWorkspace});
  // Observe rejection immediately, avoiding an unhandled rejection while paused.
  const rejected=assert.rejects(stale,/GCS_LATEST_WRITE_CONFLICT/);
  await hasLoaded;
  await runDaily(store,date,{...flags,enableIy:true,iyCollector:async(db,day)=>{
    db.prepare("UPDATE status SET state='checked',error=NULL WHERE store='iy'").run();return snapshot(db,day);
  }});
  const current=await store.describe(latest);
  release();await rejected;
  assert.deepEqual(await store.describe(latest),current);
  assert.equal(JSON.parse(await store.read(latest,current)).states.iy,'checked');
});

test('Yaoko activation claims its own day without re-collecting already checked IY or OK',async()=>{
  const {runDaily}=await import('../scripts/supermarket/run-daily-gcs.mjs');
  const {snapshot}=await import('../scripts/supermarket/collector.mjs');
  const store=storeMock();let calls=0;
  const initial=async(db,day)=>{
    const set=db.prepare('INSERT INTO status VALUES(?,?,?,?,?,?)');
    for(const id of ['ok','iy'])set.run(id,day,'checked','existing',null,null);
    set.run('yaoko',day,'held','old',null,'old');return snapshot(db,day);
  };
  const flags={workspaceFactory:inMemoryWorkspace,collector:initial};await runDaily(store,date,flags);
  const enabled={...flags,enableIy:true,enableYaoko:true,
    iyCollector:async()=>{throw new Error('IY_MUST_NOT_REPLAY');},
    yaokoCollector:async(db,day,fetch)=>{await fetch('https://yap-pd.yaoko-net.com/assets/flyer/1210/image.jpg');
      db.prepare("UPDATE status SET state='checked',error=NULL WHERE store='yaoko'").run();return snapshot(db,day);},
    sourceFetch:async()=>{calls++;}};
  const r=await runDaily(store,date,enabled);assert.equal(r.activatedStore,'yaoko');assert.equal(calls,1);
  assert.ok(store.attempts.some(([key])=>key===prefix+'/claims/'+date+'-yaoko.json'));
  await runDaily(store,date,enabled);assert.equal(calls,1);
});

test('Maruetsu and Life activate under separate claims without re-fetching each other or old stores',async()=>{
  const {runDaily}=await import('../scripts/supermarket/run-daily-gcs.mjs');
  const {snapshot}=await import('../scripts/supermarket/collector.mjs');
  const store=storeMock(),calls=[];
  const initial=async(db,day)=>{
    const set=db.prepare('INSERT INTO status VALUES(?,?,?,?,?,?)');
    for(const id of ['ok','iy','yaoko'])set.run(id,day,'checked','existing',null,null);
    for(const id of ['maruetsu','life'])set.run(id,day,'held','old',null,'old');return snapshot(db,day);
  };
  const flags={workspaceFactory:inMemoryWorkspace,collector:initial};await runDaily(store,date,flags);
  const run=id=>async(db,day,fetch)=>{await fetch('https://tokubai.co.jp/'+id);calls.push(id);
    db.prepare("UPDATE status SET state='checked',error=NULL WHERE store=?").run(id);return snapshot(db,day);};
  const never=async()=>{throw new Error('OLD_STORE_MUST_NOT_REPLAY');};
  const enabled={...flags,enableIy:true,enableYaoko:true,enableMaruetsu:true,enableLife:true,
    iyCollector:never,yaokoCollector:never,maruetsuCollector:run('maruetsu'),lifeCollector:run('life'),sourceFetch:async()=>{}};
  const original=await store.describe(claim);
  assert.equal((await runDaily(store,date,enabled)).activatedStore,'maruetsu');
  assert.deepEqual(calls,['maruetsu']);
  assert.equal((await runDaily(store,date,enabled)).activatedStore,'life');
  assert.deepEqual(calls,['maruetsu','life']);
  const before=await store.describe(latest);
  assert.equal((await runDaily(store,date,enabled)).requests,0);
  assert.deepEqual(await store.describe(latest),before);assert.deepEqual(await store.describe(claim),original);
  for(const id of ['maruetsu','life'])assert.ok(store.attempts.some(([key])=>key===prefix+'/claims/'+date+'-'+id+'.json'));
});

test('Rosen uses its own durable claim before browser I/O; failed Maruetsu is never replayed',async()=>{
 const {runDaily}=await import('../scripts/supermarket/run-daily-gcs.mjs'),{snapshot}=await import('../scripts/supermarket/collector.mjs');
 const store=storeMock();let calls=0;
 const initial=async(db,day)=>{const set=db.prepare('INSERT INTO status VALUES(?,?,?,?,?,?)');
  for(const id of ['ok','iy','yaoko','life'])set.run(id,day,'checked','existing',null,null);
  set.run('maruetsu',day,'failed','existing',null,'old failure');set.run('rosen',day,'held','old',null,'old');return snapshot(db,day);};
 const flags={workspaceFactory:inMemoryWorkspace,collector:initial};await runDaily(store,date,flags);
 const oldClaim=await store.describe(claim),never=async()=>{throw Error('OLD_STORE_REPLAY');};
 const enabled={...flags,enableRosen:true,enableMaruetsu:true,maruetsuCollector:never,rosenCollector:async(db,day,fetch,{onSourceRequest})=>{
  assert.ok(await store.describe(prefix+'/claims/'+date+'-rosen.json'));calls++;onSourceRequest();onSourceRequest();
  db.prepare("UPDATE status SET state='needs_review',error=NULL WHERE store='rosen'").run();return snapshot(db,day);}};
 const r=await runDaily(store,date,enabled);assert.equal(r.requests,2);assert.equal(r.activatedStore,'rosen');assert.equal(r.status.maruetsu,'failed');
 const latestMeta=await store.describe(latest);const again=await runDaily(store,date,enabled);
 assert.equal(again.requests,0);assert.equal(calls,1);assert.deepEqual(await store.describe(claim),oldClaim);assert.deepEqual(await store.describe(latest),latestMeta);
});

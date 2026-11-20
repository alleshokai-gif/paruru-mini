'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite');
const source='https://rosen.mikke-sales.com/stores/taira/flyers/1';
const header={shop:'そうてつローゼン たいら店',period:'2026/11/18 ～ 2026/11/20',days:['11/18(水)','11/19(木)','11/20(金)'],categories:['青果','家庭用品']};
const card={name:'fixture item',maker:'fixture maker',unit:'1個',net:'100',price_label:'本体',gross:'税込108.00円',notices:['fixture condition'],raw_text:'fixture item 本体100円 税込108.00円'};
const views=()=>header.days.flatMap(day_label=>header.categories.map(category=>({day_label,category,cards:[structuredClone(card)],notes:'fixture note',observed_at:'2026-11-20T00:00:00Z'})));

test('one settled cell yields explicit partial coverage, only observed category/day and card-local prices',async()=>{
 const {packetFromViews,isCompleteRosenPacket}=await import('../scripts/supermarket/rosen-dom.mjs');
 const v=views().slice(0,1);v[0].cards=[{...card,gross:'?',raw_text:'first item 本体100円'},{...card,name:'second item',net:'?',raw_text:'second item 税込108円'}];
 const p=packetFromViews(source,header,v,{coverage_state:'complete',model_calls:9});
 assert.equal(p.coverage.state,'partial');assert.equal(p.coverage.expected_views,6);assert.equal(p.coverage.observed_views,1);assert.equal(p.coverage.missing_view_count,5);
 assert.deepEqual(p.coverage.observed_dates,['2026-11-18']);assert.equal(p.pages.length,1);assert.equal(p.pages[0].label,'青果');
 assert.ok(p.pages[0].items.every(i=>i.prices.length===0&&i.price_state==='unreadable'&&i.valid_from===null&&i.valid_until===null));
 assert.ok(p.pages[0].items.every(i=>JSON.stringify(i.observed_dates)==='["2026-11-18"]'));
 assert.equal(p.acquisition.coverage_state,'partial');assert.equal(p.acquisition.model_calls,0);assert.equal(isCompleteRosenPacket(p),false);
 const full=packetFromViews(source,header,views());assert.equal(isCompleteRosenPacket(full),true);
 delete full.coverage;delete full.acquisition.coverage_state;assert.equal(isCompleteRosenPacket(full),true,'legacy full matrix is provable');
 const duplicate=views();duplicate[1]=duplicate[0];assert.throws(()=>packetFromViews(source,header,duplicate),/VIEW_DUPLICATE/);
 assert.throws(()=>packetFromViews(source,header,[{...v[0],day_label:'11/21(土)'}]),/NAV_SCOPE/);
 assert.throws(()=>packetFromViews(source,{...header,categories:['青果','青果']},v),/NAV_FORMAT/);
 assert.throws(()=>packetFromViews(source,header,[]),/VIEW_COVERAGE/);
});

test('later failure persists exactly the settled view once and preserves original failure without retry',async()=>{
 const {readIssueWithPartial}=await import('../scripts/supermarket/rosen-dom.mjs');let calls=0,viewCallbacks=0;const packets=[];
 await assert.rejects(readIssueWithPartial(null,{source,expectedRange:{from:'2026-11-18',until:'2026-11-20'},onPacket:p=>packets.push(p),onView:()=>viewCallbacks++,read:async(page,{onView})=>{
  calls++;await onView({header,view:views()[0]});throw Error('ROSEN_DEADLINE');
 }}),/ROSEN_DEADLINE/);
 assert.equal(calls,1);assert.equal(viewCallbacks,1);assert.equal(packets.length,1);assert.equal(packets[0].coverage.state,'partial');assert.equal(packets[0].acquisition.partial_reason,'ROSEN_DEADLINE');
 const none=[];await assert.rejects(readIssueWithPartial(null,{source,onPacket:p=>none.push(p),read:async()=>{throw Error('ROSEN_HTTP_403');}}),/ROSEN_HTTP_403/);assert.equal(none.length,0);
});

test('partial failure is visible with failed acquisition state, no offers and no same-day repeat',async()=>{
 const {readIssueWithPartial}=await import('../scripts/supermarket/rosen-dom.mjs'),{openDb,collectRosen}=await import('../scripts/supermarket/collector.mjs');
 const db=openDb(':memory:');let calls=0;
 try{
  db.exec('CREATE TABLE collector_source_policy (store TEXT PRIMARY KEY,observed_at TEXT,status INTEGER,body TEXT)');
  db.prepare('INSERT INTO collector_source_policy VALUES(?,?,?,?)').run('rosen',new Date().toISOString(),403,'');
  const read=async(date,{onPacket,onView})=>readIssueWithPartial(null,{source,onPacket,onView:part=>onView({issue_id:'rosen-taira-1',source,...part}),read:async(page,{onView:emit})=>{calls++;await emit({header,view:views()[0]});throw Error('ROSEN_DEADLINE');}});
  const out=await collectRosen(db,'2026-11-20',async()=>{throw Error('NO_HTTP');},{read});
  assert.equal(out.states.rosen,'failed');assert.deepEqual(out.offers,[]);assert.equal(out.corpus.catalogs[0].coverage.state,'partial');assert.equal(out.corpus.catalogs[0].coverage.observed_views,1);
  assert.equal(db.prepare('SELECT count(*) n FROM rosen_dom_views').get().n,1);assert.equal(db.prepare('SELECT count(*) n FROM flyer_corpus_listings').get().n,1);
  await collectRosen(db,'2026-11-20',async()=>{throw Error('NO_HTTP');},{read});assert.equal(calls,1);
 }finally{db.close();}
});

test('newer partial observations do not displace the complete acquisition cache',async()=>{
 const {packetFromViews,isCompleteRosenPacket}=await import('../scripts/supermarket/rosen-dom.mjs'),{openDb,collectRosen}=await import('../scripts/supermarket/collector.mjs'),{ingestCorpus,corpusCatalog}=await import('../scripts/supermarket/whole-corpus-store.mjs');
 const db=openDb(':memory:');
 try{
  const complete=packetFromViews(source,header,views());complete.obtained_at='2026-11-19T00:00:00Z';ingestCorpus(db,complete);
  const partial=packetFromViews(source,header,views().slice(0,1));partial.obtained_at='2026-11-20T00:00:00Z';ingestCorpus(db,partial);
  db.exec('CREATE TABLE collector_source_policy (store TEXT PRIMARY KEY,observed_at TEXT,status INTEGER,body TEXT)');db.prepare('INSERT INTO collector_source_policy VALUES(?,?,?,?)').run('rosen',new Date().toISOString(),403,'');
  await collectRosen(db,'2026-11-20',async()=>{throw Error('NO_HTTP');},{read:async(date,{knownIssues})=>{
   assert.equal(knownIssues.size,1);assert.equal(knownIssues.get('rosen-taira-1').source_revision,complete.source_revision);assert.equal(isCompleteRosenPacket(knownIssues.get('rosen-taira-1')),true);return {issues:[{issue_id:'rosen-taira-1',disposition:'unchanged'}]};
  }});
  assert.equal(db.prepare('SELECT count(*) n FROM flyer_corpus_runs').get().n,2,'both immutable observations survive');
  assert.equal(corpusCatalog(db).catalogs[0].source_revision,complete.source_revision,'existing complete catalog is not reduced by a later partial observation');
  const next=packetFromViews(source.replace('/1','/2'),header,views().slice(0,1));ingestCorpus(db,next);
  assert.equal(corpusCatalog(db).catalogs.find(c=>c.issue_id==='rosen-taira-2').coverage.state,'partial','a new issue with only partial data is immediately a reference candidate');
 }finally{db.close();}
});

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite');
const header={shop:'そうてつローゼン たいら店',period:'2026/11/18 ～ 2026/11/20',days:['11/18(水)','11/19(木)','11/20(金)'],categories:['青果','家庭用品']};
const card={name:'fixture item',maker:'fixture maker',unit:'1個',net:'100',price_label:'本体',gross:'税込108.00円',notices:['fixture condition'],raw_text:'fixture item 本体100円 税込108.00円'};
const views=()=>header.days.flatMap(day_label=>header.categories.map(category=>({day_label,category,cards:[structuredClone(card)],notes:'fixture paper note',observed_at:'2026-11-20T00:00:00Z'})));
const source='https://rosen.mikke-sales.com/stores/taira/flyers/1';
test('every day/category is required; all fields and repeated placements survive exact-text dedup',async()=>{
 const {packetFromViews}=await import('../scripts/supermarket/rosen-dom.mjs'),{ingestCorpus,readCorpus,corpusCatalog}=await import('../scripts/supermarket/whole-corpus-store.mjs');
 const v=views();v.at(-1).cards.push({...card,name:'nonfood fixture',net:'?',gross:'税込不明円'});
 const p=packetFromViews(source,header,v),db=new DatabaseSync(':memory:');
 try{
  assert.equal(p.logical_views,6);assert.equal(p.acquisition.raw_card_observations,7);assert.equal(p.acquisition.exact_dom_text_deduplicated_frames,2);
  const items=p.pages.flatMap(p=>p.items);assert.equal(items[0].dom_regions.length,6);assert.deepEqual(items[0].observed_dates,['2026-11-18','2026-11-19','2026-11-20']);
  assert.equal(items[0].prices[0].tax_included_yen,108);assert.equal(items[0].valid_until,null);
  assert.equal(items[1].product_type,'nonfood');assert.equal(items[1].price_state,'unreadable');assert.equal(items[1].prices.length,0);
  const r=ingestCorpus(db,p);assert.deepEqual(readCorpus(db,r.corpus_id).packet,p);
  const out=corpusCatalog(db);assert.equal(out.schema,2);assert.equal(out.catalogs[0].pages[0].items[0].geometry_verification,'dom_region_unverified');
  assert.ok(!JSON.stringify(out).includes('raw_dom_fields'));assert.ok(out.catalogs[0].pages.flatMap(p=>p.items).every(i=>i.verification_state==='needs_review'));
  assert.throws(()=>packetFromViews(source,header,v.slice(1)),/VIEW_COVERAGE/);
  const duplicate=views();duplicate[1]=duplicate[0];assert.throws(()=>packetFromViews(source,header,duplicate),/VIEW_DUPLICATE/);
  assert.throws(()=>packetFromViews(source.replace('/taira/','/other/'),header,views()),/STORE_SCOPE/);
 }finally{db.close();}
});
test('issue and analysis selection preserve both active issues, old evidence and source freshness',async()=>{
 const {packetFromViews}=await import('../scripts/supermarket/rosen-dom.mjs'),{ingestCorpus,corpusCatalog}=await import('../scripts/supermarket/whole-corpus-store.mjs'),db=new DatabaseSync(':memory:');
 try{
  const p=packetFromViews(source,header,views());p.obtained_at='2026-11-20T00:00:00Z';p.analyzed_at=p.obtained_at;p.analysis_revision='f'.repeat(64);ingestCorpus(db,p);
  const newer=structuredClone(p);newer.analysis_revision='0'.repeat(64);newer.analyzed_at='2026-11-20T01:00:00Z';newer.pages[0].items[0].conditions.push('new analysis');ingestCorpus(db,newer);
  const second=structuredClone(p);second.issue_id='rosen-taira-2';second.source_document=source.replace('/1','/2');second.document_until='2026-11-30';ingestCorpus(db,second);
  const current=corpusCatalog(db,{date:'2026-11-20'});assert.equal(current.catalogs.length,2);assert.equal(current.catalogs[0].analysis_revision,'0'.repeat(64));assert.equal(current.catalogs[0].obtained_at,p.obtained_at);
  assert.equal(corpusCatalog(db,{date:'2026-11-21'}).catalogs.length,1);assert.equal(db.prepare('SELECT count(*) n FROM flyer_corpus_runs').get().n,3);
 }finally{db.close();}
});
test('robots observations expire closed without retry, including known HTTP denials',async()=>{
 const {rosenPolicy,repAllows}=await import('../scripts/supermarket/rosen-policy.mjs'),db=new DatabaseSync(':memory:');let calls=0;
 const fetcher=async()=>{calls++;throw Error('NETWORK_MUST_NOT_RUN');},now=Date.parse('2026-11-20T08:00:00Z');
 try{
  await assert.rejects(rosenPolicy(db,{fetcher,now}),/OBSERVATION_REQUIRED/);assert.equal(calls,0);
  db.prepare('INSERT INTO collector_source_policy VALUES(?,?,?,?)').run('rosen','2026-11-20T00:00:00Z',403,'');
  const p=await rosenPolicy(db,{fetcher,now});assert.equal(p.status,403);assert.equal(p.allows('/stores/taira'),true);
  await assert.rejects(rosenPolicy(db,{fetcher,now:now+86400000,refresh:true}),/OBSERVATION_REQUIRED/);assert.equal(calls,0);
  const rules='User-agent: *\nDisallow: /stores/\nAllow: /stores/taira/\nDisallow: /*?*\nAllow: /robots.txt$';
  assert.equal(repAllows(rules,'/stores/other/'),false);assert.equal(repAllows(rules,'/stores/taira/flyers/1'),true);
  assert.equal(repAllows(rules,'/other?x=1'),false);assert.equal(repAllows(rules,'/robots.txt'),true);
 }finally{db.close();}
});
test('partial DOM observations survive a later failure without becoming a complete cache or offer',async()=>{
 const {openDb,collectRosen}=await import('../scripts/supermarket/collector.mjs'),db=openDb(':memory:');let called=0;
 try{
  db.exec('CREATE TABLE collector_source_policy (store TEXT PRIMARY KEY,observed_at TEXT,status INTEGER,body TEXT)');
  db.prepare('INSERT INTO collector_source_policy VALUES(?,?,?,?)').run('rosen',new Date().toISOString(),403,'');
  const read=async(day,{onView})=>{called++;onView({issue_id:'rosen-taira-1',source,header,view:views()[0]});throw Error('ROSEN_DEADLINE');};
  const result=await collectRosen(db,'2026-11-20',async()=>{throw Error('NO_FETCH');},{read});
  assert.equal(result.states.rosen,'failed');assert.equal(db.prepare('SELECT count(*) n FROM rosen_dom_views').get().n,1);
  assert.equal(result.corpus,undefined);assert.deepEqual(result.offers,[]);
  await collectRosen(db,'2026-11-20',async()=>{throw Error('NO_FETCH');},{read});assert.equal(called,1);
 }finally{db.close();}
});

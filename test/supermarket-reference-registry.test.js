const test=require('node:test'),assert=require('node:assert/strict');
async function fixture(){
 const collector=await import('../scripts/supermarket/collector.mjs'),registry=await import('../scripts/supermarket/reference-registry.mjs'),db=collector.openDb(':memory:');
 db.exec(`CREATE TABLE protected_existing(value TEXT);INSERT INTO protected_existing VALUES('synthetic old data');
 CREATE TABLE flyer_discovery_runs(store TEXT,day TEXT,phase TEXT,error TEXT,requests INTEGER,edition_id TEXT,PRIMARY KEY(store,day));
 CREATE TABLE flyer_discovered_editions(edition_id TEXT,store TEXT,source TEXT,from_day TEXT,until_day TEXT,label TEXT,metadata_hash TEXT,observed_at TEXT);
 CREATE TABLE flyer_discovered_pages(edition_id TEXT,ordinal INTEGER,source TEXT,kind TEXT,state TEXT,sha256 TEXT,body BLOB,error TEXT);`);
 const e={edition_id:'edition',store:'iy',source:'https://promo.hatobase.jp/flyers/00521/9999/12345',from_day:'2026-11-25',until_day:'2026-11-27',label:'Synthetic edition',metadata_hash:'c'.repeat(64),observed_at:'2026-11-25T01:00:00Z'};
 db.prepare('INSERT INTO flyer_discovered_editions VALUES(?,?,?,?,?,?,?,?)').run(...Object.values(e));
 const pages=[1,2].map(ordinal=>({ordinal,source:'https://content.hatobase.jp/flyer_details/1/p'+ordinal+'.jpg',kind:'image',state:'saved',sha256:String(ordinal).repeat(64)}));
 for(const p of pages)db.prepare('INSERT INTO flyer_discovered_pages VALUES(?,?,?,?,?,?,?,?)').run(e.edition_id,p.ordinal,p.source,p.kind,p.state,p.sha256,Buffer.from('synthetic'),null);
 for(const date of ['2026-11-26','2026-11-27'])db.prepare('INSERT INTO flyer_discovery_runs VALUES(?,?,?,?,?,?)').run('iy',date,'detected',null,0,e.edition_id);
 const discovery={edition:e,pages},binding=registry.referenceBinding(discovery);
 const packet={schema:'supermarket-whole-corpus-v2',source_kind:'image',store:'iy',issue_id:binding.issue_id,source_document:e.source,source_revision:binding.source_revision,analysis_revision:'a'.repeat(64),obtained_at:e.observed_at,document_from:e.from_day,document_until:e.until_day,physical_pdf_pages:null,logical_faces:2,
 pages:['front','back'].map(face=>({face,examined_tiles:[face],items:[{name:'架空掲載商品',spec:null,variants:[],product_type:'unknown',price_state:'unreadable',prices:[],valid_from:null,valid_until:null,bbox:[1,1,500,500],verification_state:'needs_review',verified_price:false,recommendation_eligible:false}]}))};
 return {db,collector,registry,discovery,packet};
}
test('registration is create-only, acquisition clock is not identity, defaults never apply a reference',async()=>{
 const {db,registry:r,discovery:d,packet:p}=await fixture();try{
  assert.equal(r.applyRegisteredReference(db,null,'not a date').state,'disabled');
  const a=r.registerReferenceArtifact(db,p),b=r.registerReferenceArtifact(db,p);assert.equal(a.registered,1);assert.equal(b.registered,0);
  const changedClock=structuredClone(d);changedClock.edition.observed_at='2026-11-26T01:00:00Z';assert.equal(r.referenceBinding(changedClock).key,r.referenceBinding(d).key);
  assert.equal(r.applyRegisteredReference(db,d,'2026-11-26').state,'disabled');
  assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='flyer_corpus_listings'").get().n,0);
  const changed=structuredClone(p);changed.pages[0].items[0].name='different synthetic row';assert.throws(()=>r.registerReferenceArtifact(db,changed),/IMMUTABLE_CONFLICT/);
  assert.equal(db.prepare('SELECT value FROM protected_existing').get().value,'synthetic old data');
 }finally{db.close();}
});
test('real collectIy entry is OFF by default and opt-in reuses only registered source without worker or fetch',async()=>{
 for(const enabled of [false,true]){
  const {db,collector:c,registry:r,packet:p}=await fixture();try{
   r.registerReferenceArtifact(db,p);let fetches=0;
   const out=await c.collectIy(db,'2026-11-26',()=>{fetches++;throw Error('NO_FETCH');},enabled?{referenceArtifactsEnabled:true}:{});
   assert.equal(fetches,0);assert.deepEqual(out.offers,[]);
   if(enabled){
    assert.equal(out.corpus.pages.flatMap(p=>p.items).length,2);assert.equal(out.corpus.obtained_at,p.obtained_at);
    assert(out.corpus.pages.every(p=>p.items.every(i=>i.valid_from===null&&i.valid_until===null&&i.verification_state==='needs_review')));
    await c.collectIy(db,'2026-11-27',()=>{throw Error('NO_FETCH');},{referenceArtifactsEnabled:true});
    assert.equal(db.prepare('SELECT count(*) n FROM flyer_corpus_listings').get().n,2);assert.equal(db.prepare('SELECT count(*) n FROM flyer_reference_receipts').get().n,1);
   }else{assert.equal(out.corpus,undefined);assert.equal(db.prepare("SELECT error FROM status WHERE store='iy'").get().error,'DISCOVERY_ANALYSIS_NOT_CONNECTED');}
   assert.equal(db.prepare('SELECT value FROM protected_existing').get().value,'synthetic old data');
  }finally{db.close();}
 }
});
test('new issue/changed face is unregistered, expired/future denied and wrong store cannot borrow a reference',async()=>{
 const {db,registry:r,discovery:d,packet:p}=await fixture();try{
  r.registerReferenceArtifact(db,p);
  for(const date of ['2026-11-24','2026-11-28'])assert.equal(r.applyRegisteredReference(db,d,date,{enabled:true}).state,'outside_edition');
  const changed=structuredClone(d);changed.pages[1].sha256='f'.repeat(64);assert.equal(r.applyRegisteredReference(db,changed,'2026-11-26',{enabled:true}).state,'not_registered');
  changed.edition.source='https://promo.hatobase.jp/flyers/00521/9999/12346';assert.equal(r.applyRegisteredReference(db,changed,'2026-11-26',{enabled:true}).state,'not_registered');
  const wrong=structuredClone(d);wrong.edition.source='https://promo.hatobase.jp/flyers/00522/9999/12345';assert.throws(()=>r.applyRegisteredReference(db,wrong,'2026-11-26',{enabled:true}),/REFERENCE_SOURCE/);
  assert.equal(db.prepare('SELECT count(*) n FROM flyer_reference_receipts').get().n,0);
 }finally{db.close();}
});
test('registry and canonical row drift are refused rather than silently repaired',async()=>{
 for(const target of ['registry','canonical']){
  const {db,registry:r,discovery:d,packet:p}=await fixture();try{
   r.registerReferenceArtifact(db,p);
   if(target==='registry')db.exec("UPDATE flyer_reference_registry SET packet_json='{}'");
   else{r.applyRegisteredReference(db,d,'2026-11-26',{enabled:true});db.exec("UPDATE flyer_corpus_listings SET observation_json='{}'");}
   assert.throws(()=>r.applyRegisteredReference(db,d,'2026-11-26',{enabled:true}),target==='registry'?/REGISTRY_DRIFT/:/READBACK/);
  }finally{db.close();}
 }
});

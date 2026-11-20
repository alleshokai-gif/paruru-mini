'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite');
const modulePromise=import('../scripts/supermarket/whole-corpus-store.mjs');
const price=(role,net,tax)=>({role,net_yen:net,tax_included_yen:tax,discount_percent:null,raw_text:'synthetic fixture',unit_text:'1個',bbox:[10,10,30,30]});
const item=(name,type,prices,state='priced')=>({name,spec:null,variants:['variant A','variant B'],product_type:type,price_state:state,prices,bbox:[0,0,100,100],valid_from:null,valid_until:null});
function packet(){return {schema:'supermarket-whole-corpus-v1',issue_id:'fixture-issue',store:'ok',source_revision:'1'.repeat(64),analysis_revision:'2'.repeat(64),obtained_at:'2026-11-20T00:00:00Z',source_document:'https://ok-corporation.jp/media-download/1/abcdef/PDF/',physical_pdf_pages:1,logical_faces:2,pages:[
 {face:'front',examined_tiles:['tile-00'],items:[item('価格非掲載の品','food',[],'not_printed')]},
 {face:'back',examined_tiles:['tile-00'],items:[item('食品以外の品','nonfood',[price('general',100,110),price('reference_basis',150,null)]),item('表示の説明例','other',[price('example',999,1098.9)],'example_only')]}
 ]};}
test('whole corpus retains nonfood, unpriced, reference and example rows without authorizing model prices',async()=>{
 const {ingestCorpus,readCorpus,corpusCatalog}=await modulePromise,db=new DatabaseSync(':memory:');
 try{
  const input=packet(),receipt=ingestCorpus(db,input),stored=readCorpus(db,receipt.corpus_id);
  assert.equal(receipt.inserted,3);assert.deepEqual(stored.packet,input);
  assert.equal(stored.listings.length,3);assert.ok(stored.listings.every(row=>row.verification_state==='needs_review'));
  assert.equal(stored.listings.find(row=>row.observation.product_type==='nonfood').observation.prices.length,2);
  assert.equal(stored.listings.find(row=>row.observation.price_state==='not_printed').observation.prices.length,0);
  assert.equal(ingestCorpus(db,input).disposition,'unchanged');
  const changed=structuredClone(input);changed.pages[0].items[0].name='changed without new analysis revision';
  assert.throws(()=>ingestCorpus(db,changed),/CORPUS_IMMUTABLE_COLLISION/);
  assert.deepEqual(readCorpus(db,receipt.corpus_id).packet,input);
  const catalog=corpusCatalog(db);assert.equal(catalog.pages.flatMap(p=>p.items).length,3);
  assert.equal(catalog.verification_state,'needs_review');assert.equal(catalog.executions,undefined);
 }finally{db.close();}
});
test('untrusted model additions stay private and cannot assert a verified catalog price',async()=>{
 const {ingestCorpus,corpusCatalog}=await modulePromise,db=new DatabaseSync(':memory:');
 try{
  const input=packet(),raw=input.pages[1].items[0];raw.verification_state='verified';raw.executions={private:'DO_NOT_PROJECT'};
  raw.prices[0].api_key='DO_NOT_PROJECT';input.executions={private:'DO_NOT_PROJECT'};
  ingestCorpus(db,input);const out=corpusCatalog(db),body=JSON.stringify(out);
  assert.equal(out.pages[1].items[0].verification_state,'needs_review');assert.ok(!body.includes('DO_NOT_PROJECT'));
  assert.equal(out.pages[1].items[0].store_condition_link_verification,'unverified');
 }finally{db.close();}
});
test('invalid dates and prices cannot enter the typed observation tables',async()=>{
 const {ingestCorpus}=await modulePromise,db=new DatabaseSync(':memory:');
 try{
  let bad=packet();bad.pages[0].items[0].valid_from='2026-99-99';assert.throws(()=>ingestCorpus(db,bad),/CORPUS_FROM_DAY/);
  bad=packet();bad.pages[1].items[0].prices[0].net_yen=-1;assert.throws(()=>ingestCorpus(db,bad),/CORPUS_NUMBER/);
  bad=packet();bad.pages[1].items[0].prices[0].tax_included_yen=Infinity;assert.throws(()=>ingestCorpus(db,bad),/CORPUS_NUMBER/);
 }finally{db.close();}
});
test('catalog freshness compares instants across timezone offsets',async()=>{
 const {ingestCorpus,corpusCatalog}=await modulePromise,db=new DatabaseSync(':memory:');
 try{
  const old=packet();old.obtained_at='2026-11-20T09:00:00+09:00';ingestCorpus(db,old);
  const newer=packet();newer.analysis_revision='3'.repeat(64);newer.obtained_at='2026-11-20T01:00:00+00:00';ingestCorpus(db,newer);
  assert.equal(corpusCatalog(db).analysis_revision,newer.analysis_revision);
 }finally{db.close();}
});
test('large optional corpus remains complete privately without breaking the existing snapshot read cap',async()=>{
 const {ingestCorpus,readCorpus}=await modulePromise,{openDb,snapshot}=await import('../scripts/supermarket/collector.mjs'),db=openDb(':memory:');
 try{
  const input=packet(),seed=input.pages[1].items[0];seed.spec='x'.repeat(2000);seed.prices[0].raw_text='y'.repeat(3000);
  input.pages[1].items=Array.from({length:100},()=>structuredClone(seed));
  const saved=ingestCorpus(db,input),out=snapshot(db,'2026-11-20');
  assert.equal(out.corpus,undefined);assert.equal(out.corpus_status,'too_large');assert.deepEqual(out.offers,[]);
  assert.equal(readCorpus(db,saved.corpus_id).listings.length,101);assert.ok(Buffer.byteLength(JSON.stringify(out))<480*1024);
 }finally{db.close();}
});

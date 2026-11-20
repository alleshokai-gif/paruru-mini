'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const source='https://tokubai.co.jp/%E3%83%9E%E3%83%AB%E3%82%A8%E3%83%84/3541/leaflets/108663201/print';
function packet(){return {schema:'supermarket-whole-corpus-v2',source_kind:'image',store:'maruetsu',issue_id:'maruetsu-3541-20261117',source_document:source,source_revision:'a'.repeat(64),analysis_revision:'b'.repeat(64),obtained_at:'2026-11-19T15:00:00Z',physical_pdf_pages:null,logical_faces:1,document_from:null,document_until:null,pages:[{face:'front',examined_tiles:['saved-tile'],items:Array.from({length:83},(_,i)=>({name:'saved reference '+i,spec:null,variants:[],product_type:'unknown',price_state:'unreadable',prices:[],valid_from:null,valid_until:null,validity_raw_text:'原本の期限対応未確認',conditions:[],bbox:null,verification_state:'verified'}))}]};}
test('saved 3541 issue is reference-only and leaves failed acquisition state untouched',async()=>{
 const {openDb,snapshot}=await import('../scripts/supermarket/collector.mjs'),{ingestCorpus,readCorpus}=await import('../scripts/supermarket/whole-corpus-store.mjs'),{TOKUBAI_EDITIONS}=await import('../scripts/supermarket/tokubai-ocr.mjs');
 assert.equal(source,TOKUBAI_EDITIONS.maruetsu.source);
 const db=openDb(':memory:');try{
  db.prepare('INSERT INTO status VALUES(?,?,?,?,?,?)').run('maruetsu','2026-11-20','failed',source,null,'HTTP_403');
  const before=db.prepare('SELECT * FROM status').all(),p=packet(),r=ingestCorpus(db,p),out=snapshot(db,'2026-11-20');
  assert.equal(r.inserted,83);assert.deepEqual(readCorpus(db,r.corpus_id).packet,p);assert.deepEqual(db.prepare('SELECT * FROM status').all(),before);
  assert.equal(out.states.maruetsu,'failed');assert.deepEqual(out.offers,[]);assert.equal(out.corpus.store,'maruetsu');assert.deepEqual(out.corpus.display_counts,{total:83,shown:83,omitted:0});assert.equal(out.corpus.document_from,null);assert.equal(out.corpus.document_until,null);
  assert.ok(out.corpus.pages[0].items.every(i=>i.verification_state==='needs_review'&&i.bbox===null&&i.prices.length===0&&i.valid_from===null&&i.valid_until===null));
 }finally{db.close();}
});
test('Maruetsu admission rejects other store, leaflet, issue, query, fragment and source kind',async()=>{
 const {openDb}=await import('../scripts/supermarket/collector.mjs'),{ingestCorpus}=await import('../scripts/supermarket/whole-corpus-store.mjs');
 const edits=[p=>p.source_document=source.replace('/3541/','/3542/'),p=>p.source_document=source.replace('108663201','108663202'),p=>p.source_document=source+'?next=other',p=>p.source_document=source+'#other',p=>p.source_document=source.replace('/print',''),p=>p.issue_id='maruetsu-3541-20261118',p=>p.store='life',p=>p.source_kind='dom'];
 for(const edit of edits){const db=openDb(':memory:');try{const p=packet();edit(p);assert.throws(()=>ingestCorpus(db,p),/CORPUS_/);}finally{db.close();}}
});

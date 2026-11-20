'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite');
const sources={iy:['iy-00521-50089','https://promo.hatobase.jp/flyers/00521/1298/50089'],yaoko:['yaoko-1221-20261118','https://yap-pd.yaoko-net.com/app/flyer/1221/'],life:['life-224224-20261121','https://store.lifecorp.jp/detail/east648/']};
function packet(store,faces=1){
 const [issue_id,source_document]=sources[store];
 const item={name:'fixture '+store,spec:null,variants:[],product_type:'nonfood',price_state:'priced',prices:[{role:'general',net_yen:100,tax_included_yen:110,discount_percent:null,raw_text:'same card 100 / 110',unit_text:null,bbox:null}],bbox:null,valid_from:'2026-11-18',valid_until:'2026-11-20',verification_state:'verified'};
 return {schema:'supermarket-whole-corpus-v2',source_kind:'image',store,issue_id,source_document,source_revision:'1'.repeat(64),analysis_revision:'2'.repeat(64),obtained_at:'2026-11-19T15:00:00Z',obtained_at_precision:'JST day lower-bound proxy only',completeness_scope:'One or two observed images; complete issue extent unknown',physical_pdf_pages:null,logical_faces:faces,document_from:'2026-11-18',document_until:'2026-11-22',pages:['front','back'].slice(0,faces).map(face=>({face,examined_tiles:['tile-00'],global_conditions:[{text:'unverified condition',scope:'source',bbox:null}],unresolved_regions:[{bbox:null,reason:'exact geometry unknown'}],items:[structuredClone(item)]}))};
}
test('bounded image sources accept one or two observed faces and unknown geometry without confirming a quote',async()=>{
 const {ingestCorpus,readCorpus,corpusCatalog}=await import('../scripts/supermarket/whole-corpus-store.mjs');
 for(const store of Object.keys(sources))for(const faces of [1,2]){
  const db=new DatabaseSync(':memory:');try{
   const p=packet(store,faces),r=ingestCorpus(db,p);assert.equal(r.inserted,faces);assert.deepEqual(readCorpus(db,r.corpus_id).packet,p);
   const c=corpusCatalog(db);assert.equal(c.store,store);assert.equal(c.logical_faces,faces);assert.equal(c.obtained_at,p.obtained_at);assert.equal(c.obtained_at_precision,undefined);assert.equal(c.completeness_scope,undefined);
   assert.deepEqual(c.display_counts,{total:faces,shown:faces,omitted:0});
   assert.ok(c.pages.every(pg=>pg.items.every(i=>i.bbox===null&&i.prices[0].bbox===null&&i.verification_state==='needs_review')));
  }finally{db.close();}
 }
});
test('image store, issue, URL and observed-face boundaries reject widening and impersonation',async()=>{
 const {ingestCorpus}=await import('../scripts/supermarket/whole-corpus-store.mjs');
 const bad=[];
 let p=packet('iy');p.source_document='https://promo.hatobase.jp/flyers/00522/1298/50089';bad.push(p);
 p=packet('iy');p.issue_id='iy-00521-50090';bad.push(p);
 p=packet('iy');p.source_document+='?preview=1';bad.push(p);
 p=packet('yaoko');p.source_document=p.source_document.replace('1221','1222');bad.push(p);
 p=packet('life');p.source_document=p.source_document.replace('lifecorp.jp','lifecorp.co.jp');bad.push(p);
 p=packet('life');p.source_document=p.source_document.replace('east648','east649');bad.push(p);
 p=packet('life');p.issue_id='life-999999-20261121';bad.push(p);
 p=packet('life');p.pages[0].face='observed-1';bad.push(p);
 p=packet('life');p.logical_faces=2;bad.push(p);
 p=packet('life');p.physical_pdf_pages=1;bad.push(p);
 p=packet('life');p.document_until='2026-11-31';bad.push(p);
 p=packet('life');p.obtained_at_precision={private:'not a source label'};bad.push(p);
 p=packet('life');p.source_document='https://store.lifecorp.jp/detail/east648/#extra';bad.push(p);
 for(const input of bad){const db=new DatabaseSync(':memory:');try{assert.throws(()=>ingestCorpus(db,input),/CORPUS_/);}finally{db.close();}}
});
test('capacity distribution preserves existing OK and monthly Rosen rows and exposes every other issue with separate counts',async()=>{
 const {openDb,snapshot}=await import('../scripts/supermarket/collector.mjs'),{ingestCorpus}=await import('../scripts/supermarket/whole-corpus-store.mjs'),{packetFromViews}=await import('../scripts/supermarket/rosen-dom.mjs');
 const db=openDb(':memory:');try{
  const ok=packet('iy');Object.assign(ok,{schema:'supermarket-whole-corpus-v1',store:'ok',issue_id:'ok-fixture',source_document:'https://ok-corporation.jp/media-download/1/abcdef/PDF/',physical_pdf_pages:1,logical_faces:2});ok.pages.push(structuredClone(ok.pages[0]));ok.pages[1].face='back';
  ok.pages.forEach(pg=>{pg.global_conditions=[];pg.unresolved_regions=[];pg.items=Array.from({length:29},()=>{const i=structuredClone(ok.pages[0].items[0]);i.bbox=[0,0,10,10];i.prices[0].bbox=[0,0,10,10];return i;});});ingestCorpus(db,ok);
  const h={shop:'そうてつローゼン たいら店',period:'2026/11/18 ～ 2026/11/22',days:['11/20(金)'],categories:['家庭用品']};
  const cards=Array.from({length:105},(_,i)=>({name:'monthly '+i,maker:'fixture',unit:'1個',net:'100',price_label:'本体',gross:'税込110円',notices:[],raw_text:'monthly '+i+' 本体100円 税込110円'}));
  ingestCorpus(db,packetFromViews('https://rosen.mikke-sales.com/stores/taira/flyers/5170',h,[{day_label:h.days[0],category:h.categories[0],cards,notes:''}]));
  for(const store of Object.keys(sources)){
   const p=packet(store,store==='life'?2:1);p.pages.forEach(pg=>{pg.items=Array.from({length:100/p.pages.length},(_,i)=>{const row=structuredClone(pg.items[0]);row.name=store+' '+pg.face+' '+i;row.spec='x'.repeat(2000);row.prices[0].raw_text='y'.repeat(3000);return row;});});ingestCorpus(db,p);
  }
  const out=snapshot(db,'2026-11-20');assert.equal(out.corpus_status,'partial');assert.ok(Buffer.byteLength(JSON.stringify(out))<=460*1024);
  const cs=out.corpus.catalogs;assert.equal(cs.length,5);assert.equal(cs.find(c=>c.store==='ok').display_counts.shown,58);assert.equal(cs.find(c=>c.issue_id==='rosen-taira-5170').display_counts.shown,105);
  for(const store of Object.keys(sources)){const c=cs.find(c=>c.store===store);assert.ok(c.display_counts.shown>=1);assert.equal(c.display_counts.total,100);assert.equal(c.display_counts.shown+c.display_counts.omitted,100);assert.ok(c.pages[0].items.every(i=>i.name.startsWith(store+' ')&&i.prices[0].raw_text==='y'.repeat(3000)));}
  const life=cs.find(c=>c.store==='life');assert.ok(life.pages.every(p=>p.items.length>=1));assert.ok(Math.abs(life.pages[0].items.length-life.pages[1].items.length)<=1,'capacity alternates logical pages instead of hiding the back face');for(const p of life.pages)assert.deepEqual(p.items.map(i=>i.name),Array.from({length:p.items.length},(_,i)=>'life '+p.face+' '+i),'natural per-page ordinal retained');
  const counts=Object.keys(sources).map(s=>cs.find(c=>c.store===s).display_counts.shown);assert.ok(Math.max(...counts)-Math.min(...counts)<=1);
  assert.equal(db.prepare('SELECT count(*) n FROM flyer_corpus_listings').get().n,463,'full database retained');assert.equal(out.corpus_omitted_count,0);
 }finally{db.close();}
});

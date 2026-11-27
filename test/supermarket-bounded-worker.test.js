const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{createHash}=require('node:crypto'),{DatabaseSync}=require('node:sqlite');
const sha=b=>createHash('sha256').update(b).digest('hex');
const word=(text,pass='read-a',x=10,y=20)=>({text,pass,line:'1:1:1:1',x,y,w:400,h:40,confidence:95});
test('commercial name/spec needs distinct spatially matching reads; neighbours, promotions and numeric drift do not grant product/price',async()=>{
 const {productRows}=await import('../scripts/supermarket/ocr-product-rows.mjs');
 const page={width:1000,height:1000,words:[word('合成飲料(500ml)1本税抜100円税込108円'),word('合成飲料(500ml)1本税抜100円税込108円','read-b')]};
 let r=productRows(page);assert.equal(r.items.length,1);assert.equal(r.items[0].prices[0].tax_included_yen,108);assert.equal(r.items[0].verified_price,false);assert.equal(r.items[0].valid_until,null);
 assert.equal(productRows({...page,words:[page.words[0],{...page.words[0]}]}).items.length,0);
 assert.equal(productRows({...page,words:[page.words[0],word('合成飲料(550ml)1本税抜100円税込108円','read-b')]}).items.length,0);
 assert.equal(productRows({...page,words:page.words.map(w=>({...w,text:'ポイントプレゼント(500ml)'}))}).items.length,0);
 r=productRows({...page,words:page.words.map(w=>({...w,text:'合成飲料(500ml)'}))});assert.equal(r.items.length,1);assert.deepEqual(r.items[0].prices,[]);assert.equal(r.items[0].ocr_product_evidence.sale_unit,null);
 assert.equal(productRows({...page,words:[page.words[0],{...page.words[1],y:600}]}).items.length,0);
 const n=page.words.map(w=>({...w,text:'合成飲料(500ml)税抜100円税込108円'}));
 const neighbour=n.map(w=>({...w,text:'1本',line:'1:2:1:1',x:w.x+w.w+10,w:20}));
 r=productRows({...page,words:[...n,...neighbour]});assert.equal(r.items[0].ocr_product_evidence.sale_unit,null);assert.deepEqual(r.items[0].prices,[]);
 assert.equal(productRows({...page,words:[word('る合成飲料(500ml)'),word('合成飲料(500ml)','read-b')]}).items.length,0,'normalization cannot delete a Japanese letter to manufacture read agreement');
});
test('bounded OCR checkpoints stop on pass count or deadline, preserve prior, and cap each child timeout',async()=>{
 const {extractPage}=await import('../scripts/supermarket/whole-flyer.mjs');let reads=0,clock=0;const timeouts=[];
 const run=async(c,a,o)=>{timeouts.push(o.timeout);if(c==='identify')return{stdout:'2000 1000'};if(c==='tesseract'){reads++;return{stdout:''};}return{stdout:''};};
 const a=await extractPage('synthetic',{run,maxPasses:1,budgetMs:500,now:()=>clock,onCheckpoint:()=>{clock=501;}});
 assert.equal(a.status,'page_partial');assert.equal(a.passes.length,1);assert.equal(a.deferred_passes.length,2);assert.equal(a.failed_passes.length,0);assert(timeouts.every(t=>t<=500));
 const b=await extractPage('synthetic',{run,prior:a});assert.equal(b.status,'processed');assert.equal(b.passes.length,3);assert.equal(reads,3);
 const c=await extractPage('synthetic',{run,prior:b});assert.equal(c.passes.length,3);assert.equal(reads,3);
 await assert.rejects(extractPage('synthetic',{run,budgetMs:280001}),/OCR_BUDGET_INVALID/);
});
async function fixture(){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'iy-bounded-synthetic-')),source=path.join(dir,'source.sqlite'),ledger=path.join(dir,'analysis.sqlite'),bytes=Buffer.from('synthetic image bytes');
 const db=new DatabaseSync(source);db.exec('CREATE TABLE flyer_discovered_editions(edition_id TEXT,store TEXT,source TEXT,from_day TEXT,until_day TEXT,observed_at TEXT);CREATE TABLE flyer_discovered_pages(edition_id TEXT,ordinal INTEGER,source TEXT,sha256 TEXT,state TEXT,body BLOB)');
 db.prepare('INSERT INTO flyer_discovered_editions VALUES(?,?,?,?,?,?)').run('edition','iy','https://promo.hatobase.jp/flyers/00521/9999/12345','2026-11-21','2026-11-24','2026-11-21T01:00:00Z');
 for(const n of [1,2]){db.prepare('INSERT INTO flyer_discovered_pages VALUES(?,?,?,?,?,?)').run('edition',n,'https://content.hatobase.jp/flyer_details/1/page'+n+'.jpg',sha(bytes),'saved',bytes);await fs.writeFile(path.join(dir,'p'+n+'.jpg'),bytes);}db.close();return{dir,source,ledger};
}
function fakeExtractor(counter,interrupt=false){return async(_,options)=>{
 const planned=['read-a','read-b'].map(id=>({id,x:0,y:0,w:1000,h:1000,psm:11,language:'jpn',render_scale:1}));
 const passes=[...(options.prior?.passes??[])],words=[...(options.prior?.words??[])];let newCount=0;
 for(const p of planned){if(passes.some(q=>q.id===p.id))continue;if(options.maxPasses&&newCount>=options.maxPasses)break;counter.n++;newCount++;passes.push({...p,tsv_sha256:sha(p.id)});words.push(word('架空商品(100g)',p.id));const partial={width:1000,height:1000,language:'jpn_full+jpn_best_tiles',passes,words,failed_passes:[],planned_passes:planned};await options.onCheckpoint(partial);if(interrupt)throw Error('synthetic_interrupt');}
 return{width:1000,height:1000,language:'jpn_full+jpn_best_tiles',passes,words,failed_passes:[],planned_passes:planned};
};}
test('actual supported worker entry resumes checkpoint, processes each face, and completion does zero repeated OCR',async()=>{
 const {runSavedEditionWorker}=await import('../scripts/supermarket/saved-edition-worker.mjs'),f=await fixture(),counter={n:0},extract=fakeExtractor(counter);
 try{
  const a=await runSavedEditionWorker(f.source,f.dir,f.ledger,{extract,maxPasses:1});assert.equal(a.faces[0].state,'partial');assert.equal(a.canonical,null);
  const b=await runSavedEditionWorker(f.source,f.dir,f.ledger,{extract});assert.equal(b.faces[0].state,'processed');assert.equal(b.faces[1].state,'pending');
  const c=await runSavedEditionWorker(f.source,f.dir,f.ledger,{extract});assert.equal(c.canonical.inserted,2);
  const d=await runSavedEditionWorker(f.source,f.dir,f.ledger,{extract});assert.equal(d.new_ocr_passes,0);assert.equal(d.canonical.inserted,0);assert.equal(counter.n,4);
  assert.equal(d.execution,'injected_extractor_usage_unknown');assert.equal(d.model_calls,null);
  const db=new DatabaseSync(f.ledger);db.exec("UPDATE flyer_corpus_listings SET observation_json='{}'");db.close();
  await assert.rejects(runSavedEditionWorker(f.source,f.dir,f.ledger,{extract}),/CANONICAL_READBACK/);
 }finally{await fs.rm(f.dir,{recursive:true,force:true});}
});
test('an empty or duplicate OCR plan cannot claim a processed face',async()=>{
 const {runSavedEditionWorker}=await import('../scripts/supermarket/saved-edition-worker.mjs');
 for(const plan of [[],[{id:'same',x:0,y:0,w:1000,h:1000,psm:11,language:'jpn',render_scale:1},{id:'same',x:0,y:0,w:1000,h:1000,psm:11,language:'jpn',render_scale:1}]]){
  const f=await fixture();try{await assert.rejects(runSavedEditionWorker(f.source,f.dir,f.ledger,{extract:async()=>({width:1000,height:1000,words:[],passes:[],planned_passes:plan})}),/PLAN_SCOPE/);}finally{await fs.rm(f.dir,{recursive:true,force:true});}
 }
});
test('interruption after committed OCR checkpoint recovers it without repeating; corrupted evidence and source changes reject',async()=>{
 const {runSavedEditionWorker}=await import('../scripts/supermarket/saved-edition-worker.mjs'),f=await fixture(),counter={n:0};
 try{
  await assert.rejects(runSavedEditionWorker(f.source,f.dir,f.ledger,{extract:fakeExtractor(counter,true)}),/synthetic_interrupt/);
  const r=await runSavedEditionWorker(f.source,f.dir,f.ledger,{extract:fakeExtractor(counter)});assert.equal(r.new_ocr_passes,1);assert.equal(counter.n,2);
  const db=new DatabaseSync(f.ledger);db.exec("UPDATE saved_worker_faces SET evidence_hash='corrupt'");db.close();
  await assert.rejects(runSavedEditionWorker(f.source,f.dir,f.ledger,{extract:fakeExtractor(counter)}),/EVIDENCE_HASH/);
 }finally{await fs.rm(f.dir,{recursive:true,force:true});}
});
test('changed source metadata or image bytes are rejected before any new OCR',async()=>{
 const {runSavedEditionWorker}=await import('../scripts/supermarket/saved-edition-worker.mjs');
 for(const change of ['metadata','image']){
  const f=await fixture(),counter={n:0},extract=fakeExtractor(counter);
  try{
   await runSavedEditionWorker(f.source,f.dir,f.ledger,{extract,maxPasses:1});
   const before=counter.n;
   if(change==='metadata'){const db=new DatabaseSync(f.source);db.exec("UPDATE flyer_discovered_editions SET observed_at='2026-11-21T02:00:00Z'");db.close();}
   else await fs.writeFile(path.join(f.dir,'p1.jpg'),'different image');
   await assert.rejects(runSavedEditionWorker(f.source,f.dir,f.ledger,{extract}),change==='metadata'?/INPUT_CHANGED/:/IMAGE_PROVENANCE/);assert.equal(counter.n,before);
  }finally{await fs.rm(f.dir,{recursive:true,force:true});}
 }
});

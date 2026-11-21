const test=require('node:test'),assert=require('node:assert/strict');
const word=(text,pass='full-psm11',x=100,y=100)=>({text,pass,line:'1:1:1:'+y,x,y,w:120,h:30,confidence:90});
const page=words=>({width:1000,height:1000,words,regions:[],passes:[{id:'full-psm11',x:0,y:0,w:1000,h:1000}],failed_passes:[],pixel_coverage:1});
test('all-category OCR labels retain coordinates and independent reads without asserting prices or item dates',async()=>{
 const {partialListings}=await import('../scripts/supermarket/discovered-observations.mjs');
 const p=page([word('白菜'),word('白菜','tile-1',102),word('洗濯用洗剤','full-psm11',700),word('7プレミアム','tile-2',100,300),word('Dove','tile-3',400,500)]);
 const r=partialListings(p);assert.equal(r.items.length,4);assert.equal(r.metrics.independent_read_agreement,1);
 assert(r.items.some(i=>i.name==='洗濯用洗剤'));assert(r.items.some(i=>i.name==='Dove'));
 assert(r.items.every(i=>i.prices.length===0&&i.price_state==='unreadable'&&i.valid_from===null&&i.valid_until===null));
 assert.deepEqual(r.items[0].bbox,[100,100,220,130]);assert.equal(r.items[0].distinct_read_count,2);
 assert.equal(r.metrics.verified_prices,0);assert.equal(r.metrics.true_product_denominator,null);
});
test('a product/price/date role is never inferred from a nearby amount or paper period',async()=>{
 const {partialListings}=await import('../scripts/supermarket/discovered-observations.mjs');
 const p=page([word('税込198円'),word('11月21日限り','full-psm11',100,200),{...word('読取不明','tile-1',100,300),confidence:15},word('商品候補','full-psm11',100,400)]);
 const r=partialListings(p);assert.equal(r.items.length,1);assert.equal(r.items[0].name,'商品候補');assert.equal(r.unresolved.length,3);
 assert.equal(r.items[0].validity_raw_text,null);assert.deepEqual(r.items[0].prices,[]);
});
test('two whole-face observations persist/read back without storing image bytes in the product DB',async()=>{
 const {persistDiscoveredObservations}=await import('../scripts/supermarket/discovered-observations.mjs');
 const {DatabaseSync}=require('node:sqlite'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{gzipSync}=require('node:zlib');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'offline-discovered-'));
 try{
  const input=path.join(root,'source.sqlite'),db=new DatabaseSync(input);const sha='a'.repeat(64),source='https://promo.hatobase.jp/flyers/00521/9999/99999';
  db.exec('CREATE TABLE flyer_discovered_editions(edition_id,store,source,from_day,until_day,observed_at); CREATE TABLE flyer_discovered_pages(edition_id,ordinal,source,sha256,state)');
  db.prepare('INSERT INTO flyer_discovered_editions VALUES(?,?,?,?,?,?)').run('fixture','iy',source,'2026-11-21','2026-11-24','2026-11-21T01:00:00Z');
  for(const ordinal of [1,2]){
   const image='https://content.hatobase.jp/flyer_details/1/page'+ordinal+'.jpg';
   db.prepare('INSERT INTO flyer_discovered_pages VALUES(?,?,?,?,?)').run('fixture',ordinal,image,sha,'saved');
   await fs.writeFile(path.join(root,'p'+ordinal+'.json.gz'),gzipSync(JSON.stringify({...page([word(ordinal===1?'野菜候補':'洗剤候補')]),ordinal,source:image,sha256:sha})));
  }db.close();
  const out=path.join(root,'output'),summary=await persistDiscoveredObservations(input,root,out);
  assert.equal(summary.stored_candidate_rows,2);assert(summary.sqlite_readback_verified);assert.equal(summary.network_requests,0);
  const result=new DatabaseSync(path.join(out,'observations.sqlite'),{readOnly:true});
  const names=result.prepare('SELECT name,price_state,verification_state FROM flyer_corpus_listings').all();
  assert(names.every(r=>r.price_state==='unreadable'&&r.verification_state==='needs_review'));
  assert.equal(result.prepare("SELECT count(*) n FROM pragma_table_info('flyer_corpus_listings') WHERE name IN ('body','image')").get().n,0);result.close();
  await assert.rejects(persistDiscoveredObservations(input,root,out),{code:'EEXIST'});
  // A partial face remains partial in persisted evidence, never a whole-face claim.
  const z=require('node:zlib'),file=path.join(root,'p2.json.gz'),raw=JSON.parse(z.gunzipSync(await fs.readFile(file)));
  raw.pixel_coverage=.5;raw.passes[0].w=500;raw.failed_passes=[{id:'missing-half'}];await fs.writeFile(file,gzipSync(JSON.stringify(raw)));
  const partial=path.join(root,'partial');await persistDiscoveredObservations(input,root,partial);
  const packet=JSON.parse(await fs.readFile(path.join(partial,'packet.json'),'utf8'));
  assert.match(packet.completeness_scope,/^Partial OCR coverage/);assert.equal(packet.pages[1].ocr_coverage.pixel_fraction,.5);assert.equal(packet.pages[1].ocr_coverage.failed_passes,1);
  raw.pixel_coverage=1;await fs.writeFile(file,gzipSync(JSON.stringify(raw)));
  await assert.rejects(persistDiscoveredObservations(input,root,path.join(root,'invalid-coverage')),/ANALYSIS_COVERAGE_PROVENANCE/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

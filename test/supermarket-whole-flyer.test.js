'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const modulePromise=import('../scripts/supermarket/whole-flyer.mjs');
test('overlapping tiles cover every original pixel including portrait/landscape edges',async()=>{
 const {tiles}=await modulePromise;
 for(const [w,h] of [[4000,2812],[2813,4000],[500,300],[1601,1601]]){
  const plan=tiles(w,h),xs=[...new Set([0,w,...plan.flatMap(t=>[t.x,t.x+t.w])])].sort((a,b)=>a-b),ys=[...new Set([0,h,...plan.flatMap(t=>[t.y,t.y+t.h])])].sort((a,b)=>a-b);
  for(let i=0;i<xs.length-1;i++)for(let j=0;j<ys.length-1;j++)assert.ok(plan.some(t=>t.x<=xs[i]&&t.x+t.w>=xs[i+1]&&t.y<=ys[j]&&t.y+t.h>=ys[j+1]));
  assert.ok(plan.every(t=>t.x>=0&&t.y>=0&&t.x+t.w<=w&&t.y+t.h<=h));
 }
 assert.throws(()=>tiles(100,100,10,10),/TILE_DIMENSIONS/);
});
test('TSV coordinates map to page space, retaining confidence and line evidence',async()=>{
 const {parseTsv}=await modulePromise;
 const words=parseTsv('level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n5\t1\t2\t1\t3\t1\t10\t20\t30\t40\t85\t198\n','tile-1',{x:1280,y:0});
 assert.deepEqual(words[0],{pass:'tile-1',line:'1:2:1:3',x:1290,y:20,w:30,h:40,confidence:85,text:'198'});
});
test('overlap agreements retain uncertain candidates without inventing dates, unit or tax',async()=>{
 const {regionsFromWords}=await modulePromise;
 const word=(text,pass,x=100,y=100)=>({text,pass,x,y,w:45,h:30,confidence:90,line:'1:1:1:1'});
 const result=regionsFromWords([word('198','full-psm11'),word('198','tile-1',102),word('牛乳','full-psm11',40,65),word('会員限定','full-psm11',20,45)],1000,1000);
 assert.equal(result.length,1);assert.equal(result[0].confidence.agreeing_passes,2);
 assert.equal(result[0].status,'needs_review');assert.equal(result[0].net_yen,null);assert.equal(result[0].valid_until,null);
 assert.ok(result[0].proposals.label_lines.some(l=>l.text.includes('牛乳')));
 assert.ok(result[0].review_reasons.includes('ITEM_DATE_SCOPE_UNVERIFIED'));
});
test('disagreeing prices and discount/date/quantity anchors are not silently dropped or confirmed',async()=>{
 const {regionsFromWords}=await modulePromise;
 const words=['198','199','20%','11/21','100g'].map((text,i)=>({text,pass:'p'+i,line:'1:1:1:1',x:100,y:100,w:80,h:30,confidence:50}));
 const out=regionsFromWords(words,1000,1000);
 assert.equal(out.length,1);assert.ok(out.every(r=>r.status==='needs_review'&&r.net_yen===null));
 assert.equal(out[0].confidence.agreeing_passes,1);assert.ok(out[0].review_reasons.includes('NUMERIC_READ_DISAGREEMENT'));
 assert.deepEqual(out[0].proposals.numeric_strings,['198','199','20','11','21','100']);
});
test('adjacent net and tax anchors remain separate even when both are numeric',async()=>{
 const {regionsFromWords}=await modulePromise;
 const words=[{text:'198',pass:'full',line:'1:1:1:1',x:100,y:100,w:70,h:40,confidence:90},{text:'213',pass:'tile',line:'1:1:1:2',x:110,y:150,w:35,h:20,confidence:90}];
 assert.equal(regionsFromWords(words,1000,1000).length,2);
});
test('a failed page remains in private readback, incomplete listing is not accepted and runs cannot overwrite',async()=>{
 const {buildCorpus,resumeCorpus,reindexCorpus}=await modulePromise;
 const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{createHash}=require('node:crypto'),{DatabaseSync}=require('node:sqlite'),{gunzipSync}=require('node:zlib');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'paluru-corpus-test-'));
 try{
  const bytes=Buffer.from('fixture-only');await fs.writeFile(path.join(dir,'page.jpg'),bytes);
  const manifest={store:'life',issues:[{id:'edition',from:'2026-11-20',until:'2026-11-24',observed_listed_pages:2,pages:[{ordinal:1,file:'page.jpg',source:'https://example.invalid/public.jpg',sha256:createHash('sha256').update(bytes).digest('hex')}]}]};
  const input=path.join(dir,'manifest.json'),output=path.join(dir,'run');await fs.writeFile(input,JSON.stringify(manifest));
  const report=await buildCorpus(input,output,{extract:async()=>{throw Error('OCR_TEST_FAILURE');}});
  assert.equal(report.issues[0].acquired_pages,1);assert.equal(report.issues[0].processed_pages,0);
  assert.equal(report.issues[0].listed_page_coverage_complete,false);assert.equal(report.issues[0].confirmed_products,0);assert.equal(report.recall,null);
  const db=new DatabaseSync(path.join(output,'whole-flyer.sqlite'),{readOnly:true});
  const evidence=JSON.parse(gunzipSync(db.prepare('SELECT evidence FROM corpus_pages').get().evidence));db.close();
  assert.equal(evidence.status,'page_failed');assert.equal(evidence.unextracted_product_regions,null);
  let resumed=0;
  const second=await resumeCorpus(input,output,path.join(dir,'resume'),{extract:async(_,options)=>{
   assert.equal(options.prior,null);resumed++;return {status:'processed',width:1,height:1,language:'jpn',passes:[],words:[],regions:[]};
  }});
  assert.equal(resumed,1);assert.equal(second.issues[0].processed_pages,1);assert.ok(second.parent_run_summary_sha256);
  const indexed=await reindexCorpus(path.join(dir,'resume'),path.join(dir,'reindex'));
  const indexedAgain=await reindexCorpus(path.join(dir,'reindex'),path.join(dir,'reindex2'));
  assert.equal(indexedAgain.ocr_implementation_sha256,indexed.ocr_implementation_sha256);
  await assert.rejects(buildCorpus(input,output),{code:'EEXIST'});
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('later OCR timeouts preserve earlier page words/passes and mark partial instead of complete',async()=>{
 const {extractPage}=await modulePromise;let calls=0;
 const run=async(command)=>{
  if(command==='identify')return {stdout:'2000 1000'};
  if(command==='convert')return {stdout:''};
  if(++calls>1)throw Object.assign(Error('fixture timeout'),{code:null,killed:true,signal:'SIGTERM'});
  return {stdout:'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n5\t1\t1\t1\t1\t1\t10\t10\t30\t30\t90\t198\n'};
 };
 const page=await extractPage('fixture-not-opened',{run});
 assert.equal(page.status,'page_partial');assert.equal(page.words.length,1);assert.equal(page.passes.length,1);
 assert.equal(page.failed_passes.length,2);assert.ok(page.failed_passes.every(p=>p.reason==='OCR_TIMEOUT'));
 assert.equal(page.pixel_coverage,1); // successful full-page OCR, incomplete independent tile reads
});
test('duplicate or path-shaped issue ids fail before creating or overwriting evidence',async()=>{
 const {buildCorpus}=await modulePromise,fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'paluru-manifest-test-'));
 try{
  const issue={id:'../escape',pages:[{ordinal:1}]},input=path.join(dir,'in.json'),out=path.join(dir,'run');
  await fs.writeFile(input,JSON.stringify({issues:[issue]}));await assert.rejects(buildCorpus(input,out),/PAGE_MANIFEST_INVALID/);
  issue.id='valid';await fs.writeFile(input,JSON.stringify({issues:[issue,issue]}));await assert.rejects(buildCorpus(input,out),/ISSUE_ID_DUPLICATE/);
  await assert.rejects(fs.stat(out),{code:'ENOENT'});
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

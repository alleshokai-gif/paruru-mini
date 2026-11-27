// Explicit offline entry point for acquired pages; NOT a live daily collector.
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile,stat,lstat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {gzipSync,gunzipSync} from 'node:zlib';
import {DatabaseSync} from 'node:sqlite';
import {extractPage,rectangleCoverage} from './whole-flyer.mjs';
import {productRows} from './ocr-product-rows.mjs';
import {ingestCorpus,readCorpus} from './whole-corpus-store.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const requireOk=(yes,code)=>{if(!yes)throw Error('SAVED_WORKER_'+code);};
const codeRevision=hash((await Promise.all(['saved-edition-worker.mjs','whole-flyer.mjs','ocr-product-rows.mjs','whole-corpus-store.mjs'].map(f=>readFile(new URL('./'+f,import.meta.url))))).map(hash).join('|'));
async function fileHash(p){const h=createHash('sha256');for await(const b of createReadStream(p))h.update(b);return h.digest('hex');}
function validateEvidence(e,meta){
 requireOk([e.width,e.height].every(n=>Number.isInteger(n)&&n>0)&&e.width*e.height<=48000000,'DIMENSIONS');
 requireOk(e.source_sha256===meta.sha256&&e.ordinal===meta.ordinal&&e.code_revision===codeRevision&&Array.isArray(e.words)&&e.words.length<=250000&&Array.isArray(e.passes)&&Array.isArray(e.planned_passes)&&e.planned_passes.length<=128,'EVIDENCE_SCOPE');
 requireOk(e.planned_passes.length>0&&new Set(e.planned_passes.map(p=>p.id)).size===e.planned_passes.length&&e.planned_passes.every(p=>typeof p.id==='string'&&[p.x,p.y,p.w,p.h].every(Number.isInteger)&&p.x>=0&&p.y>=0&&p.w>0&&p.h>0&&p.x+p.w<=e.width&&p.y+p.h<=e.height&&[11].includes(p.psm)&&['jpn','jpn_best'].includes(p.language)&&p.render_scale>0&&p.render_scale<=1)&&rectangleCoverage(e.planned_passes,e.width,e.height)===1,'PLAN_SCOPE');
 requireOk(new Set(e.passes.map(p=>p.id)).size===e.passes.length&&e.passes.every(p=>e.planned_passes.some(q=>['id','x','y','w','h','psm','language','render_scale'].every(k=>p[k]===q[k]))&&/^[a-f0-9]{64}$/.test(p.tsv_sha256))&&e.words.every(w=>e.passes.some(p=>p.id===w.pass)&&typeof w.text==='string'&&Number.isFinite(w.confidence)&&[w.x,w.y,w.w,w.h].every(Number.isFinite)&&w.x>=0&&w.y>=0&&w.w>0&&w.h>0&&w.x+w.w<=e.width+2&&w.y+w.h<=e.height+2),'PASS_PROVENANCE');
}
function packetFrom(edition,pages,results){
 return {schema:'supermarket-whole-corpus-v2',source_kind:'image',store:'iy',issue_id:'iy-00521-'+edition.source.match(/\/(\d+)$/)[1],source_document:edition.source,source_revision:hash(JSON.stringify(pages)),analysis_revision:codeRevision,obtained_at:edition.observed_at,document_from:edition.from_day,document_until:edition.until_day,physical_pdf_pages:null,logical_faces:2,
 completeness_scope:'All planned acquired image regions scanned. Automatic commercial label/spec agreement only; unknown price/unit/item dates preserved. No semantic verification, product denominator or recall claim.',
 pages:results.map((r,i)=>({face:i===0?'front':'back',examined_tiles:r.evidence.passes.map(p=>p.id),document_period_raw:null,items:r.products.items,unresolved_regions:r.products.unresolved.slice(0,1000).map(u=>({bbox:[Math.floor(u.bbox.x/r.evidence.width*1000),Math.floor(u.bbox.y/r.evidence.height*1000),Math.ceil((u.bbox.x+u.bbox.w)/r.evidence.width*1000),Math.ceil((u.bbox.y+u.bbox.h)/r.evidence.height*1000)],reason:u.reason}))}))};
}
export async function runSavedEditionWorker(sourceDb,imageDir,ledgerFile,{ordinal=null,budgetMs=280000,maxPasses=null,extract=extractPage,now=()=>performance.now()}={}){
 const began=now();requireOk(Number.isInteger(budgetMs)&&budgetMs>=1000&&budgetMs<=280000&&(ordinal===null||[1,2].includes(ordinal)),'LIMITS');
 // 20 seconds remain outside this maximum for process startup, cleanup/readback.
 const end=began+budgetMs,sourceHash=await fileHash(sourceDb),input=new DatabaseSync(sourceDb,{readOnly:true});
 let edition,pages;
 try{
  const all=input.prepare("SELECT edition_id,source,from_day,until_day,observed_at FROM flyer_discovered_editions WHERE store='iy'").all();
  requireOk(all.length===1&&/^https:\/\/promo\.hatobase\.jp\/flyers\/00521\/\d+\/\d+$/.test(all[0].source),'EDITION');edition=all[0];
  requireOk([edition.from_day,edition.until_day].every(d=>/^20\d{2}-\d{2}-\d{2}$/.test(d)&&new Date(d).toISOString().slice(0,10)===d)&&edition.from_day<=edition.until_day&&Number.isFinite(Date.parse(edition.observed_at)),'EDITION_DATES');
  pages=input.prepare('SELECT ordinal,source,sha256,state,length(body) bytes FROM flyer_discovered_pages WHERE edition_id=? ORDER BY ordinal').all(edition.edition_id);
  requireOk(pages.length===2&&pages.every((p,i)=>p.ordinal===i+1&&p.state==='saved'&&p.bytes>0&&p.bytes<=8*1024*1024&&/^[a-f0-9]{64}$/.test(p.sha256)&&/^https:\/\/content\.hatobase\.jp\/flyer_details\/\d+\/[^/?#]+\.(?:jpg|jpeg|png)(?:\.progressive\.jpeg)?$/.test(p.source)),'PAGES');
 }finally{input.close();}
 const pin=JSON.stringify({edition,pages,sourceHash,codeRevision}),db=new DatabaseSync(ledgerFile);
 db.exec(`CREATE TABLE IF NOT EXISTS saved_worker_pin(id INTEGER PRIMARY KEY CHECK(id=1),pin TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS saved_worker_faces(ordinal INTEGER PRIMARY KEY,state TEXT NOT NULL,evidence_hash TEXT NOT NULL,evidence BLOB NOT NULL,products_json TEXT NOT NULL);`);
 const load=meta=>{const row=db.prepare('SELECT * FROM saved_worker_faces WHERE ordinal=?').get(meta.ordinal);if(!row)return null;requireOk(hash(row.evidence)===row.evidence_hash,'EVIDENCE_HASH');const evidence=JSON.parse(gunzipSync(row.evidence,{maxOutputLength:32*1024*1024}));validateEvidence(evidence,meta);const products=productRows(evidence);requireOk(JSON.stringify(products)===row.products_json,'PRODUCT_READBACK');const complete=evidence.planned_passes.every(p=>evidence.passes.some(q=>p.id===q.id));requireOk(row.state===(complete?'processed':'partial'),'STATE_DRIFT');return {evidence,products,state:row.state};};
 try{
  db.exec('BEGIN IMMEDIATE');try{const old=db.prepare('SELECT pin FROM saved_worker_pin WHERE id=1').get();if(old)requireOk(old.pin===pin,'INPUT_CHANGED');else{requireOk(db.prepare('SELECT count(*) n FROM saved_worker_faces').get().n===0,'ORPHAN_INPUT');db.prepare('INSERT INTO saved_worker_pin VALUES(1,?)').run(pin);}db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
  const priorResults=pages.map(load),index=ordinal?ordinal-1:priorResults.findIndex(r=>r?.state!=='processed');
  let newPasses=0,processedOrdinal=null;
  if(index>=0&&priorResults[index]?.state!=='processed'){
   const meta=pages[index],image=join(imageDir,'p'+meta.ordinal+'.jpg');
   requireOk((await lstat(image)).isFile()&&!(await lstat(image)).isSymbolicLink()&&(await stat(image)).size===meta.bytes&&await fileHash(image)===meta.sha256,'IMAGE_PROVENANCE');
   // Keep the output write lease throughout extraction: concurrent callers fail
   // before any OCR. Hard interruption rolls back; committed prior passes remain.
   let locked=false;
   const save=partial=>{
    const evidence={...partial,source_sha256:meta.sha256,ordinal:meta.ordinal,code_revision:codeRevision};validateEvidence(evidence,meta);
    const compressed=gzipSync(JSON.stringify(evidence)),products=productRows(evidence);requireOk(compressed.length<=8*1024*1024,'EVIDENCE_SIZE');
    const state=evidence.planned_passes.every(p=>evidence.passes.some(q=>p.id===q.id))?'processed':'partial';
    db.prepare('INSERT OR REPLACE INTO saved_worker_faces VALUES (?,?,?,?,?)').run(meta.ordinal,state,hash(compressed),compressed,JSON.stringify(products));
    db.exec('COMMIT');locked=false;db.exec('BEGIN IMMEDIATE');locked=true;
   };
   db.exec('BEGIN IMMEDIATE');locked=true;
   try{
    const current=load(meta);requireOk(JSON.stringify(current)===JSON.stringify(priorResults[index]),'CONCURRENT_CHANGE');
    const remaining=Math.floor(end-now()-5000);requireOk(remaining>1000,'NO_TIME');
    const result=await extract(image,{prior:current?.evidence??null,maxPixels:48000000,budgetMs:remaining,maxPasses,now,onCheckpoint:save});
    newPasses=result.passes.length-(current?.evidence.passes.length??0);save(result);processedOrdinal=meta.ordinal;
    db.exec('COMMIT');locked=false;
   }catch(e){if(locked)db.exec('ROLLBACK');throw e;}
  }
  const results=pages.map(load);let canonical=null;
  if(results.every(r=>r?.state==='processed')&&now()<end-1000){
   const packet=packetFrom(edition,pages,results);canonical=ingestCorpus(db,packet);const read=readCorpus(db,canonical.corpus_id);
   const expected=packet.pages.flatMap(p=>p.items.map((item,n)=>({face:p.face,ordinal:n+1,item}))).sort((a,b)=>a.face.localeCompare(b.face)||a.ordinal-b.ordinal);
   requireOk(JSON.stringify(read.packet)===JSON.stringify(packet)&&read.listings.length===expected.length&&read.listings.every((row,n)=>row.face===expected[n].face&&row.ordinal===expected[n].ordinal&&row.verification_state==='needs_review'&&JSON.stringify(row.observation)===JSON.stringify(expected[n].item)),'CANONICAL_READBACK');
  }
  requireOk(await fileHash(sourceDb)===sourceHash,'SOURCE_CHANGED');
  const builtin=extract===extractPage;
  return {schema:'saved-edition-worker-local-v1',execution:builtin?'unattended_local_ocr':'injected_extractor_usage_unknown',code_revision:codeRevision,processed_ordinal:processedOrdinal,new_ocr_passes:newPasses,total_ms:now()-began,budget_ms:budgetMs,source_db_unchanged:true,obtained_at:edition.observed_at,document_from:edition.from_day,document_until:edition.until_day,faces:results.map((r,i)=>r?{ordinal:i+1,state:r.state,successful_passes:r.evidence.passes.length,planned_passes:r.evidence.planned_passes.length,native_pixel_coverage:rectangleCoverage(r.evidence.passes.filter(p=>p.render_scale===1),r.evidence.width,r.evidence.height),...r.products.metrics}:{ordinal:i+1,state:'pending'}),canonical,source_requests:builtin?0:null,model_calls:builtin?0:null,production_writes:builtin?0:null,daily_collector_connected:false};
 }finally{db.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{requireOk(process.argv.length===5||process.argv.length===6,'USAGE');console.log(JSON.stringify(await runSavedEditionWorker(...process.argv.slice(2,5),{maxPasses:process.argv[5]?Number(process.argv[5]):null})));}
 catch(_){console.error('SAVED_WORKER_STOPPED');process.exitCode=1;}
}

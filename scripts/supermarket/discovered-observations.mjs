// Offline, private OCR observations. This module never fetches or publishes.
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';
import {ingestCorpus,readCorpus} from './whole-corpus-store.mjs';
import {rectangleCoverage} from './whole-flyer.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const implementation=sha(await readFile(new URL(import.meta.url)));
const norm=s=>s.normalize('NFKC').replace(/\s/g,'');
const letters=s=>/\p{L}/u.test(s);
const overlaps=(a,b)=>Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y))/Math.min(a.w*a.h,b.w*b.h)>=.45;
const normalizedBox=(b,w,h)=>[Math.max(0,Math.floor(b.x/w*1000)),Math.max(0,Math.floor(b.y/h*1000)),Math.min(1000,Math.ceil((b.x+b.w)/w*1000)),Math.min(1000,Math.ceil((b.y+b.h)/h*1000))];

// Segment every OCR line spatially, independently of food category or price.
// An OCR label is a potential listing, never a verified product boundary.
export function partialListings(page){
 const lines=new Map();for(const word of page.words){
  const key=word.pass+':'+word.line;if(!lines.has(key))lines.set(key,[]);lines.get(key).push(word);
 }
 const labels=[],unresolved=[];
 for(const words of lines.values()){
  words.sort((a,b)=>a.x-b.x);const segments=[];
  for(const word of words){let s=segments.at(-1);const last=s?.at(-1);
   if(!last||word.x-(last.x+last.w)>Math.max(last.h,word.h)*1.8){s=[];segments.push(s);}s.push(word);
  }
  for(const s of segments){
   const text=s.map(w=>w.text).join(' ').trim(),key=norm(text);
   const b={x:Math.min(...s.map(w=>w.x)),y:Math.min(...s.map(w=>w.y)),w:0,h:0};
   b.w=Math.max(...s.map(w=>w.x+w.w))-b.x;b.h=Math.max(...s.map(w=>w.y+w.h))-b.y;
   if(!letters(text)||key.length<2||key.length>140)continue; // raw words still preserved
   const confidence=s.reduce((n,w)=>n+w.confidence,0)/s.length;
   // Date/price/advertising prose is retained as unresolved, not a product name.
   const nonlabel=/^(?:税込|税抜|本体|価格|お一人|おひとり|詳しく|※|こちら|ポイント|営業時間|https?:)/u.test(key)||/^\d[\d,./月日曜日限り税込税抜本体円%〜~–-]*$/u.test(key);
   if(nonlabel||confidence<55){unresolved.push({bbox:normalizedBox(b,page.width,page.height),reason:nonlabel?'OCR_LABEL_ROLE_UNVERIFIED':'OCR_TEXT_LOW_CONFIDENCE',raw_text:text});continue;}
   let label=labels.find(l=>l.key===key&&overlaps(l.box,b));
   if(!label){label={key,text,box:b,reads:[]};labels.push(label);}
   label.reads.push({pass:s[0].pass,confidence,bbox:normalizedBox(b,page.width,page.height),raw_text:text});
  }
 }
 const items=labels.map(l=>({name:l.text,spec:null,variants:[],product_type:'unknown',price_state:'unreadable',prices:[],
  valid_from:null,valid_until:null,validity_raw_text:null,conditions:[],bbox:normalizedBox(l.box,page.width,page.height),confidence:'uncertain',
  review_reasons:['OCR_LABEL_NOT_VERIFIED_PRODUCT','PRODUCT_BOUNDARY_UNVERIFIED','LABEL_PRICE_ASSOCIATION_UNVERIFIED','ITEM_DATE_SCOPE_UNVERIFIED','TAX_UNIT_MEMBER_SCOPE_UNVERIFIED'],
  ocr_reads:l.reads,distinct_read_count:new Set(l.reads.map(r=>r.pass)).size}));
 return {items,unresolved,metrics:{ocr_label_candidates:items.length,independent_read_agreement:items.filter(i=>i.distinct_read_count>=2).length,
  unresolved_label_segments:unresolved.length,numeric_regions:page.regions.length,verified_products:0,verified_prices:0,true_product_denominator:null}};
}

export async function persistDiscoveredObservations(sourceDb,ocrDir,outdir){
 const source=new DatabaseSync(sourceDb,{readOnly:true});let edition,pages;
 try{
  const editions=source.prepare('SELECT * FROM flyer_discovered_editions WHERE store=?').all('iy');
  if(editions.length!==1)throw Error('ANALYSIS_EDITION_SCOPE');edition=editions[0];
  pages=source.prepare('SELECT ordinal,source,sha256,state FROM flyer_discovered_pages WHERE edition_id=? ORDER BY ordinal').all(edition.edition_id);
 }finally{source.close();}
 if(pages.length!==2||pages.some((p,i)=>p.state!=='saved'||p.ordinal!==i+1))throw Error('ANALYSIS_TWO_SAVED_FACES_REQUIRED');
 const observations=[],inputHashes=[],metrics=[];
 for(const p of pages){
  const bytes=await readFile(join(ocrDir,'p'+p.ordinal+'.json.gz')),page=JSON.parse(gunzipSync(bytes,{maxOutputLength:32*1024*1024}));
  if(page.ordinal!==p.ordinal||page.source!==p.source||page.sha256!==p.sha256||!Array.isArray(page.words)||!Array.isArray(page.passes)||!Array.isArray(page.failed_passes)||![page.width,page.height].every(n=>Number.isInteger(n)&&n>0)||page.width*page.height>48000000||!Number.isFinite(page.pixel_coverage)||page.pixel_coverage<0||page.pixel_coverage>1)throw Error('ANALYSIS_PAGE_PROVENANCE');
  if(page.passes.some(r=>![r.x,r.y,r.w,r.h].every(Number.isInteger)||r.x<0||r.y<0||r.w<1||r.h<1||r.x+r.w>page.width||r.y+r.h>page.height)||Math.abs(rectangleCoverage(page.passes,page.width,page.height)-page.pixel_coverage)>1e-9)throw Error('ANALYSIS_COVERAGE_PROVENANCE');
  inputHashes.push(sha(bytes));const result=partialListings(page);
  observations.push({face:p.ordinal===1?'front':'back',examined_tiles:page.passes.map(p=>p.id),items:result.items,
   unresolved_regions:result.unresolved.slice(0,1000).map(r=>({bbox:r.bbox,reason:r.reason})),document_period_raw:null,
   ocr_coverage:{pixel_fraction:page.pixel_coverage,successful_passes:page.passes.length,failed_passes:page.failed_passes.length,source_image_sha256:p.sha256,raw_evidence_sha256:sha(bytes)}});
  metrics.push({ordinal:p.ordinal,width:page.width,height:page.height,pixel_coverage:page.pixel_coverage,successful_passes:page.passes.length,failed_passes:page.failed_passes.length,...result.metrics});
 }
 const packet={schema:'supermarket-whole-corpus-v2',source_kind:'image',store:'iy',issue_id:'iy-00521-'+edition.source.match(/\/(\d+)$/)?.[1],
  source_document:edition.source,source_revision:sha(JSON.stringify(pages.map(p=>({ordinal:p.ordinal,source:p.source,sha256:p.sha256})))),
  analysis_revision:sha(implementation+inputHashes.join('|')),obtained_at:edition.observed_at,physical_pdf_pages:null,logical_faces:2,
  document_from:edition.from_day,document_until:edition.until_day,pages:observations,
  completeness_scope:(metrics.every(p=>p.pixel_coverage===1)?'Both acquired whole faces scanned. ':'Partial OCR coverage; unscanned pixels remain. ')+
   'Per-face coverage and failed-pass counts retained. OCR labels are unverified candidate rows, not distinct products. Source product denominator and extraction recall unknown. Paper dates do not confer item validity.'};
 await mkdir(outdir,{recursive:false});
 const db=new DatabaseSync(join(outdir,'observations.sqlite'));let stored,readback;
 try{stored=ingestCorpus(db,packet);readback=readCorpus(db,stored.corpus_id);
  if(JSON.stringify(readback.packet)!==JSON.stringify(packet)||readback.listings.length!==stored.inserted)throw Error('ANALYSIS_READBACK_MISMATCH');
 }finally{db.close();}
 const summary={corpus_id:stored.corpus_id,source:edition.source,analysis_revision:packet.analysis_revision,source_revision:packet.source_revision,
  pages:metrics,stored_candidate_rows:stored.inserted,verified_products:0,verified_prices:0,product_recall:null,
  sqlite_readback_verified:true,network_requests:0,model_calls:0,production_writes:0};
 await writeFile(join(outdir,'packet.json'),JSON.stringify(packet,null,2),{flag:'wx'});
 await writeFile(join(outdir,'summary.json'),JSON.stringify(summary,null,2),{flag:'wx'});return summary;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 if(process.argv.length!==5)throw Error('USAGE_SOURCE_DB_OCR_DIR_NEW_OUTPUT_DIR');
 console.log(JSON.stringify(await persistDiscoveredObservations(...process.argv.slice(2)),null,2));
}

// Consume explicit local image readings. No image/model/network invocation or publication.
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {rectangleCoverage} from './whole-flyer.mjs';
import {ingestCorpus,readCorpus,corpusCatalog} from './whole-corpus-store.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const implementation=sha(await readFile(new URL(import.meta.url)));
const demand=(ok,code)=>{if(!ok)throw Error('VISION_'+code);};
const norm=s=>s.normalize('NFKC').replace(/\s/g,'');
const day=s=>s===null||typeof s==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(s)&&new Date(s).toISOString().slice(0,10)===s;
const monetary=n=>n===null||Number.isFinite(n)&&n>=0&&n<=10000000;
const box=(b,w,h)=>Array.isArray(b)&&b.length===4&&b.every(Number.isInteger)&&b[0]>=0&&b[1]>=0&&b[2]>b[0]&&b[3]>b[1]&&b[2]<=w&&b[3]<=h;
const normalized=(b,w,h)=>[Math.floor(b[0]/w*1000),Math.floor(b[1]/h*1000),Math.ceil(b[2]/w*1000),Math.ceil(b[3]/h*1000)];
const intersection=(a,b)=>Math.max(0,Math.min(a[2],b[2])-Math.max(a[0],b[0]))*Math.max(0,Math.min(a[3],b[3])-Math.max(a[1],b[1]));
const overlap=(a,b)=>intersection(a,b)/Math.min((a[2]-a[0])*(a[3]-a[1]),(b[2]-b[0])*(b[3]-b[1]));

export function deduplicateVisionRows(rows){
 const out=[];for(const row of rows){
  const key=[row.face,row.name,row.spec??'',row.unit??''].map(norm).join('|');
  const prior=out.find(r=>r.key===key&&overlap(r.row.pixel_bbox,row.pixel_bbox)>=.5);
  if(prior){
   const terms=r=>JSON.stringify([(r.conditions??[]).map(norm).sort(),norm(r.period_raw_text??''),r.product_type??'unknown']);
   demand(prior.row.net_yen===row.net_yen&&prior.row.tax_included_yen===row.tax_included_yen&&JSON.stringify(prior.row.item_period)===JSON.stringify(row.item_period)&&terms(prior.row)===terms(row),'DUPLICATE_CONFLICT');prior.ids.push(row.id);
  }
  else out.push({key,row,ids:[row.id]});
 }return out;
}
// Presence of a matching number in an approximate card is supporting evidence,
// never proof that the label, price, payment conditions or period are confirmed.
export function numericEvidence(row,page){
 const inside=o=>{const x=o.x+o.w/2,y=o.y+o.h/2,b=row.pixel_bbox;return b[0]<=x&&x<b[2]&&b[1]<=y&&y<b[3];};
 const hits=value=>value===null?[]:[...new Set((page?.regions??[]).flatMap(r=>r.observations??[]).filter(o=>inside(o)&&o.values.some(v=>Number(v.replaceAll(',',''))===value)).map(o=>o.pass))];
 return {net_seen_passes:hits(row.net_yen),tax_seen_passes:hits(row.tax_included_yen),scope:'approximate_card_numeric_presence_only',confers_verification:false};
}
export function visionPacket({manifest,readings,edition,pages,ocrPages,manifestHash,inputRevision}){
 demand(readings.execution==='interactive_codex_vision'&&readings.paid_api_calls===0&&readings.source_requests===0,'EXECUTION_SCOPE');
 demand(readings.manifest_sha256===manifestHash&&manifest.source_document===edition.source,'SOURCE_MANIFEST');
 const {width:w,height:h}=manifest;demand([w,h].every(n=>Number.isInteger(n)&&n>0)&&w*h<=48000000,'DIMENSIONS');
 demand(pages.length===2&&pages.every((p,i)=>p.ordinal===i+1&&p.state==='saved'),'SOURCE_FACES');
 demand(Array.isArray(manifest.tiles)&&manifest.tiles.length>0&&manifest.tiles.length<=128&&new Set(manifest.tiles.map(t=>t.id)).size===manifest.tiles.length,'TILE_PLAN');
 demand(Array.isArray(readings.examined_tiles)&&new Set(readings.examined_tiles).size===readings.examined_tiles.length&&readings.examined_tiles.length===manifest.tiles.length&&manifest.tiles.every(t=>readings.examined_tiles.includes(t.id)),'TILES_UNEXAMINED');
 for(const [i,face] of ['front','back'].entries()){
  const tiles=manifest.tiles.filter(t=>t.face===face);demand(tiles.length&&tiles.every(t=>typeof t.id==='string'&&/^[a-z0-9-]{1,79}$/.test(t.id)&&t.source_image_sha256===pages[i].sha256&&box(t.pixel_bbox,w,h)),'TILE_PROVENANCE');
  demand(rectangleCoverage(tiles.map(t=>({x:t.pixel_bbox[0],y:t.pixel_bbox[1],w:t.pixel_bbox[2]-t.pixel_bbox[0],h:t.pixel_bbox[3]-t.pixel_bbox[1]})),w,h)===1,'TILE_COVERAGE');
  const o=ocrPages[i];demand(o.ordinal===pages[i].ordinal&&o.source===pages[i].source&&o.sha256===pages[i].sha256&&o.width===w&&o.height===h,'OCR_PROVENANCE');
 }
 demand(manifest.tiles.every(t=>['front','back'].includes(t.face))&&Array.isArray(readings.rows)&&readings.rows.length<=2000,'READING_SCOPE');
 demand(new Set(readings.rows.map(r=>r.id)).size===readings.rows.length,'ROW_ID_DUPLICATE');
 for(const r of readings.rows){
  demand(typeof r.id==='string'&&/^[a-z0-9-]{1,80}$/.test(r.id)&&['front','back'].includes(r.face)&&typeof r.name==='string'&&r.name.trim()&&r.name.length<=500&&[null,undefined,'string'].includes(r.spec==null?r.spec:typeof r.spec)&&box(r.pixel_bbox,w,h),'ROW_FIELDS');
  demand((r.unit===null||typeof r.unit==='string'&&r.unit.length<=500)&&monetary(r.net_yen)&&monetary(r.tax_included_yen),'PRICE_FIELDS');
  demand(r.item_period===null||Array.isArray(r.item_period)&&r.item_period.length===2&&r.item_period.every(day)&&(!r.item_period[0]||!r.item_period[1]||r.item_period[0]<=r.item_period[1]),'ITEM_PERIOD');
  demand(!r.item_period||typeof r.period_raw_text==='string'&&r.period_raw_text.trim(),'PERIOD_EVIDENCE');
 }
 const unique=deduplicateVisionRows(readings.rows),resultPages=['front','back'].map((face,index)=>({face,
  examined_tiles:manifest.tiles.filter(t=>t.face===face).map(t=>t.id),document_period_raw:null,
  items:unique.filter(r=>r.row.face===face).map(({row:r,ids})=>{
   const b=normalized(r.pixel_bbox,w,h),hasPrice=r.net_yen!==null||r.tax_included_yen!==null;
   return {name:r.name,spec:r.spec??null,variants:[],product_type:r.product_type??'unknown',price_state:hasPrice?'priced':'unreadable',
    prices:hasPrice?[{role:'general',net_yen:r.net_yen,tax_included_yen:r.tax_included_yen,discount_percent:null,
     raw_text:'画像読取：'+(r.net_yen===null?'本体未確認':'本体'+r.net_yen+'円')+' / '+(r.tax_included_yen===null?'税込未確認':'税込'+r.tax_included_yen+'円'),
     unit_text:r.unit,bbox:b,payment_condition:'参考読取・会員/支払/店舗条件は未照合',confidence:'single_visual_read',review_reasons:['REFERENCE_ONLY_NOT_CONFIRMED_PRICE']}]:[],
    valid_from:r.item_period?.[0]??null,valid_until:r.item_period?.[1]??null,validity_raw_text:r.period_raw_text??null,
    bbox:b,conditions:r.conditions??[],confidence:'single_visual_read',review_reasons:['INTERACTIVE_IMAGE_READ_REFERENCE_ONLY','APPROXIMATE_CARD_GEOMETRY','STORE_ITEM_SCOPE_UNVERIFIED',...(!r.item_period?['ITEM_PERIOD_UNKNOWN']:[])],
    verification_state:'needs_review',recommendation_eligible:false,verified_price:false,
    vision_evidence:{reading_ids:ids,source_image_sha256:pages[index].sha256,pixel_bbox:r.pixel_bbox,
     intersecting_tiles:manifest.tiles.filter(t=>t.face===face&&intersection(t.pixel_bbox,r.pixel_bbox)>0).map(t=>t.id),numeric_crosscheck:numericEvidence(r,ocrPages[index])}};
  }),unresolved_regions:(readings.unresolved_regions??[]).filter(r=>r.face===face).map(r=>{demand(box(r.pixel_bbox,w,h),'UNRESOLVED_BOX');return {bbox:normalized(r.pixel_bbox,w,h),reason:r.reason};})}));
 return {schema:'supermarket-whole-corpus-v2',source_kind:'image',store:'iy',issue_id:'iy-00521-'+edition.source.match(/\/(\d+)$/)?.[1],source_document:edition.source,
  source_revision:sha(JSON.stringify(pages.map(p=>({ordinal:p.ordinal,source:p.source,sha256:p.sha256})))),analysis_revision:sha(implementation+inputRevision),
  obtained_at:edition.observed_at,physical_pdf_pages:null,logical_faces:2,document_from:edition.from_day,document_until:edition.until_day,
  coverage:{state:'partial',expected_views:manifest.tiles.length,observed_views:readings.examined_tiles.length,missing_view_count:0,observed_dates:[]},
  completeness_scope:'All planned image regions attempted with interactive built-in vision. Structured printed-name/spec/unit offers, not OCR text candidates. Approximate positions and reference prices; unknown product denominator/recall. Not scheduled extraction.',
  source_notes:readings.source_notes??[],pages:resultPages};
}
export async function persistVisionReadings(sourceDb,manifestFile,readingsFile,ocrDir,outdir){
 const mb=await readFile(manifestFile),rb=await readFile(readingsFile),manifest=JSON.parse(mb),readings=JSON.parse(rb);
 const src=new DatabaseSync(sourceDb,{readOnly:true});let edition,pages;
 try{const all=src.prepare('SELECT * FROM flyer_discovered_editions WHERE store=? AND source=?').all('iy',manifest.source_document);demand(all.length===1,'EDITION_SCOPE');edition=all[0];
  pages=src.prepare('SELECT ordinal,source,sha256,state FROM flyer_discovered_pages WHERE edition_id=? ORDER BY ordinal').all(edition.edition_id);
 }finally{src.close();}
 const inputs=await Promise.all([1,2].map(n=>readFile(join(ocrDir,'p'+n+'.json.gz'))));
 const packet=visionPacket({manifest,readings,edition,pages,ocrPages:inputs.map(b=>JSON.parse(gunzipSync(b,{maxOutputLength:32*1024*1024}))),manifestHash:sha(mb),inputRevision:sha(rb)+inputs.map(sha).join('|')});
 await mkdir(outdir,{recursive:false});const db=new DatabaseSync(join(outdir,'products.sqlite'));let receipt,catalog;
 try{receipt=ingestCorpus(db,packet);const stored=readCorpus(db,receipt.corpus_id);demand(stored.listings.length===receipt.inserted&&JSON.stringify(stored.packet)===JSON.stringify(packet),'READBACK');catalog=corpusCatalog(db,{date:edition.from_day});}finally{db.close();}
 const rows=packet.pages.flatMap(p=>p.items),summary={corpus_id:receipt.corpus_id,source_revision:packet.source_revision,analysis_revision:packet.analysis_revision,
  source:edition.source,execution:'interactive_codex_vision',vision_image_tool_calls:readings.vision_image_tool_calls,distinct_images_seen:readings.distinct_images_seen,
  examined_regions:manifest.tiles.length,input_region_coverage:1,raw_reading_rows:readings.rows.length,stored_offer_rows:rows.length,
  removed_position_duplicates:readings.rows.length-rows.length,named_product_groups:new Set(rows.map(r=>norm(r.name))).size,
  by_face:packet.pages.map(p=>({face:p.face,offer_rows:p.items.length,reference_prices:p.items.filter(i=>i.prices.length).length,unknown_price:p.items.filter(i=>!i.prices.length).length,
   numeric_net_and_tax_present:p.items.filter(i=>i.vision_evidence.numeric_crosscheck.net_seen_passes.length&&i.vision_evidence.numeric_crosscheck.tax_seen_passes.length).length,
   explicit_item_period:p.items.filter(i=>i.valid_from||i.valid_until).length})),
  nonfood_offer_rows:rows.filter(r=>r.product_type==='nonfood').length,confirmed_prices:0,source_notes:packet.source_notes.length,known_unresolved_regions:packet.pages.reduce((n,p)=>n+p.unresolved_regions.length,0),
  product_denominator:null,product_recall:null,sqlite_readback_verified:true,catalog_rows:catalog.pages.reduce((n,p)=>n+p.items.length,0),paid_api_calls:0,source_requests:0,production_writes:0};
 await writeFile(join(outdir,'packet.json'),JSON.stringify(packet,null,2),{flag:'wx'});await writeFile(join(outdir,'catalog.json'),JSON.stringify(catalog,null,2),{flag:'wx'});await writeFile(join(outdir,'summary.json'),JSON.stringify(summary,null,2),{flag:'wx'});return summary;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){demand(process.argv.length===7,'USAGE_SOURCE_DB_MANIFEST_READINGS_OCR_DIR_NEW_OUTDIR');console.log(JSON.stringify(await persistVisionReadings(...process.argv.slice(2)),null,2));}

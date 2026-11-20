// Typed whole-flyer observations. No recommendation or publication side effect.
import {createHash} from 'node:crypto';
const sha=s=>createHash('sha256').update(s).digest('hex');
const demand=(v,code)=>{if(!v)throw Error(code);};
const day=s=>typeof s==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const roles=new Set(['member_cash','nonmember_or_card','general','reference_basis','discount_rate','reservation','addon','example','unknown']);
const states=new Set(['priced','discount_only','not_printed','unreadable','ambiguous','example_only']);
const text=(s,max)=>s===null||typeof s==='string'&&s.length<=max;
const box=b=>Array.isArray(b)&&b.length===4&&b.every(n=>Number.isInteger(n)&&n>=0&&n<=1000)&&b[0]<b[2]&&b[1]<b[3];
const strings=(v,max=100,n=3000)=>Array.isArray(v)&&v.length<=max&&v.every(s=>typeof s==='string'&&s.length<=n&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(s));
const pick=(o,keys)=>Object.fromEntries(keys.filter(k=>Object.hasOwn(o,k)).map(k=>[k,o[k]]));
const pdf=s=>typeof s==='string'&&/^https:\/\/ok-corporation\.jp\/media-download\/\d+\/[a-f0-9]+\/PDF\/$/.test(s);
export function documentSource(store,s){
 if(typeof s!=='string')return false;
 if(store==='ok')return pdf(s);
 if(store==='rosen')return /^https:\/\/rosen\.mikke-sales\.com\/stores\/taira\/flyers\/\d+\/?$/.test(s);
 if(store==='iy')return /^https:\/\/promo\.hatobase\.jp\/flyers\/00521\/\d+\/\d+\/?$/.test(s);
 if(store==='yaoko')return s==='https://yap-pd.yaoko-net.com/app/flyer/1221/';
 if(store==='life')return s==='https://store.lifecorp.jp/detail/east648/';
 if(store==='maruetsu')return s==='https://tokubai.co.jp/%E3%83%9E%E3%83%AB%E3%82%A8%E3%83%84/3541/leaflets/108663201/print';
 return false;
}
const image=s=>typeof s==='string'&&/^https:\/\/ok-corporation\.jp\/archives\/\d{3}\/20\d{4}\/[a-f0-9]+\.jpg$/.test(s);
const timestamp=s=>typeof s==='string'&&s.length<=40&&/^20\d{2}-.+(?:Z|[+-]\d{2}:\d{2})$/.test(s)&&Number.isFinite(Date.parse(s));
// Publication is a narrow projection of observations, never the raw model body.
export function catalogItem(item){
 const out=pick(item,['name','spec','variants','product_type','price_state','valid_from','valid_until','validity_raw_text','conditions','bbox','confidence','review_reasons','observed_dates']);
 out.prices=item.prices.map(p=>pick(p,['role','net_yen','tax_included_yen','discount_percent','raw_text','unit_text','payment_condition','other_conditions','bbox','confidence','review_reasons']));
 return {...out,verification_state:'needs_review',geometry_verification:'unverified_model_bbox',store_condition_link_verification:'unverified'};
}
export function openCorpusTables(db){
 db.exec(`CREATE TABLE IF NOT EXISTS flyer_corpus_runs (
   corpus_id TEXT PRIMARY KEY, issue_id TEXT NOT NULL, store TEXT NOT NULL, source_revision TEXT NOT NULL,
   analysis_revision TEXT NOT NULL, obtained_at TEXT NOT NULL, evidence_json TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS flyer_corpus_listings (
   corpus_id TEXT NOT NULL REFERENCES flyer_corpus_runs(corpus_id),face TEXT NOT NULL,ordinal INTEGER NOT NULL,
   name TEXT,product_type TEXT NOT NULL,price_state TEXT NOT NULL,verification_state TEXT NOT NULL,
   observation_json TEXT NOT NULL,PRIMARY KEY(corpus_id,face,ordinal));`);
}
export function validateObservation(page,{dom=false,modern=false,imageReference=false}={}){
 const region=b=>(dom||imageReference)&&b===null||box(b);
 demand((modern?/^[a-z0-9-]{1,80}$/.test(page.face):['front','back'].includes(page.face))&&Array.isArray(page.items)&&page.items.length<=1000,'CORPUS_PAGE_SCOPE');
 demand(Array.isArray(page.examined_tiles)&&page.examined_tiles.every(s=>typeof s==='string'&&s.length<80),'CORPUS_TILES');
 for(const item of page.items){
  demand(text(item.name,500)&&text(item.spec,2000)&&region(item.bbox)&&states.has(item.price_state),'CORPUS_ITEM_FIELDS');
  demand(['food','nonfood','service','promotion','other','unknown'].includes(item.product_type),'CORPUS_PRODUCT_TYPE');
  demand(Array.isArray(item.variants)&&item.variants.length<=100&&item.variants.every(s=>typeof s==='string'&&s.length<=500),'CORPUS_VARIANTS');
  demand(Array.isArray(item.prices)&&item.prices.length<=100,'CORPUS_QUOTES');
  demand(item.observed_dates===undefined||Array.isArray(item.observed_dates)&&item.observed_dates.length<=62&&item.observed_dates.every(day),'CORPUS_OBSERVED_DATES');
  demand(item.conditions===undefined||strings(item.conditions),'CORPUS_CONDITIONS');
  demand(item.review_reasons===undefined||strings(item.review_reasons),'CORPUS_REASONS');
  demand(text(item.validity_raw_text??null,3000)&&text(item.confidence??null,40),'CORPUS_LABELS');
  demand(item.valid_from===null||day(item.valid_from),'CORPUS_FROM_DAY');demand(item.valid_until===null||day(item.valid_until),'CORPUS_UNTIL_DAY');
  for(const price of item.prices){
   demand(roles.has(price.role)&&text(price.raw_text,3000)&&text(price.unit_text,500)&&region(price.bbox),'CORPUS_PRICE_FIELDS');
   demand(text(price.payment_condition??null,1000)&&(price.other_conditions===undefined||strings(price.other_conditions))&&(price.review_reasons===undefined||strings(price.review_reasons))&&text(price.confidence??null,40),'CORPUS_PRICE_LABELS');
   for(const key of ['net_yen','tax_included_yen','discount_percent'])demand(price[key]===null||typeof price[key]==='number'&&Number.isFinite(price[key])&&price[key]>=0&&price[key]<=10000000,'CORPUS_NUMBER');
  }
 }
 return page;
}
export function ingestCorpus(db,packet){
 const dom=packet.schema==='supermarket-whole-corpus-v2'&&packet.source_kind==='dom'&&packet.store==='rosen';
 const modern=packet.schema==='supermarket-whole-corpus-v2';
 const imageReference=modern&&packet.source_kind==='image'&&(
  packet.store==='iy'&&/^iy-00521-\d+$/.test(packet.issue_id)&&typeof packet.source_document==='string'&&packet.issue_id==='iy-00521-'+packet.source_document.match(/\/flyers\/00521\/\d+\/(\d+)\/?$/)?.[1]||
  packet.store==='yaoko'&&/^yaoko-1221-\d{8}$/.test(packet.issue_id)||
  packet.store==='life'&&/^life-224224-\d{8}$/.test(packet.issue_id)||
  packet.store==='maruetsu'&&packet.issue_id==='maruetsu-3541-20261117');
 demand((dom||imageReference||packet.schema==='supermarket-whole-corpus-v1'&&packet.store==='ok')&&/^[a-z0-9-]{1,100}$/.test(packet.issue_id),'CORPUS_SCOPE');
 demand(/^[a-f0-9]{64}$/.test(packet.source_revision)&&/^[a-f0-9]{64}$/.test(packet.analysis_revision),'CORPUS_REVISION');
 demand(text(packet.obtained_at_precision??null,1000)&&text(packet.completeness_scope??null,6000),'CORPUS_SOURCE_LABELS');
 demand(timestamp(packet.obtained_at)&&documentSource(packet.store,packet.source_document)&&(dom?packet.physical_pdf_pages===null&&packet.logical_faces===null:imageReference?packet.physical_pdf_pages===null&&[1,2].includes(packet.logical_faces):packet.physical_pdf_pages===1&&packet.logical_faces===2),'CORPUS_PROVENANCE');
 demand(Array.isArray(packet.pages)&&(modern?packet.pages.length>=1&&packet.pages.length<=64:packet.pages.length===2)&&new Set(packet.pages.map(p=>p.face)).size===packet.pages.length,'CORPUS_FACES');
 if(imageReference)demand(packet.pages.length===packet.logical_faces&&packet.pages.every(p=>['front','back'].includes(p.face)),'CORPUS_IMAGE_FACES');
 if(imageReference){
  demand((packet.document_from==null||day(packet.document_from))&&(packet.document_until==null||day(packet.document_until))&&(!packet.document_from||!packet.document_until||packet.document_from<=packet.document_until),'CORPUS_DOCUMENT_PERIOD');
 }
 if(dom){demand(Number.isInteger(packet.logical_views)&&packet.logical_views>=packet.pages.length&&packet.logical_views<=512,'CORPUS_DOM_VIEWS');demand(day(packet.document_from)&&day(packet.document_until)&&packet.document_from<=packet.document_until,'CORPUS_DOCUMENT_PERIOD');}
 for(const p of packet.pages){validateObservation(p,{dom,modern,imageReference});if(dom)demand(text(p.label,160)&&(p.selected_day===null||day(p.selected_day)),'CORPUS_DOM_PAGE');}
 for(const p of packet.pages){
  demand(text(p.document_period_raw??null,3000),'CORPUS_PERIOD');
  demand(p.global_conditions===undefined||Array.isArray(p.global_conditions)&&p.global_conditions.length<=100&&p.global_conditions.every(c=>text(c.text,3000)&&text(c.scope,3000)&&((dom||imageReference)&&c.bbox===null||box(c.bbox))&&text(c.confidence??null,40)),'CORPUS_GLOBAL_CONDITIONS');
  demand(p.unresolved_regions===undefined||Array.isArray(p.unresolved_regions)&&p.unresolved_regions.length<=1000&&p.unresolved_regions.every(c=>((dom||imageReference)&&c.bbox===null||box(c.bbox))&&text(c.reason,3000)),'CORPUS_UNRESOLVED');
 }
 const faceAllowed=face=>modern?typeof face==='string'&&packet.pages.some(p=>p.face===face):['front','back'].includes(face);
 demand(packet.source_notes===undefined||Array.isArray(packet.source_notes)&&packet.source_notes.length<=200&&packet.source_notes.every(n=>faceAllowed(n.face)&&text(n.kind,40)&&text(n.raw_text,6000)),'CORPUS_SOURCE_NOTES');
 demand(packet.unresolved_source_notes===undefined||Array.isArray(packet.unresolved_source_notes)&&packet.unresolved_source_notes.length<=200&&packet.unresolved_source_notes.every(n=>faceAllowed(n.face)&&text(n.reason,3000)),'CORPUS_UNRESOLVED_NOTES');
 const evidence=JSON.stringify(packet);demand(Buffer.byteLength(evidence)<=4*1024*1024,'CORPUS_SIZE');
 const id=sha(packet.issue_id+'|'+packet.source_revision+'|'+packet.analysis_revision);openCorpusTables(db);
 const old=db.prepare('SELECT evidence_json FROM flyer_corpus_runs WHERE corpus_id=?').get(id);
 if(old){demand(old.evidence_json===evidence,'CORPUS_IMMUTABLE_COLLISION');return {corpus_id:id,disposition:'unchanged',inserted:0};}
 let inserted=0;db.exec('BEGIN IMMEDIATE');
 try{
  db.prepare('INSERT INTO flyer_corpus_runs VALUES (?,?,?,?,?,?,?)').run(id,packet.issue_id,packet.store,packet.source_revision,packet.analysis_revision,packet.obtained_at,evidence);
  const add=db.prepare('INSERT INTO flyer_corpus_listings VALUES (?,?,?,?,?,?,?,?)');
  for(const page of packet.pages)for(const [index,item] of page.items.entries()){
   // Model confidence never authorizes a price for display or recommendation.
   add.run(id,page.face,index+1,item.name,item.product_type,item.price_state,'needs_review',JSON.stringify(item));inserted++;
  }db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
 return {corpus_id:id,disposition:'stored_for_verification',inserted};
}
export function readCorpus(db,id){
 const row=db.prepare('SELECT evidence_json FROM flyer_corpus_runs WHERE corpus_id=?').get(id);if(!row)return null;
 const packet=JSON.parse(row.evidence_json),listings=db.prepare('SELECT face,ordinal,verification_state,observation_json FROM flyer_corpus_listings WHERE corpus_id=? ORDER BY face,ordinal').all(id);
 return {packet,listings:listings.map(r=>({...r,observation:JSON.parse(r.observation_json)}))};
}
function singleCatalog(row){
 const packet=JSON.parse(row.evidence_json);
 // Source facts only: execution paths, model prompts and account metadata stay private.
 const dom=packet.source_kind==='dom';
 const projectedItem=item=>{const out=catalogItem(item);if(dom){delete out.geometry_verification;delete out.store_condition_link_verification;}return out;};
 return {schema:1,corpus_id:row.corpus_id,store:packet.store,issue_id:packet.issue_id,source_revision:packet.source_revision,
  analysis_revision:packet.analysis_revision,obtained_at:packet.obtained_at,source_document:packet.source_document,
  coverage:packet.coverage?pick(packet.coverage,['state','expected_views','observed_views','missing_view_count','observed_dates']):null,
  physical_pdf_pages:packet.physical_pdf_pages,logical_faces:packet.logical_faces,source_kind:packet.source_kind??'image',logical_views:packet.logical_views??packet.logical_faces,document_from:packet.document_from??null,document_until:packet.document_until??null,verification_state:'needs_review',
  ...(dom?{geometry_verification:'dom_region_unverified',store_condition_link_verification:'unverified'}:{}),
  display_counts:{total:packet.pages.reduce((n,p)=>n+p.items.length,0),shown:packet.pages.reduce((n,p)=>n+p.items.length,0),omitted:0},
  source_notes:(packet.source_notes??[]).map(n=>({face:n.face,kind:n.kind,raw_text:n.raw_text,verification_state:'needs_review',scope_status:'unverified'})),
  unresolved_source_notes:(packet.unresolved_source_notes??[]).map(n=>({face:n.face,reason:n.reason})),
  pages:packet.pages.map(page=>({face:page.face,label:page.label??null,selected_day:page.selected_day??null,document_period_raw:page.document_period_raw,
   global_conditions:(page.global_conditions??[]).map(c=>pick(c,['text','scope','bbox','confidence'])),
   items:page.items.map(projectedItem),unresolved_regions:(page.unresolved_regions??[]).map(c=>pick(c,['bbox','reason']))}))};
}
export function corpusCatalog(db,{date=null}={}){
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='flyer_corpus_runs'").get())return null;
 const rows=db.prepare(`SELECT corpus_id,evidence_json FROM (
   SELECT corpus_id,evidence_json,ROW_NUMBER() OVER(PARTITION BY store,issue_id ORDER BY CASE WHEN store='rosen' AND (json_extract(evidence_json,'$.coverage.state')='partial' OR json_extract(evidence_json,'$.acquisition.partial_reason') IS NOT NULL) THEN 1 ELSE 0 END,julianday(obtained_at) DESC,julianday(COALESCE(json_extract(evidence_json,'$.analyzed_at'),obtained_at)) DESC,corpus_id DESC) AS rank
   FROM flyer_corpus_runs) WHERE rank=1`).all();
 if(!rows.length)return null;
 let okSeen=false;
 const catalogs=rows.sort((a,b)=>Date.parse(JSON.parse(b.evidence_json).obtained_at)-Date.parse(JSON.parse(a.evidence_json).obtained_at))
  .filter(r=>{const p=JSON.parse(r.evidence_json);if(date&&p.document_until&&p.document_until<date)return false;
   // OK's official index has one current Kanto issue. Older observations remain
   // immutable privately; offline reanalysis never refreshes acquisition time.
   if(p.store==='ok'){if(okSeen)return false;okSeen=true;}return true;})
  .map(singleCatalog).sort((a,b)=>a.store.localeCompare(b.store)||a.issue_id.localeCompare(b.issue_id));
 if(!catalogs.length)return null;
 return catalogs.length===1&&catalogs[0].source_kind==='image'?catalogs[0]:{schema:2,verification_state:'needs_review',catalogs};
}

// Registration/reuse of already-read references. No worker, model or fetch path.
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {ingestCorpus,readCorpus} from './whole-corpus-store.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const demand=(v,c)=>{if(!v)throw Error('REFERENCE_'+c);};
const day=x=>typeof x==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
export function referenceBinding(discovery){
 const e=discovery?.edition,pages=discovery?.pages;
 demand(e?.store==='iy'&&/^https:\/\/promo\.hatobase\.jp\/flyers\/00521\/\d+\/\d+$/.test(e.source??'')&&day(e.from_day)&&day(e.until_day)&&e.from_day<=e.until_day&&typeof e.observed_at==='string'&&Number.isFinite(Date.parse(e.observed_at)),'SOURCE');
 demand(Array.isArray(pages)&&pages.length===2&&pages.every((p,i)=>p.ordinal===i+1&&p.state==='saved'&&/^[a-f0-9]{64}$/.test(p.sha256??'')&&/^https:\/\/content\.hatobase\.jp\/flyer_details\/\d+\/[^/?#]+\.(?:jpg|jpeg|png)(?:\.progressive\.jpeg)?$/.test(p.source??'')),'PAGES');
 // Same page-digest formula as existing visionPacket; no observation clock.
 const source_revision=hash(JSON.stringify(pages.map(p=>({ordinal:p.ordinal,source:p.source,sha256:p.sha256}))));
 const issue_id='iy-00521-'+e.source.match(/\/(\d+)$/)[1];
 return {key:hash('iy|'+issue_id+'|'+source_revision),store:'iy',issue_id,source_document:e.source,source_revision,document_from:e.from_day,document_until:e.until_day,obtained_at:e.observed_at};
}
function verifyPacket(packet,binding){
 for(const k of ['store','issue_id','source_document','source_revision','document_from','document_until','obtained_at'])demand(packet[k]===binding[k],'BINDING');
 demand(packet.schema==='supermarket-whole-corpus-v2'&&packet.source_kind==='image'&&packet.logical_faces===2&&Array.isArray(packet.pages)&&packet.pages.length===2&&packet.pages.every(p=>p.items.every(i=>i.verification_state==='needs_review'&&i.verified_price===false&&i.recommendation_eligible===false)),'REFERENCE_ONLY');
 const test=new DatabaseSync(':memory:');try{ingestCorpus(test,packet);}finally{test.close();}
}
function tables(db){db.exec(`CREATE TABLE IF NOT EXISTS flyer_reference_registry(
 reference_key TEXT PRIMARY KEY,binding_json TEXT NOT NULL,packet_sha256 TEXT NOT NULL,packet_json TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS flyer_reference_receipts(
 reference_key TEXT PRIMARY KEY,corpus_id TEXT NOT NULL,packet_sha256 TEXT NOT NULL);`);}
function checked(row,binding){
 demand(row.binding_json===JSON.stringify(binding)&&hash(row.packet_json)===row.packet_sha256,'REGISTRY_DRIFT');
 const packet=JSON.parse(row.packet_json);verifyPacket(packet,binding);return packet;
}
function canonicalReadback(db,id,packet){
 const result=readCorpus(db,id),expected=packet.pages.flatMap(p=>p.items.map((item,n)=>({face:p.face,ordinal:n+1,item}))).sort((a,b)=>a.face.localeCompare(b.face)||a.ordinal-b.ordinal);
 demand(result&&JSON.stringify(result.packet)===JSON.stringify(packet)&&result.listings.length===expected.length&&result.listings.every((r,n)=>r.face===expected[n].face&&r.ordinal===expected[n].ordinal&&r.verification_state==='needs_review'&&JSON.stringify(r.observation)===JSON.stringify(expected[n].item)),'READBACK');
}
export function registerReferenceArtifact(db,packet,{sourceDb=db}={}){
 const editions=sourceDb.prepare("SELECT * FROM flyer_discovered_editions WHERE store='iy' AND source=?").all(packet.source_document);
 demand(editions.length===1,'EDITION');
 const pages=sourceDb.prepare('SELECT ordinal,source,state,sha256 FROM flyer_discovered_pages WHERE edition_id=? ORDER BY ordinal').all(editions[0].edition_id);
 const binding=referenceBinding({edition:editions[0],pages});verifyPacket(packet,binding);
 const serialized=JSON.stringify(packet),digest=hash(serialized);tables(db);db.exec('BEGIN IMMEDIATE');
 let added=0;
 try{
  const old=db.prepare('SELECT * FROM flyer_reference_registry WHERE reference_key=?').get(binding.key);
  if(old){checked(old,binding);demand(old.packet_json===serialized&&old.packet_sha256===digest,'IMMUTABLE_CONFLICT');}
  else{db.prepare('INSERT INTO flyer_reference_registry VALUES(?,?,?,?)').run(binding.key,JSON.stringify(binding),digest,serialized);added=1;}
  const saved=db.prepare('SELECT * FROM flyer_reference_registry WHERE reference_key=?').get(binding.key);checked(saved,binding);demand(saved.packet_json===serialized,'REGISTRATION_READBACK');db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
 return {state:added?'registered':'unchanged',reference_key:binding.key,registered:added,model_calls:0};
}
export function applyRegisteredReference(db,discovery,date,{enabled=false}={}){
 if(enabled!==true)return {state:'disabled',inserted:0,model_calls:0};
 const binding=referenceBinding(discovery);demand(day(date),'DAY');
 if(date<binding.document_from||date>binding.document_until)return {state:'outside_edition',inserted:0,model_calls:0};
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='flyer_reference_registry' AND type='table'").get())return {state:'not_registered',inserted:0,model_calls:0};
 const row=db.prepare('SELECT * FROM flyer_reference_registry WHERE reference_key=?').get(binding.key);
 if(!row)return {state:'not_registered',inserted:0,model_calls:0};
 const packet=checked(row,binding),prior=db.prepare('SELECT * FROM flyer_reference_receipts WHERE reference_key=?').get(binding.key);
 if(prior){demand(prior.packet_sha256===row.packet_sha256,'RECEIPT_DRIFT');canonicalReadback(db,prior.corpus_id,packet);return {state:'unchanged',inserted:0,model_calls:0};}
 const imported=ingestCorpus(db,packet);canonicalReadback(db,imported.corpus_id,packet);
 db.prepare('INSERT OR IGNORE INTO flyer_reference_receipts VALUES(?,?,?)').run(binding.key,imported.corpus_id,row.packet_sha256);
 const receipt=db.prepare('SELECT * FROM flyer_reference_receipts WHERE reference_key=?').get(binding.key);
 demand(receipt.corpus_id===imported.corpus_id&&receipt.packet_sha256===row.packet_sha256,'RECEIPT_DRIFT');
 return {state:imported.inserted?'applied_reference':'unchanged',inserted:imported.inserted,model_calls:0};
}

import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFile, stat, rename, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import {corpusCatalog,ingestCorpus} from './whole-corpus-store.mjs';
import {readRosen,ROSEN_STORE,isCompleteRosenPacket} from './rosen-dom.mjs';
import {rosenPolicy} from './rosen-policy.mjs';
import {collectCurrentEdition,OFFICIAL} from './edition-discovery.mjs';
import {applyRegisteredReference} from './reference-registry.mjs';
import { identifyIyEdition, IY_SOURCE, IY_IMAGE } from './iy-ocr.mjs';
import { identifyYaokoEdition, YAOKO_SOURCE, YAOKO_STORE, YAOKO_IMAGE } from './yaoko-ocr.mjs';
import {TOKUBAI_EDITIONS,TOKUBAI_ROBOTS,verifyTokubaiRobots,identifyTokubaiEdition} from './tokubai-ocr.mjs';
import poc from '../../features/shopping/supermarket-poc.js';

export const INDEX = 'https://ok-corporation.jp/flyer/';
const ROBOTS = 'https://ok-corporation.jp/robots.txt';
const USER_AGENT = 'PALURU-Supermarket-PoC/1.0';
const LIMIT = 256 * 1024;
const STORE = 'ok';
const HELD = Object.freeze({
  iy:['https://promo.hatobase.jp/flyers/00521/new','PUBLISHER_NOFOLLOW_MANUAL_ONLY'],
  maruetsu:['https://www.maruetsu.co.jp/store/9245/','TOKUBAI_AUTOMATED_USE_NOT_CONFIRMED'],
  life:['https://store.lifecorp.jp/detail/east648/','TOKUBAI_AUTOMATED_USE_NOT_CONFIRMED'],
  rosen:['https://www.sotetsu.rosen.co.jp/shopdetail?scode=0032','TARGET_ACCESS_DENIED'],
  yaoko:['https://yap-pd.yaoko-net.com/app/flyer/1221/','JAVASCRIPT_VIEWER_APPROVAL_UNVERIFIED'],
});
const MAX_IMAGE = 8 * 1024 * 1024;
const IY_ROBOTS='https://promo.hatobase.jp/robots.txt';
const IY_CONTENT_ROBOTS='https://content.hatobase.jp/robots.txt';
const YAOKO_ROBOTS='https://www.yaoko-net.com/robots.txt';
const YAOKO_IMAGE_ROBOTS='https://yap-pd.yaoko-net.com/robots.txt';
const IMAGE_URL = /^https:\/\/ok-corporation\.jp\/archives\/\d{3}\/20\d{4}\/[a-f0-9]+\.jpg$/;
const sha = data => createHash('sha256').update(data).digest('hex');
const publisherPdf = s => /^https:\/\/ok-corporation\.jp\/media-download\/\d+\/[a-f0-9]+\/PDF\/$/.test(s);
const jsonLimit = async (p, max) => {
  if ((await stat(p)).size > max) throw new Error('INPUT_TOO_LARGE');
  return JSON.parse(await readFile(p, 'utf8'));
};

export function openDb(filename) {
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA busy_timeout=2000;
    CREATE TABLE IF NOT EXISTS status (store TEXT PRIMARY KEY, day TEXT NOT NULL, state TEXT NOT NULL,
      source TEXT, evidence_id TEXT, error TEXT);
    CREATE TABLE IF NOT EXISTS editions (evidence_id TEXT PRIMARY KEY, store TEXT NOT NULL, source TEXT NOT NULL,
      from_day TEXT NOT NULL, until_day TEXT NOT NULL, obtained_at TEXT NOT NULL, offers TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS ocr_evidence (evidence_id TEXT PRIMARY KEY REFERENCES editions(evidence_id),
      image_source TEXT NOT NULL, image_sha256 TEXT NOT NULL, parser TEXT NOT NULL);`);
  return db;
}

export function identifyEdition(html) {
  const match = html.match(/【関東】商品情報紙(\d{1,2})月(\d{1,2})日号[^<]*<\/h3>([\s\S]*?)(?=<h3\b|$)/i);
  const pdf = match?.[3].match(/href="(https:\/\/ok-corporation\.jp\/media-download\/\d+\/[a-f0-9]+\/PDF\/)"/i)?.[1];
  // Fail closed if the current known distribution note changes.
  if (!pdf || !publisherPdf(pdf) || !/※清瀬店は除きます。/.test(match[3])) throw new Error('INDEX_FORMAT_OR_SCOPE_CHANGED');
  const front = Array.from(match[3].matchAll(/<img\b[^>]*>/gi)).map(m => m[0])
    .filter(tag => /alt="【関東】オーケー商品情報 表"/.test(tag));
  const image = front.length === 1 ? front[0].match(/data-src="([^"]+)"/)?.[1] : undefined;
  const pages=Array.from(match[3].matchAll(/<img\b[^>]*>/gi)).map(m=>m[0]).flatMap(tag=>{
    const face=tag.match(/alt="【関東】オーケー商品情報 (表|裏)"/)?.[1],url=tag.match(/data-src="([^"]+)"/)?.[1];
    return face&&url&&IMAGE_URL.test(url)?[{face:face==='表'?'front':'back',source:url}]:[];
  });
  if(new Set(pages.map(p=>p.face)).size!==pages.length)throw Error('INDEX_FORMAT_OR_SCOPE_CHANGED');
  return {source:pdf,id:sha(pdf),image:image && IMAGE_URL.test(image) ? image : null,pages,month:+match[1],startDay:+match[2]};
}

async function get(url, fetcher) {
  let result = await fetcher(url, {
    method:'GET', redirect:url===TOKUBAI_ROBOTS[1]?'manual':'error', signal:AbortSignal.timeout(12000),
    headers:{'User-Agent': USER_AGENT, 'Accept':'text/html, text/plain;q=0.9'}
  });
  // The image host explicitly delegates REP to the publisher. Permit only
  // this independently observed 302, never redirects from print/assets or a
  // denial, and never a second hop. Changed destinations require review.
  if(url===TOKUBAI_ROBOTS[1]&&result.status===302&&result.headers.get('location')===TOKUBAI_ROBOTS[0]) {
    if(result.body)await result.body.cancel();
    result=await fetcher(TOKUBAI_ROBOTS[0],{method:'GET',redirect:'error',signal:AbortSignal.timeout(12000),
      headers:{'User-Agent':USER_AGENT,'Accept':'text/html, text/plain;q=0.9'}});
  }
  if ([ROBOTS,IY_ROBOTS,IY_CONTENT_ROBOTS,YAOKO_ROBOTS,YAOKO_IMAGE_ROBOTS].includes(url) && [404,410].includes(result.status)) {
    if (result.body) await result.body.cancel();
    return '';
  }
  if (!result.ok) {
    if (result.body) await result.body.cancel();
    throw new Error('HTTP_' + result.status);
  }
  if (!/^text\/(html|plain)(?:[;\s]|$)/i.test(result.headers.get('content-type') || '')) {
    if (result.body) await result.body.cancel();
    throw new Error('CONTENT_TYPE');
  }
  let bytes = 0; const chunks = [];
  for await (const block of result.body) {
    bytes += block.length;
    if (bytes > LIMIT) throw new Error('BODY_LIMIT');
    chunks.push(Buffer.from(block));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function getImage(url, fetcher) {
  if (!IMAGE_URL.test(url) && url!==IY_IMAGE && url!==YAOKO_IMAGE &&
      !Object.values(TOKUBAI_EDITIONS).some(c=>c.image===url)) throw new Error('OCR_SOURCE_MISSING');
  const r = await fetcher(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(18000),
    headers:{'User-Agent':USER_AGENT,'Accept':'image/jpeg'}});
  if (!r.ok || !/^image\/jpeg(?:[;\s]|$)/i.test(r.headers.get('content-type') || '')) {
    if (r.body) await r.body.cancel();
    throw new Error(r.ok ? 'CONTENT_TYPE' : 'HTTP_' + r.status);
  }
  const chunks = []; let count = 0;
  for await (const block of r.body) {
    count += block.length;
    if (count > MAX_IMAGE) throw new Error('BODY_LIMIT');
    chunks.push(Buffer.from(block));
  }
  const body = Buffer.concat(chunks);
  if (body.length < 4 || body[0] !== 255 || body[1] !== 216 || body[2] !== 255) throw new Error('OCR_IMAGE_INVALID');
  return body;
}

export async function collect(db, date, fetcher = fetch, {ocr, daily=false} = {}) {
  if (!realDay(date)) throw new Error('INVALID_RUN_DAY');
  const set = db.prepare('INSERT OR REPLACE INTO status VALUES (?, ?, ?, ?, ?, ?)');
  const previous = db.prepare('SELECT * FROM status WHERE store=?').get(STORE);
  if (daily && previous?.day >= date) return snapshot(db, date);
  for (const [store,[source,error]] of Object.entries(HELD)) set.run(store,date,'held',source,null,error);
  // Claim the run before network I/O; an interrupted attempt must not silently repeat or serve stale data.
  set.run(STORE,date,'failed',INDEX,null,'INCOMPLETE_RUN');
  let edition,stage = 'robots';
  try {
    const robots = await get(ROBOTS, fetcher);
    if (robots.trim()) throw new Error('ROBOTS_POLICY_REVIEW_REQUIRED');
    stage = 'index';
    edition = identifyEdition(await get(INDEX, fetcher));
    const loaded = db.prepare('SELECT from_day, until_day FROM editions WHERE evidence_id=?').get(edition.id);
    if (loaded) {
      const state = loaded.until_day < date ? 'expired' : loaded.from_day > date ? 'needs_review' :
        previous?.evidence_id === edition.id ? 'unchanged' : 'checked';
      set.run(STORE,date,state,edition.source,edition.id,null);
    } else if (!ocr) {
      // No fixed SKU crop is an adequate substitute for a whole-issue reader.
      set.run(STORE,date,'needs_review',edition.source,edition.id,'OCR_WHOLE_READER_NOT_CONNECTED');
    } else {
      stage = 'image';
      const bytes = await getImage(edition.image || '',fetcher);
      stage = 'ocr';
      const scanned = await ocr(bytes,edition);
      set.run(STORE,date,'needs_review',edition.source,edition.id,null);
      saveEdition(db,{store:STORE,source:edition.source,...scanned},'ocr_validated',
        {source:edition.image,hash:sha(bytes),parser:'ok-front-template-v1'});
    }
  } catch (error) {
    const code = /^(HTTP_\d{3}|CONTENT_TYPE|BODY_LIMIT|ROBOTS_POLICY_REVIEW_REQUIRED|INDEX_FORMAT_OR_SCOPE_CHANGED|OCR_[A-Z_]+)$/.test(error.message)
      ? error.message : error.name === 'TimeoutError' ? 'TIMEOUT' :
      error.code === 'ENOENT' ? 'OCR_DEPENDENCY_MISSING' : error.killed ? 'OCR_TIMEOUT' : 'REQUEST_OR_OCR_FAILED';
    const diagnostic = stage === 'robots' && !['HTTP_403','HTTP_429','ROBOTS_POLICY_REVIEW_REQUIRED'].includes(code)
      ? 'ROBOTS_' + code : code;
    set.run(STORE,date,'failed',edition?.source || INDEX,edition?.id || null,diagnostic);
  }
  return snapshot(db, date);
}

function realDay(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
}
function saveEdition(db, edition, confidence, evidence) {
  const store=edition?.store;
  const current = db.prepare('SELECT * FROM status WHERE store=?').get(store||'');
  const publisher=store===STORE ? publisherPdf(edition.source) :
    store==='iy' && edition.source===IY_SOURCE || store==='yaoko' && edition.source===YAOKO_SOURCE ||
    Object.hasOwn(TOKUBAI_EDITIONS,store) && edition.source===TOKUBAI_EDITIONS[store].source;
  if (!publisher || !current?.source || current.source !== edition.source ||
      !realDay(edition.from) || !realDay(edition.until) || edition.from > edition.until ||
      (!evidence && (edition.from > current.day || edition.until < current.day)) ||
      (Date.parse(edition.until) - Date.parse(edition.from)) / 86400000 > 14 ||
      !Array.isArray(edition.offers) || !edition.offers.length || edition.offers.length > 50) throw new Error('INVALID_EDITION');
  for (const o of edition.offers) {
    if (![o.title,o.spec,o.unit,o.conditions].every(v => typeof v === 'string' && v.trim() && v.length <= 160) ||
        !Number.isInteger(o.net_yen) || o.net_yen < 1 || o.net_yen > 100000 ||
        !Number.isInteger(o.tax_included_sen) || o.tax_included_sen < o.net_yen * 100 ||
        !['weekly_information','special'].includes(o.kind)) throw new Error('INVALID_OFFER');
  }
  if (new Set(edition.offers.map(o => o.title + '\0' + o.unit + '\0' + o.conditions)).size !== edition.offers.length) {
    throw new Error('DUPLICATE_OFFER');
  }
  const offers = edition.offers.map(({title,spec,unit,net_yen,tax_included_sen,conditions,kind}) =>
    ({title,spec,unit,net_yen,tax_included_sen,conditions,kind,confidence}));
  const normalized = JSON.stringify(offers);
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = db.prepare('SELECT * FROM editions WHERE evidence_id=?').get(current.evidence_id);
    if (existing && (existing.from_day !== edition.from || existing.until_day !== edition.until || existing.offers !== normalized)) {
      throw new Error('EDITION_CONFLICT');
    }
    if (!existing) {
      db.prepare('INSERT INTO editions VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(current.evidence_id, store, edition.source, edition.from, edition.until, new Date().toISOString(), normalized);
      if (evidence) db.prepare('INSERT INTO ocr_evidence VALUES (?, ?, ?, ?)')
        .run(current.evidence_id,evidence.source,evidence.hash,evidence.parser);
    }
    db.prepare("UPDATE status SET state=?, error=NULL WHERE store=? AND evidence_id=?")
      .run(edition.until < current.day ? 'expired' : edition.from > current.day ? 'needs_review' :
        existing ? 'unchanged' : 'checked', store, current.evidence_id);
    db.exec('COMMIT');
    return { duplicate: !!existing, offers: offers.length };
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

export function verifyImport(db,edition) {
  if (edition?.store!==STORE) throw new Error('INVALID_EDITION');
  return saveEdition(db,edition,'visually_verified');
}

export async function collectRosen(db,date,fetcher=fetch,{read=readRosen,onSourceRequest=()=>{}}={}){
 if(!realDay(date))throw Error('INVALID_RUN_DAY');
 const previous=db.prepare('SELECT * FROM status WHERE store=?').get('rosen');
 if(previous?.day===date&&previous.state!=='held')return snapshot(db,date);
 const set=db.prepare('INSERT OR REPLACE INTO status VALUES (?,?,?,?,?,?)');
 set.run('rosen',date,'failed',ROSEN_STORE,null,'INCOMPLETE_RUN');
 try{
  const knownIssues=new Map();
  if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='flyer_corpus_runs'").get()){
   for(const row of db.prepare("SELECT issue_id,evidence_json FROM flyer_corpus_runs WHERE store='rosen' ORDER BY julianday(obtained_at) DESC,julianday(COALESCE(json_extract(evidence_json,'$.analyzed_at'),obtained_at)) DESC,corpus_id DESC").all()){const packet=JSON.parse(row.evidence_json);if(!knownIssues.has(row.issue_id)&&isCompleteRosenPacket(packet))knownIssues.set(row.issue_id,packet);}
  }
  const policy=await rosenPolicy(db,{fetcher});
  // Settled partial views may become explicit reference catalogs. Only a
  // proven full matrix qualifies for knownIssues acquisition-cache reuse.
  db.exec('CREATE TABLE IF NOT EXISTS rosen_dom_views (observation_id TEXT PRIMARY KEY, issue_id TEXT NOT NULL, observed_at TEXT NOT NULL, evidence_json TEXT NOT NULL)');
  const result=await read(date,{knownIssues,policy,onSourceRequest,onPacket:packet=>ingestCorpus(db,packet),onView:part=>{
   const raw=JSON.stringify(part);db.prepare('INSERT OR IGNORE INTO rosen_dom_views VALUES(?,?,?,?)').run(sha(raw),part.issue_id,part.view.observed_at,raw);
  }});
  if(!Array.isArray(result.issues)||!result.issues.length)throw Error('ROSEN_NO_ACTIVE_ISSUE');
  set.run('rosen',date,'needs_review',ROSEN_STORE,null,null);
 }catch(error){set.run('rosen',date,'failed',ROSEN_STORE,null,/^(?:ROSEN|BROWSER)_[A-Z0-9_]+$/.test(error.message)?error.message:'ROSEN_READ_FAILED');}
 return snapshot(db,date);
}

// Explicitly separate from OK so enabling one store cannot re-fetch another.
// Its caller owns a durable once-a-day claim before this function can do I/O.
export async function collectIy(db,date,fetcher=fetch,{ocr,referenceArtifactsEnabled=false}={}) {
  if (!realDay(date)) throw new Error('INVALID_RUN_DAY');
  const previous=db.prepare('SELECT * FROM status WHERE store=?').get('iy');
  if(previous?.day===date && previous.state!=='held') return snapshot(db,date);
  const set=db.prepare('INSERT OR REPLACE INTO status VALUES (?, ?, ?, ?, ?, ?)');
  // This template is current-edition only. Never substitute its weekly paper
  // end date for the item's three-day limit, or assume it covers future papers.
  if(date<'2026-11-18'||date>'2026-11-20') {
    return collectDiscovered('iy',db,date,fetcher,{referenceArtifactsEnabled});
  }
  const evidenceId=sha(IY_IMAGE);
  set.run('iy',date,'failed',IY_SOURCE,evidenceId,'INCOMPLETE_RUN');
  try {
    const loaded=db.prepare('SELECT * FROM editions WHERE evidence_id=?').get(evidenceId);
    if(loaded) {
      set.run('iy',date,'unchanged',IY_SOURCE,evidenceId,null);
      return snapshot(db,date);
    }
    for(const url of [IY_ROBOTS,IY_CONTENT_ROBOTS]) {
      if((await get(url,fetcher)).trim()) throw new Error('ROBOTS_POLICY_REVIEW_REQUIRED');
    }
    const edition=identifyIyEdition(await get(IY_SOURCE,fetcher),date);
    if(!ocr) {set.run('iy',date,'needs_review',IY_SOURCE,evidenceId,'OCR_DEPENDENCY_MISSING');return snapshot(db,date);}
    const bytes=await getImage(edition.image,fetcher);
    const scanned=await ocr(bytes,edition);
    if(scanned.from!==edition.from||scanned.until!==edition.until) throw new Error('OCR_DATE_UNVERIFIED');
    saveEdition(db,{store:'iy',source:IY_SOURCE,...scanned},'ocr_validated',
      {source:IY_IMAGE,hash:sha(bytes),parser:'iy-00521-20261118-front-v1'});
  } catch(error) {
    const code=/^(HTTP_\d{3}|CONTENT_TYPE|BODY_LIMIT|ROBOTS_POLICY_REVIEW_REQUIRED|INDEX_FORMAT_OR_SCOPE_CHANGED|OCR_[A-Z_]+)$/.test(error.message)
      ?error.message:error.name==='TimeoutError'?'TIMEOUT':error.code==='ENOENT'?'OCR_DEPENDENCY_MISSING':'REQUEST_OR_OCR_FAILED';
    set.run('iy',date,'failed',IY_SOURCE,evidenceId,code);
  }
  return snapshot(db,date);
}

export function verifyYaokoRobots(official,viewer) {
  // Exact current publisher policy; changed rules require review rather than a
  // broad, incomplete REP implementation. No listed path covers this store.
  const expected='User-agent: *\nSitemap: https://www.yaoko-net.com/sitemap.xml\n'+
    'Disallow: /assets_c/\nDisallow: /inc/\nDisallow: /maintenance/\nDisallow: /includes_c/\nDisallow: /templates_c/';
  if(official.trim() && official.replace(/\r/g,'').trim()!==expected)throw new Error('ROBOTS_POLICY_REVIEW_REQUIRED');
  // This host returns its ordinary SPA shell at /robots.txt (200 HTML). It is
  // not an Allow directive. Accept only the independently observed fallback;
  // a real REP document, challenge or changed response requires review.
  if(viewer.trim() && (!/^\s*<!doctype html>/i.test(viewer)||!viewer.includes('<div id="app"></div>')||
      /(?:User-agent|Disallow|Allow)\s*:/i.test(viewer)))throw new Error('ROBOTS_POLICY_REVIEW_REQUIRED');
}
export async function collectYaoko(db,date,fetcher=fetch,{ocr}={}) {
  if(!realDay(date))throw new Error('INVALID_RUN_DAY');
  const previous=db.prepare('SELECT * FROM status WHERE store=?').get('yaoko');
  if(previous?.day===date && previous.state!=='held')return snapshot(db,date);
  const set=db.prepare('INSERT OR REPLACE INTO status VALUES (?, ?, ?, ?, ?, ?)');
  if(date!=='2026-11-20') {
    set.run('yaoko',date,'needs_review',YAOKO_SOURCE,null,'OCR_TEMPLATE_REVIEW_REQUIRED');return snapshot(db,date);
  }
  const evidenceId=sha(YAOKO_IMAGE);set.run('yaoko',date,'failed',YAOKO_SOURCE,evidenceId,'INCOMPLETE_RUN');
  try {
    if(db.prepare('SELECT 1 FROM editions WHERE evidence_id=?').get(evidenceId)) {
      set.run('yaoko',date,'unchanged',YAOKO_SOURCE,evidenceId,null);return snapshot(db,date);
    }
    verifyYaokoRobots(await get(YAOKO_ROBOTS,fetcher),await get(YAOKO_IMAGE_ROBOTS,fetcher));
    const edition=identifyYaokoEdition(await get(YAOKO_STORE,fetcher),date);
    if(!ocr){set.run('yaoko',date,'needs_review',YAOKO_SOURCE,evidenceId,'OCR_DEPENDENCY_MISSING');return snapshot(db,date);}
    const bytes=await getImage(YAOKO_IMAGE,fetcher);const scanned=await ocr(bytes,edition);
    if(scanned.from!==date||scanned.until!==date)throw new Error('OCR_DATE_UNVERIFIED');
    saveEdition(db,{store:'yaoko',source:YAOKO_SOURCE,...scanned},'ocr_validated',
      {source:YAOKO_IMAGE,hash:sha(bytes),parser:'yaoko-1221-20261120-chicken-v1'});
  }catch(error){
    const code=/^(HTTP_\d{3}|CONTENT_TYPE|BODY_LIMIT|ROBOTS_POLICY_REVIEW_REQUIRED|INDEX_FORMAT_OR_SCOPE_CHANGED|OCR_[A-Z_]+)$/.test(error.message)
      ?error.message:error.name==='TimeoutError'?'TIMEOUT':error.code==='ENOENT'?'OCR_DEPENDENCY_MISSING':'REQUEST_OR_OCR_FAILED';
    set.run('yaoko',date,'failed',YAOKO_SOURCE,evidenceId,code);
  }
  return snapshot(db,date);
}

export async function collectTokubai(id,db,date,fetcher=fetch,{ocr}={}) {
  const c=TOKUBAI_EDITIONS[id];if(!c)throw new Error('INVALID_STORE');
  if(!realDay(date))throw new Error('INVALID_RUN_DAY');
  const previous=db.prepare('SELECT * FROM status WHERE store=?').get(id);
  if(previous?.day===date&&previous.state!=='held')return snapshot(db,date);
  const set=db.prepare('INSERT OR REPLACE INTO status VALUES (?, ?, ?, ?, ?, ?)');
  if(date!=='2026-11-20') {
    if(id==='life')return collectDiscovered('life',db,date,fetcher);
    set.run(id,date,'needs_review',c.source,null,'OCR_TEMPLATE_REVIEW_REQUIRED');return snapshot(db,date);
  }
  const evidenceId=sha(c.image);set.run(id,date,'failed',c.source,evidenceId,'INCOMPLETE_RUN');
  try {
    if(db.prepare('SELECT 1 FROM editions WHERE evidence_id=?').get(evidenceId)) {
      set.run(id,date,'unchanged',c.source,evidenceId,null);return snapshot(db,date);
    }
    for(const url of TOKUBAI_ROBOTS)verifyTokubaiRobots(await get(url,fetcher));
    const edition=identifyTokubaiEdition(id,await get(c.source,fetcher),date);
    if(!ocr){set.run(id,date,'needs_review',c.source,evidenceId,'OCR_DEPENDENCY_MISSING');return snapshot(db,date);}
    const bytes=await getImage(c.image,fetcher),scanned=await ocr(bytes,edition);
    if(scanned.from!==date||scanned.until!==date)throw new Error('OCR_DATE_UNVERIFIED');
    saveEdition(db,{store:id,source:c.source,...scanned},'ocr_validated',
      {source:c.image,hash:sha(bytes),parser:c.parser});
  }catch(error){
    const code=/^(HTTP_\d{3}|CONTENT_TYPE|BODY_LIMIT|ROBOTS_POLICY_REVIEW_REQUIRED|INDEX_FORMAT_OR_SCOPE_CHANGED|OCR_[A-Z_]+)$/.test(error.message)
      ?error.message:error.name==='TimeoutError'?'TIMEOUT':error.code==='ENOENT'?'OCR_DEPENDENCY_MISSING':'REQUEST_OR_OCR_FAILED';
    set.run(id,date,'failed',c.source,evidenceId,code);
  }
  return snapshot(db,date);
}

// Private SQLite/log codes are separate from the shared API allowlist.
async function collectDiscovered(id,db,date,fetcher,{referenceArtifactsEnabled=false}={}){
  const discovery=await collectCurrentEdition(id,db,date,fetcher);
  const edition=discovery.edition_id?db.prepare('SELECT source FROM flyer_discovered_editions WHERE edition_id=?').get(discovery.edition_id):null;
  let error=discovery.error||'DISCOVERY_ANALYSIS_NOT_CONNECTED';
  if(id==='iy'&&referenceArtifactsEnabled===true&&discovery.phase!=='failed'){
    try{const applied=applyRegisteredReference(db,discovery,date,{enabled:true});error=['applied_reference','unchanged'].includes(applied.state)?null:'DISCOVERY_REFERENCE_NOT_REGISTERED';}
    catch(_){error='DISCOVERY_REFERENCE_REJECTED';}
  }
  db.prepare('INSERT OR REPLACE INTO status VALUES(?,?,?,?,?,?)').run(id,date,
    discovery.phase==='failed'?'failed':'needs_review',edition?.source||OFFICIAL[id],null,
    error);
  return snapshot(db,date);
}
export function portableResult(result) {
  const explicit = {
    PUBLISHER_NOFOLLOW_MANUAL_ONLY:'manual_only', AUTOMATED_USE_NOT_CONFIRMED:'manual_only', TOKUBAI_AUTOMATED_USE_NOT_CONFIRMED:'permission_unconfirmed',
    TARGET_ACCESS_DENIED:'http_denied', JAVASCRIPT_VIEWER_APPROVAL_UNVERIFIED:'permission_unconfirmed',
    HTTP_403:'http_denied', HTTP_401:'http_denied', HTTP_429:'rate_limited',
    ROBOTS_POLICY_REVIEW_REQUIRED:'permission_unconfirmed', REQUEST_FAILED:'network_error',
    REQUEST_OR_OCR_FAILED:'source_unavailable', TIMEOUT:'timeout', OCR_TIMEOUT:'timeout',
    INDEX_FORMAT_OR_SCOPE_CHANGED:'layout_changed', OCR_LAYOUT:'layout_changed',
    OCR_DEPENDENCY_MISSING:'not_configured', OCR_SOURCE_MISSING:'layout_changed',
    CONTENT_TYPE:'unsupported_format', BODY_LIMIT:'unsupported_format', NOT_ENABLED:'not_configured',
    INCOMPLETE_RUN:'source_unavailable', HTTP_404:'source_unavailable',
    DISCOVERY_ANALYSIS_NOT_CONNECTED:'not_configured',DISCOVERY_PRIOR_DENIAL:'http_denied',
    DISCOVERY_REFERENCE_NOT_REGISTERED:'not_configured',DISCOVERY_REFERENCE_REJECTED:'extract_unverified',
    DISCOVERY_ROBOTS_DISALLOW:'robots_disallow',DISCOVERY_ROBOTS_UNAVAILABLE:'robots_unreachable',
  };
  const reason = e => (Object.hasOwn(explicit,e) ? explicit[e] : null) || (e?.startsWith('ROBOTS_') ? 'robots_unreachable' :
    e?.startsWith('OCR_') ? 'extract_unverified' : e?.startsWith('HTTP_') ? 'http_error' : null);
  return {...result,sources:result.sources.map(o => ({...o,
    error:reason(o.error) || (o.state === 'failed' ? 'source_unavailable' : o.state === 'held' ? 'held' : null)
  }))};
}

export function snapshot(db, date) {
  const stateRows = db.prepare('SELECT * FROM status WHERE day=? ORDER BY store').all(date);
  const states = Object.fromEntries(stateRows.map(o => [o.store, o.state]));
  const sources = stateRows.map(({store,state,source,error}) => ({store,state,source,error}));
  const offers = db.prepare(`SELECT e.* FROM editions e JOIN status s USING(evidence_id)
    WHERE s.day=? AND s.state IN ('checked','unchanged') AND e.from_day<=? AND e.until_day>=?`).all(date,date,date)
    .flatMap(e => JSON.parse(e.offers).map(o => ({...o,store:e.store,source:e.source,from:e.from_day,until:e.until_day,obtained_at:e.obtained_at})));
  const corpus=corpusCatalog(db,{date});
  const base={schema:1,date,states,sources,offers};
  if(!corpus)return base;
  // ShoppingGcs has an existing 480KiB read cap. A large optional corpus must
  // never make existing confirmed offers/list metadata unreadable. Keep the
  // complete observations in SQLite; leave headroom for portable diagnostics.
  if(Buffer.byteLength(JSON.stringify({...base,corpus}))<=460*1024)return {...base,corpus};
  const catalogs=corpus.schema===2?corpus.catalogs:[corpus];
  // Preserve the already-readable OK and monthly Rosen 5170 issue in full.
  // Other issues receive whole observation rows in round-robin order. Nothing
  // is deleted from SQLite and no field/quote is moved across product or issue.
  const protectedIssue=c=>c.store==='ok'||c.store==='rosen'&&c.issue_id==='rosen-taira-5170';
  const protectedCatalogs=catalogs.filter(protectedIssue),optional=catalogs.filter(c=>!protectedIssue(c));
  const shown=[...protectedCatalogs,...optional.map(c=>({...c,display_counts:{total:c.pages.reduce((n,p)=>n+p.items.length,0),shown:0,omitted:c.pages.reduce((n,p)=>n+p.items.length,0)},pages:c.pages.map(p=>({...p,items:[]}))}))];
  const candidate=()=>({...base,corpus:{schema:2,verification_state:'needs_review',catalogs:shown},corpus_status:'partial',corpus_omitted_count:shown.filter(c=>!c.display_counts.shown&&c.display_counts.total).length});
  const fits=()=>Buffer.byteLength(JSON.stringify(candidate()))<=460*1024;
  if(fits()){
    const queues=optional.map(c=>{
      const queue=[];const length=Math.max(0,...c.pages.map(p=>p.items.length));
      for(let ordinal=0;ordinal<length;ordinal++)for(let pageIndex=0;pageIndex<c.pages.length;pageIndex++){
        const item=c.pages[pageIndex].items[ordinal];if(item)queue.push({pageIndex,ordinal,item});
      }
      return queue;
    });
    const selected=queues.map(()=>new Set());
    const append=(i,next)=>{
      const c=shown[protectedCatalogs.length+i],list=c.pages[next.pageIndex].items,original=optional[i].pages[next.pageIndex].items;
      const position=list.findIndex(item=>original.indexOf(item)>next.ordinal),at=position<0?list.length:position;
      list.splice(at,0,next.item);c.display_counts.shown++;c.display_counts.omitted--;return ()=>{list.splice(at,1);c.display_counts.shown--;c.display_counts.omitted++;};
    };
    // Reserve the first natural ordinal on every observed nonempty page before
    // distributing capacity. Remaining rows alternate pages, then issues;
    // product names, prices and food categories never decide selection.
    const undoSeeds=[];
    for(let i=0;i<queues.length;i++)for(const seed of queues[i].filter(row=>row.ordinal===0)){
      undoSeeds.push(append(i,seed));selected[i].add(seed.item);
    }
    if(!fits()){for(const undo of undoSeeds.reverse())undo();for(const set of selected)set.clear();}
    const cursors=queues.map(()=>0);let pending=true;
    while(pending){
      pending=false;
      for(let i=0;i<queues.length;i++){
        if(cursors[i]>=queues[i].length)continue;
        pending=true;const next=queues[i][cursors[i]++];if(selected[i].has(next.item))continue;
        const undo=append(i,next);if(!fits())undo();else selected[i].add(next.item);
      }
    }
    return candidate();
  }
  // Even all issue headers cannot always fit beside protected rows. Preserve
  // the readable legacy issues, explicitly count omitted catalogs, and never
  // silently reduce their rows or exceed the existing transport boundary.
  if(protectedCatalogs.length){
    const fallback={...base,corpus:protectedCatalogs.length===1&&protectedCatalogs[0].source_kind==='image'?protectedCatalogs[0]:{schema:2,verification_state:'needs_review',catalogs:protectedCatalogs},corpus_status:'partial',corpus_omitted_count:optional.length};
    if(Buffer.byteLength(JSON.stringify(fallback))<=460*1024)return fallback;
  }
  return {...base,corpus_status:'too_large'};
}

async function main() {
  const [command, dbFile, arg] = process.argv.slice(2);
  if (!['collect','verified-import','export'].includes(command) || !dbFile || (command !== 'collect' && !arg)) {
    throw new Error('Usage: collector.mjs collect <db> | verified-import <db> <review.json> | export <db> <output.json>');
  }
  if (command === 'collect') {
    // Existing task runner may invoke once daily; prevent overlapping store GETs globally for this database.
    const lock = await import('node:fs/promises').then(fs => fs.open(dbFile + '.collect.lock', 'wx', 0o600));
    try {
      const db = openDb(dbFile);
      try {
        let requests = 0;
        const elapsed = performance.now();
        const counted = (...args) => { requests++; return fetch(...args); };
        const r = await collect(db, poc.dayTokyo(),counted,{daily:true});
        console.log(JSON.stringify({date:r.date,requests,elapsedMs:Math.round(performance.now()-elapsed),offers:r.offers.length,sources:r.sources}));
      }
      finally { db.close(); }
    } finally {
      await lock.close();
      await import('node:fs/promises').then(fs => fs.unlink(dbFile + '.collect.lock'));
    }
    return;
  }
  const db = openDb(dbFile);
  try {
    if (command === 'verified-import') console.log(JSON.stringify(verifyImport(db, await jsonLimit(arg, LIMIT))));
    if (command === 'export') {
      const temp = arg + '.' + randomUUID() + '.tmp';
      await writeFile(temp, JSON.stringify(portableResult(snapshot(db, poc.dayTokyo()))), { mode:0o600 });
      await rename(temp, arg);
    }
  } finally { db.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.umask(0o077);
  main().catch(e => { console.error(e.code || e.message); process.exitCode = 1; });
}

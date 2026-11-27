// Public edition/page acquisition only. No fixed SKU crop or model invocation.
import {createHash} from 'node:crypto';
import {repAllows} from './rosen-policy.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
export const OFFICIAL={iy:'https://stores.itoyokado.co.jp/detail/521/',life:'https://store.lifecorp.jp/detail/east648/'};
const agent='PALURU-Supermarket-PoC/1.0';
const demand=(yes,code)=>{if(!yes)throw Error('DISCOVERY_'+code);};
// The shared REP parser is strict. An extension addressed only to another bot
// must not make the official widget unusable; never ignore our own crawl delay.
export function discoveryRobotsAllows(text,path){
 const groups=[];let agents=[],delays=[],hadRules=false;
 const flush=()=>{if(agents.length)groups.push({agents,delays});agents=[];delays=[];hadRules=false;};
 const clean=[];
 for(const raw of text.split(/\r?\n/)){
  const m=raw.split('#')[0].trim().match(/^([a-z-]+)\s*:\s*(.*)$/i);
  if(m?.[1].toLowerCase()==='user-agent'){if(hadRules)flush();agents.push(m[2].toLowerCase());}
  else if(m){hadRules=true;if(m[1].toLowerCase()==='crawl-delay'){demand(agents.length&&/^\d+(?:\.\d+)?$/.test(m[2]),'ROBOTS_FORMAT');delays.push(m[2]);clean.push('Disallow:');continue;}}
  clean.push(raw);
 }flush();
 const own=groups.filter(g=>g.agents.includes('paluru-supermarket-poc'));
 demand(!(own.length?own:groups.filter(g=>g.agents.includes('*'))).some(g=>g.delays.length),'ROBOTS_DELAY_UNSUPPORTED');
 try{return repAllows(clean.join('\n'),path);}catch{throw Error('DISCOVERY_ROBOTS_FORMAT');}
}
const decode=s=>s.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');
const tags=(html,name)=>[...html.matchAll(new RegExp('<'+name+'\\b[^>]*>','gi'))].map(m=>{
 const a={};for(const [,key,one,two] of m[0].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))a[key.toLowerCase()]=decode(one??two);return a;
});
const canonical=u=>/^https:\/\/promo\.hatobase\.jp\/flyers\/00521\/\d+\/\d+$/.test(u);
const image=u=>/^https:\/\/content\.hatobase\.jp\/flyer_details\/\d+\/[^/?#]+\.(?:jpg|jpeg|png)(?:\.progressive\.jpeg)?$/.test(u);
const nofollow=(html,header)=>/\b(?:nofollow|none)\b/i.test([header,...tags(html,'meta').filter(a=>a.name?.toLowerCase()==='robots').map(a=>a.content)].join(','));
const day=(y,m,d)=>{const v=`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;demand(new Date(v).toISOString().slice(0,10)===v,'DATE_INVALID');return v;};
function iyPeriod(label,date){
 const raw=label.normalize('NFKC').replace(/\([月火水木金土日]\)/g,'').replace(/\s+/g,'');
 const m=raw.match(/^(?:(\d{4})\/)?(\d{1,2})\/(\d{1,2})[~〜](?:(\d{4})\/)?(\d{1,2})\/(\d{1,2})/);
 if(!m)return null;
 const year=Number(m[1]||date.slice(0,4));
 return {from:day(year,+m[2],+m[3]),until:day(Number(m[4]||year+(+m[5]<+m[2])),+m[5],+m[6]),printedYear:Boolean(m[1])};
}
// /new can point to an undated tenant advertisement. Choose by explicit paper
// dates in the same official store's index, never by an edition ID or food SKU.
export function parseIyIndex(html,url,date){
 demand(canonical(url),'STORE_SCOPE');
 const found=new Map();
 for(const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)){
  const link=tags('<a '+match[1]+'>','a')[0];if(!link?.href)continue;
  if(/(?:^|\s)nofollow(?:\s|$)/i.test(link.rel||''))continue;
  const source=new URL(link.href,url).href;if(!canonical(source))continue;
  const label=decode(match[2].replace(/<[^>]*>/g,'')).trim(),period=iyPeriod(label,date);
  if(period&&period.from<=date&&date<=period.until)found.set(source,{source,...period});
 }
 demand(found.size<=32,'INDEX_SCOPE');
 return [...found.values()].sort((a,b)=>b.from.localeCompare(a.from)||a.until.localeCompare(b.until)||a.source.localeCompare(b.source));
}
export function parseIyCurrent(html,url,date){
 demand(canonical(url),'STORE_SCOPE');
 demand(tags(html,'a').some(a=>a.href?.replace(/\/$/,'')===OFFICIAL.iy.replace(/\/$/,'')),'STORE_LINK');
 const meta=tags(html,'meta');demand(meta.some(a=>a.property==='og:url'&&a.content===url),'CANONICAL');
 const label=meta.find(a=>a.name==='description')?.content;demand(typeof label==='string','PERIOD_MISSING');
 const period=iyPeriod(label,date);demand(period,'PERIOD_MISSING');const {from,until}=period;
 demand(from<=date&&date<=until,'NO_CURRENT_ISSUE');
 const title=html.match(/<title>([^<]*)<\/title>/i)?.[1];demand(title,'STORE_TITLE');
 const expected=(decode(title)+' '+label).replace(/\s+/g,' ').trim();
 const pages=[...new Set(tags(html,'img').filter(a=>a['aria-hidden']!=='true'&&a.alt?.replace(/\s+/g,' ').trim()===expected&&image(a.src)).map(a=>a.src))];
 demand(pages.length>0&&pages.length<=12,'PAGE_SCOPE');
 return {store:'iy',source:url,label,from,until,period_basis:period.printedYear?'printed_year':'official_current_route_observation_year',pages:pages.map((source,index)=>({ordinal:index+1,source,kind:'image'}))};
}
export function parseLifeWidget(html,url){
 demand(new URL(url).hostname==='widgets.tokubai.co.jp'&&new URL(url).pathname==='/224224/leaflet_widget','STORE_SCOPE');
 const pages=[];
 for(const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)){
  const a=tags('<a '+m[1]+'>','a')[0];if(!a?.href)continue;const u=new URL(a.href,url);
  if(u.hostname!=='widgets.tokubai.co.jp'||u.pathname!=='/224224/leaflet_widget/click')continue;
  demand([...u.searchParams.keys()].every(k=>['id','type'].includes(k))&&/^\d+$/.test(u.searchParams.get('id')),'LINK_SCOPE');
  if(pages.some(p=>p.source===u.href))continue;
  pages.push({ordinal:pages.length+1,source:u.href,kind:'linked_leaflet',label:decode(m[2].replace(/<[^>]*>/g,'')).trim()||tags(m[2],'img').map(a=>a.alt||'').join(' ')});
 }
 demand(pages.length>0&&pages.length<=12,'PAGE_SCOPE');
 return {store:'life',source:url,label:'official widget links; issue grouping and paper periods unverified',from:null,until:null,pages};
}
function allowed(url){
 const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash)return false;
 if(u.pathname==='/robots.txt'&&['stores.itoyokado.co.jp','promo.hatobase.jp','content.hatobase.jp','store.lifecorp.jp','widgets.tokubai.co.jp'].includes(u.hostname))return !u.search;
 if(Object.values(OFFICIAL).includes(u.href)||canonical(u.href)||u.href==='https://promo.hatobase.jp/flyers/00521/new'||image(u.href))return true;
 return u.hostname==='widgets.tokubai.co.jp'&&u.pathname==='/224224/leaflet_widget'&&u.search.length<1000&&[...u.searchParams.keys()].every(k=>['background_color','color','count','direction','main_height','main_width','type','widget_height','widget_width'].includes(k));
}
export function sourceSession(fetcher,{maxRequests=12,onResponse=()=>{},blocked=new Set(),onBlocked=()=>{}}={}){
 let requests=0;const policies=new Map();
 async function raw(url,max){
  demand(allowed(url),'URL_SCOPE');demand(!blocked.has(url),'PRIOR_DENIAL');demand(requests<maxRequests,'REQUEST_LIMIT');requests++;
  const r=await fetcher(url,{redirect:'manual',headers:{'User-Agent':agent,'Accept':'text/html,image/jpeg,image/png,text/plain;q=0.9'},signal:AbortSignal.timeout(20000)});
  if([401,403,429].includes(r.status)){blocked.add(url);onBlocked(url,'HTTP_'+r.status);}
  let size=0;const chunks=[];for await(const part of r.body||[]){size+=part.length;demand(size<=max,'BODY_LIMIT');chunks.push(Buffer.from(part));}
  const body=Buffer.concat(chunks);await onResponse({url,status:r.status,headers:{type:r.headers.get('content-type'),location:r.headers.get('location'),robots:r.headers.get('x-robots-tag')},body});
  return {url,status:r.status,type:r.headers.get('content-type')||'',location:r.headers.get('location'),robots:r.headers.get('x-robots-tag'),body};
 }
 return {get requests(){return requests;},async get(url,max=512*1024){
  demand(allowed(url),'URL_SCOPE');const u=new URL(url);
  if(!policies.has(u.origin)){
   const r=await raw(u.origin+'/robots.txt',512*1024);
   demand(r.status===200||r.status===404||r.status===410,'ROBOTS_UNAVAILABLE');
   policies.set(u.origin,r.status===200?r.body.toString('utf8'):'');
  }
  demand(discoveryRobotsAllows(policies.get(u.origin),u.pathname+u.search),'ROBOTS_DISALLOW');
  return raw(url,max);
 }};
}
function tables(db){db.exec(`CREATE TABLE IF NOT EXISTS flyer_discovery_runs(store TEXT,day TEXT,phase TEXT,error TEXT,requests INTEGER NOT NULL DEFAULT 0,edition_id TEXT,PRIMARY KEY(store,day));
 CREATE TABLE IF NOT EXISTS flyer_discovery_blocks(source TEXT PRIMARY KEY,error TEXT,observed_at TEXT);
 CREATE TABLE IF NOT EXISTS flyer_discovered_editions(edition_id TEXT PRIMARY KEY,store TEXT,source TEXT,from_day TEXT,until_day TEXT,label TEXT,metadata_hash TEXT,observed_at TEXT);
 CREATE TABLE IF NOT EXISTS flyer_discovered_pages(edition_id TEXT,ordinal INTEGER,source TEXT,kind TEXT,state TEXT,sha256 TEXT,body BLOB,error TEXT,PRIMARY KEY(edition_id,ordinal));`);}
export function discoverySummary(db,store,date){
 const run=db.prepare('SELECT * FROM flyer_discovery_runs WHERE store=? AND day=?').get(store,date);if(!run)return null;
 const pages=run.edition_id?db.prepare('SELECT ordinal,source,kind,state,sha256,length(body) bytes,error FROM flyer_discovered_pages WHERE edition_id=? ORDER BY ordinal').all(run.edition_id):[];
 const edition=run.edition_id?db.prepare('SELECT store,source,from_day,until_day,label,metadata_hash,observed_at FROM flyer_discovered_editions WHERE edition_id=?').get(run.edition_id):null;
 return {store,date,phase:run.phase,error:run.error,requests:run.requests,edition_id:run.edition_id,edition,pages,analysis_state:'not_connected',product_count:null,confirmed_price_count:null};
}
export async function collectCurrentEdition(store,db,date,fetcher=fetch,{onResponse,maxRequests=12}={}){
 demand(Object.hasOwn(OFFICIAL,store)&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&new Date(date).toISOString().slice(0,10)===date,'INPUT');tables(db);
 if(db.prepare('SELECT 1 FROM flyer_discovery_runs WHERE store=? AND day=?').get(store,date))return discoverySummary(db,store,date);
 db.prepare('INSERT INTO flyer_discovery_runs(store,day,phase) VALUES(?,?,?)').run(store,date,'started');
 const blocked=new Set(db.prepare('SELECT source FROM flyer_discovery_blocks').all().map(r=>r.source));
 const session=sourceSession(fetcher,{onResponse,maxRequests,blocked,onBlocked:(url,error)=>db.prepare('INSERT OR IGNORE INTO flyer_discovery_blocks VALUES(?,?,?)').run(url,error,new Date().toISOString())});let id=null,currentPage=null;
 try{
  const official=await session.get(OFFICIAL[store]);demand(official.status===200&&/^text\/html/i.test(official.type),'OFFICIAL_UNAVAILABLE');
  const html=official.body.toString('utf8');demand(!nofollow(html,official.robots),'NOFOLLOW');
  let edition;
  if(store==='iy'){
   demand(tags(html,'a').some(a=>a.href==='https://promo.hatobase.jp/flyers/00521/new'),'OFFICIAL_LINK');
   let r=await session.get('https://promo.hatobase.jp/flyers/00521/new');
   if([301,302,303,307,308].includes(r.status)){const url=new URL(r.location,r.url).href;demand(canonical(url),'REDIRECT_SCOPE');r=await session.get(url);}
   demand(r.status===200&&/^text\/html/i.test(r.type),'EDITION_UNAVAILABLE');
   const indexHtml=r.body.toString('utf8');demand(!nofollow(indexHtml,r.robots),'NOFOLLOW');
   const candidates=parseIyIndex(indexHtml,r.url,date);let current=null;
   try{current=parseIyCurrent(indexHtml,r.url,date);}catch(error){if(!['DISCOVERY_PERIOD_MISSING','DISCOVERY_NO_CURRENT_ISSUE'].includes(error.message))throw error;}
   if(current&&!candidates.some(c=>c.source===current.source))candidates.push(current);
   candidates.sort((a,b)=>b.from.localeCompare(a.from)||a.until.localeCompare(b.until)||a.source.localeCompare(b.source));
   demand(candidates.length,'NO_CURRENT_ISSUE');const selected=candidates[0];
   if(selected.source!==r.url){r=await session.get(selected.source);demand(r.status===200&&/^text\/html/i.test(r.type),'EDITION_UNAVAILABLE');demand(!nofollow(r.body.toString('utf8'),r.robots),'NOFOLLOW');}
   edition=parseIyCurrent(r.body.toString('utf8'),r.url,date);
   demand(edition.from===selected.from&&edition.until===selected.until,'INDEX_PERIOD_MISMATCH');
  }else{
   const links=tags(html,'a').map(a=>a.href).filter(Boolean).map(u=>new URL(u,OFFICIAL.life).href);
   const widgets=links.filter(u=>{const p=new URL(u);return p.hostname==='widgets.tokubai.co.jp'&&p.pathname==='/224224/leaflet_widget';});demand(new Set(widgets).size===1,'OFFICIAL_LINK');
   const r=await session.get(widgets[0]);demand(r.status===200&&/^text\/html/i.test(r.type),'WIDGET_UNAVAILABLE');
   demand(!nofollow(r.body.toString('utf8'),r.robots),'NOFOLLOW');edition=parseLifeWidget(r.body.toString('utf8'),r.url);
  }
  const metadata=JSON.stringify(edition);id=sha(metadata);
  db.prepare('INSERT OR IGNORE INTO flyer_discovered_editions VALUES(?,?,?,?,?,?,?,?)').run(id,store,edition.source,edition.from,edition.until,edition.label,sha(metadata),new Date().toISOString());
  const insert=db.prepare('INSERT OR IGNORE INTO flyer_discovered_pages VALUES(?,?,?,?,?,?,?,?)');
  for(const p of edition.pages)insert.run(id,p.ordinal,p.source,p.kind,'not_retrieved',null,null,null);
  for(const p of edition.pages){
   if(['saved','storage_limited'].includes(db.prepare('SELECT state FROM flyer_discovered_pages WHERE edition_id=? AND ordinal=?').get(id,p.ordinal).state))continue;
   if(p.kind!=='image'){db.prepare('UPDATE flyer_discovered_pages SET error=? WHERE edition_id=? AND ordinal=?').run('DOWNSTREAM_NOT_ENABLED',id,p.ordinal);continue;}
   const stored=db.prepare('PRAGMA page_count').get().page_count*db.prepare('PRAGMA page_size').get().page_size;
   const budget=12*1024*1024-stored-512*1024;
   if(budget<=0){db.prepare('UPDATE flyer_discovered_pages SET state=?,error=? WHERE edition_id=? AND ordinal=?').run('storage_limited','PAGE_STORAGE_LIMIT',id,p.ordinal);continue;}
   currentPage=p.ordinal;
   const r=await session.get(p.source,Math.min(8*1024*1024,budget));demand(r.status===200&&/^image\/(jpeg|png)/i.test(r.type),'PAGE_UNAVAILABLE');
   demand(r.body.length>=4&&(r.body[0]===255&&r.body[1]===216&&r.body[2]===255||r.body.subarray(0,4).equals(Buffer.from([137,80,78,71]))),'IMAGE_FORMAT');
   db.prepare('UPDATE flyer_discovered_pages SET state=?,sha256=?,body=?,error=NULL WHERE edition_id=? AND ordinal=?').run('saved',sha(r.body),r.body,id,p.ordinal);
   currentPage=null;
  }
  db.prepare('UPDATE flyer_discovery_runs SET phase=?,edition_id=?,requests=? WHERE store=? AND day=?').run('detected',id,session.requests,store,date);
 }catch(e){
  const error=/^DISCOVERY_[A-Z_]+$/.test(e.message)?e.message:'DISCOVERY_REQUEST_FAILED';
  if(currentPage!==null)db.prepare('UPDATE flyer_discovered_pages SET state=?,error=? WHERE edition_id=? AND ordinal=?').run(error==='DISCOVERY_BODY_LIMIT'?'storage_limited':'not_retrieved',error,id,currentPage);
  db.prepare('UPDATE flyer_discovery_runs SET phase=?,error=?,edition_id=?,requests=? WHERE store=? AND day=?').run('failed',error,id,session.requests,store,date);
 }
 return discoverySummary(db,store,date);
}

// The publisher's normal public UI only: no internal API replay or SKU list.
import {createHash} from 'node:crypto';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {ROSEN_AGENT} from './rosen-policy.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const implementation=hash(await readFile(new URL(import.meta.url)));
export const ROSEN_STORE='https://rosen.mikke-sales.com/stores/taira';
export const ACQUISITION_BOUNDS=Object.freeze({max_source_requests:160,min_source_interval_ms:1000,max_acquisition_ms:180000});
const documentURL=s=>/^https:\/\/rosen\.mikke-sales\.com\/stores\/taira\/flyers\/\d+\/?$/.test(s);
const demand=(v,code)=>{if(!v)throw Error(code);};
const clean=s=>String(s??'').replace(/\s+/g,' ').trim();
const day=(y,m,d)=>{const s=[y,String(m).padStart(2,'0'),String(d).padStart(2,'0')].join('-');return Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s?s:null;};
export function period(text){
 const dates=[...text.matchAll(/(20\d{2})\/(\d{1,2})\/(\d{1,2})/g)].map(m=>day(+m[1],+m[2],+m[3]));
 demand(dates.length===2&&dates.every(Boolean)&&dates[0]<=dates[1],'ROSEN_PERIOD');return {from:dates[0],until:dates[1]};
}
export function selectedDay(label,range){
 const m=label.match(/^(\d{1,2})\/(\d{1,2})[（(]/);demand(m,'ROSEN_DAY_LABEL');
 const choices=[+range.from.slice(0,4),+range.until.slice(0,4)].map(y=>day(y,+m[1],+m[2])).filter(d=>d&&range.from<=d&&d<=range.until);
 const unique=[...new Set(choices)];demand(unique.length===1,'ROSEN_DAY_SCOPE');return unique[0];
}
const yen=s=>{const m=clean(s).match(/^(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?$/);return m?Number(m[0].replaceAll(',','')):null;};
const dateSummary=dates=>{const spans=[];for(const d of dates){const last=spans.at(-1);if(last&&Date.parse(d)-Date.parse(last[1])===86400000)last[1]=d;else spans.push([d,d]);}return spans.map(([a,b])=>a===b?a:a+'〜'+b).join('、');};
function viewCoverage(header,views){
 demand(Array.isArray(header.days)&&header.days.length>=1&&header.days.length<=31&&new Set(header.days).size===header.days.length&&Array.isArray(header.categories)&&header.categories.length>=1&&header.categories.length<=15&&new Set(header.categories).size===header.categories.length,'ROSEN_NAV_FORMAT');
 const expected=header.days.length*header.categories.length;
 demand(Array.isArray(views)&&views.length>=1&&views.length<=expected,'ROSEN_VIEW_COVERAGE');
 const seen=new Set();
 for(const view of views){
  demand(header.days.includes(view.day_label)&&header.categories.includes(view.category),'ROSEN_NAV_SCOPE');
  const cell=view.day_label+'\0'+view.category;demand(!seen.has(cell),'ROSEN_VIEW_DUPLICATE');seen.add(cell);
 }
 const missing=header.days.flatMap(day_label=>header.categories.filter(category=>!seen.has(day_label+'\0'+category)).map(category=>({day_label,category})));
 return {state:missing.length?'partial':'complete',expected_views:expected,observed_views:views.length,missing_view_count:missing.length,missing_views:missing};
}
// Incomplete observations are usable references, never a complete acquisition cache.
// Legacy packets qualify only when their raw navigation matrix proves completeness.
export function isCompleteRosenPacket(packet){
 try{
  if(packet?.store!=='rosen'||!documentURL(packet.source_document)||packet.raw_dom_header?.shop!=='そうてつローゼン たいら店'||packet.acquisition?.partial_reason)return false;
  const range=period(packet.raw_dom_header.period);for(const view of packet.raw_dom_views)selectedDay(view.day_label,range);
  return viewCoverage(packet.raw_dom_header,packet.raw_dom_views).state==='complete';
 }catch{return false;}
}
export function packetFromViews(source,header,views,metrics={}){
 demand(documentURL(source)&&header.shop==='そうてつローゼン たいら店','ROSEN_STORE_SCOPE');
 const range=period(header.period),coverage=viewCoverage(header,views);
 coverage.observed_dates=[...new Set(views.map(v=>selectedDay(v.day_label,range)))].sort();
 const byCategory=new Map(header.categories.map((s,i)=>[s,{face:'category-'+i,label:s,selected_day:null,examined_tiles:[],document_period_raw:header.period,global_conditions:[],unresolved_regions:[],items:[]} ]));
 const seenCells=new Set(),unique=new Map();let total=0;
 for(const view of views){
  demand(header.days.includes(view.day_label)&&header.categories.includes(view.category),'ROSEN_NAV_SCOPE');
  const cell=view.day_label+'\0'+view.category;demand(!seenCells.has(cell),'ROSEN_VIEW_DUPLICATE');seenCells.add(cell);
  const date=selectedDay(view.day_label,range);demand(Array.isArray(view.cards)&&view.cards.length<=500,'ROSEN_CARD_LIMIT');
  for(const [ordinal,card] of view.cards.entries()){
   total++;const key=hash(JSON.stringify(card));
   let item=unique.get(key);
   if(!item){
    const prices=[],reasons=[],raw=clean(card.raw_text),lines=String(card.raw_text??'').replaceAll('\r','');
    const net=yen(card.net),taxText=clean(card.gross),taxMatch=taxText.match(/^税込\s*(\d[\d,]*(?:\.\d{1,2})?)\s*円$/),tax=taxMatch?yen(taxMatch[1]):null;
    const half=raw.match(/今ついている本体価格より\s*レジにて\s*半額/);
    let lastEnd=0;
    for(const m of lines.matchAll(/本体\s*(\d[\d,]*(?:\.\d{1,2})?)\s*円\s*税込\s*(\d[\d,]*(?:\.\d{1,2})?)\s*円/g)){
     const n=yen(m[1]),g=yen(m[2]);if(n===null||g===null)continue;
     const lead=lines.slice(lastEnd,m.index).split('\n').map(clean).filter(Boolean),label=lead.at(-1)||(prices.length===0?clean(card.unit)||null:null);
     prices.push({role:'general',raw_text:clean(m[0]),net_yen:n,tax_included_yen:g,discount_percent:null,unit_text:label,payment_condition:null,other_conditions:[],bbox:null,confidence:'clear',review_reasons:label?[]:['QUOTE_UNIT_SCOPE_UNVERIFIED']});lastEnd=m.index+m[0].length;
    }
    if(!prices.length&&net!==null&&tax!==null&&clean(card.price_label)==='本体')prices.push({role:'general',raw_text:'本体'+card.net+'円 / '+taxText,net_yen:net,tax_included_yen:tax,discount_percent:null,unit_text:clean(card.unit)||null,payment_condition:null,other_conditions:[],bbox:null,confidence:'clear',review_reasons:[]});
    if(!prices.length&&half)prices.push({role:'discount_rate',raw_text:half[0],net_yen:null,tax_included_yen:null,discount_percent:50,unit_text:clean(card.unit)||null,payment_condition:null,other_conditions:['元の売価・割引後の金額は掲載なし'],bbox:null,confidence:'clear',review_reasons:['NO_PRINTED_FINAL_AMOUNT']});
    if(!prices.length)reasons.push('DOM_PRICE_FIELDS_UNVERIFIED');
    if(!clean(card.name))reasons.push('DOM_PRODUCT_NAME_MISSING');
    const conditions=card.notices.map(clean).filter(Boolean);
    if(prices.length>1)conditions.push('複数価格・組合せ条件を含む原文（未照合）：'+raw);
    if(reasons.includes('DOM_PRICE_FIELDS_UNVERIFIED'))conditions.push('価格欄を含む原文（未照合）：'+raw);
    item={name:clean(card.name)||null,spec:[clean(card.maker),clean(card.unit)].filter(Boolean).join(' / ')||null,variants:[],product_type:view.category==='家庭用品'?'nonfood':'unknown',price_state:prices[0]?.role==='discount_rate'?'discount_only':prices.length?'priced':raw.match(/円|価格|税込/)?'unreadable':'not_printed',prices,valid_from:null,valid_until:null,validity_raw_text:null,conditions,bbox:null,confidence:reasons.length?'uncertain':'clear',review_reasons:['STORE_CONDITION_ASSOCIATION_UNVERIFIED','ITEM_DATE_SCOPE_UNVERIFIED',...reasons],observed_dates:[],dom_regions:[],raw_dom_fields:card};
    unique.set(key,item);byCategory.get(view.category).items.push(item);
   }
   if(!item.observed_dates.includes(date))item.observed_dates.push(date);
   item.dom_regions.push({day:date,category:view.category,ordinal:ordinal+1,selector:'.Product__Inner'});
  }
 }
 for(const item of unique.values()){item.observed_dates.sort();item.validity_raw_text='公開画面で選択した日：'+dateSummary(item.observed_dates)+'（商品の販売期限は未照合）';}
 const observedCategories=new Set(views.map(v=>v.category));
 const pages=[...byCategory.values()].filter(p=>observedCategories.has(p.label)),notes=[...new Set(views.map(v=>clean(v.notes)).filter(Boolean))];
 const sourceRevision=hash(JSON.stringify({source,header,views,index_fingerprint:metrics.index_fingerprint??null}));
 return {schema:'supermarket-whole-corpus-v2',source_kind:'dom',store:'rosen',issue_id:'rosen-taira-'+source.match(/flyers\/(\d+)/)[1],source_revision:sourceRevision,analysis_revision:implementation,obtained_at:new Date().toISOString(),source_document:source,physical_pdf_pages:null,logical_faces:null,logical_views:views.length,document_from:range.from,document_until:range.until,pages,
  coverage,source_notes:notes.map(raw_text=>({face:pages[0].face,kind:'publisher_notice',raw_text,verification_state:'needs_review'})),unresolved_source_notes:[],raw_dom_header:header,raw_dom_views:views,
  analyzed_at:new Date().toISOString(),acquisition:{...metrics,kind:'normal_public_browser_dom',coverage_state:coverage.state,expected_day_category_views:coverage.expected_views,observed_day_category_views:views.length,all_day_category_views:views.length,raw_card_observations:total,exact_dom_text_deduplicated_frames:unique.size,complete_original_sku_denominator:null,model_calls:0,manual_product_selection:false,images_redistributed:false}};
}
export async function readIssueViews(page,{onView=()=>{},check=()=>{}}={}){
 const header=await page.evaluate(()=>({shop:document.querySelector('.FlyerHeader__ShopName')?.textContent?.trim(),period:document.querySelector('.FlyerHeader__Date')?.textContent?.trim(),days:[...document.querySelectorAll('.FlyerSelect button')].map(b=>b.textContent.trim()),categories:[...document.querySelectorAll('.Flyer__CategoryList button')].map(b=>b.textContent.trim())}));
 demand(header.shop==='そうてつローゼン たいら店'&&header.days.length>=1&&header.days.length<=31&&header.categories.length>=1&&header.categories.length<=15,'ROSEN_NAV_FORMAT');
 const views=[];
 for(const day of header.days){check();await page.getByRole('button',{name:day,exact:true}).click();
  for(const category of header.categories){check();await page.getByRole('button',{name:category,exact:true}).click();
   await page.waitForLoadState('networkidle',{timeout:10000});
   // Render settlement is independent of the selected button. Empty views must
   // have a visible publisher empty-state, never merely a missing product list.
   await page.waitForFunction(()=>!document.querySelector('[aria-busy="true"],.is-loading,.loading:not([hidden])')&&
    (document.querySelector('.Product__Inner')||[...document.querySelectorAll('.Flyer__ProductListInner,.Product__Empty,.Flyer__Empty')].some(e=>/該当する商品はありません|商品がありません|掲載商品はありません/.test(e.innerText))),null,{timeout:10000});
   const before=await page.locator('.Flyer__ProductListInner').innerText();
   await page.waitForTimeout(150);
   demand(before===await page.locator('.Flyer__ProductListInner').innerText(),'ROSEN_PRODUCT_RENDER_UNSTABLE');check();
   const view=await page.evaluate(()=>({day_label:document.querySelector('.FlyerSelect button.-current')?.textContent.trim(),category:document.querySelector('.Flyer__CategoryList button.-current')?.textContent.trim(),notes:document.querySelector('.FlyerNotice')?.innerText??'',cards:[...document.querySelectorAll('.Product__Inner')].map(e=>({name:e.querySelector('.Product__Name')?.textContent??'',maker:e.querySelector('.Product__Maker')?.textContent??'',unit:e.querySelector('.Product__Unit')?.textContent??'',net:e.querySelector('.Product__PriceValue')?.textContent??'',price_label:e.querySelector('.Product__PriceLabel')?.textContent??'',gross:e.querySelector('.Product__SubPrice')?.textContent??'',notices:[...e.querySelectorAll('[class*="Product__Notice"]')].map(n=>n.textContent),raw_text:e.innerText}))}));
   demand(view.day_label===day&&view.category===category,'ROSEN_SELECTION_NOT_SETTLED');view.observed_at=new Date().toISOString();
   await onView({header,view});views.push(view);
  }
 }
 return {header,views};
}
// A later read failure preserves already-settled views without retrying I/O.
export async function readIssueWithPartial(page,{source,onPacket=()=>{},onView=()=>{},check=()=>{},metrics={},expectedRange=null,read=readIssueViews}={}){
 let header,views=[];
 const persist=async(extra={})=>{
  const packet=packetFromViews(source,header,views,{...(typeof metrics==='function'?metrics():metrics),...extra});
  if(expectedRange)demand(packet.document_from===expectedRange.from&&packet.document_until===expectedRange.until,'ROSEN_DOCUMENT_PERIOD_CHANGED');
  await onPacket(packet);return packet;
 };
 try{
  const result=await read(page,{check,onView:async part=>{
   if(header)demand(JSON.stringify(header)===JSON.stringify(part.header),'ROSEN_NAV_CHANGED');
   await onView(part);header=part.header;views.push(part.view);
  }});
  header=result.header;views=result.views;
 }catch(error){
  if(views.length)await persist({partial_reason:/^ROSEN_[A-Z0-9_]+$/.test(error.message)?error.message:'ROSEN_READ_FAILED'});
  throw error;
 }
 return persist();
}
export async function readRosen(date,{knownIssues=new Map(),onPacket=()=>{},onView=()=>{},policy,onSourceRequest=()=>{},onSourceResponse=()=>{},budgetMs=180000,runtime=null}={}){
 if(process.getuid?.()===0)throw Error('BROWSER_ROOT_FORBIDDEN');
 demand(policy&&typeof policy.allows==='function','ROSEN_POLICY_REQUIRED');
 const dir=await mkdtemp(join(tmpdir(),'paluru-rosen-'));let browser;let requests=0,blocked=0,blockedRobots=0,sourceFailed=false;
 const deadline=performance.now()+Math.min(ACQUISITION_BOUNDS.max_acquisition_ms,budgetMs);
 const check=()=>{demand(performance.now()<deadline,'ROSEN_DEADLINE');demand(!sourceFailed,'ROSEN_ESSENTIAL_RESPONSE_FAILED');};
 let requestQueue=Promise.resolve(),lastRequest=-Infinity;
 const reserve=()=>{const next=requestQueue.then(async()=>{check();demand(requests<ACQUISITION_BOUNDS.max_source_requests,'ROSEN_REQUEST_BUDGET');
  const delay=ACQUISITION_BOUNDS.min_source_interval_ms-(performance.now()-lastRequest);
  if(delay>0)await new Promise(resolve=>setTimeout(resolve,delay));check();lastRequest=performance.now();requests++;onSourceRequest();
 });requestQueue=next.catch(()=>{});return next;};
 try{
  const chromium=runtime?.chromium??(await import('/opt/paluru-browser/node_modules/playwright-core/index.mjs')).chromium;
  const env={PATH:process.env.PATH||'/usr/bin:/bin',LANG:'ja_JP.UTF-8',XDG_CONFIG_HOME:join(dir,'config'),XDG_CACHE_HOME:join(dir,'cache')};
  if(process.platform==='win32')for(const k of ['SystemRoot','WINDIR','LOCALAPPDATA','TEMP','TMP'])if(process.env[k])env[k]=process.env[k];
  browser=await chromium.launch({executablePath:runtime?.executablePath??'/usr/bin/chromium',headless:true,chromiumSandbox:true,timeout:20000,env,args:['--disable-dev-shm-usage','--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run']});
  const context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,userAgent:ROSEN_AGENT,locale:'ja-JP',timezoneId:'Asia/Tokyo',viewport:{width:1280,height:900}});
  const essential=req=>new URL(req.url()).hostname==='rosen.mikke-sales.com'&&['document','script','xhr','fetch'].includes(req.resourceType());
  context.on('response',r=>{if(new URL(r.url()).hostname==='rosen.mikke-sales.com')onSourceResponse({resource_type:r.request().resourceType(),status:r.status(),at:new Date().toISOString()});if(essential(r.request())&&r.status()>=400)sourceFailed=true;});
  context.on('requestfailed',req=>{if(essential(req)&&req.failure()?.errorText!=='net::ERR_BLOCKED_BY_CLIENT')sourceFailed=true;});
  await context.route('**/*',async route=>{const req=route.request(),u=new URL(req.url());
   if(u.hostname==='rosen.mikke-sales.com'&&u.pathname==='/robots.txt'){blockedRobots++;return route.abort('blockedbyclient');}
   if(u.protocol!=='https:'||u.hostname!=='rosen.mikke-sales.com'||u.port||u.username||u.password||req.method()!=='GET'||['image','media','font'].includes(req.resourceType())||!policy.allows(u.pathname+u.search)){blocked++;return route.abort('blockedbyclient');}
   try{await reserve();return await route.continue();}catch{sourceFailed=true;return route.abort('blockedbyclient');}});
  const page=await context.newPage();page.setDefaultTimeout(10000);
  const response=await page.goto(ROSEN_STORE,{waitUntil:'domcontentloaded',timeout:25000});
  demand(response?.status()===200,'ROSEN_HTTP_'+(response?.status()??'UNKNOWN'));
  await page.locator('a[href*="/stores/taira/flyers/"]').first().waitFor({state:'attached'});
  const links=await page.locator('a[href*="/stores/taira/flyers/"]').evaluateAll(els=>els.map(a=>({url:a.href,text:a.innerText,nofollow:a.relList.contains('nofollow')})));
  const active=[];
  for(const link of links){demand(documentURL(link.url)&&!link.nofollow,'ROSEN_LINK_SCOPE');const range=period(link.text);if(range.from<=date&&date<=range.until&&!active.some(a=>a.url===link.url))active.push({...link,...range});}
  demand(active.length>=1&&active.length<=12,'ROSEN_NO_ACTIVE_ISSUE');const results=[];
  for(const link of active){check();const id='rosen-taira-'+link.url.match(/flyers\/(\d+)/)[1],fingerprint=hash(JSON.stringify({url:link.url,text:clean(link.text),from:link.from,until:link.until}));
   const cached=knownIssues.get(id);
   if(isCompleteRosenPacket(cached)&&cached.acquisition?.index_fingerprint===fingerprint){
    if(cached.analysis_revision===implementation){results.push({issue_id:id,disposition:'unchanged'});continue;}
    if(cached.raw_dom_header&&cached.raw_dom_views){
     const revised=packetFromViews(link.url,cached.raw_dom_header,cached.raw_dom_views,{index_fingerprint:fingerprint,reanalyzed_cached_source:true,source_requests:requests,robots_status:policy.status,robots_observed_at:policy.observed_at});
     revised.obtained_at=cached.obtained_at;
     await onPacket(revised);
     results.push({issue_id:id,disposition:'reanalyzed_cached_source'});continue;
    }
   }
   const response=await page.goto(link.url,{waitUntil:'domcontentloaded',timeout:25000});demand(response?.status()===200,'ROSEN_HTTP_'+(response?.status()??'UNKNOWN'));
   await page.locator('.Product__Inner').first().waitFor({state:'attached'});
   const packet=await readIssueWithPartial(page,{source:link.url,check,onPacket,expectedRange:link,onView:part=>onView({source:link.url,issue_id:id,index_fingerprint:fingerprint,...part}),metrics:()=>({index_fingerprint:fingerprint,source_requests:requests,blocked_nonessential_requests:blocked,robots_status:policy.status,robots_observed_at:policy.observed_at})});
   results.push({issue_id:id,disposition:packet.coverage.state==='partial'?'partial_for_verification':'stored_for_verification',frames:packet.acquisition.exact_dom_text_deduplicated_frames,views:packet.logical_views});
  }
  return {issues:results,source_requests:requests,blocked_nonessential_requests:blocked,blocked_robots_requests:blockedRobots,model_calls:0};
 }finally{if(browser)await browser.close();demand(dirname(resolve(dir))===resolve(tmpdir())&&basename(dir).startsWith('paluru-rosen-'),'ROSEN_TEMP_SCOPE');await rm(dir,{recursive:true,force:true});}
}

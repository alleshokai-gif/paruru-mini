// The publisher's normal public UI only: no internal API replay or SKU list.
import {createHash} from 'node:crypto';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ROSEN_AGENT} from './rosen-policy.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const implementation=hash(await readFile(new URL(import.meta.url)));
export const ROSEN_STORE='https://rosen.mikke-sales.com/stores/taira';
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
export function packetFromViews(source,header,views,metrics={}){
 demand(documentURL(source)&&header.shop==='そうてつローゼン たいら店','ROSEN_STORE_SCOPE');
 const range=period(header.period);demand(views.length===header.days.length*header.categories.length&&views.length<=512,'ROSEN_VIEW_COVERAGE');
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
    const prices=[],reasons=[],raw=clean(card.raw_text);
    const net=yen(card.net),taxText=clean(card.gross),taxMatch=taxText.match(/^税込\s*(\d[\d,]*(?:\.\d{1,2})?)\s*円$/),tax=taxMatch?yen(taxMatch[1]):null;
    if(net!==null&&tax!==null&&clean(card.price_label)==='本体')prices.push({role:'general',raw_text:'本体'+card.net+'円 / '+taxText,net_yen:net,tax_included_yen:tax,discount_percent:null,unit_text:clean(card.unit)||null,payment_condition:null,other_conditions:[],bbox:null,confidence:'clear',review_reasons:[]});
    else reasons.push('DOM_PRICE_FIELDS_UNVERIFIED');
    if(!clean(card.name))reasons.push('DOM_PRODUCT_NAME_MISSING');
    item={name:clean(card.name)||null,spec:[clean(card.maker),clean(card.unit)].filter(Boolean).join(' / ')||null,variants:[],product_type:view.category==='家庭用品'?'nonfood':'unknown',price_state:prices.length?'priced':raw.match(/円|価格|税込/)?'unreadable':'not_printed',prices,valid_from:null,valid_until:null,validity_raw_text:null,conditions:card.notices.map(clean).filter(Boolean),bbox:null,confidence:reasons.length?'uncertain':'clear',review_reasons:['STORE_CONDITION_ASSOCIATION_UNVERIFIED','ITEM_DATE_SCOPE_UNVERIFIED',...reasons],observed_dates:[],dom_regions:[],raw_dom_fields:card};
    unique.set(key,item);byCategory.get(view.category).items.push(item);
   }
   if(!item.observed_dates.includes(date))item.observed_dates.push(date);
   item.dom_regions.push({day:date,category:view.category,ordinal:ordinal+1,selector:'.Product__Inner'});
  }
 }
 for(const item of unique.values()){item.observed_dates.sort();item.validity_raw_text='公開UIに表示された日（商品期限は未照合）：'+item.observed_dates.join('、');}
 const pages=[...byCategory.values()],notes=[...new Set(views.map(v=>clean(v.notes)).filter(Boolean))];
 const sourceRevision=hash(JSON.stringify({source,header,views,index_fingerprint:metrics.index_fingerprint??null}));
 return {schema:'supermarket-whole-corpus-v2',source_kind:'dom',store:'rosen',issue_id:'rosen-taira-'+source.match(/flyers\/(\d+)/)[1],source_revision:sourceRevision,analysis_revision:implementation,obtained_at:new Date().toISOString(),source_document:source,physical_pdf_pages:null,logical_faces:null,logical_views:views.length,document_from:range.from,document_until:range.until,pages,
  source_notes:notes.map(raw_text=>({face:pages[0].face,kind:'publisher_notice',raw_text,verification_state:'needs_review'})),unresolved_source_notes:[],raw_dom_header:header,raw_dom_views:views,
  analyzed_at:new Date().toISOString(),acquisition:{kind:'normal_public_browser_dom',all_day_category_views:views.length,raw_card_observations:total,exact_dom_text_deduplicated_frames:unique.size,complete_original_sku_denominator:null,model_calls:0,manual_product_selection:false,images_redistributed:false,...metrics}};
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
export async function readRosen(date,{knownIssues=new Map(),onPacket=()=>{},onView=()=>{},policy,onSourceRequest=()=>{},budgetMs=180000}={}){
 if(process.getuid?.()===0)throw Error('BROWSER_ROOT_FORBIDDEN');
 demand(policy&&typeof policy.allows==='function','ROSEN_POLICY_REQUIRED');
 const dir=await mkdtemp(join(tmpdir(),'paluru-rosen-'));let browser;let requests=0,blocked=0,sourceFailed=false;
 const deadline=performance.now()+Math.min(180000,budgetMs);
 const check=()=>{demand(performance.now()<deadline,'ROSEN_DEADLINE');demand(!sourceFailed,'ROSEN_ESSENTIAL_RESPONSE_FAILED');};
 try{
  const {chromium}=await import('/opt/paluru-browser/node_modules/playwright-core/index.mjs');
  browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true,timeout:20000,env:{PATH:process.env.PATH||'/usr/bin:/bin',LANG:'ja_JP.UTF-8',XDG_CONFIG_HOME:join(dir,'config'),XDG_CACHE_HOME:join(dir,'cache')},args:['--disable-dev-shm-usage','--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run']});
  const context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,userAgent:ROSEN_AGENT,locale:'ja-JP',timezoneId:'Asia/Tokyo',viewport:{width:1280,height:900}});
  const essential=req=>new URL(req.url()).hostname==='rosen.mikke-sales.com'&&['document','script','xhr','fetch'].includes(req.resourceType());
  context.on('response',r=>{if(essential(r.request())&&r.status()>=400)sourceFailed=true;});
  context.on('requestfailed',req=>{if(essential(req)&&req.failure()?.errorText!=='net::ERR_BLOCKED_BY_CLIENT')sourceFailed=true;});
  await context.route('**/*',async route=>{const req=route.request(),u=new URL(req.url());
   if(u.protocol!=='https:'||u.hostname!=='rosen.mikke-sales.com'||u.port||u.username||u.password||req.method()!=='GET'||['image','media','font'].includes(req.resourceType())||!policy.allows(u.pathname+u.search)){blocked++;return route.abort('blockedbyclient');}
   requests++;onSourceRequest();return route.continue();});
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
   if(cached?.acquisition?.index_fingerprint===fingerprint){
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
   const {header,views}=await readIssueViews(page,{check,onView:part=>onView({source:link.url,issue_id:id,index_fingerprint:fingerprint,...part})});
   const packet=packetFromViews(link.url,header,views,{index_fingerprint:fingerprint,source_requests:requests,blocked_nonessential_requests:blocked,robots_status:policy.status,robots_observed_at:policy.observed_at});
   demand(packet.document_from===link.from&&packet.document_until===link.until,'ROSEN_DOCUMENT_PERIOD_CHANGED');await onPacket(packet);
   results.push({issue_id:id,disposition:'stored_for_verification',frames:packet.acquisition.exact_dom_text_deduplicated_frames,views:views.length});
  }
  return {issues:results,source_requests:requests,blocked_nonessential_requests:blocked,model_calls:0};
 }finally{if(browser)await browser.close();await rm(dir,{recursive:true,force:true});}
}

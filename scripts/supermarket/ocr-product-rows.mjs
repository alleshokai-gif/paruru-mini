// Generic commercial label grammar, never a SKU/name allowlist or price guess.
const norm=s=>s.normalize('NFKC').replace(/\s+/g,'');
const overlap=(a,b)=>Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y))/Math.min(a.w*a.h,b.w*b.h);
const jp=/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu;
const denied=/レシート|お買上|お買い上|ポイント|プレゼント|対象外|各店最低|全店合計|有効期間|お一人|当たり|当り|税込価格|営業時間|ご予約|応募/;
function lines(words){
 const groups=new Map();for(const w of words){const k=w.pass+':'+w.line;if(!groups.has(k))groups.set(k,[]);groups.get(k).push(w);}
 const out=[];
 for(const group of groups.values()){
  group.sort((a,b)=>a.x-b.x);const chunks=[];
  for(const w of group){let c=chunks.at(-1),last=c?.at(-1);if(!last||w.x-last.x-last.w>Math.max(last.h,w.h)*2){c=[];chunks.push(c);}c.push(w);}
  for(const c of chunks){const x=Math.min(...c.map(w=>w.x)),y=Math.min(...c.map(w=>w.y));out.push({pass:c[0].pass,text:norm(c.map(w=>w.text).join('')),confidence:c.reduce((n,w)=>n+w.confidence,0)/c.length,box:{x,y,w:Math.max(...c.map(w=>w.x+w.w))-x,h:Math.max(...c.map(w=>w.y+w.h))-y}});}
 }return out;
}
export function productRows(page){
 const all=lines(page.words),proposals=[],unresolved=[];
 for(const l of all){
  const text=l.text.replace(/^[●○・@$*]+/u,'');
  const m=text.match(/^(.{3,100}?)\((各?\d+(?:\.\d+)?(?:kg|g|ml|mL|L|本|枚|袋|コ|個)(?:[x×]\d+)?(?:入)?)\)(.*)$/u);
  if(!m||denied.test(text)||l.confidence<75||(m[1].match(jp)||[]).length<3)continue;
  const name=m[1].replace(/[・…\.]+$/u,''),spec=m[2];
  const units=[...m[3].matchAll(/(?:^|[・…\.])((?:各)?\d+(?:パック|袋|本|コ|個|箱|枚))(?=$|[・…\.]|税抜|本体|税込)/gu)].map(m=>m[1]);
  // Spatially nearby text on another OCR line never grants a sale unit.
  const unit=new Set(units);const unitText=unit.size===1?[...unit][0]:null;
  // Both tax labels and currency must occur on this exact product line.
  const price=m[3].match(/(?:税抜|本体)(\d[\d,]*)円.*税込(\d[\d,]*)円/u);
  proposals.push({...l,name,spec,unit:unitText,net:price?Number(price[1].replaceAll(',','')):null,gross:price?Number(price[2].replaceAll(',','')):null});
 }
 const groups=[];
 for(const p of proposals){let g=groups.find(g=>norm(g[0].name)===norm(p.name)&&g[0].spec===p.spec&&overlap(g[0].box,p.box)>=.45);if(!g){g=[];groups.push(g);}g.push(p);}
 const items=[];
 for(const g of groups){
  const distinct=[...new Map(g.map(r=>[r.pass,r])).values()],r=g[0];
  if(distinct.length<2){unresolved.push({reason:'SINGLE_READ_COMMERCIAL_LABEL',bbox:r.box});continue;}
  const units=[...new Set(distinct.map(r=>r.unit))],quotes=[...new Set(distinct.map(r=>JSON.stringify([r.net,r.gross])))];
  const unit=units.length===1?units[0]:null,known=quotes.length===1&&r.net!==null&&r.gross!==null&&unit!==null&&r.net>0&&r.gross>=r.net;
  const b=[Math.floor(r.box.x/page.width*1000),Math.floor(r.box.y/page.height*1000),Math.ceil((r.box.x+r.box.w)/page.width*1000),Math.ceil((r.box.y+r.box.h)/page.height*1000)];
  items.push({name:r.name,spec:r.spec,variants:[],product_type:'unknown',price_state:known?'priced':'unreadable',prices:known?[{role:'unknown',net_yen:r.net,tax_included_yen:r.gross,discount_percent:null,raw_text:r.text,unit_text:unit,payment_condition:'OCR参考。会員・支払・店舗条件未照合。',bbox:b,review_reasons:['UNATTENDED_OCR_REFERENCE_ONLY']}]:[],valid_from:null,valid_until:null,validity_raw_text:null,bbox:b,conditions:['商品固有の日付・税/会員条件・商品境界は未確認。紙面全域の他候補はOCR根拠に保持。'],confidence:'commercial_label_multi_read',review_reasons:['UNATTENDED_OCR_REFERENCE_ONLY','ITEM_PERIOD_UNKNOWN','NO_SEMANTIC_PRODUCT_VERIFICATION',...(!unit?['SALE_UNIT_UNKNOWN']:[]),...(!known?['PRICE_ASSOCIATION_UNKNOWN']:[])],verification_state:'needs_review',verified_price:false,recommendation_eligible:false,ocr_product_evidence:{matching_passes:distinct.map(q=>q.pass),source_bbox:r.box,sale_unit:unit,unit_consistent:units.length===1,raw_reads:distinct.map(q=>({pass:q.pass,text:q.text,confidence:q.confidence}))}});
 }
 return {items,unresolved,metrics:{ocr_strings:all.length,commercial_label_candidates:proposals.length,reference_product_groups:items.length,reference_price_groups:items.filter(i=>i.prices.length).length,sale_unit_groups:items.filter(i=>i.ocr_product_evidence.sale_unit).length,unresolved_commercial_groups:unresolved.length,verified_products:0,verified_prices:0,product_denominator:null}};
}

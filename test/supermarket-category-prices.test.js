'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const ui=require('../features/shopping/supermarket-poc.js');
const contract=require('./fixtures/supermarket-category-contract.json');
class Element{
 constructor(tag){this.tagName=tag;this.children=[];this.textContent='';this.callbacks=new Map();this.attrs={};}
 append(...x){this.children.push(...x);} replaceChildren(...x){this.children=x;}
 setAttribute(k,v){this.attrs[k]=v;} addEventListener(k,v){this.callbacks.set(k,v);}
 all(tag){return this.children.flatMap(n=>[...(n.tagName===tag?[n]:[]),...n.all(tag)]);}
 text(){return this.textContent+' '+this.children.map(n=>n.text()).join(' ');}
}
const day='2026-11-21',doc={createElement:t=>new Element(t)};
const offer=(title='鶏むね肉',unit='100g')=>({store:'ok',title,spec:'規格そのまま',unit,net_yen:99,tax_included_sen:10692,
 from:day,until:'2026-11-22',confidence:'ocr_validated',kind:'weekly_information',conditions:'非会員・カード払',
 obtained_at:'2026-11-20T01:00:00Z',source:'https://ok-corporation.jp/media-download/1764/f75516cf12ff8d76/PDF/'});
const item=(name='魚肉ソーセージ')=>({name,spec:'3本',variants:[],product_type:'food',verification_state:'needs_review',
 price_state:'priced',valid_from:null,valid_until:null,item_validity:'unconfirmed',source_ordinal:5,
 conditions:['掲載条件未照合'],prices:[{net_yen:198,raw_text:'税抜198円',unit_text:'3本',payment_condition:'会員現金',other_conditions:['1人1点']},
 {net_yen:220,raw_text:'税抜220円',unit_text:'3本',payment_condition:'非会員・カード',other_conditions:[]}]});
function snapshot(rows=[item()]){return {schema:1,date:day,snapshot_date:day,freshness:'current',states:{ok:'checked',iy:'needs_review'},offers:[offer()],
 corpus:{schema:1,store:'iy',corpus_id:'a'.repeat(64),issue_id:'iy-00521-51034',source_kind:'image',logical_faces:1,physical_pdf_pages:null,
 verification_state:'needs_review',obtained_at:'2026-11-21T01:12:27.852Z',source_document:'https://promo.hatobase.jp/flyers/00521/1313/51034',
 document_from:day,document_until:'2026-11-24',pages:[{face:'front',items:rows}]}};}
function render(s){const target=new Element('section');ui.render(doc,target,s,[],s.date);return target;}
test('fallback classification follows the common public fourteen-case contract',()=>{
 for(const [name,category]of contract.fixtures)assert.equal(ui.classify(name),category,name);
});
test('confirmed price remains separate from unproven product dates; menus and auto store are paused',()=>{
 const s=snapshot(),rows=ui.categoryRows(s,day),o=rows.find(r=>r.price_status==='confirmed');
 assert.ok(o);assert.equal(o.item_validity,'unconfirmed');assert.equal(o.valid_from,null);assert.equal(o.edition_from,day);
 const view=render(s);assert.equal(view.all('article').filter(n=>n.className==='supermarket-plan').length,0);
 assert.match(view.text(),/一時停止/);assert.match(view.text(),/価格確認済み/);assert.match(view.text(),/商品別適用日：未確認/);
 assert.equal(ui.paused.meal_plans,true);assert.equal(ui.paused.recommended_stores,true);
});
test('prepared food quotes preserve pack and member conditions, no cheapest value is selected',()=>{
 const rows=ui.categoryRows(snapshot(),day),r=rows.find(r=>r.price_status==='reference');
 assert.equal(r.category,'processed');assert.equal(r.unit,'3本');assert.match(r.price_text,/198円.*会員現金.*1人1点.*220円.*非会員・カード/);
 assert.match(r.price_text,/3本/);assert.equal(r.source,'https://promo.hatobase.jp/flyers/00521/1313/51034');
});
test('DTO cannot manufacture a quote, source, store or category absent from source rows',()=>{
 const s=snapshot(),base=ui.categoryRows(s,day).find(r=>r.price_status==='reference');
 const dto=r=>({schema:1,display_date:day,snapshot_date:day,freshness:'current',categories:[{id:r.category,rows:[r]}]});
 s.category_prices_v1=dto({...base,price_text:'架空の1円'});
 assert.doesNotMatch(ui.categoryRows(s,day)[0].price_text,/架空/);
 for(const change of [{source:'https://evil.example/price'},{store:'life'},{category:'meat'},{id:'wrong-original-row'},{conditions:'not-an-array'}]){
  s.category_prices_v1=dto({...base,...change});assert.deepEqual(ui.categoryRows(s,day),[]);
 }
});
test('unknown price and unknown units stay unranked without guessing a pack',()=>{
 const i=item('卵豆腐');i.prices=[];i.price_state='unreadable';const s=snapshot([i]);s.offers=[offer('豚肉','')];
 const rows=ui.categoryRows(s,day),u=rows.find(r=>r.price_status==='unknown');
 assert.equal(u.category,'processed');assert.equal(u.unit,null);assert.equal(rows.find(r=>r.price_status==='confirmed').unit_status,'unknown');
 const out=render(s);const chip=out.all('button').find(n=>n.textContent.startsWith('加工品'));chip.callbacks.get('click')();
 assert.match(out.text(),/価格不明/);assert.match(out.text(),/順位なし/);assert.match(out.text(),/単位不明/);
});
test('different pack prices are displayed separately without numeric ordering or comparison claims',()=>{
 const s=snapshot();s.offers=[offer('鶏むね肉','100g'),{...offer('鶏むね肉','1パック'),net_yen:900,tax_included_sen:97200}];
 const out=render(s);assert.match(out.text(),/100g/);assert.match(out.text(),/1パック/);assert.match(out.text(),/金額順や最安の判定はしていません/);
 assert.equal(ui.categoryRows(s,day).filter(r=>r.price_status==='confirmed').length,2);
  const c=ui.categoryRows(s,day).filter(r=>r.price_status==='confirmed');
  s.category_prices_v1={schema:1,display_date:day,snapshot_date:day,freshness:'current',categories:[{id:'meat',rows:c.map((r,n)=>({...r,id:'dto:'+n,conditions:r.quote_conditions}))}]};
  assert.deepEqual(ui.categoryRows(s,day).map(r=>r.unit),['100g','1パック']);
  assert.equal(ui.categoryRows(s,day).length,2);
});
test('ambiguous numeric readings remain unknown rather than omitted or price-confirmed',()=>{
 const i=item('豚肉');i.price_state='ambiguous';const s=snapshot([i]);
 const r=ui.categoryRows(s,day).find(r=>r.store==='iy');assert.equal(r.price_status,'unknown');assert.match(r.price_text,/未確認/);
});
test('expired, future or mismatched snapshot never creates current category rows',()=>{
 for(const d of ['2026-11-20','2026-11-22'])assert.deepEqual(ui.categoryRows(snapshot(),d),[]);
 const s=snapshot();s.corpus.document_until='2026-11-20';assert.equal(ui.categoryRows(s,day).filter(r=>r.store==='iy').length,0);
});
test('DTO capacity omissions are disclosed without claiming every stored row is displayed',()=>{
 const s=snapshot();s.category_prices_v1={schema:1,display_date:day,snapshot_date:day,freshness:'current',categories:[],display_counts:{total:100,shown:0,omitted:100}};
 assert.match(render(s).text(),/全100行.*省略100行/);
});

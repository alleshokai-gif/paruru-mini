'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ui = f => fs.readFileSync(path.join(__dirname, '../features/shopping', f), 'utf8');

function setup() {
  class Element {
    constructor(tag) {
      this.tagName = tag; this.children = []; this.textContent = ''; this.hidden = true;
      this.callbacks = new Map(); this.attributes = {};
    }
    addEventListener(type, fn) { this.callbacks.set(type, fn); }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    querySelectorAll() { return []; }
    reset() {}
    setAttribute(key, val) { this.attributes[key] = val; }
    all(tag) { return this.children.flatMap(x => [...(x.tagName === tag ? [x] : []), ...x.all(tag)]); }
    text() { return this.textContent + this.children.map(x => x.text()).join(' '); }
  }
  const nodes = new Map();
  const listeners = new Map();
  const document = {
    addEventListener: (type, fn) => listeners.set(type, fn),
    getElementById: id => {
      if (!nodes.has(id)) nodes.set(id, new Element('div'));
      return nodes.get(id);
    },
    createElement: tag => new Element(tag),
  };
  const env = vm.createContext({document, URL, Intl, Date, location: {hostname:'paluru.example.test'}});
  vm.runInContext(ui('supermarket-poc.js'), env);
  vm.runInContext(ui('page.js'), env);
  const preview = nodes.get('supermarketPocPreview');
  const date = env.PALURUSupermarketPoc.dayTokyo();
  function open() {
    let p;
    listeners.get('shopping:opened')({detail:{waitUntil: promise => {p=promise;}}});
    return p;
  }
  return {
    preview, date, open,
    authenticate: shoppingApi => listeners.get('paruru:authenticated')({detail:{shoppingApi}}),
    lock: listeners.get('kaz-os:locked'),
    list: nodes.get('shoppingPending'),
  };
}

const item = {item_id:'a'.repeat(32),name:'納豆',quantity:1,unit:'組',memo:'',status:'pending',revision:1,due_date:null,updated_at:'2026-11-19T07:00:00.000Z'};
test('versioned previous-day status does not promote edition dates and is distinct from missing data', async () => {
  const app = setup();
  const yesterday = new Date(app.date + 'T00:00:00Z'); yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const previous = yesterday.toISOString().slice(0,10);
  const data = result(app.date);
  Object.assign(data.supermarketPoc, {snapshot_date:previous, freshness:'previous_day',offers:[],
    carry_forward_status:'item_validity_unproven',
    plans:[{name:'DO NOT REUSE YESTERDAY PLAN'}]});
  data.supermarketPreviousDayV1=data.supermarketPoc;
  delete data.supermarketPoc;
  app.authenticate(async () => data);
  await app.open();
  assert.equal(app.preview.all('article').filter(e => e.className === 'supermarket-plan').length,0);
  assert.match(app.preview.text(), /本日の再収集ではありません/);
  assert.match(app.preview.text(), /前日照合（当日再取得なし）/);
  assert.ok(app.preview.text().includes(previous));
  assert.ok(!app.preview.text().includes('DO NOT REUSE YESTERDAY PLAN'));
  assert.match(app.preview.text(), /商品別の適用日の根拠が未確認/);
  data.supermarketPreviousDayV1.carry_forward_status = 'no_offers';
  await app.open();
  assert.match(app.preview.text(), /本日の再収集ではありません/);
  assert.equal(app.preview.all('article').length,0);
  assert.ok(!app.preview.text().includes('商品別の適用日の根拠が未確認'));
  delete data.supermarketPreviousDayV1;
  await app.open();
  assert.ok(!app.preview.text().includes('本日の再収集ではありません'));
  assert.ok(app.list.text().length > 0);
});

test('raw yesterday, future or older projection metadata and reference prices cannot enter menus', async () => {
  const app = setup();
  const data = result(app.date);
  app.authenticate(async () => data);
  for (const patch of [
    {date:'2000-01-01'},
    {date:app.date, snapshot_date:'2000-01-01',freshness:'previous_day'},
    {date:app.date, snapshot_date:'2999-01-01',freshness:'previous_day'},
    {date:app.date, snapshot_date:app.date,freshness:'previous_day'},
  ]) {
    Object.assign(data.supermarketPoc,patch);
    await app.open();
    assert.equal(app.preview.all('article').filter(e=>e.className==='supermarket-plan').length,0);
  }
  Object.assign(data.supermarketPoc,{snapshot_date:app.date,freshness:'current'});
  data.supermarketPoc.offers=data.supermarketPoc.offers.map(o=>({...o,confidence:'reference'}));
  await app.open();
  assert.equal(app.preview.all('article').length,0);
});

function result(date, state='checked') {
  const offers = ['鶏むね肉','銀鮭','ラム','納豆'].map(title => ({title,store:'ok',from:date,until:date,confidence:'ocr_validated',
    kind:'weekly_information',source:'https://ok-corporation.jp/',spec:'規格',unit:'100g',net_yen:199,tax_included_sen:21492,conditions:'非会員価格'}));
  return {items:[item],supermarketPoc:{schema:1,date,states:{ok:state,iy:'held',maruetsu:'failed',life:'unchanged',rosen:'needs_review',yaoko:'expired'},offers}};
}

test('PALURU real-host UI uses the existing authenticated list result and shows six coverage states', async () => {
  const app = setup();
  assert.equal(await app.open(), false);
  assert.equal(app.preview.hidden,true);
  let reads=0;
  app.authenticate(async ({action}) => { assert.equal(action,'list'); reads++; return result(app.date); });
  assert.equal(await app.open(),true);
  assert.equal(reads,1);
  assert.equal(app.preview.hidden,false);
  assert.equal(app.preview.all('article').length,3);
  assert.equal(app.preview.all('li').length,6);
  assert.match(app.preview.text(),/オーケー 溝ノ口店/);
  assert.match(app.preview.text(),/納豆/);
  assert.match(app.preview.text(),/6店舗の合計額を比較したものではありません/);
  assert.match(app.preview.text(),/取得失敗/);
  assert.match(app.list.text(),/納豆/);
});
test('whole-paper readings retain nonfood and no-price rows outside confirmed prices and menus',async()=>{
 const app=setup(),data=result(app.date);
 data.supermarketPoc.corpus={schema:1,verification_state:'needs_review',issue_id:'fixture-issue',physical_pdf_pages:1,logical_faces:2,obtained_at:app.date+'T00:00:00Z',source_document:'https://ok-corporation.jp/media-download/1/abcdef/PDF/',pages:[
  {face:'front',items:[{name:'日用品の読取',product_type:'nonfood',variants:[],conditions:[],prices:[{raw_text:'100円',unit_text:'1個'}]}]},
  {face:'back',items:[{name:'価格を載せていない野菜',product_type:'food',price_state:'not_printed',prices:[]}]}
 ]};
 app.authenticate(async()=>data);assert.equal(await app.open(),true);
 assert.equal(app.preview.all('article').filter(e=>e.className==='supermarket-plan').length,3);
 assert.equal(app.preview.all('article').filter(e=>e.className==='supermarket-corpus-item').length,2);
 assert.match(app.preview.text(),/全紙面のAI読取（2枠・条件未照合）/);assert.match(app.preview.text(),/価格非掲載/);
 assert.match(app.preview.text(),/確定売価ではなく/);assert.match(app.list.text(),/納豆/);
 app.lock();assert.ok(!app.preview.text().includes('日用品の読取'));
});

test('stale or omitted offers and failed source do not suppress existing shopping items', async () => {
  const app = setup();
  let data = {items:[item]};
  app.authenticate(async () => data);
  assert.equal(await app.open(),true);
  assert.equal(app.preview.all('article').length,0);
  assert.match(app.preview.text(),/チラシ情報を確認できません/);
  data=result('2000-01-01');
  assert.equal(await app.open(),true);
  assert.equal(app.preview.all('article').length,0);
  data=result(app.date,'failed');
  assert.equal(await app.open(),true);
  assert.equal(app.preview.all('article').length,0);
  assert.match(app.list.text(),/納豆/);
});

test('two DOM issues remain separately visible beside the original OK paper without menu promotion',async()=>{
 const app=setup(),data=result(app.date),item={name:'fixture household product',product_type:'nonfood',price_state:'not_printed',prices:[]};
 const issue=id=>({schema:1,store:'rosen',source_kind:'dom',logical_views:6,verification_state:'needs_review',issue_id:id,obtained_at:app.date+'T00:00:00Z',source_document:'https://rosen.mikke-sales.com/stores/taira/flyers/1',pages:[{face:'category-0',label:'家庭用品',items:[item]}]});
 data.supermarketPoc.corpus={schema:2,verification_state:'needs_review',catalogs:[issue('fixture-one'),issue('fixture-two')]};
 data.supermarketPoc.corpus_status='partial';
 app.authenticate(async()=>data);assert.equal(await app.open(),true);
 assert.equal(app.preview.all('details').filter(e=>e.className==='supermarket-corpus').length,2);
 assert.equal(app.preview.all('article').filter(e=>e.className==='supermarket-plan').length,3);
 assert.match(app.preview.text(),/fixture-one/);assert.match(app.preview.text(),/fixture-two/);assert.match(app.preview.text(),/6 日付・カテゴリ表示/);
 assert.match(app.preview.text(),/家庭用品/);assert.match(app.preview.text(),/省略しています/);
 assert.equal(app.preview.all('a').filter(e=>e.href==='https://rosen.mikke-sales.com/stores/taira/flyers/1').length,2);
 app.lock();assert.ok(!app.preview.text().includes('fixture household product'));
});

test('reference corpus counts numeric-price frames separately from unknown and discount-only frames',async()=>{
 const app=setup(),data=result(app.date);
 data.supermarketPoc.states.iy='checked';data.supermarketPoc.states.life='checked';
 data.supermarketPoc.offers.push({...data.supermarketPoc.offers[0],store:'iy',title:'確認済追加品1'},
  {...data.supermarketPoc.offers[0],store:'life',title:'確認済追加品2'});
 const before=JSON.stringify(data.supermarketPoc.offers);
 const row=(name,price_state,prices)=>({name,price_state,prices,variants:[],conditions:[]});
 data.supermarketPoc.corpus={schema:1,store:'rosen',source_kind:'dom',verification_state:'needs_review',issue_id:'rosen-taira-5170',logical_views:150,
  document_from:'2026-11-01',document_until:'2026-11-30',obtained_at:app.date+'T00:00:00Z',pages:[{face:'category-0',label:'家庭用品',items:[
   row('本体価格の参考','priced',[{net_yen:100,tax_included_yen:null,raw_text:'本体100円'}]),
   row('税込価格の参考','priced',[{net_yen:null,tax_included_yen:108,raw_text:'税込108円'},{net_yen:200,raw_text:'よりどり200円'}]),
   row('価格不明','unreadable',[]),row('割引のみ','discount_only',[{discount_percent:20,raw_text:'20%引'}]),
   row('文字列は数値価格にしない','priced',[{net_yen:'100',raw_text:'100円'}]),
   row('割引欄の数字も価格未確認','discount_only',[{net_yen:100,raw_text:'価格対応不明の割引'}])
  ]}]};
 app.authenticate(async()=>data);assert.equal(await app.open(),true);
 const corpus=app.preview.all('details').find(e=>e.className==='supermarket-corpus');
 assert.match(corpus.text(),/店舗：そうてつローゼン たいら店 \/ 号：rosen-taira-5170/);
 assert.match(corpus.text(),/参考価格あり 2枠・価格未確認 4枠・確定0枠（この読取内）/);
 assert.match(corpus.text(),/紙面期間：2026-11-01〜2026-11-30。商品ごとの販売日は未確認/);
 assert.equal(app.preview.all('article').filter(e=>e.className==='supermarket-plan').length,3);
 assert.equal(JSON.stringify(data.supermarketPoc.offers),before);assert.match(app.list.text(),/納豆/);
 const offers=app.preview.all('details').find(e=>e.className==='supermarket-offers');
 assert.match(offers.text(),/当日有効な掲載商品（6件）/);assert.doesNotMatch(offers.text(),/本体価格の参考|割引欄の数字/);
});

test('late response after lock or identity replacement never reveals the previous list or offers', async () => {
  const app=setup();
  let resolve;
  app.authenticate(() => new Promise(r => { resolve=r; }));
  const first=app.open();
  assert.equal(await app.open(), false);
  app.lock();
  resolve(result(app.date));
  assert.equal(await first,false);
  assert.equal(app.preview.hidden,true);
  assert.equal(app.preview.text(),'');
  assert.equal(app.list.text(),'');
  app.authenticate(() => new Promise(r => { resolve=r; }));
  const old=app.open();
  app.authenticate(async () => ({items:[]}));
  await app.open();
  resolve(result(app.date));
  assert.equal(await old,false);
  assert.equal(app.preview.all('article').length,0);
  assert.doesNotMatch(app.preview.text(),/納豆/);
});

test('verified offers from additional stores remain inspectable outside the unchanged menu selection',async()=>{
  const app=setup();const data=result(app.date);
  data.supermarketPoc.states.iy='checked';
  const iy={...data.supermarketPoc.offers[0],store:'iy',title:'塩銀鮭',unit:'1パック',net_yen:1000,tax_included_sen:108000};
  data.supermarketPoc.offers.push(iy,{...iy,title:'期限切れ採用禁止',until:'2000-01-01'},
    {...iy,title:'保留店採用禁止',store:'rosen'});
  app.authenticate(async()=>data);await app.open();
  assert.equal(app.preview.all('article').length,3);
  assert.equal(app.preview.all('li').length,6);
  const details=app.preview.all('details');assert.equal(details.length,1);
  assert.match(details[0].text(),/塩銀鮭/);assert.match(details[0].text(),/1000円 \/ 1パック/);
  assert.match(details[0].text(),/1080\.00円/);assert.match(details[0].text(),/5件/);
  assert.doesNotMatch(details[0].text(),/採用禁止/);
});

test('main selection groups confirmed offers, filters by store and compares only identical specs',async()=>{
  const app=setup(),data=result(app.date);
  data.supermarketPoc.states.iy='checked';
  const base=data.supermarketPoc.offers[1];
  data.supermarketPoc.offers.push({...base,store:'iy',net_yen:250,tax_included_sen:27000},
    {...base,store:'iy',title:'銀鮭',spec:'別規格',unit:'1切',net_yen:100,tax_included_sen:10800},
    {...base,store:'iy',title:'キャベツ',spec:'1玉',unit:'1玉',net_yen:150,tax_included_sen:16200},
    {...base,store:'iy',title:'期限切れ',until:'2000-01-01'});
  app.authenticate(async()=>data);await app.open();
  const picker=app.preview.children.find(c=>c.className==='supermarket-picker');
  assert.ok(picker);
  assert.match(picker.text(),/肉（/);assert.match(picker.text(),/魚（/);assert.match(picker.text(),/野菜（/);
  assert.match(picker.text(),/同じ品名・規格・単位の掲載/);
  assert.match(picker.text(),/単位の換算や全店の最安・合計は示しません/);
  assert.doesNotMatch(picker.text(),/期限切れ/);
  const chip=text=>picker.all('button').find(b=>b.textContent.startsWith(text));
  chip('ヤオコー').callbacks.get('click')();
  assert.match(picker.text(),/ヤオコー 川崎枡形店：期限切れ。今日の確認済み商品はありません/);
  assert.equal(chip('ヤオコー').attributes['aria-pressed'],'true');
  assert.equal(app.preview.all('li').length,6);
});

function imageCorpus(store,source_document) {
 return {schema:1,store,source_kind:'image',verification_state:'needs_review',issue_id:store+'-fixture',
  physical_pdf_pages:null,logical_faces:1,obtained_at:'2026-11-20T00:00:00Z',source_document,
  document_from:'2026-11-18',document_until:'2026-11-24',coverage:{state:'partial'},
  pages:[{face:'front',items:[{name:'参考候補',product_type:'food',price_state:'priced',
   prices:[{role:'reference_basis',net_yen:99,raw_text:'99円'}],
   validity_raw_text:'20（金）限り',variants:[],conditions:[]}]}]};
}

test('Maruetsu saved reference links only the exact existing 3541 print source without clearing failure or authorizing recommendations',async()=>{
 const source='https://tokubai.co.jp/%E3%83%9E%E3%83%AB%E3%82%A8%E3%83%84/3541/leaflets/108663201/print';
 for(const url of [source,source.replace('/3541/','/3542/'),source.replace('108663201','108663202'),source+'?other=1',source+'#other']){
  const app=setup(),data=result(app.date),before=JSON.stringify(data.supermarketPoc.offers);data.supermarketPoc.corpus=imageCorpus('maruetsu',url);data.supermarketPoc.corpus.document_from=null;data.supermarketPoc.corpus.document_until=null;
  app.authenticate(async()=>data);await app.open();const reading=app.preview.all('details').find(e=>e.className==='supermarket-corpus');
  assert.ok(reading);assert.equal(reading.all('a').length,url===source?1:0);if(url===source)assert.equal(reading.all('a')[0].href,source);
  assert.match(reading.text(),/マルエツ 川崎坂戸店/);assert.match(reading.text(),/確定0枠/);assert.match(reading.text(),/観測1面/);assert.equal(data.supermarketPoc.states.maruetsu,'failed');assert.equal(JSON.stringify(data.supermarketPoc.offers),before);assert.equal(app.preview.all('article').filter(e=>e.className==='supermarket-plan').length,3);
 }
});

test('partial image observations show exact store sources, observed extent and saved/displayed counts',async()=>{
 const app=setup(),data=result(app.date),offersBefore=JSON.stringify(data.supermarketPoc.offers);
 const catalogs=[
  imageCorpus('iy','https://promo.hatobase.jp/flyers/00521/1298/50089'),
  imageCorpus('yaoko','https://yap-pd.yaoko-net.com/app/flyer/1221/'),
  imageCorpus('life','https://store.lifecorp.jp/detail/east648/')
 ];
 catalogs[0].display_counts={total:10,shown:1,omitted:9};
 catalogs[1].display_counts={total:93,shown:1,omitted:92};
 catalogs[2].display_counts={total:2,shown:1,omitted:1};
 data.supermarketPoc.corpus={schema:2,verification_state:'needs_review',catalogs};
 app.authenticate(async()=>data);await app.open();
 assert.match(app.preview.text(),/保存全105枠 \/ 画面3枠 \/ 未表示102枠/);
 const readings=app.preview.all('details').filter(e=>e.className==='supermarket-corpus');
 assert.equal(readings.length,3);
 assert.match(readings[1].text(),/ヤオコー 川崎枡形店/);
 assert.match(readings[1].text(),/保存全93枠 \/ 画面1枠 \/ 未表示92枠/);
 for(const [index,reading] of readings.entries()) {
  assert.match(reading.text(),/観測1面 \/ 全号枚数未確認/);
  assert.match(reading.text(),/保存記録の時刻（実取得時刻は未確認） 2026-11-20T00:00:00Z/);
  assert.match(reading.text(),/参考価格あり 1枠・価格未確認 0枠・確定0枠/);
  assert.match(reading.text(),/期間は原本との対応要確認/);
  assert.match(reading.text(),/部分データ/);assert.match(reading.text(),/表（1枠）/);
  assert.doesNotMatch(reading.text(),/null PDF|PDF null|全紙面のAI|商品ごとの販売日は未確認|学芸大学/);
  const links=reading.all('a');assert.equal(links.length,1);
  assert.equal(links[0].href,catalogs[index].source_document);
  assert.equal(links[0].textContent,'公式のチラシ原本');
  assert.equal(links[0].rel,'noopener noreferrer');
 }
 assert.equal(app.preview.all('li').length,6);
 assert.equal(app.preview.all('article').filter(e=>e.className==='supermarket-plan').length,3);
 assert.equal(JSON.stringify(data.supermarketPoc.offers),offersBefore);
 assert.match(app.list.text(),/納豆/);
});

test('new reference links reject other stores, paths, query strings and nonimage sources',async()=>{
 const forbidden=[
  ['iy','https://promo.hatobase.jp/flyers/00522/1298/50089'],
  ['iy','https://promo.hatobase.jp/flyers/00521/1298/50089?next=other'],
  ['yaoko','https://yap-pd.yaoko-net.com/app/flyer/1210/'],
  ['yaoko','https://yap-pd.yaoko-net.com/assets/flyer/1210/flyer_C_0_1794796304.jpg'],
  ['yaoko','https://yap-pd.yaoko-net.com/app/flyer/1221/#other'],
  ['life','https://store.lifecorp.co.jp/detail/east648/'],
  ['life','https://store.lifecorp.jp/detail/east649/'],
  ['life','https://store.lifecorp.jp.example.test/detail/east648/'],
  ['iy','https://yap-pd.yaoko-net.com/app/flyer/1221/'],
  ['maruetsu','https://store.lifecorp.jp/detail/east648/']
 ];
 for(const [store,url] of forbidden) {
  const app=setup(),data=result(app.date);data.supermarketPoc.corpus=imageCorpus(store,url);
  app.authenticate(async()=>data);await app.open();
  const reading=app.preview.all('details').find(e=>e.className==='supermarket-corpus');
  assert.equal(reading.all('a').length,0,url);
 }
 const app=setup(),data=result(app.date);
 data.supermarketPoc.corpus={...imageCorpus('yaoko','https://yap-pd.yaoko-net.com/app/flyer/1221/'),source_kind:'dom'};
 app.authenticate(async()=>data);await app.open();
 assert.equal(app.preview.all('details').find(e=>e.className==='supermarket-corpus').all('a').length,0);
});

test('display totals accept consistent integer legacy counts and ignore inconsistent metadata',async()=>{
 const app=setup(),data=result(app.date),corpus=imageCorpus('yaoko','https://yap-pd.yaoko-net.com/app/flyer/1221/');
 data.supermarketPoc.corpus=corpus;
 corpus.display_total_frames=93;corpus.displayed_frames=1;
 app.authenticate(async()=>data);await app.open();
 assert.match(app.preview.text(),/保存全93枠 \/ 画面1枠 \/ 未表示92枠/);
 for(const counts of [{total:'93',shown:1,omitted:92},{total:93,shown:2,omitted:91},
  {total:93,shown:1,omitted:91},{total:-1,shown:1,omitted:-2}]) {
  corpus.display_counts=counts;
  await app.open();assert.doesNotMatch(app.preview.text(),/保存全/);
 }
});


test('comparison does not merge recommendation aliases and reference badge requires a numeric reading',async()=>{
 const app=setup(),data=result(app.date);
 data.supermarketPoc.offers=[{...data.supermarketPoc.offers[0],title:'鶏むね肉',store:'ok',spec:'100g',unit:'100g'},
  {...data.supermarketPoc.offers[0],title:'鶏むね',store:'iy',spec:'100g',unit:'100g'}];
 data.supermarketPoc.states.iy='checked';
 data.supermarketPoc.corpus={schema:1,store:'life',source_kind:'image',verification_state:'needs_review',issue_id:'synthetic',physical_pdf_pages:null,logical_faces:1,obtained_at:app.date+'T00:00:00Z',pages:[{face:'front',items:[{name:'合成・価格文字のみ',product_type:'food',price_state:'unreadable',prices:[{raw_text:'判読できない価格',net_yen:'100',tax_included_yen:null}]}]}]};
 app.authenticate(async()=>data);await app.open();
 assert.equal(app.preview.all('div').filter(e=>e.className==='supermarket-compare').length,0);
 const corpus=app.preview.all('details').find(e=>e.className==='supermarket-corpus');
 assert.match(corpus.text(),/参考価格あり 0枠・価格未確認 1枠/);
 assert.equal(corpus.all('span').filter(e=>e.className==='supermarket-badge is-reference').length,0);
 assert.equal(corpus.all('span').filter(e=>e.className==='supermarket-badge is-unknown').length,1);
});

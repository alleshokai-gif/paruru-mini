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

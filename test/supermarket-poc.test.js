const test = require('node:test');
const assert = require('node:assert/strict');
const poc = require('../features/shopping/supermarket-poc.js');

const date = '2026-11-20';
const pdf = 'https://ok-corporation.jp/media-download/1764/f75516cf12ff8d76/PDF/';
const index = url => '<h3>【関東】商品情報紙11月16日号</h3><p>※清瀬店は除きます。</p><a href="' + url + '">PDF</a><h3>他地域</h3>';
const row = (title, unit = '100g') => ({title,spec:'テスト規格',unit,net_yen:100,tax_included_sen:10800,conditions:'非会員・カード払',kind:'weekly_information'});
const edition = {store:'ok',source:pdf,from:'2026-11-16',until:'2026-11-22',
  offers:[row('若鶏むね肉'),row('銀鮭'),row('ラムもも肉'),row('納豆','1組')]};
const fakeFetch = (response, calls = []) => async url => {
  calls.push(url);
  const args = {'headers':{'Content-Type':'text/plain;charset=utf-8'}};
  return String(url).endsWith('robots.txt') ?
    new Response(response.robots || '', {...args,status:response.robots ? 200 : 404}) :
    new Response(response.html || '', {...args,status:response.status || 200});
};

test('collects only official index, waits for review and safely reconciles an unchanged issue', async () => {
  const {openDb, collect, snapshot, verifyImport} = await import('../scripts/supermarket/collector.mjs');
  const db = openDb(':memory:'); const calls = [];
  try {
    const r = await collect(db,date,fakeFetch({html:index(pdf)},calls));
    assert.equal(r.states.ok,'needs_review'); assert.equal(Object.keys(r.states).length,6);
    assert.deepEqual(calls,['https://ok-corporation.jp/robots.txt','https://ok-corporation.jp/flyer/']);
    assert.deepEqual(r.offers,[]);
    assert.deepEqual(verifyImport(db,edition),{duplicate:false,offers:4});
    assert.deepEqual(verifyImport(db,edition),{duplicate:true,offers:4});
    assert.throws(() => verifyImport(db,{...edition,offers:[row('異なる価格')] }),/EDITION_CONFLICT/);
    const observed = snapshot(db,date);
    assert.equal(observed.offers.length,4);
    assert.equal(observed.offers[0].net_yen,100);
    assert.equal(observed.offers[0].source,pdf);
    assert.equal((await collect(db,date,fakeFetch({html:index(pdf)}))).states.ok,'unchanged');
    assert.equal((await collect(db,'2026-11-23',fakeFetch({html:index(pdf)}))).states.ok,'expired');
    assert.equal(snapshot(db,'2026-11-23').offers.length,0);
  } finally { db.close(); }
});

test('store failure, scope drift, robots and changed documents fail closed', async () => {
  const {openDb, collect, verifyImport, snapshot} = await import('../scripts/supermarket/collector.mjs');
  const db = openDb(':memory:');
  try {
    await collect(db,date,fakeFetch({html:index(pdf)}));
    assert.throws(() => verifyImport(db,{...edition,from:'2026-11-31'}),/INVALID_EDITION/);
    verifyImport(db,edition);
    const newer = pdf.replace('/1764/','/1765/');
    const next = await collect(db,date,fakeFetch({html:index(newer)}));
    assert.equal(next.states.ok,'needs_review');
    assert.equal(snapshot(db,date).offers.length,0);
    const denyCalls = [];
    const deny = await collect(db,date,fakeFetch({html:index(newer),robots:'User-agent: *\nDisallow: /'},denyCalls));
    assert.equal(deny.states.ok,'failed');
    assert.equal(deny.sources.find(x => x.store === 'ok').error,'ROBOTS_POLICY_REVIEW_REQUIRED');
    assert.equal(denyCalls.length,1);
    const http = await collect(db,date,fakeFetch({status:429}));
    assert.equal(http.sources.find(x => x.store === 'ok').error,'HTTP_429');
    assert.equal(http.states.life,'held');
    const drift = await collect(db,date,fakeFetch({html:index(pdf).replace('清瀬','溝ノ口')}));
    assert.equal(drift.sources.find(x => x.store === 'ok').error,'INDEX_FORMAT_OR_SCOPE_CHANGED');
  } finally { db.close(); }
});

test('three one-store plans reuse pending list and omit invalid/future prices', () => {
  const offers = edition.offers.map(o => ({...o,store:'ok',source:pdf,from:edition.from,until:edition.until,confidence:'visually_verified'}));
  const shopping = [{name:'納豆',status:'pending'},{name:'牛乳',status:'pending'},{name:'醤油',status:'pending',due_date:'2026-11-25'},
    {name:'お茶',status:'purchased'}];
  const plans = poc.recommend({schema:1,date,states:{ok:'checked'},offers},shopping,date);
  assert.equal(plans.length,3);
  for (const p of plans) {
    assert.equal(p.store,'オーケー 溝ノ口店');
    assert.deepEqual(p.listed,['納豆']); assert.deepEqual(p.unknown,['牛乳']); assert.equal(p.total,undefined);
  }
  assert.equal(poc.recommend({schema:1,date:'2026-11-24',offers},shopping,'2026-11-24').length,0);
  assert.equal(poc.recommend({schema:1,date,states:{ok:'checked'},offers:offers.map(o => ({...o,source:'javascript:alert(1)'}))},shopping,date).length,0);
  assert.equal(poc.dayTokyo(new Date('2026-11-19T15:10:00.000Z')),date);
});

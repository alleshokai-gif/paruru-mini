'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const remote = 'https://ok-corporation.jp';
const source = remote+'/media-download/1764/f75516cf12ff8d76/PDF/';
const img = remote+'/archives/001/202611/0bf5efc12c2c08a6.jpg';
const page = (sourceUrl = source, imageUrl = img) => '<h3>【関東】商品情報紙11月16日号</h3><p>※清瀬店は除きます。</p>' +
  '<img alt="【関東】オーケー商品情報 表" data-src="' + imageUrl + '"><a href="' + sourceUrl + '">PDF</a><h3>他地域</h3>';
const scan = {from:'2026-11-16',until:'2026-11-22',offers:[{title:'若鶏むね肉',
  spec:'1枚入・2枚入',unit:'100g',net_yen:85,tax_included_sen:9180,
  conditions:'非会員・カード払',kind:'weekly_information'}]};
function fake(calls, html=page(), status=404) {
  return async url => {
    calls.push(url);
    if (url.endsWith('/robots.txt')) return new Response('',{status,headers:{'Content-Type':'text/plain'}});
    if (url.endsWith('/flyer/')) return new Response(html,{headers:{'Content-Type':'text/html'}});
    if (url === img) return new Response(Uint8Array.of(255,216,255,217),{headers:{'Content-Type':'image/jpeg'}});
    throw new Error('UNEXPECTED_REQUEST');
  };
}

test('real parser route only reads official chosen asset, commits provenance and suppresses repeated reads', async () => {
  const {collect,openDb,snapshot} = await import('../scripts/supermarket/collector.mjs');
  const db = openDb(':memory:'); const calls = []; let ocrCount = 0;
  const opts = {daily:true,ocr:async (bytes,edition) => {
    assert.equal(bytes.length,4); assert.equal(edition.image,img); ocrCount++; return scan;
  }};
  const fetch = fake(calls);
  try {
    let got = await collect(db,'2026-11-20',fetch,opts);
    assert.equal(got.states.ok,'checked');
    assert.equal(got.offers[0].confidence,'ocr_validated');
    assert.equal(got.offers[0].source,source);
    assert.equal(got.sources.find(x => x.store === 'maruetsu').source,'https://www.maruetsu.co.jp/store/9245/');
    assert.deepEqual(calls,[remote+'/robots.txt',remote+'/flyer/',img]);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM editions').get().n,1);
    const ev = db.prepare('SELECT * FROM ocr_evidence').get();
    assert.equal(ev.image_source,img); assert.match(ev.image_sha256,/^[a-f0-9]{64}$/);
    got = await collect(db,'2026-11-20',fetch,opts);
    assert.equal(got.states.ok,'checked'); assert.equal(calls.length,3); assert.equal(ocrCount,1);
    got = await collect(db,'2026-11-21',fetch,opts);
    assert.equal(got.states.ok,'unchanged'); assert.equal(calls.length,5); assert.equal(ocrCount,1);
    got = await collect(db,'2026-11-23',fetch,opts);
    assert.equal(got.states.ok,'expired'); assert.equal(calls.length,7); assert.equal(ocrCount,1);
    assert.equal(snapshot(db,'2026-11-23').offers.length,0);
  } finally { db.close(); }
});

test('unexpected asset/robots rejection are persisted and not retried the same day', async () => {
  const {collect,openDb} = await import('../scripts/supermarket/collector.mjs');
  const db = openDb(':memory:'); const calls = [];
  const opts = {daily:true,ocr:async () => { throw new Error('OCR_SHOULD_NOT_RUN'); }};
  try {
    let got = await collect(db,'2026-11-20',fake(calls,page(source,'https://example.test/a.jpg')),opts);
    assert.equal(got.states.ok,'failed');
    assert.equal(got.sources.find(x => x.store === 'ok').error,'OCR_SOURCE_MISSING');
    assert.equal(calls.length,2);
    got = await collect(db,'2026-11-20',fake(calls),opts);
    assert.equal(got.states.ok,'failed'); assert.equal(calls.length,2);
    got = await collect(db,'2026-11-21',fake(calls,page(),403),opts);
    assert.equal(got.sources.find(x => x.store === 'ok').error,'HTTP_403'); assert.equal(calls.length,3);
  } finally { db.close(); }
});

test('rejects confusing dates, unit, price or member condition rather than guessing', async () => {
  const {datesFromOcr,validateCard} = await import('../scripts/supermarket/ok-ocr.mjs');
  const e = {image:img,month:11,startDay:16};
  assert.deepEqual(datesFromOcr(e,'11/16','11/22'),{from:'2026-11-16',until:'2026-11-22'});
  for (const end of ['11/99','11/2','12/22','11/2O','11/22(日)']) assert.equal(datesFromOcr(e,'11/16',end),null);
  assert.equal(datesFromOcr(e,'11/17','11/22'),null);
  const card = {title:'若鶏むね肉',spec:'1枚入・2枚入',labelOk:s=>s==='鶏肉'};
  const bits = {label:'鶏肉',unit:'100g当たり',condition:'非会員・カード払価格は',net:'85',again:'85',tax:'91.'};
  assert.equal(validateCard(card,bits).tax_included_sen,9180);
  for (const invalid of [{net:'83'}, {tax:'89'}, {again:'83'}, {unit:'100円'}, {condition:'会員現金払'}, {label:'納豆'}]) {
    assert.equal(validateCard(card,{...bits,...invalid}),null);
  }
});

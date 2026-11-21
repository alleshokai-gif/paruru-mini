'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const verified={label:'宮城県産など\n塩 銀 魚\n養殖・甘口)',days:'18&19&208号',half:'半身',unit:'1 パッ ク',
  net:'1,000',again:'1,000',tax:'1,080 )'};

test('current IY offer requires matching product, pack, two numeric passes and tax',async()=>{
  const {validateIySalmon}=await import('../scripts/supermarket/iy-ocr.mjs');
  const got=validateIySalmon(verified);
  assert.equal(got.unit,'1パック');assert.equal(got.net_yen,1000);assert.equal(got.tax_included_sen,108000);
  for(const bad of [{label:'銀鮭'}, {label:'塩銀鮭 甘口'}, {half:'切身'}, {unit:'100g'},
    {days:'18&19のみ'}, {net:'100'}, {again:'000'}, {tax:'1,180'}, {net:'1O00'}]) {
    assert.equal(validateIySalmon({...verified,...bad}),null,JSON.stringify(bad));
  }
});

const page=(source,image)=>'<title>イトーヨーカドー 溝ノ口店</title><meta content="'+source+'">'+
  '<meta name="description" content="11/18(水)〜11/22(日)"><link href="'+image+'">';
test('IY follows the normal official SSR page, never assumes another paper or year',async()=>{
  const {identifyIyEdition,IY_SOURCE,IY_IMAGE}=await import('../scripts/supermarket/iy-ocr.mjs');
  const html=page(IY_SOURCE,IY_IMAGE);
  assert.equal(identifyIyEdition(html,'2026-11-20').until,'2026-11-20');
  for(const wrong of [html.replace('00521','00522'),html.replace('溝ノ口','別店舗'),
    html.replace('11/22','11/29'),html+'<meta name="robots" content="nofollow">']) {
    assert.throws(()=>identifyIyEdition(wrong,'2026-11-20'));
  }
  assert.throws(()=>identifyIyEdition(html,'2027-11-20'));
});

test('IY is isolated from OK, persists provenance and never re-reads a same-day edition',async()=>{
  const {collectIy,openDb,snapshot}=await import('../scripts/supermarket/collector.mjs');
  const {IY_SOURCE,IY_IMAGE}=await import('../scripts/supermarket/iy-ocr.mjs');
  const db=openDb(':memory:');const calls=[];
  const fetcher=async url=>{
    calls.push(url);
    if(url.endsWith('/robots.txt'))return new Response('',{status:404});
    if(url===IY_SOURCE)return new Response(page(IY_SOURCE,IY_IMAGE),{headers:{'Content-Type':'text/html'}});
    if(url===IY_IMAGE)return new Response(Uint8Array.of(255,216,255,217),{headers:{'Content-Type':'image/jpeg'}});
    throw new Error('unexpected source');
  };
  const opts={ocr:async()=>({from:'2026-11-18',until:'2026-11-20',offers:[{
    title:'塩銀鮭',spec:'養殖・甘口・半身',unit:'1パック',net_yen:1000,tax_included_sen:108000,conditions:'11/18〜20限定',kind:'special'}]})};
  try{
    db.prepare('INSERT INTO status VALUES(?,?,?,?,?,?)').run('ok','2026-11-20','checked','existing',null,null);
    let r=await collectIy(db,'2026-11-20',fetcher,opts);
    assert.equal(r.states.ok,'checked');assert.equal(r.states.iy,'checked');assert.equal(r.offers.length,1);
    assert.equal(calls.length,4);assert.ok(calls.every(u=>!u.includes('/images')&&!u.includes('ok-corporation')));
    assert.equal(db.prepare('SELECT parser FROM ocr_evidence').get().parser,'iy-00521-20261118-front-v1');
    await collectIy(db,'2026-11-20',fetcher,opts);assert.equal(calls.length,4);
    // The old fixture has no official-store chain. Future discovery fails
    // closed there rather than calling the old product template again.
    r=await collectIy(db,'2026-11-21',fetcher,opts);assert.equal(calls.length,6);
    assert.equal(r.states.iy,'failed');assert.equal(snapshot(db,'2026-11-21').offers.length,0);
  } finally{db.close();}
});

test('IY failure is durable and does not alter OK or silently repeat requests',async()=>{
  const {collectIy,openDb}=await import('../scripts/supermarket/collector.mjs');
  const db=openDb(':memory:');let calls=0;
  try{
    const fetcher=async()=>{calls++;return new Response('',{status:403});};
    let r=await collectIy(db,'2026-11-20',fetcher);
    assert.equal(r.states.iy,'failed');assert.equal(r.sources[0].error,'HTTP_403');
    await collectIy(db,'2026-11-20',fetcher);assert.equal(calls,1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM editions').get().n,0);
  }finally{db.close();}
});

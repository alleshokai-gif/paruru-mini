'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const verified={label:'ジュージニー チキン ステーキ用',unit:'100g 当り',day:'20',dayAgain:'20',
  net:'99',again:'99',tax:'106.92',taxAgain:'106.92'};
test('Yaoko requires two exact day, net and tax reads and an explicit 100g unit',async()=>{
  const {validateYaokoChicken}=await import('../scripts/supermarket/yaoko-ocr.mjs');
  assert.equal(validateYaokoChicken(verified).tax_included_sen,10692);
  for(const bad of [{day:'205'},{dayAgain:'21'},{unit:'1パック'},{label:'チキン'},
    {net:'99.'},{again:'98'},{tax:'106.929'},{taxAgain:'106.9'},{tax:'107.92',taxAgain:'107.92'}]) {
    assert.equal(validateYaokoChicken({...verified,...bad}),null,JSON.stringify(bad));
  }
});
test('Yaoko binds the store, viewer, exact original and single product day',async()=>{
  const {identifyYaokoEdition,extractYaokoFront,YAOKO_SOURCE,YAOKO_IMAGE}=await import('../scripts/supermarket/yaoko-ocr.mjs');
  const html='川崎枡形店 <a href="'+YAOKO_SOURCE+'">最新チラシ</a>';
  const edition=identifyYaokoEdition(html,'2026-11-20');
  assert.equal(edition.until,'2026-11-20');assert.equal(edition.image,YAOKO_IMAGE);
  assert.throws(()=>identifyYaokoEdition(html.replace('1221','1222'),'2026-11-20'));
  assert.throws(()=>identifyYaokoEdition(html,'2026-11-21'));
  await assert.rejects(extractYaokoFront(Buffer.from('changed original'),edition),/OCR_EDITION_UNVERIFIED/);
});
const officialRobots='User-agent: *\nSitemap: https://www.yaoko-net.com/sitemap.xml\n'+
  'Disallow: /assets_c/\nDisallow: /inc/\nDisallow: /maintenance/\nDisallow: /includes_c/\nDisallow: /templates_c/';
const fallback='<!doctype html><html><body><div id="app"></div></body></html>';
test('known scoped robots and an HTML fallback are distinct from an explicit denial',async()=>{
  const {verifyYaokoRobots}=await import('../scripts/supermarket/collector.mjs');
  verifyYaokoRobots(officialRobots,fallback);
  verifyYaokoRobots('','');
  for(const [a,b] of [[officialRobots+'\nDisallow: /store/',fallback],['User-agent: *\nDisallow: /',fallback],
    [officialRobots,'User-agent: *\nDisallow: /'],[officialRobots,'<!doctype html><p>challenge</p>'],
    [officialRobots,fallback+'Disallow: /assets/flyer/']])assert.throws(()=>verifyYaokoRobots(a,b));
});
test('Yaoko stores one current item, preserves IY/OK and excludes it on the following day',async()=>{
  const {collectYaoko,openDb,snapshot}=await import('../scripts/supermarket/collector.mjs');
  const {YAOKO_SOURCE,YAOKO_STORE,YAOKO_IMAGE,validateYaokoChicken}=await import('../scripts/supermarket/yaoko-ocr.mjs');
  const db=openDb(':memory:');const calls=[];
  try {
    const set=db.prepare('INSERT INTO status VALUES(?,?,?,?,?,?)');
    for(const store of ['ok','iy'])set.run(store,'2026-11-20','checked','existing',null,null);
    const fetch=async url=>{
      calls.push(url);
      if(url==='https://www.yaoko-net.com/robots.txt')return new Response(officialRobots,{headers:{'Content-Type':'text/plain'}});
      if(url==='https://yap-pd.yaoko-net.com/robots.txt')return new Response(fallback,{headers:{'Content-Type':'text/html'}});
      if(url===YAOKO_STORE)return new Response('川崎枡形店 '+YAOKO_SOURCE,{headers:{'Content-Type':'text/html'}});
      if(url===YAOKO_IMAGE)return new Response(Uint8Array.of(255,216,255,217),{headers:{'Content-Type':'image/jpeg'}});
      throw new Error('unexpected source');
    };
    const opts={ocr:async()=>({from:'2026-11-20',until:'2026-11-20',offers:[validateYaokoChicken(verified)]})};
    let r=await collectYaoko(db,'2026-11-20',fetch,opts);
    assert.equal(r.states.yaoko,'checked');assert.equal(r.states.iy,'checked');assert.equal(r.states.ok,'checked');
    assert.equal(r.offers[0].unit,'100g');assert.equal(calls.length,4);
    assert.ok(calls.every(s=>!s.includes('/api/')&&!s.includes('ok-corporation')&&!s.includes('hatobase')));
    await collectYaoko(db,'2026-11-20',fetch,opts);assert.equal(calls.length,4);
    r=await collectYaoko(db,'2026-11-21',fetch,opts);assert.equal(calls.length,4);
    assert.equal(r.states.yaoko,'needs_review');assert.equal(snapshot(db,'2026-11-21').offers.length,0);
  }finally{db.close();}
});
test('Yaoko source rejection is retained, never followed by a second route or retry',async()=>{
  const {collectYaoko,openDb}=await import('../scripts/supermarket/collector.mjs');
  const db=openDb(':memory:');let count=0;
  try {
    const fetch=async()=>{count++;return new Response('',{status:403});};
    assert.equal((await collectYaoko(db,'2026-11-20',fetch)).states.yaoko,'failed');
    await collectYaoko(db,'2026-11-20',fetch);assert.equal(count,1);
  }finally{db.close();}
});

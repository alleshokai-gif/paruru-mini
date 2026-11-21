'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const policy='User-agent: ClaudeBot\nDisallow: /\nUser-agent: anthropic-ai\nDisallow: /\n'+
 'User-agent: Claude-Web\nDisallow: /\nUser-agent: *\nDisallow: /2026/random_product\nUser-agent: bingbot\nCrawl-delay: 1';
const verified={maruetsu:{label:'豚肉',cut:'かたまり',origin:'国産',unit:'各100g当り',day:'20',dayAgain:'20',net:'169',again:'169',tax:'183',taxAgain:'183'},
 life:{label:'あまに豚こま切れ',origin:'北海道産',unit:'各100g当り',day:'20',dayAgain:'20',net:'169',again:'169',tax:'182',taxAgain:'182'}};
const page=c=>'<title>'+c.store+'のチラシ・店舗情報</title><meta name="robots" content="noarchive">'+
 '<img class="printable_leaflet_image" src="'+c.image+'">';
test('print sources retain exact store/image scope and only the actual product day',async()=>{
 const {TOKUBAI_EDITIONS,identifyTokubaiEdition,extractTokubaiFront}=await import('../scripts/supermarket/tokubai-ocr.mjs');
 for(const [id,c] of Object.entries(TOKUBAI_EDITIONS)) {
  const edition=identifyTokubaiEdition(id,page(c),'2026-11-20');
  assert.equal(edition.until,'2026-11-20');
  for(const html of [page(c).replace(c.store,'別店舗'),page(c).replace(c.image,c.image+'0'),page(c).replace('noarchive','nofollow'),page(c)+page(c)]) {
   assert.throws(()=>identifyTokubaiEdition(id,html,'2026-11-20'));
  }
  assert.throws(()=>identifyTokubaiEdition(id,page(c),'2026-11-21'));
  await assert.rejects(extractTokubaiFront(id,Buffer.from('changed original'),edition),/OCR_EDITION_UNVERIFIED/);
 }
});
test('own PALURU UA is distinct from denied agents; any REP policy change stops',async()=>{
 const {verifyTokubaiRobots}=await import('../scripts/supermarket/tokubai-ocr.mjs');
 verifyTokubaiRobots('# current\n'+policy);
 for(const p of ['',policy+'\nDisallow: /',policy.replace('/2026/random_product','/'),'<html>challenge</html>']) {
  assert.throws(()=>verifyTokubaiRobots(p),/ROBOTS_POLICY_REVIEW_REQUIRED/);
 }
});
test('independent price/day reads, cut/origin/unit and store-specific printed tax are required',async()=>{
 const {validateTokubaiOffer}=await import('../scripts/supermarket/tokubai-ocr.mjs');
 assert.equal(validateTokubaiOffer('maruetsu',verified.maruetsu).tax_included_sen,18300);
 assert.equal(validateTokubaiOffer('life',verified.life).tax_included_sen,18200);
 for(const [id,b] of Object.entries(verified))for(const bad of [{day:'21'},{dayAgain:'21'},{again:'168'},
  {unit:'各1009g当り'},{origin:'輸入'},{label:'魚'}, {tax:'182.52',taxAgain:'182.52'}, {taxAgain:'1839'}]) {
  assert.equal(validateTokubaiOffer(id,{...b,...bad}),null);
 }
 assert.equal(validateTokubaiOffer('maruetsu',{...verified.maruetsu,cut:'薄切り'}),null);
 assert.equal(validateTokubaiOffer('life',{...verified.life,tax:'183',taxAgain:'183'}),null);
});
test('stores fail independently; duplicate does not repeat and future discovery never uses the expired template',async()=>{
 const {collectTokubai,openDb,snapshot}=await import('../scripts/supermarket/collector.mjs');
 const {TOKUBAI_EDITIONS,TOKUBAI_ROBOTS,validateTokubaiOffer}=await import('../scripts/supermarket/tokubai-ocr.mjs');
 const db=openDb(':memory:');const calls=[];
 try {
  const set=db.prepare('INSERT INTO status VALUES(?,?,?,?,?,?)');
  for(const id of ['ok','iy','yaoko'])set.run(id,'2026-11-20','checked','existing',null,null);
  const fetch=async url=>{
   calls.push(url);
   if(TOKUBAI_ROBOTS.includes(url))return new Response(policy,{headers:{'Content-Type':'text/plain'}});
   if(url===TOKUBAI_EDITIONS.maruetsu.source)return new Response('',{status:403});
   const c=TOKUBAI_EDITIONS.life;
   if(url===c.source)return new Response(page(c),{headers:{'Content-Type':'text/html'}});
   if(url===c.image)return new Response(Uint8Array.of(255,216,255,217),{headers:{'Content-Type':'image/jpeg'}});
   throw new Error('unexpected source');
  };
  await collectTokubai('maruetsu',db,'2026-11-20',fetch);assert.equal(calls.length,3);
  await collectTokubai('maruetsu',db,'2026-11-20',fetch);assert.equal(calls.length,3);
  const opts={ocr:async()=>({from:'2026-11-20',until:'2026-11-20',offers:[validateTokubaiOffer('life',verified.life)]})};
  const r=await collectTokubai('life',db,'2026-11-20',fetch,opts);assert.equal(calls.length,7);
  assert.equal(r.states.maruetsu,'failed');assert.equal(r.states.life,'checked');
  for(const id of ['ok','iy','yaoko'])assert.equal(r.states[id],'checked');
  assert.equal(r.offers[0].tax_included_sen,18200);
  await collectTokubai('life',db,'2026-11-20',fetch,opts);assert.equal(calls.length,7);
  // The historical print-only fixture has no official-store discovery chain.
  await collectTokubai('life',db,'2026-11-21',fetch,opts);assert.equal(calls.length,8);
  assert.equal(snapshot(db,'2026-11-21').offers.length,0);
  assert.ok(calls.every(s=>!s.includes('/api/')));
 }finally{db.close();}
});

test('only the observed image robots 302 delegates to canonical REP; denial and changed hops stop',async()=>{
 const {collectTokubai,openDb}=await import('../scripts/supermarket/collector.mjs');
 const {TOKUBAI_EDITIONS,TOKUBAI_ROBOTS,validateTokubaiOffer}=await import('../scripts/supermarket/tokubai-ocr.mjs');
 for(const scenario of ['known','foreign','denied','loop']) {
  const db=openDb(':memory:'),calls=[];let main=0;
  try {
   const fetch=async(url,opts)=>{
    calls.push({url,redirect:opts.redirect});
    if(url===TOKUBAI_ROBOTS[0]) {
     main++;
     if(scenario==='loop'&&main===2)return new Response('',{status:302,headers:{Location:TOKUBAI_ROBOTS[1]}});
     return new Response(policy,{headers:{'Content-Type':'text/plain'}});
    }
    if(url===TOKUBAI_ROBOTS[1])return scenario==='denied'?new Response('',{status:403}):
     new Response('',{status:302,headers:{Location:scenario==='foreign'?'https://example.com/robots.txt':TOKUBAI_ROBOTS[0]}});
    const c=TOKUBAI_EDITIONS.life;
    if(url===c.source)return new Response(page(c),{headers:{'Content-Type':'text/html'}});
    if(url===c.image)return new Response(Uint8Array.of(255,216,255,217),{headers:{'Content-Type':'image/jpeg'}});
    throw new Error('OUT_OF_SCOPE');
   };
   const opts={ocr:async()=>({from:'2026-11-20',until:'2026-11-20',offers:[validateTokubaiOffer('life',verified.life)]})};
   const r=await collectTokubai('life',db,'2026-11-20',fetch,opts);
   assert.equal(r.states.life,scenario==='known'?'checked':'failed');
   assert.equal(calls.length,scenario==='known'?5:scenario==='loop'?3:2);
   if(main===2)assert.equal(calls[2].redirect,'error');
   const before=calls.length;await collectTokubai('life',db,'2026-11-20',fetch,opts);assert.equal(calls.length,before);
  }finally{db.close();}
 }
});

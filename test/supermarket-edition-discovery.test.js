const test=require('node:test'),assert=require('node:assert/strict');
const current='https://promo.hatobase.jp/flyers/00521/1313/51034';
const image=id=>'https://content.hatobase.jp/flyer_details/2448/main_image_'+id+'.jpg.progressive.jpeg';
const a=image('front'),b=image('back'),next='https://promo.hatobase.jp/flyers/00521/1320/52000';
const jpeg=Uint8Array.from([255,216,255,217]);
const html=(source=current,label='11/21(土)〜11/24(火) Current',images=[a,b])=>
 '<title>Store 521</title><a href="https://stores.itoyokado.co.jp/detail/521/">store</a>'+
 '<meta property="og:url" content="'+source+'"><meta name="description" content="'+label+'">'+
 images.map(src=>'<img src="'+src+'" alt="Store 521 '+label+'">').join('')+
 '<img src="'+image('old')+'" alt="other older issue" aria-hidden="true">';
function fake(calls,{source=current,body=html(),denyImage=false}={}){
 return async url=>{calls.push(url);
  if(url.endsWith('/robots.txt'))return new Response('',{status:404});
  if(url==='https://stores.itoyokado.co.jp/detail/521/')return new Response('<a href="https://promo.hatobase.jp/flyers/00521/new">flyer</a>',{headers:{'Content-Type':'text/html'}});
  if(url.endsWith('/00521/new'))return new Response('',{status:302,headers:{Location:source}});
  if(url===source)return new Response(body,{headers:{'Content-Type':'text/html'}});
  if(url.startsWith('https://content.hatobase.jp/'))return new Response(denyImage?'denied':jpeg,{status:denyImage?403:200,headers:{'Content-Type':'image/jpeg'}});
  throw Error('UNEXPECTED_TEST_REQUEST');
 };
}
test('current canonical selects every current-page image, not older index thumbnails',async()=>{
 const {parseIyCurrent}=await import('../scripts/supermarket/edition-discovery.mjs');
 const edition=parseIyCurrent(html(),current,'2026-11-21');
 assert.deepEqual(edition.pages.map(p=>p.source),[a,b]);
 assert.equal(edition.from,'2026-11-21');assert.equal(edition.until,'2026-11-24');
 for(const input of [html().replace('detail/521/','detail/522/'),html().replace('og:url','wrong'),html(current,'11/25(水)〜11/28(土) Future')])
  assert.throws(()=>parseIyCurrent(input,current,'2026-11-21'));
});
test('whole pages persist privately; repeat day and same edition never repeat asset reads',async()=>{
 const {openDb}=await import('../scripts/supermarket/collector.mjs'),{collectCurrentEdition}=await import('../scripts/supermarket/edition-discovery.mjs');
 const db=openDb(':memory:'),calls=[];try{
  const fetcher=fake(calls);let result=await collectCurrentEdition('iy',db,'2026-11-21',fetcher);
  assert.equal(result.phase,'detected');assert.equal(result.pages.length,2);assert(result.pages.every(p=>p.state==='saved'&&p.sha256&&p.bytes===4));
  assert.equal(result.analysis_state,'not_connected');assert.equal(result.product_count,null);
  const n=calls.length;await collectCurrentEdition('iy',db,'2026-11-21',fetcher);assert.equal(calls.length,n);
  await collectCurrentEdition('iy',db,'2026-11-22',fetcher);
  assert.equal(calls.filter(u=>u===a||u===b).length,2);
  assert.equal(db.prepare('SELECT count(*) n FROM editions').get().n,0);
 }finally{db.close();}
});
test('undated /new advertisement selects latest active same-store paper and verifies both faces',async()=>{
 const {openDb}=await import('../scripts/supermarket/collector.mjs'),{collectCurrentEdition}=await import('../scripts/supermarket/edition-discovery.mjs');
 const tenant='https://promo.hatobase.jp/flyers/00521/1322/51299',paper='https://promo.hatobase.jp/flyers/00521/1323/51325',old='https://promo.hatobase.jp/flyers/00521/1313/51034';
 const sidebar='<a href="'+old+'">11/21(土)〜11/24(火) expired</a><a href="'+paper+'"><span>11/25(水)〜11/27(金)</span> paper</a><a href="https://promo.hatobase.jp/flyers/00522/1/2">11/27(金)〜11/29(日) other store</a>';
 const calls=[],db=openDb(':memory:');try{
  const base=fake(calls,{source:tenant,body:html(tenant,'Undated tenant advertisement',[image('tenant')])+sidebar});
  const fetcher=async url=>url===paper?(calls.push(url),new Response(html(paper,'11/25(水)〜11/27(金) paper',[a,b]),{headers:{'Content-Type':'text/html'}})):base(url);
  const out=await collectCurrentEdition('iy',db,'2026-11-27',fetcher);
  assert.equal(out.phase,'detected');assert.equal(out.edition.source,paper);assert.equal(out.edition.until_day,'2026-11-27');assert.equal(out.pages.length,2);assert(out.pages.every(p=>p.state==='saved'));
  assert(!calls.includes(image('tenant')));assert(!calls.includes(old));assert(calls.length<=12);assert.equal(out.product_count,null);
 }finally{db.close();}
});
test('sidebar dates cannot grant another period or future/expired issue, and denial never falls back',async()=>{
 const {parseIyIndex,collectCurrentEdition}=await import('../scripts/supermarket/edition-discovery.mjs'),{openDb}=await import('../scripts/supermarket/collector.mjs');
 assert.equal(parseIyIndex('<a href="'+next+'">11/25(水)〜11/27(金) paper</a>',current,'2026-11-28').length,0);
 const calls=[],db=openDb(':memory:');try{
  const index=html(current,'Undated',[image('tenant')])+'<a href="'+next+'">11/25(水)〜11/28(土) paper</a>';
  const base=fake(calls,{body:index});
  const out=await collectCurrentEdition('iy',db,'2026-11-25',async url=>url===next?(calls.push(url),new Response(html(next,'11/25(水)〜11/27(金) changed',[a,b]),{headers:{'Content-Type':'text/html'}})):base(url));
  assert.equal(out.error,'DISCOVERY_INDEX_PERIOD_MISMATCH');assert(!calls.includes(a));assert(!calls.includes(image('tenant')));
 }finally{db.close();}
});
test('nofollow sidebar links are not followed even when their dates are current',async()=>{
 const {parseIyIndex,collectCurrentEdition}=await import('../scripts/supermarket/edition-discovery.mjs'),{openDb}=await import('../scripts/supermarket/collector.mjs');
 const link='<a rel="external NoFollow" href="'+next+'">11/25(水)〜11/28(土) paper</a>';
 assert.equal(parseIyIndex(link,current,'2026-11-25').length,0);
 const calls=[],db=openDb(':memory:');try{
  const out=await collectCurrentEdition('iy',db,'2026-11-25',fake(calls,{body:html(current,'Undated tenant')+link}));
  assert.equal(out.error,'DISCOVERY_NO_CURRENT_ISSUE');assert(!calls.includes(next));assert(!calls.includes(a));
 }finally{db.close();}
});
test('a later issue is discovered without changing fixed IDs or invoking the old SKU OCR',async()=>{
 const {openDb,collectIy}=await import('../scripts/supermarket/collector.mjs'),{discoverySummary}=await import('../scripts/supermarket/edition-discovery.mjs');
 const db=openDb(':memory:');try{
  let ocr=0;const calls=[];
  const result=await collectIy(db,'2026-11-25',fake(calls,{source:next,body:html(next,'11/25(水)〜11/28(土) Next',[image('next-front'),image('next-back')])}),{ocr:async()=>{ocr++;throw Error('NOT_WHOLE_READER');}});
  assert.equal(result.states.iy,'needs_review');assert.equal(ocr,0);assert.equal(result.offers.length,0);
  const observed=discoverySummary(db,'iy','2026-11-25');assert.equal(observed.edition.source,next);assert.equal(observed.pages.length,2);
 }finally{db.close();}
});
test('HTTP denial is durable across days and does not trigger an alternate path',async()=>{
 const {openDb}=await import('../scripts/supermarket/collector.mjs'),{collectCurrentEdition}=await import('../scripts/supermarket/edition-discovery.mjs');
 const db=openDb(':memory:'),calls=[];try{
  let result=await collectCurrentEdition('iy',db,'2026-11-21',fake(calls,{denyImage:true}));
  assert.equal(result.phase,'failed');assert.equal(result.pages.length,2);assert.equal(calls.filter(u=>u===b).length,0);
  await collectCurrentEdition('iy',db,'2026-11-22',fake(calls,{denyImage:true}));
  assert.equal(calls.filter(u=>u===a).length,1);
  assert.equal(calls.filter(u=>u===b).length,0);
 }finally{db.close();}
});
test('nofollow, redirect drift and request budget close with no product promotion',async()=>{
 const {openDb}=await import('../scripts/supermarket/collector.mjs'),{collectCurrentEdition}=await import('../scripts/supermarket/edition-discovery.mjs');
 for(const options of [{body:html()+'<meta name="robots" content="nofollow">'}, {source:'https://promo.hatobase.jp/flyers/00522/1313/51034'}]){
  const db=openDb(':memory:'),calls=[];try{const r=await collectCurrentEdition('iy',db,'2026-11-21',fake(calls,options));assert.equal(r.phase,'failed');assert(!calls.includes(a));}finally{db.close();}
 }
 const db=openDb(':memory:'),calls=[];try{const r=await collectCurrentEdition('iy',db,'2026-11-21',fake(calls),{maxRequests:3});assert.equal(calls.length,3);assert.equal(r.error,'DISCOVERY_REQUEST_LIMIT');}finally{db.close();}
});
test('Life official widget links are saved as links, not invented page contents or product counts',async()=>{
 const {openDb}=await import('../scripts/supermarket/collector.mjs'),{collectCurrentEdition}=await import('../scripts/supermarket/edition-discovery.mjs');
 const widget='https://widgets.tokubai.co.jp/224224/leaflet_widget?count=4';const db=openDb(':memory:'),calls=[];
 try{const fetcher=async url=>{calls.push(url);if(url.endsWith('/robots.txt'))return new Response('',{status:404});return new Response(url===widget?'<a href="/224224/leaflet_widget/click?id=108725926&amp;type=pc"><img alt="11/21 food"></a><a href="/224224/leaflet_widget/click?id=108726058&amp;type=pc">11/21 food</a>':'<a href="'+widget+'">flyer</a>',{headers:{'Content-Type':'text/html'}});};
  const r=await collectCurrentEdition('life',db,'2026-11-21',fetcher);assert.equal(r.phase,'detected');assert.equal(r.pages.length,2);assert(r.pages.every(p=>p.state==='not_retrieved'&&p.kind==='linked_leaflet'));
  assert.equal(r.edition.until_day,null);assert.equal(r.product_count,null);assert(!calls.some(u=>u.includes('/click')));
 }finally{db.close();}
});

test('unrelated crawl-delay preserves REP grouping; our delay is not silently ignored',async()=>{
 const {discoveryRobotsAllows}=await import('../scripts/supermarket/edition-discovery.mjs');
 assert.equal(discoveryRobotsAllows('User-agent: *\nDisallow: /private\nUser-agent: bingbot\nCrawl-delay: 1','/224224/leaflet_widget'),true);
 assert.equal(discoveryRobotsAllows('User-agent: bingbot\nCrawl-delay: 1\nUser-agent: *\nDisallow: /private','/private'),false);
 assert.throws(()=>discoveryRobotsAllows('User-agent: *\nCrawl-delay: 1','/'),/ROBOTS_DELAY_UNSUPPORTED/);
 assert.throws(()=>discoveryRobotsAllows('User-agent: *\nCrawl-delay: invalid','/'),/ROBOTS_FORMAT/);
});

test('existing DB and discovered page denominator survive storage exhaustion without asset requests',async()=>{
 const {openDb}=await import('../scripts/supermarket/collector.mjs'),{collectCurrentEdition}=await import('../scripts/supermarket/edition-discovery.mjs');
 const db=openDb(':memory:'),calls=[];try{
  db.exec('CREATE TABLE existing_private_data(value BLOB); INSERT INTO existing_private_data VALUES(zeroblob(12582912))');
  const r=await collectCurrentEdition('iy',db,'2026-11-21',fake(calls));
  assert.equal(r.phase,'detected');assert.equal(r.pages.length,2);assert(r.pages.every(p=>p.state==='storage_limited'&&p.bytes===null));
  assert(!calls.includes(a)&&!calls.includes(b));assert.equal(db.prepare('SELECT length(value) n FROM existing_private_data').get().n,12582912);
  await collectCurrentEdition('iy',db,'2026-11-22',fake(calls));assert(!calls.includes(a)&&!calls.includes(b));
 }finally{db.close();}
});
test('current-sized two-face paper cannot displace an existing DB or silently become complete',async()=>{
 const {openDb}=await import('../scripts/supermarket/collector.mjs'),{collectCurrentEdition}=await import('../scripts/supermarket/edition-discovery.mjs');
 const db=openDb(':memory:'),calls=[];try{
  db.exec('CREATE TABLE existing_rows(value BLOB); INSERT INTO existing_rows VALUES(zeroblob(5722112))');
  const base=fake(calls),sizes={[a]:5712074,[b]:5938916};
  const out=await collectCurrentEdition('iy',db,'2026-11-21',async url=>{
   if(!sizes[url])return base(url);calls.push(url);const body=Buffer.alloc(sizes[url]);body.set(jpeg);return new Response(body,{headers:{'Content-Type':'image/jpeg'}});
  });
  assert.equal(out.pages[0].state,'saved');assert.equal(out.pages[1].state,'storage_limited');assert.equal(out.phase,'failed');assert.equal(out.error,'DISCOVERY_BODY_LIMIT');assert.equal(out.product_count,null);
  assert.equal(db.prepare('SELECT length(value) n FROM existing_rows').get().n,5722112);
 }finally{db.close();}
});

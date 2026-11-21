const test=require('node:test'),assert=require('node:assert/strict');
const source='https://promo.hatobase.jp/flyers/00521/9999/12345',hash='a'.repeat(64);
function fixture(){
 const pages=[1,2].map(ordinal=>({ordinal,source:'https://content.hatobase.jp/flyer_details/1/p'+ordinal+'.jpg',sha256:hash,state:'saved'}));
 const manifest={source_document:source,width:1000,height:1000,tiles:['front','back'].map(face=>({id:face+'-full',face,pixel_bbox:[0,0,1000,1000],source_image_sha256:hash}))};
 const row={id:'front-a',face:'front',name:'合成商品',spec:null,unit:'1袋',net_yen:100,tax_included_yen:108,pixel_bbox:[100,100,500,500],item_period:null,period_raw_text:null,product_type:'food',conditions:[],verified_price:true,verification_state:'verified'};
 const readings={execution:'interactive_codex_vision',paid_api_calls:0,source_requests:0,manifest_sha256:hash,examined_tiles:['front-full','back-full'],rows:[row],source_notes:[],unresolved_regions:[]};
 const edition={source,observed_at:'2026-11-21T01:00:00Z',from_day:'2026-11-21',until_day:'2026-11-24'};
 const ocrPages=pages.map(p=>({...p,width:1000,height:1000,regions:[{observations:[{x:150,y:150,w:50,h:30,pass:'ocr-one',values:['100','108']}]}]}));
 return {manifest,readings,edition,pages,ocrPages,manifestHash:hash,inputRevision:hash};
}
test('image-associated numbers remain reference even with OCR matches or caller verification claims',async()=>{
 const {visionPacket}=await import('../scripts/supermarket/vision-observations.mjs');const f=fixture(),p=visionPacket(f),i=p.pages[0].items[0];
 assert.equal(i.prices[0].net_yen,100);assert.equal(i.prices[0].tax_included_yen,108);assert.equal(i.prices[0].unit_text,'1袋');
 assert.equal(i.valid_from,null);assert.equal(i.valid_until,null);assert.equal(i.verified_price,false);assert.equal(i.recommendation_eligible,false);
 assert.deepEqual(i.vision_evidence.numeric_crosscheck.net_seen_passes,['ocr-one']);assert.equal(i.vision_evidence.numeric_crosscheck.confers_verification,false);
 assert.deepEqual(i.vision_evidence.intersecting_tiles,['front-full']);assert.equal(p.coverage.state,'partial');
});
test('unknown price/unit stay unknown, explicit item dates stay separate from paper dates',async()=>{
 const {visionPacket}=await import('../scripts/supermarket/vision-observations.mjs'),f=fixture();
 Object.assign(f.readings.rows[0],{net_yen:null,tax_included_yen:null,unit:null,item_period:['2026-11-21','2026-11-21'],period_raw_text:'21日限り'});
 const i=visionPacket(f).pages[0].items[0];assert.deepEqual(i.prices,[]);assert.equal(i.price_state,'unreadable');assert.equal(i.valid_until,'2026-11-21');
});
test('position dedup preserves variants and distinct printed positions, rejects conflicting reads',async()=>{
 const {deduplicateVisionRows}=await import('../scripts/supermarket/vision-observations.mjs'),a=fixture().readings.rows[0];
 const b={...a,id:'duplicate',pixel_bbox:[105,105,505,505]},variant={...a,id:'variant',name:'別の合成商品'},other={...a,id:'other-position',pixel_bbox:[600,600,900,900]};
 assert.equal(deduplicateVisionRows([a,b,variant,other]).length,3);
 assert.throws(()=>deduplicateVisionRows([a,{...b,net_yen:101}]),/DUPLICATE_CONFLICT/);
 for(const diff of [{conditions:['会員限定']},{period_raw_text:'別の日付範囲'},{product_type:'nonfood'}])assert.throws(()=>deduplicateVisionRows([a,{...b,...diff}]),/DUPLICATE_CONFLICT/);
});
test('unexamined regions, changed image source, missing coverage and malformed prices fail closed',async()=>{
 const {visionPacket}=await import('../scripts/supermarket/vision-observations.mjs');
 for(const change of [f=>f.readings.examined_tiles.pop(),f=>f.manifest.tiles[0].source_image_sha256='b'.repeat(64),f=>f.manifest.tiles[0].pixel_bbox=[0,0,500,1000],f=>f.readings.rows[0].net_yen=-1,f=>f.readings.rows[0].item_period=['2026-11-22','2026-11-21'],f=>f.readings.rows[0].pixel_bbox=[0,0,1001,1001]]){
  const f=fixture();change(f);assert.throws(()=>visionPacket(f),/VISION_/);
 }
});
test('existing DB/catalog/snapshot/render path displays reference prices and never creates confirmed offers or menus',async()=>{
 const {visionPacket}=await import('../scripts/supermarket/vision-observations.mjs'),{ingestCorpus}=await import('../scripts/supermarket/whole-corpus-store.mjs'),{openDb,snapshot}=await import('../scripts/supermarket/collector.mjs');
 const ui=require('../features/shopping/supermarket-poc.js'),db=openDb(':memory:');
 class E{constructor(tag){this.tag=tag;this.children=[];this.textContent='';}append(...x){this.children.push(...x);}replaceChildren(...x){this.children=x;}text(){return this.textContent+this.children.map(x=>x.text()).join(' ');}setAttribute(){}addEventListener(){}}
 try{const f=fixture();f.readings.rows.push({...f.readings.rows[0],id:'back-a',face:'back',name:'合成日用品',product_type:'nonfood'});
  const p=visionPacket(f);ingestCorpus(db,p);const out=snapshot(db,'2026-11-21');assert.deepEqual(out.offers,[]);assert.equal(out.corpus.pages.flatMap(p=>p.items).length,2);
  assert(out.corpus.pages.every(p=>p.items.every(i=>i.verification_state==='needs_review')));assert.deepEqual(ui.recommend(out,[],'2026-11-21'),[]);
  const target=new E('root');ui.render({createElement:tag=>new E(tag)},target,out,[],'2026-11-21');
  assert(target.text().includes('参考価格あり 2枠'));assert(target.text().includes('本体100円'));assert(target.text().includes('合成日用品'));
 }finally{db.close();}
});

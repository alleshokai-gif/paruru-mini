'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const poc=require('../features/shopping/supermarket-poc.js');
class Element {
  constructor(tag){this.tagName=tag;this.children=[];this.textContent='';}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=nodes;}
  setAttribute(){} addEventListener(){}
  all(tag){return this.children.flatMap(n=>[...(n.tagName===tag?[n]:[]),...n.all(tag)]);}
  text(){return this.textContent+' '+this.children.map(n=>n.text()).join(' ');}
}
const doc={createElement:tag=>new Element(tag)};
const acquired='2026-11-21T01:12:27.852Z';
const item=(name,from=null,until=null)=>({name,valid_from:from,valid_until:until,
  verification_state:'needs_review',price_state:'unreadable',prices:[],variants:[],product_type:'food'});
const sourceItems=[item('weekly','2026-11-21','2026-11-24'),item('Saturday only','2026-11-21','2026-11-21'),
  item('Sunday only','2026-11-22','2026-11-22'),item('unknown applicability')];
function projection(day){
  // Synthetic Gateway-shaped projection from the same immutable stored issue.
  // Item filtering is the producer's responsibility; UI validates its result.
  const rows=sourceItems.filter(i=>(!i.valid_from||i.valid_from<=day)&&(!i.valid_until||day<=i.valid_until));
  return {schema:1,date:day,snapshot_date:'2026-11-21',freshness:'edition_reference',states:{iy:'needs_review'},offers:[],
    reference_corpus:{schema:1,store:'iy',issue_id:'iy-00521-51034',source_kind:'image',physical_pdf_pages:null,
      logical_faces:1,obtained_at:acquired,source_document:'https://promo.hatobase.jp/flyers/00521/1313/51034',
      verification_state:'needs_review',document_from:'2026-11-21',document_until:'2026-11-24',
      display_counts:{total:4,shown:rows.length,omitted:4-rows.length},pages:[{face:'front',items:rows}]}};
}
function render(s,day=s.date){const target=new Element('section');poc.render(doc,target,s,[],day);return target;}

test('same issue survives Saturday midnight through Tuesday, unknown item days stay reference',()=>{
  for(const day of ['2026-11-21','2026-11-22','2026-11-23','2026-11-24']){
    const s=projection(day),out=render(s);
    assert.match(out.text(),/weekly/);assert.match(out.text(),/unknown applicability/);
    assert.equal(out.text().includes('Saturday only'),day==='2026-11-21');
    assert.equal(out.text().includes('Sunday only'),day==='2026-11-22');
    assert.match(out.text(),/商品別適用日：未確認/);assert.match(out.text(),/当日再取得・価格確認済みの意味ではありません/);
    assert.ok(out.text().includes(acquired));assert.ok(out.text().includes('2026-11-21〜2026-11-24'));
    assert.equal(out.all('article').filter(n=>n.className==='supermarket-plan').length,0);
    assert.equal(out.all('span').filter(n=>n.className==='supermarket-badge is-confirmed').length,0);
    assert.deepEqual(poc.recommend(s,[],day),[]);
    assert.equal(s.snapshot_date,'2026-11-21');assert.equal(s.reference_corpus.obtained_at,acquired);
  }
  assert.equal(poc.dayTokyo(new Date('2026-11-21T14:59:59Z')),'2026-11-21');
  assert.equal(poc.dayTokyo(new Date('2026-11-21T15:00:00Z')),'2026-11-22');
});
test('Wednesday after edition expiry does not leak reference rows',()=>{
  const out=render(projection('2026-11-25'));
  assert.ok(!out.text().includes('weekly'));assert.ok(!out.text().includes('unknown applicability'));
  assert.equal(out.all('article').length,0);
});
test('future/malformed/over-age snapshot and changed source or paper dates fail closed',()=>{
  for(const mutate of [s=>s.snapshot_date='2026-11-25',s=>s.snapshot_date='2026-11-31',s=>s.snapshot_date='2026-01-01',
    s=>s.reference_corpus.document_from=null,s=>s.reference_corpus.document_until='2026-11-31',
    s=>s.reference_corpus.document_until='2026-11-20',s=>s.reference_corpus.obtained_at='2026-11-23T01:00:00Z',
    s=>s.reference_corpus.source_document+='?private=bad',s=>s.reference_corpus.store='life']){
    const s=projection('2026-11-22');mutate(s);
    assert.equal(render(s).all('article').length,0);
  }
});
test('edition interval cannot create a confirmed offer or restore prior menus',()=>{
  const s=projection('2026-11-22');s.offers=[{title:'must not promote'}];s.plans=[{name:'old menu'}];
  const out=render(s);assert.equal(out.all('article').length,0);assert.ok(!out.text().includes('old menu'));
});
test('malformed item dates or explicit day excluded by producer cannot become today reference',()=>{
  for(const row of [item('expired','2026-11-21','2026-11-21'),item('future','2026-11-23','2026-11-23'),item('bad','2026-11-31',null)]){
    const s=projection('2026-11-22');s.reference_corpus.pages[0].items=[row];
    assert.equal(render(s).all('article').length,0);
  }
});
test('old raw snapshot still cannot be accepted by changing viewer date only',()=>{
  const s=projection('2026-11-21');assert.equal(render(s,'2026-11-22').all('article').length,0);
});
test('a valid source belonging to another store cannot create that store reference',()=>{
  for(const [kind,source] of [['image','https://ok-corporation.jp/media-download/1764/f75516cf12ff8d76/PDF/'],
    ['dom','https://rosen.mikke-sales.com/stores/taira/flyers/5170']]){
    const s=projection('2026-11-22');Object.assign(s.reference_corpus,{store:'life',source_kind:kind,source_document:source});
    assert.equal(render(s).all('article').length,0);
  }
});

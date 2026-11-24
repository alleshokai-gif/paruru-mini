'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../features/match-videos/page.js'),'utf8');
const context={Blob,Uint8Array,Date,URL};vm.runInNewContext(source,context);const ui=context.PaluruMatchVideos;
function row(id,extra={}) {return {id,tournamentId:'fixture-cup-a',tournamentLabel:'架空大会A',matchId:'fixture-match-a',matchLabel:'架空チーム同士',matchDate:null,postedAt:'2026-01-10',partLabel:'架空前半',classificationStatus:'match_identified',...extra};}
test('only shared non-null tournament and match IDs group parts; known opponent is not match identity',()=>{
  const data=ui.normalizePayload({items:[row('fixture-1'),row('fixture-2',{partLabel:'架空後半'}),
    row('fixture-3',{matchId:null}),row('fixture-4',{matchId:null}),row('fixture-5',{tournamentId:'fixture-cup-b'})]});
  const catalog=ui.buildCatalog(data.items),a=catalog.tournaments[0],b=catalog.tournaments[1];
  assert.equal(a.matches.length,1);assert.equal(a.matches[0].parts.length,2);
  assert.equal(a.cards.filter(c=>c.kind==='single').length,2);
  assert.equal(a.cards.filter(c=>c.kind==='single').every(c=>c.parts.length===1),true);
  assert.equal(b.matches[0].parts.length,1,'same match id in a different cup is separate');
});
test('legacy rows (no additive fields) keep dates, unknown status and duplicate problems explicit',()=>{
  const result=ui.normalizePayload({items:[row('fixture-upload'),row('fixture-upload'),row('fixture-unknown',{classificationStatus:'unknown-new-value'})]});
  assert.equal(result.items.length,2);assert.equal(result.invalidCount,1);
  assert.equal(result.items[0].matchDate,null);assert.equal(result.items[1].status,'unclassified');
  assert.equal(result.items[0].direct,false);assert.equal(result.items[0].watchUrl,null);assert.equal(result.items[0].thumbUrl,null);
  assert.equal(ui.parseMatchDate('2026-02-30'),null);
  assert.doesNotMatch(ui.formatPostedAt('2026-01-10'),/00:00|09:00/);
  assert.equal(ui.normalizeStatus('tournament_only'),'tournament_only');assert.equal(ui.normalizeStatus('match_identified'),'match_identified');
});
test('unsafe links never become a YouTube destination',()=>{
  for(const url of ['javascript:alert(1)','https://youtube.com.invalid.example/watch?v=fixture','https://www.youtube.com/redirect?q=fixture','https://user:pass@www.youtube.com/watch?v=fixture','http://www.youtube.com/watch?v=fixture'])assert.equal(ui.safeWatchUrl(url),null);
  assert.equal(ui.linkFromResponse({other:'synthetic'}),null);
});
test('image MIME and signature must agree; SVG and oversize data are rejected',async()=>{
  const png=Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0]);
  assert.equal(await ui.validateImageBlob(new Blob([png],{type:'image/png'})),'image/png');
  assert.equal(await ui.validateImageBlob(new Blob([png],{type:'image/jpeg'})),null);
  assert.equal(await ui.validateImageBlob(new Blob(['<svg/>'],{type:'image/svg+xml'})),null);
  assert.equal(await ui.validateImageBlob(new Blob([new Uint8Array(ui.LIMITS.thumbBytes+1)],{type:'image/png'})),null);
});
test('component has no network, persistence, embedding or HTML injection primitives',()=>{
  assert.doesNotMatch(source,/\bfetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|caches\s*\.|\.innerHTML\s*=|createElement\(['"]iframe/);
});

/* ---------- compact (direct) mode: minimal fake DOM, fictional data only ---------- */
class N {
  constructor(tag,doc){this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.parentNode=null;this.dataset={};this.attrs={};this.listeners={};this.className='';this._t='';}
  get textContent(){return this._t+this.children.map(c=>c.textContent).join('');}
  set textContent(v){this.replaceChildren();this._t=String(v);}
  append(...ns){for(const n of ns){if(n.isFrag){const kids=[...n.children];n.children=[];this.append(...kids);continue;}
    if(n.parentNode)n.parentNode.children.splice(n.parentNode.children.indexOf(n),1);n.parentNode=this;this.children.push(n);}}
  appendChild(n){this.append(n);return n;}
  replaceChildren(...ns){for(const c of this.children)c.parentNode=null;this.children=[];this._t='';this.append(...ns);}
  setAttribute(k,v){this.attrs[k]=String(v);}
  addEventListener(t,f){(this.listeners[t]??=[]).push(f);}
  dispatch(t){for(const f of this.listeners[t]||[])f({type:t});}
  focus(){this.ownerDocument.activeElement=this;}
  contains(n){for(let x=n;x;x=x.parentNode)if(x===this)return true;return false;}
  get isConnected(){let x=this;while(x.parentNode)x=x.parentNode;return !!x.isRoot;}
  get options(){return this.children.filter(c=>c.tagName==='OPTION');}
  all(pred){const out=[],walk=n=>{for(const c of n.children){if(pred(c))out.push(c);walk(c);}};walk(this);return out;}
}
const observers=[];
class FakeIO{constructor(cb){this.cb=cb;this.targets=new Set();observers.push(this);}
  observe(t){this.targets.add(t);}unobserve(t){this.targets.delete(t);}disconnect(){this.targets.clear();}
  fire(ts){this.cb(ts.map(target=>({target,isIntersecting:true})));}}
const domCtx={Blob,Uint8Array,Date,URL,IntersectionObserver:FakeIO,setTimeout,clearTimeout,Promise};
vm.runInNewContext(source,domCtx);const dui=domCtx.PaluruMatchVideos;
const vid=i=>'fx'+String(i).padStart(9,'0');
const W=v=>'https://www.youtube.com/watch?v='+v,T=v=>'https://i.ytimg.com/vi/'+v+'/mqdefault.jpg';
const tick=()=>new Promise(r=>setTimeout(r,5));
function directRows(n){return Array.from({length:n},(_,i)=>{const v=vid(i);
  const t=i%5===4?null:'fixture-cup-'+(i%2),m=t&&i%3!==0?'fixture-match-'+(i%4):null;
  return {id:'fixture-'+i,tournamentId:t,tournamentLabel:t?'架空大会'+(i%2):null,matchId:m,matchLabel:m?'架空試合'+(i%4):null,
    matchDate:null,postedAt:'2026-01-10',partLabel:'架空'+i,classificationStatus:m?'match_identified':t?'tournament_only':'unclassified',
    watchUrl:W(v),thumbnailUrl:T(v)};});}
function mount(items,extra={}){
  const doc={activeElement:null};doc.createElement=t=>new N(t,doc);doc.createDocumentFragment=()=>Object.assign(new N('#f',doc),{isFrag:true});
  const host=new N('div',doc);host.isRoot=true;const calls={read:0,link:0,thumb:0};
  const view=dui.create({root:host,read:extra.read||(async()=>{calls.read++;return {items};}),
    getLink:async()=>{calls.link++;return W(vid(999));},readThumbnail:async()=>{calls.thumb++;return null;}});
  view.setSession({authenticated:true,allowed:true});
  return {host,view,calls,io:observers.at(-1),
    anchors:()=>host.all(n=>n.tagName==='A'),imgs:()=>host.all(n=>n.tagName==='IMG'),
    slots:()=>host.all(n=>n.className==='mv-thumb'),buttons:t=>host.all(n=>n.tagName==='BUTTON'&&n.textContent.startsWith(t))};
}
function expandAll(m){for(let b;(b=m.buttons('さらに表示')[0]);)b.dispatch('click');}

test('direct field validation: strict canonical watch URL and same-id mqdefault only',()=>{
  const v=vid(1);
  assert.equal(dui.directVideoId(W(v)),v);
  for(const bad of ['http://www.youtube.com/watch?v='+v,'https://youtube.com/watch?v='+v,'https://youtu.be/'+v,W(v)+'&t=1',
    W('short'),'https://www.youtube.com.example/watch?v='+v,' '+W(v),null,42])assert.equal(dui.directVideoId(bad),null);
  assert.equal(dui.directThumbUrl(T(v),v),T(v));
  for(const bad of [T(vid(2)),'http://i.ytimg.com/vi/'+v+'/mqdefault.jpg','https://img.youtube.com/vi/'+v+'/mqdefault.jpg',
    'https://i.ytimg.com/vi/'+v+'/hqdefault.jpg',T(v)+'?x=1'])assert.equal(dui.directThumbUrl(bad,v),null);
  const [ok,badWatch,badThumb,legacy]=dui.normalizePayload({items:[
    {id:'a',watchUrl:W(v),thumbnailUrl:T(v)},{id:'b',watchUrl:'javascript:alert(1)',thumbnailUrl:T(v)},
    {id:'c',watchUrl:W(v),thumbnailUrl:T(vid(3))},{id:'d'}]}).items;
  assert.deepEqual([ok.direct,ok.watchUrl,ok.thumbUrl],[true,W(v),T(v)]);
  assert.deepEqual([badWatch.direct,badWatch.watchUrl,badWatch.thumbUrl],[true,null,null]);
  assert.deepEqual([badThumb.direct,badThumb.watchUrl,badThumb.thumbUrl],[true,W(v),null]);
  assert.equal(legacy.direct,false);
});

test('51 direct rows: ordinary anchors at once, zero per-item API calls on load and click, viewport-only images',async()=>{
  const m=mount(directRows(51));await m.view.open();expandAll(m);
  assert.equal(m.calls.read,1);
  const anchors=m.anchors();assert.equal(anchors.length,51);
  for(const a of anchors){assert.match(a.href,/^https:\/\/www\.youtube\.com\/watch\?v=fx\d{9}$/);
    assert.equal(a.target,'_blank');assert.equal(a.rel,'noopener noreferrer');assert.equal(a.referrerPolicy,'no-referrer');}
  assert.equal(m.buttons('リンクを取得').length,0);
  for(const a of anchors)a.dispatch('click');await tick();
  assert.equal(m.anchors().length,51,'direct anchors are not single-use');
  assert.equal(m.calls.link,0);assert.equal(m.calls.thumb,0);
  assert.equal(m.imgs().length,0,'no image before intersection');
  const slots=m.slots();assert.equal(slots.length,51);
  m.io.fire(slots.slice(0,2));
  const imgs=m.imgs();assert.equal(imgs.length,2);
  for(const img of imgs){assert.match(img.src,/^https:\/\/i\.ytimg\.com\/vi\/fx\d{9}\/mqdefault\.jpg$/);
    assert.equal(img.loading,'lazy');assert.equal(img.decoding,'async');assert.equal(img.referrerPolicy,'no-referrer');}
  imgs[0].dispatch('error');
  assert.equal(m.imgs().length,1);assert.equal(slots[0].dataset.thumb,'none');assert.equal(m.anchors().length,51);
  assert.equal(m.calls.thumb,0);
});

test('present-but-invalid fields fail closed and never fall through to legacy APIs',async()=>{
  const v=vid(7);
  const m=mount([{id:'fixture-x',tournamentId:null,matchId:null,classificationStatus:'unclassified',watchUrl:'http://www.youtube.com/watch?v='+v,thumbnailUrl:T(v)},
    {id:'fixture-y',tournamentId:null,matchId:null,classificationStatus:'unclassified',watchUrl:W(v),thumbnailUrl:T(vid(8))}]);
  await m.view.open();
  assert.equal(m.anchors().length,1);assert.equal(m.buttons('リンクを取得').length,0);
  m.io.fire(m.slots());assert.equal(m.imgs().length,0);
  await tick();assert.equal(m.calls.link,0);assert.equal(m.calls.thumb,0);
});

test('legacy rows without additive fields keep click-time getLink',async()=>{
  const m=mount([row('fixture-legacy')]);await m.view.open();
  assert.equal(m.anchors().length,0);
  m.buttons('リンクを取得')[0].dispatch('click');await tick();
  assert.equal(m.calls.link,1);assert.equal(m.anchors().length,1);
  m.view.close();
});

test('filters, logout, close and late reads clear direct URL-bearing DOM',async()=>{
  const m=mount(directRows(51));await m.view.open();
  const tSelect=m.host.all(n=>n.name==='matchVideosTournament')[0];
  tSelect.value='t0';tSelect.dispatch('change');expandAll(m);
  const inCup0=directRows(51).filter(r=>r.tournamentId==='fixture-cup-0').length;
  assert.equal(m.anchors().length,inCup0);
  m.view.setSession({authenticated:false,allowed:false});
  assert.equal(m.anchors().length+m.imgs().length,0);assert.doesNotMatch(m.host.textContent,/youtube|ytimg/);
  let release;const late=mount([],{read:()=>new Promise(r=>{release=r;})});
  const p=late.view.open();late.view.close();release({items:directRows(3)});await p;
  assert.equal(late.anchors().length,0);assert.equal(late.view.getState().state,'closed');
});

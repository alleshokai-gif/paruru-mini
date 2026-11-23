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
test('list normalization never reads link/image locations and keeps dates, unknown status and duplicate problems explicit',()=>{
  const item=row('fixture-upload');
  for(const name of ['watchUrl','thumbnailUrl'])Object.defineProperty(item,name,{get(){throw Error('must not read private locations');}});
  const result=ui.normalizePayload({items:[item,row('fixture-upload'),row('fixture-unknown',{classificationStatus:'unknown-new-value'})]});
  assert.equal(result.items.length,2);assert.equal(result.invalidCount,1);
  assert.equal(result.items[0].matchDate,null);assert.equal(result.items[1].status,'unclassified');
  assert.equal(Object.hasOwn(result.items[0],'watchUrl'),false);
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

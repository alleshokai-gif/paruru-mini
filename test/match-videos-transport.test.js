'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const app = fs.readFileSync(require.resolve('../app.js'),'utf8');
const authCode = app.slice(app.indexOf('function isViewAllowed_(viewName)'),app.indexOf('\nfunction getViewNavigationItems_'));
const apiCode = app.slice(app.indexOf('function requireMatchVideoAccess_()'),app.indexOf('async function callAuthenticatedFamilySchedule_('));
const REV='hc_'+'a'.repeat(32);
function pageData(rows,offset=0,revision=REV) {
  const ts=new Map(),ms=new Map();let ut=0,um=0;
  for(const r of rows){
    if(r.tournamentId){const v=ts.get(r.tournamentId)||{id:r.tournamentId,label:r.tournamentLabel,count:0};v.count++;ts.set(r.tournamentId,v);}else ut++;
    if(r.matchId){const k=JSON.stringify([r.tournamentId,r.matchId]),v=ms.get(k)||{id:r.matchId,tournamentId:r.tournamentId,label:r.matchLabel,count:0};v.count++;ms.set(k,v);}else um++;
  }
  return {items:rows.slice(offset,offset+20),total:rows.length,offset,limit:20,hasMore:offset+20<rows.length,catalogRevision:revision,
    filters:{tournaments:[...ts.values()],matches:[...ms.values()],unclassifiedTournamentCount:ut,unassignedMatchCount:um}};
}
function harness() {
  const calls=[];
  const context={AbortController,setTimeout,clearTimeout,Blob,atob,Uint8Array,appAuthenticationState:'active_member',activeMembershipContext:{role:'guardian',allowedViews:['home']},
    createHomeControlError:code=>Object.assign(new Error(code),{code}),
    callHomeControlApi:async payload=>{calls.push(payload);return payload.action==='getHandballMatchVideoLink'
      ? {id:payload.id,url:'https://www.youtube.com/watch?v=FIXTURE0000'}
      : pageData([{id:'fixture-upload-a',tournamentId:'fixture-tournament',tournamentLabel:'架空大会',matchId:null,matchLabel:null,playedOn:'',publishedOn:'2026-01-02',title:'架空動画',classificationStatus:'tournament_only',watchUrl:'https://invalid.example/fixture-only',thumbnailUrl:'https://invalid.example/fixture-only-image'}]);}};
  vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../features/match-videos/media.js'),'utf8')+authCode+apiCode,context);
  return {context,calls};
}
test('menu inherits existing Home roles; unauthenticated and disallowed users never call an API',async()=>{
  const {context:c,calls}=harness();
  for(const role of ['admin','guardian','self_record']){c.activeMembershipContext.role=role;assert(c.isViewAllowed_('match-videos'));}
  c.activeMembershipContext.role='viewer';assert.equal(c.isViewAllowed_('match-videos'),false);
  await assert.rejects(c.callAuthenticatedMatchVideos_(),{code:'FORBIDDEN'});
  c.activeMembershipContext.role='guardian';c.activeMembershipContext.allowedViews=[];
  await assert.rejects(c.callAuthenticatedMatchVideoLink_('fixture-upload-a'),{code:'FORBIDDEN'});
  c.appAuthenticationState='signed_out';
  await assert.rejects(c.callAuthenticatedMatchVideos_(),{code:'UNAUTHENTICATED'});
  assert.equal(calls.length,0);
});
test('list uses authenticated facade and projects only display metadata, retaining nullable dates and IDs',async()=>{
  const {context:c,calls}=harness();const data=await c.callAuthenticatedMatchVideos_();
  assert.deepEqual(JSON.parse(JSON.stringify(calls)),[{action:'listHandballMatchVideos',offset:0,limit:20}]);
  assert.equal(data.items[0].matchId,null);assert.equal(data.items[0].matchDate,null);
  assert.equal(data.items[0].postedAt,'2026-01-02');assert.equal(data.items[0].classificationStatus,'tournament_only');
  assert.equal(Object.hasOwn(data.items[0],'watchUrl'),false);
  assert.equal(Object.hasOwn(data.items[0],'thumbnailUrl'),false);
  c.callHomeControlApi=async()=>({items:null});
  await assert.rejects(c.callAuthenticatedMatchVideos_(),{code:'MATCH_VIDEOS_INVALID_RESPONSE'});
});
test('all 51 synthetic rows are enumerated before dropdown data is exposed; partial paging fails closed',async()=>{
  const {context:c}=harness(),offsets=[];
  const rows=Array.from({length:51},(_,i)=>({id:'fixture-upload-'+i,tournamentId:i===50?'fixture-last-tournament':'fixture-first-tournament',tournamentLabel:'架空大会',matchId:'fixture-match-'+i,matchLabel:'架空試合',playedOn:'',title:'架空動画',classificationStatus:'match_identified'}));
  c.callHomeControlApi=async p=>{offsets.push(p.offset);if(p.offset)assert.equal(p.catalogRevision,REV);return pageData(rows,p.offset);};
  const data=await c.callAuthenticatedMatchVideos_();
  assert.equal(data.items.length,51);assert.equal(data.items[50].tournamentId,'fixture-last-tournament');
  assert.deepEqual(offsets,[0,20,40]);assert.equal(data.items[0].matchDate,null);
  c.callHomeControlApi=async p=>{if(p.offset)throw Object.assign(new Error('synthetic failure'),{code:'SERVICE_UNAVAILABLE'});return pageData(rows);};
  await assert.rejects(c.callAuthenticatedMatchVideos_(),{code:'SERVICE_UNAVAILABLE'});
  c.callHomeControlApi=async p=>({...pageData(rows,p.offset),items:rows.slice(0,20)});
  await assert.rejects(c.callAuthenticatedMatchVideos_(),{code:'MATCH_VIDEOS_INVALID_RESPONSE'});
  c.callHomeControlApi=async p=>pageData(rows,p.offset,p.offset?'hc_'+'b'.repeat(32):REV);
  await assert.rejects(c.callAuthenticatedMatchVideos_(),{code:'REVISION_CONFLICT'});
  c.callHomeControlApi=async p=>({...pageData(rows,p.offset),filters:{tournaments:[],matches:[],unclassifiedTournamentCount:51,unassignedMatchCount:51}});
  await assert.rejects(c.callAuthenticatedMatchVideos_(),{code:'MATCH_VIDEOS_INVALID_RESPONSE'});
  const larger=Array.from({length:317},(_,i)=>({...rows[0],id:'fixture-large-'+i,tournamentId:i===316?'fixture-final-cup':'fixture-first-tournament'}));
  c.callHomeControlApi=async p=>pageData(larger,p.offset);
  assert.equal((await c.callAuthenticatedMatchVideos_()).items.length,317);
});
test('account switch during enumeration or link issuance cannot mix member payloads',async()=>{
  const {context:c}=harness();
  c.callHomeControlApi=async p=>{c.activeMembershipContext={role:'guardian',allowedViews:['home']};return p.action==='listHandballMatchVideos'?{items:[],total:0,offset:0,limit:20,hasMore:false}:{id:p.id,url:'https://www.youtube.com/watch?v=FIXTURE0000'};};
  await assert.rejects(c.callAuthenticatedMatchVideos_(),{code:'UNAUTHENTICATED'});
  await assert.rejects(c.callAuthenticatedMatchVideoLink_('fixture-upload-a'),{code:'UNAUTHENTICATED'});
});

const compactRows = () => Array.from({length:51},(_,i)=>({id:'fixture-direct-'+i,tournamentId:'fixture-cup',tournamentLabel:'架空大会',
  matchId:null,matchLabel:null,playedOn:'',publishedOn:'2026-01-02',title:'架空動画',classificationStatus:'tournament_only',
  watchUrl:'https://www.youtube.com/watch?v=fx'+String(i).padStart(9,'0'),thumbnailUrl:'https://i.ytimg.com/vi/fx'+String(i).padStart(9,'0')+'/mqdefault.jpg'}));

test('failed legacy worker cannot schedule another page or erase its failure diagnostics',async()=>{
  const {context:c}=harness(),rows=Array.from({length:81},(_,i)=>({...compactRows()[0],id:'fixture-'+i}));
  const view={dataset:{}},offsets=[];let late;
  c.document={querySelector:()=>view};
  c.callHomeControlApi=async(p,o)=>{offsets.push(p.offset);o.onRequestStart();if(p.offset===20)throw Object.assign(new Error('synthetic'),{code:'SERVICE_UNAVAILABLE'});
    if(p.offset===40)await new Promise(resolve=>{late=resolve;});return pageData(rows,p.offset);};
  await assert.rejects(c.callAuthenticatedMatchVideos_(),{code:'SERVICE_UNAVAILABLE'});
  late();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(offsets,[0,20,40]);assert.equal(view.dataset.readError,'SERVICE_UNAVAILABLE');assert.equal(view.dataset.readStage,'FAILED');
});

test('previous read cannot overwrite a newer read diagnostic',async()=>{
  const {context:c}=harness(),view={dataset:{}},waiting=[];
  c.document={querySelector:()=>view};c.callHomeControlApi=()=>new Promise((resolve,reject)=>waiting.push({resolve,reject}));
  const previous=c.callAuthenticatedMatchVideos_(),current=c.callAuthenticatedMatchVideos_();
  waiting[0].reject(Object.assign(new Error('synthetic'),{code:'SERVICE_UNAVAILABLE'}));
  await assert.rejects(previous,{code:'SERVICE_UNAVAILABLE'});assert.equal(view.dataset.readError,'');
  waiting[1].resolve(pageData([]));await current;assert.equal(view.dataset.readError,'');assert.equal(view.dataset.readStage,'LEGACY_COMPLETE');
});

test('one authenticated compact response gives all 51 direct rows, with no detail request',async()=>{
  const {context:c}=harness(),calls=[],rows=compactRows();
  c.callHomeControlApi=async(p,o)=>{calls.push(p);o.onRequestStart();const page=pageData(rows);return {...page,linkCatalog:{format:'family-links-1',catalogRevision:REV,total:51,items:rows}};};
  const result=await c.callAuthenticatedMatchVideos_();
  assert.equal(calls.length,1);assert.equal(result.items.length,51);
  assert.equal(result.items[50].watchUrl,rows[50].watchUrl);
  assert.equal(result.diagnostics.requestCount,1);assert.equal(result.diagnostics.protocol,'family-links-1');
  for(const mutate of [x=>x.items.pop(),x=>x.catalogRevision='hc_'+'b'.repeat(32),
    x=>x.items[0].watchUrl='https://www.youtube.com.invalid.example/watch?v=fx000000000',
    x=>x.items[0].thumbnailUrl='https://i.ytimg.com/vi/fx000000001/mqdefault.jpg']){
    c.callHomeControlApi=async()=>{const page=pageData(rows),compact={format:'family-links-1',catalogRevision:REV,total:51,items:structuredClone(rows)};mutate(compact);return {...page,linkCatalog:compact};};
    await assert.rejects(c.callAuthenticatedMatchVideos_(),{code:'MATCH_VIDEOS_INVALID_RESPONSE'});
  }
});

test('v206 fallback uses two bounded concurrent pages after the first; all still validate',async()=>{
  const {context:c}=harness(),rows=compactRows(),waiting=[];let active=0,maxActive=0;
  c.callHomeControlApi=async(p,o)=>{o.onRequestStart();if(p.offset){active++;maxActive=Math.max(maxActive,active);await new Promise(resolve=>waiting.push(resolve));active--;}return pageData(rows,p.offset);};
  const pending=c.callAuthenticatedMatchVideos_();
  for(let i=0;i<10&&waiting.length<2;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(waiting.length,2);for(const resolve of waiting)resolve();
  const result=await pending;
  assert.equal(maxActive,2);assert.equal(result.items.length,51);assert.equal(result.diagnostics.requestCount,3);
  assert.equal(result.diagnostics.protocol,'legacy-pages');assert(!Object.hasOwn(result.items[0],'watchUrl'));
});

test('timeout is bounded at 30s, typed, and emits only fixed diagnostic codes/counts',async()=>{
  const {context:c}=harness();let timeout,delay,cleared=false;const view={dataset:{}};
  c.document={querySelector:()=>view};c.setTimeout=(fn,ms)=>{timeout=fn;delay=ms;return 1;};c.clearTimeout=()=>{cleared=true;};
  c.callHomeControlApi=async(p,o)=>{o.onRequestStart();return new Promise((resolve,reject)=>o.signal.addEventListener('abort',()=>reject(new Error('SYNTHETIC_PRIVATE_ERROR'))));};
  const pending=c.callAuthenticatedMatchVideos_();timeout();
  await assert.rejects(pending,{code:'MATCH_VIDEOS_TIMEOUT'});
  assert.equal(delay,30000);assert(cleared);assert.equal(view.dataset.readError,'MATCH_VIDEOS_TIMEOUT');
  assert.equal(view.dataset.readRequests,'1');assert.equal(view.dataset.readStage,'FAILED');
  assert.doesNotMatch(JSON.stringify(view.dataset),/SYNTHETIC_PRIVATE|youtube|member|homeId/);
});
test('each explicit opaque id request reauthorizes through the existing facade; invalid IDs fail before IO',async()=>{
  const {context:c,calls}=harness();
  await c.callAuthenticatedMatchVideoLink_('fixture-upload-a');
  await c.callAuthenticatedMatchVideoLink_('fixture-upload-a');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)),Array(2).fill({action:'getHandballMatchVideoLink',id:'fixture-upload-a'}));
  for(const id of [null,'','\n','bad\u0000id','a'.repeat(257)]) await assert.rejects(c.callAuthenticatedMatchVideoLink_(id),{code:'MATCH_VIDEO_INVALID_ID'});
  assert.equal(calls.length,2);
  c.callHomeControlApi=async p=>({id:p.id,url:'https://invalid.example/fixture-only'});
  await assert.rejects(c.callAuthenticatedMatchVideoLink_('fixture-upload-a'),{code:'MATCH_VIDEOS_INVALID_RESPONSE'});
});

test('authentication wait also times out; late auth resolution cannot start an aborted HTTP request',async()=>{
  const {context:c}=harness();let trigger;
  c.setTimeout=fn=>{trigger=fn;return 1;};c.clearTimeout=()=>{};
  c.callHomeControlApi=()=>new Promise(()=>{});
  const pending=c.callAuthenticatedMatchVideos_();trigger();
  await assert.rejects(pending,{code:'MATCH_VIDEOS_TIMEOUT'});
  const start=app.indexOf('async function postAuthenticatedApi_('),end=app.indexOf('async function callHomeControlReadOnlyApi_(',start);
  let release,fetches=0,hooks=0;const controller=new AbortController();
  c.firebaseAuthService={getAuthEnvelope:()=>new Promise(resolve=>{release=resolve;})};c.GAS_WEB_APP_URL='https://fixture.invalid/api';
  c.fetch=()=>{fetches++;};vm.runInContext(app.slice(start,end),c);
  const request=c.postAuthenticatedApi_({action:'listHandballMatchVideos'},{signal:controller.signal,onRequestStart:()=>hooks++});
  controller.abort();release({provider:'fixture',idToken:'SYNTHETIC_TOKEN'});
  await assert.rejects(request,{name:'AbortError'});assert.equal(fetches,0);assert.equal(hooks,0);
});
test('authenticated thumbnail bytes are bounded image Blobs; placeholder never becomes an external image',async()=>{
  const {context:c}=harness();
  c.callHomeControlApi=async p=>({id:p.id,status:'placeholder',reason:'THUMBNAIL_UNAVAILABLE'});
  assert.equal(await c.callAuthenticatedMatchVideoThumbnail_('fixture-upload-a'),null);
  const synthetic=Buffer.from([255,216,255,224,0,0,255,217]).toString('base64');
  c.callHomeControlApi=async p=>({id:p.id,status:'available',mimeType:'image/jpeg',base64:synthetic});
  const blob=await c.callAuthenticatedMatchVideoThumbnail_('fixture-upload-a');
  assert(blob instanceof Blob);assert.equal(blob.type,'image/jpeg');assert.equal(blob.size,8);
  for(const change of [{id:'fixture-other'},{mimeType:'image/svg+xml'},{mimeType:'image/png'},{base64:'%%%='},{base64:''},{base64:'A'.repeat(4*Math.ceil(256*1024/3)+4)}]) {
    c.callHomeControlApi=async p=>({id:p.id,status:'available',mimeType:'image/jpeg',base64:synthetic,...change});
    await assert.rejects(c.callAuthenticatedMatchVideoThumbnail_('fixture-upload-a'));
  }
});
test('new public assets are code only; fixture and media are not service-worker cache inputs',()=>{
  const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
  const sw=fs.readFileSync(require.resolve('../sw.js'),'utf8');
  const nav=fs.readFileSync(require.resolve('../features/navigation/config.js'),'utf8');
  assert.match(html,/id="matchVideosView"[^>]+data-view="match-videos"/);
  assert.match(nav,/id: "match-videos"[^\n]+home: true, menu: true/);
  assert.match(sw,/versioned\("features\/match-videos\/page.js"\)/);
  assert.doesNotMatch(sw,/fixtures\/match-videos|youtube|thumbnailUrl|watchUrl/);
  assert.match(app,/match-videos:closed/);
  assert.match(app,/matchVideoLinkApi: callAuthenticatedMatchVideoLink_/);
});

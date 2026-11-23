'use strict';
// Invented fixtures only. No real video, family, school or LINE source is used.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const source = name => fs.readFileSync(path.join(root, name), 'utf8');
const id = (prefix, digit) => prefix + '_' + digit.repeat(32);
const video1 = id('hv', '1'), video2 = id('hv', '2'), foreign = id('hv', '3');
const tournament1 = id('ht', '1'), tournament2 = id('ht', '2');
const match1 = id('hm', '1'), match2 = id('hm', '2');
const revision = id('hc', 'a');
const fakeProviderId = 'AbCdEf123_-'; // syntax-only synthetic value, never fetched
const syntheticUrl = 'https://www.youtube.com/watch?v=' + fakeProviderId;
function row(overrides = {}) {
  return {homeId: 'fixture-home-a', id: video1, tournamentId: tournament1,
    tournamentLabel: '架空大会A', matchId: match1, matchLabel: '架空試合A',
    title: '架空記録A', playedOn: '2026-01-10', youtubeUrl: syntheticUrl, ...overrides};
}
function fixture(options = {}) {
  const state = {actor: {homeId: 'fixture-home-a', memberUserId: 'fixture-owner'},
    verified: 0, propertyReads: [], fileReads: [], externalCalls: [], fetchQueue: [], logs: [], capabilities: [], failure: '',
    sharing: 'PRIVATE', fileMime: 'application/json', fileId: 'fixture_catalog_file', configuredHome:'fixture-home-a',
    readers: {schemaVersion: 1, readers: [{homeId: 'fixture-home-a', memberUserId: 'fixture-owner'}]},
    catalog: {schemaVersion: 1, items: [row(), row({id: video2, tournamentId: tournament2,
      tournamentLabel: '架空大会B', matchId: match2, matchLabel: '架空試合B'}),
    ]}, ...options};
  if (state.catalog && state.catalog.revision === undefined) state.catalog.revision = revision;
  const catalogText = () => state.rawCatalog !== undefined ? state.rawCatalog : JSON.stringify(state.catalog);
  const fail = code => {const e = new Error('private-sentinel-must-not-escape'); e.code = code; return e;};
  const context = vm.createContext({
    console: {log: (...args) => state.logs.push(args), error: (...args) => state.logs.push(args)},
    Logger: {log: (...args) => state.logs.push(args)},
    PropertiesService: {getScriptProperties: () => ({getProperty: key => {
      state.propertyReads.push(key);
      if (state.failure === 'property') throw fail('untrusted-private-error');
      if (key === 'HANDBALL_VIDEO_READERS_JSON') throw fail('OLD_GALLERY_GRANT_MUST_NOT_BE_READ');
      return key === 'PALURU_HOME_ID' ? state.configuredHome : state.fileId;
    }})},
    DriveApp: {Access:{PRIVATE:'PRIVATE'}, getFileById: fileId => {
      state.fileReads.push(fileId);
      if (state.failure === 'drive') throw fail('untrusted-private-error');
      const bytes = Buffer.from(catalogText());
      return {isTrashed:()=>!!state.trashed, getSharingAccess:()=>state.sharing, getMimeType:()=>state.fileMime,
        getSize:()=>state.fileSize === undefined ? bytes.length : state.fileSize,
        getBlob:()=>({getBytes:()=>state.blobBytes || [...bytes], getDataAsString:()=>bytes.toString('utf8')})};
    }},
    Utilities: {base64Encode: bytes => Buffer.from(bytes.map(x=>x&255)).toString('base64')},
    UrlFetchApp: {fetch:(url,options)=>{
      state.externalCalls.push({url,options});
      const next = state.fetchQueue.shift();
      if (next instanceof Error) throw next;
      return next || response(404,'application/json',Buffer.from('{}'));
    }},
    verifyFirebaseIdToken_: token => {
      state.verified++;
      if (token !== 'fixture-token' || state.failure === 'auth') throw fail('AUTH_TOKEN_INVALID');
      return {provider: 'firebase', providerSubject: 'fixture-subject', authTime: 1};
    },
    resolveHomeIdentity_: () => state.actor,
    getHomeMember_: () => ({...state.actor, role: state.actor.role || 'admin', status: state.failure === 'disabled' ? 'disabled' : 'active'}),
    isHomeMemberPolicyMatch_: () => true,
    isHomeMemberAccessRole_: () => true,
    getEffectiveMemberCapabilities_: () => ['home.read'],
    getEffectiveMemberAllowedViews_: () => ['fixture-view'],
    authorizeCapability_: (actor, capability) => {state.capabilities.push(capability); if (state.failure === 'capability') throw fail('FORBIDDEN');},
    firebaseAuthError_: fail, homeMembershipError_: fail,
  });
  for (const name of ['gas/TransportDiagnostics.js', 'gas/Code.js', 'gas/AuthenticatedActorService.js', 'gas/HandballMatchVideoService.js']) vm.runInContext(source(name), context);
  if(options.realRolePolicy){
    const roles=vm.createContext({});vm.runInContext(source('gas/HomeMembershipService.js'),roles);
    for(const name of ['isHomeMemberAccessRole_','getEffectiveMemberCapabilities_','getEffectiveMemberAllowedViews_']) context[name]=roles[name];
    context.authorizeCapability_=(actor,capability)=>{state.capabilities.push(capability);return roles.authorizeCapability_(actor,capability);};
  }
  context.firebaseAuthBindingKey_ = () => 'fixture-binding';
  context.json_ = value => JSON.parse(JSON.stringify(value));
  const request = (action, fields = {}, auth = {provider: 'firebase', idToken: 'fixture-token'}) => context.doPost({postData: {contents: JSON.stringify({action, auth, ...fields})}});
  return {state, context, request};
}
function denied(result, code) {
  assert.equal(result.success, false); assert.deepEqual(result.data, {});
  assert.equal(result.error.code, code); assert.equal(result.message, 'video request failed');
  assert.doesNotMatch(JSON.stringify(result), /private-sentinel|youtube|fixture-home|fixture-owner/);
}

test('normal authenticated POST lists only opaque metadata for current home', () => {
  const {request, state} = fixture(); const result = request('listHandballMatchVideos');
  assert.equal(result.success, true); assert.equal(result.schemaVersion, 'handball-match-videos-1.0');
  assert.deepEqual(result.data.items.map(x => x.id), [video1, video2]);
  assert.deepEqual(Object.keys(result.data.items[0]).sort(), ['id','tournamentId','tournamentLabel','matchId','matchLabel','title','playedOn','publishedOn','classificationStatus','thumbnail'].sort());
  assert.doesNotMatch(JSON.stringify(result), /youtube|youtu\.be|fixture-home|fixture-owner|AbCdEf123_-/);
  assert.deepEqual(state.capabilities, ['home.read']); assert.equal(state.verified, 1); assert.deepEqual(state.logs, []);
});
test('missing token is denied before private property access', () => {
  const {request, state} = fixture(); denied(request('listHandballMatchVideos', {}, {provider:'firebase'}), 'FORBIDDEN');
  assert.deepEqual(state.propertyReads, []);
});
test('legacy/device authentication cannot grant access', () => {
  const {request, state} = fixture(); denied(request('listHandballMatchVideos', {}, {provider:'device', idToken:'fixture-token'}), 'FORBIDDEN');
  assert.equal(state.verified, 0); assert.deepEqual(state.propertyReads, []);
});
for (const [name, actor] of [
  ['unrecognized role in the same home', {homeId:'fixture-home-a', memberUserId:'fixture-other',role:'viewer'}],
  ['same member in another home', {homeId:'fixture-home-b', memberUserId:'fixture-owner'}],
  ['missing home', {memberUserId:'fixture-owner'}],
  ['missing member', {homeId:'fixture-home-a'}],
]) test(name + ' is denied by existing family/Home policy', () => {
  const {request, state} = fixture({actor}); denied(request('listHandballMatchVideos'), 'FORBIDDEN');
  assert.equal(state.fileReads.length > 0, false);
});
test('client actor/role/home spoofing is rejected', () => {
  const {request} = fixture(); denied(request('listHandballMatchVideos', {homeId:'fixture-home-a',memberUserId:'fixture-owner',role:'admin'}), 'INVALID_INPUT');
});
test('resolved Home comparison is exact, with no case folding or trimming', () => {
  for (const actor of [{homeId:'fixture-home-a ',memberUserId:'fixture-owner'}, {homeId:'FIXTURE-HOME-A',memberUserId:'fixture-owner'}]) {
    const {request,state} = fixture({actor}); denied(request('listHandballMatchVideos'),'FORBIDDEN');
    assert.equal(state.fileReads.length > 0,false);
  }
});
test('missing or malformed existing canonical Home fails closed', () => {
  for (const configuredHome of [null, '', 'home/invalid', {}, 'x'.repeat(201)]) {
    const {request, state} = fixture({configuredHome}); denied(request('listHandballMatchVideos'),'CONFIGURATION_ERROR');
    assert.equal(state.fileReads.length,0);assert.deepEqual(state.externalCalls,[]);
  }
});
test('disabled membership and denied home.read fail before catalog', () => {
  for (const failure of ['disabled','capability']) {
    const {request, state} = fixture({failure}); denied(request('listHandballMatchVideos'), 'FORBIDDEN'); assert.deepEqual(state.propertyReads, []);
  }
});
test('link and thumbnail each freshly authenticate and reject disabled membership', () => {
  const {request, state} = fixture(); request('listHandballMatchVideos');
  const link = request('getHandballMatchVideoLink', {id:video1}); assert.deepEqual(link.data, {id:video1,url:syntheticUrl});
  const thumbnail = request('getHandballMatchVideoThumbnail', {id:video1});
  assert.deepEqual(thumbnail.data, {id:video1,status:'placeholder',reason:'THUMBNAIL_UNAVAILABLE'});
  assert.equal(state.verified, 3);
  state.failure = 'disabled';
  denied(request('getHandballMatchVideoLink', {id:video1}), 'FORBIDDEN');
  denied(request('getHandballMatchVideoThumbnail', {id:video1}), 'FORBIDDEN');
  assert.equal(state.verified, 5);
});
test('changing current Home after list never reuses old actor', () => {
  const {request, state} = fixture(); request('listHandballMatchVideos'); state.actor.homeId = 'fixture-home-b';
  denied(request('getHandballMatchVideoLink', {id:video1}), 'FORBIDDEN');
});
test('other home and unknown video return same not-found for both detail actions', () => {
  for (const action of ['getHandballMatchVideoLink','getHandballMatchVideoThumbnail']) {
    const {request} = fixture(); denied(request(action, {id:foreign}), 'NOT_FOUND');
    denied(request(action, {id:id('hv','f')}), 'NOT_FOUND');
  }
});
test('filters and bounded pagination operate only on authorized home rows', () => {
  const {request} = fixture();
  assert.deepEqual(request('listHandballMatchVideos', {tournamentId:tournament1,matchId:match1}).data.items.map(x=>x.id), [video1]);
  const page = request('listHandballMatchVideos', {offset:0,limit:1}).data;
  assert.equal(page.total,2); assert.equal(page.hasMore,true);
  assert.equal(request('listHandballMatchVideos',{offset:1,limit:1}).data.hasMore,false);
  assert.equal(request('listHandballMatchVideos',{tournamentId:id('ht','3')}).data.total,0);
});
test('unknown request fields, URL inputs, malformed IDs and bounds are rejected', () => {
  const {request} = fixture();
  for (const fields of [{offset:-1},{offset:'0'},{offset:1001},{limit:21},{limit:0},{limit:1.5},{url:syntheticUrl},{tournamentId:'all'},{matchId:match1+'\n'}]) denied(request('listHandballMatchVideos',fields),'INVALID_INPUT');
  for (const fields of [{id:fakeProviderId},{id:video1+'\n'},{id:video1,url:syntheticUrl},{id:video1,thumbnailUrl:'https://example.invalid/image'}]) denied(request('getHandballMatchVideoLink',fields),'INVALID_INPUT');
});
test('strict YouTube short link canonicalizes without fetching', () => {
  const {request} = fixture({catalog:{schemaVersion:1,items:[row({youtubeUrl:'https://youtu.be/'+fakeProviderId})]}});
  assert.equal(request('getHandballMatchVideoLink',{id:video1}).data.url,syntheticUrl);
});
test('unsafe hosts, redirects, schemes, credentials, query extras and whitespace fail closed', () => {
  for (const youtubeUrl of [
    'javascript:alert(1)', 'http://youtu.be/'+fakeProviderId, 'https://youtube.com.evil.invalid/watch?v='+fakeProviderId,
    'https://www.youtube.com@evil.invalid/watch?v='+fakeProviderId, syntheticUrl+'&list=private', syntheticUrl+'#fragment',
    'https://www.youtube.com:443/watch?v='+fakeProviderId, 'https://www.youtube.com/redirect?q='+fakeProviderId,
    'https://youtu.be/'+fakeProviderId+'?si=extra', syntheticUrl+'\n', syntheticUrl+'%0a', 'https://i.ytimg.com/vi/'+fakeProviderId+'/default.jpg',
  ]) {
    const {request} = fixture({catalog:{schemaVersion:1,items:[row({youtubeUrl})]}});
    denied(request('listHandballMatchVideos'),'CONFIGURATION_ERROR');
    denied(request('getHandballMatchVideoLink',{id:video1}),'CONFIGURATION_ERROR');
  }
});
test('stored markup, URLs, control/bidi characters and raw extra columns never reach response', () => {
  for (const patch of [{title:'<img src=x onerror=alert(1)>'},{matchLabel:'x\u202ey'},{title:'x\ny'},{tournamentLabel:syntheticUrl},{title:'x'.repeat(121)},{thumbnailUrl:'https://example.invalid/image'},{rawLineText:'private-sentinel'}]) {
    const {request,state} = fixture({catalog:{schemaVersion:1,items:[row(patch)]}});
    denied(request('listHandballMatchVideos'),'CONFIGURATION_ERROR'); assert.deepEqual(state.logs,[]);
  }
});
test('missing and corrupted catalog never silently becomes an empty successful list', () => {
  for (const catalog of [null, {}, {schemaVersion:2,items:[]}, {schemaVersion:1,items:[row(),row()]}]) {
    const {request} = fixture({catalog}); denied(request('listHandballMatchVideos'),'CONFIGURATION_ERROR');
  }
});
test('conflicting tournament/match provenance, invalid calendar dates are rejected', () => {
  for (const second of [row({id:video2,homeId:'fixture-home-b'}), row({id:video2,tournamentLabel:'架空別名'}), row({id:video2,matchLabel:'架空別試合'}),row({id:video2,playedOn:'2026-02-30'}),row({id:video2,playedOn:'2026-01-10\n'})]) {
    const {request} = fixture({catalog:{schemaVersion:1,items:[row(),second]}}); denied(request('listHandballMatchVideos'),'CONFIGURATION_ERROR');
  }
});
test('empty private catalog and unknown playedOn date are explicit safe states', () => {
  assert.equal(fixture({catalog:{schemaVersion:1,items:[]}}).request('listHandballMatchVideos').data.total,0);
  assert.equal(fixture({catalog:{schemaVersion:1,items:[row({playedOn:''})]}}).request('listHandballMatchVideos').data.items[0].playedOn,'');
});
test('property or authentication exceptions never echo data or log raw errors', () => {
  for (const failure of ['property','auth']) {const {request,state}=fixture({failure}); denied(request('listHandballMatchVideos'),failure==='property'?'SERVICE_UNAVAILABLE':'FORBIDDEN'); assert.deepEqual(state.logs,[]);}
});
test('read-only implementation cannot write, search, cache, log or use Family Inbox credentials', () => {
  const service = source('gas/HandballMatchVideoService.js');
  assert.doesNotMatch(service, /CacheService|setProperty|setProperties|SpreadsheetApp|Logger\.|console\.|getServiceSecret_|familyInboxGatewayCallService_|searchFiles|getFilesByName|getFolders/);
  assert.doesNotMatch(service, /thumbnailUrl/);
  assert.match(service, /followRedirects: false/);
  assert.match(source('gas/AuthenticatedActorService.js'),/function resolveHandballVideoReadActor_\(body\)\s*\{\s*const actor = resolveFirebaseAuthenticatedActor_\(body\)/);
});
test('existing browser transport strips actor fields and uses authenticated no-store POST; SW ignores POST', () => {
  const app = source('app.js');
  const transport = app.slice(app.indexOf('async function postAuthenticatedApi_('), app.indexOf('async function callHomeControlReadOnlyApi_('));
  assert.match(transport,/getAuthEnvelope\(false\)/); assert.match(transport,/method: "POST"/); assert.match(transport,/cache: "no-store"/);
  for (const key of ['homeId','memberUserId','_authenticatedActor']) assert.ok(transport.includes('"'+key+'"'));
  assert.match(source('sw.js'),/if \(request\.method !== "GET"\)\s*\{\s*return;/);
  assert.doesNotMatch(source('sw.js'), /handball|youtube|ytimg/i);
});
test('private video actions are POST-only and unsupported actions do not enter catalog', () => {
  const {context,state} = fixture();
  for (const action of ['listHandballMatchVideos','getHandballMatchVideoLink','getHandballMatchVideoThumbnail']) assert.equal(context.doGet({parameter:{action}}).success,false);
  assert.equal(context.doPost({postData:{contents:JSON.stringify({action:'handball.delete'})}}).success,false);
  assert.deepEqual(state.propertyReads,[]);
});

function response(code, mimeType, bytes, headers={}) {
  const body=Buffer.from(bytes);
  return {getResponseCode:()=>code, getAllHeaders:()=>({'Content-Type':mimeType,'Content-Length':String(body.length),...headers}),
    getBlob:()=>({getBytes:()=>[...body]}),getContentText:()=>body.toString('utf8')};
}
const fakeImage=Buffer.from([255,216,255,224,0,16,255,217]); // deliberately synthetic JPEG envelope, not a visual-decode claim
const metadata=(overrides={})=>response(200,'application/json',Buffer.from(JSON.stringify({type:'video',provider_name:'YouTube',provider_url:'https://www.youtube.com/',thumbnail_url:'https://i.ytimg.com/vi/'+fakeProviderId+'/hqdefault.jpg',...overrides})));
test('51 and 317 Japanese catalog rows fully page without loss, with whole-catalog filter choices',()=>{
  for (const size of [51,317]) {
    const items=Array.from({length:size},(_,i)=>row({id:'hv_'+(i+1).toString(16).padStart(32,'0'),
      tournamentId:'ht_'+(i+1).toString(16).padStart(32,'0'),tournamentLabel:'架空日本語大会第'+i+'回',
      matchId:null,matchLabel:null,title:'架空の日本語動画・未分類'+i,publishedOn:'2026-01-11'}));
    const {request,state}=fixture({catalog:{schemaVersion:1,items}});
    assert.ok(Buffer.byteLength(JSON.stringify(state.catalog))>8500);
    const ids=[];
    for(let offset=0;offset<size;offset+=20) {
      const result=request('listHandballMatchVideos',{offset,catalogRevision:revision});
      assert.equal(result.success,true); assert.equal(result.data.total,size);
      assert.equal(result.data.filters.tournaments.length,size);
      assert.equal(result.data.filters.unassignedMatchCount,size);
      assert.equal(result.data.catalogRevision,revision);
      ids.push(...result.data.items.map(x=>x.id));
    }
    assert.equal(ids.length,size);assert.equal(new Set(ids).size,size);
    assert.equal(request('listHandballMatchVideos',{offset:size}).data.items.length,0);
    assert.deepEqual(state.externalCalls,[]);
  }
});
test('unclassified videos, nullable match and published date remain discoverable',()=>{
  const items=[row({matchId:null,matchLabel:null,publishedOn:'2026-01-09'}),row({id:video2,tournamentId:null,tournamentLabel:null,matchId:null,matchLabel:null})];
  const {request}=fixture({catalog:{schemaVersion:1,items}});
  const all=request('listHandballMatchVideos').data;
  assert.deepEqual(all.items.map(x=>x.classificationStatus),['tournament_only','unclassified']);
  assert.equal(all.filters.unclassifiedTournamentCount,1);assert.equal(all.filters.unassignedMatchCount,2);
  assert.equal(all.items[0].publishedOn,'2026-01-09');assert.equal(all.items[1].publishedOn,'');
  assert.equal(request('listHandballMatchVideos',{tournamentId:tournament1}).data.total,1);
  assert.equal(request('listHandballMatchVideos',{matchId:null}).data.total,2);
  assert.equal(request('listHandballMatchVideos',{tournamentId:null}).data.total,1);
});
test('match dropdown choices include later pages and unassigned videos stay filterable',()=>{
  const items=Array.from({length:51},(_,i)=>row({id:'hv_'+(i+1).toString(16).padStart(32,'0'),
    matchId:i===50?null:'hm_'+(i+1).toString(16).padStart(32,'0'),matchLabel:i===50?null:'Synthetic match '+i}));
  const {request}=fixture({catalog:{schemaVersion:1,items}});
  const first=request('listHandballMatchVideos').data;
  assert.equal(first.items.length,20);assert.equal(first.filters.matches.length,50);
  assert.equal(first.filters.unassignedMatchCount,1);
  assert.equal(first.filters.matches[49].id,items[49].matchId);
  assert.equal(request('listHandballMatchVideos',{matchId:items[49].matchId}).data.items[0].id,items[49].id);
  assert.equal(request('listHandballMatchVideos',{matchId:null}).data.items[0].id,items[50].id);
});
test('malformed nullable classifications and posted dates fail closed',()=>{
  for(const patch of [{matchId:null},{matchId:null,matchLabel:null,classificationStatus:'match_identified'},
    {publishedOn:'2026-02-30'},{tournamentId:null,tournamentLabel:null}]) {
    const {request}=fixture({catalog:{schemaVersion:1,items:[row(patch)]}});
    denied(request('listHandballMatchVideos'),'CONFIGURATION_ERROR');
  }
});
test('catalog revision detects changed data between pages',()=>{
  const {request,state}=fixture();request('listHandballMatchVideos');state.catalog.revision=id('hc','b');
  denied(request('listHandballMatchVideos',{offset:20,catalogRevision:revision}),'REVISION_CONFLICT');
});
test('only configured private nontrashed JSON file is read without scans or public fallback',()=>{
  const {request,state}=fixture();assert.equal(request('listHandballMatchVideos').success,true);
  assert.deepEqual(state.fileReads,['fixture_catalog_file']);
  for(const options of [{fileId:''},{fileId:'bad/file'},{fileId:'fixture_catalog_file\n'},{sharing:'ANYONE_WITH_LINK'},
    {sharing:'DOMAIN'},{trashed:true},{fileMime:'application/vnd.google-apps.shortcut'},{fileSize:2*1024*1024+1},{blobBytes:[]},{rawCatalog:'invalid-json'}]) {
    const f=fixture(options);assert.equal(f.request('listHandballMatchVideos').success,false);assert.deepEqual(f.state.externalCalls,[]);
  }
});
test('unauthenticated or other-home thumbnail request performs zero Drive or provider reads',()=>{
  for(const options of [{failure:'auth'},{actor:{homeId:'fixture-home-b',memberUserId:'fixture-other'}}]) {
    const {request,state}=fixture(options);denied(request('getHandballMatchVideoThumbnail',{id:video1}),'FORBIDDEN');
    assert.deepEqual(state.fileReads,[]);assert.deepEqual(state.externalCalls,[]);
  }
});
test('thumbnail returns only bounded official JPEG bytes after exact actor/home/ID checks',()=>{
  const {request,state}=fixture({fetchQueue:[metadata(),response(200,'image/jpeg',fakeImage)]});
  const result=request('getHandballMatchVideoThumbnail',{id:video1});
  assert.deepEqual(result.data,{id:video1,status:'available',mimeType:'image/jpeg',base64:fakeImage.toString('base64')});
  assert.equal(state.externalCalls.length,2);
  assert.equal(state.externalCalls[0].url,'https://www.youtube.com/oembed?url='+encodeURIComponent(syntheticUrl)+'&format=json');
  assert.equal(state.externalCalls[1].url,'https://i.ytimg.com/vi/'+fakeProviderId+'/hqdefault.jpg');
  for(const {options} of state.externalCalls) {assert.equal(options.followRedirects,false);assert.equal(options.validateHttpsCertificates,true);assert.equal(options.timeoutSeconds,8);}
  assert.deepEqual(state.logs,[]);assert.doesNotMatch(JSON.stringify(result),/youtube|ytimg|fixture-home|fixture-owner/);
});
test('metadata refusal, redirect, hidden response, unsafe host or wrong video never requests image',()=>{
  for(const first of [response(403,'application/json',Buffer.from('{}')),response(302,'application/json',Buffer.from('{}')),
    response(404,'application/json',Buffer.from('{}')),response(200,'text/html',Buffer.from('<html>')),
    response(200,'application/json',Buffer.from('x'.repeat(32769))), metadata({provider_name:'Other'}),
    metadata({thumbnail_url:'https://evil.invalid/image.jpg'}), metadata({thumbnail_url:'https://i.ytimg.com/vi/Other000000/hqdefault.jpg'}),
    metadata({thumbnail_url:'https://i.ytimg.com/vi/'+fakeProviderId+'/hqdefault.jpg?redirect=anything'}),
    metadata({thumbnail_url:'https://i.ytimg.com.evil.invalid/vi/'+fakeProviderId+'/hqdefault.jpg'})]) {
    const {request,state}=fixture({fetchQueue:[first]});assert.equal(request('getHandballMatchVideoThumbnail',{id:video1}).data.status,'placeholder');
    assert.equal(state.externalCalls.length,1);assert.deepEqual(state.logs,[]);
  }
});
test('image redirect, wrong MIME, wrong bytes or oversized response returns only fixed placeholder',()=>{
  for(const second of [response(302,'image/jpeg',fakeImage),response(403,'image/jpeg',fakeImage),
    response(200,'image/svg+xml',fakeImage),response(200,'image/jpeg',Buffer.from('<html>not an image')),
    response(200,'image/jpeg',Buffer.alloc(256*1024+1)),response(200,'image/jpeg',fakeImage,{'Content-Length':'999999'}),new Error('private-sentinel')]) {
    const {request,state}=fixture({fetchQueue:[metadata(),second]});
    assert.deepEqual(request('getHandballMatchVideoThumbnail',{id:video1}).data,{id:video1,status:'placeholder',reason:'THUMBNAIL_UNAVAILABLE'});
    assert.equal(state.externalCalls.length,2);assert.deepEqual(state.logs,[]);
  }
});

test('all existing shopping family roles read without a gallery member allowlist',()=>{
  for(const role of ['admin','guardian','self_record']){
    const {request,state}=fixture({actor:{homeId:'fixture-home-a',memberUserId:'synthetic-family-'+role,role},readers:null});
    assert.equal(request('listHandballMatchVideos').success,true);
    assert.equal(request('getHandballMatchVideoLink',{id:video1}).success,true);
    assert.equal(request('getHandballMatchVideoThumbnail',{id:video1}).success,true);
    assert.equal(state.propertyReads.includes('HANDBALL_VIDEO_READERS_JSON'),false);
  }
});
test('actual existing role policy permits ordinary family profiles and denies unknown roles',()=>{
  for(const role of ['admin','guardian','self_record']){
    const {request}=fixture({realRolePolicy:true,readers:null,actor:{homeId:'fixture-home-a',memberUserId:'synthetic-'+role,role}});
    assert.equal(request('listHandballMatchVideos').success,true);
    assert.equal(request('getHandballMatchVideoLink',{id:video1}).success,true);
  }
  const {request,state}=fixture({realRolePolicy:true,actor:{homeId:'fixture-home-a',memberUserId:'synthetic-outsider',role:'viewer'}});
  denied(request('listHandballMatchVideos'),'FORBIDDEN');assert.equal(state.fileReads.length,0);
});
test('configured_home catalog needs no private member or home identifiers in the artifact',()=>{
  const item=row();delete item.homeId;
  const {request}=fixture({actor:{homeId:'fixture-home-a',memberUserId:'synthetic-younger-member',role:'self_record'},
    catalog:{schemaVersion:1,homeBinding:'configured_home',items:[item]}});
  const r=request('listHandballMatchVideos');assert.equal(r.success,true);assert.equal(r.data.total,1);
  assert.doesNotMatch(JSON.stringify(r),/homeId|memberUserId|synthetic-younger/);
});
test('foreign catalog Home and unbound identifier-free artifact fail closed',()=>{
  for(const catalog of [{schemaVersion:1,items:[row({homeId:'fixture-other-home'})]},
      {schemaVersion:1,homeBinding:'another_home',items:[row()]},
      {schemaVersion:1,items:[Object.fromEntries(Object.entries(row()).filter(([k])=>k!=='homeId'))]}]){
    const {request}=fixture({catalog});denied(request('listHandballMatchVideos'),'CONFIGURATION_ERROR');
  }
});
test('client or obsolete reader configuration cannot select a different family Home',()=>{
  const {request,state}=fixture({actor:{homeId:'fixture-home-b',memberUserId:'fixture-owner'},readers:{schemaVersion:1,readers:[{homeId:'fixture-home-b',memberUserId:'fixture-owner'}]}});
  denied(request('listHandballMatchVideos'),'FORBIDDEN');assert.equal(state.fileReads.length,0);assert.deepEqual(state.externalCalls,[]);
});

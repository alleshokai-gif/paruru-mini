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
const fakeProviderId = 'AbCdEf123_-'; // syntax-only synthetic value, never fetched
const syntheticUrl = 'https://www.youtube.com/watch?v=' + fakeProviderId;
function row(overrides = {}) {
  return {homeId: 'fixture-home-a', id: video1, tournamentId: tournament1,
    tournamentLabel: '架空大会A', matchId: match1, matchLabel: '架空試合A',
    title: '架空記録A', playedOn: '2026-01-10', youtubeUrl: syntheticUrl, ...overrides};
}
function fixture(options = {}) {
  const state = {actor: {homeId: 'fixture-home-a', memberUserId: 'fixture-owner'},
    verified: 0, propertyReads: [], logs: [], capabilities: [], failure: '',
    readers: {schemaVersion: 1, readers: [{homeId: 'fixture-home-a', memberUserId: 'fixture-owner'}]},
    catalog: {schemaVersion: 1, items: [row(), row({id: video2, tournamentId: tournament2,
      tournamentLabel: '架空大会B', matchId: match2, matchLabel: '架空試合B'}),
    row({id: foreign, homeId: 'fixture-home-b', tournamentId: id('ht','3'), matchId: id('hm','3')})]}, ...options};
  const fail = code => {const e = new Error('private-sentinel-must-not-escape'); e.code = code; return e;};
  const context = vm.createContext({
    console: {log: (...args) => state.logs.push(args), error: (...args) => state.logs.push(args)},
    Logger: {log: (...args) => state.logs.push(args)},
    PropertiesService: {getScriptProperties: () => ({getProperty: key => {
      state.propertyReads.push(key);
      if (state.failure === 'property') throw fail('untrusted-private-error');
      return key === 'HANDBALL_VIDEO_READERS_JSON'
        ? (state.readers === null ? null : JSON.stringify(state.readers))
        : (state.catalog === null ? null : JSON.stringify(state.catalog));
    }})},
    verifyFirebaseIdToken_: token => {
      state.verified++;
      if (token !== 'fixture-token' || state.failure === 'auth') throw fail('AUTH_TOKEN_INVALID');
      return {provider: 'firebase', providerSubject: 'fixture-subject', authTime: 1};
    },
    resolveHomeIdentity_: () => state.actor,
    getHomeMember_: () => ({...state.actor, role: 'fixture-role', status: state.failure === 'disabled' ? 'disabled' : 'active'}),
    isHomeMemberPolicyMatch_: () => true,
    isHomeMemberAccessRole_: () => true,
    getEffectiveMemberCapabilities_: () => ['home.read'],
    getEffectiveMemberAllowedViews_: () => ['fixture-view'],
    authorizeCapability_: (actor, capability) => {state.capabilities.push(capability); if (state.failure === 'capability') throw fail('FORBIDDEN');},
    firebaseAuthError_: fail, homeMembershipError_: fail,
  });
  for (const name of ['gas/TransportDiagnostics.js', 'gas/Code.js', 'gas/AuthenticatedActorService.js', 'gas/HandballMatchVideoService.js']) vm.runInContext(source(name), context);
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
  assert.deepEqual(Object.keys(result.data.items[0]).sort(), ['id','tournamentId','tournamentLabel','matchId','matchLabel','title','playedOn','thumbnail'].sort());
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
  ['another family member', {homeId:'fixture-home-a', memberUserId:'fixture-other'}],
  ['same member in another home', {homeId:'fixture-home-b', memberUserId:'fixture-owner'}],
  ['missing home', {memberUserId:'fixture-owner'}],
  ['missing member', {homeId:'fixture-home-a'}],
]) test(name + ' is not authorized by ambient family role', () => {
  const {request, state} = fixture({actor}); denied(request('listHandballMatchVideos'), 'FORBIDDEN');
  assert.equal(state.propertyReads.includes('HANDBALL_VIDEO_CATALOG_JSON'), false);
});
test('client actor/role/home spoofing is rejected', () => {
  const {request} = fixture(); denied(request('listHandballMatchVideos', {homeId:'fixture-home-a',memberUserId:'fixture-owner',role:'admin'}), 'INVALID_INPUT');
});
test('allowlist tuple comparison is exact, with no case folding or trimming', () => {
  for (const actor of [{homeId:'fixture-home-a ',memberUserId:'fixture-owner'}, {homeId:'fixture-home-a',memberUserId:'FIXTURE-OWNER'}]) {
    const {request,state} = fixture({actor}); denied(request('listHandballMatchVideos'),'FORBIDDEN');
    assert.equal(state.propertyReads.includes('HANDBALL_VIDEO_CATALOG_JSON'),false);
  }
});
test('missing or malformed reader configuration fails closed', () => {
  for (const readers of [null, {}, {schemaVersion:1, readers:[]}, {schemaVersion:1, readers:[{homeId:'fixture-home-a',memberUserId:'fixture-owner',role:'admin'}]}]) {
    const {request, state} = fixture({readers}); assert.equal(request('listHandballMatchVideos').success, false);
    assert.equal(state.propertyReads.includes('HANDBALL_VIDEO_CATALOG_JSON'), false);
  }
});
test('disabled membership and denied home.read fail before catalog', () => {
  for (const failure of ['disabled','capability']) {
    const {request, state} = fixture({failure}); denied(request('listHandballMatchVideos'), 'FORBIDDEN'); assert.deepEqual(state.propertyReads, []);
  }
});
test('link and thumbnail each freshly authenticate and recheck allowlist', () => {
  const {request, state} = fixture(); request('listHandballMatchVideos');
  const link = request('getHandballMatchVideoLink', {id:video1}); assert.deepEqual(link.data, {id:video1,url:syntheticUrl});
  const thumbnail = request('getHandballMatchVideoThumbnail', {id:video1});
  assert.deepEqual(thumbnail.data, {id:video1,status:'placeholder',reason:'THUMBNAIL_UNAVAILABLE'});
  assert.equal(state.verified, 3);
  state.readers.readers = [{homeId:'fixture-home-a',memberUserId:'fixture-other'}];
  denied(request('getHandballMatchVideoLink', {id:video1}), 'FORBIDDEN');
  denied(request('getHandballMatchVideoThumbnail', {id:video1}), 'FORBIDDEN');
  assert.equal(state.verified, 5);
});
test('changing current member after list never reuses old actor', () => {
  const {request, state} = fixture(); request('listHandballMatchVideos'); state.actor.memberUserId = 'fixture-other';
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
  for (const fields of [{offset:-1},{offset:'0'},{offset:51},{limit:21},{limit:0},{limit:1.5},{url:syntheticUrl},{tournamentId:'all'},{matchId:match1+'\n'}]) denied(request('listHandballMatchVideos',fields),'INVALID_INPUT');
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
test('read-only implementation cannot fetch, write, cache, log or use Family Inbox credentials', () => {
  const service = source('gas/HandballMatchVideoService.js');
  assert.doesNotMatch(service, /UrlFetchApp|CacheService|setProperty|setProperties|SpreadsheetApp|DriveApp|Logger\.|console\.|getServiceSecret_|familyInboxGatewayCallService_/);
  assert.doesNotMatch(service, /thumbnailUrl|i\.ytimg\.com/);
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

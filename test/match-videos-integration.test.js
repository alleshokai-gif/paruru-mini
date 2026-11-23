'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('authentication alone never reads; view lifecycle and lock clear the API references',async()=>{
  const events=new Map(),windowEvents=new Map(),sessions=[];let options,reads=0,opens=0,closes=0;
  const view={setSession:s=>sessions.push(s),open:()=>{opens++;return options.read();},close:()=>{closes++;}};
  const document={hidden:false,getElementById:id=>id==='matchVideosRoot'?{}:{classList:{contains:()=>true}},
    addEventListener:(name,handler)=>events.set(name,handler),dispatchEvent:()=>{}};
  const context={document,window:{addEventListener:(name,handler)=>windowEvents.set(name,handler)},
    PaluruMatchVideos:{create:value=>{options=value;return view;}},CustomEvent:class {}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../features/match-videos/integration.js'),'utf8'),context);
  events.get('paruru:authenticated')({detail:{context:{role:'guardian',allowedViews:['home']},matchVideosApi:async()=>{reads++;return {items:[]};},matchVideoLinkApi:async id=>({fixture:id})}});
  assert.equal(reads,0,'login must not request video metadata');
  let pending;events.get('match-videos:opened')({detail:{waitUntil:p=>{pending=p;}}});await pending;
  assert.equal(reads,1);assert.equal(opens,1);
  assert.equal((await options.getLink('fixture-upload')).fixture,'fixture-upload');
  events.get('match-videos:closed')();assert.equal(closes,1);
  document.hidden=true;events.get('visibilitychange')();assert.equal(closes,2);
  events.get('kaz-os:locked')();
  assert.equal(sessions.at(-1).authenticated,false);
  await assert.rejects(options.read(),{code:'MATCH_VIDEOS_NOT_CONFIGURED'});
  await assert.rejects(options.getLink('fixture-upload'),{code:'MATCH_VIDEOS_NOT_CONFIGURED'});
  assert.equal(await options.readThumbnail('fixture-upload'),null);
  assert.equal(reads,1,'logout cannot retain and call the prior member reader');
  windowEvents.get('pagehide')();assert.equal(closes,4);
});

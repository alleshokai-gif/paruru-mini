'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
class Node{
  constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.listeners={};}
  appendChild(n){this.children.push(n);return n;}prepend(n){this.children.unshift(n);}
  setAttribute(){}addEventListener(k,fn){this.listeners[k]=fn;}
}
const all=n=>[n,...n.children.flatMap(all)];
const sandbox={document:{createElement:t=>new Node(t)},Date,Intl};sandbox.globalThis=sandbox;
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../features/kaz-os/autonomous-work.js'),'utf8'),sandbox);
const feature=sandbox.KazAutonomousWork;
function fixture(){return {schema_version:'kaz-autonomous-view-v1',as_of:new Date().toISOString(),status:'current',raw_payload_stored:false,
  run:{schema_version:'kaz-autonomous-run-v1',run_id:'a'.repeat(64),night_day:'2026-11-02',status:'review_pending',
    finished_at:new Date().toISOString(),canonical_writes:0,provider_api_calls:0,auto_apply_allowed:false,raw_payload_stored:false,
    items:[{work_id:'w',title:'Synthetic audit',status:'review_pending',summary:'Observed facts',review_question:'Review the result?',
      review_estimate_min:null,pr_url:'https://github.com/owner/repo/pull/1',substep_completed:true,ci_status:'unknown',
      review_read_status:'current',review:null,validation:'observed_git_facts',area:'PERSONAL'}]}};}
async function main(){
  const empty=new Node('div');await feature.append(empty,{read:async()=>({schema_version:'kaz-autonomous-view-v1',status:'no_results',run:null,raw_payload_stored:false}),current:()=>true});
  assert.equal(empty.children.length,0,'no false result card on an empty night');
  for(const decision of ['approve','changes_requested','defer','reject']){
    const host=new Node('div'),v=fixture();let calls=0;
    await feature.append(host,{read:async()=>v,current:()=>true,review:async payload=>{
      calls++;assert.equal(payload.decision,decision);v.run.items[0].review={decision,observed_at:payload.observed_at};
      return {schema_version:'kaz-autonomous-review-receipt-v1',status:'saved',decision,observed_at:payload.observed_at,
        auto_apply_allowed:false,canonical_writes:0,provider_calls:0};}});
    const b=all(host).find(x=>x.dataset.autonomousDecision===decision);await b.listeners.click();
    assert.equal(calls,1);assert.ok(all(host).some(x=>x.textContent?.includes('読み戻せました')));
    assert.equal(v.run.status,'review_pending','review acknowledgement does not apply or merge');
  }
  const unavailable=fixture();unavailable.run.items[0].review_read_status='unavailable';
  const host=new Node('div');await feature.append(host,{read:async()=>unavailable,current:()=>true,review:async()=>{throw Error('must not submit')}});
  assert.ok(all(host).filter(x=>x.tag==='button').every(x=>x.disabled));
  const failedHost=new Node('div');let attempts=0;
  await feature.append(failedHost,{read:async()=>fixture(),current:()=>true,review:async()=>{attempts++;throw Error('uncertain')}});
  await all(failedHost).find(x=>x.tag==='button').listeners.click();
  assert.equal(attempts,1);assert.ok(all(failedHost).some(x=>x.textContent?.includes('再送せず')));
  assert.ok(all(failedHost).filter(x=>x.tag==='button').every(x=>x.disabled));
  const invalid=fixture();invalid.run.items[0].pr_url='javascript:alert(1)';assert.throws(()=>feature.validate(invalid));
  const snapshot={status:'CURRENT',sources:{calendar:{status:'current',valid_until:'2100-01-01T00:00:00Z'}},
    work:[{id:'w',project_id:'p'}],projects:[{id:'p',area:'PERSONAL'}],today:{
      company_free_windows:[{start:'2099-01-01T09:00:00Z',end:'2099-01-01T10:00:00Z'}],
      personal_free_windows:[{start:'2099-01-01T12:00:00Z',end:'2099-01-01T13:00:00Z'}]}};
  assert.equal(feature.reviewWindow(snapshot,fixture().run.items[0]).start,'2099-01-01T12:00:00Z');
  snapshot.sources.calendar.valid_until=null;assert.equal(feature.reviewWindow(snapshot,fixture().run.items[0]),null);
  console.log('PASS autonomous results: empty, grounded/unknown, four review readbacks, no apply/retry, domain slots');
}
main().catch(e=>{console.error(e);process.exitCode=1;});

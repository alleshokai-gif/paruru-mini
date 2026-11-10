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
      review_read_status:'current',review:null,validation:'observed_git_facts',area:'PERSONAL',
      review_state:'owner_decision',owner_decision:{kind:'priority_tradeoff',background:'Both reports are ready.',
        cause:'One reviewer is available.',verified_facts:'Both artifacts were read back.',
        remaining:'Choose the report to review first.',recommended_option:'Review the urgent fix.',
        alternative_option:'Review the audit.',recommendation_reason:'The fix has a nearer deadline.',
        owner_reason:'The owner decides which deadline matters more.'}}]}};}
async function main(){
  const empty=new Node('div');await feature.append(empty,{read:async()=>({schema_version:'kaz-autonomous-view-v1',status:'no_results',run:null,raw_payload_stored:false}),current:()=>true});
  assert.ok(all(empty).some(x=>x.textContent==='新しい部分成果 0件 · 今夜の判断待ち 0件'));
  assert.equal(all(empty).filter(x=>x.tag==='article').length,0,'no false result on an empty night');
  const partial={work_label:'WI-51',title:'Context Feedback',status:'partial_completed',work_done:false,
    completed_at:new Date().toISOString(),summary:'利用結果を記録',next_action:'参照方針の見直し',
    decision_required:false,evidence_refs:[`https://github.com/alleshokai-gif/kaz-context/blob/${'b'.repeat(40)}/intermediate/context-feedback.json`]};
  const partialHost=new Node('div');
  await feature.append(partialHost,{read:async()=>({schema_version:'kaz-autonomous-view-v1',status:'no_results',
    run:null,raw_payload_stored:false,partial_progress:[partial]}),current:()=>true});
  assert.ok(all(partialHost).some(x=>x.dataset.autonomousPartial==='WI-51'));
  assert.ok(all(partialHost).some(x=>x.textContent?.includes('Work全体は未完了')));
  assert.ok(all(partialHost).some(x=>x.textContent==='参照方針の見直し'));
  assert.ok(all(partialHost).some(x=>x.textContent==='今は本人の判断は不要です。'));
  assert.equal(all(partialHost).filter(x=>x.tag==='button').length,0);
  const asOf='2026-11-05T08:00:00+09:00';
  for(const [status,reason,expected] of [
    ['skipped','no_eligible_work','正常スキップ'],['no_output',null,'新しい成果は記録されていません'],
    ['verification_failed',null,'成果案を検証できません'],['failed',null,'夜間処理が失敗'],
    ['unknown',null,'夜間処理の結果を確認できません'],['unavailable',null,'記録を取得できません']
  ]){
    const zero=new Node('div');
    await feature.append(zero,{read:async()=>({schema_version:'kaz-autonomous-view-v1',as_of:asOf,
      status:'no_results',run:null,raw_payload_stored:false,
      night_execution:{day:'2026-11-04',status,reason,inventory_count:1,exclusions:{RESERVED:1}}}),current:()=>true});
    assert.ok(all(zero).some(x=>x.textContent?.includes(expected)),status);
    if(status==='skipped')assert.ok(all(zero).some(x=>x.textContent==='同じ作業が予約済み 1件'));
  }
  const attempted=new Node('div');
  await feature.append(attempted,{read:async()=>({schema_version:'kaz-autonomous-view-v1',as_of:asOf,
    status:'no_results',run:null,raw_payload_stored:false,
    night_execution:{day:'2026-11-04',status:'no_output',reason:'no_eligible_work'},
    night_attempts:[{work_label:'WI-51',started_at:'2026-11-04T23:00:43+09:00',status:'no_output'}]}),current:()=>true});
  assert.ok(all(attempted).some(x=>x.textContent==='WI-51 · 夜間の成果物作成'));
  assert.ok(all(attempted).some(x=>x.textContent?.includes('新しい成果案は返りませんでした')));
  assert.equal(all(attempted).filter(x=>x.tag==='button').length,0);
  const external={...partial,work_label:'WI-45',
    evidence_refs:[`https://github.com/alleshokai-gif/energy-management-gas/blob/${'a'.repeat(40)}/tests/backfill.apply.pure.test.js`]};
  const externalHost=new Node('div');
  await feature.append(externalHost,{read:async()=>({schema_version:'kaz-autonomous-view-v1',
    as_of:asOf,status:'no_results',run:null,raw_payload_stored:false,
    partial_progress:[external]}),current:()=>true});
  assert.ok(all(externalHost).some(x=>x.href===external.evidence_refs[0]));
  const lastNight={...partial,work_label:'WI-50',title:'Last night result',origin:'night_artifact',started_at:'2026-11-04T23:00:00+09:00',completed_at:'2026-11-04T23:15:00+09:00'};
  const older={...partial,work_label:'WI-48',title:'Old result',completed_at:'2026-11-03T13:00:00+09:00'};
  const daytime={...partial,origin:'manual',completed_at:'2026-11-05T07:00:00+09:00'};
  const nightlyHost=new Node('div');
  await feature.append(nightlyHost,{read:async()=>({schema_version:'kaz-autonomous-view-v1',
    as_of:asOf,status:'no_results',run:null,raw_payload_stored:false,
    partial_progress:[older,lastNight,daytime]}),current:()=>true});
  const recentBox=all(nightlyHost).find(x=>x.className==='kai-autonomous-latest');
  const historyBox=all(nightlyHost).find(x=>x.className==='kai-autonomous-history');
  assert.ok(recentBox&&historyBox,'latest and history are separate');
  assert.ok(all(recentBox).some(x=>x.dataset.autonomousPartial==='WI-50'));
  assert.ok(!all(recentBox).some(x=>x.dataset.autonomousPartial==='WI-48'));
  assert.ok(all(historyBox).some(x=>x.dataset.autonomousPartial==='WI-48'));
  assert.ok(!all(historyBox).some(x=>x.dataset.autonomousPartial==='WI-51'));
  assert.ok(all(nightlyHost).some(x=>x.textContent==='依頼を受けて先に進めた仕事'));
  assert.ok(!all(recentBox).some(x=>x.dataset.autonomousPartial==='WI-51'));
  assert.ok(!historyBox.open,'history starts collapsed');
  assert.ok(all(recentBox).some(x=>x.textContent==='新しい部分成果 1件 · 今夜の判断待ち 0件'));
  const batch=fixture(), second=fixture().run;
  batch.as_of=asOf;
  batch.run.night_day=second.night_day='2026-11-04';
  second.run_id='b'.repeat(64);second.items[0].work_id='second';
  batch.run.codex_cli_attempts=second.codex_cli_attempts=1;
  batch.run.metrics={usage:{input_tokens:100,cached_input_tokens:20,output_tokens:10}};
  second.metrics={usage:{input_tokens:200,cached_input_tokens:30,output_tokens:15}};
  batch.night_runs=[batch.run,second];
  const batchHost=new Node('div');
  await feature.append(batchHost,{read:async()=>batch,current:()=>true,review:async payload=>{
    assert.equal(payload.run_id,second.run_id);
    second.items[0].review={decision:payload.decision,observed_at:payload.observed_at};
    return {schema_version:'kaz-autonomous-review-receipt-v1',status:'saved',decision:payload.decision,
      auto_apply_allowed:false,canonical_writes:0,provider_calls:0};
  }});
  const batchRecent=all(batchHost).find(x=>x.className==='kai-autonomous-latest');
  assert.ok(all(batchRecent).some(x=>x.textContent==='新しい部分成果 2件 · 今夜の判断待ち 2件'));
  assert.ok(all(batchRecent).some(x=>x.textContent?.includes('入力 300 · 出力 25')));
  await all(all(batchRecent).find(x=>x.dataset.autonomousWork==='second'))
    .find(x=>x.dataset.autonomousDecision==='approve').listeners.click();
  assert.ok(all(batchRecent).some(x=>x.textContent==='新しい部分成果 2件 · 今夜の判断待ち 1件'));
  const oldRun=fixture();oldRun.as_of=asOf;oldRun.run.night_day='2026-11-03';
  const oldRunHost=new Node('div');
  await feature.append(oldRunHost,{read:async()=>oldRun,current:()=>true});
  const oldRunRecent=all(oldRunHost).find(x=>x.className==='kai-autonomous-latest');
  const oldRunHistory=all(oldRunHost).find(x=>x.className==='kai-autonomous-history');
  assert.ok(all(oldRunRecent).some(x=>x.textContent==='新しい部分成果 0件 · 今夜の判断待ち 0件'));
  assert.ok(all(oldRunHistory).some(x=>x.dataset.autonomousWork==='w'));
  const reviewed=fixture();reviewed.as_of=asOf;reviewed.run.night_day='2026-11-03';
  reviewed.run.status='complete';
  Object.assign(reviewed.run.items[0],{status:'complete',review_state:'completed',owner_decision:null,
    review:{decision:'defer',observed_at:'2026-11-04T09:00:00+09:00'}});
  const reviewedHost=new Node('div');
  await feature.append(reviewedHost,{read:async()=>reviewed,current:()=>true,
    review:async()=>{throw Error('must not submit');}});
  const reviewedHistory=all(reviewedHost).find(x=>x.className==='kai-autonomous-history');
  assert.ok(all(reviewedHistory).some(x=>x.textContent==='判断を保留を記録済みです。'));
  assert.equal(all(reviewedHistory).filter(x=>x.tag==='button').length,0);


  const unread=new Node('div');
  await feature.append(unread,{read:async()=>({schema_version:'kaz-autonomous-view-v1',as_of:asOf,
    status:'no_results',run:null,raw_payload_stored:false,partial_progress_unavailable:true}),current:()=>true});
  assert.ok(all(unread).some(x=>x.textContent?.includes('集計できません')));

  const both=new Node('div');await feature.append(both,{read:async()=>({...fixture(),partial_progress:[partial]}),
    current:()=>true,review:async()=>{throw Error('must not submit')}});
  assert.ok(all(both).some(x=>x.dataset.autonomousPartial==='WI-51'));
  assert.equal(all(both).filter(x=>x.tag==='button').length,4);
  for(const decision of ['approve','changes_requested','defer','reject']){
    const host=new Node('div'),v=fixture();let calls=0;
    v.as_of=asOf;v.run.night_day='2026-11-04';
    await feature.append(host,{read:async()=>v,current:()=>true,review:async payload=>{
      calls++;assert.equal(payload.decision,decision);v.run.items[0].review={decision,observed_at:payload.observed_at};
      return {schema_version:'kaz-autonomous-review-receipt-v1',status:'saved',decision,observed_at:payload.observed_at,
        auto_apply_allowed:false,canonical_writes:0,provider_calls:0};}});
    const b=all(host).find(x=>x.dataset.autonomousDecision===decision);
    assert.match(b.textContent,/優先順/);
    const card=all(host).find(x=>x.dataset.autonomousWork==='w');
    assert.deepEqual(card.children.filter(x=>x.tag==='h4').map(x=>x.textContent),
      ['何が進んだか','AIの推奨','あなたにお願いしたい判断']);
    assert.equal(all(card.children.find(x=>x.tag==='details')).some(x=>x.textContent==='原因'),true);
    assert.deepEqual(all(host).find(x=>x.className==='kai-review-actions').children.map(x=>x.dataset.autonomousDecision),
      ['approve','changes_requested','defer','reject']);
    await b.listeners.click();
    assert.equal(calls,1);assert.ok(all(host).some(x=>x.textContent?.includes('読み戻せました')));
    assert.equal(v.run.status,'review_pending','review acknowledgement does not apply or merge');
    assert.ok(all(host).filter(x=>x.tag==='button').every(x=>x.disabled),'one explicit immutable review per report');
    assert.ok(all(host).some(x=>x.textContent==='新しい部分成果 1件 · 今夜の判断待ち 0件'));
  }
  for(const change of [{status:'failed'},{owner_decision:null},{review_state:'investigation_pending'},
      {validation:'tracking_ref_stale'}]){
    const failure=fixture(), failureHost=new Node('div');Object.assign(failure.run.items[0],change);
    await feature.append(failureHost,{read:async()=>failure,current:()=>true,review:async()=>{throw Error('must not submit')}});
    assert.equal(all(failureHost).filter(x=>x.tag==='button').length,0);
    assert.ok(all(failureHost).some(x=>x.textContent?.includes('自動調査・再評価待ち 1件')));
    assert.ok(all(failureHost).some(x=>x.textContent==='根拠資料（任意）'));
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

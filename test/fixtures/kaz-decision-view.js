'use strict';
// Synthetic UI acceptance input. Never loaded by production navigation.
const {fixture}=require('./kaz-personal-view');
function decisionFixture(){
  const d=fixture(),day='2026-09-14',tomorrow='2026-09-15';
  d.inbox_items=[];d.ideas=[];d.context_candidates=[];d.review_packets={};d.decision_priority_evidence={};
  d.sources.inbox={...d.sources.inbox,source_revision:'fixture:decision-queue-v1',scope:'synthetic 100 personal decisions'};
  const types=[['human_review',20],['acceptance',10],['idea_triage',30],['context_candidate',20],['classification_required',10],['blocker_decision',10]];
  const todayIds=new Set([1,21,31,81,91]);let serial=0,workIndex=20;
  for(const [kind,count] of types)for(let n=0;n<count;n++){
    const num=++serial,id='di-'+String(num).padStart(3,'0'),project=d.projects[n%10];
    const title={human_review:`配送ルール修正を確認 ${n+1}`,acceptance:`終了条件を確認 ${n+1}`,idea_triage:`バス混雑予測の案 ${n+1}`,context_candidate:`判断の背景を候補として確認 ${n+1}`,classification_required:`共有予定の本人への影響を確認 ${n+1}`,blocker_decision:`次工程へ進める条件を判断 ${n+1}`}[kind];
    let entity;
    if(['human_review','acceptance','blocker_decision'].includes(kind)){
      entity=d.work_items[workIndex++];
      Object.assign(entity,{title,project_id:project.id,next_actor:'kaz',state:{human_review:'HUMAN_REVIEW',acceptance:'ACCEPTANCE',blocker_decision:'BLOCKED'}[kind],action_kind:kind,revision:3});
      entity.estimate_min=kind==='acceptance'?10:5;
      if(kind!=='blocker_decision'){
        const refs=Object.fromEntries(['run_result','git_diff','tests','instruction','git_before','git_after'].map((key,index)=>[key,{ref:`fixture:run-${id}/${key}`,sha256:String(index+1).repeat(64)}]));
        d.review_packets[entity.id]={work_item_id:entity.id,expected_revision:3,run_id:'fixture:run-'+id,source_revision:'fixture:run-rev-'+id,execution_status:'completed',capture_status:'complete',refs,missing_evidence:[],capture_gaps:[],human_review_status:kind==='acceptance'?'ACCEPTED':'pending',acceptance_eligible:true,synthetic:true,not_real_user_approval:true};
        d.review_packets[entity.id].result_summary='合成Runの結果要約。実行・テスト・本人承認の実証ではありません。';
        d.review_packets[entity.id].changed_files=['fixture/example.js'];
        entity.acceptance_criteria=[{id:'purpose',instruction:'Work Itemの目的を満たす',evidence_key:'run_result'},{id:'scope',instruction:'変更範囲と差分を確認',evidence_key:'git_diff'},{id:'tests',instruction:'指定テストのEvidenceを確認',evidence_key:'tests'}];
      }
    }else if(kind==='classification_required'){
      entity=d.calendar_events[n];entity.source_revision='fixture:event-rev-'+n;
    }else{
      entity={id:'entity-'+id,title,project_id:project.id,revision:1,synthetic:true};
      if(kind==='context_candidate'){entity.curated=false;entity.review_ref='fixture:candidate-review-'+id;d.context_candidates.push(entity);}else d.ideas.push(entity);
    }
    const item={id,kind,title,entity_ref:entity.id,project_id:project.id,owner:'kaz',decision_requested:true,decision_status:'pending',synthetic:true,
      estimate_min:kind==='acceptance'?10:kind==='idea_triage'?2:5,decision_date:todayIds.has(num)?day:tomorrow,
      due_at:todayIds.has(num)?day+'T18:00:00+09:00':null,
      reason:{human_review:'実行結果を本人が確認する',acceptance:'目的と終了条件の充足を本人が判断する',idea_triage:'Task化・保留・却下の方向を決める',context_candidate:'長期Contextへ残す価値を判断する',classification_required:'本人の時間への影響を確認する',blocker_decision:'AIだけでは決められない条件を確認する'}[kind]};
    if([81,91].includes(num)){item.blocks_today_plan=true;item.impact_date=day;item.impact='今日のPlanに使える時間を確定する';}
    if(num===21){item.blocks_project_completion=true;item.impact='終了条件の判断でProjectを前へ';}
    if(num===31){item.high_leverage=true;item.impact='短い判断で次の検討方針へ';}
    if([81,91,21,31].includes(num)){
      item.priority_ref='fixture:priority-'+id;
      d.decision_priority_evidence[item.priority_ref]={inbox_item_id:id,source_revision:d.sources.inbox.source_revision,blocks_today_plan:item.blocks_today_plan===true,blocks_project_completion:item.blocks_project_completion===true,high_leverage:item.high_leverage===true,reason:item.impact};
    }
    d.inbox_items.push(item);
  }
  return d;
}
function inlineDecisionFixture(){
  const d=decisionFixture();
  for(const item of d.inbox_items){
    const packet=d.review_packets[item.entity_ref];
    if(['human_review','acceptance'].includes(item.kind)){
      item.review_policy={mode:'summary_permitted',source_revision:d.sources.inbox.source_revision,evidence_ref:'fixture:summary-review-policy',not_real_approval:true};
      const text={run_result:'保存成功を確認',git_diff:'フォーム再enableとrefreshを分離',tests:'指定テストと回帰結果を確認',instruction:'作業目的と終了条件を保持',git_before:'変更前の比較revisionを保持',git_after:'変更後の差分と範囲を保持'};
      packet.evidence_summaries=Object.entries(packet.refs).map(([key,ref])=>({key,...ref,source_revision:packet.source_revision,text:text[key]}));
      packet.test_summary={passed:128,total:128,...packet.refs.tests,source_revision:packet.source_revision};
      packet.regression_summary={failures:0,...packet.refs.tests,source_revision:packet.source_revision};
      packet.changed_files=['fixture/save-flow.js','fixture/save-flow.test.js'];
      item.reason='保存処理を変更したため、本人の確認が必要です。';
      item.source_label='Codex · 検証用Run';
    }
    if(item.kind==='idea_triage')item.source_label='Source: ChatGPT（fixture）';
    if(item.kind==='context_candidate')item.source_label='Context candidate · 未昇格';
    if(item.kind==='classification_required')item.source_label='Family Calendar（fixture）';
    if(item.kind==='blocker_decision'){
      item.answer_contract={inbox_item_id:item.id,source_revision:d.sources.inbox.source_revision,question:'この条件で次工程へ進める？',choices:[{value:'unblock',label:'進める',effect:'解除方針の確認へ'},{value:'defer',label:'まだ待つ',effect:'判断を保留する案へ'}]};
    }
  }
  const question=d.inbox_items.find(i=>i.kind==='classification_required'),event=d.calendar_events.find(e=>e.impact_on_kaz==='unknown');
  question.entity_ref=event.id;event.source_revision='fixture:shared-event-rev';event.title='次男 ハンドボール';
  question.project_id=d.projects.find(p=>p.title==='家庭・学校予定').id;
  question.reason='今日のPlanに影響します。';question.impact='回答をもとに、本人の拘束条件を見直す候補にします。';
  return d;
}
module.exports={decisionFixture,inlineDecisionFixture};

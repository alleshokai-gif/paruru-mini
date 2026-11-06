/* Existing TODAY extension. Review observations never merge/apply canonical data. */
(function(root) {
  'use strict';
  const choices = Object.freeze({approve:'推奨案を選択',changes_requested:'別案の検討',defer:'判断を保留',reject:'提案を見送り'});
  const topics = Object.freeze({priority_tradeoff:'優先順',scope_tradeoff:'作業範囲'});
  const statuses = new Set(['running','review_pending','complete','failed','blocked','unknown']);
  const partialSource=/^https:\/\/github\.com\/alleshokai-gif\/(?:(?:kaz-context\/blob\/[a-f0-9]{40}\/(?:feedback\/events\/[0-9]{4}\/[0-9]{2}\/fb-[a-z0-9-]+\.json|intermediate\/[a-z0-9-]+\.json|(?:tools\/kaz-os|docs)\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:md|py|js)))|kaz-content\/blob\/[a-f0-9]{40}\/articles\/ai-conversation-series\/article_(?:[0-9]{2}_draft_v[0-9]+(?:_review)?|autonomous_[a-f0-9]{64}_draft)\.md|(?:(?:energy-management-gas|quality-quest|paruru-mini)\/blob\/[a-f0-9]{40}\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*\.(?:md|py|js|mjs|cjs|gs|css|html)))$/;
  const decisionFields = Object.freeze({background:400,cause:400,verified_facts:500,remaining:400,
    recommended_option:300,alternative_option:300,recommendation_reason:400,owner_reason:400});
  function ready(item) {
    const d=item.owner_decision;
    return item.review_state==='owner_decision' && item.status==='review_pending'
      && item.substep_completed===true && item.validation==='observed_git_facts' && !item.error_code
      && d && Object.hasOwn(topics,d.kind) && Object.keys(d).length===Object.keys(decisionFields).length+1
      && Object.entries(decisionFields).every(([key,max])=>typeof d[key]==='string'&&d[key].trim()&&d[key].length<=max)
      && d.recommended_option.trim()!==d.alternative_option.trim();
  }
  const text = (parent,tag,value,className='') => {
    const e=document.createElement(tag);e.textContent=value;e.className=className;parent.appendChild(e);return e;
  };
  function validate(view) {
    if(!view||view.schema_version!=='kaz-autonomous-view-v1'||view.raw_payload_stored!==false
      ||!['no_results','current','stale'].includes(view.status))throw Error('AUTONOMOUS_CONTRACT_INVALID');
    if(view.partial_progress!==undefined&&(!Array.isArray(view.partial_progress)||view.partial_progress.length>16
      ||view.partial_progress.some(i=>!i||!/^WI-[1-9][0-9]*$/.test(i.work_label)
        ||i.status!=='partial_completed'||i.work_done!==false||typeof i.decision_required!=='boolean'
        ||!Number.isFinite(Date.parse(i.completed_at))
        ||(i.origin!==undefined&&!['manual','night_artifact','night_evidence'].includes(i.origin))
        ||(i.origin==='night_artifact'&&(!Number.isFinite(Date.parse(i.started_at))||Date.parse(i.started_at)>Date.parse(i.completed_at)))
        ||![['title',160],['summary',500],['next_action',300]]
          .every(([key,max])=>typeof i[key]==='string'&&i[key].trim()&&i[key].length<=max)
        ||!Array.isArray(i.evidence_refs)||!i.evidence_refs.length||i.evidence_refs.length>3
        ||!i.evidence_refs.every(ref=>typeof ref==='string'&&partialSource.test(ref)))))
      throw Error('AUTONOMOUS_PARTIAL_CONTRACT_INVALID');
    if(view.status==='no_results') {if(view.run!==null)throw Error('AUTONOMOUS_CONTRACT_INVALID');return view;}
    const r=view.run;
    if(!r||r.schema_version!=='kaz-autonomous-run-v1'||!/^[a-f0-9]{64}$/.test(r.run_id)
      ||!statuses.has(r.status)||r.canonical_writes!==0||r.provider_api_calls!==0||r.auto_apply_allowed!==false
      ||r.raw_payload_stored!==false||!Number.isFinite(Date.parse(r.finished_at))
      ||!Array.isArray(r.items)||!r.items.length||r.items.length>2)throw Error('AUTONOMOUS_CONTRACT_INVALID');
    for(const i of r.items){
      if(typeof i.work_id!=='string'||typeof i.title!=='string'||i.title.length>200||!statuses.has(i.status)
        ||typeof i.summary!=='string'||i.summary.length>1200||typeof i.review_question!=='string'||i.review_question.length>500
        ||i.review_estimate_min!==null||typeof i.substep_completed!=='boolean'
        ||!['current','unavailable'].includes(i.review_read_status)
        ||(i.pr_url!==null&&!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]*$/.test(i.pr_url))
        ||(i.review!==null&&(!choices[i.review?.decision]||!Number.isFinite(Date.parse(i.review?.observed_at)))))
        throw Error('AUTONOMOUS_CONTRACT_INVALID');
    }
    return view;
  }
  function reviewWindow(snapshot,item,now=Date.now()) {
    const w=(snapshot?.work||[]).find(w=>w.id===item.work_id);
    const p=(snapshot?.projects||[]).find(p=>p.id===w?.project_id);
    const area=p?.area||item.area;
    const source=snapshot?.sources?.calendar;
    if(snapshot?.status!=='CURRENT'||source?.status!=='current'
      ||!Number.isFinite(Date.parse(source.valid_until))||Date.parse(source.valid_until)<=now)return null;
    const windows=area==='WORK'?snapshot.today?.company_free_windows
      :area==='PERSONAL'?snapshot.today?.personal_free_windows:null;
    return (windows||[]).filter(x=>Number.isFinite(Date.parse(x.start))&&Date.parse(x.end)>now)
      .sort((a,b)=>Date.parse(a.start)-Date.parse(b.start))[0]||null;
  }
  function nightDay(value, resultTime=false) {
    const d=new Date(value);
    if(!Number.isFinite(d.getTime()))return null;
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Tokyo',
      year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'})
      .formatToParts(d).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
    const date=parts.year+'-'+parts.month+'-'+parts.day;
    const hour=Number(parts.hour);
    if(hour>=18)return date;
    if(resultTime&&hour>=7)return null;
    const yesterday=new Date(date+'T00:00:00Z');
    yesterday.setUTCDate(yesterday.getUTCDate()-1);
    return yesterday.toISOString().slice(0,10);
  }
  const nightMessages={
    no_eligible_work:'正常スキップ。条件を満たす仕事がありませんでした。次回の夜間実行で再確認します。',
    already_reserved:'夜間枠は使用済みのため、23:00のCodex起動はありませんでした。',
    evidence_only:'検証記録は残りました。新しく制作された成果物はありません。',
    no_testable_step:'正常スキップ。対象コードと検証方法を特定できませんでした。次回の候補選定で再確認します。',
    legacy_preflight_skip:'正常スキップ。予約前に終了し、Codexは起動していません。保存済みの棚卸しでは適格候補が0件でした。',
    no_output:'Codexは実行しましたが、検証できる成果がありませんでした。',
    verification_failed:'成果案を検証できませんでした。変更は採用せず、検証結果を確認します。',
    failed:'夜間処理が失敗しました。実行記録を確認してください。',
    unknown:'夜間処理の結果を確認できません。同じ作業を再実行する前に実行記録を確認してください。',
    unavailable:'夜間処理の記録を取得できませんでした。時間をおいて再表示してください。',
    inventory_unavailable:'仕事の棚卸しを確認できず、夜間処理を開始できませんでした。',
    preflight_failed:'夜間処理の実行前確認に失敗しました。実行記録を確認してください。',
    running:'夜間処理を実行中です。',
    completed:'夜間処理は完了しました。成果を取り込むとここに表示します。',
    scheduled:'今夜の夜間処理は開始時刻前です。'
  };
  const exclusionLabels={
    CANONICAL_CLOSED:'完了・中止', EVIDENCE_SUGGESTS_DONE:'既存成果あり',
    OWNER_DONE:'本人が完了を記録', OWNER_DELAYED:'延期中', OWNER_BLOCKED:'ブロック中',
    OWNER_STATE_UNCERTAIN:'進捗が未確認', RECORDED_BLOCKER:'依存・ブロックあり',
    RELATION_UNAVAILABLE:'プロジェクト未確認', DUPLICATE_CANDIDATE:'重複候補',
    DEPENDENCY_UNCONFIRMED:'依存未確認', HUMAN_GATE:'本人の操作が必要',
    AUDIT_NEXT_STEP:'今回の実装経路の対象外', MAPPING_UNAVAILABLE:'Work情報を確認できない',
    PR_REVIEW_PENDING:'PRレビュー待ち', OUTSIDE_REPOSITORY:'実装権限の対象外',
    OUTSIDE_SCOPE:'実行権限の対象外', NO_ACTION:'実装指示なし・調査候補',
    PR_EVIDENCE:'既存PR記録あり', RESERVED:'同じ作業が予約済み'
  };
  function renderNightStatus(parent,execution,day,hasResult){
    if(!execution||execution.day!==day){
      if(!hasResult)text(parent,'p',nightMessages.unknown,'kp-notice');
      return;
    }
    const status=execution.status;
    const reason=execution.reason;
    const message=status==='skipped'&&['no_eligible_work','no_testable_step','legacy_preflight_skip','already_reserved'].includes(reason)
      ? nightMessages[reason] : status==='no_output'&&reason==='evidence_only'?nightMessages.evidence_only : status==='unavailable'&&reason==='inventory_unavailable'
        ? nightMessages.inventory_unavailable : status==='failed'&&reason==='preflight_failed'
          ? nightMessages.preflight_failed : Object.hasOwn(nightMessages,status)?nightMessages[status]:nightMessages.unknown;
    if(status!=='completed'||!hasResult)text(parent,'p',message,'kp-notice');
    if(status==='skipped'&&Number.isInteger(execution.inventory_count)
      &&execution.inventory_count>=0&&execution.inventory_count<=200){
      const details=document.createElement('details');
      text(details,'summary',`棚卸し ${execution.inventory_count}件の内訳を見る`);
      for(const [code,count] of Object.entries(execution.exclusions||{})){
        if(Object.hasOwn(exclusionLabels,code)&&Number.isInteger(count)&&count>0&&count<=execution.inventory_count)
          text(details,'p',`${exclusionLabels[code]} ${count}件`);
      }
      parent.appendChild(details);
    }
  }
  async function append(host,{read,review,snapshot,current}) {
    if(typeof read!=='function')return;
    let view;
    try{view=validate(await read());}catch(_){
      if(current())text(host,'p','AIの作業結果を読み戻せません。予定と進捗の表示は続けます。','kp-notice');return;
    }
    if(!current())return;
    const section=document.createElement('section');section.className='kp-card kai-autonomous-work';
    const asOf=Date.parse(view.as_of);
    const now=Number.isFinite(asOf)?asOf:Date.now();
    const todayNight=nightDay(now);
    const partials=view.partial_progress||[];
    const isRecent=i=>Date.parse(i.completed_at)<=now&&nightDay(i.started_at||i.completed_at,true)===todayNight;
    const recent=partials.filter(i=>i.origin==='night_artifact'&&isRecent(i));
    const manual=partials.filter(i=>i.origin==='manual');
    const history=partials.filter(i=>!manual.includes(i)&&!recent.includes(i));
    const recentRun=view.status==='current'&&view.run.night_day===todayNight&&!view.run.manual_general_once;
    text(section,'h2','AIが進めた仕事');
    const report=document.createElement('div');
    report.className='kai-autonomous-latest';
    text(report,'h3',todayNight+' 夜の作業');
    const completedRecent=recent.length+(recentRun?view.run.items.filter(i=>i.substep_completed&&i.pr_url).length:0);
    const summary=text(report,'p','','kai-action-source');
    const updateSummary=()=>{
      const pending=recent.filter(i=>i.decision_required).length+(recentRun?view.run.items.filter(i=>ready(i)&&!i.review).length:0);
      const completed=view.partial_progress_unavailable?'集計できません':completedRecent+'件';
      summary.textContent=`新しい部分成果 ${completed} · 判断待ち ${pending}件`;
    };
    updateSummary();
    renderNightStatus(report,view.night_execution,todayNight,Boolean(completedRecent||recentRun));
    section.appendChild(report);
    function renderPartial(parent,item){
      const card=document.createElement('article');card.dataset.autonomousPartial=item.work_label;
      text(card,'h4',`${item.work_label} ${item.title}`);
      text(card,'p','一手完了 · Work全体は未完了','kai-action-source');
      if(item.started_at)text(card,'p','夜間実行 '+new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(item.started_at))+' JST','kai-action-source');
      text(card,'h5','進んだこと');text(card,'p',item.summary);
      text(card,'h5','次に進めること');text(card,'p',item.next_action);
      text(card,'p',item.decision_required?'本人の判断が必要です。':'今は本人の判断は不要です。');
      const details=document.createElement('details');
      const editorial = item.evidence_refs.some(ref => ref.startsWith('https://github.com/alleshokai-gif/kaz-content/'));
      text(details,'summary',editorial?'未公開の下書きを確認':'根拠資料（任意）');
      for(const [index,ref] of item.evidence_refs.entries()){
        const a=text(details,'a',editorial?(index===0?'原稿を読む':'タイトル案・編集メモ'):`根拠 ${index+1}`,'kp-button');
        a.href=ref;a.target='_blank';a.rel='noopener noreferrer';
      }
      card.appendChild(details);parent.appendChild(card);
    }
    for(const item of recent)renderPartial(report,item);
    if(manual.length){
      const earlier=document.createElement('div');
      text(earlier,'h3','依頼を受けて先に進めた仕事');
      for(const item of manual)renderPartial(earlier,item);
      section.appendChild(earlier);
    }
    let archive=null;
    function archiveSection(){
      if(!archive){
        archive=document.createElement('details');
        archive.className='kai-autonomous-history';
        const historyCount=history.length+(view.status!=='no_results'&&!recentRun?view.run.items.length:0);
        text(archive,'summary',`過去の成果・実行記録を見る（${historyCount}件）`);
        section.appendChild(archive);
      }
      return archive;
    }
    if(history.length){
      const container=archiveSection();
      for(const item of history)renderPartial(container,item);
    }
    if(view.partial_progress_unavailable)
      text(section,'p','一部の成果履歴を読み戻せません。','kp-notice');
    if(view.status==='no_results'){host.prepend(section);return;}
    const runParent=recentRun?report:archiveSection();
    section.dataset.autonomousRun=view.run.run_id;
    const completed=view.run.items.filter(x=>x.substep_completed).length;
    const internal=view.run.items.filter(x=>!ready(x)&&x.status!=='complete'&&x.status!=='running').length;
    const counts=text(runParent,'p','');
    const updateCounts=()=>{updateSummary();const pending=view.run.items.filter(x=>ready(x)&&!x.review).length;
      counts.textContent=`あなたの判断待ち ${pending}件 · 自動調査・再評価待ち ${internal}件 · 完了した一手 ${completed}件`;};
    updateCounts();
    text(runParent,'p',view.run.manual_general_once?'手動実行の記録':`${view.run.night_day} 夜の実行記録。`,'kai-action-source');
    if(view.status==='stale')text(runParent,'p','以前の実行記録です。','kp-notice');
    for(const item of [...view.run.items].sort((a,b)=>Number(!!ready(b))-Number(!!ready(a)))){
      const card=document.createElement('article');card.dataset.autonomousWork=item.work_id;
      const eligible=ready(item);
      const heading=eligible ? (item.review?'判断を記録済み':'あなたの判断待ち')
        : item.status==='complete'?(item.substep_completed?'部分成果完了':'調査完了')
          :item.status==='running'?'実行中':'自動調査・再評価待ち';
      text(card,'h3',`${item.title} · ${heading}`);
      let details;
      if(eligible){
        const d=item.owner_decision;
        for(const [label,value] of [['何が進んだか',item.summary||d.verified_facts],
          ['AIの推奨',d.recommended_option],['あなたにお願いしたい判断',d.owner_reason]]){
          text(card,'h4',label);
          text(card,'p',value);
        }
        details=document.createElement('details');
        text(details,'summary','背景・検証・別案を確認');
        for(const [key,label] of Object.entries({background:'背景',cause:'原因',verified_facts:'検証結果',
          remaining:'残っていること',recommendation_reason:'推奨の根拠',alternative_option:'別案'})){
          text(details,'h4',label);
          text(details,'p',d[key]);
        }
      }else{
        if(item.summary)text(card,'p',item.summary);
        if(item.status==='complete'&&item.substep_completed)
          text(card,'p','Work全体は未完了です。今は本人の判断は不要です。','kai-action-source');
        if(heading==='自動調査・再評価待ち')
          text(card,'p','判断をお願いできる段階まで調査できていません。今は操作不要です。','kp-notice');
      }
      const slot=eligible&&!item.review&&view.status==='current' ? reviewWindow(snapshot,item):null;
      if(slot){const clock=x=>new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit'}).format(new Date(x));
        text(card,'p',`次の確認済み空き枠: ${clock(slot.start)}〜${clock(slot.end)}。確認時間が未推定のため、予定への割当はしていません。`);}
      const output=text(card,'p',item.review?`${choices[item.review.decision]}を記録済みです。`:'');
      output.setAttribute('role','status');output.setAttribute('aria-live','polite');
      const buttons=[];
      if(eligible&&!item.review&&typeof review==='function'&&view.status==='current'){
        const topic=topics[item.owner_decision.kind];
        text(card,'p','選んだ判断だけを保存します。PRのマージ・公開・Work更新は別操作です。別案・保留・見送りは次回の候補選定に反映します。','kai-action-source');
        const group=text(card,'div','','kai-review-actions');
        group.setAttribute('role','group');
        group.setAttribute('aria-label',`${topic}の判断`);
        const actions={approve:`推奨の${topic}を記録`,changes_requested:`別の${topic}の検討を記録`,
          defer:`${topic}の判断を保留`,reject:`${topic}の提案を見送る`};
        for(const [decision,label]of Object.entries(actions)){
          const button=text(group,'button',label,'kp-button');button.type='button';
          button.dataset.autonomousDecision=decision;
          button.disabled=item.review_read_status!=='current'||!!item.review;
          button.addEventListener('click',async()=>{
            buttons.forEach(b=>{b.disabled=true;});output.textContent='確認結果を保存しています…';
            try{
              const result=await review({run_id:view.run.run_id,work_id:item.work_id,decision,observed_at:new Date().toISOString()});
              if(!current())return;
              if(!result||result.schema_version!=='kaz-autonomous-review-receipt-v1'
                ||!['saved','already_saved'].includes(result.status)||result.decision!==decision
                ||result.auto_apply_allowed!==false||result.canonical_writes!==0||result.provider_calls!==0)
                throw Error('AUTONOMOUS_REVIEW_RESULT_UNKNOWN');
              const fresh=validate(await read());
              const saved=fresh.run?.run_id===view.run.run_id&&fresh.run.items.find(i=>i.work_id===item.work_id)?.review;
              if(!saved||saved.decision!==decision)throw Error('AUTONOMOUS_REVIEW_RESULT_UNKNOWN');
              output.textContent=`${label}を保存し、読み戻せました。`;
              item.review=saved;updateCounts();
              buttons.forEach(b=>{b.disabled=true;});
            }catch(_){if(current())output.textContent='保存結果を確認できません。再送せず、画面を読み直して状態を確認してください。';}
          });buttons.push(button);
        }
      }
      if(eligible&&item.review_read_status!=='current')text(card,'p','確認結果の読戻しが未確認のため、操作を保留しています。','kp-notice');
      if(item.pr_url&&!details){
        details=document.createElement('details');
        text(details,'summary','根拠資料（任意）');
      }
      if(item.pr_url){
        const a=text(details,'a','GitHubで検証記録を見る','kp-button');
        a.href=item.pr_url;a.target='_blank';a.rel='noopener noreferrer';
      }
      if(details)card.appendChild(details);
      runParent.appendChild(card);
    }
    if(current())host.prepend(section);
  }
  root.KazAutonomousWork=Object.freeze({append,validate,reviewWindow});
})(globalThis);

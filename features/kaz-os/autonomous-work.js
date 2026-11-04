/* Existing TODAY extension. Review observations never merge/apply canonical data. */
(function(root) {
  'use strict';
  const choices = Object.freeze({approve:'推奨案を選択',changes_requested:'別案の検討',defer:'判断を保留',reject:'提案を見送り'});
  const topics = Object.freeze({priority_tradeoff:'優先順',scope_tradeoff:'作業範囲'});
  const statuses = new Set(['running','review_pending','complete','failed','blocked','unknown']);
  const partialSource=/^https:\/\/github\.com\/alleshokai-gif\/kaz-context\/blob\/[a-f0-9]{40}\/(?:feedback\/events\/[0-9]{4}\/[0-9]{2}\/fb-[a-z0-9-]+\.json|intermediate\/[a-z0-9-]+\.json)$/;
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
  function nightDay(value) {
    const d=new Date(value);
    if(!Number.isFinite(d.getTime()))return null;
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Tokyo',
      year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'})
      .formatToParts(d).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
    const date=parts.year+'-'+parts.month+'-'+parts.day;
    if(Number(parts.hour)>=18)return date;
    const yesterday=new Date(date+'T00:00:00Z');
    yesterday.setUTCDate(yesterday.getUTCDate()-1);
    return yesterday.toISOString().slice(0,10);
  }
  async function append(host,{read,review,snapshot,current}) {
    if(typeof read!=='function')return;
    let view;
    try{view=validate(await read());}catch(_){
      if(current())text(host,'p','AIの作業結果を読み戻せません。予定と進捗の表示は続けます。','kp-notice');return;
    }
    if(!current()||(view.status==='no_results'&&!view.partial_progress?.length&&!view.partial_progress_unavailable))return;
    const section=document.createElement('section');section.className='kp-card kai-autonomous-work';
    const todayNight=nightDay(view.as_of||new Date().toISOString());
    const partials=view.partial_progress||[];
    const recent=partials.filter(i=>nightDay(i.completed_at)===todayNight);
    const history=partials.filter(i=>nightDay(i.completed_at)!==todayNight);
    const recentRun=view.status!=='no_results'&&view.run.night_day===todayNight;
    text(section,'h2','AIが進めた仕事');
    const report=document.createElement('div');
    report.className='kai-autonomous-latest';
    text(report,'h3',todayNight+' 夜の作業');
    const completedRecent=recent.length+(recentRun?view.run.items.filter(i=>i.substep_completed).length:0);
    const reviewRecent=recentRun?view.run.items.filter(i=>ready(i)&&!i.review).length:0;
    text(report,'p',`新しい部分成果 ${completedRecent}件 · 判断待ち ${reviewRecent}件`,'kai-action-source');
    if(!completedRecent&&!reviewRecent)
      text(report,'p','この夜の新しい成果はありません。過去の成果は下にまとめています。','kp-notice');
    section.appendChild(report);
    function renderPartial(parent,item){
      const card=document.createElement('article');card.dataset.autonomousPartial=item.work_label;
      text(card,'h4',`${item.work_label} ${item.title}`);
      text(card,'p','一手完了 · Work全体は未完了','kai-action-source');
      text(card,'h5','進んだこと');text(card,'p',item.summary);
      text(card,'h5','次の一手');text(card,'p',item.next_action);
      text(card,'p',item.decision_required?'本人の判断が必要です。':'今は本人の判断は不要です。');
      const details=document.createElement('details');
      text(details,'summary','根拠資料（任意）');
      for(const [index,ref] of item.evidence_refs.entries()){
        const a=text(details,'a',`根拠 ${index+1}`,'kp-button');
        a.href=ref;a.target='_blank';a.rel='noopener noreferrer';
      }
      card.appendChild(details);parent.appendChild(card);
    }
    for(const item of recent)renderPartial(report,item);
    let archive=null;
    function archiveSection(){
      if(!archive){
        archive=document.createElement('details');
        archive.className='kai-autonomous-history';
        text(archive,'summary','過去の成果・実行記録を見る');
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
    const updateCounts=()=>{const pending=view.run.items.filter(x=>ready(x)&&!x.review).length;
      counts.textContent=`あなたの判断待ち ${pending}件 · 自動調査・再評価待ち ${internal}件 · 完了した一手 ${completed}件`;};
    updateCounts();
    text(runParent,'p',`${view.run.night_day} 夜の実行記録。Workの完了や公開は自動確定していません。`,'kai-action-source');
    if(view.status==='stale')text(section,'p','以前の実行記録です。昨夜の新しい成果とは確認できていません。','kp-notice');
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
      const output=text(card,'p',eligible&&item.review?`${choices[item.review.decision]}を記録済みです。`:'');
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

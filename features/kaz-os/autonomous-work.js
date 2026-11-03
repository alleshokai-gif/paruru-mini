/* Existing TODAY extension. Review observations never merge/apply canonical data. */
(function(root) {
  'use strict';
  const choices = Object.freeze({approve:'推奨案を選択',changes_requested:'別案の検討',defer:'判断を保留',reject:'提案を見送り'});
  const topics = Object.freeze({priority_tradeoff:'優先順',scope_tradeoff:'作業範囲'});
  const statuses = new Set(['running','review_pending','complete','failed','blocked','unknown']);
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
  async function append(host,{read,review,snapshot,current}) {
    if(typeof read!=='function')return;
    let view;
    try{view=validate(await read());}catch(_){
      if(current())text(host,'p','AIの作業結果を読み戻せません。予定と進捗の表示は続けます。','kp-notice');return;
    }
    if(!current()||view.status==='no_results')return;
    const section=document.createElement('section');section.className='kp-card kai-autonomous-work';
    section.dataset.autonomousRun=view.run.run_id;
    text(section,'h2','AIが進めた仕事');
    const completed=view.run.items.filter(x=>x.substep_completed).length;
    const internal=view.run.items.filter(x=>!ready(x)&&x.status!=='complete'&&x.status!=='running').length;
    const counts=text(section,'p','');
    const updateCounts=()=>{const pending=view.run.items.filter(x=>ready(x)&&!x.review).length;
      counts.textContent=`あなたの判断待ち ${pending}件 · 自動調査・再評価待ち ${internal}件 · 完了した調査 ${completed}件`;};
    updateCounts();
    text(section,'p',`${view.run.night_day} 夜の記録。Workの完了や公開は自動確定していません。`,'kai-action-source');
    if(view.status==='stale')text(section,'p','以前の実行記録です。昨夜の新しい成果とは確認できていません。','kp-notice');
    for(const item of [...view.run.items].sort((a,b)=>Number(!!ready(b))-Number(!!ready(a)))){
      const card=document.createElement('article');card.dataset.autonomousWork=item.work_id;
      const eligible=ready(item);
      const heading=eligible ? (item.review?'判断を記録済み':'あなたの判断待ち')
        : item.status==='complete'?'調査完了':item.status==='running'?'実行中':'自動調査・再評価待ち';
      text(card,'h3',`${item.title} · ${heading}`);
      if(eligible){
        const d=item.owner_decision;
        const sections={background:'背景と問題',cause:'原因',verified_facts:'確認済みの事実',
          remaining:'残っていること',recommended_option:'AIの推奨案',recommendation_reason:'推奨する理由',
          alternative_option:'別案',owner_reason:'あなたの判断が必要な理由'};
        for(const [key,label] of Object.entries(sections)){
          text(card,'h4',label);
          text(card,'p',d[key]);
        }
      }else{
        if(item.summary)text(card,'p',item.summary);
        if(heading==='自動調査・再評価待ち')
          text(card,'p','判断をお願いできる段階まで調査できていません。今は操作不要です。','kp-notice');
      }
      const slot=eligible&&!item.review&&view.status==='current' ? reviewWindow(snapshot,item):null;
      if(slot){const clock=x=>new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit'}).format(new Date(x));
        text(card,'p',`次の確認済み空き枠: ${clock(slot.start)}〜${clock(slot.end)}。確認時間が未推定のため、予定への割当はしていません。`);}
      const output=text(card,'p',item.review?`${choices[item.review.decision]}を記録済みです。`:'');
      output.setAttribute('role','status');output.setAttribute('aria-live','polite');
      const buttons=[];
      if(eligible&&typeof review==='function'&&view.status==='current'){
        const topic=topics[item.owner_decision.kind];
        text(card,'p',`選んだ${topic}の方針を記録します。実装・公開・Work更新は別の手続きです。保留・見送りは自動作業の候補選定にも反映します。`,'kai-action-source');
        const actions={approve:`推奨の${topic}を記録`,changes_requested:`別の${topic}の検討を記録`,
          defer:`${topic}の判断を保留`,reject:`${topic}の提案を見送る`};
        for(const [decision,label]of Object.entries(actions)){
          const button=text(card,'button',label,'kp-button kai-observation-send');button.type='button';
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
      if(item.pr_url){
        const details=document.createElement('details');
        text(details,'summary','詳細資料（任意）');
        const a=text(details,'a','GitHubで調査記録を見る','kp-button');
        a.href=item.pr_url;a.target='_blank';a.rel='noopener noreferrer';
        card.appendChild(details);
      }
      section.appendChild(card);
    }
    if(current())host.prepend(section);
  }
  root.KazAutonomousWork=Object.freeze({append,validate,reviewWindow});
})(globalThis);

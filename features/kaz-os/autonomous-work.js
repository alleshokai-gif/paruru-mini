/* Existing TODAY extension. Review observations never merge/apply canonical data. */
(function(root) {
  'use strict';
  const choices = Object.freeze({approve:'承認',changes_requested:'修正を依頼',defer:'延期',reject:'却下'});
  const statuses = Object.freeze({running:'実行中',review_pending:'確認待ち',failed:'失敗',blocked:'前提待ち',unknown:'結果を確認中'});
  const text = (parent,tag,value,className='') => {
    const e=document.createElement(tag);e.textContent=value;e.className=className;parent.appendChild(e);return e;
  };
  function validate(view) {
    if(!view||view.schema_version!=='kaz-autonomous-view-v1'||view.raw_payload_stored!==false
      ||!['no_results','current','stale'].includes(view.status))throw Error('AUTONOMOUS_CONTRACT_INVALID');
    if(view.status==='no_results') {if(view.run!==null)throw Error('AUTONOMOUS_CONTRACT_INVALID');return view;}
    const r=view.run;
    if(!r||r.schema_version!=='kaz-autonomous-run-v1'||!/^[a-f0-9]{64}$/.test(r.run_id)
      ||!statuses[r.status]||r.canonical_writes!==0||r.provider_api_calls!==0||r.auto_apply_allowed!==false
      ||r.raw_payload_stored!==false||!Number.isFinite(Date.parse(r.finished_at))
      ||!Array.isArray(r.items)||!r.items.length||r.items.length>2)throw Error('AUTONOMOUS_CONTRACT_INVALID');
    for(const i of r.items){
      if(typeof i.work_id!=='string'||typeof i.title!=='string'||i.title.length>200||!statuses[i.status]
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
    const pending=view.run.items.filter(x=>x.status==='review_pending'&&!x.review).length;
    text(section,'p',`完了した調査 ${completed}件 · あなたの確認待ち ${pending}件`);
    text(section,'p',`${view.run.night_day} 夜の記録。Workの完了や公開は自動確定していません。`,'kai-action-source');
    if(view.status==='stale')text(section,'p','以前の実行記録です。昨夜の新しい成果とは確認できていません。','kp-notice');
    for(const item of view.run.items){
      const card=document.createElement('article');card.dataset.autonomousWork=item.work_id;
      text(card,'h3',`${item.title} · ${statuses[item.status]}`);
      if(item.summary)text(card,'p',item.summary);
      text(card,'p',`検証: ${item.validation==='observed_git_facts'?'観測したGit状態と照合済み':item.validation==='tracking_ref_stale'?'ローカル参照が古いため要確認':'未確認'} · 確認時間: 未推定`);
      if(item.error_code)text(card,'p',`実行を停止しました（${/^[A-Z_]{1,80}$/.test(item.error_code)?item.error_code:'AUTONOMOUS_FAILED'}）。再実行はしていません。`,'kp-notice');
      if(item.pr_url){const a=text(card,'a','GitHubの成果を見る','kp-button');a.href=item.pr_url;a.target='_blank';a.rel='noopener noreferrer';}
      if(item.review_question)text(card,'p',`確認してほしいこと: ${item.review_question}`);
      const slot=reviewWindow(snapshot,item);
      if(slot){const clock=x=>new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit'}).format(new Date(x));
        text(card,'p',`次の確認済み空き枠: ${clock(slot.start)}〜${clock(slot.end)}。確認時間が未推定のため、予定への割当はしていません。`);}
      const output=text(card,'p',item.review?`${choices[item.review.decision]}を記録済みです。`:'');
      output.setAttribute('role','status');output.setAttribute('aria-live','polite');
      const buttons=[];
      if(item.status!=='running'&&typeof review==='function'&&view.status==='current'){
        text(card,'p','ここでの承認は確認結果の記録です。マージ・公開・Work更新は行いません。','kai-action-source');
        for(const [decision,label]of Object.entries(choices)){
          const button=text(card,'button',label,'kp-button kai-observation-send');button.type='button';
          button.dataset.autonomousDecision=decision;
          button.disabled=item.review_read_status!=='current'||item.review?.decision===decision;
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
              buttons.forEach(b=>{b.disabled=b.dataset.autonomousDecision===decision;});
            }catch(_){if(current())output.textContent='保存結果を確認できません。再送せず、画面を読み直して状態を確認してください。';}
          });buttons.push(button);
        }
      }
      if(item.review_read_status!=='current')text(card,'p','確認結果の読戻しが未確認のため、操作を保留しています。','kp-notice');
      section.appendChild(card);
    }
    if(current())host.prepend(section);
  }
  root.KazAutonomousWork=Object.freeze({append,validate,reviewWindow});
})(globalThis);

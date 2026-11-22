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
  const usageKeys=['input_tokens','cached_input_tokens','output_tokens'];
  function validUsage(value){
    return value&&Object.keys(value).length===usageKeys.length
      &&usageKeys.every(k=>Number.isSafeInteger(value[k])&&value[k]>=0)
      &&value.cached_input_tokens<=value.input_tokens;
  }
  function validate(view) {
    if(!view||view.schema_version!=='kaz-autonomous-view-v1'||view.raw_payload_stored!==false
      ||!['no_results','current','stale'].includes(view.status))throw Error('AUTONOMOUS_CONTRACT_INVALID');
    if(view.partial_progress!==undefined&&(!Array.isArray(view.partial_progress)||view.partial_progress.length>16
      ||view.partial_progress.some(i=>!i||!/^WI-[1-9][0-9]*$/.test(i.work_label)
        ||i.status!=='partial_completed'||i.work_done!==false||typeof i.decision_required!=='boolean'
        ||!Number.isFinite(Date.parse(i.completed_at))
        ||(i.origin!==undefined&&!['manual','night_artifact','night_evidence'].includes(i.origin))
        ||(i.usage!==undefined&&(i.origin!=='night_artifact'||!validUsage(i.usage)))
        ||(i.origin==='night_artifact'&&(!Number.isFinite(Date.parse(i.started_at))||Date.parse(i.started_at)>Date.parse(i.completed_at)))
        ||![['title',160],['summary',500],['next_action',300]]
          .every(([key,max])=>typeof i[key]==='string'&&i[key].trim()&&i[key].length<=max)
        ||!Array.isArray(i.evidence_refs)||!i.evidence_refs.length||i.evidence_refs.length>3
        ||!i.evidence_refs.every(ref=>typeof ref==='string'&&partialSource.test(ref)))))
      throw Error('AUTONOMOUS_PARTIAL_CONTRACT_INVALID');
    if(view.status==='no_results'){
      if(view.run!==null)throw Error('AUTONOMOUS_CONTRACT_INVALID');
    }else validateRun(view.run);
    if(view.night_runs!==undefined){
      if(!Array.isArray(view.night_runs)||view.night_runs.length>2)throw Error('AUTONOMOUS_CONTRACT_INVALID');
      view.night_runs.forEach(validateRun);
      if(new Set(view.night_runs.map(r=>r.run_id)).size!==view.night_runs.length)
        throw Error('AUTONOMOUS_CONTRACT_INVALID');
    }
    if(view.night_attempts!==undefined&&(!Array.isArray(view.night_attempts)||view.night_attempts.length>2
      ||view.night_attempts.some(row=>!row||!/^WI-[1-9][0-9]*$/.test(row.work_label)
        ||!Number.isFinite(Date.parse(row.started_at))
        ||!['no_output','artifact_verified','unconfirmed','unknown'].includes(row.status))))
      throw Error('AUTONOMOUS_CONTRACT_INVALID');
    return view;
  }
  function validateRun(r){
    if(!r||r.schema_version!=='kaz-autonomous-run-v1'||!/^[a-f0-9]{64}$/.test(r.run_id)
      ||!statuses.has(r.status)||r.canonical_writes!==0||r.provider_api_calls!==0||r.auto_apply_allowed!==false
      ||r.raw_payload_stored!==false||!Number.isFinite(Date.parse(r.finished_at))
      ||!Array.isArray(r.items)||!r.items.length||r.items.length>2)throw Error('AUTONOMOUS_CONTRACT_INVALID');
    for(const i of r.items){
      const recordedText=(value,max)=>typeof value==='string'&&value.length<=max
        ||i.status==='complete'&&value===undefined;
      if(typeof i.work_id!=='string'||typeof i.title!=='string'||i.title.length>200||!statuses.has(i.status)
        ||!recordedText(i.summary,1200)||!recordedText(i.review_question,500)
        ||i.review_estimate_min!==null||typeof i.substep_completed!=='boolean'
        ||!['current','unavailable'].includes(i.review_read_status)
        ||(i.pr_url!==null&&!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]*$/.test(i.pr_url))
        ||(i.review!==null&&(!choices[i.review?.decision]||!Number.isFinite(Date.parse(i.review?.observed_at)))))
        throw Error('AUTONOMOUS_CONTRACT_INVALID');
    }
  }
  function workHistory(view, now=Date.now()) {
    validate(view);
    const partials = new Map(), decisions = new Map(), pullRequests = new Map(), seenWork = new Set();
    let decisionsUnavailable = view.night_execution?.status === 'unavailable';
    for (const item of view.partial_progress || []) {
      const at = Date.parse(item.completed_at);
      if (at <= now && (!partials.has(item.work_label) || at > Date.parse(partials.get(item.work_label).completed_at)))
        partials.set(item.work_label, item);
    }
    const runs = [view.run, ...(view.night_runs || [])].filter(Boolean)
      .sort((a,b)=>Date.parse(b.finished_at)-Date.parse(a.finished_at));
    for (const run of runs) {
      const at = Date.parse(run.finished_at);
      if (at > now) continue;
      for (const item of run.items) {
        if (item.pr_url && item.substep_completed === true && item.validation === 'observed_git_facts'
          && !pullRequests.has(item.work_id)) pullRequests.set(item.work_id, { at, ref: item.pr_url });
        if (seenWork.has(item.work_id)) continue;
        seenWork.add(item.work_id);
        const expires = at + 2 * 86400000;
        if (now >= expires || run.status !== 'review_pending' || !ready(item)) continue;
        if (item.review_read_status !== 'current') decisionsUnavailable = true;
        else if (item.review === null) {
          decisions.set(item.work_id, { at, expires, question: item.review_question, ...item.owner_decision });
        }
      }
    }
    return {partials, decisions, pullRequests, decisionsUnavailable, partialsUnavailable: view.partial_progress_unavailable === true};
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
    no_output:'新しい成果は記録されていません。確認できた実行は下に表示します。',
    verification_failed:'成果案を検証できませんでした。変更は採用せず、検証結果を確認します。',
    failed:'夜間処理が失敗しました。実行記録を確認してください。',
    unknown:'夜間処理の結果を確認できません。同じ作業を再実行する前に実行記録を確認してください。',
    unavailable:'夜間処理の記録を取得できませんでした。時間をおいて再表示してください。',
    inventory_unavailable:'仕事の棚卸しを確認できず、夜間処理を開始できませんでした。',
    preflight_failed:'夜間処理の実行前確認に失敗しました。実行記録を確認してください。',
    running:'夜間処理を実行中です。',
    completed:'夜間処理は完了しました。成果を取り込むとここに表示します。',
    time_limit:'夜間の実行時間上限に達しました。',
    budget_limit:'夜間のCodex実行枠を使い切りました。',
    work_limit:'設定された夜間の作業件数に達しました。',
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
  // Issue #240: one label per state; FAILED is always Japanese plus a code detail.
  const nightStateLabel={completed:'完了',skipped:'正常スキップ',no_output:'新しい成果なし',failed:'失敗',
    unavailable:'記録を取得できない',unknown:'結果未確認',running:'実行中の記録あり',time_limit:'時間上限で終了',
    budget_limit:'実行枠上限で終了',work_limit:'件数上限で終了',scheduled:'開始前'};
  const itemStateLabel={complete:'完了',running:'実行中',review_pending:'判断待ち',failed:'失敗',
    blocked:'停止（ブロック）',unknown:'結果未確認'};
  const itemStateTone={complete:'ok',running:'ok',review_pending:'warn',failed:'stop',blocked:'stop',unknown:'warn'};
  const code=value=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,80}$/.test(value)?value:null;
  const jstClock=value=>new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',
    hour:'2-digit',minute:'2-digit'}).format(new Date(value))+' JST';
  const jstDay=value=>{const d=new Date(value);return Number.isFinite(d.getTime())
    ?new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(d):null;};
  const runLabel=id=>'Run '+String(id).slice(0,8);
  function chips(parent,values){
    const row=text(parent,'p','','kai-entry-meta');
    for(const [label,tone] of values)if(label)text(row,'span',label,'kai-chip'+(tone?' kai-chip-'+tone:''));
    return row;
  }
  function failureDetail(parent,fields){
    const details=document.createElement('details');details.className='kai-failure-detail';
    text(details,'summary','失敗の詳細（技術情報）');
    text(details,'p',fields.filter(([,v])=>v).map(([k,v])=>`${k}: ${v}`).join(' · '),'kai-action-source');
    text(details,'p','この記録だけで成果採用・Work完了とは扱いません。同じ作業を再実行する前に、この詳細を開発担当へ伝えてください。','kai-action-source');
    parent.appendChild(details);
  }
  function renderNightStatus(parent,execution,day,hasResult){
    if(!execution||execution.day!==day){
      if(!hasResult)text(parent,'p',`${day} 夜の実行記録は未観測です。`+nightMessages.unknown,'kp-notice');
      return;
    }
    const status=execution.status;
    const reason=execution.reason;
    const message=status==='skipped'&&['no_eligible_work','no_testable_step','legacy_preflight_skip','already_reserved'].includes(reason)
      ? nightMessages[reason] : status==='no_output'&&reason==='evidence_only'?nightMessages.evidence_only : status==='unavailable'&&reason==='inventory_unavailable'
        ? nightMessages.inventory_unavailable : status==='failed'&&reason==='preflight_failed'
          ? nightMessages.preflight_failed
          : status==='running'&&!hasResult?'夜間処理の開始記録があります。実行IDを確認できるまでAI対応中とは扱いません。'
          : Object.hasOwn(nightMessages,status)?nightMessages[status]:nightMessages.unknown;
    if(['time_limit','budget_limit','work_limit'].includes(reason))
      text(parent,'p',nightMessages[reason],'kai-action-source');
    else if(status!=='completed'||!hasResult)text(parent,'p',message,'kp-notice');
    if(['failed','unavailable','unknown'].includes(status)||!Object.hasOwn(nightStateLabel,status))
      failureDetail(parent,[['対象夜',day],['状態コード',code(status)||'不明'],['理由コード',code(reason)]]);
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
    const recentRuns=(view.night_runs||(view.run&&view.status==='current'?[view.run]:[]))
      .filter(r=>r.night_day===todayNight&&!r.manual_general_once);
    const attempts=(view.night_attempts||[]).filter(r=>nightDay(r.started_at,true)===todayNight&&Date.parse(r.started_at)<=now);
    const pastRun=view.run&&!recentRuns.some(r=>r.run_id===view.run.run_id)?view.run:null;
    text(section,'h2','AIが進めた仕事');
    // Issue #240 brief: 今日の判断 → 理由・影響 → 対応証拠 → 次担当.
    const brief=document.createElement('dl');
    brief.className='kp-brief';brief.dataset.autonomousBrief='true';
    const cell=label=>{text(brief,'dt',label);return text(brief,'dd','');};
    const decisionCell=cell('今日の判断'),reasonCell=cell('理由・影響'),summary=cell('対応証拠'),ownerCell=cell('次担当');
    const report=document.createElement('div');
    report.className='kai-autonomous-latest';
    text(report,'h3',todayNight+' 夜の作業');
    report.appendChild(brief);
    // WI-54: the concise brief above stays visible; every existing record and
    // control below is built directly inside one native details (no cloning/moving).
    const nightDetails=document.createElement('details');
    nightDetails.className='kai-night-details';
    text(nightDetails,'summary','夜間結果の詳細');
    const latestBody=document.createElement('div');
    latestBody.className='kai-night-latest';
    nightDetails.appendChild(latestBody);
    report.appendChild(nightDetails);
    const completedRecent=recent.length+recentRuns.flatMap(r=>r.items).filter(i=>i.substep_completed&&i.pr_url).length;
    const usage=[...recent.map(i=>i.usage),...recentRuns.filter(r=>r.codex_cli_attempts>0).map(r=>r.metrics?.usage)];
    if(usage.length){
      const known=usage.filter(validUsage);
      const totals=usageKeys.map(k=>known.reduce((total,u)=>total+u[k],0));
      const amounts=known.length?`入力 ${totals[0].toLocaleString()} · 出力 ${totals[2].toLocaleString()} トークン`:'取得できません';
      text(latestBody,'p',`Codex利用量 ${amounts}${known.length<usage.length?'（一部未計測）':''} · 費用 未計測`,'kai-action-source');
    }
    const execution=view.night_execution?.day===todayNight?view.night_execution:null;
    const recentItems=recentRuns.flatMap(r=>r.items);
    const failedItems=recentItems.filter(i=>i.status==='failed').length;
    const unconfirmedCount=attempts.filter(a=>['unconfirmed','unknown'].includes(a.status)).length
      +recentItems.filter(i=>i.status==='unknown').length;
    // "AI実行中" only with a real run ID from a validated run record.
    const liveRun=recentRuns.find(r=>r.items.some(i=>i.status==='running'));
    const updateSummary=()=>{
      const pending=recent.filter(i=>i.decision_required).length+recentRuns.flatMap(r=>r.items).filter(i=>ready(i)&&!i.review).length;
      const completed=view.partial_progress_unavailable?'集計できません（未観測）':completedRecent+'件';
      const finishedWorks=recentRuns.flatMap(r=>r.items).filter(i=>i.work_done===true&&i.status==='complete').length;
      summary.textContent=`新しい部分成果 ${completed} · 今夜の判断待ち ${pending}件`
        +(finishedWorks?` · Work完了 ${finishedWorks}件`:'')
        +` · 実行記録 ${recentRuns.length}件 · 失敗 ${failedItems}件`
        +(unconfirmedCount?` · 結果未確認 ${unconfirmedCount}件`:'');
      const failed=failedItems>0||execution?.status==='failed';
      const unobserved=view.partial_progress_unavailable || !execution
        || !['completed','skipped'].includes(execution.status);
      decisionCell.textContent=pending?`あなたの判断待ち ${pending}件`
        :failed?'失敗あり · 下の詳細を確認':unobserved?'判断待ちの有無は未確認':'本人の判断は不要';
      reasonCell.textContent=execution
        ?`${todayNight} 夜: ${nightStateLabel[execution.status]||'結果未確認'}`+(failed?' · 失敗した成果は採用されていません':'')
        :`${todayNight} 夜の実行記録は未観測（0件ではありません）`;
      ownerCell.textContent=pending?'本人（下の判断ボタン）'
        :liveRun?`AI · ${runLabel(liveRun.run_id)} 実行中`
        :execution?.status==='running'?'実行記録待ち（実行ID未確認のためAI対応中とは扱わない）'
        :failed?'開発担当（失敗の詳細を確認）':unobserved?'記録確認待ち':'なし（次回の夜間実行で再確認）';
      if(failed)brief.dataset.tone='stop';else if(pending||unobserved)brief.dataset.tone='warn';else delete brief.dataset.tone;
    };
    updateSummary();
    renderNightStatus(latestBody,view.night_execution,todayNight,Boolean(completedRecent||recentRuns.length));
    for(const attempt of attempts){
      if(attempt.status==='artifact_verified'&&recent.some(row=>row.work_label===attempt.work_label&&row.started_at===attempt.started_at))continue;
      const card=document.createElement('article');card.className='kai-entry';
      text(card,'h4',`${attempt.work_label} · 夜間の成果物作成`);
      const attemptLabel={no_output:['成果なし',''],artifact_verified:['成果物を確認済み','ok'],
        unconfirmed:['結果未確認','warn'],unknown:['起動準備のみ確認','warn']}[attempt.status];
      chips(card,[[jstClock(attempt.started_at),''],[attempt.work_label,''],attemptLabel]);
      const messages={no_output:'Codexは実行済み。既存資料を調べたものの、新しい成果案は返りませんでした。',
        artifact_verified:'成果物の保存と検証を確認済み。成果欄への反映待ちです。',
        unconfirmed:'途中で結果を確認できなくなりました。自動再送はしません。',
        unknown:'起動準備の記録まで確認。実行結果は未確認です（AI対応中とは扱いません）。'};
      text(card,'p',messages[attempt.status]);
      if(attempt.status==='no_output')text(card,'p','本人判断の依頼はありません。次回は未処理の一手を候補から探します。','kai-action-source');
      latestBody.appendChild(card);
    }
    section.appendChild(report);
    function renderPartial(parent,item){
      const card=document.createElement('article');card.dataset.autonomousPartial=item.work_label;
      card.className='kai-entry';
      text(card,'h4',`${item.work_label} ${item.title}`);
      const origin={manual:'依頼で実施',night_artifact:'夜間実行',night_evidence:'夜間の検証記録'}[item.origin]||'記録元未確認';
      chips(card,[['完了 '+jstClock(item.completed_at),''],[item.work_label,''],['一手完了 · Work全体は未完了','ok'],
        [item.started_at?`${origin} ${jstClock(item.started_at)}`:origin,''],
        [item.decision_required?'本人の判断が必要':'',item.decision_required?'warn':'']]);
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
    for(const item of recent)renderPartial(latestBody,item);
    if(manual.length){
      const earlier=document.createElement('div');
      text(earlier,'h3','依頼を受けて先に進めた仕事');
      for(const item of manual)renderPartial(earlier,item);
      nightDetails.appendChild(earlier);
    }
    let archive=null;
    function archiveSection(){
      if(!archive){
        archive=document.createElement('details');
        archive.className='kai-autonomous-history';
        const historyCount=history.length+(pastRun?.items.length||0);
        text(archive,'summary',`過去の成果・実行記録を見る（${historyCount}件）`);
        nightDetails.appendChild(archive);
      }
      return archive;
    }
    if(history.length){
      // Older WI results are grouped by JST completion date, newest first, then WI number.
      const container=archiveSection();
      const groups=new Map();
      for(const item of history){
        const day=jstDay(item.completed_at)||'日付不明';
        if(!groups.has(day))groups.set(day,[]);
        groups.get(day).push(item);
      }
      const wiNumber=label=>Number(/^WI-([0-9]+)$/.exec(label)?.[1]||Number.MAX_SAFE_INTEGER);
      for(const day of [...groups.keys()].sort().reverse()){
        const items=groups.get(day).sort((a,b)=>wiNumber(a.work_label)-wiNumber(b.work_label));
        text(container,'h3',`${day} · 以前のWI成果 ${items.length}件`,'kai-history-day');
        for(const item of items)renderPartial(container,item);
      }
    }
    if(view.partial_progress_unavailable)
      text(nightDetails,'p','一部の成果履歴を読み戻せません。','kp-notice');
    for(const run of [...recentRuns,...(pastRun?[pastRun]:[])]){
      const currentRun=run!==pastRun||view.status==='current';
      const runParent=run===pastRun?archiveSection():latestBody;
      section.dataset.autonomousRun=run.run_id;
      if(run===pastRun)text(runParent,'h3',`${run.night_day||jstDay(run.finished_at)||'日付不明'} · 以前の実行 ${runLabel(run.run_id)}`,'kai-history-day');
      const completed=run.items.filter(x=>x.substep_completed).length;
      const internal=run.items.filter(x=>!ready(x)&&!['complete','running','failed','blocked','unknown'].includes(x.status)).length;
      const failedCount=run.items.filter(x=>x.status==='failed').length;
      const blockedCount=run.items.filter(x=>x.status==='blocked').length;
      const unknownCount=run.items.filter(x=>x.status==='unknown').length;
      const counts=text(runParent,'p','','kai-run-counts');
      const updateCounts=()=>{updateSummary();const pending=run.items.filter(x=>ready(x)&&!x.review).length;
        counts.textContent=`あなたの判断待ち ${pending}件 · 自動調査・再評価待ち ${internal}件 · 完了した一手 ${completed}件 · 失敗 ${failedCount}件`
          +(blockedCount?` · 停止 ${blockedCount}件`:'')+(unknownCount?` · 結果未確認 ${unknownCount}件`:'');};
      updateCounts();
      chips(runParent,[[run.manual_general_once?'手動実行の記録':`${run.night_day} 夜の実行記録`,''],
        [runLabel(run.run_id),''],['終了 '+jstClock(run.finished_at),'']]);
      if(!currentRun)text(runParent,'p','以前の実行記録です。','kp-notice');
      for(const item of [...run.items].sort((a,b)=>Number(!!ready(b))-Number(!!ready(a)))){
        const card=document.createElement('article');card.dataset.autonomousWork=item.work_id;
        card.className='kai-entry';
        const eligible=ready(item);
        const heading=eligible ? (item.review?'判断を記録済み':'あなたの判断待ち')
          : item.status==='complete'?(item.substep_completed?'部分成果完了':'調査完了')
            :item.status==='running'?'実行中'
            :item.status==='failed'?'失敗'
            :item.status==='blocked'?'停止（ブロック）'
            :item.status==='unknown'?'結果未確認':'自動調査・再評価待ち';
        text(card,'h3',`${item.title} · ${heading}`);
        chips(card,[[itemStateLabel[item.status]||'状態未確認',itemStateTone[item.status]||'warn'],
          [runLabel(run.run_id),''],[item.pr_url?'PRあり':'','']]);
        if(item.status==='failed'){
          text(card,'p','AIの実行が失敗として記録されています。成果は採用されていません。','kp-notice');
          failureDetail(card,[['Run',String(run.run_id).slice(0,8)],['状態コード','failed'],['理由コード',code(item.error_code)]]);
        }else if(item.status==='blocked'){
          text(card,'p','AIの実行が停止しています（ブロック）。今は本人の操作は不要です。','kp-notice');
          if(code(item.error_code))failureDetail(card,[['Run',String(run.run_id).slice(0,8)],['状態コード','blocked'],['理由コード',code(item.error_code)]]);
        }else if(item.status==='unknown'){
          text(card,'p','実行結果を確認できません（0件・成功とは扱いません）。同じ作業を再実行する前に実行記録を確認してください。','kp-notice');
        }else if(item.status==='running'){
          text(card,'p',`AIが実行中です（${runLabel(run.run_id)}）。`,'kai-action-source');
        }
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
        const slot=eligible&&!item.review&&currentRun ? reviewWindow(snapshot,item):null;
        if(slot){const clock=x=>new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit'}).format(new Date(x));
          text(card,'p',`次の確認済み空き枠: ${clock(slot.start)}〜${clock(slot.end)}。確認時間が未推定のため、予定への割当はしていません。`);}
        const output=text(card,'p',item.review?`${choices[item.review.decision]}を記録済みです。`:'');
        output.setAttribute('role','status');output.setAttribute('aria-live','polite');
        const buttons=[];
        if(eligible&&!item.review&&typeof review==='function'&&currentRun){
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
                const result=await review({run_id:run.run_id,work_id:item.work_id,decision,observed_at:new Date().toISOString()});
                if(!current())return;
                if(!result||result.schema_version!=='kaz-autonomous-review-receipt-v1'
                  ||!['saved','already_saved'].includes(result.status)||result.decision!==decision
                  ||result.auto_apply_allowed!==false||result.canonical_writes!==0||result.provider_calls!==0)
                  throw Error('AUTONOMOUS_REVIEW_RESULT_UNKNOWN');
                const fresh=validate(await read());
                const saved=[...(fresh.night_runs||[]),fresh.run].find(r=>r?.run_id===run.run_id)?.items.find(i=>i.work_id===item.work_id)?.review;
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
    }
    if(current()){
      // WI-54: async completion must never land ahead of the TODAY summary card.
      const anchor=Array.from(host.children||[]).find(node=>node?.dataset?.todaySummary==='true');
      if(anchor&&typeof anchor.after==='function')anchor.after(section);else host.prepend(section);
    }
  }
  root.KazAutonomousWork=Object.freeze({append,validate,reviewWindow,workHistory});
})(globalThis);

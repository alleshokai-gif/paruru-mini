/* Human Decision Queue. Transport is injected; Operational Source writers remain outside this component. */
(function(root, factory) {
  const view=factory();
  if(typeof module==='object' && module.exports) module.exports=view;
  else root.KazInboxView=view;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const TYPES={human_review:'HUMAN REVIEW',acceptance:'ACCEPTANCE',blocker_decision:'BLOCKER',idea_triage:'IDEA',context_candidate:'CONTEXT CANDIDATE',classification_required:'CLASSIFICATION',conflict_resolution:'CONFLICT',stale_state_confirmation:'STALE STATE',calendar_event_impact:'CALENDAR',today_focus:'TODAY',calendar_partial_window:'CALENDAR'};
  const ALIASES={blocked:'blocker_decision',idea:'idea_triage'};
  const OUTCOMES={human_review:{ACCEPTED:'妥当',REWORK_REQUIRED:'手直し依頼',REJECTED:'却下'},acceptance:{ACCEPTED:'終了条件を満たす',REWORK_REQUIRED:'不足あり'},blocker_decision:{unblock:'解除方針',defer:'保留'},idea_triage:{promote:'採用',incubate:'保留',reject:'却下'},context_candidate:{review:'既存Reviewへ',defer:'保留',reject:'却下'},classification_required:{hard_constraint:'拘束',soft_constraint:'調整可能',informational:'参考',none:'関係なし',unknown:'未確定'},conflict_resolution:{resolve:'解消方針',defer:'保留'},stale_state_confirmation:{complete:'完了',still_open:'まだ'},calendar_event_impact:{all:'全部拘束',partial:'一部拘束',none:'拘束なし',unknown:'不明'},today_focus:{today:'今日',this_week:'今週',later:'あとで'},calendar_partial_window:{time_range:'拘束時間を指定'}};
  const INLINE_CHOICES={human_review:[['ACCEPTED','承認'],['REWORK_REQUIRED','差戻し']],acceptance:[['ACCEPTED','承認'],['REWORK_REQUIRED','差戻し']],idea_triage:[['promote','やる'],['incubate','保留'],['reject','捨てる']],context_candidate:[['review','候補にする'],['reject','不要']],classification_required:[['hard_constraint','はい'],['none','いいえ'],['unknown','わからん']]};
  const sessions=new WeakMap(), PAGE_SIZE=5, PREVIEW=3;
  const SECRETARY=new Set(['stale_state_confirmation','calendar_event_impact','today_focus','calendar_partial_window']);
  const kind=i=>{const k=String(i?.kind||'').toLowerCase();return ALIASES[k]||k;};
  const at=v=>typeof v==='string' && /T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v)?Date.parse(v):NaN;
  const day=n=>new Date(n+9*3600000).toISOString().slice(0,10);
  const list=a=>Array.isArray(a)&&a.every(i=>i&&typeof i.id==='string'&&i.id)&&new Set(a.map(i=>i.id)).size===a.length?a:null;
  const knownMinutes=n=>Number.isFinite(n)&&n>=0;
  const sum=items=>items.every(i=>knownMinutes(i.estimate_min))?items.reduce((s,i)=>s+i.estimate_min,0):null;
  const pending=i=>i?.owner==='kaz'&&i.decision_requested===true&&Object.hasOwn(TYPES,kind(i))&&i.ai_executable!==true&&(!i.decision_status||i.decision_status==='pending');
  function queueItems(data){const items=list(data?.inbox_items);return items?items.filter(pending):null;}
  function priorityProof(data,i,flag){const p=data?.decision_priority_evidence?.[i.priority_ref];return i[flag]===true&&p?.inbox_item_id===i.id&&p?.source_revision===data?.sources?.inbox?.source_revision&&p?.[flag]===true&&typeof p.reason==='string'&&!!p.reason.trim();}
  function isToday(data,i,now){
    return /^\d{4}-\d{2}-\d{2}$/.test(i.decision_date||'')&&i.decision_date<=day(now)||
      !i.decision_date&&i.urgent_today===true&&Number.isFinite(at(data?.as_of))&&day(at(data.as_of))===day(now)||
      priorityProof(data,i,'blocks_today_plan')&&i.impact_date===day(now)||Number.isFinite(at(i.due_at))&&at(i.due_at)<=Date.parse(day(now)+'T23:59:59.999+09:00');
  }
  function todayItems(data,now){const items=queueItems(data);return items?items.filter(i=>isToday(data,i,now)):null;}
  function rank(data,i,now){
    const plan=priorityProof(data,i,'blocks_today_plan')&&i.impact_date===day(now), completion=priorityProof(data,i,'blocks_project_completion'),review=['human_review','acceptance'].includes(kind(i));
    const due=Number.isFinite(at(i.due_at))?at(i.due_at):Infinity,leverage=priorityProof(data,i,'high_leverage');
    return {tuple:[plan?0:1,completion?0:1,review?0:1,due,leverage?0:1,leverage&&knownMinutes(i.estimate_min)?i.estimate_min:Infinity],reason:plan?'今日のPlanを止めている':completion?'Projectの終了判断を待っている':review?'本人によるReview / Acceptance':Number.isFinite(due)?'判断期限がある':leverage?'短時間の判断で次工程へ':'同優先度はID順（時刻順ではありません）'};
  }
  function compare(data,now){return(a,b)=>{const x=rank(data,a,now).tuple,y=rank(data,b,now).tuple;for(let i=0;i<x.length;i++)if(x[i]!==y[i])return x[i]<y[i]?-1:1;return a.id.localeCompare(b.id);};}
  function derive(data,now,health){
    let status=health(data?.sources?.inbox,now),items=queueItems(data);
    if(['ok','partial'].includes(status)&&!items)status='failed';
    if(!['ok','partial'].includes(status))return{status,items:[],today:[],later:[],total:null,minutes:null,counts:null};
    const ordered=[...items].sort(compare(data,now));
    return{status,items:ordered,today:ordered.filter(i=>isToday(data,i,now)),later:ordered.filter(i=>!isToday(data,i,now)),total:ordered.length,minutes:sum(ordered),counts:Object.fromEntries(Object.keys(TYPES).map(k=>[k,ordered.filter(i=>kind(i)===k).length]))};
  }
  function entities(data,i,now,health){
    const k=kind(i), source=['human_review','acceptance','blocker_decision','stale_state_confirmation','today_focus'].includes(k)?'tasks':['classification_required','calendar_event_impact','calendar_partial_window'].includes(k)?'calendar':'inbox';
    const items=source==='tasks'?data?.work_items:source==='calendar'?data?.calendar_events:k==='idea_triage'?data?.ideas:k==='context_candidate'?data?.context_candidates:data?.conflicts;
    const entity=health(data?.sources?.[source],now)==='ok'?(list(items)||[]).find(x=>x.id===i.entity_ref):null;
    const projectId=i.project_id||entity?.project_id||null;
    const project=health(data?.sources?.projects,now)==='ok'?(list(data?.projects)||[]).find(p=>p.id===projectId):null;
    return{entity,project,projectId,source};
  }
  function evidenceGate(data,i,now,health){
    const {entity:w,source,projectId}=entities(data,i,now,health),k=kind(i),issues=[];
    if(health(data?.sources?.inbox,now)!=='ok')issues.push('Inboxの完全・新鮮な取得が必要');
    if(!data?.fixture_only&&data?.origin!=='mock'&&(!['real','real_operational_sources'].includes(data?.origin)||data?.inbox_items?.some(i=>i.synthetic)))issues.push('sourceの由来を確認');
    if(SECRETARY.has(k)){
      const refs=i?.source_revision_references;
      if(i?.contract!=='secretary-question-0.1'||!/^question-sha256:[a-f0-9]{64}$/.test(i?.question_revision||''))issues.push('Secretary Question revisionを確認');
      for(const [name,view] of [['projects','projects'],['work_items','tasks'],['calendar','calendar']]){
        if(health(data?.sources?.[view],now)!=='ok'||refs?.[name]!==data?.sources?.[view]?.source_revision)issues.push(`${name} revisionを再取得`);
      }
      if(['stale_state_confirmation','today_focus'].includes(k)&&(!w||w.source_revision!==i.entity_revision))issues.push('Work Item revisionを再取得');
      return{issues:[...new Set(issues)],packet:null,entity:w,projectId};
    }
    if(!projectId)issues.push('Project relationが未確認');
    if(!w||health(data?.sources?.[source],now)!=='ok')issues.push('元項目の取得が必要');
    if(i.project_id&&w?.project_id&&i.project_id!==w.project_id)issues.push('Project relationが一致しない');
    const packet=data?.review_packets?.[i.entity_ref];
    if(['human_review','acceptance'].includes(k)){
      if(w?.state!==(k==='human_review'?'HUMAN_REVIEW':'ACCEPTANCE')||w?.next_actor!=='kaz')issues.push('本人の判断stateではない');
      if(health(data?.sources?.runs,now)!=='ok')issues.push('Run sourceの再取得が必要');
      if(!packet||packet.work_item_id!==w?.id||packet.expected_revision!==w?.revision||!packet.run_id||!packet.source_revision||packet.execution_status!=='completed'||packet.capture_status!=='complete')issues.push('Run / Work Item revisionを確認');
      const required=['run_result','git_diff','tests','instruction','git_before','git_after'];
      if(!packet||!Array.isArray(packet.missing_evidence)||packet.missing_evidence.length||required.some(key=>!packet.refs?.[key]?.ref||!/^[a-f0-9]{64}$/i.test(packet.refs?.[key]?.sha256||'')))issues.push('必須Evidenceが不足');
      if(k==='acceptance'){
        if(packet?.human_review_status!=='ACCEPTED'||packet?.acceptance_eligible!==true)issues.push('Human Review / Acceptance eligibility未確認');
        if(!Array.isArray(w?.acceptance_criteria)||!w.acceptance_criteria.length||w.acceptance_criteria.some(c=>!c.id||!c.instruction||!packet?.refs?.[c.evidence_key]))issues.push('終了条件とEvidenceの対応が不足');
      }
    }
    if(k==='context_candidate'&&w?.curated!==false)issues.push('未昇格candidateとして確認できない');
    if(k==='classification_required'&&(!w?.source_revision||health(data?.sources?.resolution,now)!=='ok'||data?.window_gate?.calendar_revision!==data?.sources?.calendar?.source_revision))issues.push('Calendar / classification revision未確認');
    return{issues:[...new Set(issues)],packet,entity:w,projectId};
  }
  function proposal(data,id,input,now,health){
    const item=queueItems(data)?.find(i=>i.id===id);
    if(!item)throw Error('本人の未処理Decisionではありません');
    const k=kind(item),gate=evidenceGate(data,item,now,health);
    if(gate.issues.length)throw Error(gate.issues.join(' / '));
    if(SECRETARY.has(k)){
      const partial=k==='calendar_partial_window',selected=partial?input?.selected_option:input?.decision;
      let valid=item.answer_contract?.choices?.some(choice=>choice.value===selected);
      if(partial){const start=Date.parse(selected?.start),end=Date.parse(selected?.end),suffix=item.calendar_event?.all_day?'T00:00:00+09:00':'',eventStart=Date.parse((item.calendar_event?.start||'')+suffix),eventEnd=Date.parse((item.calendar_event?.end||'')+suffix);valid=Number.isFinite(start)&&Number.isFinite(end)&&start<end&&Number.isFinite(eventStart)&&Number.isFinite(eventEnd)&&start>=eventStart&&end<=eventEnd&&(start!==eventStart||end!==eventEnd);}
      if(!valid)throw Error(partial?'拘束される開始・終了を予定の範囲内で指定してください':'この質問の選択肢から回答してください');
      return{status:'answer_pending',mode:'local_controlled_proposal',adopted:false,persisted:false,authority:'human_answer_input',decision_id:item.id,inbox_item_id:item.id,entity_ref:item.entity_ref,project_id:gate.projectId,question_revision:item.question_revision,source_revision_references:{...item.source_revision_references},selected_option:selected,reason:typeof input?.reason==='string'&&input.reason.trim()?input.reason.trim():null,answer_label:partial?'拘束時間を指定':item.answer_contract.choices.find(choice=>choice.value===selected).label};
    }
    if(!Object.hasOwn(OUTCOMES[k],input?.decision)||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>1000)throw Error('判断と理由を入力してください');
    const refs=[];
    if(['human_review','acceptance'].includes(k)){
      const required=k==='acceptance'?gate.entity.acceptance_criteria.map(c=>c.id):['run_result','git_diff','tests','instruction','git_before','git_after'];
      if(!Array.isArray(input.checked)||required.some(key=>!input.checked.includes(key)))throw Error('Evidence / 終了条件の確認が必要です');
      required.forEach(key=>{const evidenceKey=k==='acceptance'?gate.entity.acceptance_criteria.find(c=>c.id===key).evidence_key:key;refs.push({criterion:key,...gate.packet.refs[evidenceKey]});});
    }
    const change=k==='classification_required'?{actor:input.actor,impact_on_kaz:input.decision,classification_source:'user',confirmation:null}:null;
    if(change&&!['kaz','family','spouse','child','popio','unknown'].includes(change.actor))throw Error('actorを選択してください。予定名から推定しません');
    return {status:'proposal',mode:'local_ui_only',adopted:false,persisted:false,authority:'untrusted_ui_draft',inbox_item_id:item.id,entity_ref:item.entity_ref,project_id:gate.projectId,
      decision_type:k,decision:input.decision,reason:input.reason.trim(),proposed_by:'kaz',proposed_at:new Date(now).toISOString(),timezone:'Asia/Tokyo',
      base_revision:data.sources.inbox.source_revision,entity_revision:gate.entity.revision??gate.entity.source_revision??null,
      run_id:gate.packet?.run_id||null,checked_evidence:refs,classification_proposal:change,
      continuation:{human_review:'lifecycle.human_review',acceptance:'lifecycle.acceptance',idea_triage:'idea.triage',context_candidate:'existing_candidate_review',classification_required:'classification_evidence_review',blocker_decision:'blocker_decision_review',conflict_resolution:'conflict_review'}[k]};
  }
  function inlineSummary(data,i,now,health){
    const k=kind(i),info=entities(data,i,now,health),gate=evidenceGate(data,i,now,health),packet=gate.packet;
    const issues=[...gate.issues],review=['human_review','acceptance'].includes(k);
    let choices=(INLINE_CHOICES[k]||[]).map(([value,label])=>({value,label})),checks=[];
    const question=i.question||{human_review:'この変更を承認する？',acceptance:'目的・終了条件を満たしたとして受け入れる？',idea_triage:'Taskとして残す？',context_candidate:'Contextの候補として残す？',classification_required:'Kaz本人の時間も拘束される予定？'}[k]||'判断内容の確認が必要です';
    if(SECRETARY.has(k)&&k!=='calendar_partial_window'){
      const c=i.answer_contract;
      if(c?.inbox_item_id===i.id&&c.question_revision===i.question_revision&&typeof c.question==='string'&&c.question.trim()&&Array.isArray(c.choices)&&c.choices.length>=2&&c.choices.length<=4&&new Set(c.choices.map(x=>x.value)).size===c.choices.length&&c.choices.every(x=>Object.hasOwn(OUTCOMES[k],x.value)&&typeof x.label==='string'&&x.label.trim()&&typeof x.effect==='string'&&x.effect.trim()))choices=c.choices;
      else issues.push('Secretary Questionの回答条件を再取得');
    }else if(k==='calendar_partial_window'){
      choices=[];
      if(i.input_contract?.type!=='time_range'||i.input_contract?.timezone!=='Asia/Tokyo'||i.input_contract?.within_event!==true||!i.calendar_event?.ref||i.calendar_event.ref!==i.entity_ref)issues.push('Calendar eventの拘束時間contractを再取得');
    }else if(k==='blocker_decision'){
      const c=i.answer_contract;
      if(c?.inbox_item_id===i.id&&c.source_revision===data.sources.inbox.source_revision&&typeof c.question==='string'&&c.question.trim()&&Array.isArray(c.choices)&&c.choices.length>=2&&c.choices.length<=3&&new Set(c.choices.map(x=>x.value)).size===c.choices.length&&c.choices.every(x=>Object.hasOwn(OUTCOMES[k],x.value)&&typeof x.label==='string'&&x.label.trim()&&typeof x.effect==='string'&&x.effect.trim()))choices=c.choices;
      else issues.push('Blockerの回答条件を詳細で確認');
    }
    if(k==='conflict_resolution'||i.requires_detail===true)issues.push('この判断は詳細確認が必須');
    if(review){
      const policy=i.review_policy;
      if(policy?.mode!=='summary_permitted'||policy.source_revision!==data.sources.inbox.source_revision||!policy.evidence_ref)issues.push('QA上、要約だけの判断は未許可');
      const required=k==='acceptance'?(gate.entity?.acceptance_criteria||[]).map(c=>({id:c.id,key:c.evidence_key,label:c.instruction})):['run_result','git_diff','tests','instruction','git_before','git_after'].map(key=>({id:key,key}));
      const summaries=packet?.evidence_summaries;
      for(const c of required){
        const rows=Array.isArray(summaries)?summaries.filter(s=>s.key===c.key):[];const s=rows[0],ref=packet?.refs?.[c.key];
        if(rows.length!==1||s.source_revision!==packet.source_revision||s.ref!==ref?.ref||s.sha256!==ref?.sha256||typeof s.text!=='string'||!s.text.trim())issues.push('Evidence要約の参照を詳細で確認');
        else checks.push({id:c.id,text:c.label?`${c.label}：${s.text}`:s.text,key:c.key});
      }
    }
    const tests=packet?.test_summary,regression=packet?.regression_summary;
    const linked=s=>s&&s.source_revision===packet?.source_revision&&s.ref===packet?.refs?.tests?.ref&&s.sha256===packet?.refs?.tests?.sha256;
    const testKnown=linked(tests)&&Number.isInteger(tests.passed)&&Number.isInteger(tests.total)&&tests.total>=tests.passed&&tests.passed>=0;
    const regressionKnown=linked(regression)&&Number.isInteger(regression.failures)&&regression.failures>=0;
    if(review&&(testKnown&&tests.passed!==tests.total||regressionKnown&&regression.failures>0))issues.push('失敗結果を詳細で確認');
    const effect=i.impact||{human_review:'承認後はAcceptanceの判断へ進みます。',acceptance:'承認後はWork ItemをDONEへ進める判断です。',idea_triage:'やる＝Task化候補、保留＝育てる案、捨てる＝却下案。',context_candidate:'候補として残し、既存のHuman Reviewへ渡します。自動昇格はしません。',classification_required:'回答は本人の拘束条件を見直す候補になります。'}[k]||'判断後の影響は詳細で確認してください。';
    return{kind:k,info,gate,review,question:k==='blocker_decision'&&choices.length?i.answer_contract.question:question,effect,checks:gate.issues.length?[]:checks,choices,issues:[...new Set(issues)],
      title:['classification_required','calendar_event_impact','calendar_partial_window'].includes(k)?i.calendar_event?.title||info.entity?.title||i.title||'予定は未取得':i.title||info.entity?.title||'元項目は未取得',
      metrics:review?(gate.issues.length?['Evidenceは再取得・再確認が必要です']:[`Codex ${packet?.execution_status||'未取得'}`,testKnown?`Tests ${tests.passed} / ${tests.total} PASS`:'Tests 未取得',Array.isArray(packet?.changed_files)?`変更 ${packet.changed_files.length} files`:'変更files 未取得',regressionKnown?`Regression ${regression.failures}`:'Regression 未取得']):[]};
  }
  function inlineAnswer(data,id,input,now,health){
    const item=queueItems(data)?.find(i=>i.id===id);if(!item)throw Error('本人の未処理Decisionではありません');
    const summary=inlineSummary(data,item,now,health),partial=summary.kind==='calendar_partial_window',choice=partial?{value:'time_range',label:'拘束時間を指定'}:summary.choices.find(c=>c.value===input?.decision);
    if(summary.issues.length)throw Error(summary.issues.join(' / '));
    if(!choice)throw Error('この質問の選択肢から回答してください');
    if(summary.review&&input.confirmed_summary!==true)throw Error('上のEvidence要約を確認してください');
    if(summary.review&&input.decision==='REWORK_REQUIRED'&&!input.reason?.trim())throw Error('差戻し理由を入力してください');
    const reason=SECRETARY.has(summary.kind)?input.reason?.trim()||null:input.reason?.trim()||`${summary.question} → ${choice.label}（追加理由なし）`;
    const draft=proposal(data,id,{decision:choice.value,selected_option:input?.selected_option,reason,actor:summary.kind==='classification_required'?'unknown':undefined,checked:summary.review?summary.checks.map(c=>c.id):[]},now,health);
    return{...draft,answer_label:choice.label,question:summary.question,summary_confirmed:summary.review?true:null};
  }
  function dispose(host){const s=sessions.get(host);if(s){clearInterval(s.timer);sessions.delete(host);}}
  function render(host,selection,data,now,{health,workDetail,tick=true,answerApi=null}={}){
    dispose(host);host.replaceChildren();
    const doc=host.ownerDocument, session={timer:null};sessions.set(host,session);
    const start=Date.now(),currentTime=()=>now+(tick?Date.now()-start:0);
    const el=(tag,text='',cls='')=>{const n=doc.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;};
    const add=(parent,tag,text='',cls='')=>{const n=el(tag,text,cls);parent.append(n);return n;};
    const link=(parent,text,path,cls='kp-back')=>{const a=add(parent,'a',text,cls);a.href='#kaz-os/'+path;return a;};
    const fmt=n=>knownMinutes(n)?`${n}m`:'時間未確認';
    const sourceLabel=data?.fixture_only?'FIXTURE · 全件架空・実データではありません':data?.origin==='mock'?'MOCK · 検証用':['real','real_operational_sources'].includes(data?.origin)&&!data?.inbox_items?.some(i=>i.synthetic)?'REAL · 読取snapshot':'由来未確認 / MIXED';
    const head=add(host,'section','','ki-header');
    const model=derive(data,now,health),todayOnly=selection.id==='today',allItems=selection.id==='all',detailId=selection.id&&!todayOnly&&!allItems?selection.id:null;
    add(head,'h2',detailId?'DECISION DETAIL':allItems?'INBOX':'ぱるるから質問','ki-heading');
    if(data)add(head,'p',sourceLabel,'kt-origin');
    const notice=add(head,'p','','kp-notice ki-health');
    function healthText(status){return {ok:'',partial:'PARTIAL · 取得済み範囲のみ。総数・所要時間は未確定です。',stale:'STALE · 情報が古いため判断案を作れません。',failed:'FAILED · 取得できません。0件ではありません。',not_connected:'NOT CONNECTED · 実データsourceは未接続です。0件ではありません。'}[status]??'取得状態を確認してください';}
    notice.textContent=healthText(model.status);notice.hidden=!notice.textContent;
    if(!['ok','partial'].includes(model.status)){link(head,'Sourceの状態を確認','diagnostics');return;}
    const trusted=model.status==='ok';
    const statusLive=()=>health(data?.sources?.inbox,currentTime())==='ok';
    function field(parent,label,tag){const l=add(parent,'label','','ki-field');add(l,'span',label);return add(l,tag);}
    function detail(i,parent){
      const k=kind(i),info=entities(data,i,now,health),gate=evidenceGate(data,i,now,health);
      const title=i.title||info.entity?.title||'元項目は未取得';
      add(parent,'p',`${TYPES[k]} · ${fmt(i.estimate_min)}`,'ki-type');add(parent,'h3',title,'ki-detail-title');
      if(info.projectId)link(parent,info.project?.title||'Project relationを確認','projects/'+encodeURIComponent(info.projectId));
      add(parent,'p',i.reason||rank(data,i,now).reason,'ki-reason');
      add(parent,'p','優先理由: '+rank(data,i,now).reason,'kp-muted');
      add(parent,'p','閲覧・判断案のみ。保存、承認、Task更新は行いません。','kp-notice');
      if(['human_review','acceptance'].includes(k)){
        add(parent,'p',k==='human_review'?'Human Review: Codexの仕事は妥当か。承認案はACCEPTANCEへ渡す候補です。':'Acceptance: Work Itemの目的・終了条件を満たしたか。Human Reviewとは別の判断です。','kp-muted');
        if(info.entity&&workDetail)workDetail(info.entity,parent);
      }
      if(k==='context_candidate')add(parent,'p','Context candidate · 未昇格。既存candidate / Human Reviewへ渡す案を作ります。','kp-notice');
      if(k==='classification_required'){
        add(parent,'p','本人への影響は未確定。actorと影響を明示し、既存の分類Evidenceを上書きしません。','kp-muted');
        if(info.entity)add(parent,'p',`${info.entity.start||'開始未取得'} ～ ${info.entity.end||'終了未取得'}`,'kp-muted');
      }
      const trace=add(parent,'details','','kp-detail ki-trace');add(trace,'summary','参照 / Evidence');
      add(trace,'p',`Decision ${i.id} / source revision ${data.sources.inbox.source_revision}`,'kp-muted');
      add(trace,'p',`元項目 ${i.entity_ref||'未取得'}`,'kp-muted');
      if(i.priority_ref)add(trace,'p',`優先判断の参照: ${i.priority_ref}`,'kp-muted');
      if(gate.packet){add(trace,'p',`Run ${gate.packet.run_id} · ${gate.packet.execution_status} / capture ${gate.packet.capture_status}`,'kp-muted');
        if(gate.packet.result_summary)add(trace,'p',gate.packet.result_summary,'ki-reason');
        if(Array.isArray(gate.packet.changed_files))add(trace,'p',`変更: ${gate.packet.changed_files.join(' / ')||'0件（取得範囲内）'}`,'kp-muted');
        add(trace,'p',`Human Review ${gate.packet.human_review_status} · Run revision ${gate.packet.source_revision}`,'kp-muted');
        for(const [key,ref] of Object.entries(gate.packet.refs||{}))add(trace,'p',`${key}: ${ref.ref} · SHA-256 ${ref.sha256}`,'kp-muted');}
      const form=add(parent,'form','','ki-form');add(form,'h4','判断案を作る（未保存）');
      const select=field(form,'判断','select');add(select,'option','選択してください').value='';
      Object.entries(OUTCOMES[k]).forEach(([value,label])=>{add(select,'option',label).value=value;});
      let actor=null;if(k==='classification_required'){actor=field(form,'actor（予定名から推定しません）','select');add(actor,'option','選択してください').value='';for(const value of ['kaz','family','spouse','child','popio','unknown'])add(actor,'option',value).value=value;}
      const checked=[];
      if(['human_review','acceptance'].includes(k)){
        const criteria=k==='acceptance'?info.entity?.acceptance_criteria||[]:['run_result','git_diff','tests','instruction','git_before','git_after'].map(key=>({id:key,instruction:key,evidence_key:key}));
        const group=add(form,'fieldset','','ki-checks');add(group,'legend','Evidenceを確認してから選択');
        for(const c of criteria){const label=add(group,'label','','ki-check');const check=add(label,'input');check.type='checkbox';check.value=c.id;checked.push(check);add(label,'span',c.instruction||c.id);}
      }
      const reason=field(form,'判断理由（必須）','textarea');reason.rows=2;reason.maxLength=1000;
      const missing=add(form,'p',gate.issues.join(' / '),'kp-notice');missing.hidden=!gate.issues.length;
      const submit=add(form,'button','判断案を表示','ki-button');submit.type='submit';submit.disabled=gate.issues.length>0;
      const output=add(form,'div','','ki-proposal');output.setAttribute('role','status');
      form.addEventListener('submit',e=>{
        e.preventDefault();if(sessions.get(host)!==session)return;
        try{const draft=proposal(data,i.id,{decision:select.value,actor:actor?.value,reason:reason.value,checked:checked.filter(c=>c.checked).map(c=>c.value)},currentTime(),health);
          output.replaceChildren();output.dataset.proposal=JSON.stringify(draft);add(output,'p',`判断案: ${OUTCOMES[k][draft.decision]} · 未採用・未保存`,'ki-proposal-status');
          add(output,'p',draft.reason,'ki-reason');add(output,'p',`引継ぎ先: ${draft.continuation}。元項目は判断待ちのままです。`,'kp-muted');
        }catch(error){output.replaceChildren();delete output.dataset.proposal;add(output,'p',error.message,'kp-notice');}
      });
    }
    if(!detailId&&!allItems){
      const pool=model.today,drafts=new Map(),notes=new Map(),requestKeys=new Map();let page=0;
      head.classList.add('kiq-header');
      if(todayOnly)add(head,'p','今日の判断のみ','kt-inbox-filter');
      const progress=add(head,'div','','kiq-progress'),feedback=add(host,'div','','kiq-feedback');feedback.setAttribute('role','status');
      const batch=add(host,'div','','kiq-batch'),footer=add(host,'div','','kiq-footer');
      function totals(){
        progress.replaceChildren();feedback.replaceChildren();delete feedback.dataset.answers;
        const remaining=pool.filter(i=>!drafts.has(i.id)),minutes=trusted?sum(remaining):null;
        add(progress,'strong',`今日中 ${remaining.length}件${trusted?'':'以上'}`);
        add(progress,'span',`あとで ${model.later.length}件${trusted?'':'以上'}`);
        add(progress,'span',trusted?(minutes===null?'時間未確認':`約${fmt(minutes)}`):'時間未確定');
        if(drafts.size){feedback.dataset.answers=JSON.stringify([...drafts.values()]);add(feedback,'p',`✓ ${drafts.size}件の回答案 · 未保存（Plan・Taskは未変更）`,'kiq-feedback-text');}
        else if(data?.feedback?.message)add(feedback,'p',data.feedback.message,'kiq-feedback-text');
      }
      function row(item,parent){
        const active=add(parent,'section','','kiq-current');active.dataset.decisionId=item.id;
        function draw(){
          active.replaceChildren();
          const summary=inlineSummary(data,item,currentTime(),health),info=summary.info,draft=drafts.get(item.id);
          active.dataset.decisionType=summary.kind;active.classList.toggle('kiq-answered',!!draft);
          if(draft){
            add(active,'p',summary.title,'kiq-saved-title');
            const line=add(active,'div','','kiq-saved');add(line,'span',`✓ ${draft.answer_label} · 回答案`);
            const undo=add(line,'button','戻す','kiq-text-button');undo.type='button';undo.setAttribute('aria-label',summary.title+'の回答を戻す');undo.onclick=()=>{drafts.delete(item.id);totals();draw();};
            return;
          }
          const top=add(active,'div','','kiq-meta');add(top,'span',TYPES[summary.kind]);add(top,'span',fmt(item.estimate_min));
          const title=add(active,'h3','','kiq-title');link(title,summary.title,'inbox/'+encodeURIComponent(item.id),'kiq-title-link');
          const origin=add(active,'p','','kiq-origin');
          if(item.source_label)add(origin,'span',item.source_label);
          if(info.projectId)link(origin,info.project?.title||'Project未確認','projects/'+encodeURIComponent(info.projectId),'kiq-project');
          if(['calendar_event_impact','calendar_partial_window'].includes(summary.kind)){
            const event=item.calendar_event;
            const time=v=>Number.isFinite(at(v))?new Date(at(v)).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):String(v||'時刻未確認');
            add(origin,'span',event?.all_day?`${event.start}–${event.end} · 終日`:`${time(event?.start)}–${time(event?.end)}`,'kiq-time');
          }else if(summary.kind==='classification_required'&&Number.isFinite(at(info.entity?.start))&&Number.isFinite(at(info.entity?.end))){
            const time=v=>new Date(at(v)).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit'});
            add(origin,'span',`${time(info.entity.start)}–${time(info.entity.end)}`,'kiq-time');
          }
          add(active,'p',summary.question,'kiq-question');
          if(summary.review)add(active,'p',summary.metrics.join(' · '),'kiq-metrics');
          const warning=add(active,'p',summary.issues.join(' / '),'kp-notice kiq-warning');warning.hidden=!summary.issues.length;
          const actions=add(active,'div','','kiq-actions');
          actions.style.gridTemplateColumns=`repeat(${Math.max(2,summary.choices.length+(summary.review?1:0))}, minmax(0,1fr))`;
          // Review details are disclosed inline on explicit intent, never pre-confirmed.
          const panel=add(active,'div','','kiq-review-panel');panel.hidden=true;panel.id='kiq-review-'+item.id;
          let pendingChoice=null,confirmed=null,note=null,submit=null;
          const error=add(active,'p','','kp-notice kiq-error');error.hidden=true;error.setAttribute('role','alert');
          async function answer(choice,selectedOption=null){
            if(sessions.get(host)!==session)return;
            try{
              const draft=inlineAnswer(data,item.id,{decision:choice.value,selected_option:selectedOption,confirmed_summary:confirmed?.checked,reason:note?.value||notes.get(item.id)||''},currentTime(),health);
            if(!answerApi){
              if(data?.mode==='read_only_display')throw Error('Live回答はまだ無効です');
              drafts.set(item.id,draft);totals();draw();return;
            }
              const key=requestKeys.get(item.id)||`paluru-${globalThis.crypto?.randomUUID?.()||String(Date.now())+'-'+Math.random().toString(16).slice(2)}`;requestKeys.set(item.id,key);
              active.querySelectorAll('button,input').forEach(control=>control.disabled=true);
              const result=await answerApi({...draft,idempotency_key:key});
              if(result?.inbox){render(host,selection,result.inbox,Date.now(),{health,workDetail,tick,answerApi});return;}
              throw Error('保存結果を再取得できません');
            }catch(e){error.hidden=false;error.textContent=e.message;active.querySelectorAll('button,input').forEach(control=>control.disabled=!statusLive());}
          }
          function review(choice){
            pendingChoice=choice;panel.hidden=false;panel.replaceChildren();error.hidden=true;
            actions.querySelectorAll('button').forEach(b=>b.setAttribute('aria-expanded',String(b.dataset.answer===choice.value)));
            add(panel,'p',summary.kind==='acceptance'?'終了条件とEvidence要約':'確認ポイント','kiq-check-heading');
            const list=add(panel,'ul','','kiq-checks');summary.checks.forEach(c=>add(list,'li',c.text));
            add(panel,'p','→ '+summary.effect,'kiq-effect');
            const label=add(panel,'label','','ki-check kiq-confirm');confirmed=add(label,'input');confirmed.type='checkbox';
            add(label,'span',summary.kind==='acceptance'?'全終了条件と要約を確認した':'全Evidence要約を確認した');
            note=null;
            if(choice.value==='REWORK_REQUIRED'){
              const noteBox=add(panel,'div','','kiq-notes');note=field(noteBox,'差戻し理由','textarea');note.rows=2;note.maxLength=1000;note.value=notes.get(item.id)||'';note.addEventListener('input',()=>notes.set(item.id,note.value));
            }
            const controls=add(panel,'div','','kiq-review-controls');
            submit=add(controls,'button',`${choice.label}案を作る`,'ki-button kiq-submit');submit.type='button';submit.disabled=true;
            confirmed.onchange=()=>submit.disabled=!confirmed.checked||!statusLive();
            submit.onclick=()=>answer(pendingChoice);
            const close=add(controls,'button','閉じる','kiq-text-button');close.type='button';close.onclick=()=>{panel.hidden=true;panel.replaceChildren();confirmed=null;note=null;pendingChoice=null;error.hidden=true;actions.querySelectorAll('button').forEach(b=>b.setAttribute('aria-expanded','false'));};
          }
          for(const choice of summary.choices){
            const button=add(actions,'button',choice.label,'ki-button kiq-answer');button.type='button';button.dataset.answer=choice.value;
            button.disabled=summary.issues.length>0||data?.mode==='read_only_display';
            if(summary.review){button.setAttribute('aria-controls',panel.id);button.setAttribute('aria-expanded','false');}
            button.onclick=()=>{if(sessions.get(host)!==session)return;if(summary.review)review(choice);else answer(choice);};
          }
          if(summary.kind==='calendar_partial_window'){
            const group=add(active,'fieldset','','kiq-partial-window'),legend=add(group,'legend','拘束される時間');legend.className='kiq-check-heading';
            const local=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)?v+'T00:00':typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(v)?v.slice(0,16):'';
            const startInput=field(group,'開始','input');startInput.type='datetime-local';startInput.value=local(item.calendar_event?.start);
            const endInput=field(group,'終了','input');endInput.type='datetime-local';endInput.value=local(item.calendar_event?.end);
            const submitRange=add(group,'button','拘束時間を確認','ki-button kiq-submit');submitRange.type='button';submitRange.disabled=summary.issues.length>0||data?.mode==='read_only_display';
            submitRange.onclick=()=>answer({value:'time_range',label:'拘束時間を指定'},{start:startInput.value+':00+09:00',end:endInput.value+':00+09:00'});
          }
          if(summary.review)link(actions,'詳細','inbox/'+encodeURIComponent(item.id),'ki-button kiq-detail-link');
        }
        draw();
      }
      function showPage(){
        batch.replaceChildren();footer.replaceChildren();totals();
        if(!pool.length){add(batch,'p','今日必要な判断はありません','ki-empty');add(batch,'p','取得範囲内の状態です。あとで見る判断は全INBOXへ。','kp-muted');}
        let calendarGroup=null;
        pool.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE).forEach(i=>{
          if(['calendar_event_impact','calendar_partial_window'].includes(kind(i))){
            if(!calendarGroup){calendarGroup=add(batch,'section','','kiq-calendar-group');add(calendarGroup,'h3','Family Calendar','kiq-calendar-heading');}
            row(i,calendarGroup);
          }else{calendarGroup=null;row(i,batch);}
        });
        if(pool.length>PAGE_SIZE){
          const pager=add(footer,'div','','ki-pager');add(pager,'span',`${page*PAGE_SIZE+1}–${Math.min((page+1)*PAGE_SIZE,pool.length)} / 今日${pool.length}件`,'kp-muted');
          for(const [label,offset] of [['前の5件',-1],['次の5件',1]]){
            if(page+offset<0||(page+offset)*PAGE_SIZE>=pool.length)continue;
            const button=add(pager,'button',label,'ki-button');button.type='button';button.onclick=()=>{page+=offset;showPage();head.scrollIntoView({block:'start'});};
          }
        }
        add(footer,'p',answerApi?'LIVE · 回答と変更案を保存。Notion / Calendar / Contextは未変更。':data?.mode==='read_only_display'?'LIVE READ-ONLY · 回答はまだ無効です。':'LOCAL · 回答案のみ。移動・再読込で消えます。','kiq-local-note');
        link(footer,`あとで見る · 全INBOX ${model.total}件${trusted?'':'（取得済み）'}`,'inbox/all','kiq-all');
      }
      showPage();
      if(tick){session.timer=setInterval(()=>{
        if(sessions.get(host)!==session)return;
        const state=health(data?.sources?.inbox,currentTime());
        if(state!=='ok'){
          notice.hidden=false;notice.textContent=healthText(state);host.querySelectorAll('.kiq-answer,.kiq-submit').forEach(b=>b.disabled=true);
          if(drafts.size){drafts.clear();totals();feedback.textContent='情報が古くなったため、回答案は再確認が必要です（未保存）。';
            host.querySelectorAll('.kiq-saved>span').forEach(n=>n.textContent='回答案は再確認が必要');}
        }
      },1000);session.timer.unref?.();}
      return;
    }
    if(detailId){
      link(head,'← INBOX','inbox');const item=model.items.find(i=>i.id===detailId);
      if(item)detail(item,host);else add(host,'p','この取得範囲に本人の未処理Decisionはありません。');
    }else{
      link(head,'← 今日の質問へ','inbox');
      const count=add(head,'p','','ki-count');add(count,'strong',`${trusted?'':'取得済み '}${model.total}`);add(count,'span','本人の判断待ち');
      const kpis=add(head,'div','','ki-kpis');
      for(const [label,value] of [['今日中',model.today.length],['約',trusted?(model.minutes===null?'時間未確認':fmt(model.minutes)):'時間未確定'],['Review',model.counts.human_review],['Blocked',model.counts.blocker_decision]]){const item=add(kpis,'span');add(item,'small',label);add(item,'strong',String(value));}
      if(todayOnly){add(head,'p','今日の判断のみ','kt-inbox-filter');link(head,`全${model.total}件へ`,'inbox');}
      if(!model.items.length){add(host,'p',trusted?'判断待ちはありません':'取得済み範囲に判断待ちはありません。全体は未確定です。','ki-empty');if(trusted)add(host,'p','この取得範囲でKaz本人の判断が必要な項目はありません。','kp-muted');}
      else{
        const filter=field(head,'種類','select');filter.className='ki-filter';add(filter,'option','すべての判断').value='all';Object.entries(TYPES).forEach(([key,label])=>add(filter,'option',`${label} ${model.counts[key]}`).value=key);
        const body=add(host,'div','','ki-groups');
        let pages={today:0,later:0};
        function row(i,parent){
          const info=entities(data,i,currentTime(),health),r=add(parent,'a','','ki-row');r.href='#kaz-os/inbox/'+encodeURIComponent(i.id);r.dataset.inboxId=i.id;
          const top=add(r,'span','','ki-row-top');add(top,'span',TYPES[kind(i)],'ki-type');add(top,'span',fmt(i.estimate_min),'ki-estimate');
          add(r,'strong',i.title||info.entity?.title||'元項目は未取得','ki-title');
          const due=Number.isFinite(at(i.due_at))?new Date(at(i.due_at)).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):null;
          add(r,'span',`${info.project?.title||'Project未確認'}${due?' · 期限 '+due:''}`,'ki-meta');
          add(r,'span','→ '+(i.impact||i.reason||rank(data,i,currentTime()).reason),'ki-impact');
        }
        function groups(){
          body.replaceChildren();
          for(const [key,label,original] of [['today','TODAY',model.today],['later','LATER',model.later]]){
            if(todayOnly&&key==='later')continue;
            const items=original.filter(i=>filter.value==='all'||kind(i)===filter.value),page=pages[key],limit=key==='later'&&page===0?PREVIEW:PAGE_SIZE;
            const offset=key==='later'&&page>0?PREVIEW+(page-1)*PAGE_SIZE:page*PAGE_SIZE;
            const section=add(body,'section','','ki-group');section.dataset.decisionGroup=key;
            const heading=add(section,'h3',label);add(heading,'small',` ${items.length}${trusted?'':'件以上'}`);
            if(!items.length){add(section,'p',trusted?'対象の判断はありません':'取得済み範囲に対象なし','kp-muted');continue;}
            items.slice(offset,offset+limit).forEach(i=>row(i,section));
            if(items.length>limit||page>0){
              const pager=add(section,'div','','ki-pager');add(pager,'span',`${offset+1}–${Math.min(offset+limit,items.length)} / ${items.length}`,'kp-muted');
              if(page>0){const prev=add(pager,'button','前へ','ki-button');prev.type='button';prev.onclick=()=>{pages[key]--;groups();};}
              if(offset+limit<items.length){const next=add(pager,'button','続き','ki-button');next.type='button';next.onclick=()=>{pages[key]++;groups();};}
            }
          }
        }
        filter.addEventListener('change',()=>{pages={today:0,later:0};groups();});groups();
      }
      link(host,'技術状態はDiagnosticsへ','diagnostics');
    }
    if(tick){session.timer=setInterval(()=>{if(sessions.get(host)!==session)return;
      const status=health(data?.sources?.inbox,currentTime());
      if(status!=='ok'){notice.hidden=false;notice.textContent=healthText(status);host.querySelectorAll('.ki-form button').forEach(b=>b.disabled=true);host.querySelectorAll('.ki-proposal').forEach(p=>{if(p.dataset.proposal){delete p.dataset.proposal;p.textContent='sourceが古くなりました。判断案は未採用・未保存です。';}});}
    },1000);session.timer.unref?.();}
  }
  return {TYPES,OUTCOMES,kind,queueItems,todayItems,isToday,rank,derive,entities,evidenceGate,proposal,inlineSummary,inlineAnswer,render,dispose};
});

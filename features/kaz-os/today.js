/* Read-only TODAY projection. Consumes planner/window-gate results; never ranks or writes tasks. */
(function(root, factory) {
  const view = factory(typeof module === 'object' && module.exports ? require('./inbox') : root.KazInboxView);
  if (typeof module === 'object' && module.exports) module.exports = view;
  else root.KazTodayView = view;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(inboxView) {
  'use strict';
  const MINUTE = 60000, sessions = new WeakMap();
  const ACTION_STATES = ['READY','DOING','SCHEDULED','HUMAN_REVIEW','ACCEPTANCE'];
  const LEVERAGE = ['completion_leverage','dependency_unlock','human_review_leverage'];
  const CHANGES = {task_completed:'Task完了の報告',delay:'遅延',overtime:'予定超過',fatigue:'疲労',family_event:'家庭の予定変更',run_completed:'AI Run完了'};
  const timestamp = value => typeof value === 'string' && /T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN;
  const date = at => new Date(at + 9*60*MINUTE).toISOString().slice(0,10);
  const clock = at => Number.isFinite(at) ? new Date(at).toLocaleTimeString('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit'}) : '未取得';
  const duration = value => value == null ? '未確定' : value >= 60 ? `${Math.floor(value/60)}h${value%60 ? String(value%60).padStart(2,'0')+'m' : ''}` : `${value}m`;
  const rows = values => Array.isArray(values) && values.every(v=>v && typeof v.id==='string' && v.id) && new Set(values.map(v=>v.id)).size===values.length ? values : null;
  const interval = w => w && Number.isFinite(timestamp(w.start)) && timestamp(w.start)<timestamp(w.end) ? [timestamp(w.start),timestamp(w.end)] : null;
  const spans = values => Array.isArray(values) && values.every(interval) ? values.map(interval) : null;
  const inside = (span, windows) => windows.some(w=>w[0]<=span[0] && span[1]<=w[1]);
  const overlaps = (a,b) => a[0]<b[1] && b[0]<a[1];
  function merge(values) {
    const result=[];
    [...values].sort((a,b)=>a[0]-b[0]).forEach(w=>{const last=result[result.length-1];if(last && w[0]<=last[1])last[1]=Math.max(last[1],w[1]);else result.push([...w]);});
    return result;
  }
  const minutes = values => Math.floor(merge(values).reduce((total,w)=>total+w[1]-w[0],0)/MINUTE);
  const clip = (values,start,end) => values.map(w=>[Math.max(start,w[0]),Math.min(end,w[1])]).filter(w=>w[0]<w[1]);
  const liveEvidence = (e,now) => e?.confirmed_by==='kaz' && e.evidence_ref && timestamp(e.confirmed_at)<=now && now<timestamp(e.valid_until) && timestamp(e.valid_until)-timestamp(e.confirmed_at)<=36*60*MINUTE;
  function origin(data) {
    if (!data) return {kind:'not_connected',label:'NOT CONNECTED'};
    if (data.fixture_only===true) return {kind:'fixture',label:'FIXTURE · 全件架空・実データではありません'};
    if (data.origin==='mock') return {kind:'mock',label:'MOCK · 検証用データ'};
    if (data.origin==='mixed' || data.origin==='real' && data.work_items?.some(w=>w.synthetic===true)) return {kind:'mixed',label:'MIXED · 実データと検証データを含む'};
    if (data.origin==='real') return {kind:'real',label:'REAL · 読取snapshot由来'};
    return {kind:'unknown',label:'データの由来は未確認'};
  }
  function todayInbox(data, now) { return inboxView?.todayItems(data, now) ?? null; }

  function derive(data, now, health) {
    const status = name => health(data?.sources?.[name],now), current = name => status(name)==='ok';
    const sourceOrigin=origin(data), warnings=[];
    const result={origin:sourceOrigin,now,context:{next_fixed:null,fixed_known:false,available_min:null,available_end:null,stop:null,bed:null,wake:null,next_wake:null,unknown_count:null},
      now_items:[],next_items:[],quick_items:[],waiting_items:[],waiting_count:null,inbox:null,capacity:null,timeline:[],warnings,needs_input:false,stopped:false,proposal_ref:data?.sources?.plan?.source_revision||null};
    const sourceNames=['tasks','runs','calendar','constraints','project_context','plan','resolution'];
    sourceNames.filter(name=>!current(name)).forEach(name=>warnings.push(`${name}: ${status(name).toUpperCase().replace('_',' ')}`));
    const work=rows(data?.work_items), events=rows(data?.calendar_events), runs=rows(data?.active_runs);
    const byId=new Map((work||[]).map(w=>[w.id,w]));
    const day=data?.day_context;
    const dayValid=current('constraints') && day?.day_date===date(now) && ['user','approved_policy'].includes(day.origin) && day.evidence_ref && day.source_revision===data.sources.constraints.source_revision;
    if (dayValid) {
      for (const [field,key] of [['stop','stop_at'],['bed','bed_at'],['wake','wake_at'],['next_wake','next_wake_at']]) if(Number.isFinite(timestamp(day[key]))) result.context[field]=timestamp(day[key]);
    }
    const stop=result.context.stop;
    const gate=data?.window_gate;
    const coverage=interval(data?.sources?.calendar?.coverage);
    const hard=spans(gate?.confirmed_hard_constraints), soft=spans(gate?.confirmed_soft_constraints), unknown=spans(gate?.unknown_windows), confirmed=spans(gate?.confirmed_available_windows), usable=spans(gate?.usable_windows);
    const gateValid=current('calendar') && current('resolution') && events && gate?.mode==='window_proposal_only' && gate.adopted===false &&
      gate.calendar_revision===data.sources.calendar.source_revision && gate.resolution_hash===data.sources.resolution.source_revision &&
      Number.isFinite(timestamp(gate.as_of)) && timestamp(gate.as_of)<=now && coverage && coverage[0]<=timestamp(`${date(now)}T00:00:00+09:00`) && coverage[1]>=(result.context.next_wake??result.context.bed??stop??now) && hard && soft && unknown && confirmed && usable &&
      [...gate.confirmed_hard_constraints,...gate.confirmed_soft_constraints].every(c=>events.some(e=>e.id===c.source_event_id)&&liveEvidence(c.evidence,now)) &&
      gate.unknown_windows.every(c=>c.reason!=='HUMAN_BOUNDED_UNKNOWN'||liveEvidence(c.evidence,now)) &&
      Array.isArray(gate.availability_evidence) && confirmed.every(w=>gate.availability_evidence.some(a=>interval(a.window)&&inside(w,[interval(a.window)])&&liveEvidence(a.confirmation,now))) &&
      usable.every(w=>inside(w,merge(confirmed)) && ![...hard,...soft,...unknown].some(o=>overlaps(w,o)));
    const safe=gateValid && stop!==null ? clip(usable,now,stop) : null;
    if (gateValid) {
      result.context.fixed_known=true;
      result.context.unknown_count=new Set(gate.unknown_windows.filter(w=>w.source_event_id).map(w=>w.source_event_id)).size;
      const fixed=gate.confirmed_hard_constraints.map(c=>({constraint:c,event:events.find(e=>e.id===c.source_event_id)})).filter(x=>x.event && interval(x.event));
      const next=fixed.filter(x=>timestamp(x.event.end)>now).sort((a,b)=>timestamp(a.event.start)-timestamp(b.event.start))[0];
      if(next)result.context.next_fixed={title:next.event.title,start:timestamp(next.event.start),end:timestamp(next.event.end),ongoing:timestamp(next.event.start)<=now};
      if(safe){const active=safe.find(w=>w[0]<=now && now<w[1]);if(active){result.context.available_min=Math.floor((active[1]-now)/MINUTE);result.context.available_end=active[1];}}
    } else if(current('calendar')) warnings.push('Calendar分類・時間窓の根拠を再確認');
    const energy=data?.energy;
    const energyValid=current('constraints') && ['low','medium','high'].includes(energy?.value) &&
      ['user','approved_profile','fixture_user_confirmation'].includes(energy.source) && (energy.source!=='fixture_user_confirmation'||data?.fixture_only===true) &&
      timestamp(energy.valid_from)<=now && now<timestamp(energy.valid_until);
    if(stop===null)warnings.push('作業終了constraintは未取得');
    result.stopped=dayValid && stop!==null && now>=stop;
    if(!energyValid && !result.stopped)warnings.push('Energyは未取得または期限切れ');
    if(!work && current('tasks'))warnings.push('Task一覧の欠落・重複を確認');
    if(!runs && current('runs'))warnings.push('Run一覧の欠落・重複を確認');
    if(sourceOrigin.kind==='unknown')warnings.push('データの由来を確認');
    const proposal=data?.today;
    const blocks=[];
    const blockInstant = value => Number.isFinite(timestamp(value)) ? timestamp(value) : typeof value==='string' && /^\d{2}:\d{2}$/.test(value) && Number.isFinite(timestamp(data?.as_of)) ? timestamp(`${date(timestamp(data.as_of))}T${value}:00+09:00`) : NaN;
    if(current('plan') && Array.isArray(proposal?.plan)) for(const b of proposal.plan){
      const span=[blockInstant(b.start),blockInstant(b.end)], w=byId.get(b.work_item_id);
      const certainty=b.certainty==='scheduled' && b.adoption_ref && w?.state==='SCHEDULED' ? 'scheduled' : b.origin==='proposal' ? 'proposal' : 'unknown';
      const schedule=w?.schedule || w;
      const adoptedMatches=certainty!=='scheduled' || timestamp(schedule.scheduled_start)===span[0] && timestamp(schedule.scheduled_end)===span[1];
      blocks.push({...b,span,certainty,valid:!!(w && Number.isFinite(span[0]) && span[0]<span[1] && safe && inside([Math.max(now,span[0]),span[1]],safe) && certainty!=='unknown' && adoptedMatches)});
    }
    if(current('plan') && !Array.isArray(proposal?.plan))warnings.push('Planの取得内容を確認');
    if(blocks.some((b,i)=>blocks.some((c,j)=>i!==j && overlaps(b.span,c.span)))) {blocks.forEach(b=>b.valid=false);warnings.push('Plan時間帯の重複を確認');}
    const completeInput=sourceNames.every(current) && work && runs && gateValid && dayValid && safe!==null && sourceOrigin.kind!=='unknown' && Array.isArray(proposal?.plan);
    const ready=completeInput && gate.state==='windows_available' && energyValid;
    const actionable = w => {
      const unblock=w?.state==='BLOCKED' && w.action_kind==='unblock' && w.action_instruction;
      return w && w.next_actor==='kaz' && (ACTION_STATES.includes(w.state)||unblock) && Number.isFinite(w.estimate_min) && w.estimate_min>0 &&
        (!w.blocker||unblock) && Array.isArray(w.dependencies) && w.dependencies.every(id=>byId.get(id)?.state==='DONE') &&
        !runs.some(r=>r.work_item_id===w.id && ['running','queued','unknown'].includes(r.execution_status));
    };
    const selected=new Set();
    function select(ids,limit,kind) {
      const picked=[];
      if(!Array.isArray(ids)){warnings.push(`${kind}候補は未取得`);return picked;}
      for(const id of [...new Set(ids)]){
        if(picked.length>=limit)break;
        const w=byId.get(id), b=blocks.find(b=>b.work_item_id===id), proof=proposal.recommendations?.[id];
        if(selected.has(id)||!actionable(w))continue;
        if(kind==='quick'){
          const evidence=data.evidence?.[proof?.evidence_ref];
          if(!LEVERAGE.includes(proof?.kind)||!proof.reason||evidence?.work_item_id!==id||!safe.some(span=>span[1]-span[0]>=w.estimate_min*MINUTE))continue;
        } else if(!b?.valid || kind==='now' && !(b.span[0]<=now && now<b.span[1]) || kind==='next' && b.span[0]<now) continue;
        picked.push({work:w,block:b||null,reason:proof?.reason||w.selection_reason||null});selected.add(id);
      }
      return picked;
    }
    if(ready && !result.stopped){
      result.now_items=select(proposal.now,1,'now');
      result.next_items=select(proposal.next,2,'next');
      result.quick_items=select(proposal.quick_wins,2,'quick');
      if(proposal.now?.length && !result.now_items.length){warnings.push('NOWの状態・時間枠を再確認');result.now_unresolved=true;}
    }
    result.needs_input=!(ready || result.stopped && completeInput) || result.now_unresolved===true || blocks.some(b=>b.span[1]>now&&!b.valid);
    if(current('tasks') && current('runs') && work && runs){
      const waiting=work.filter(w=>!selected.has(w.id) && (
        ['CODEX_RUNNING','WAITING','BLOCKED'].includes(w.state) || ['HUMAN_REVIEW','ACCEPTANCE'].includes(w.state)&&w.next_actor!=='kaz' ||
        w.state==='SCHEDULED' && timestamp((w.schedule||w).scheduled_start)>now));
      const preferred=Array.isArray(proposal?.waiting_preview)?proposal.waiting_preview:[];
      waiting.sort((a,b)=>{const ai=preferred.indexOf(a.id),bi=preferred.indexOf(b.id);return (ai<0?Infinity:ai)-(bi<0?Infinity:bi)||a.id.localeCompare(b.id);});
      result.waiting_count=waiting.length;result.waiting_items=waiting.slice(0,2).map(work=>({work}));
    }
    if(current('inbox')){
      const items=todayInbox(data,now);
      if(items)result.inbox={count:items.length,minutes:items.every(i=>Number.isFinite(i.estimate_min)&&i.estimate_min>=0)?items.reduce((sum,i)=>sum+i.estimate_min,0):null};
    }
    if(ready && !result.stopped && blocks.every(b=>b.span[1]<=now||b.valid)){
      const planned=clip(blocks.filter(b=>b.valid).map(b=>b.span),now,stop);
      result.capacity={available:minutes(safe),planned:minutes(planned),buffer:minutes(safe)-minutes(planned),fixed:minutes(clip(hard,now,stop)),bounded_unknown:unknown.length>0};
    }
    if(dayValid){
      for(const [label,at] of [['起床',result.context.wake],['作業終了',stop],['就寝目標',result.context.bed],['翌朝の起床制約',result.context.next_wake]]) if(at!==null)result.timeline.push({kind:'protected',label,start:at,end:null});
    }
    if(gateValid){
      for(const e of events){
        const hardRow=gate.confirmed_hard_constraints.find(c=>c.source_event_id===e.id),softRow=gate.confirmed_soft_constraints.find(c=>c.source_event_id===e.id),unknownRow=gate.unknown_windows.find(c=>c.source_event_id===e.id);
        const kind=unknownRow?'unknown':hardRow?'fixed':softRow?'soft':'information';
        const bound=unknownRow||hardRow||softRow||e;
        if(interval(bound))result.timeline.push({kind,label:e.title,start:timestamp(bound.start),end:timestamp(bound.end),source_event_id:e.id});
      }
      for(const w of clip(usable,now,stop??now))result.timeline.push({kind:'available',label:'確認済み可用枠',start:w[0],end:w[1]});
    }
    if(current('plan') && !result.needs_input)for(const b of blocks.filter(b=>b.valid))result.timeline.push({kind:b.certainty==='scheduled'?'scheduled':'proposed',label:byId.get(b.work_item_id)?.title||'Task未取得',start:b.span[0],end:b.span[1]});
    result.timeline.sort((a,b)=>a.start-b.start);
    result.boundaries=[...sourceNames.map(n=>timestamp(data?.sources?.[n]?.valid_until)),...blocks.flatMap(b=>b.span),stop,timestamp(energy?.valid_until),
      ...(gate?.availability_evidence||[]).map(a=>timestamp(a.confirmation?.valid_until)),...(gate?.confirmed_hard_constraints||[]).map(a=>timestamp(a.evidence?.valid_until))].filter(t=>Number.isFinite(t)&&t>now);
    return result;
  }
  function dispose(host){const old=sessions.get(host);if(old){old.cancelled=true;clearTimeout(old.timer);sessions.delete(host);}}
  function render(host,data,initialNow,options){
    dispose(host);
    const session={cancelled:false,timer:null,started:Date.now(),request:0,feedback:null,form:{kind:'delay',remaining:''}};sessions.set(host,session);
    const doc=host.ownerDocument;
    const el=(tag,text='',cls='')=>{const n=doc.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;};
    const add=(parent,tag,text,cls)=>{const n=el(tag,text,cls);parent.append(n);return n;};
    const link=(text,href,cls='')=>{const a=el('a',text,cls);a.href=href;return a;};
    const section=title=>{const s=add(host,'section','','kp-section kt-section');add(s,'h2',title);return s;};
    const label={fixed:'FIXED',scheduled:'SCHEDULED',proposed:'PROPOSAL',available:'AVAILABLE',protected:'PROTECTED',unknown:'UNKNOWN',soft:'SOFT',information:'INFO'};
    function draw(now){
      if(session.cancelled)return;
      const open=new Set([...host.querySelectorAll('details[open][data-today-detail]')].map(d=>d.dataset.todayDetail));
      const result=derive(data,now,options.health);host.replaceChildren();
      const detail=(parent,key,title)=>{const d=add(parent,'details','','kp-detail');d.dataset.todayDetail=key;d.open=open.has(key);add(d,'summary',title);return d;};
      const head=section('TODAY');head.classList.add('kt-context');
      const top=add(head,'div','','kt-clock-row');add(top,'time',clock(now),'kt-clock');add(top,'span',`${date(now).slice(5).replace('-','/')} · JST`,'kp-muted');
      add(head,'p',result.origin.label,result.origin.kind==='fixture'||result.origin.kind==='mock'?'kt-origin kt-fixture':'kt-origin');
      const facts=add(head,'div','','kt-context-facts');
      const event=result.context.next_fixed;
      add(facts,'p',event?`${event.ongoing?'固定予定中':'次の固定'} ${clock(event.start)} · ${event.title}`:result.context.fixed_known?'次の固定予定なし（取得範囲内）':'次の固定予定は未取得／未確定','kt-next-fixed');
      add(facts,'p',result.context.available_min!==null?`いま${result.context.available_min}分空き · ${clock(result.context.available_end)}まで`:'いまの可用時間は未確定','kt-available');
      add(facts,'p',`作業終了 ${clock(result.context.stop)} · 就寝 ${clock(result.context.bed)}`,'kt-sleep');
      if(result.context.wake!==null||result.context.next_wake!==null)add(facts,'p',`起床 ${clock(result.context.wake)} · 翌朝 ${clock(result.context.next_wake)}`,'kt-wake');
      const attention=add(head,'div','','kt-attention');
      if(result.context.unknown_count>0)attention.append(link(`未分類予定 ${result.context.unknown_count}件 → INBOX`,'#kaz-os/inbox','kt-classification'));
      if(result.inbox?.count)attention.append(link(`判断待ち ${result.inbox.count}件${result.inbox.minutes!==null?' / 約'+result.inbox.minutes+'分':''}`,'#kaz-os/inbox/today','kt-inbox-today'));
      else if(result.inbox===null)add(attention,'small','判断待ちは未取得','kp-muted');
      if(result.needs_input)add(host,'p','needs_input · 一部の入力が未確定です。今日の行動は断定しません。','kp-notice kt-notice');
      const lanes=[['NOW',result.now_items,'now'],['NEXT',result.next_items,'next'],['QUICK WINS',result.quick_items,'quick_wins'],['WAITING',result.waiting_items,'waiting_preview']];
      for(const [name,items,key] of lanes){
        const s=section(name);s.dataset.lane=key;
        if(key==='quick_wins')add(s,'small','前進につながる短い代替候補 · Planには未追加','kp-muted');
        if(key==='waiting_preview')add(s,'small',result.waiting_count===null?'総件数は未取得':`${result.waiting_count}件中 ${items.length}件表示`,'kp-muted kt-waiting-count');
        if(!items.length)add(s,'p',key==='now'&&result.stopped&&!result.needs_input?'作業終了時刻 · DONE FOR TODAY':result.needs_input&&key!=='waiting_preview'?'入力の確認待ち':key==='waiting_preview'&&result.waiting_count===null?'待ち状態は未取得':'この取得範囲では候補なし','kp-muted');
        items.forEach(item=>{
          const w=item.work, b=item.block;
          const row=link('',`#kaz-os/projects/${encodeURIComponent(w.project_id)}`,'kp-action-row kt-action');row.dataset.workItemRef=w.id;
          row.append(el('strong',w.action_instruction||w.title),el('span',w.estimate_min==null?'時間未確認':w.estimate_min+'m','kp-action-time'));
          const project=data.projects?.find(p=>p.id===w.project_id)?.title||'Project未確認';
          const type=key==='waiting_preview'?({CODEX_RUNNING:'AI実行中',WAITING:'他者回答待ち',BLOCKED:'Blocker解除待ち',SCHEDULED:'将来の確定枠'}[w.state]||'他者の判断待ち'):({human_review:'Human Review',acceptance:'Acceptance',unblock:'Blocker解除',work:'Action',execute:'Action'}[w.action_kind]||'Action種別未確認');
          row.append(el('small',`${type} / ${project}`,'kp-action-meta'));
          if(b){const meta=el('small','','kp-action-meta kt-slot');meta.append(el('span',b.certainty==='scheduled'?'確定枠':'提案',`kt-badge kt-${b.certainty}`),el('span',`${clock(b.span[0])}–${clock(b.span[1])}`));row.append(meta);}
          if(key==='now'||key==='quick_wins')row.append(el('small',item.reason||'推薦理由は未取得','kp-action-meta kt-reason'));
          s.append(row);
        });
      }
      const capacity=section('TODAY Capacity');
      if(result.capacity){
        const grid=add(capacity,'dl','','kt-capacity');
        for(const [title,key] of [['確認済み可用','available'],['計画（提案含む）','planned'],['Buffer','buffer'],['固定Calendar','fixed']]){const cell=add(grid,'div');add(cell,'dt',title);add(cell,'dd',duration(result.capacity[key]));}
        add(capacity,'p',`現在から作業終了までの確認済み枠のみ${result.capacity.bounded_unknown?' · 未分類区間は除外':''}。提案は未採用です。`,'kp-muted');
      }else add(capacity,'p','時間の総量は未確定です。Calendar・分類・Planの完全性を確認してください。','kp-muted');
      const flow=detail(host,'timeline','起床から就寝までの流れを見る');
      add(flow,'p','可用枠は時間の入れ物、Taskはその中の候補です。空白へ自動で仕事を詰めません。','kp-muted');
      if(!result.timeline.length)add(flow,'p','時間軸を表示する入力が未取得です。','kp-muted');
      result.timeline.forEach(item=>{
        const line=add(flow,'div','',`kp-day-row kt-timeline-row kt-${item.kind}`);line.dataset.timelineKind=item.kind;
        add(line,'time',`${date(item.start)!==date(now)?'翌日 ':''}${clock(item.start)}${item.end? '–'+clock(item.end):''}`);
        const body=add(line,'div');add(body,'span',label[item.kind],'kt-badge');add(body,'p',item.label);
      });
      const replan=detail(host,'replan','再計画');
      add(replan,'p','変更を観測として渡し、未採用のproposalだけを再生成します。','kp-muted');
      const selectLabel=add(replan,'label','変化したこと','kt-field'),select=add(selectLabel,'select');select.name='change';
      Object.entries(CHANGES).forEach(([value,text])=>{const option=el('option',text);option.value=value;select.append(option);});select.value=session.form.kind;
      select.addEventListener('change',()=>session.form.kind=select.value);
      const remainingLabel=add(replan,'label','残り時間（分・分かる場合）','kt-field'),remaining=add(remainingLabel,'input');remaining.type='number';remaining.min='1';remaining.max='480';remaining.inputMode='numeric';remaining.value=session.form.remaining;
      remaining.addEventListener('input',()=>session.form.remaining=remaining.value);
      const button=add(replan,'button','提案を再生成','secondary-button');button.type='button';button.disabled=typeof options.requestReplan!=='function';
      if(button.disabled)add(replan,'p','再計画のread-only接続は未接続です。','kp-muted');
      const feedback=add(replan,'p',session.feedback||'','kp-muted kt-replan-result');feedback.setAttribute('role','status');
      button.addEventListener('click',async()=>{
        if(button.disabled)return;
        const amount=remaining.value===''?null:Number(remaining.value);
        if(amount!==null&&(!Number.isInteger(amount)||amount<1||amount>480)){feedback.textContent='残り時間は1〜480分で入力してください。';return;}
        const request=++session.request;button.disabled=true;feedback.textContent='提案を確認中…';
        try{
          const at=options.tick===false?now:initialNow+Date.now()-session.started;
          const response=await options.requestReplan({change:select.value,work_item_id:result.now_items[0]?.work.id||null,remaining_min:amount,current_time:new Date(at).toISOString(),timezone:'Asia/Tokyo',base_revision:result.proposal_ref});
          if(session.cancelled||request!==session.request)return;
          const allowed=['on_track','delayed','blocked','early_finish','waiting','needs_input','replan_required','done_for_today'];
          if(!allowed.includes(response?.classification)||response?.adopted===true ||
            response?.replan_proposal && (response.replan_proposal.adopted!==false||response.replan_proposal.status!=='proposal') ||
            response?.input_update_proposal && response.input_update_proposal.status!=='proposal')throw Error('INVALID_READ_ONLY_PROPOSAL');
          session.feedback=`${response.classification} · ${response.input_update_proposal?'入力変更の確認が必要です。':response.replan_proposal?'再計画proposalを受け取りました。':'追加の入力を確認してください。'} 未採用・未保存。`;
          feedback.textContent=session.feedback;
        }catch{if(!session.cancelled){session.feedback='再計画を取得できませんでした。元のTask・Planは変更していません。';feedback.textContent=session.feedback;}}
        finally{if(!session.cancelled)button.disabled=false;}
      });
      if(result.warnings.length){const inputs=detail(host,'inputs','入力状況を確認');result.warnings.forEach(w=>add(inputs,'p',w,'kp-muted'));}
      if(options.tick!==false){
        const wait=Math.max(20,Math.min(MINUTE,...result.boundaries.map(t=>t-now+5)));
        session.timer=setTimeout(()=>draw(initialNow+Date.now()-session.started),wait);
      }
    }
    draw(initialNow);
  }
  return {derive,render,dispose,todayInbox,origin,merge,minutes};
});

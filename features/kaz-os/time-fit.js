/* Derived proposals only. Never changes a Work estimate or books a time slot. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.KazWorkTimeFit=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const day=at=>new Date(at+9*3600000).toISOString().slice(0,10);
  const duration=n=>Number.isInteger(n)&&n>0&&n<=1440;
  const domain=(work,snapshot)=>{
    const area=(snapshot.projects||[]).find(p=>p.id===work.project_id)?.area;
    return area==='WORK'?'company':['PERSONAL','FAMILY','PALURU','PHARLINK','CONTENT'].includes(area)?'personal':null;
  };
  function priority(work,now){
    const date=day(now),end=Date.parse(date+'T00:00:00+09:00')+86400000;
    const deadline=Date.parse(work.deadline?.start||''),scheduled=String(work.scheduled?.start||'');
    return [work.state==='DOING'?0:1,work.planning_preference==='today'?0:1,
      Number.isFinite(deadline)&&deadline<end?0:1,scheduled.slice(0,10)===date?0:1,
      ({CRITICAL:0,HIGH:1,MEDIUM:2,LOW:3})[work.priority]??4,
      ({DOING:0,READY:1,SCHEDULED:2,BACKLOG:3})[work.state]??4,
      Number(String(work.work_id||'').match(/\d+$/)?.[0]||Number.MAX_SAFE_INTEGER)];
  }
  function precedes(left,right,now){
    if(!right)return true;
    if(right.placement==='ADOPTED_SCHEDULE')return left.id===right.id;
    const a=priority(left,now),b=priority(right,now);
    for(let i=0;i<a.length;i++){if(a[i]!==b[i])return a[i]<b[i];}
    return left.id===right.id;
  }
  function validateProposal(p){
    const base=['action_origin','estimate_min','first_step','reason'];
    const extra=['estimate_origin','estimate_reason','step_estimate_min','step_kind','step_estimate_origin'];
    if(!p||typeof p!=='object')return false;
    const keys=Object.keys(p).sort().join(',');
    if(![base.sort().join(','),[...base,...extra].sort().join(',')].includes(keys)
      ||typeof p.first_step!=='string'||p.first_step.length>300
      ||!['work_record','ai_generated'].includes(p.action_origin)
      ||typeof p.reason!=='string'||p.reason.length>500
      ||(p.estimate_min!==null&&!duration(p.estimate_min)))return false;
    if(!Object.hasOwn(p,'estimate_origin'))return true;
    return ['work_record','daily_estimate','ai_estimated','unknown'].includes(p.estimate_origin)
      &&(p.estimate_origin==='unknown')===(p.estimate_min===null)
      &&typeof p.estimate_reason==='string'&&p.estimate_reason.length<=240
      &&['recorded_action','substep','generated_action','unknown'].includes(p.step_kind)
      &&['ai_estimated','unknown'].includes(p.step_estimate_origin)
      &&(p.step_estimate_origin==='unknown')===(p.step_estimate_min===null)
      &&(p.step_estimate_min===null||duration(p.step_estimate_min))
      &&(p.step_kind!=='substep'||p.action_origin==='ai_generated'&&duration(p.step_estimate_min)&&p.step_estimate_min<=30)
      &&(p.estimate_min===null||p.step_estimate_min===null||p.step_estimate_min<=p.estimate_min);
  }
  function fit(work,record,snapshot,plan,now){
    const p=record?.recommendation;
    if(!work||!snapshot||!Number.isFinite(now)||!Number.isFinite(Date.parse(record?.as_of))
      ||!validateProposal(p)||!Object.hasOwn(p,'estimate_origin')||typeof record.confidence!=='number'||record.confidence<0.75
      ||!p.first_step.trim()||!p.estimate_reason.trim()||!duration(p.step_estimate_min)
      ||!['recorded_action','substep','generated_action'].includes(p.step_kind)
      ||!['DOING','READY','SCHEDULED'].includes(work.state)
      ||day(Date.parse(record.as_of))!==day(now)||Date.parse(record.as_of)>now)return null;
    const area=domain(work,snapshot);if(!area)return null;
    // Human/Notion estimates win even if an old proposal survived the read.
    if(duration(work.estimate_min)&&(p.estimate_origin!=='work_record'||p.estimate_min!==work.estimate_min))return null;
    if(p.step_kind==='recorded_action'&&p.first_step!==work.next_action)return null;
    if(p.step_kind==='generated_action'&&work.next_action)return null;
    let windows=null;
    const live=plan?.schema_version==='kaz-today-plan-v2'&&plan.planning_date===day(now)
      &&plan.sources?.work_items?.status==='ok'&&plan.sources.work_items.complete===true
      &&Date.parse(plan.sources.work_items.valid_until)>now
      &&plan.sources?.calendar?.status==='ok'&&plan.sources.calendar.complete===true
      &&Date.parse(plan.sources.calendar.valid_until)>now&&plan.sources?.work_busy?.status==='ok';
    if(live)windows=plan.today?.[area==='company'?'company_free_windows':'calendar_free_windows'];
    else if(snapshot.status==='CURRENT'&&day(Date.parse(snapshot.generated_at))===day(now)
      &&['work','today','calendar','work_busy'].every(k=>snapshot.sources?.[k]?.status==='current')
      &&['today','calendar','work_busy'].every(k=>Date.parse(snapshot.sources[k].valid_until)>now))
      windows=snapshot.today?.[area==='company'?'company_free_windows':'kaz_free_windows'];
    if(!Array.isArray(windows))return null;
    const window=windows.find(w=>Date.parse(w.start)<=now&&Date.parse(w.end)-now>=p.step_estimate_min*60000);
    return window?{parent_work_id:work.id,domain:area,start:new Date(now).toISOString(),
      end:new Date(now+p.step_estimate_min*60000).toISOString(),proposal:p}:null;
  }
  return Object.freeze({fit,precedes,validateProposal,domain});
});

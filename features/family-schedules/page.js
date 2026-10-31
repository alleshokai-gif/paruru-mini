(function(root) {
  'use strict';
  const schema='family-schedule.snapshot.v1';
  const tokyoToday=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'});
  function dateWindow(mode,month,today=tokyoToday()) {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(today)||!['7','30','month'].includes(mode))throw Error('INVALID_PERIOD');
    if(mode==='month') {
      if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('INVALID_PERIOD');
      const d=new Date(month+'-01T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+1);d.setUTCDate(0);
      return {from:month+'-01',to:d.toISOString().slice(0,10)};
    }
    const end=new Date(today+'T00:00:00Z');end.setUTCDate(end.getUTCDate()+Number(mode)-1);
    return {from:today,to:end.toISOString().slice(0,10)};
  }
  function windowMonths(window) {
    const periods=[],d=new Date(window.from.slice(0,7)+'-01T00:00:00Z');
    while(d.toISOString().slice(0,7)<=window.to.slice(0,7)){periods.push(d.toISOString().slice(0,7));d.setUTCMonth(d.getUTCMonth()+1);}
    return periods;
  }
  function eventReference(e){return Object.freeze({eventId:e.eventId,sourceId:e.sourceId,revision:e.revision,memberId:e.memberId,organizationId:e.organizationId});}
  function selectEvents(data,filters={}) {
    return data.events.filter(e=>(!filters.memberId||e.memberId===filters.memberId)&&(!filters.organizationId||e.organizationId===filters.organizationId)&&(!filters.from||e.date>=filters.from)&&(!filters.to||e.date<=filters.to))
      .slice().sort((a,b)=>a.date.localeCompare(b.date)||(a.startTime||'99:99').localeCompare(b.startTime||'99:99')||a.eventId.localeCompare(b.eventId));
  }
  root.PALURUFamilySchedules=Object.freeze({selectEvents,eventReference,dateWindow,windowMonths,schemaVersion:schema});
  if(typeof document==='undefined')return;
  if(new URLSearchParams(root.location.search).get('familyScheduleSignage')==='1')document.documentElement.classList.add('family-schedule-signage');
  const panel=document.getElementById('familySchedulePanel'),month=document.getElementById('familyScheduleMonth'),status=document.getElementById('familyScheduleStatus');
  const period=document.getElementById('familySchedulePeriod'),monthControl=document.getElementById('familyScheduleMonthControl');
  const list=document.getElementById('familyScheduleList'),member=document.getElementById('familyScheduleMember'),organization=document.getElementById('familyScheduleOrganization');
  const reload=document.getElementById('familyScheduleReload'),preferenceKey='paluru.familySchedules.period',cache=new Map(),cacheMillis=60000;
  let read,last,sequence=0,loading=false;
  let preferred='';try{preferred=root.localStorage.getItem(preferenceKey)||'';}catch(_){}
  const requested=new URLSearchParams(root.location.search).get('scheduleMonth');
  month.value=/^\d{4}-(0[1-9]|1[0-2])$/.test(requested||preferred)?(requested||preferred):tokyoToday().slice(0,7);
  period.value=requested?'month':'7';
  const make=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;};
  const currentWindow=()=>dateWindow(period.value,month.value);
  const key=()=>JSON.stringify(currentWindow());
  function controls(){monthControl.hidden=period.value!=='month';month.disabled=monthControl.hidden;}
  controls();
  function options(select,values,all){const selected=select.value;select.replaceChildren(new Option(all,''));for(const [id,label]of values)select.add(new Option(label,id));select.value=values.some(([id])=>id===selected)?selected:'';}
  function clear(){list.replaceChildren();options(member,[],'家族全員');options(organization,[],'すべての学校・団体');}
  function render(){
    const orgs=new Map(last.organizations.map(o=>[o.organizationId,o.name]));
    const events=selectEvents(last,{memberId:member.value,organizationId:organization.value,...last.window});
    list.replaceChildren();let day='';
    for(const event of events){
      if(day!==event.date){day=event.date;const heading=make('h2',new Date(day+'T12:00:00+09:00').toLocaleDateString('ja-JP',{timeZone:'Asia/Tokyo',month:'long',day:'numeric',weekday:'short'}));heading.className='family-schedule-day';list.append(heading);}
      const row=make('article');row.className='family-schedule-event';
      row.dataset.eventId=event.eventId;row.dataset.sourceId=event.sourceId;row.dataset.revision=String(event.revision);
      const kind=event.schoolType==='elementary'?'小学校':event.category==='school_event'?'学校':['club_activity','competition','preparation','rest'].includes(event.category)?'部活':'予定';
      const badge=make('span',kind);badge.className='family-schedule-kind';row.append(badge,make('h3',event.title));
      const time=event.timeStatus==='undecided'?'時間未定':event.startTime?`${event.startTime}${event.endTime?'〜'+event.endTime:''}`:event.endTime?`${event.schoolType==='elementary'?'下校 ':''}${event.endTime}`:'時刻の記載なし';
      row.append(make('p',[orgs.get(event.organizationId),time,event.location,event.status==='cancelled'?'中止':event.status==='off'?'休み':'',event.changeNote,event.needsReview?'要確認':''].filter(Boolean).join(' · ')));
      const details=make('details');details.append(make('summary','詳細・更新情報'));
      details.append(make('p',`第${event.revision}版 · 更新 ${new Date(event.updatedAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})}`));
      if(event.reviewReason)details.append(make('p','未確定の情報は原本または変更連絡の確認が必要です。'));
      row.append(details);list.append(row);
    }
    if(!events.length)list.append(make('p',last.missing.length?'取得できていない月があります。全期間を確認できていません。':'この条件の登録予定はありません。'));
    const label={current:'更新済み',stale:'更新期限を過ぎています',updating:'更新処理中・前回データ',unavailable:'一部取得できていません'};
    const warning=last.missing.length?` · 未取得: ${last.missing.join('、')}`:last.unregistered.length?` · 資料未登録: ${last.unregistered.join('、')}`:'';
    status.textContent=`${last.window.from}〜${last.window.to} · ${label[last.freshness]} · ${events.length}件${warning}${last.generatedAt?' · 生成 '+new Date(last.generatedAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'}):''}`;
    panel.dataset.freshness=last.freshness;
  }
  async function load(force=false){
    if(!read)return;
    let window;try{window=currentWindow();}catch(_){return;}
    const current=++sequence,loadKey=JSON.stringify(window),periods=windowMonths(window);loading=true;reload.disabled=true;panel.setAttribute('aria-busy','true');
    last=null;list.replaceChildren();status.textContent='予定を読み込み中…';
    try {
      const results=await Promise.allSettled(periods.map(async p=>{
        const existing=cache.get(p);
        if(!force&&existing&&Date.now()-existing.receivedAt<cacheMillis&&Date.parse(existing.data.validUntil||'')>Date.now()&&existing.data.freshness==='current')return existing.data;
        const data=await read({period:p});
        if(data?.schemaVersion!==schema||data.period!==p||!Array.isArray(data.events)||!Array.isArray(data.organizations)||!Array.isArray(data.sources)||!['current','stale','updating'].includes(data.freshness))throw Error('INVALID_SNAPSHOT');
        if(current===sequence)cache.set(p,{data,receivedAt:Date.now()});return data;
      }));if(current!==sequence)return;
      const forbidden=results.find(r=>r.status==='rejected'&&['FORBIDDEN','UNAUTHENTICATED','INVALID_SNAPSHOT'].includes(r.reason.code||r.reason.message));if(forbidden)throw forbidden.reason;
      const good=results.filter(r=>r.status==='fulfilled').map(r=>r.value),missing=periods.filter((p,i)=>results[i].status==='rejected');
      const orgs=new Map(),events=new Map();good.forEach(d=>{d.organizations.forEach(o=>orgs.set(o.organizationId,o));d.events.forEach(e=>{const old=events.get(e.eventId);if(!old||e.revision>old.revision)events.set(e.eventId,e);});});
      last={key:loadKey,receivedAt:Date.now(),validUntil:good.map(d=>d.validUntil).sort()[0],window,organizations:[...orgs.values()],events:[...events.values()],missing,unregistered:good.filter(d=>!d.sources.length).map(d=>d.period),
        freshness:missing.length?'unavailable':good.some(d=>d.freshness==='updating')?'updating':good.some(d=>d.freshness==='stale')?'stale':'current',
        generatedAt:good.map(d=>d.generatedAt).sort()[0]};
      const labels=new Map(Array.from(document.querySelectorAll('#familyInboxSubjectMember option')).map(o=>[o.value,o.textContent]));
      options(member,[...new Set(last.events.map(e=>e.memberId))].map(id=>[id,labels.get(id)||'家族の予定']),'家族全員');
      options(organization,last.organizations.map(o=>[o.organizationId,o.name]),'すべての学校・団体');render();
    }catch(error){if(current!==sequence)return;clear();panel.dataset.freshness='unavailable';status.textContent='予定を取得できませんでした。再読み込みしてください。';}
    finally{if(current===sequence){loading=false;reload.disabled=false;panel.setAttribute('aria-busy','false');}}
  }
  function remember(){try{root.localStorage.setItem(preferenceKey,month.value);}catch(_){} }
  reload.addEventListener('click',()=>{remember();void load(true);});month.addEventListener('change',()=>{remember();void load();});
  period.addEventListener('change',()=>{controls();void load();});
  member.addEventListener('change',()=>{if(last)render();});organization.addEventListener('change',()=>{if(last)render();});
  document.getElementById('familyScheduleBack').addEventListener('click',()=>document.dispatchEvent(new CustomEvent('paruru:view-request',{detail:{viewName:'home'}})));
  document.addEventListener('paruru:authenticated',event=>{read=event.detail.familyScheduleApi;});
  document.addEventListener('family-schedules:opened',event=>{if(last&&last.key===key()&&Date.now()-last.receivedAt<cacheMillis&&Date.parse(last.validUntil||'')>Date.now()){render();return;}if(!loading)event.detail.waitUntil(load());});
  document.addEventListener('kaz-os:locked',()=>{sequence++;read=null;last=null;cache.clear();loading=false;reload.disabled=false;clear();});
})(globalThis);

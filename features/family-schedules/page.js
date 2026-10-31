(function(root) {
  'use strict';
  const schema='family-schedule.snapshot.v1';
  function eventReference(e){return Object.freeze({eventId:e.eventId,sourceId:e.sourceId,revision:e.revision,memberId:e.memberId,organizationId:e.organizationId});}
  function selectEvents(data,filters={}) {
    return data.events.filter(e=>(!filters.memberId||e.memberId===filters.memberId)&&(!filters.organizationId||e.organizationId===filters.organizationId))
      .slice().sort((a,b)=>a.date.localeCompare(b.date)||(a.startTime||'99:99').localeCompare(b.startTime||'99:99')||a.eventId.localeCompare(b.eventId));
  }
  root.PALURUFamilySchedules=Object.freeze({selectEvents,eventReference,schemaVersion:schema});
  if(typeof document==='undefined')return;
  if(new URLSearchParams(root.location.search).get('familyScheduleSignage')==='1')document.documentElement.classList.add('family-schedule-signage');
  const panel=document.getElementById('familySchedulePanel'),month=document.getElementById('familyScheduleMonth'),status=document.getElementById('familyScheduleStatus');
  const list=document.getElementById('familyScheduleList'),member=document.getElementById('familyScheduleMember'),organization=document.getElementById('familyScheduleOrganization');
  const reload=document.getElementById('familyScheduleReload'),preferenceKey='paluru.familySchedules.period';
  let read,last,sequence=0,loading=false;
  let preferred='';try{preferred=root.localStorage.getItem(preferenceKey)||'';}catch(_){}
  const requested=new URLSearchParams(root.location.search).get('scheduleMonth')||preferred;
  month.value=/^\d{4}-(0[1-9]|1[0-2])$/.test(requested)?requested:new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'}).slice(0,7);
  const make=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;};
  function options(select,values,all){const selected=select.value;select.replaceChildren(new Option(all,''));for(const [id,label]of values)select.add(new Option(label,id));select.value=values.some(([id])=>id===selected)?selected:'';}
  function clear(){list.replaceChildren();options(member,[],'家族全員');options(organization,[],'すべての学校・団体');}
  function render(){
    const orgs=new Map(last.organizations.map(o=>[o.organizationId,o.name]));
    const events=selectEvents(last,{memberId:member.value,organizationId:organization.value});
    list.replaceChildren();let day='';
    for(const event of events){
      if(day!==event.date){day=event.date;const heading=make('h2',new Date(day+'T12:00:00+09:00').toLocaleDateString('ja-JP',{timeZone:'Asia/Tokyo',month:'long',day:'numeric',weekday:'short'}));heading.className='family-schedule-day';list.append(heading);}
      const row=make('article');row.className='family-schedule-event';
      row.dataset.eventId=event.eventId;row.dataset.sourceId=event.sourceId;row.dataset.revision=String(event.revision);
      row.append(make('h3',event.title));
      const time=event.timeStatus==='undecided'?'時間未定':event.startTime?`${event.startTime}${event.endTime?'〜'+event.endTime:''}`:'時刻の記載なし';
      row.append(make('p',[orgs.get(event.organizationId),time,event.location,event.status==='cancelled'?'中止':event.status==='off'?'休み':'',event.changeNote,event.needsReview?'要確認':''].filter(Boolean).join(' · ')));
      const details=make('details');details.append(make('summary','詳細・更新情報'));
      details.append(make('p',`第${event.revision}版 · 更新 ${new Date(event.updatedAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})}`));
      if(event.reviewReason)details.append(make('p','未確定の情報は原本または変更連絡の確認が必要です。'));
      row.append(details);list.append(row);
    }
    if(!events.length)list.append(make('p','この条件の登録予定はありません。'));
    const label={current:'更新済み',stale:'更新期限を過ぎています',updating:'更新処理中・前回データ'};
    status.textContent=`${label[last.freshness]} · ${events.length}件 / 全${last.events.length}件 · 生成 ${new Date(last.generatedAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})}`;
    panel.dataset.freshness=last.freshness;
  }
  async function load(){
    if(!read||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month.value))return;
    const current=++sequence,period=month.value;loading=true;reload.disabled=true;panel.setAttribute('aria-busy','true');
    last=null;list.replaceChildren();status.textContent='予定を読み込み中…';
    try {
      const data=await read({period});if(current!==sequence)return;
      if(data?.schemaVersion!==schema||data.period!==period||!Array.isArray(data.events)||!Array.isArray(data.organizations)||!['current','stale','updating'].includes(data.freshness))throw Error('INVALID_SNAPSHOT');
      last=data;
      const labels=new Map(Array.from(document.querySelectorAll('#familyInboxSubjectMember option')).map(o=>[o.value,o.textContent]));
      options(member,[...new Set(data.events.map(e=>e.memberId))].map(id=>[id,labels.get(id)||'家族の予定']),'家族全員');
      options(organization,data.organizations.map(o=>[o.organizationId,o.name]),'すべての学校・団体');render();
    }catch(error){if(current!==sequence)return;clear();panel.dataset.freshness='unavailable';status.textContent=error.code==='FAMILY_SCHEDULE_NOT_PUBLISHED'?'この月の予定はまだ登録されていません。対象月を選んでください。':'予定を取得できませんでした。再読み込みしてください。';}
    finally{if(current===sequence){loading=false;reload.disabled=false;panel.setAttribute('aria-busy','false');}}
  }
  function remember(){try{root.localStorage.setItem(preferenceKey,month.value);}catch(_){}
  }
  reload.addEventListener('click',()=>{remember();void load();});month.addEventListener('change',()=>{remember();void load();});
  member.addEventListener('change',()=>{if(last)render();});organization.addEventListener('change',()=>{if(last)render();});
  document.getElementById('familyScheduleBack').addEventListener('click',()=>document.dispatchEvent(new CustomEvent('paruru:view-request',{detail:{viewName:'home'}})));
  document.addEventListener('paruru:authenticated',event=>{read=event.detail.familyScheduleApi;});
  document.addEventListener('family-schedules:opened',event=>{if(last&&last.period===month.value){render();return;}if(!loading)event.detail.waitUntil(load());});
  document.addEventListener('kaz-os:locked',()=>{sequence++;read=null;last=null;loading=false;reload.disabled=false;clear();});
})(globalThis);

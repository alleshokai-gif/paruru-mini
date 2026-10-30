(function(root) {
  'use strict';
  const schema = 'family-schedule.snapshot.v1';
  const signage = new URLSearchParams(root.location.search).get('familyScheduleSignage') === '1';
  if (signage) document.documentElement.classList.add('family-schedule-signage');
  let read, sequence = 0;
  const panel = document.getElementById('familySchedulePanel');
  const month = document.getElementById('familyScheduleMonth');
  const status = document.getElementById('familyScheduleStatus');
  const list = document.getElementById('familyScheduleList');
  const target = document.getElementById('familyScheduleMember');
  const today = new Date().toLocaleDateString('sv-SE', {timeZone:'Asia/Tokyo'});
  const preferenceKey='paluru.familySchedules.period';
  let preferred='';try {preferred=root.localStorage.getItem(preferenceKey)||'';}catch(_){}
  const requested=new URLSearchParams(root.location.search).get('scheduleMonth')||preferred;
  month.value = /^\d{4}-(0[1-9]|1[0-2])$/.test(requested) ? requested : today.slice(0,7);
  function clear() { list.replaceChildren(); target.replaceChildren(new Option('家族全員','')); }
  function render(data) {
    if (data?.schemaVersion !== schema || !Array.isArray(data.events)
        || !['current','stale','updating'].includes(data.freshness)) throw Error('INVALID_SNAPSHOT');
    const selected = target.value;
    clear();
    const labels = new Map(Array.from(document.querySelectorAll('#familyInboxSubjectMember option')).map(o=>[o.value,o.textContent]));
    for (const id of new Set(data.events.map(e=>e.memberId))) {
      target.add(new Option(labels.get(id) || (data.events.every(e=>e.memberId===id) ? 'この予定の対象者' : '家族の予定'),id));
    }
    target.value = Array.from(target.options).some(o=>o.value===selected) ? selected : '';
    const organizations = new Map(data.organizations.map(o=>[o.organizationId,o.name]));
    const filtered = data.events.filter(e=>!target.value || e.memberId===target.value);
    const sorted = filtered.slice().sort((a,b)=>a.date.localeCompare(b.date)||(a.startTime||'99:99').localeCompare(b.startTime||'99:99')||a.eventId.localeCompare(b.eventId));
    for (const event of sorted) {
      const row=document.createElement('article');row.className='family-schedule-event';
      const heading=document.createElement('h3');
      heading.textContent=`${Number(event.date.slice(5,7))}/${Number(event.date.slice(8))} ${event.title}`;
      const detail=document.createElement('p');
      const time=event.timeStatus==='undecided'?'時間未定':event.startTime?`${event.startTime}${event.endTime?'〜'+event.endTime:''}`:'時刻の記載なし';
      detail.textContent=[organizations.get(event.organizationId),time,event.location,event.status==='cancelled'?'中止':event.status==='off'?'休み':'',event.changeNote,event.needsReview?'会場など要確認':''].filter(Boolean).join(' · ');
      row.append(heading,detail);list.append(row);
    }
    if (!sorted.length) list.textContent='この条件の登録予定はありません。';
    const freshness={current:'更新済み',stale:'更新期限を過ぎています',updating:'更新処理中・前回データ'};
    status.textContent=`${freshness[data.freshness]} · ${data.events.length}件 · 生成 ${new Date(data.generatedAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})}`;
    panel.dataset.freshness=data.freshness;
  }
  let last;
  async function load() {
    if (!read) return;
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month.value)){status.textContent='対象月を選んでください。';return;}
    try {root.localStorage.setItem(preferenceKey,month.value);}catch(_){}
    const current=++sequence;status.textContent='予定を読み込み中…';
    try {const data=await read({period:month.value});if(current!==sequence)return;last=data;render(data);}
    catch (error) {if(current!==sequence)return;last=null;clear();panel.dataset.freshness='unavailable';status.textContent=error.code==='FAMILY_SCHEDULE_NOT_PUBLISHED'?'この月の予定はまだ登録されていません。対象月を選んでください。':'予定を取得できませんでした。再読み込みしてください。';}
  }
  document.getElementById('familyScheduleReload').addEventListener('click',load);
  month.addEventListener('change',load);
  target.addEventListener('change',()=>{if(last)render(last);});
  document.addEventListener('paruru:authenticated', event=>{
    read=event.detail.familyScheduleApi;
    panel.hidden=!['admin','guardian','self_record'].includes(event.detail.context.role);
    if(signage && !panel.hidden)void load();
  });
  document.addEventListener('kaz-os:locked',()=>{sequence++;read=null;last=null;clear();panel.hidden=true;});
})(globalThis);

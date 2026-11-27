// Pure routine rules. All labels/instructions come from an authorized caregiver.
const MEDICATION_SLOTS_ = Object.freeze(['morning', 'evening']);
const MEDICATION_TIMER_LIMITS_ = Object.freeze({sublingualSeconds:3600, foodDrinkMinutes:1440, observationMinutes:1440, exerciseBathMinutes:1440});
function medicationError_(code) { const error=new Error(code); error.code=code; return error; }
function medicationAssert_(condition,code) { if(!condition)throw medicationError_(code||'INVALID_INPUT'); }
function medicationObject_(value,keys) {
  medicationAssert_(value && typeof value==='object' && !Array.isArray(value));
  medicationAssert_(Object.keys(value).every(function(key){return keys.indexOf(key)>=0;}));
  return value;
}
function medicationText_(value,max,required) {
  medicationAssert_(typeof value==='string' && value.length<=max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value));
  medicationAssert_(!required || value.trim().length>0);
  return value.trim();
}
function medicationDate_(value) {
  medicationAssert_(typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value));
  const parts=value.split('-').map(Number),date=new Date(Date.UTC(parts[0],parts[1]-1,parts[2]));
  medicationAssert_(date.getUTCFullYear()===parts[0]&&date.getUTCMonth()===parts[1]-1&&date.getUTCDate()===parts[2]);
  return value;
}
function medicationInstant_(value) {
  medicationAssert_(typeof value==='string');
  const match=/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  medicationAssert_(match); medicationDate_(match[1]);
  medicationAssert_(Number(match[2])<24&&Number(match[3])<60&&Number(match[4])<60);
  if(match[6]!=='Z')medicationAssert_(Number(match[8])<=14&&Number(match[9])<60&&(Number(match[8])!==14||Number(match[9])===0));
  const result=new Date(value); medicationAssert_(Number.isFinite(result.getTime())); return result;
}
function medicationLocalDate_(value) { return new Date(medicationInstant_(value).getTime()+9*3600000).toISOString().slice(0,10); }
function medicationUuid_(value) { return typeof value==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value); }
function medicationTime_(value) { medicationAssert_(value===''||typeof value==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(value)); return value; }
function medicationPlan_(input,previous) {
  medicationObject_(input,['label','doseText','startDate','enabled','times','weekdayOverrides','timers','futureChange','reminders']);
  const old=previous||{},pick=function(key,fallback){return input[key]===undefined?(old[key]===undefined?fallback:old[key]):input[key];};
  const plan={label:medicationText_(pick('label',''),80,true),doseText:medicationText_(pick('doseText',''),160,false),
    startDate:medicationDate_(pick('startDate','')),enabled:pick('enabled',false),times:{},weekdayOverrides:{},timers:{}};
  medicationAssert_(typeof plan.enabled==='boolean');
  const times=medicationObject_(pick('times',{}),MEDICATION_SLOTS_);
  MEDICATION_SLOTS_.forEach(function(slot){plan.times[slot]=medicationTime_(times[slot]===undefined?'':times[slot]);});
  const overrides=medicationObject_(pick('weekdayOverrides',{}),['0','1','2','3','4','5','6']);
  Object.keys(overrides).forEach(function(day){const value=medicationObject_(overrides[day],MEDICATION_SLOTS_);plan.weekdayOverrides[day]={};Object.keys(value).forEach(function(slot){plan.weekdayOverrides[day][slot]=medicationTime_(value[slot]);});});
  const timers=medicationObject_(pick('timers',{}),Object.keys(MEDICATION_TIMER_LIMITS_));
  Object.keys(MEDICATION_TIMER_LIMITS_).forEach(function(key){const value=timers[key]===undefined?0:timers[key];medicationAssert_(Number.isInteger(value)&&value>=0&&value<=MEDICATION_TIMER_LIMITS_[key]);plan.timers[key]=value;});
  const future=medicationObject_(pick('futureChange',{date:'',note:''}),['date','note']);
  plan.futureChange={date:future.date?medicationDate_(future.date):'',note:medicationText_(future.note||'',200,false)};
  const reminders=medicationObject_(pick('reminders',{enabled:false,repeatMinutes:0}),['enabled','repeatMinutes']);
  medicationAssert_(typeof reminders.enabled==='boolean'&&Number.isInteger(reminders.repeatMinutes)&&
    (reminders.repeatMinutes===0||reminders.repeatMinutes>=5&&reminders.repeatMinutes<=1440));
  plan.reminders={enabled:reminders.enabled,repeatMinutes:reminders.repeatMinutes};
  return plan;
}
function medicationTimers_(plan,event,now) {
  if(!event||event.status!=='completed')return [];
  const actual=medicationInstant_(event.occurredAt).getTime(),clock=medicationInstant_(now).getTime();
  return Object.keys(plan.timers).filter(function(key){return plan.timers[key]>0;}).map(function(key){
    const end=actual+plan.timers[key]*(key==='sublingualSeconds'?1000:60000);
    return {kind:key,endsAt:new Date(end).toISOString(),active:clock<end,remainingSeconds:Math.max(0,Math.ceil((end-clock)/1000))};
  });
}
function medicationOccurrences_(versions,events,localDate,now) {
  medicationDate_(localDate); const clock=medicationInstant_(now).getTime();
  const dayEnd=new Date(localDate+'T23:59:59.999+09:00').getTime(),byPlan={},pinned={},latest={};
  versions.forEach(function(row){
    const key=row.planId+':'+row.revision;
    medicationAssert_(!pinned[key],'DATA_INTEGRITY_ERROR'); pinned[key]=row;
    if(medicationInstant_(row.recordedAt).getTime()<=Math.min(clock,dayEnd)&&(!byPlan[row.planId]||byPlan[row.planId].revision<row.revision))byPlan[row.planId]=row;
  });
  events.filter(function(event){return event.localDate===localDate;}).forEach(function(event){
    const key=event.planId+':'+event.slot,prior=latest[key];
    medicationAssert_(event.expectedEventId===(prior?prior.eventId:''),'DATA_INTEGRITY_ERROR');
    medicationAssert_(pinned[event.planId+':'+event.planRevision],'DATA_INTEGRITY_ERROR');
    latest[key]=event;
  });
  const ids=Array.from(new Set(Object.keys(byPlan).concat(Object.keys(latest).map(function(key){return key.split(':')[0];})))),out=[];
  ids.forEach(function(id){MEDICATION_SLOTS_.forEach(function(slot){
    const event=latest[id+':'+slot],current=byPlan[id],row=event?pinned[id+':'+event.planRevision]:current;
    if(!row)return;
    const plan=row.plan,day=String(new Date(localDate+'T12:00:00+09:00').getUTCDay());
    const override=plan.weekdayOverrides[day]||{},time=Object.prototype.hasOwnProperty.call(override,slot)?override[slot]:plan.times[slot];
    if(!event&&(!plan.enabled||plan.startDate>localDate||!time))return;
    out.push({planId:id,planRevision:row.revision,localDate:localDate,slot:slot,label:plan.label,doseText:plan.doseText,
      scheduledAt:time?localDate+'T'+time+':00+09:00':'',status:event?event.status:'unrecorded',
      eventId:event?event.eventId:'',occurredAt:event?event.occurredAt:'',recordedAt:event?event.recordedAt:'',
      timers:medicationTimers_(plan,event,now),remindersEnabled:Boolean(current&&current.plan.enabled&&current.plan.reminders.enabled),
      repeatMinutes:current?current.plan.reminders.repeatMinutes:0});
  });});
  return out;
}
function medicationDueReminders_(occurrences,now,delivered) {
  // Pure private-adapter projection only. Never connected to public/TTS delivery.
  const clock=medicationInstant_(now).getTime(),receipts=delivered||{};
  return occurrences.filter(function(item){return item.status==='unrecorded'&&item.remindersEnabled&&item.scheduledAt;}).map(function(item){
    const key=item.planId+':'+item.localDate+':'+item.slot,due=medicationInstant_(item.scheduledAt).getTime();
    if(item.localDate!==medicationLocalDate_(now)||clock<due)return null;
    const prior=receipts[key],next=prior&&item.repeatMinutes?medicationInstant_(prior).getTime()+item.repeatMinutes*60000:due;
    if(prior&&!item.repeatMinutes||clock<next||clock-next>5*60000)return null;
    return {key:key,scheduledAt:new Date(next).toISOString(),message:'ルーティンの記録をご確認ください。医師の指示を優先してください。'};
  }).filter(Boolean);
}

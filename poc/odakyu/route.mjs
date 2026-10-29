import {clock,minutes,POLICY} from './core.mjs';
import {planNavigation} from './navigation.mjs';
import {renderRouteMap} from './mobile-route.mjs';
import {japanServiceTime} from './simulation-time.mjs';
import {tapTrain} from './downbound-board.mjs';
const root=document.getElementById('rail'),time=document.getElementById('time');
const play=document.getElementById('play'),advance=document.getElementById('advance');
const PLAY_MS_PER_MINUTE=2000,SERVICE_END=24*60+POLICY.serviceDayBoundary-1;
let timer=null;
const initial=japanServiceTime(new Date());
time.value=clock(initial.minute);
let model,pool=[],selectedId=null,candidateId=null,now=initial.minute,error=false,timeEdited=false,timeValid=true;
function render() {
  play.disabled=advance.disabled=!model||!pool.length||!timeValid||now>=SERVICE_END;
  if(!timeValid){root.replaceChildren();root.textContent='時刻未入力';return;}
  const selected=pool.find(t=>t.id===selectedId);
  const candidate=pool.find(t=>t.id===candidateId);
  const plans=selected?['Noborito','MukogaokaYuen'].map(destination=>({destination,...planNavigation(pool,selected.id,destination,now,candidate?{candidateId:candidate.id}:{})})):[];
  renderRouteMap({root,model,pool,selected,candidate,now,plans,error,onSelect:id=>{
    ({selectedId,candidateId}=tapTrain({selectedId,candidateId},id));render();
  }});
}
render();
function pause() {if(timer!==null)clearInterval(timer);timer=null;play.textContent='▶';play.setAttribute('aria-pressed','false');play.setAttribute('aria-label','定刻再生');}
function step() {
  if(!model||!timeValid||now>=SERVICE_END){pause();return;}
  now++;timeEdited=true;time.value=clock(now);render();
  if(now>=SERVICE_END)pause();
}
advance.onclick=()=>{pause();step();};
play.onclick=()=>{
  if(timer!==null){pause();return;}
  if(!model||!timeValid||now>=SERVICE_END)return;
  play.textContent='Ⅱ';play.setAttribute('aria-label','再生を一時停止');play.setAttribute('aria-pressed','true');
  timer=setInterval(step,PLAY_MS_PER_MINUTE);
};
document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
window.addEventListener('pagehide',pause);
time.oninput=time.onchange=()=>{
  pause();
  timeEdited=true;
  try{const value=minutes(time.value);if(!Number.isInteger(value))throw Error('TIME_INVALID');now=value;timeValid=true;render();}
  catch{timeValid=false;render();}
};
window.addEventListener('resize',render);
try {
  const response=await fetch('/api/model?dataset=real',{cache:'no-store'});
  if(!response.ok)throw Error(`HTTP_${response.status}`);
  const incoming=await response.json();
  if(incoming.dataset?.kind!=='real'||!Array.isArray(incoming.trips)||!incoming.trips.length)throw Error('REAL_DATA_REQUIRED');
  model=incoming;
  const current=japanServiceTime(new Date(),model.calendarCoverage);
  pool=model.trips.filter(t=>current.calendar&&t.calendar===current.calendar);
  // Show active saved trains at the Japanese clock time; only a tap identifies
  // the rider's selection. Loading must never overwrite an edited time.
  if(!timeEdited){now=current.minute;time.value=clock(now);}
  const dates=[...new Set(pool.map(t=>t.sourceServiceDate).filter(Boolean))];
  const quality=document.getElementById('quality');
  const label=current.calendar==='Weekday'?'平日':'土休日';
  quality.textContent=current.calendar?`${dates.length===1?dates[0].slice(5).replace('-','/')+'保存':'保存'} ${label}~・線路推定`:'暦未対応';
  quality.title=`表示営業日 ${current.serviceDate} / 保存対象日 ${dates.join('・')||'未取得'} / 現行ダイヤへの適用未確認・実運行ではない`;
  root.dataset.serviceDate=current.serviceDate;root.dataset.calendar=current.calendar||'unknown';
  render();
} catch(e) {model=undefined;pool=[];selectedId=candidateId=null;error=true;console.error(e.message);render();}

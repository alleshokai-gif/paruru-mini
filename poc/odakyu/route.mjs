import {clock,minutes,POLICY} from './core.mjs';
import {renderRouteMap} from './mobile-route.mjs';
import {japanServiceTime} from './simulation-time.mjs';
import {compareAll,upcomingDepartures,pathsForTrain} from './comparisons.mjs';
const root=document.getElementById('rail'),time=document.getElementById('time');
const play=document.getElementById('play'),advance=document.getElementById('advance');
const PLAY_MS_PER_MINUTE=2000,SERVICE_END=24*60+POLICY.serviceDayBoundary-1,BUS_POLL_MS=30000;
const initial=japanServiceTime(new Date());time.value=clock(initial.minute);
let timer=null,model,pool=[],selectedId=null,selectedOrigin=null,activeKey=null,comparisonRequested=false,now=initial.minute,error=false,timeEdited=false,timeValid=true,busSnapshot=null,busRequest=0;
function render(){
  play.disabled=advance.disabled=!model||!pool.length||!timeValid||now>=SERVICE_END;
  if(!timeValid){root.replaceChildren();root.textContent='時刻未入力';return;}
  const originChoices=model?upcomingDepartures(model,pool,now):[];
  const selected=pool.find(t=>t.id===selectedId)||selectedOrigin;
  const comparison=compareAll(pool,selected,now);
  let activeRoute=comparison.routes.find(r=>r.key===activeKey);
  if(!activeRoute){
    const rec=comparison.plans.find(p=>p.destination==='Noborito')?.recommendation;
    activeRoute=rec?.transfers>0?comparison.routes.find(r=>!r.originWait&&r.legs.length===rec.legs.length&&r.legs.every((l,i)=>l.trainId===rec.legs[i].trainId&&l.station===rec.legs[i].station&&l.departure===rec.legs[i].departure)):null;
    activeKey=activeRoute?.key??null;
  }
  root.dataset.routeCount=String(comparison.routes.length);
  renderRouteMap({root,model,pool,selected,now,comparison,activeRoute,comparisonRequested,originChoices,busSnapshot,error,onSelect:(id,event={})=>{
    if(id===selectedId){selectedId=null;selectedOrigin=null;activeKey=null;comparisonRequested=false;}
    else if(selectedId){
      const paths=pathsForTrain(comparison.routes,id,event,activeRoute);
      if(!paths.length)return;const wasComparing=comparisonRequested;comparisonRequested=true;
      const i=wasComparing?paths.findIndex(r=>r.key===activeKey):-1;activeKey=paths[(i+1)%paths.length].key;
    }else{
      const t=pool.find(t=>t.id===id)||originChoices.find(t=>t.id===id);if(!t)return;
      selectedId=id;selectedOrigin=t.identityBasis==='station_departure'?t:null;activeKey=null;comparisonRequested=false;
    }
    render();
  }});
}
async function refreshBuses(){
  if(!model||!timeValid)return;
  const version=++busRequest,minute=now,date=root.dataset.serviceDate;
  if(busSnapshot?.serviceDate!==date||busSnapshot?.minute!==minute){busSnapshot=null;render();}
  try{
    const response=await fetch(`/api/home-buses?date=${encodeURIComponent(date)}&minute=${minute}`,{cache:'no-store'});
    if(!response.ok)throw Error('BUS_UNAVAILABLE');const data=await response.json();
    if(data.serviceDate!==date||data.minute!==minute||!Array.isArray(data.buses)||!Array.isArray(data.places)||!Number.isFinite(data.fetchedAt)||!Array.isArray(data.unavailableSources))throw Error('BUS_RESPONSE_INVALID');
    if(version===busRequest){busSnapshot=data;render();}
  }catch{if(version===busRequest){busSnapshot={error:true};render();}}
}
render();
function pause(){if(timer!==null)clearInterval(timer);timer=null;play.textContent='▶';play.setAttribute('aria-pressed','false');play.setAttribute('aria-label','定刻再生');}
function step(){if(!model||!timeValid||now>=SERVICE_END){pause();return;}now++;timeEdited=true;time.value=clock(now);render();refreshBuses();if(now>=SERVICE_END)pause();}
advance.onclick=()=>{pause();step();};
play.onclick=()=>{if(timer!==null){pause();return;}if(!model||!timeValid||now>=SERVICE_END)return;play.textContent='Ⅱ';play.setAttribute('aria-label','再生を一時停止');play.setAttribute('aria-pressed','true');timer=setInterval(step,PLAY_MS_PER_MINUTE);};
document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});window.addEventListener('pagehide',pause);
time.oninput=time.onchange=()=>{pause();timeEdited=true;try{const v=minutes(time.value);if(!Number.isInteger(v))throw Error('TIME_INVALID');now=v;timeValid=true;render();refreshBuses();}catch{timeValid=false;busRequest++;busSnapshot=null;render();}};
window.addEventListener('resize',render);
try{
  const r=await fetch('/api/model?dataset=real',{cache:'no-store'});if(!r.ok)throw Error('DATA_UNAVAILABLE');
  const incoming=await r.json();if(incoming.dataset?.kind!=='real'||!Array.isArray(incoming.trips)||!incoming.trips.length)throw Error('REAL_DATA_REQUIRED');model=incoming;
  const current=japanServiceTime(new Date(),model.calendarCoverage);pool=model.trips.filter(t=>current.calendar&&t.calendar===current.calendar);
  if(!timeEdited){now=current.minute;time.value=clock(now);}
  const dates=[...new Set(pool.map(t=>t.sourceServiceDate).filter(Boolean))];
  const quality=document.getElementById('quality');quality.textContent=current.calendar?`${dates.length===1?dates[0].slice(5).replace('-','/')+'保存':'保存'} ${current.calendar==='Weekday'?'平日':'土休日'}~・線路推定`:'暦未対応';
  quality.title=`表示営業日 ${current.serviceDate} / 保存対象日 ${dates.join('・')||'未取得'} / 現行ダイヤへの適用未確認・実運行ではない / バス: 川崎市交通局・東急バス / ODPT`;
  root.dataset.serviceDate=current.serviceDate;root.dataset.calendar=current.calendar||'unknown';render();refreshBuses();
  setInterval(()=>{if(!document.hidden)refreshBuses();},BUS_POLL_MS);
}catch(e){model=undefined;pool=[];selectedId=selectedOrigin=null;error=true;console.error(e.message);render();}

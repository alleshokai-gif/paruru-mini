import {clock,minutes} from './core.mjs';
import {planNavigation} from './navigation.mjs';
import {renderRouteMap} from './mobile-route.mjs';
const root=document.getElementById('rail'),time=document.getElementById('time');
const play=document.getElementById('play'),advance=document.getElementById('advance');
const PLAY_MS_PER_MINUTE=2000,SERVICE_END=27*60-1;
let timer=null;
let model,pool=[],selectedId=null,now=minutes(time.value),error=false,timeEdited=false,timeValid=true;
function render() {
  play.disabled=advance.disabled=!model||!timeValid||now>=SERVICE_END;
  if(!timeValid){root.replaceChildren();root.textContent='時刻未入力';return;}
  const selected=pool.find(t=>t.id===selectedId);
  const plans=selected?['Noborito','MukogaokaYuen'].map(destination=>({destination,...planNavigation(pool,selected.id,destination,now)})):[];
  renderRouteMap({root,model,pool,selected,now,plans,error,onSelect:id=>{selectedId=id;render();}});
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
time.onchange=()=>{
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
  model=incoming;pool=model.trips.filter(t=>t.calendar==='Weekday');
  // Reuse the existing real-data replay selection; never infer the user's train.
  selectedId=pool.some(t=>t.id===model.example?.selectedId)?model.example.selectedId:null;
  if(!timeEdited&&Number.isInteger(model.example?.compareAt)){
    const first=pool.find(t=>t.id===selectedId)?.stops[0];
    // Begin at the saved example's actual departure event, never put a future
    // train on a track merely to make the selection visible.
    now=Math.max(model.example.compareAt,first?.departure??model.example.compareAt);time.value=clock(now);
  }
  document.getElementById('quality').title=[...new Set(pool.map(t=>t.sourceServiceDate))].join('・');
  render();
} catch(e) {model=undefined;pool=[];selectedId=null;error=true;console.error(e.message);render();}

import {clock,minutes} from './core.mjs';
import {planNavigation} from './navigation.mjs';
import {renderRouteMap} from './mobile-route.mjs';
const root=document.getElementById('rail'),time=document.getElementById('time');
let model,pool=[],selectedId=null,now=minutes(time.value),error=false,timeEdited=false,timeValid=true;
function render() {
  if(!timeValid){root.replaceChildren();root.textContent='時刻未入力';return;}
  const selected=pool.find(t=>t.id===selectedId);
  const plans=selected?['Noborito','MukogaokaYuen'].map(destination=>({destination,...planNavigation(pool,selected.id,destination,now)})):[];
  renderRouteMap({root,model,pool,selected,now,plans,error,onSelect:id=>{selectedId=id;render();}});
}
render();
time.onchange=()=>{
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
  if(!timeEdited&&Number.isInteger(model.example?.compareAt)){now=model.example.compareAt;time.value=clock(now);}
  document.getElementById('quality').title=[...new Set(pool.map(t=>t.sourceServiceDate))].join('・');
  render();
} catch(e) {model=undefined;pool=[];selectedId=null;error=true;console.error(e.message);render();}

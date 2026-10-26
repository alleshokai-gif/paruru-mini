import {BUILD,TYPES,minutes,clock,hypotheses,position,compare} from './core.mjs';
const $=id=>document.getElementById(id);let model,trains,manifest,loadVersion=0;
const name=id=>model.stations.find(s=>s.id===id)?.name||id;
function el(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
function option(value,text){const n=el('option',text);n.value=value;return n;}
function trainLabel(t){return `${clock(t.stops[0].time)} ${name(t.origin)} ${TYPES[t.type]} ${t.destination}行`}
async function get(url){const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw Error(`読み込み失敗 (${r.status})`);return r.json();}
async function load(){const version=++loadVersion;const loaded=await get(`/api/model?snapshot=${encodeURIComponent($('snapshot').value)}`);if(version!==loadVersion)return;model=loaded;trains=hypotheses(model,$('calendar').value);setTrains();render();}
function setTrains(){const previous=$('train').value;const now=minutes($('time').value);const available=trains.filter(t=>t.stops[0].time>=now-55&&t.stops[0].time<=now+15);$('train').replaceChildren(...available.map(t=>option(t.id,trainLabel(t))));if(available.some(t=>t.id===previous))$('train').value=previous;else{const active=available.find(t=>t.type==='Local'&&position(t,now));if(active)$('train').value=active.id;}}
function render(){
 const now=minutes($('time').value),selected=trains.find(t=>t.id===$('train').value);$('result').className='';
 if(!selected){$('result').replaceChildren(el('p','この時刻帯に選べる列車がありません。再生時刻を変更してください。'));$('diagram').replaceChildren();$('evidence').replaceChildren();return;}
 const result=compare(trains,selected.id,$('destination').value,now,Number($('buffer').value));
 const best=result.best;const content=[el('p','時刻表の参考比較', 'result-title')];
 if(best&&best.saving>0){content.push(el('div',`発時刻の差 ${best.saving}分`,'big'),el('p',`${name(best.station)}で乗換の候補`),el('p','到着短縮・接続可否は未確定。乗換推奨は出していません。'));}
 else content.push(el('div','先着を確定できません','big'),el('p',best?'目的駅の発時刻では、乗換による改善候補はありません。':'比較に必要な同一便・目的駅の発時刻をつなげられません。'));
 const grid=el('div',undefined,'grid');for(const [label,time]of[['そのまま：目的駅発',result.baselineDeparture],['乗換候補：目的駅発',best?.destinationDeparture]]){const box=el('div',undefined,'metric');box.append(el('small',label),el('strong',clock(time)));grid.append(box);}content.push(grid);
 if(best)content.push(el('p',`乗換 ${best.legs.length}回 / 乗換候補 ${clock(best.connectionTime)}発 ${TYPES[trains.find(t=>t.id===best.trainId).type]} ${trains.find(t=>t.id===best.trainId).destination}行 / 発時刻差 ${best.scheduledGap}分 / 必要余裕 ${best.minimumTransfer}分（設定値）`,'muted'));
 if(best?.legs.length>1)content.push(el('p',best.legs.map(leg=>`${name(leg.station)} ${clock(leg.connectionTime)}発 ${TYPES[trains.find(t=>t.id===leg.trainId).type]}`).join(' → ')));
 $('result').replaceChildren(...content);
 const diagram=$('diagram');diagram.replaceChildren();
 for(const station of model.stations){const beyond=station.index>model.stations.find(x=>x.id==='Noborito').index;const row=el('div',undefined,`station${beyond?' beyond':''}${best?.saving>0&&best.legs.some(leg=>leg.station===station.id)?' transfer':''}`);const label=el('div',station.name,'station-name');const stop=selected.stops.find(s=>s.station===station.id);label.append(el('small',stop?`${clock(stop.time)} 発${beyond?' / 線路構成未取得':''}`:'発時刻の結合なし'));row.append(label,el('div',undefined,'track'),el('div',undefined,'track'));diagram.append(row);}
 let active=trains.map(t=>({t,p:position(t,now)})).filter(x=>x.p);active.sort((a,b)=>a.p.index-b.p.index);
 const occupancy=new Map();
 for(const {t,p}of active){const unassigned=p.from==='Noborito';const fast=!unassigned&&['Express','RapidExpress'].includes(t.type);const marker=el('div',`${t.id===selected.id?'★ 自分 ':''}🚆 ${TYPES[t.type]}\n${t.destination}行`,`${t.type} marker${unassigned?' unassigned':''}${fast?' fast':''}${t.id===selected.id?' selected':''}${Object.values(result.neighbours).includes(t.id)?' near':''}`);marker.style.whiteSpace='pre-line';const key=`${fast}:${Math.floor(p.index)}`;const offset=occupancy.get(key)||0;occupancy.set(key,offset+1);marker.style.top=`${p.index*92+24+offset*27}px`;marker.title=`${trainLabel(t)} / ${name(p.from)}〜${name(p.to)}（補間推定）`;diagram.append(marker);}
 const ev=[el('p',`選択：${trainLabel(selected)}`),el('p','列車ID：未取得。千代田線直通：未確定（代々木上原発の列車も表示。新宿発との未結合だけでは直通と断定しません）。')];const list=el('ul');for(const reason of result.reasons)list.append(el('li',reason));ev.push(list);
 if(selected.unresolved)ev.push(el('p',`結合打切り：${name(selected.unresolved.station)} / ${selected.unresolved.reason} / 候補 ${selected.unresolved.candidates??'不明'}`));
 ev.push(el('p',`前方・後方：${result.neighbours.ahead?'前方候補あり':'前方不明'} / ${result.neighbours.behind?'後方候補あり':'後方不明'}（位置は推定）`));
 if(best?.overtakes.length)ev.push(el('p',best.overtakes.map(o=>`${name(o.from)}〜${name(o.to)}：発時刻の順序逆転（追越し仮説）`).join(' / ')));
 const table=el('table');const head=el('tr');for(const h of ['駅','発時刻','出典更新'])head.append(el('th',h));table.append(head);for(const s of selected.stops){const r=el('tr');for(const cell of[name(s.station),clock(s.time),s.sourceUpdatedAt?.slice(0,10)||'不明'])r.append(el('td',cell));table.append(r);}ev.push(table);$('evidence').replaceChildren(...ev);
 $('source').textContent=`${model.source} / 取得 ${new Date(model.fetchedAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})} JST / ${model.departures.length.toLocaleString()}発時刻。保存データの静的再生であり、現在の運行状態ではありません。`;
 $('build').textContent=`Build ${BUILD}`;
}
function safe(action){return async()=>{try{await action();}catch(e){$('result').className='error';$('result').replaceChildren(el('p',e.message));$('diagram').replaceChildren();$('evidence').replaceChildren();}};}
$('snapshot').addEventListener('change',safe(load));$('calendar').addEventListener('change',safe(()=>{trains=hypotheses(model,$('calendar').value);setTrains();render();}));$('time').addEventListener('change',safe(()=>{setTrains();render();}));for(const id of['train','destination','buffer'])$(id).addEventListener('change',safe(render));
$('example').addEventListener('click',safe(()=>{$('calendar').value='Weekday';$('time').value='08:15';$('destination').value='Noborito';$('buffer').value='3';trains=hypotheses(model,'Weekday');setTrains();const t=trains.find(t=>t.origin==='Shinjuku'&&t.type==='Local'&&t.stops[0].time===minutes('08:09'));if(!t)throw Error('この保存データに比較例はありません');$('train').value=t.id;render();}));
await safe(async()=>{manifest=await get('/api/snapshots');$('snapshot').replaceChildren(...manifest.map(s=>option(s.id,`${new Date(s.fetchedAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})} JST`)));await load();})();

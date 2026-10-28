import { TYPES, clock } from './core.mjs';
import { scheduledPosition, arrivalOrderReversals } from './navigation.mjs';
import { boardLayout, boardTracks, boardPosition } from './track-board.mjs';
const TARGETS=['Noborito','MukogaokaYuen'];
const departure=t=>t.stops[0].departure??t.stops[0].arrival;
const type=t=>t.type==='Local'?'各停':TYPES[t.type];
const arrival=(t,id)=>t.stops.find(s=>s.station===id&&s.stop)?.arrival;
const order=(a,b)=>departure(a)-departure(b)||a.id.localeCompare(b.id);
function el(tag,text,cls,parent) {
  const n=document.createElement(tag); if(text!==undefined)n.textContent=text;
  if(cls)n.className=cls; parent?.append(n); return n;
}
function at(n,top,left) {n.style.top=`${top}px`;if(left!==undefined)n.style.left=`${left}px`;return n;}
function svg(tag,attrs,parent) {
  const n=document.createElementNS('http://www.w3.org/2000/svg',tag);
  for(const [key,value] of Object.entries(attrs))n.setAttribute(key,String(value));
  parent?.append(n);return n;
}
export function mobileNeighbors(pool,selected,now) {
  const point=scheduledPosition(selected,now);
  const queue=pool.filter(t=>t.stops[0].station===selected.stops[0].station).sort(order);
  const i=queue.findIndex(t=>t.id===selected.id);
  if(point) {
    const others=pool.filter(t=>t.id!==selected.id).map(train=>({train,point:scheduledPosition(train,now)})).filter(t=>t.point);
    const closest=side=>others.filter(t=>side*(t.point.index-point.index)>0)
      .sort((a,b)=>Math.abs(a.point.index-point.index)-Math.abs(b.point.index-point.index)||order(a.train,b.train))[0]?.train;
    const front=closest(1),rear=closest(-1);
    return {before:front||(queue[i-1]?.id!==rear?.id?queue[i-1]:undefined),after:rear||(queue[i+1]?.id!==front?.id?queue[i+1]:undefined)};
  }
  return {before:queue[i-1],after:queue[i+1]};
}
function freeTop(preferred,height,blocked) {
  const candidates=[preferred,...blocked.flatMap(b=>[b.bottom+8,b.top-height-8])];
  return candidates.filter(y=>y>=0&&blocked.every(b=>y+height+4<=b.top||y>=b.bottom+4))
    .sort((a,b)=>Math.abs(a-preferred)-Math.abs(b-preferred))[0]??preferred;
}
function drawTracks(map,layout,width) {
  const drawing=svg('svg',{class:'b-wiring',viewBox:`0 0 ${width} ${layout.height}`,preserveAspectRatio:'none',role:'img',
    'aria-label':'下り緩行線・急行線、上り線。登戸の先は下り1線。構内の細部は省略。'},map);
  for(const path of boardTracks(layout))svg('path',{d:path.d,class:`b-rail b-${path.kind}`,'data-track':path.id},drawing);
  const ue=layout.rows[0].y;
  at(el('span','新宿','b-approach',map),8,213);
  at(el('span','千代田線','b-approach b-metro',map),8,270);
  at(el('small','構内配線省略','b-gap',map),ue+40,221);
  at(el('span','緩行 ↓','b-track-label',map),ue+73,210);
  at(el('span','急行 ↓','b-track-label',map),ue+73,263);
  at(el('small','↑ 上り','b-up-label',map),ue+73,319);
  at(el('small','線路未取得','b-unassigned-label',map),ue+7,8);
  at(el('small','下り1線','b-single-label',map),layout.station('Noborito').y+100,217);
  for(const row of layout.rows) {
    const station=at(el('div',undefined,`b-station${TARGETS.includes(row.id)?' b-target':''}`,map),row.y-12);
    station.dataset.station=row.id;el('strong',row.name,undefined,station);
    if(['YoyogiUehara','Noborito','MukogaokaYuen'].includes(row.id)) {
      svg('rect',{x:244,y:row.y-16,width:18,height:32,class:'b-platform'},drawing);
      at(el('small','1','b-platform-number',map),row.y-8,231);
      at(el('small','2','b-platform-number',map),row.y-8,277);
    } else {
      // Stop markers, not an assertion about platform numbering or crossovers.
      for(const x of [232,274])svg('rect',{x:x-3,y:row.y-12,width:6,height:24,class:'b-stop'},drawing);
      if(row.id==='ShimoKitazawa')at(el('small','別階','b-level-label',map),row.y+18,238);
    }
  }
}
export function renderRouteMap({root,model,pool,selected,now,plans,onSelect}) {
  const layout=boardLayout(model.stations),name=id=>model.stations.find(s=>s.id===id)?.name||id;
  const legs=new Map();
  for(const plan of plans.filter(p=>p.recommendation?.transfers&&p.recommendation.saving>0&&p.recommendation.connection==='likely')) {
    for(const leg of plan.recommendation.legs) {
      const key=`${leg.fromTrainId}:${leg.trainId}:${leg.station}`;
      if(!legs.has(key))legs.set(key,{leg,plan});
    }
  }
  const partnerIds=[...new Set([...legs.values()].map(({leg})=>leg.trainId))];
  const partners=partnerIds.map(id=>pool.find(t=>t.id===id)).filter(Boolean);
  let trains;
  if(selected) {
    const neighbors=mobileNeighbors(pool,selected,now);
    trains=[partners[1]||(neighbors.before?.id!==partners[0]?.id?neighbors.before:neighbors.after),selected,partners[0]||neighbors.after].filter(Boolean);
  } else trains=pool.filter(t=>scheduledPosition(t,now)||(departure(t)>=now&&departure(t)<=now+15))
    .sort((a,b)=>Math.abs(departure(a)-now)-Math.abs(departure(b)-now)||order(a,b)).slice(0,3).sort(order);
  trains=[...new Map(trains.map(t=>[t.id,t])).values()];
  const map=el('div',undefined,'b-board');map.style.height=`${layout.height}px`;
  map.setAttribute('aria-label','固定線路の列車運行表示盤');drawTracks(map,layout,root.clientWidth);
  const positions=new Map(trains.map(t=>[t.id,boardPosition(t,now,layout)]));
  const blocked=layout.rows.map(r=>({top:r.y-15,bottom:r.y+15}));
  for(const id of TARGETS) {const row=layout.station(id);blocked.push({top:row.y+26,bottom:row.y+140});}
  for(const item of legs.values()) {
    item.top=freeTop(layout.station(item.leg.station).y-106,80,blocked);
    blocked.push({top:item.top,bottom:item.top+80});
  }
  const infoTop=selected?freeTop(positions.get(selected.id).y+100,60,blocked):null;
  if(selected)blocked.push({top:infoTop,bottom:infoTop+60});
  trains.forEach((train,i)=>{
    const pos=positions.get(train.id),own=train.id===selected?.id,partner=partnerIds.includes(train.id);
    // Distinct 58px hit areas sit outside ALL physical rails, even at equal times.
    const icon=at(el('button',undefined,`b-train ${train.type}${own?' b-selected':''}${partner?' b-partner':''}`,map),freeTop(pos.y+26,64,blocked),8+i*66);
    icon.type='button';icon.onclick=()=>onSelect(train.id);icon.dataset.train=train.id;
    icon.dataset.track=pos.trackId||'unknown';icon.dataset.positionKind=pos.kind;icon.dataset.observed='false';
    icon.setAttribute('aria-pressed',String(own));
    icon.setAttribute('aria-label',`${clock(departure(train))} ${type(train)} ${train.destination}行を選択`);
    icon.title=`${pos.kind==='scheduled'?'定刻推定':'発時刻・位置未取得'} / 使用線路未取得`;
    el('span','🚆','b-glyph',icon);
    el('strong',`${own?'★':partner?'↔':''}${clock(departure(train))}`,undefined,icon);
    el('small',type(train),undefined,icon);
  });
  if(selected) {
    const pos=positions.get(selected.id);
    const info=at(el('div',undefined,'b-selected-info',map),infoTop,8);info.setAttribute('role','status');
    el('strong',`${type(selected)} ${selected.destination}行`,undefined,info);
    el('small',pos.kind==='scheduled'?'位置は定刻推定・線路未取得':`${name(selected.stops[0].station)}発・位置未取得`,undefined,info);
    const destination=TARGETS.find(id=>Number.isInteger(arrival(selected,id)));
    if(destination)el('span',`${name(destination)} ${clock(arrival(selected,destination))}着`,undefined,info);
  }
  for(const {leg,plan,top} of legs.values()) {
    const from=pool.find(t=>t.id===leg.fromTrainId),to=pool.find(t=>t.id===leg.trainId),row=layout.station(leg.station);
    const note=at(el('div',undefined,'b-transfer',map),top,8);
    el('small',`${name(leg.station)}で`,undefined,note);
    note.dataset.from=from.id;note.dataset.to=to.id;note.dataset.station=leg.station;
    el('strong',`↔ ${type(from)} → ${type(to)}`,undefined,note);
    el('span',`${clock(leg.departure)}発 · ${name(plan.destination)} −${plan.recommendation.saving}分`,undefined,note);
    el('small','接続見込み・未保証',undefined,note);
  }
  for(const id of TARGETS) {
    const row=layout.station(id),plan=plans.find(p=>p.destination===id);
    const result=at(el('div',undefined,'b-result',map),row.y+30,8);result.dataset.destination=id;
    if(!selected){el('small','列車をタップ',undefined,result);continue;}
    const stay=arrival(selected,id),recommendation=plan?.recommendation;
    if(Number.isInteger(stay))el('span',`そのまま ${clock(stay)}`,'b-stay',result);
    else el('span',selected.knownPasses.includes(id)?'選択列車は通過':'未取得','b-missing',result);
    if(recommendation?.transfers>0&&recommendation.saving>0&&recommendation.connection==='likely')
      el('strong',`乗換 ${clock(recommendation.arrival)}  −${recommendation.saving}分`,'b-faster',result);
    else if(recommendation?.transfers===0)el('strong','そのまま','b-verdict',result);
    if(!Number.isInteger(stay)) {
      const reference=model.tCodeReferences?.find(r=>r.tripId===selected.id&&r.status==='unique_reference');
      const link=el('a','公式 ↗','b-official',result);link.href=reference?.url||'https://www.odakyu.jp';link.target='_blank';link.rel='noreferrer';
      link.title=reference?`${reference.serviceDate}の参照`:'小田急公式';
    }
    if(trains.some(other=>other.id!==selected.id&&arrivalOrderReversals(selected,other).some(r=>r.to===id)))
      el('small','先着順逆転・地点未確認','b-reversal',result);
  }
  root.replaceChildren(map);
}

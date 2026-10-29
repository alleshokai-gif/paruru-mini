import {TYPES,clock} from './core.mjs';
import {DOWNBOARD as B,DOWN_STATIONS,DOWN_SWITCHES,downRails,trainMarker,visibleTrains,layoutMarkers,railX} from './downbound-board.mjs';
import {DESTINATIONS} from './comparisons.mjs';
import {busConnections,busClock} from './home-bus.mjs';
// Presentation spacing only: the canonical points, track assignment and
// interpolation coordinates in downbound-board remain unchanged.
const UEHARA_NOTE_SPACE=24;
const sy=y=>Math.min(y,B.noborito)*2+Math.max(0,y-B.noborito)+UEHARA_NOTE_SPACE*Math.max(0,Math.min(1,(y-B.uehara)/(B.shimokitazawa-B.uehara))),CROWD=36;
const diagramPath=ps=>path(ps.map(([x,y])=>[x,sy(y)]));
const dep=t=>t.stops[0].departure??t.stops[0].arrival;
const kind=t=>t.type==='Local'?'各停':t.type==='RapidExpress'?'快急':TYPES[t.type]||t.type;
const shortDestination=t=>({'成城学園前':'成城','向ヶ丘遊園':'遊園'}[t.destination]||t.destination);
const station=id=>id==='Chiyoda.Hibiya'?'日比谷':id==='Shinjuku'?'新宿':DOWN_STATIONS.find(s=>s.id===id)?.name||id;
const name=id=>id==='Noborito'?'登戸':'遊園';
const delta=n=>!Number.isFinite(n)?'差未判定':n===0?'同着':`${n>0?'−':'＋'}${Math.abs(n)}分`;
function el(tag,text,cls,parent){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;parent?.append(n);return n;}
function at(n,y,x){n.style.top=`${y}px`;n.style.left=`${x}px`;return n;}
function svg(tag,attrs,parent){const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,String(v));parent?.append(n);return n;}
const path=ps=>ps.map((p,i)=>`${i?'L':'M'} ${p.join(' ')}`).join(' ');
function appendBus(bubble,snapshot,id,arrival,prefix=''){
  const c=busConnections(snapshot,id,arrival);
  if(!c.options.length){el('small',c.status==='rail_arrival_missing'?'バス 未判定':c.status==='stale'?'バス 更新待ち':c.status==='no_connection'?'バス 接続なし':'バス 未取得','b-bus',bubble);return;}
  const first=c.options[0],next=c.options.find(b=>b.tripId!==first.tripId&&b.placeId===first.placeId&&b.fromStopId===first.fromStopId);
  const source=first.departureState==='realtime'?'予測':'定刻';
  const wide=parseFloat(bubble.style.width)>=120;
  el('strong',`${prefix}バス${busClock(first.departureAt)}${wide&&next?' 次'+busClock(next.departureAt):''}`,'b-bus',bubble);
  el('small',wide?`${source} 歩${first.walkMinutes}分~ ${first.connection==='tight'?'ギリギリ':'待'+first.waitMinutes+'分'}`:`${source} 歩${first.walkMinutes}分~`,'b-bus-detail',bubble);
  if(!wide)el('small',first.connection==='tight'?'ギリギリ':`待${first.waitMinutes}分`,'b-bus-detail',bubble);
  if(next&&!wide)el('small',`次 ${busClock(next.departureAt)}`,'b-bus-detail',bubble);
  bubble.title+=` / ${first.placeLabel} ${first.routeLabel} ${first.platform||''} / 徒歩は未実測の設定値、余裕${snapshot.bufferMinutes}分。${first.connection==='tight'?'接続はギリギリ':'接続見込み'}・未保証`;
  bubble.dataset.busTrip=first.tripId;bubble.dataset.busConnection=first.connection;
}
function appendRouteBuses(box,snapshot,arrivals,onlyYuen=false){
  const known=DESTINATIONS.filter(id=>(!onlyYuen||id==='MukogaokaYuen')&&Number.isInteger(arrivals[id]));
  if(!known.length){appendBus(box,snapshot,onlyYuen?'MukogaokaYuen':'Noborito',undefined);return;}
  for(const id of known)appendBus(box,snapshot,id,arrivals[id],known.length>1?name(id):'');
}
export function renderRouteMap({root,model,pool=[],selected,now,comparison={plans:[],routes:[],candidateIds:new Set()},activeRoute,originChoices=[],busSnapshot,onSelect,error}){
  const width=Math.max(B.width,root.clientWidth),height=sy(B.height);
  const map=el('div',undefined,'d-board');map.style.height=`${height}px`;map.style.width=`${width}px`;root.style.height=`${height}px`;
  map.setAttribute('aria-label','下り急行線と緩行線の運行盤');
  const drawing=svg('svg',{viewBox:`0 0 ${width} ${height}`,class:'d-wiring',role:'img','aria-label':'下り2線。配線接続は従来どおり。登戸の先で1線、遊園構内で2線。'},map);
  const g=svg('g',{},drawing);
  for(const row of DOWN_STATIONS)if(DESTINATIONS.includes(row.id)||row.id==='YoyogiUehara')svg('rect',{x:0,y:sy(row.y)-40,width:width-4,height:DESTINATIONS.includes(row.id)?116:80,rx:7,class:DESTINATIONS.includes(row.id)?'d-target-band':'d-uehara-band'},g);
  for(const r of downRails())svg('path',{d:diagramPath(r.points),class:'d-rail','data-track':r.id,'vector-effect':'non-scaling-stroke'},g);
  for(const s of DOWN_SWITCHES)svg('path',{d:diagramPath([[railX(s.from,s.fromY),s.fromY],[railX(s.to,s.toY),s.toY]]),class:'d-switch','data-switch':s.id,'data-source':s.source,'vector-effect':'non-scaling-stroke'},g);
  for(const row of DOWN_STATIONS){
    if(row.id==='ShimoKitazawa'){
      for(const [floor,number,x] of [['B2','1',B.expressX+12],['B1','3',B.localX-30]])svg('rect',{x,y:sy(row.y)-24,width:18,height:48,rx:3,class:'d-platform','data-platform':row.id,'data-floor':floor,'aria-label':`下北沢 ${floor} 下り${number}番線（通常運用）`},g);
      at(el('small','B2 急行 / B1 緩行','d-floor-label',map),sy(row.y)+18,8);
    }else{
      svg('rect',{x:B.expressX+16,y:sy(row.y)-28,width:B.localX-B.expressX-32,height:56,rx:4,class:'d-platform','data-platform':row.id,'aria-label':`${row.name} 下り島式ホーム`},g);
      if(row.id==='YoyogiUehara'){at(el('small','2','d-platform-number',map),sy(row.y)-9,B.expressX+20);at(el('small','1','d-platform-number',map),sy(row.y)-9,B.localX-30);}
    }
    at(el('strong',row.name,`d-station${DESTINATIONS.includes(row.id)?' d-target-name':''}`,map),sy(row.y)-14,8).dataset.station=row.id;
  }
  at(el('span','日比谷・千代田線','d-approach',map),4,62);at(el('span','新宿','d-approach',map),4,284);
  at(el('small','急行線','d-track-label',map),sy(B.shimokitazawa)+66,B.expressX-60);at(el('small','緩行線','d-track-label',map),sy(B.shimokitazawa)+66,B.localX+36);
  at(el('small','下り1線','d-single-label',map),sy(B.mergeEnd)+12,B.singleX+14);
  if(!model||!pool.length){at(el('small',error?'読込失敗':model?'未取得':'読込中','d-load-status',map),sy(B.uehara)+50,8);root.replaceChildren(map);return;}
  const actual=layoutMarkers(visibleTrains(pool,now,model.stations).map(t=>trainMarker(t,now,model.stations)));
  const markers=actual.map(m=>({...m,screenY:sy(m.y),key:`position:${m.train.id}`,onTrack:m.track.id!=='uehara-unassigned'}));
  const seen=new Set(markers.map(m=>m.train.id));
  const events=new Map();
  function event(train,stationId,departure,reference,connectionEvent=false){
    if(seen.has(train.id)&&!connectionEvent)return;
    const key=`event:${train.id}:${stationId}:${departure}`;if(events.has(key))return;
    const origin=stationId==='Chiyoda.Hibiya'||stationId==='Shinjuku';
    const row=DOWN_STATIONS.find(s=>s.id===stationId),y=origin?36:row?.y;if(y===undefined)return;
    const own=selected?.id===train.id;
    const x=stationId==='Chiyoda.Hibiya'?(own?126:166):stationId==='Shinjuku'?302:own?320:140;
    events.set(key,{train,key,eventStation:stationId,eventDeparture:departure,eventReference:reference,screenY:sy(y)-(origin?0:22),y,x,onTrack:false,kind:reference?'saved_event_only':train.identityBasis==='station_departure'?'station_departure_only':'future_departure',track:{id:'event',confidence:'unknown',basis:'departure_event_not_position'},positionConfidence:'event_only',identityConfidence:train.identityBasis==='station_departure'?'unlinked_station_departure':train.confidence,identityBasis:train.identityBasis});
  }
  for(const t of originChoices)event(t,t.stops[0].station,dep(t));
  for(const route of comparison.routes){
    if(route.originWait){const t=pool.find(t=>t.id===route.startTrainId);if(t)event(t,route.originWait.station,route.originWait.departure);}
    for(const l of route.legs){const t=pool.find(t=>t.id===l.trainId);if(t&&l.departure>=now)event(t,l.station,l.departure,undefined,true);}
  }
  if(selected&&!seen.has(selected.id)){
    const last=selected.stops.at(-1);
    if(selected.identityBasis==='station_departure'||now<=dep(selected))event(selected,selected.stops[0].station,dep(selected),selected.identityBasis==='station_departure'&&now>dep(selected)?'発時刻のみ':undefined);
    else if(Number.isInteger(last.arrival)&&now>last.arrival)event(selected,last.station,last.arrival,selected.approach?.terminatesAtUehara?'終着済':'収録終');
    else event(selected,selected.stops[0].station,dep(selected),'位置未取得');
  }
  markers.push(...events.values());
  const activeIds=new Set(activeRoute?[...activeRoute.legs.map(l=>l.trainId),...(activeRoute.originWait?[activeRoute.startTrainId]:[])]:[]);
  const activeMarker=m=>activeIds.has(m.train.id)&&(m.track.id!=='event'
    ||activeRoute.legs.some(l=>l.trainId===m.train.id&&l.station===m.eventStation&&l.departure===m.eventDeparture)
    ||activeRoute.originWait&&activeRoute.startTrainId===m.train.id&&activeRoute.originWait.station===m.eventStation);
  const buttons=new Map();
  for(const m of markers){
    const own=selected?.id===m.train.id,chosen=activeMarker(m),eligible=comparison.candidateIds.has(m.train.id),allowed=!selected||own||eligible;
    const b=at(el('button',undefined,`d-train ${m.train.type}${own?' d-selected':''}${chosen?' d-candidate':''}${m.track.id==='event'?' d-planned':''}`,map),m.screenY-24,m.x-26);
    b.type='button';b.setAttribute('aria-disabled',String(!allowed));
    Object.assign(b.dataset,{train:m.train.id,marker:m.key,eventStation:m.eventStation??'',departure:String(m.eventDeparture??dep(m.train)),track:m.track.id,trackConfidence:m.track.confidence,trackBasis:m.track.basis,observed:'false',onTrack:String(m.onTrack),positionKind:m.kind,positionConfidence:m.positionConfidence,identityConfidence:m.identityConfidence,identityBasis:m.identityBasis,anchorY:String(m.y),displayY:String(m.screenY),selectionRole:own?'rider':chosen?'candidate':eligible?'alternative':'none'});
    const action=own?'乗車中・タップで解除':selected?eligible?'乗換比較':'接続候補なし':'乗車列車にする';
    b.setAttribute('aria-label',`${clock(m.eventDeparture??dep(m.train))} ${kind(m.train)} ${m.train.destination}行・${action}${m.track.id==='event'?'・'+station(m.eventStation)+'発時刻参照':''}`);b.setAttribute('aria-pressed',String(own||chosen));
    b.title=`${action} / ${m.track.id==='event'?(m.eventReference||'発車予定')+'の参照。現在位置ではない':m.kind==='scheduled_dwell'?'定刻停車':'定刻からの位置推定'} / 使用線路は未実測${m.track.confidence==='unknown'?'・未確認':''}`;
    el('span','🚆','d-glyph',b);
    if(own||chosen)el('b',own?'乗車 ×':'比較','d-role-badge',b);
    else if(eligible)el('small','比較','d-comparable',b);
    if(m.track.id==='event')el('small',`${m.eventReference||'予定'}${clock(m.eventDeparture)}`,'d-event-time',b);
    const crowd=markers.filter(n=>Math.abs(n.x-m.x)<CROWD&&Math.abs(n.screenY-m.screenY)<CROWD).length;
    if(crowd>1)el('small',String(crowd),'d-stack-count',b);
    b.onclick=e=>{
      if(e.detail===0){if(allowed)onSelect(m.train.id,{station:m.eventStation,departure:m.eventDeparture});return;}
      const near=[...map.querySelectorAll('.d-train')].map(n=>{const r=n.querySelector('.d-glyph').getBoundingClientRect();return {id:n.dataset.train,key:n.dataset.marker,station:n.dataset.eventStation,departure:Number(n.dataset.departure),allowed:n.getAttribute('aria-disabled')!=='true',distance:Math.hypot(e.clientX-r.x-r.width/2,e.clientY-r.y-r.height/2)};}).sort((a,b)=>a.distance-b.distance||a.departure-b.departure||a.key.localeCompare(b.key));
      const group=near.filter(n=>n.allowed&&n.distance<=near[0].distance+CROWD);if(!group.length)return;
      const previous=group.findIndex(n=>n.key===root.dataset.lastTappedMarker),hit=group[(previous+1)%group.length];
      root.dataset.lastTappedMarker=hit.key;onSelect(hit.id,{station:hit.station,departure:hit.departure});
    };
    buttons.set(m.key,b);
  }
  // Future departures are station events, not moving trains. Coincident events
  // share one visible stack; every event remains available to the tap hit-cycle.
  for(const m of events.values()){
    const group=[...events.values()].filter(n=>n.x===m.x&&n.screenY===m.screenY);
    const front=group.find(activeMarker)||group.find(n=>n.train.id===selected?.id)||group.sort((a,b)=>a.eventDeparture-b.eventDeparture)[0];
    if(m!==front){const b=buttons.get(m.key);b.style.visibility='hidden';b.setAttribute('aria-hidden','true');}
  }
  function bubble(marker,cls,lines,{full=false}={}){
    const event=marker.track.id==='event',shinjuku=marker.eventStation==='Shinjuku';
    let x,w,y,side;
    if(shinjuku){x=156;w=128;y=marker.screenY-28;side='right';}
    else if(event&&marker.eventStation==='Chiyoda.Hibiya'){x=190;w=94;y=30;side='left';}
    else if(marker.x<180){x=8;w=marker.screenY<sy(B.uehara)-25?Math.max(96,Math.min(144,marker.x-34)):144;y=event?marker.screenY+40:marker.screenY-18;side=event?'up':'right';}
    else {x=272;w=width-x-4;y=marker.track.id==='uehara-unassigned'?marker.screenY+28:marker.screenY-18;side=marker.track.id==='uehara-unassigned'?'up':'left';}
    y=Math.max(30,Math.min(y,height-210));
    const box=at(el('div',undefined,`b-bubble ${cls} b-tail-${side}`,map),y,x);box.style.width=`${w}px`;box.dataset.train=marker.train.id;box.dataset.marker=marker.key;box.title='定刻による比較・接続保証なし';
    if(side==='left'||side==='right')box.style.setProperty('--tail-top',`${Math.max(10,marker.screenY-y-6)}px`);
    for(const [i,line]of lines.entries())el(i===0?'strong':'span',line,undefined,box);
    if(full)box.classList.add('b-full');return box;
  }
  if(selected){
    const m=markers.find(m=>m.train.id===selected.id),plans=comparison.plans;
    if(m){
      const lines=[m.eventReference|| (selected.identityBasis==='station_departure'?'新宿 発時刻のみ':selected.approach?'継続未照合':'このまま')];
      for(const id of DESTINATIONS){const p=plans.find(p=>p.destination===id),at=p?.baseline?.arrival;lines.push(`${name(id)}${Number.isInteger(at)?clock(at):selected.knownPasses?.includes(id)?'通過':'未取得'}`);}
      if(m.track.id==='event')lines.unshift(`${clock(dep(selected))} ${kind(selected)}`);
      const box=bubble(m,'b-rider',lines);
      appendRouteBuses(box,busSnapshot,Object.fromEntries(plans.map(p=>[p.destination,p.baseline?.arrival])));
    }
  }
  if(activeRoute){
    const first=activeRoute.legs[0],anchor=markers.find(m=>m.train.id===first.trainId&&m.eventStation===first.station&&m.eventDeparture===first.departure)||markers.find(m=>m.train.id===first.trainId&&m.track.id!=='event');
    const to=pool.find(t=>t.id===first.trainId);
    if(anchor&&to){
      const origin=activeRoute.originWait;
      if(origin){const m=markers.find(m=>m.train.id===activeRoute.startTrainId);if(m)bubble(m,'b-comparison',[
        `日比谷で${origin.minutes}分待つ`,`${clock(origin.departure)} ${kind(m.train)} ${shortDestination(m.train)}`,
        `上原${clock(m.train.stops.at(-1).arrival)}着`,'上原で乗換']);}
      const lines=[`${first.station==='YoyogiUehara'?'上原':station(first.station)}${activeRoute.transfers>1?'①':''}で乗換`,`${clock(first.departure)} ${kind(to)} ${shortDestination(to)}`,
        first.timingBasis==='arrival'?`${clock(first.alightTime)}着→${clock(first.departure)}発`:`着未取得/${clock(first.alightTime)}発`,
        `${first.connection.gapMinutes}分${first.timingBasis==='arrival'?'':'~'} ${activeRoute.connection==='tight'?'ギリギリ':'接続見込み'}`];
      const last=pool.find(t=>t.id===activeRoute.legs.at(-1).trainId);
      for(const id of DESTINATIONS){if(first.station==='Noborito'&&id==='Noborito')continue;const a=activeRoute.arrivals[id];lines.push(`${name(id)} ${Number.isInteger(a)?clock(a)+' '+delta(activeRoute.savings[id]):last?.knownPasses?.includes(id)?'通過':'未取得'}`);}
      const box=bubble(anchor,`b-comparison${activeRoute.connection==='tight'?' b-tight':''}`,lines,{full:true});box.dataset.route=activeRoute.key;box.dataset.connection=activeRoute.connection;
      box.title+=` / ${to.destination}行へ、${activeRoute.transfers}回乗換${activeRoute.usesRapidExpress?'・快速急行あり':'・快速急行なし'}`;
      if(first.timingBasis!=='arrival')box.title+=' / 自列車の上原着時刻なし。発時刻を下車時刻の保守的上限に使用';
      appendRouteBuses(box,busSnapshot,activeRoute.arrivals,first.station==='Noborito');
      activeRoute.legs.forEach((l,i)=>{
        const row=DOWN_STATIONS.find(s=>s.id===l.station),t=pool.find(t=>t.id===l.trainId);if(!row||!t)return;
        if(activeRoute.connection==='likely'&&Object.values(activeRoute.savings).some(s=>s>0))at(el('b','↔','d-connection-mark',map),sy(row.y)-10,B.singleX-10);
        if(i>0){const marker=markers.find(m=>m.train.id===l.trainId&&m.eventStation===l.station&&m.eventDeparture===l.departure)||markers.find(m=>m.train.id===l.trainId&&m.track.id!=='event');if(marker)bubble(marker,'b-comparison',[
          `② ${station(l.station)} ${kind(t)}へ`,`${clock(l.alightTime)}着→${clock(l.departure)}発`,`${l.connection.gapMinutes}分 ${l.connection.label}`]);}
      });
    }
  }
  for(const id of DESTINATIONS){
    const row=DOWN_STATIONS.find(s=>s.id===id),p=comparison.plans.find(p=>p.destination===id),base=p?.baseline?.arrival,other=activeRoute?.arrivals[id];
    const summary=at(el('small',undefined,'b-station-result',map),sy(row.y)+22,8);
    summary.textContent=!selected?'電車をタップ':`${Number.isInteger(base)?'乗車 '+clock(base):'乗車 未取得'}${Number.isInteger(other)?' / 比較 '+clock(other)+' '+delta(activeRoute.savings[id]):''}`;
    if(selected&&!Number.isInteger(base)&&!Number.isInteger(other)){const r=model.tCodeReferences?.find(r=>r.tripId===selected.id&&r.url);const a=at(el('a','公式 ↗','d-official',map),sy(row.y)+48,8);a.href=r?.url||'https://www.odakyu.jp';a.target='_blank';a.rel='noreferrer';}
  }
  root.replaceChildren(map);
}

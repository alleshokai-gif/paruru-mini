import {TYPES,clock} from './core.mjs';
import {DOWNBOARD as B,DOWN_STATIONS,trainMarker,visibleTrains,layoutMarkers} from './downbound-board.mjs';
import {DESTINATIONS} from './comparisons.mjs';
import {busConnections,busClock} from './home-bus.mjs';
import {buildBoardViewState} from './board-view-state.mjs';
// Display projection only. Schedule anchors, track evidence, routing and BUS
// calculations remain in their existing modules. No switch geometry is drawn.
const TRACK={express:178,local:250}, ROW=310, OWN_ROW=220, HEADER=108, TOP=210, GAP=160;
const dep=t=>t.stops[0].departure??t.stops[0].arrival;
const kind=t=>t.type==='Local'?'各停':t.type==='RapidExpress'?'快速急行':TYPES[t.type]||t.type;
const station=id=>id==='Chiyoda.Hibiya'?'日比谷':id==='Shinjuku'?'新宿':DOWN_STATIONS.find(s=>s.id===id)?.name||id;
const shortStation=id=>({'YoyogiUehara':'上原','SeijogakuenMae':'成城'}[id]||station(id));
const target=id=>id==='Noborito'?'登戸':'遊園';
const delta=n=>!Number.isFinite(n)?'差未判定':n===0?'同着':`${n>0?'−':'＋'}${Math.abs(n)}分`;
function el(tag,text,cls,parent){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;parent?.append(n);return n;}
function at(n,y,x){n.style.top=`${y}px`;n.style.left=`${x}px`;return n;}
function svg(tag,attrs,parent){const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,String(v));parent?.append(n);return n;}
// A reusable, code-native train front: consistent size on Android and Chrome.
function trainFace(button){
 const g=el('span',undefined,'d-glyph',button);g.setAttribute('aria-hidden','true');
 for(const cls of ['window','light left','light right','stripe','bumper'])el('i',undefined,cls,g);
}
function busLines(box,snapshot,arrivals,onlyYuen=false,sharedBuses=new Set(),compactShared=false){
 const ids=DESTINATIONS.filter(id=>(!onlyYuen||id==='MukogaokaYuen')&&Number.isInteger(arrivals[id]));
 if(!ids.length){el('small','バス 未判定','b-bus',box);return;}
 for(const id of ids){
  const c=busConnections(snapshot,id,arrivals[id]),b=c.options[0];
  if(!b){el('small',c.status==='stale'?'バス 更新待ち':c.status==='no_connection'?'バス 接続なし':'バス 未取得','b-bus',box);continue;}
  const next=c.options.find(n=>n.tripId!==b.tripId&&n.placeId===b.placeId&&n.fromStopId===b.fromStopId);
  if(compactShared&&sharedBuses.has(id)){
   el('small',`同じバス${b.connection==='tight'?' · ギリギリ':''}`,'b-bus',box);
   box.dataset.busSame='true';box.dataset.busTrip=b.tripId;box.dataset.busConnection=b.connection;
   continue;
  }
  el('small',`${target(id)}バス ${busClock(b.departureAt)} · ${b.departureState==='realtime'?'予測':'定刻'}`,'b-bus',box);
  const shared=sharedBuses.has(id);
  el('small',`歩${b.walkMinutes}分~ / ${b.connection==='tight'?'ギリギリ':'待'+b.waitMinutes+'分'}${!shared&&next?' · 次'+busClock(next.departureAt):''}`,'b-bus-detail',box);
  box.dataset.busSame=String(shared);
  box.dataset.busTrip=b.tripId;box.dataset.busConnection=b.connection;
  box.title+=` / ${b.placeLabel} ${b.routeLabel} ${b.platform||''}。徒歩未実測・接続未保証`;
 }
}
export function renderRouteMap(props){
 const {root,model,pool=[],selected,now,comparison={plans:[],routes:[],candidateIds:new Set()},activeRoute,comparisonRequested=false,originChoices=[],busSnapshot,onSelect,error,_heights=new Map(),_ownHeight=OWN_ROW,_measured=false}=props;
 const restoreScroll=props._scrollTop??window.scrollY;
 const width=Math.max(B.width,root.clientWidth);
 const sharedBuses=new Set();
 if(comparisonRequested&&activeRoute)for(const id of DESTINATIONS){
  const a=busConnections(busSnapshot,id,comparison.plans.find(p=>p.destination===id)?.baseline?.arrival).options[0];
  const b=busConnections(busSnapshot,id,activeRoute.arrivals[id]).options[0];
  if(a&&b&&a.tripId===b.tripId&&a.placeId===b.placeId&&a.fromStopId===b.fromStopId&&a.departureAt===b.departureAt)sharedBuses.add(id);
 }
 const actual=model?layoutMarkers(visibleTrains(pool,now,model.stations).map(t=>trainMarker(t,now,model.stations))):[];
 const view=buildBoardViewState({serviceDate:root.dataset.serviceDate,pool,actual,selected,now,comparison,activeRoute,comparisonRequested,originChoices});
 const groups=view.groups;
 const ownPoint=actual.find(m=>m.train.id===selected?.id),last=selected?.stops.at(-1);
 const ended=selected&&!ownPoint&&Number.isInteger(last?.arrival)&&now>last.arrival;
 const ownReference=ended?(selected.approach?.terminatesAtUehara?'終着済':'収録終'):selected&&now<dep(selected)?'発予定':'位置未取得';
 const sourceOwn=selected&&!ended&&(ownPoint?.y<B.uehara||selected.identityBasis==='station_departure'||now<=dep(selected)&&['Chiyoda.Hibiya','Shinjuku'].includes(selected.stops[0].station));
 const stationFor=y=>[...DOWN_STATIONS].reverse().find(s=>s.y<=y)||DOWN_STATIONS[0];
 const ownStation=ownPoint?stationFor(ownPoint.y).id:ended?last.station:selected?.stops[0].station;
 const compared=view.visible.find(e=>e.role==='compared');
 const comparedStation=compared?.position?stationFor(compared.position.y).id:compared?.reference?.station;
 const rows=DOWN_STATIONS.map(s=>({...s,groups:groups.filter(g=>g.station===s.id),hasOwn:selected&&s.id===(ownStation==='Chiyoda.Hibiya'||ownStation==='Shinjuku'?'YoyogiUehara':ownStation)}));
 let cursor=TOP+(sourceOwn?_ownHeight+120:0);
 for(const row of rows){
  row.top=cursor;row.body=cursor+HEADER;
  row.expanded=row.id===comparedStation;
  row.end=row.body+Math.max(GAP,(row.hasOwn?_ownHeight:0)+(row.expanded?(_heights.get(view.focusedGroup.key)||ROW):row.groups.length?130:0));cursor=row.end;
 }
 const height=cursor+100;
 // Reserved annotation space belongs to each station. This monotone projection
 // preserves order and exact dwell anchors; no train's data coordinate changes.
 function sy(y){
  if(y<=B.uehara)return sourceOwn?70+(rows[0].body+30-70)*(y-36)/(B.uehara-36):rows[0].body+30+(y-B.uehara)*1.1;
  for(let i=1;i<rows.length;i++){const a=rows[i-1],b=rows[i];if(y<=b.y)return a.body+30+(b.body-a.body)*(y-a.y)/(b.y-a.y);}
  return rows.at(-1).body+30+(y-B.yuen)*.7;
 }
 const map=el('div',undefined,'d-board');map.style.height=`${height}px`;map.style.width=`${width}px`;root.style.height=`${height}px`;
 map.setAttribute('aria-label','小田急 下り2線の定刻運行盤');map.dataset.busFetchedAt=String(busSnapshot?.fetchedAt??'');map.dataset.comparisonGroups=String(groups.length);map.dataset.comparisonRequested=String(comparisonRequested);
 const draw=svg('svg',{viewBox:`0 0 ${width} ${height}`,class:'d-wiring',role:'img','aria-label':'急行線・緩行線の簡略表示。渡り線と進路は省略。登戸以南は下り1線。'},map);
 const end=sy(B.mergeStart),join=sy(B.mergeEnd);
 for(const x of Object.values(TRACK))svg('path',{d:`M ${x} 42 V ${end}`,class:'d-rail'},draw);
 svg('path',{d:`M ${TRACK.express} ${end} L ${B.singleX} ${join} M ${TRACK.local} ${end} L ${B.singleX} ${join} V ${height-30}`,class:'d-rail'},draw);
 for(const row of rows){
  svg('rect',{x:3,y:row.top-24,width:width-6,height:98,rx:16,class:'d-station-band'},draw);
  if(row.id==='ShimoKitazawa')for(const [x,floor]of [[193,'B2'],[225,'B1']])svg('rect',{x,y:row.top-8,width:17,height:50,rx:5,class:'d-platform','data-floor':floor},draw);
  else if(row.id!=='MukogaokaYuen')svg('rect',{x:203,y:row.top-8,width:22,height:50,rx:6,class:'d-platform'},draw);
  at(el('strong',row.name,'d-station',map),row.top-8,12).dataset.station=row.id;
  if(row.id==='ShimoKitazawa')at(el('small','B2 急行 / B1 緩行','d-floor-label',map),row.top+25,12);
 }
 at(el('span','千代田線方面','d-approach',map),9,88);at(el('span','新宿方面','d-approach',map),9,264);
 at(el('b','急行線','d-track-label',map),59,TRACK.express-28);at(el('b','緩行線','d-track-label',map),59,TRACK.local-28);
 if(!model||!pool.length){at(el('small',error?'読込失敗':model?'未取得':'読込中','d-load-status',map),TOP+90,12);root.replaceChildren(map);return;}
 const markers=view.visible.map(entity=>{
  const point=entity.position,ref=entity.reference;
  if(point){
   const x=['express','platform-2','chiyoda-approach'].includes(point.track.id)?TRACK.express:['local','platform-1','shinjuku-approach'].includes(point.track.id)?TRACK.local:point.track.id==='single'?B.singleX:320;
   return {...point,entity,key:entity.key,x,screenY:sy(point.y),onTrack:entity.placement==='track-estimate'};
  }
  const stationId=ref?.station||entity.train.stops[0].station,row=rows.find(r=>r.id===stationId)||rows[0];
  const isSource=['Chiyoda.Hibiya','Shinjuku'].includes(stationId),own=entity.role==='rider';
  const y=isSource?85:row.body+30+(!own&&row.hasOwn?_ownHeight:0);
  return {entity,train:entity.train,key:entity.key,x:stationId==='Chiyoda.Hibiya'||!selected&&stationId==='YoyogiUehara'?40:320,screenY:y,y:row.y,onTrack:false,eventStation:stationId,eventDeparture:ref?.departure??dep(entity.train),
   track:{id:'event',confidence:'unknown',basis:'reference_not_position'},kind:entity.placement,positionConfidence:'unknown',identityConfidence:entity.train.confidence??'unknown',identityBasis:entity.train.identityBasis};
 });
 function balloon(m,cls,lines,route){
  // A callout belongs to the unique entity, not to a second copy at a transfer
  // station. Its short tail ends beside this icon's actual screen bounds.
  const left=m.x>=214,x=left?8:m.x+44,w=left?m.x-52:width-x-6;
  const box=at(el('div',undefined,`b-bubble ${cls} b-tail-${left?'right':'left'}`,map),Math.max(85,m.screenY-18),x);box.style.width=`${w}px`;
  Object.assign(box.dataset,{train:m.train.id,marker:m.key,station:m.eventStation||'',serviceDate:m.entity.serviceDate||''});
  box.title='保存定刻による比較・実運行ではない';
  if(route){box.dataset.route=route.key;box.dataset.connection=route.connection;box.dataset.group=view.focusedGroup.key;}
  for(const [i,line]of lines.entries())el(i===0?'strong':'span',line,/[−＋]\d+分|同着/.test(line)?'b-delta':undefined,box);
  return box;
 }
 for(const m of markers){
  if(m.entity.bubble==='rider'){
   const heading=ended?ownReference:selected.identityBasis==='station_departure'?'新宿 発時刻のみ':selected.approach?'上原まで乗車':'このまま乗車';
   const lines=[heading,`${kind(selected)} · ${selected.destination}行`];
   for(const id of DESTINATIONS){const p=comparison.plans.find(p=>p.destination===id);lines.push(`${target(id)} ${Number.isInteger(p?.baseline?.arrival)?clock(p.baseline.arrival)+'着':selected.knownPasses?.includes(id)?'通過':'未取得'}`);}
   busLines(balloon(m,'b-rider',lines),busSnapshot,Object.fromEntries(comparison.plans.map(p=>[p.destination,p.baseline?.arrival])),false,sharedBuses);
  }else if(m.entity.bubble==='comparison'){
   const route=view.focusedGroup.route,first=route.legs[0],exact=first.timingBasis==='arrival';
   const lines=[`${shortStation(first.station)}で乗換`,`${clock(first.departure)}発 ${kind(m.train)}`,
    exact?`自 ${clock(first.alightTime)}着`:`自着 未取得 / ${clock(first.alightTime)}発基準`,
    `${first.connection.gapMinutes}分${exact?'':'~'} · ${route.connection==='tight'?'ギリギリ':'接続見込み'}`];
   if(route.originWait)lines.push(`日比谷 ${route.originWait.departure===now?'今発':'あと'+route.originWait.minutes+'分'}から`);
   if(route.legs.length>1){const l=route.legs[1],t2=pool.find(t=>t.id===l.trainId);lines.push(`② ${station(l.station)} ${kind(t2)}へ`,l.timingBasis==='arrival'?`${clock(l.alightTime)}着 → ${clock(l.departure)}発 · ${l.connection.gapMinutes}分`:`着未取得 · ${clock(l.departure)}発`);}
   const last=pool.find(t=>t.id===route.legs.at(-1).trainId);
   for(const id of DESTINATIONS){if(first.station==='Noborito'&&id==='Noborito')continue;const a=route.arrivals[id];lines.push(`${target(id)} ${Number.isInteger(a)?clock(a)+'着 '+delta(route.savings[id]):last?.knownPasses?.includes(id)?'通過':'未取得'}`);}
   const box=balloon(m,`b-comparison${route.connection==='tight'?' b-tight':''}`,lines,route);
   busLines(box,busSnapshot,route.arrivals,first.station==='Noborito',sharedBuses,true);
   box.dataset.pathCount=String(view.focusedGroup.paths.length);
   if(route.connection==='likely'&&Object.values(route.savings).some(v=>v>0))el('b','↔','b-connection',box);
  }
 }
 for(const m of markers){
  const {entity}=m,own=entity.role==='rider',chosen=entity.role==='compared',eligible=comparison.candidateIds.has(m.train.id),allowed=!selected||own||eligible;
  const b=at(el('button',undefined,`d-train ${m.train.type}${own?' d-selected':''}${chosen?' d-candidate':''}${!entity.position?' d-planned':''}`,map),m.screenY-36,m.x-27);
  b.type='button';b.setAttribute('aria-disabled',String(!allowed));b.setAttribute('aria-pressed',String(own||chosen));
  Object.assign(b.dataset,{train:m.train.id,marker:m.key,serviceDate:entity.serviceDate||'',eventStation:m.eventStation??'',departure:String(m.eventDeparture??dep(m.train)),track:m.track.id,trackConfidence:m.track.confidence,trackBasis:m.track.basis,observed:'false',onTrack:String(m.onTrack),positionKind:m.kind,positionConfidence:m.positionConfidence,identityConfidence:m.identityConfidence,identityBasis:m.identityBasis,anchorY:String(m.y),displayY:String(m.screenY),selectionRole:entity.role,placement:entity.placement});
  const action=own?'乗車中・タップで解除':selected?eligible?'乗換比較':'接続候補なし':'乗車列車にする';
  b.setAttribute('aria-label',`${clock(m.eventDeparture??dep(m.train))} ${kind(m.train)} ${m.train.destination}行・${action}${!entity.position?'・'+station(m.eventStation)+'発時刻参照':''}`);
  b.title=`${action} / ${entity.position?'定刻位置推定':'発着参照。現在位置ではない'} / 使用線路は未実測`;
  trainFace(b);
  // Normal moving trains stay icon-only. In particular their labels must not
  // float into a different train's callout when positions are close together.
  if(own||chosen||!entity.position)el('b',kind(m.train),'d-train-kind',b);
  if(!entity.position)el('small',`${clock(m.eventDeparture)} ${entity.placement==='departure-planned'?'発予定':entity.placement==='record-ended'?'収録終':'位置未取得'}`,'d-event-time',b);
  else if(!m.onTrack)el('small','線路未定','d-event-time',b);
  const crowd=markers.filter(n=>Math.abs(n.x-m.x)<35&&Math.abs(n.screenY-m.screenY)<40);
  if(crowd.length>1){el('small',String(crowd.length),'d-stack-count',b);if(!own&&!chosen&&crowd.some(n=>n!==m&&n.screenY>m.screenY))b.classList.add('d-stacked');}
  b.onclick=e=>{
   if(!allowed)return;
   // Reference alternatives are data, not extra copies of each train in DOM.
   // Repeated taps keep the existing station-stack selection behavior.
   if(!entity.position&&entity.role!=='rider'){
    const options=view.entities.filter(v=>!v.position&&v.role!=='rider'&&v.references.some(r=>r.station===m.eventStation)&&(!selected||comparison.candidateIds.has(v.train.id)));
    options.sort((a,b)=>a.references.find(r=>r.station===m.eventStation).departure-b.references.find(r=>r.station===m.eventStation).departure);
    const previous=entity.role==='compared'?options.findIndex(v=>v.key===root.dataset.lastTappedMarker):-1,hit=previous<0?entity:options[(previous+1)%options.length]||entity;
    root.dataset.lastTappedMarker=hit.key;const ref=hit.references.find(r=>r.station===m.eventStation);onSelect(hit.train.id,{station:ref?.station,departure:ref?.departure});return;
   }
   if(e.detail===0||crowd.length===1){root.dataset.lastTappedMarker=m.key;onSelect(m.train.id);return;}
   const options=crowd.filter(n=>!selected||n.entity.role==='rider'||comparison.candidateIds.has(n.train.id));
   const previous=options.findIndex(n=>n.key===root.dataset.lastTappedMarker),hit=previous<0?m:options[(previous+1)%options.length];
   root.dataset.lastTappedMarker=hit.key;onSelect(hit.train.id);
  };
 }
 for(const id of DESTINATIONS){
  const row=rows.find(s=>s.id===id),p=comparison.plans.find(p=>p.destination===id),base=p?.baseline?.arrival,other=comparisonRequested?activeRoute?.arrivals[id]:undefined;
  at(el('small',!selected?'電車をタップ':`${Number.isInteger(base)?'乗車 '+clock(base):'乗車 未取得'}${Number.isInteger(other)?' / 比較 '+clock(other)+' '+delta(activeRoute.savings[id]):''}`,'b-station-result',map),row.top+36,12);
  if(selected&&!Number.isInteger(base)&&!Number.isInteger(other)){const ref=model.tCodeReferences?.find(r=>r.tripId===selected.id&&r.url),a=at(el('a','公式 ↗','d-official',map),row.top+64,12);a.href=ref?.url||'https://www.odakyu.jp';a.target='_blank';a.rel='noreferrer';}
 }
 root.replaceChildren(map);
 // Measure the actual wrapped text at this phone width. Add station space,
 // never shrink type or overlap a longer two-transfer/BUS balloon.
 if(!_measured){
  const heights=new Map([...map.querySelectorAll('.b-comparison')].map(box=>[box.dataset.group,Math.max(ROW,box.offsetHeight+40)]));
  const ownHeight=Math.max(OWN_ROW,(map.querySelector('.b-rider')?.offsetHeight||0)+40);
  if(ownHeight>OWN_ROW||[...heights.values()].some(h=>h>ROW))return renderRouteMap({...props,_heights:heights,_ownHeight:ownHeight,_measured:true,_scrollTop:restoreScroll});
 }
 if(window.scrollY!==restoreScroll)window.scrollTo({top:restoreScroll,behavior:'instant'});
}

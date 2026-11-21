import {TYPES,clock} from './core.mjs';
import {DOWNBOARD as B,DOWN_STATIONS,trainMarker,visibleTrains,layoutMarkers} from './downbound-board.mjs';
import {DESTINATIONS} from './comparisons.mjs';
import {busConnections,busClock} from './home-bus.mjs';
import {buildBoardViewState,boardGeometry,boardVerticalLayout,displayRailX} from './board-view-state.mjs';
// Display projection only. Schedule anchors, track evidence, routing and BUS
// calculations remain in their existing modules. No switch geometry is drawn.
const TOP=210,REFERENCE_STEP=320,REFERENCE_TAIL=34;
const TRAIN_HIT_HEIGHT=76,REFERENCE_HIT_HEIGHT=56;
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
 const {root,model,pool=[],selected,now,comparison={plans:[],routes:[],candidateIds:new Set()},activeRoute,comparisonRequested=false,originChoices=[],busSnapshot,onSelect,error}=props;
 const restoreScroll=window.scrollY;
 const width=Math.max(B.width,root.clientWidth);
 const TRACK=boardGeometry(width);
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
 const stationFor=y=>[...DOWN_STATIONS].reverse().find(s=>s.y<=y)||DOWN_STATIONS[0];
 const layout=boardVerticalLayout(),sy=layout.y,height=layout.height;
 const rows=layout.rows;
 const map=el('div',undefined,'d-board');map.style.height=`${height}px`;map.style.width=`${width}px`;root.style.height=`${height}px`;
 map.setAttribute('aria-label','小田急 下り2線の定刻運行盤');map.dataset.busFetchedAt=String(busSnapshot?.fetchedAt??'');map.dataset.comparisonGroups=String(groups.length);map.dataset.comparisonRequested=String(comparisonRequested);
 const draw=svg('svg',{viewBox:`0 0 ${width} ${height}`,class:'d-wiring',role:'img','aria-label':'急行線・緩行線の簡略表示。渡り線と進路は省略。登戸以南は下り1線。'},map);
 const end=sy(B.mergeStart),join=sy(B.mergeEnd);
 for(const x of [TRACK.express,TRACK.local])svg('path',{d:`M ${x} 42 V ${end}`,class:'d-rail'},draw);
 svg('path',{d:`M ${TRACK.express} ${end} L ${TRACK.single} ${join} M ${TRACK.local} ${end} L ${TRACK.single} ${join} V ${height-30}`,class:'d-rail'},draw);
 for(const row of rows){
  svg('rect',{x:3,y:row.top-24,width:width-6,height:98,rx:16,class:'d-station-band'},draw);
  if(row.id==='ShimoKitazawa')for(const [x,floor]of [[TRACK.express+27,'B2'],[TRACK.local-44,'B1']])svg('rect',{x,y:row.top-8,width:17,height:50,rx:5,class:'d-platform','data-floor':floor},draw);
  else if(row.id!=='MukogaokaYuen')svg('rect',{x:TRACK.single-11,y:row.top+37,width:22,height:24,rx:6,class:'d-platform'},draw);
  at(el('strong',row.name,'d-station',map),row.top-8,TRACK.calloutX).dataset.station=row.id;
  if(row.id==='ShimoKitazawa')at(el('small','B2 急行 / B1 緩行','d-floor-label',map),row.top+25,TRACK.calloutX);
 }
 at(el('span','千代田線方面','d-approach',map),9,8);at(el('span','新宿方面','d-approach',map),9,width-85);
 at(el('b','急行線','d-track-label',map),59,TRACK.express-28);at(el('b','緩行線','d-track-label',map),59,TRACK.local-28);
 if(!model||!pool.length){at(el('small',error?'読込失敗':model?'未取得':'読込中','d-load-status',map),TOP+90,12);root.replaceChildren(map);return;}
 const referenceSlots=new Map();
 const markers=view.visible.map(entity=>{
  const point=entity.position,ref=entity.reference;
  const railX=displayRailX(point,TRACK);
  if(point&&railX!==null){
   return {...point,entity,key:entity.key,x:railX,screenY:sy(point.y),onTrack:true,isReference:false};
  }
  const stationId=point?stationFor(point.y).id:ref?.station||entity.train.stops[0].station,row=rows.find(r=>r.id===stationId)||rows[0];
  const isSource=['Chiyoda.Hibiya','Shinjuku'].includes(stationId);
  const slot=referenceSlots.get(stationId)||0;referenceSlots.set(stationId,slot+1);
  // Reference slots are station events, not running positions. Fixed spacing
  // keeps a selected event still when its balloon/BUS text changes. Additional
  // events share the second stack and remain individually tappable.
  const y=isSource?(stationId==='Chiyoda.Hibiya'?85:145):row.body+30+Math.min(slot,1)*REFERENCE_STEP;
  return {entity,train:entity.train,key:entity.key,x:TRACK.single,screenY:y,y:point?.y??row.y,onTrack:false,isReference:true,eventStation:stationId,eventDeparture:ref?.departure??dep(entity.train),
   track:point?.track||{id:'event',confidence:'unknown',basis:'reference_not_position'},kind:entity.placement,positionConfidence:point?.positionConfidence||'unknown',identityConfidence:entity.train.confidence??'unknown',identityBasis:entity.train.identityBasis};
 });
 function balloon(m,cls,lines,route){
  // A callout belongs to the unique entity, not to a second copy at a transfer
  // station. Its short tail ends beside this icon's actual screen bounds.
  const left=m.x>=TRACK.single,x=TRACK.calloutX,w=TRACK.calloutWidth;
  const box=at(el('div',undefined,`b-bubble ${cls} ${m.isReference?'b-tail-up':`b-tail-${left?'right':'left'}`}`,map),Math.max(85,m.screenY+(m.isReference?REFERENCE_TAIL:-18)),x);box.style.width=`${w}px`;
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
   const route=view.focusedGroup.route,first=route.legs[0],exact=first.timingBasis==='arrival',timingKnown=route.legs.every(l=>l.timingBasis==='arrival');
   const lines=[`${shortStation(first.station)}${exact?'で乗換':' 乗換候補'}`,`${clock(first.departure)}発 ${kind(m.train)}`,
    exact?`自 ${clock(first.alightTime)}着`:'自着 未取得',
    exact?`${first.connection.gapMinutes}分 · ${route.connection==='tight'?'ギリギリ':timingKnown?'接続見込み':'接続未確認'}`:`自 ${clock(first.alightTime)}発時刻基準`];
   if(!exact)lines.push(`${first.connection.gapMinutes}分差 · 接続未確認`);
   if(route.originWait)lines.push(`日比谷 ${route.originWait.departure===now?'今発':'あと'+route.originWait.minutes+'分'}から`);
   if(route.legs.length>1){const l=route.legs[1],t2=pool.find(t=>t.id===l.trainId);lines.push(`② ${station(l.station)} ${kind(t2)}へ`,l.timingBasis==='arrival'?`${clock(l.alightTime)}着 → ${clock(l.departure)}発 · ${l.connection.gapMinutes}分`:`${clock(l.alightTime)}発時刻基準 → ${clock(l.departure)}発 · 接続未確認`);}
   const last=pool.find(t=>t.id===route.legs.at(-1).trainId);
   for(const id of DESTINATIONS){if(first.station==='Noborito'&&id==='Noborito')continue;const a=route.arrivals[id];lines.push(`${target(id)} ${Number.isInteger(a)?clock(a)+'着 '+delta(route.savings[id]):last?.knownPasses?.includes(id)?'通過':'未取得'}`);}
   const box=balloon(m,`b-comparison${route.connection==='tight'?' b-tight':''}`,lines,route);
   box.dataset.displayConnection=timingKnown?route.connection:'unconfirmed';
   busLines(box,busSnapshot,route.arrivals,first.station==='Noborito',sharedBuses,true);
   box.dataset.pathCount=String(view.focusedGroup.paths.length);
   if(timingKnown&&route.connection==='likely'&&Object.values(route.savings).some(v=>v>0))el('b','↔','b-connection',box);
  }
 }
 for(const m of markers){
  const {entity}=m,own=entity.role==='rider',chosen=entity.role==='compared',eligible=comparison.candidateIds.has(m.train.id),allowed=!selected||own||eligible;
  const b=at(el('button',undefined,`${m.isReference?'d-reference':'d-train'} ${m.train.type}${own?' d-selected':''}${chosen?' d-candidate':''}`,map),m.screenY-(m.isReference?26:36),m.x-(m.isReference?24:27));
  b.type='button';b.setAttribute('aria-disabled',String(!allowed));b.setAttribute('aria-pressed',String(own||chosen));
  Object.assign(b.dataset,{train:m.train.id,marker:m.key,serviceDate:entity.serviceDate||'',eventStation:m.eventStation??'',departure:String(m.eventDeparture??dep(m.train)),track:m.track.id,trackConfidence:m.track.confidence,trackBasis:m.track.basis,observed:'false',onTrack:String(m.onTrack),positionKind:m.kind,positionConfidence:m.positionConfidence,identityConfidence:m.identityConfidence,identityBasis:m.identityBasis,anchorY:String(m.y),displayY:String(m.screenY),selectionRole:entity.role,placement:entity.placement});
  const action=own?'乗車中・タップで解除':selected?eligible?'乗換比較':'接続候補なし':'乗車列車にする';
  b.setAttribute('aria-label',`${clock(m.eventDeparture??dep(m.train))} ${kind(m.train)} ${m.train.destination}行・${action}${m.isReference?'・'+station(m.eventStation)+'発着参照':''}`);
  b.title=`${action} / ${m.isReference?'発着参照。現在位置ではない':'定刻位置推定'} / 使用線路は未実測`;
  trainFace(b);
  // Normal moving trains stay icon-only. In particular their labels must not
  // float into a different train's callout when positions are close together.
  if(m.isReference){
   el('b',clock(m.eventDeparture),'d-ref-time',b);
   el('span',kind(m.train),'d-ref-kind',b);
   el('small',entity.placement==='track-unknown'?'線路未定':entity.placement==='departure-planned'?'発車予定':entity.placement==='record-ended'?'収録終':'位置未取得','d-ref-status',b);
  }else if(own||chosen)el('b',kind(m.train),'d-train-kind',b);
  const crowd=markers.filter(n=>n.isReference===m.isReference&&Math.abs(n.x-m.x)<35&&Math.abs(n.screenY-m.screenY)<(m.isReference?REFERENCE_HIT_HEIGHT:TRAIN_HIT_HEIGHT));
  if(crowd.length>1){el('small',String(crowd.length),'d-stack-count',b);if(!own&&!chosen&&crowd.some(n=>n!==m&&n.screenY>m.screenY))b.classList.add('d-stacked');}
  b.onclick=e=>{
   if(!allowed)return;
   // Reference alternatives are data, not extra copies of each train in DOM.
   // Repeated taps keep the existing station-stack selection behavior.
   if(m.isReference&&entity.role!=='rider'){
    const options=view.entities.filter(v=>displayRailX(v.position,TRACK)===null&&v.role!=='rider'&&v.references.some(r=>r.station===m.eventStation)&&(!selected||comparison.candidateIds.has(v.train.id)));
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
  if(selected){
   const text=Number.isInteger(base)&&Number.isInteger(other)?`比較 ${delta(activeRoute.savings[id])}`:!Number.isInteger(base)?'未取得':'';
   if(text)at(el('small',text,'b-station-result',map),row.top+36,TRACK.calloutX);
  }
  if(selected&&!Number.isInteger(base)&&!Number.isInteger(other)){
   const reviewed=model.timetableReview?.status==='partial'&&model.timetableReview.checks.find(r=>r.tripId===selected.id&&r.result==='matched');
   const ref=model.tCodeReferences?.find(r=>r.tripId===selected.id&&r.url),a=at(el('a','公式 ↗','d-official',map),row.top+64,12);
   a.href=reviewed?.sourceUrl||ref?.url||'https://www.odakyu.jp';a.target='_blank';a.rel='noreferrer';
   a.title=reviewed?'代表便の現行画面照合先。保存日と参照日は別・永続ID照合ではない':'保存版の公式参照先';
  }
 }
 root.replaceChildren(map);
 // Move callouts inside the free space, never the train. A side tail may move
 // along its box edge so it still points horizontally at the exact glyph.
 const obstacles=[...map.querySelectorAll('.d-station,.d-floor-label,.b-station-result,.d-reference')].map(n=>({x:n.offsetLeft,y:n.offsetTop,w:n.offsetWidth,h:n.offsetHeight}));
 for(const box of map.querySelectorAll('.b-bubble')){
  const m=markers.find(m=>m.key===box.dataset.marker),preferred=box.offsetTop,h=box.offsetHeight,x=box.offsetLeft,w=box.offsetWidth;
  if(!m.isReference){
   const low=Math.max(85,m.screenY-h+8),high=Math.max(low,m.screenY-14);
   const candidates=[preferred,...obstacles.flatMap(o=>[o.y-h-14,o.y+o.h+14])].map(y=>Math.min(high,Math.max(low,y)));
   const overlap=y=>obstacles.reduce((sum,o)=>sum+Math.max(0,Math.min(x+w,o.x+o.w)-Math.max(x,o.x))*Math.max(0,Math.min(y+h,o.y+o.h)-Math.max(y,o.y)),0);
   candidates.sort((a,b)=>overlap(a)-overlap(b)||Math.abs(a-preferred)-Math.abs(b-preferred));
   const y=candidates[0];box.style.top=`${y}px`;box.style.setProperty('--tail-y',`${m.screenY-y-8}px`);
  }
  obstacles.push({x,y:box.offsetTop,w,h});
 }
 if(window.scrollY!==restoreScroll)window.scrollTo({top:restoreScroll,behavior:'instant'});
}

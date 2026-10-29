import {TYPES,clock} from './core.mjs';
import {DOWNBOARD as B,DOWN_STATIONS,trainMarker,visibleTrains,layoutMarkers} from './downbound-board.mjs';
import {DESTINATIONS} from './comparisons.mjs';
import {busConnections,busClock} from './home-bus.mjs';
// Display projection only. Schedule anchors, track evidence, routing and BUS
// calculations remain in their existing modules. No switch geometry is drawn.
const TRACK={express:178,local:250}, ROW=310, OWN_ROW=220, HEADER=108, TOP=210, GAP=160;
const dep=t=>t.stops[0].departure??t.stops[0].arrival;
const kind=t=>t.type==='Local'?'各停':t.type==='RapidExpress'?'快速急行':TYPES[t.type]||t.type;
const station=id=>id==='Chiyoda.Hibiya'?'日比谷':id==='Shinjuku'?'新宿':DOWN_STATIONS.find(s=>s.id===id)?.name||id;
const shortStation=id=>({'YoyogiUehara':'上原','SeijogakuenMae':'成城'}[id]||station(id));
const target=id=>id==='Noborito'?'登戸':'遊園';
const delta=n=>!Number.isFinite(n)?'差未判定':n===0?'同着':`${n>0?'−':'＋'}${Math.abs(n)}分`;
const eventKey=l=>[l.trainId,l.station,l.departure].join('|');
function el(tag,text,cls,parent){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;parent?.append(n);return n;}
function at(n,y,x){n.style.top=`${y}px`;n.style.left=`${x}px`;return n;}
function svg(tag,attrs,parent){const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,String(v));parent?.append(n);return n;}
// A reusable, code-native train front: consistent size on Android and Chrome.
function trainFace(button){
 const g=el('span',undefined,'d-glyph',button);g.setAttribute('aria-hidden','true');
 for(const cls of ['window','light left','light right','stripe','bumper'])el('i',undefined,cls,g);
}
function busLines(box,snapshot,arrivals,onlyYuen=false){
 const ids=DESTINATIONS.filter(id=>(!onlyYuen||id==='MukogaokaYuen')&&Number.isInteger(arrivals[id]));
 if(!ids.length){el('small','バス 未判定','b-bus',box);return;}
 for(const id of ids){
  const c=busConnections(snapshot,id,arrivals[id]),b=c.options[0];
  if(!b){el('small',c.status==='stale'?'バス 更新待ち':c.status==='no_connection'?'バス 接続なし':'バス 未取得','b-bus',box);continue;}
  const next=c.options.find(n=>n.tripId!==b.tripId&&n.placeId===b.placeId&&n.fromStopId===b.fromStopId);
  el('small',`${target(id)}バス ${busClock(b.departureAt)} · ${b.departureState==='realtime'?'予測':'定刻'}`,'b-bus',box);
  el('small',`歩${b.walkMinutes}分~ / ${b.connection==='tight'?'ギリギリ':'待'+b.waitMinutes+'分'}${next?' · 次'+busClock(next.departureAt):''}`,'b-bus-detail',box);
  box.dataset.busTrip=b.tripId;box.dataset.busConnection=b.connection;
  box.title+=` / ${b.placeLabel} ${b.routeLabel} ${b.platform||''}。徒歩未実測・接続未保証`;
 }
}
// One balloon per candidate train/departure/station, rather than hundreds of
// duplicates for paths that share that same first connection. All paths remain
// tappable through the existing controller; an active two-leg path overrides
// that train's default summary without replacing the other train balloons.
function candidateGroups(comparison,activeRoute){
 const groups=new Map();
 for(const route of comparison.routes){
  const first=route.legs[0];if(!first)continue;
  const key=[route.startTrainId,eventKey(first)].join('|');
  if(!groups.has(key))groups.set(key,{key,station:first.station,paths:[]});groups.get(key).paths.push(route);
 }
 for(const g of groups.values()){
  g.paths.sort((a,b)=>Number(a.connection==='tight')-Number(b.connection==='tight')||a.transfers-b.transfers||(a.arrivals.Noborito??Infinity)-(b.arrivals.Noborito??Infinity));
  g.route=g.paths.find(r=>r.key===activeRoute?.key)||g.paths[0];
 }
 const beneficial=g=>g.paths[0].connection==='likely'&&Object.values(g.paths[0].savings).some(n=>n>0);
 return [...groups.values()].sort((a,b)=>Number(beneficial(b))-Number(beneficial(a))||a.paths[0].legs[0].departure-b.paths[0].legs[0].departure||a.key.localeCompare(b.key));
}
export function renderRouteMap(props){
 const {root,model,pool=[],selected,now,comparison={plans:[],routes:[],candidateIds:new Set()},activeRoute,originChoices=[],busSnapshot,onSelect,error,_heights=new Map(),_ownHeight=OWN_ROW,_measured=false}=props;
 const restoreScroll=props._scrollTop??window.scrollY;
 const width=Math.max(B.width,root.clientWidth),groups=candidateGroups(comparison,activeRoute);
 const actual=model?layoutMarkers(visibleTrains(pool,now,model.stations).map(t=>trainMarker(t,now,model.stations))):[];
 const ownPoint=actual.find(m=>m.train.id===selected?.id),last=selected?.stops.at(-1);
 const ended=selected&&!ownPoint&&Number.isInteger(last?.arrival)&&now>last.arrival;
 const ownReference=ended?(selected.approach?.terminatesAtUehara?'終着済':'収録終'):selected&&now<dep(selected)?'発予定':'位置未取得';
 const sourceOwn=selected&&!ended&&(ownPoint?.y<B.uehara||selected.identityBasis==='station_departure'||now<=dep(selected)&&['Chiyoda.Hibiya','Shinjuku'].includes(selected.stops[0].station));
 const stationFor=y=>[...DOWN_STATIONS].reverse().find(s=>s.y<=y)||DOWN_STATIONS[0];
 const ownStation=ownPoint?stationFor(ownPoint.y).id:ended?last.station:selected?.stops[0].station;
 const rows=DOWN_STATIONS.map(s=>({...s,groups:groups.filter(g=>g.station===s.id),hasOwn:selected&&s.id===(ownStation==='Chiyoda.Hibiya'||ownStation==='Shinjuku'?'YoyogiUehara':ownStation)}));
 let cursor=TOP+(sourceOwn?_ownHeight+120:0);
 for(const row of rows){row.top=cursor;row.body=cursor+HEADER;let offset=0;for(const g of row.groups){g.offset=offset;g.height=_heights.get(g.key)||ROW;offset+=g.height;}row.end=row.body+Math.max(GAP,(row.hasOwn?_ownHeight:0)+offset);cursor=row.end;}
 const height=cursor+100;
 // Reserved annotation space belongs to each station. This monotone projection
 // preserves order and exact dwell anchors; no train's data coordinate changes.
 function sy(y){
  if(y<=B.uehara)return sourceOwn?70+(rows[0].body+30-70)*(y-36)/(B.uehara-36):rows[0].body+30+(y-B.uehara)*1.1;
  for(let i=1;i<rows.length;i++){const a=rows[i-1],b=rows[i];if(y<=b.y)return a.body+30+(b.body-a.body)*(y-a.y)/(b.y-a.y);}
  return rows.at(-1).body+30+(y-B.yuen)*.7;
 }
 const map=el('div',undefined,'d-board');map.style.height=`${height}px`;map.style.width=`${width}px`;root.style.height=`${height}px`;
 map.setAttribute('aria-label','小田急 下り2線の定刻運行盤');map.dataset.busFetchedAt=String(busSnapshot?.fetchedAt??'');
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
 const markers=[];
 function addMarker(m){markers.push(m);return m;}
 // Current trains use ONLY the existing position and track evidence. Unknown
 // platform/track stays beside the rails; forecast references never claim it.
 for(const m of actual){
  const x=m.track.id==='express'||m.track.id==='platform-2'||m.track.id==='chiyoda-approach'?TRACK.express:m.track.id==='local'||m.track.id==='platform-1'||m.track.id==='shinjuku-approach'?TRACK.local:m.track.id==='single'?B.singleX:320;
  addMarker({...m,x,screenY:sy(m.y),onTrack:m.track.id!=='uehara-unassigned',key:`position:${m.train.id}`});
 }
 function forecast(train,stationId,departure,y,side,reference){
  const key=`event:${train.id}:${stationId}:${departure}:${reference||''}`;
  const m=addMarker({train,key,x:side==='right'?282:142,screenY:y,y:DOWN_STATIONS.find(r=>r.id===stationId)?.y??36,onTrack:false,eventStation:stationId,eventDeparture:departure,eventReference:reference||'発予定',track:{id:'event',confidence:'unknown',basis:'departure_event_not_position'},kind:reference==='終着済'||reference==='収録終'?'saved_event_only':train.identityBasis==='station_departure'?'station_departure_only':'future_departure',positionConfidence:'event_only',identityConfidence:train.confidence??'unknown',identityBasis:train.identityBasis});
  return m;
 }
 function balloon(m,cls,lines,{y=m.screenY-28,side=m.x>=214?'left':'right',route}={}){
  // Annotation references have their own explicit clock label, never a moving
  // physical position. Their large balloons occupy a dedicated station row.
  const isEvent=m.track.id==='event',x=isEvent?(side==='left'?8:188):(side==='left'?8:210);
  const w=isEvent?(side==='left'?230:width-196):(side==='left'?m.x-42:width-214);
  const box=at(el('div',undefined,`b-bubble ${cls} b-tail-${side==='left'?'right':'left'}`,map),y,x);box.style.width=`${w}px`;
  box.dataset.train=m.train.id;box.dataset.marker=m.key;box.dataset.station=m.eventStation||'';box.title='保存定刻による比較・実運行ではない';
  if(route){box.dataset.route=route.key;box.dataset.connection=route.connection;}
  for(const [i,line]of lines.entries())el(i===0?'strong':'span',line,/[−＋]\d+分|同着/.test(line)?'b-delta':undefined,box);
  return box;
 }
 let ownBubbleMarker;
 for(const row of rows){
  if(row.hasOwn){
   // Attach to the genuine current icon whenever a position is available.
   // Otherwise use an explicitly labelled off-track reference for that train.
   ownBubbleMarker=markers.find(m=>m.train.id===selected.id)||forecast(selected,ended?last.station:selected.stops[0].station,ended?last.arrival:dep(selected),sourceOwn?70:row.body+30,'right',ownReference);
   const heading=ended?ownReference:selected.identityBasis==='station_departure'?'新宿 発時刻のみ':selected.approach?'上原まで乗車':'このまま乗車';
   const lines=[heading,`${kind(selected)} · ${selected.destination}行`];
   for(const id of DESTINATIONS){const p=comparison.plans.find(p=>p.destination===id);lines.push(`${target(id)} ${Number.isInteger(p?.baseline?.arrival)?clock(p.baseline.arrival)+'着':selected.knownPasses?.includes(id)?'通過':'未取得'}`);}
   const box=balloon(ownBubbleMarker,'b-rider',lines,{y:Math.max(85,ownBubbleMarker.screenY-30),side:ownBubbleMarker.x>=214?'left':'right'});
   busLines(box,busSnapshot,Object.fromEntries(comparison.plans.map(p=>[p.destination,p.baseline?.arrival])));
  }
  row.groups.forEach((group,i)=>{
   const route=group.route,first=route.legs[0],t=pool.find(t=>t.id===first.trainId);if(!t)return;
   const side=i%2===0?'left':'right',y=row.body+(row.hasOwn?_ownHeight:0)+group.offset;
   const m=forecast(t,first.station,first.departure,y+30,side==='left'?'right':'left');m.key+='|'+group.key;
   const exact=first.timingBasis==='arrival';
   const lines=[`${shortStation(first.station)}で乗換`,`${clock(first.departure)}発 ${kind(t)}`,
    exact?`自 ${clock(first.alightTime)}着`:`自着 未取得 / ${clock(first.alightTime)}発基準`,
    `${first.connection.gapMinutes}分${exact?'':'~'} · ${route.connection==='tight'?'ギリギリ':'接続見込み'}`];
   if(route.originWait)lines.push(`日比谷 ${route.originWait.departure===now?'今発':'あと'+route.originWait.minutes+'分'}から`);
   if(route.legs.length>1){const l=route.legs[1],t2=pool.find(t=>t.id===l.trainId);lines.push(`② ${station(l.station)} ${kind(t2)}へ`,l.timingBasis==='arrival'?`${clock(l.alightTime)}着 → ${clock(l.departure)}発 · ${l.connection.gapMinutes}分`:`着未取得 · ${clock(l.departure)}発`);}
   const last=pool.find(t=>t.id===route.legs.at(-1).trainId);
   for(const id of DESTINATIONS){if(first.station==='Noborito'&&id==='Noborito')continue;const a=route.arrivals[id];lines.push(`${target(id)} ${Number.isInteger(a)?clock(a)+'着 '+delta(route.savings[id]):last?.knownPasses?.includes(id)?'通過':'未取得'}`);}
   const box=balloon(m,`b-comparison${route.connection==='tight'?' b-tight':''}`,lines,{y,side,route});
   busLines(box,busSnapshot,route.arrivals,first.station==='Noborito');
   box.dataset.pathCount=String(group.paths.length);box.dataset.group=group.key;
   if(route.connection==='likely'&&Object.values(route.savings).some(v=>v>0))el('b','↔','b-connection',box);
  });
 }
 // Origin departure references retain the existing next-few selection. They
 // stack at a labelled station event, outside both physical tracks; a tap
 // cycles coincident references without fabricating their current positions.
 const originStacks=new Map();
 for(const t of originChoices){
  if(selected&&t.id!==selected.id&&!comparison.candidateIds.has(t.id))continue;
  const id=t.stops[0].station,time=dep(t);
  if(markers.some(m=>m.train.id===t.id&&(m.track.id!=='event'||m.eventStation===id&&m.eventDeparture===time)))continue;
  const y=id==='YoyogiUehara'?rows[0].body+30:85;
  const m=forecast(t,id,time,y,id==='Chiyoda.Hibiya'?'left':'right');m.x=id==='Shinjuku'?320:40;
  if(!originStacks.has(id))originStacks.set(id,[]);originStacks.get(id).push(m);m.originEvent=true;
 }
 for(const stack of originStacks.values()){
  stack.sort((a,b)=>a.eventDeparture-b.eventDeparture);
  const front=stack.find(m=>activeRoute?.originWait&&activeRoute.startTrainId===m.train.id)||stack[0];
  for(const m of stack)if(m!==front)m.hidden=true;
 }
 for(const m of markers){
  const own=selected?.id===m.train.id,eligible=comparison.candidateIds.has(m.train.id),chosen=eligible||activeRoute?.legs.some(l=>l.trainId===m.train.id),allowed=!selected||own||eligible;
  const b=at(el('button',undefined,`d-train ${m.train.type}${own?' d-selected':''}${chosen?' d-candidate':''}${m.track.id==='event'?' d-planned':''}`,map),m.screenY-36,m.x-27);
  b.type='button';if(m.hidden){b.style.visibility='hidden';b.setAttribute('aria-hidden','true');}b.setAttribute('aria-disabled',String(!allowed));b.setAttribute('aria-pressed',String(own||chosen));
  Object.assign(b.dataset,{train:m.train.id,marker:m.key,eventStation:m.eventStation??'',departure:String(m.eventDeparture??dep(m.train)),track:m.track.id,trackConfidence:m.track.confidence,trackBasis:m.track.basis,observed:'false',onTrack:String(m.onTrack),positionKind:m.kind,positionConfidence:m.positionConfidence,identityConfidence:m.identityConfidence,identityBasis:m.identityBasis,anchorY:String(m.y),displayY:String(m.screenY),selectionRole:own?'rider':chosen?'candidate':'none'});
  const action=own?'乗車中・タップで解除':selected?eligible?'乗換比較':'接続候補なし':'乗車列車にする';
  b.setAttribute('aria-label',`${clock(m.eventDeparture??dep(m.train))} ${kind(m.train)} ${m.train.destination}行・${action}${m.track.id==='event'?'・'+station(m.eventStation)+'発時刻参照':''}`);
  b.title=`${action} / ${m.track.id==='event'?'発着参照。現在位置ではない':'定刻位置推定'} / 使用線路は未実測`;
  trainFace(b);el('b',kind(m.train),'d-train-kind',b);
  if(m.track.id==='event')el('small',m===ownBubbleMarker?(ended?ownReference:'乗車便'): `${m.originEvent?station(m.eventStation)+' ':''}${clock(m.eventDeparture)} 発予定`,'d-event-time',b);
  if(!m.onTrack&&m.track.id!=='event')el('small','線路未定','d-event-time',b);
  const crowd=markers.filter(n=>Math.abs(n.x-m.x)<35&&Math.abs(n.screenY-m.screenY)<40).length;
  if(crowd>1){el('small',String(crowd),'d-stack-count',b);if(!own&&markers.some(n=>n!==m&&Math.abs(n.x-m.x)<35&&n.screenY>m.screenY&&n.screenY-m.screenY<40))b.classList.add('d-stacked');}
  b.onclick=e=>{
   if(e.detail===0){if(allowed)onSelect(m.train.id,{station:m.eventStation,departure:m.eventDeparture});return;}
   const near=[...map.querySelectorAll('.d-train')].map(n=>{const r=n.querySelector('.d-glyph').getBoundingClientRect();return {id:n.dataset.train,key:n.dataset.marker,station:n.dataset.eventStation,departure:Number(n.dataset.departure),allowed:n.getAttribute('aria-disabled')!=='true',distance:Math.hypot(e.clientX-r.x-r.width/2,e.clientY-r.y-r.height/2)};}).sort((a,b)=>a.distance-b.distance||a.departure-b.departure||a.key.localeCompare(b.key));
   const group=near.filter(n=>n.allowed&&n.distance<=near[0].distance+8);if(!group.length)return;
   const previous=group.findIndex(n=>n.key===root.dataset.lastTappedMarker),hit=group[(previous+1)%group.length];root.dataset.lastTappedMarker=hit.key;onSelect(hit.id,{station:hit.station,departure:hit.departure});
  };
 }
 for(const id of DESTINATIONS){
  const row=rows.find(s=>s.id===id),p=comparison.plans.find(p=>p.destination===id),base=p?.baseline?.arrival,other=activeRoute?.arrivals[id];
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

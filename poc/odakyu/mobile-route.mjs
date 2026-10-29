import {TYPES,clock} from './core.mjs';
import {scheduledPosition} from './navigation.mjs';
import {DOWNBOARD as B,DOWN_STATIONS,DOWN_SWITCHES,downRails,trainMarker,visibleTrains,layoutMarkers,inferredTrack,railX} from './downbound-board.mjs';
const targets=['Noborito','MukogaokaYuen'];
const departure=t=>t.stops[0].departure??t.stops[0].arrival;
const type=t=>t.type==='Local'?'各停':TYPES[t.type];
const shortType=t=>t.type==='RapidExpress'?'快急':type(t);
const arrival=(t,id)=>t.stops.find(s=>s.station===id&&s.stop)?.arrival;
const actionable=p=>p?.recommendation?.transfers>0&&p.recommendation.connection==='likely'
  &&(p.recommendation.saving>0||p.destinationPassed);
function el(tag,text,cls,parent) {
  const n=document.createElement(tag);if(text!==undefined)n.textContent=text;
  if(cls)n.className=cls;parent?.append(n);return n;
}
function svg(tag,attrs,parent) {
  const n=document.createElementNS('http://www.w3.org/2000/svg',tag);
  for(const [key,value] of Object.entries(attrs))n.setAttribute(key,String(value));
  parent?.append(n);return n;
}
function at(n,y,x) {n.style.top=`${y}px`;if(x!==undefined)n.style.left=`${x}px`;return n;}
const pathD=points=>points.map((p,i)=>`${i?'L':'M'} ${p.join(' ')}`).join(' ');
function noteY(preferred,height,blocked) {
  const choices=[preferred,...blocked.flatMap(b=>[b.bottom+6,b.top-height-6])];
  return choices.filter(y=>y>=100&&y+height<B.height&&blocked.every(b=>y+height<=b.top||y>=b.bottom))
    .sort((a,b)=>Math.abs(a-preferred)-Math.abs(b-preferred))[0]??B.height-height;
}
export function renderRouteMap({root,model,pool=[],selected,candidate,now,plans=[],eligibleCandidateIds=new Set(),onSelect,error}) {
  const map=el('div',undefined,'d-board');map.style.height=`${B.height}px`;
  const scale=Math.min(1,root.clientWidth/B.width);
  map.style.transform=`scale(${scale})`;root.style.height=`${B.height*scale}px`;
  map.setAttribute('aria-label','下り急行線と緩行線の運行盤');
  const drawing=svg('svg',{viewBox:`0 0 ${B.width} ${B.height}`,class:'d-wiring','aria-label':'下り2線。登戸の先で1線へ合流し、遊園構内で2線に分岐。',role:'img'},map);
  for(const row of DOWN_STATIONS) {
    const band=targets.includes(row.id)?'d-target-band':row.id==='YoyogiUehara'?'d-uehara-band':null;
    if(band)svg('rect',{x:0,y:row.y-28,width:B.width,height:targets.includes(row.id)?122:56,rx:5,class:band},drawing);
  }
  for(const rail of downRails())svg('path',{d:pathD(rail.points),class:'d-rail','data-track':rail.id},drawing);
  for(const crossing of DOWN_SWITCHES)svg('path',{d:pathD([[railX(crossing.from,crossing.fromY),crossing.fromY],[railX(crossing.to,crossing.toY),crossing.toY]]),class:'d-switch','data-switch':crossing.id,'data-source':crossing.source},drawing);
  for(const row of DOWN_STATIONS) {
    if(row.id==='ShimoKitazawa') {
      // Same direction, different underground levels: B2 1番線 / B1 3番線.
      // These two symbols are NOT a single cross-platform island.
      for(const [floor,number,label,platformX,labelX] of [['B2','1','急行',B.expressX+12,B.expressX-84],['B1','3','緩行',B.localX-30,B.localX+46]]) {
        const platform=svg('rect',{x:platformX,y:row.y-12,width:18,height:24,rx:3,class:'d-platform','data-platform':row.id,'data-floor':floor},drawing);
        platform.setAttribute('aria-label',`下北沢 ${floor} 下り${number}番線（通常運用）`);
        at(el('small',`${floor} ${label}`,'d-floor-label',map),row.y-9,labelX);
      }
      if(model&&!pool.some(t=>t.stops.some(s=>s.station===row.id&&s.stop&&(Number.isInteger(s.arrival)||Number.isInteger(s.departure)))))
        at(el('small','着発未取得','d-station-status',map),row.y+12,8);
    } else {
      const platform=svg('rect',{x:B.expressX+16,y:row.y-22,width:B.localX-B.expressX-32,height:44,rx:3,class:'d-platform','data-platform':row.id},drawing);
      platform.setAttribute('aria-label',`${row.name} 下り島式ホーム`);
    }
    at(el('strong',row.name,`d-station${targets.includes(row.id)?' d-target-name':''}`,map),row.y-13,8).dataset.station=row.id;
  }
  at(el('span','新宿','d-approach',map),6,110);at(el('span','千代田線','d-approach',map),6,270);
  at(el('small','急行線','d-track-label',map),B.uehara-46,B.expressX-20);
  at(el('small','緩行線','d-track-label',map),B.uehara-46,B.localX-20);
  at(el('small','下り1線','d-single-label',map),B.mergeEnd+12,B.singleX+14);
  if(!model||!pool.length) {
    at(el('span',error?'読込失敗':model?'該当ダイヤ未取得':'読込中','d-load-status',map),B.uehara+70,8);
    root.replaceChildren(map);return;
  }
  const legs=new Map();
  for(const plan of plans.filter(actionable)) {
    for(const leg of plan.recommendation.legs) {
      const key=`${leg.fromTrainId}:${leg.trainId}:${leg.station}`;
      if(!legs.has(key))legs.set(key,{leg,plan});
    }
  }
  const partnerIds=[...new Set([...legs.values()].map(({leg})=>leg.trainId))];
  const trains=visibleTrains(pool,selected,now,[...new Set([candidate?.id,...partnerIds].filter(Boolean))]);
  const markers=layoutMarkers(trains.map(t=>trainMarker(t,now,model.stations)).filter(Boolean));
  if(!markers.length)at(el('small','定刻位置なし','d-load-status',map),B.uehara+70,8);
  for(const marker of markers) {
    const train=marker.train,own=selected?.id===train.id,comparison=candidate?.id===train.id,partner=partnerIds.includes(train.id);
    const canTransfer=!selected||own||eligibleCandidateIds.has(train.id);
    const button=at(el('button',undefined,`d-train ${train.type} d-track-${marker.track.id}${own?' d-selected':''}${comparison?' d-candidate':''}${partner?' d-partner':''}`,map),marker.displayY-24,marker.x-26);
    button.type='button';button.disabled=!canTransfer;button.onclick=event=>{
      // Keep every schedule anchor fixed. A tap cycles genuinely crowded
      // glyphs; otherwise the nearest visible glyph wins. Keyboard activates
      // the focused train directly.
      if(event.detail===0){onSelect(train.id);return;}
      const near=[...map.querySelectorAll('.d-train:not(:disabled)')].map(node=>{
        const rect=node.querySelector('.d-glyph').getBoundingClientRect();
        return {id:node.dataset.train,distance:Math.hypot(event.clientX-rect.x-rect.width/2,event.clientY-rect.y-rect.height/2)};
      }).sort((a,b)=>a.distance-b.distance||a.id.localeCompare(b.id));
      const group=near.filter(n=>n.distance<=near[0].distance+12);
      const current=group.findIndex(n=>n.id===(candidate?.id||selected?.id));
      onSelect(group[(current+1)%group.length].id);
    };button.dataset.train=train.id;
    button.dataset.track=marker.track.id;button.dataset.trackConfidence=marker.track.confidence;button.dataset.observed='false';button.dataset.positionKind=marker.kind;
    button.dataset.positionConfidence=marker.positionConfidence;button.dataset.identityConfidence=marker.identityConfidence;button.dataset.identityBasis=marker.identityBasis;
    button.dataset.trackBasis=marker.track.basis;
    button.dataset.anchorY=String(marker.y);button.dataset.displayY=String(marker.displayY);
    button.dataset.positionFrom=marker.point.from;button.dataset.positionTo=marker.point.to;
    button.dataset.selectionRole=own?'rider':comparison?'candidate':partner?'recommended':'none';
    button.setAttribute('aria-pressed',String(own||comparison));
    const action=own?'乗車中・タップで解除':comparison?'乗換候補・再タップで乗車に変更':selected?(canTransfer?'接続見込みの短縮候補として選ぶ':'推奨対象外（接続・短縮を確認できず）'):'乗車列車にする';
    button.setAttribute('aria-label',`${clock(departure(train))} ${type(train)} ${train.destination}行・${action}`);
    const state=marker.kind==='scheduled_dwell'?'定刻停車':marker.kind==='scheduled_departure'?'定刻発車':marker.kind==='scheduled_arrival'?'定刻到着':'定刻概略~';
    button.title=`${action} / ${state}${marker.kind==='schedule_interpolation'?'・途中停車時刻未収録':''} / 使用線路は区間標準からの低確度推定`;
    el('span','🚆','d-glyph',button);
    if(own||comparison||partner)el('b',own?'乗車 ×':comparison?'候補':'乗換先','d-role-badge',button);
    el('small',marker.kind==='scheduled_dwell'?'停':marker.kind==='scheduled_departure'?'発':marker.kind==='scheduled_arrival'?'着':'~','d-event-flag',button);
    const crowd=markers.filter(m=>Math.abs(m.x-marker.x)<28&&Math.abs(m.y-marker.y)<28).length;
    if(crowd>1)el('small',String(crowd),'d-stack-count',button);
    const captionTop=marker.displayY+27,captionBottom=captionTop+32;
    const clear=markers.every(m=>m===marker||Math.abs(m.x-marker.x)>=56||captionBottom<m.displayY-14||captionTop>m.displayY+14)
      &&DOWN_SWITCHES.every(s=>captionBottom<s.fromY||captionTop>s.toY)
      &&DOWN_STATIONS.every(s=>captionBottom<s.y-22||captionTop>s.y+22);
    if(clear) {
      const caption=el('span',undefined,'d-train-caption',button);
      el('strong',shortType(train),undefined,caption);
      el('small',`${clock(departure(train))}発`,undefined,caption);
    }
  }
  const blocked=DOWN_STATIONS.map(s=>({top:s.y-(s.id==='ShimoKitazawa'?13:17),bottom:s.y+(s.id==='ShimoKitazawa'?28:17)}));
  for(const row of DOWN_STATIONS.filter(s=>targets.includes(s.id)))blocked.push({top:row.y+22,bottom:row.y+96});
  for(const {leg,plan} of legs.values()) {
    const row=DOWN_STATIONS.find(s=>s.id===leg.station);if(!row)continue;
    const to=pool.find(t=>t.id===leg.trainId),from=pool.find(t=>t.id===leg.fromTrainId);
    // A passenger connection mark ON the island, never a long track-following arrow.
    at(el('b',row.id==='ShimoKitazawa'?'↕':'↔','d-connection-mark',map),row.y-10,B.singleX-10);
    const y=noteY(row.y+20,60,blocked);blocked.push({top:y,bottom:y+60});
    const note=at(el('div',undefined,'d-transfer',map),y,8);note.dataset.station=leg.station;note.dataset.from=from.id;note.dataset.to=to.id;
    el('small',`${row.name}で`,undefined,note);
    // This is a dated departure at the transfer station, not a future train
    // parked on a track. The existing station annotation is also tappable.
    const change=el('button',undefined,'d-transfer-train',note);change.type='button';
    change.dataset.train=to.id;change.setAttribute('aria-pressed',String(candidate?.id===to.id));
    change.setAttribute('aria-label',`${row.name} ${clock(leg.departure)}発 ${type(to)} ${to.destination}行・乗換候補${candidate?.id===to.id?'・再タップで乗車に変更':'として選ぶ'}`);
    change.onclick=()=>onSelect(to.id);
    el('span','🚆','d-transfer-glyph',change);
    el('strong',`${clock(leg.departure)}発 ${type(to)}へ`,undefined,change);
    note.title=`${to.destination}行へ`;
    const destination=DOWN_STATIONS.find(s=>s.id===plan.destination)?.name;
    el('span',`→ ${destination}${clock(plan.recommendation.arrival)}${plan.recommendation.saving>0?' · '+plan.recommendation.saving+'分早い':''}`,undefined,note);
    el('small',row.id==='ShimoKitazawa'?'階移動あり・接続見込み／未保証':'接続見込み・未保証',undefined,note);
  }
  if(selected) {
    const marker=markers.find(m=>m.train.id===selected.id);
    {
      const y=noteY((marker?.displayY??B.uehara)+20,64,blocked);blocked.push({top:y,bottom:y+64});
      const info=at(el('div',undefined,'d-selected-info',map),y,8);info.setAttribute('role','status');
      el('strong',`乗車 ${shortType(selected)}`,undefined,info);
      el('small',`${clock(departure(selected))}発 ${selected.destination}行`,undefined,info);
      const lastArrival=selected.stops.at(-1)?.arrival;
      const state=!marker?scheduledPosition(selected,now)?'線路未確定':Number.isInteger(lastArrival)&&lastArrival<now?'収録区間外':'位置未取得':marker.kind==='scheduled_dwell'?'定刻停車':marker.kind==='scheduled_departure'?'定刻発車':marker.kind==='scheduled_arrival'?'定刻到着':'定刻概略~';
      el('small',state,undefined,info);
    }
  }
  // The candidate is identified at the actual connection station above. Do not
  // repeat it near an unrelated station merely to fit another text block.
  for(const id of targets) {
    const row=DOWN_STATIONS.find(s=>s.id===id),plan=plans.find(p=>p.destination===id);
    if(!selected){at(el('small','乗車列車をタップ','d-target-note',map),row.y+31,8);continue;}
    const recommendation=plan?.recommendation;
    const arrived=plan?.status==='SCHEDULED_ARRIVED';
    const faster=actionable(plan);
    const stationPoint={index:model.stations.find(s=>s.id===id).index};
    const baseline=arrival(selected,id),track=inferredTrack(selected,stationPoint,baseline).id;
    const ownX=track?railX(track,row.y):B.localX;
    const own=at(el('div',undefined,'d-arrival d-own-arrival',map),row.y+31,ownX-35);own.dataset.destination=id;own.dataset.train=selected.id;
    el('strong',Number.isInteger(baseline)?clock(baseline):selected.knownPasses.includes(id)?'通過':'未取得',undefined,own);
    el('small',`乗車 ${shortType(selected)}`,undefined,own);el('small',`${clock(departure(selected))}発`,undefined,own);
    if(Number.isInteger(baseline)&&!faster)at(el('small',arrived?'定刻着済':'そのまま乗車','d-target-note',map),row.y+35,8);
    if(faster) {
      const final=pool.find(t=>t.id===recommendation.legs.at(-1).trainId),targetTrack=inferredTrack(final,stationPoint,recommendation.arrival).id;
      // Arrival labels identify the route, not an observed station platform.
      const x=!targetTrack||targetTrack===track?(ownX===B.localX?B.expressX:B.localX):railX(targetTrack,row.y);
      const target=at(el('div',undefined,'d-arrival d-faster-arrival',map),row.y+31,x-35);target.dataset.destination=id;target.dataset.train=final.id;
      el('strong',clock(recommendation.arrival),undefined,target);el('small',`乗換 ${shortType(final)}`,undefined,target);el('small',`${clock(departure(final))}発`,undefined,target);
    }
    if(!Number.isInteger(baseline)) {
      const reference=model.tCodeReferences?.find(r=>r.tripId===selected.id&&r.status==='unique_reference');
      const a=at(el('a','公式 ↗','d-official',map),row.y+35,8);a.href=reference?.url||'https://www.odakyu.jp';a.target='_blank';a.rel='noreferrer';
      a.title=reference?`${reference.serviceDate}の参照`:'小田急公式';
    }
  }
  root.replaceChildren(map);
}

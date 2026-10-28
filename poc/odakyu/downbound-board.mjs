import {scheduledPosition} from './navigation.mjs';
// Downbound-only presentation of the previously traced canonical wiring.
// Express/local routing per TRAIN is a low-confidence type-based hypothesis,
// never a platform observation, train identity link or new routing engine.
export const DOWNBOARD=Object.freeze({width:351,height:1048,expressX:178,localX:250,singleX:214,
  uehara:150,kyodo:350,seijo:500,noborito:650,yuen:900,mergeStart:750,mergeEnd:795,splitStart:835,splitEnd:870,rejoinStart:935,rejoinEnd:975});
export const DOWN_STATIONS=Object.freeze([
  {id:'YoyogiUehara',name:'代々木上原',y:DOWNBOARD.uehara},
  {id:'Kyodo',name:'経堂',y:DOWNBOARD.kyodo},
  {id:'SeijogakuenMae',name:'成城学園前',y:DOWNBOARD.seijo},
  {id:'Noborito',name:'登戸',y:DOWNBOARD.noborito},
  {id:'MukogaokaYuen',name:'向ヶ丘遊園',y:DOWNBOARD.yuen}
]);
// Only crossovers that connect the two DOWNBOUND routes. Crossovers to an up
// track, depot roads, turnback sidings and grade crossings are not drawn here.
// Source path IDs refer to track-board.mjs, traced from the supplied wiring PNG.
export const DOWN_SWITCHES=Object.freeze([
  {id:'uehara-to-express',station:'YoyogiUehara',from:'local',to:'express',fromY:198,toY:226,source:'uehara-upper-to-outer'},
  {id:'uehara-to-local',station:'YoyogiUehara',from:'express',to:'local',fromY:198,toY:226,source:'uehara-upper-reverse'},
  {id:'kyodo-to-express',station:'Kyodo',from:'local',to:'express',fromY:260,toY:288,source:'kyodo-upper-scissor-a'},
  {id:'kyodo-to-local',station:'Kyodo',from:'express',to:'local',fromY:260,toY:288,source:'kyodo-upper-scissor-b'},
  {id:'kyodo-west-to-express',station:'Kyodo',from:'local',to:'express',fromY:392,toY:420,source:'kyodo-west-cross-2'},
  {id:'seijo-west-to-local',station:'SeijogakuenMae',from:'express',to:'local',fromY:542,toY:570,source:'seijo-cross-upper'}
]);
export const DOWN_SOURCES=Object.freeze([
  'https://www.odakyu.jp/station/kyodo/',
  'https://www.odakyu.jp/station/seijyogakuen_mae/',
  'https://www.odakyu.jp/station/noborito/',
  'https://www.odakyu.jp/station/mukogaoka_yuen/'
]);
const dep=t=>t.stops[0].departure??t.stops[0].arrival;
const order=(a,b)=>dep(a)-dep(b)||a.id.localeCompare(b.id);
export function inferredTrack(train) {
  return {id:train.type==='Local'||train.type==='SemiExpress'?'local':'express',confidence:'low',basis:'train_type',observed:false};
}
export function railX(track,y) {
  const b=DOWNBOARD,x=track==='express'?b.expressX:b.localX;
  if(y<=b.mergeStart)return x;
  if(y<b.mergeEnd)return x+(b.singleX-x)*(y-b.mergeStart)/(b.mergeEnd-b.mergeStart);
  if(y<=b.splitStart)return b.singleX;
  if(y<b.splitEnd)return b.singleX+(x-b.singleX)*(y-b.splitStart)/(b.splitEnd-b.splitStart);
  if(y<=b.rejoinStart)return x;
  if(y<b.rejoinEnd)return x+(b.singleX-x)*(y-b.rejoinStart)/(b.rejoinEnd-b.rejoinStart);
  return b.singleX;
}
export function downRails() {
  const b=DOWNBOARD;
  return [
    {id:'shinjuku-approach',points:[[126,36],[126,88],[b.expressX,124],[b.expressX,b.uehara]]},
    {id:'chiyoda-approach',points:[[302,36],[302,88],[b.localX,124],[b.localX,b.uehara]]},
    {id:'down-express',points:[[b.expressX,b.uehara],[b.expressX,b.mergeStart],[b.singleX,b.mergeEnd]]},
    {id:'down-local',points:[[b.localX,b.uehara],[b.localX,b.mergeStart],[b.singleX,b.mergeEnd]]},
    {id:'down-single',points:[[b.singleX,b.mergeEnd],[b.singleX,b.splitStart]]},
    {id:'yuen-express',points:[[b.singleX,b.splitStart],[b.expressX,b.splitEnd],[b.expressX,b.rejoinStart],[b.singleX,b.rejoinEnd]]},
    {id:'yuen-local',points:[[b.singleX,b.splitStart],[b.localX,b.splitEnd],[b.localX,b.rejoinStart],[b.singleX,b.rejoinEnd]]},
    {id:'down-exit',points:[[b.singleX,b.rejoinEnd],[b.singleX,1024]]}
  ];
}
export function scheduledY(index,stations) {
  const anchors=DOWN_STATIONS.map(s=>({...s,index:stations.find(t=>t.id===s.id)?.index}));
  if(anchors.some(s=>!Number.isInteger(s.index)))throw Error('BOARD_STATIONS_INVALID');
  if(index<anchors[0].index||index>anchors.at(-1).index)return null;
  for(let i=1;i<anchors.length;i++) {
    const a=anchors[i-1],b=anchors[i];
    if(index<=b.index)return a.y+(b.y-a.y)*(index-a.index)/(b.index-a.index);
  }
  return anchors.at(-1).y;
}
export function trainMarker(train,now,stations) {
  const point=scheduledPosition(train,now),track=inferredTrack(train);
  const origin=DOWN_STATIONS.find(s=>s.id===train.stops[0].station);
  const y=point?scheduledY(point.index,stations):origin?.y;
  if(!Number.isFinite(y))return null; // No unverified Shinjuku/Metro origin claim.
  return {train,track,point,kind:point?'scheduled':'departure',observed:false,y,x:railX(track.id,y)};
}
export function visibleTrains(pool,selected,now,partnerIds=[]) {
  if(!selected)return pool.filter(t=>scheduledPosition(t,now)||(dep(t)>=now&&dep(t)<=now+15))
    .sort((a,b)=>Math.abs(dep(a)-now)-Math.abs(dep(b)-now)||order(a,b)).slice(0,3).sort(order);
  const point=scheduledPosition(selected,now);
  const queue=pool.filter(t=>t.stops[0].station===selected.stops[0].station).sort(order),i=queue.findIndex(t=>t.id===selected.id);
  let before=queue[i-1],after=queue[i+1];
  if(point) {
    const others=pool.filter(t=>t.id!==selected.id).map(train=>({train,p:scheduledPosition(train,now)})).filter(t=>t.p);
    const near=side=>others.filter(t=>side*(t.p.index-point.index)>0).sort((a,b)=>Math.abs(a.p.index-point.index)-Math.abs(b.p.index-point.index)||order(a.train,b.train))[0]?.train;
    before=near(1)||before;after=near(-1)||after;
  }
  const partner=partnerIds.map(id=>pool.find(t=>t.id===id)).filter(Boolean);
  const list=[selected,...partner,before,after].filter(Boolean);
  return [...new Map(list.map(t=>[t.id,t])).values()].slice(0,3).sort(order);
}
// Hit targets are separated along the SAME fixed rail. A short dotted leader
// retains the original schedule/event anchor when markers need displacement.
export function layoutMarkers(markers) {
  const placed=[];
  const blocked=[{top:DOWNBOARD.noborito+22,bottom:DOWNBOARD.noborito+96},{top:DOWNBOARD.yuen+22,bottom:DOWNBOARD.yuen+96}];
  for(const marker of [...markers].sort((a,b)=>a.y-b.y||order(a.train,b.train))) {
    const candidates=[0,32,-32,64,-64,96,-96,128,-128].map(d=>marker.y+d);
    const y=candidates.find(y=>y>=DOWNBOARD.uehara-8&&y<=DOWNBOARD.height-90
      &&blocked.every(b=>y+24<b.top||y-24>b.bottom)
      &&placed.every(p=>Math.abs(railX(marker.track.id,y)-p.x)>=56||Math.abs(y-p.displayY)>=32));
    if(y===undefined)throw Error('TRAIN_MARKER_LAYOUT_UNAVAILABLE');
    placed.push({...marker,displayY:y,x:railX(marker.track.id,y),displaced:y!==marker.y});
  }
  return placed;
}

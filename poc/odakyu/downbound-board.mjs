import {scheduledPosition} from './navigation.mjs';
// Downbound-only presentation of the previously traced canonical wiring.
// Geometry is fixed. Schedule position, identity and segment track confidence
// are independent; none of these presentation estimates enter the route engine.
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
// A second train is a comparison, never an implicit change of rider.
export function tapTrain({selectedId=null,candidateId=null},id) {
  if(id===selectedId)return {selectedId:null,candidateId:null};
  if(!selectedId||id===candidateId)return {selectedId:id,candidateId:null};
  return {selectedId,candidateId:id};
}
export const TRACK_POLICY=Object.freeze({
  standardSource:'https://www.odakyu.jp/news/o5oaa10000005sd3-att/8732_1784221_.pdf',
  generalSource:'https://www.odakyu.jp/ir/report/o5oaa100000004xv-att/00_all_page.pdf',
  checkedOn:'2026-10-29',fromIndex:4,toIndex:17,standardFromMinute:6*60,standardUntilMinute:24*60+10
});
export function inferredTrack(train,point,now) {
  const unknown={id:null,confidence:'unknown',basis:'no_segment_evidence',observed:false};
  if(!point||!Number.isFinite(point.index)||!['provider_id','explicit_trip'].includes(train.identityBasis))return unknown;
  // This board only accepts forward, identified downbound records. A type
  // alone cannot assign a route, an unknown crossover or a station platform.
  if(train.stops.some((s,i)=>i&&s.index<=train.stops[i-1].index))return unknown;
  const beyondY=DOWNBOARD.noborito+(point.index-17)*(DOWNBOARD.yuen-DOWNBOARD.noborito);
  if(point.index>17&&point.index<18&&beyondY>=DOWNBOARD.mergeEnd&&beyondY<=DOWNBOARD.splitStart)
    return {id:'single',confidence:'confirmed',basis:'single_downbound_topology',observed:false};
  if(point.index<TRACK_POLICY.fromIndex||point.index>TRACK_POLICY.toIndex)return unknown;
  // The official diagram explicitly lists early/late-night common-track use.
  // Do not extend its daytime separation rule into those exceptional hours.
  if(!Number.isInteger(now)||now<TRACK_POLICY.standardFromMinute||now>=TRACK_POLICY.standardUntilMinute)return unknown;
  // Standard operation, not this train's actual track. The official 2018
  // diagram documents downbound express/rapid vs local use at Shimokitazawa;
  // applying the general separation along this corridor remains low confidence.
  // SemiExpress / commuter types and individual station transfers stay unknown.
  const id=train.type==='Local'?'local':['Express','RapidExpress'].includes(train.type)?'express':null;
  return id?{id,confidence:'low',basis:'standard_downbound_segment',observed:false,source:TRACK_POLICY.standardSource,
    segment:['YoyogiUehara','Noborito']}:unknown;
}
export function railX(track,y) {
  const b=DOWNBOARD,x=track==='express'?b.expressX:track==='local'?b.localX:b.singleX;
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
function scheduledPoint(train,now) {
  let point=scheduledPosition(train,now);
  // At the published departure minute the anchor is still the station, but
  // dwell has ended. Do not keep showing a stopped train after its departure.
  const departing=train.stops.find(s=>s.stop&&s.departure===now);
  if(departing)return {index:departing.index,from:departing.station,to:departing.station,kind:'scheduled_departure',observed:false};
  // An exact published departure/arrival is a schedule event. Never park a
  // future train at its origin, or extrapolate past a final arrival with no dep.
  if(point?.kind!=='scheduled_dwell') {
    const stop=train.stops.find(s=>s.stop&&s.arrival===now);
    if(stop)point={index:stop.index,from:stop.station,to:stop.station,kind:'scheduled_arrival',observed:false};
  }
  return point;
}
export function trainMarker(train,now,stations) {
  const point=scheduledPoint(train,now);
  const track=inferredTrack(train,point,now),y=point?scheduledY(point.index,stations):null;
  if(!Number.isFinite(y)||!track.id)return null;
  return {train,track,point,kind:point.kind,observed:false,y,x:railX(track.id,y),
    positionConfidence:point.kind==='schedule_interpolation'?'coarse':'minute_schedule',
    identityBasis:train.identityBasis,identityConfidence:train.confidence??'unknown'};
}
export function visibleTrains(pool,selected,now,partnerIds=[]) {
  const active=t=>{
    const p=t&&scheduledPoint(t,now);return p&&inferredTrack(t,p,now).id;
  };
  if(!selected)return pool.filter(active)
    .sort((a,b)=>Math.abs(dep(a)-now)-Math.abs(dep(b)-now)||order(a,b)).slice(0,3).sort(order);
  const point=scheduledPoint(selected,now);
  const queue=pool.filter(t=>t.stops[0].station===selected.stops[0].station).sort(order),i=queue.findIndex(t=>t.id===selected.id);
  let before=queue[i-1],after=queue[i+1];
  if(point) {
    const others=pool.filter(t=>t.id!==selected.id&&active(t)).map(train=>({train,p:scheduledPoint(train,now)}));
    const near=side=>others.filter(t=>side*(t.p.index-point.index)>0).sort((a,b)=>Math.abs(a.p.index-point.index)-Math.abs(b.p.index-point.index)||order(a.train,b.train))[0]?.train;
    before=near(1)||before;after=near(-1)||after;
  }
  const partner=partnerIds.map(id=>pool.find(t=>t.id===id)).filter(Boolean);
  // Future transfer partners remain in the station annotation, not on a rail.
  const nearest=pool.filter(t=>active(t)&&t.id!==selected.id).sort((a,b)=>Math.abs(dep(a)-dep(selected))-Math.abs(dep(b)-dep(selected))||order(a,b));
  const list=[selected,...partner.filter(active),...[before,after].filter(active),...nearest].filter(Boolean);
  return [...new Map(list.map(t=>[t.id,t])).values()].slice(0,3).sort(order);
}
// Keep the actual schedule anchor, including during dwell. Crowded glyphs are
// cycled by tapping; spacing must never move a stopped train or reverse order.
export function layoutMarkers(markers) {
  return [...markers].sort((a,b)=>a.y-b.y||order(a.train,b.train)).map(m=>({...m,displayY:m.y,displaced:false}));
}

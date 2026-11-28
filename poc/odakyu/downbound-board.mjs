import {scheduledPosition} from './navigation.mjs';
// Downbound-only presentation of the previously traced canonical wiring.
// Geometry is fixed. Schedule position, identity and segment track confidence
// are independent; none of these presentation estimates enter the route engine.
export const DOWNBOARD=Object.freeze({width:351,height:1048,expressX:178,localX:250,singleX:214,
  uehara:150,shimokitazawa:243,kyodo:350,seijo:500,noborito:650,yuen:900,mergeStart:750,mergeEnd:795,splitStart:835,splitEnd:870,rejoinStart:935,rejoinEnd:975});
export const UEHARA_THROAT=Object.freeze({platformEnd:184,branch:202,cross:220,exit:238,connectorX:214,
  platform1X:DOWNBOARD.localX,platform2X:DOWNBOARD.expressX});
export const DOWN_STATIONS=Object.freeze([
  {id:'YoyogiUehara',name:'代々木上原',y:DOWNBOARD.uehara},
  {id:'ShimoKitazawa',name:'下北沢',y:DOWNBOARD.shimokitazawa},
  {id:'Kyodo',name:'経堂',y:DOWNBOARD.kyodo},
  {id:'SeijogakuenMae',name:'成城学園前',y:DOWNBOARD.seijo},
  {id:'Noborito',name:'登戸',y:DOWNBOARD.noborito},
  {id:'MukogaokaYuen',name:'向ヶ丘遊園',y:DOWNBOARD.yuen}
]);
// Only crossovers that connect the two DOWNBOUND routes. Crossovers to an up
// track, depot roads, turnback sidings and grade crossings are not drawn here.
// Source path IDs refer to track-board.mjs, traced from the supplied wiring PNG.
export const DOWN_SWITCHES=Object.freeze([
  {id:'uehara-to-local',station:'YoyogiUehara',from:'express',to:'local',fromY:UEHARA_THROAT.branch,toY:UEHARA_THROAT.cross,source:'uehara-lower-to-outer'},
  {id:'uehara-to-express',station:'YoyogiUehara',from:'local',to:'express',fromY:UEHARA_THROAT.branch,toY:UEHARA_THROAT.cross,source:'uehara-lower-reverse'},
  {id:'kyodo-to-express',station:'Kyodo',from:'local',to:'express',fromY:260,toY:288,source:'kyodo-upper-scissor-a'},
  {id:'kyodo-to-local',station:'Kyodo',from:'express',to:'local',fromY:260,toY:288,source:'kyodo-upper-scissor-b'},
  {id:'kyodo-west-to-express',station:'Kyodo',from:'local',to:'express',fromY:392,toY:420,source:'kyodo-west-cross-2'},
  {id:'seijo-west-to-local',station:'SeijogakuenMae',from:'express',to:'local',fromY:542,toY:570,source:'seijo-cross-upper'}
]);
export const DOWN_SOURCES=Object.freeze([
  'https://www.odakyu.jp/station/yoyogi_uehara/',
  'https://www.odakyu.jp/station/shimo_kitazawa/',
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
export function inferredTrack(train,point,now,y) {
  const unknown={id:null,confidence:'unknown',basis:'no_segment_evidence',observed:false};
  if(!point||!Number.isFinite(point.index)||!['provider_id','explicit_trip'].includes(train.identityBasis))return unknown;
  // This board only accepts forward, identified downbound records. A type
  // alone cannot assign a route, an unknown crossover or a station platform.
  if(train.stops.some((s,i)=>i&&s.index<=train.stops[i-1].index))return unknown;
  if(train.approach?.route==='chiyoda'&&point.index<4)
    return {id:'chiyoda-approach',confidence:'low',basis:'published_inbound_route',observed:false};
  if(point.index===4&&train.approach?.route==='chiyoda')
    return {id:'platform-2',confidence:'low',basis:'standard_chiyoda_platform_not_observed',observed:false};
  // A departure at Uehara does not reveal its origin or platform. Keep this
  // event beside the station, rather than assigning platform 2 by train type.
  if(point.index===TRACK_POLICY.fromIndex||point.index>=TRACK_POLICY.fromIndex&&Number.isFinite(y)&&y<UEHARA_THROAT.exit)
    return {id:'uehara-unassigned',confidence:'unknown',basis:'platform_and_turnout_unconfirmed',observed:false};
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
  if(track==='uehara-unassigned')return 320;
  if(track==='platform-1')return UEHARA_THROAT.platform1X;
  if(track==='platform-2')return UEHARA_THROAT.platform2X;
  if(track==='chiyoda-approach'||track==='shinjuku-approach') {
    const start=track==='chiyoda-approach'?126:302,end=track==='chiyoda-approach'?UEHARA_THROAT.platform2X:UEHARA_THROAT.platform1X;
    return y<=88?start:y<124?start+(end-start)*(y-88)/36:end;
  }
  if(track==='express'&&y>=DOWNBOARD.uehara&&y<UEHARA_THROAT.exit) {
    const u=UEHARA_THROAT;
    if(y<=u.platformEnd)return u.platform2X;
    if(y<u.branch)return u.platform2X+(u.connectorX-u.platform2X)*(y-u.platformEnd)/(u.branch-u.platformEnd);
    if(y<=u.cross)return u.connectorX;
    return u.connectorX+(DOWNBOARD.expressX-u.connectorX)*(y-u.cross)/(u.exit-u.cross);
  }
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
  const b=DOWNBOARD,u=UEHARA_THROAT;
  return [
    {id:'shinjuku-approach',points:[[302,36],[302,88],[u.platform1X,124],[u.platform1X,b.uehara]]},
    {id:'chiyoda-approach',points:[[126,36],[126,88],[u.platform2X,124],[u.platform2X,b.uehara]]},
    {id:'down-local',points:[[u.platform1X,b.uehara],[b.localX,b.mergeStart],[b.singleX,b.mergeEnd]]},
    // Platform 2 joins the compact throat; the inner connector corresponds to
    // uehara-through-lower in the reference. Turnback sidings are omitted.
    {id:'uehara-platform-2',points:[[u.platform2X,b.uehara],[u.platform2X,u.platformEnd],[u.connectorX,u.branch]]},
    {id:'down-express',points:[[u.connectorX,u.branch],[u.connectorX,u.cross],[b.expressX,u.exit],[b.expressX,b.mergeStart],[b.singleX,b.mergeEnd]]},
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
  if(train.approach) {
    const anchors=train.stops.map(s=>({s,time:s.departure??s.arrival})).filter(a=>Number.isInteger(a.time));
    const exact=anchors.find(a=>a.time===now);
    if(exact)return {index:exact.s.index,from:exact.s.station,to:exact.s.station,
      kind:exact.s.departure===now?'scheduled_departure':'scheduled_arrival',observed:false};
    for(let i=1;i<anchors.length;i++) {
      const [a,b]=[anchors[i-1],anchors[i]];
      if(now>a.time&&now<b.time)return {index:a.s.index+(b.s.index-a.s.index)*(now-a.time)/(b.time-a.time),
        from:a.s.station,to:b.s.station,kind:'departure_anchor_interpolation',observed:false};
    }
    return null;
  }
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
  const y=point?train.approach&&point.index<4
    ?36+114*(point.index-train.stops[0].index)/(4-train.stops[0].index):scheduledY(point.index,stations):null;
  const track=inferredTrack(train,point,now,y);
  if(!Number.isFinite(y)||!track.id)return null;
  return {train,track,point,kind:point.kind,observed:false,y,x:railX(track.id,y),
    positionConfidence:point.kind.includes('interpolation')?'coarse':'minute_schedule',
    identityBasis:train.identityBasis,identityConfidence:train.confidence??'unknown'};
}
export function visibleTrains(pool,now,stations) {
  // The operating board is the complete current schedule, not a transfer
  // shortlist. The marker's existing position/track evidence gates visibility;
  // selection must neither hide active trains nor park future partners here.
  return pool.filter(train=>trainMarker(train,now,stations)).sort(order);
}
// Keep the actual schedule anchor, including during dwell. Crowded glyphs are
// cycled by tapping; spacing must never move a stopped train or reverse order.
export function layoutMarkers(markers) {
  return [...markers].sort((a,b)=>a.y-b.y||order(a.train,b.train)).map(m=>({...m,displayY:m.y,displaced:false}));
}

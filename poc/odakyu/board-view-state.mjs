// Drawing state only: never changes routes, schedule evidence or BUS results.
// Selection role and position evidence are independent dimensions.
import {DOWNBOARD as B} from './downbound-board.mjs';
// Phone drawing coordinates only. The canonical wiring and track inference are
// unchanged. Every on-track glyph uses this same geometry as the drawn rails.
export function boardGeometry(width){
  const edge=44,express=edge,local=width-edge,single=width/2;
  return {express,local,single,calloutX:express+42,calloutWidth:local-express-84};
}
export function displayRailX(point,geometry){
  const id=point?.track?.id;
  const start=['express','platform-2','chiyoda-approach'].includes(id)?geometry.express:['local','platform-1','shinjuku-approach'].includes(id)?geometry.local:id==='single'?geometry.single:null;
  if(start===null)return null;
  if(point.y<=B.mergeStart||id==='single')return start;
  if(point.y>=B.mergeEnd)return geometry.single;
  return start+(geometry.single-start)*(point.y-B.mergeStart)/(B.mergeEnd-B.mergeStart);
}
export const trainViewKey=(train,serviceDate)=>JSON.stringify([
  serviceDate||train.sourceServiceDate||train.calendar||'date-unknown',train.id
]);
const departure=t=>t.stops[0].departure??t.stops[0].arrival;
const eventKey=l=>[l.trainId,l.station,l.departure].join('|');

export function candidateGroups(comparison,activeRoute){
  const groups=new Map();
  for(const route of comparison.routes){
    const first=route.legs[0];if(!first)continue;
    const key=[route.startTrainId,eventKey(first)].join('|');
    if(!groups.has(key))groups.set(key,{key,station:first.station,paths:[]});
    groups.get(key).paths.push(route);
  }
  for(const g of groups.values()){
    g.paths.sort((a,b)=>Number(a.connection==='tight')-Number(b.connection==='tight')||a.transfers-b.transfers||(a.arrivals.Noborito??Infinity)-(b.arrivals.Noborito??Infinity));
    g.route=g.paths.find(r=>r.key===activeRoute?.key)||g.paths[0];
  }
  const priority=g=>g.paths[0].connection!=='likely'?2:Object.values(g.paths[0].savings).some(n=>n>0)?0:1;
  return [...groups.values()].sort((a,b)=>priority(a)-priority(b)||(a.paths[0].arrivals.Noborito??Infinity)-(b.paths[0].arrivals.Noborito??Infinity)||a.paths[0].legs[0].departure-b.paths[0].legs[0].departure||a.key.localeCompare(b.key));
}

export function buildBoardViewState({serviceDate,pool=[],actual=[],selected,now,comparison,activeRoute,comparisonRequested=false,originChoices=[]}){
  const groups=candidateGroups(comparison,activeRoute),entities=new Map(),byId=new Map(pool.map(t=>[t.id,t]));
  const riderKey=selected?trainViewKey(selected,serviceDate):null;
  const focusedGroup=comparisonRequested?groups.find(g=>g.paths.some(r=>r.key===activeRoute?.key)):null;
  const comparedTrain=byId.get(focusedGroup?.route.legs[0].trainId);
  const comparedKey=comparedTrain?trainViewKey(comparedTrain,serviceDate):null;
  function ensure(train){
    const key=trainViewKey(train,serviceDate);
    if(!entities.has(key))entities.set(key,{key,train,serviceDate:serviceDate||train.sourceServiceDate||null,role:key===riderKey?'rider':key===comparedKey?'compared':'normal',position:null,references:[],origin:false,shown:false});
    return entities.get(key);
  }
  for(const point of actual){const e=ensure(point.train);e.position=point;e.shown=true;}
  if(selected)ensure(selected).shown=true;
  for(const group of groups){
    const leg=group.route.legs[0],t=byId.get(leg.trainId);if(!t)continue;
    ensure(t).references.push({station:leg.station,departure:leg.departure,group});
  }
  for(const t of originChoices){
    const e=ensure(t);e.origin=true;
    if(!e.references.length)e.references.push({station:t.stops[0].station,departure:departure(t)});
  }
  const focusByStation=new Map();
  for(const group of groups)if(!focusByStation.has(group.station))focusByStation.set(group.station,group);
  if(focusedGroup)focusByStation.set(focusedGroup.station,focusedGroup);
  // One entity can have many station events, but owns exactly one icon. A real
  // scheduled position always wins over a future event, including during taps.
  const occupied=new Set();
  for(const e of entities.values()){
    const focus=e.references.find(r=>r.group===focusedGroup);
    const preferred=e.references.find(r=>r.group&&focusByStation.get(r.station)===r.group);
    e.reference=focus||preferred||e.references[0];
    if(e.role!=='normal')e.shown=true;
    if(e.position){e.placement=e.position.track.id==='uehara-unassigned'?'track-unknown':'track-estimate';}
    else {
      const last=e.train.stops.at(-1),ended=Number.isInteger(last?.arrival)&&now>last.arrival;
      e.placement=ended?'record-ended':now<departure(e.train)?'departure-planned':'position-unknown';
      if(e.role==='rider'&&!e.reference)e.reference={station:ended?last.station:e.train.stops[0].station,departure:ended?last.arrival:departure(e.train)};
      const allowedOrigin=e.origin&&(!selected||comparison.candidateIds.has(e.train.id));
      if(preferred||allowedOrigin){
        const station=e.reference?.station;
        if(!occupied.has(station)){e.shown=true;occupied.add(station);}
      }
    }
    e.bubble=e.role==='rider'?'rider':e.role==='compared'?'comparison':null;
  }
  // If an explicitly compared reference shares the station stack, it is the
  // sole front. Normal alternatives remain data, not hidden duplicate DOM.
  for(const e of entities.values())if(!e.position&&e.role==='compared'){
    for(const other of entities.values())if(other!==e&&!other.position&&other.role==='normal'&&other.reference?.station===e.reference?.station)other.shown=false;
  }
  return {entities:[...entities.values()],visible:[...entities.values()].filter(e=>e.shown),groups,focusedGroup,riderKey,comparedKey};
}

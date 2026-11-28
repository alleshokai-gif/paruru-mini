import {planNavigation} from './navigation.mjs';
export const DESTINATIONS=['Noborito','MukogaokaYuen'];
const routeKey=legs=>legs.map(l=>[l.fromTrainId,l.trainId,l.station,l.departure].join(':')).join('>');
// Presentation of the existing planner's full search. Its recommendation and
// connection gates remain unchanged; slower/tight routes are comparisons only.
export function compareAll(trips,selected,now) {
  if(!selected||selected.identityBasis==='station_departure')return {plans:[],routes:[],candidateIds:new Set()};
  const plans=DESTINATIONS.map(destination=>({destination,...planNavigation(trips,selected.id,destination,now,{includeAllAlternatives:true})}));
  const grouped=new Map();
  const sources=[{start:selected,plans,wait:null}];
  if(selected.origin==='Chiyoda.Hibiya'&&now<=selected.stops[0].departure){
    for(const next of trips.filter(t=>t.origin===selected.origin&&t.calendar===selected.calendar&&t.id!==selected.id&&t.stops[0].departure>=selected.stops[0].departure).sort((a,b)=>a.stops[0].departure-b.stops[0].departure).slice(0,3)){
      sources.push({start:next,wait:{station:selected.origin,departure:next.stops[0].departure,minutes:next.stops[0].departure-now},
        plans:DESTINATIONS.map(destination=>({destination,...planNavigation(trips,next.id,destination,now,{includeAllAlternatives:true})}))});
    }
  }
  for(const source of sources)for(const p of source.plans)for(const a of p.alternatives){
    if(!a.legs.length||a.legs.some(l=>l.connection.status==='difficult'))continue;
    const key=`${source.start.id}|${routeKey(a.legs)}`;
    if(!grouped.has(key))grouped.set(key,{key,startTrainId:source.start.id,originWait:source.wait,legs:a.legs,transfers:a.transfers,connection:a.connection,arrivals:{},savings:{},usesRapidExpress:[source.start.id,...a.legs.map(l=>l.trainId)].some(id=>trips.find(t=>t.id===id)?.type==='RapidExpress')});
    const baseline=plans.find(x=>x.destination===p.destination)?.baseline;
    const r=grouped.get(key);r.arrivals[p.destination]=a.arrival;r.savings[p.destination]=baseline?baseline.arrival-a.arrival:null;
  }
  const routes=[...grouped.values()].sort((a,b)=>a.legs[0].departure-b.legs[0].departure||a.transfers-b.transfers||(a.arrivals.Noborito??Infinity)-(b.arrivals.Noborito??Infinity)||a.key.localeCompare(b.key));
  return {plans,routes,candidateIds:new Set(routes.flatMap(r=>[...r.legs.map(l=>l.trainId),...(r.originWait?[r.startTrainId]:[])]))};
}
export function upcomingDepartures(model,pool,now) {
  const choices=[];
  for(const origin of ['Chiyoda.Hibiya','YoyogiUehara']){
    const next=pool.filter(t=>t.stops[0].station===origin&&t.stops[0].departure>=now).sort((a,b)=>a.stops[0].departure-b.stops[0].departure).slice(0,3);
    choices.push(...next);
  }
  // Station departures are selectable facts, never a fabricated same-train
  // connection to Uehara. They cannot enter planNavigation's identified pool.
  const calendar=pool[0]?.calendar;
  choices.push(...model.departures.filter(d=>d.station==='Shinjuku'&&d.calendar===calendar&&d.time>=now).sort((a,b)=>a.time-b.time).slice(0,3).map(d=>({
    id:`departure:${d.id}`,type:d.type,destination:d.destinationName,origin:d.station,
    calendar,identityBasis:'station_departure',knownPasses:[],
    stops:[{station:d.station,index:d.index,arrival:null,departure:d.time,stop:true}],sourceEventId:d.id
  })));
  return choices;
}
export function pathsForTrain(routes,id,event={},activeRoute) {
  let paths=routes.filter(r=>(r.legs.some(l=>l.trainId===id)||r.originWait&&r.startTrainId===id)
    &&(!event.station||r.legs.some(l=>l.trainId===id&&l.station===event.station&&l.departure===event.departure)
      ||r.originWait&&r.startTrainId===id&&r.originWait.station===event.station&&r.originWait.departure===event.departure));
  // A second-stage train tap retains the already compared first-stage train.
  // Thus every two-transfer pair is reachable without a separate route list.
  if(activeRoute&&id!==activeRoute.legs[0].trainId){
    const via=paths.filter(r=>r.startTrainId===activeRoute.startTrainId&&r.legs.length===2&&r.legs[1].trainId===id&&r.legs[0].trainId===activeRoute.legs[0].trainId&&r.legs[0].station===activeRoute.legs[0].station);
    if(via.length)paths=via;
  }
  return paths.sort((a,b)=>Number(a.connection==='tight')-Number(b.connection==='tight')||(a.arrivals.Noborito??Infinity)-(b.arrivals.Noborito??Infinity)||a.transfers-b.transfers);
}

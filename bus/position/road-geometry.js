import { distanceMeters,prepareShape,projectToSegment,snapCandidates,validPoint } from './geometry.js';

export const ROAD_VALIDATION_POLICY=Object.freeze({
  stopRouteMeters:90,candidateSlackMeters:10,ambiguityMeters:40,validationMeters:60,
  n07ValidationMeters:60,maxAgeSec:120,futureSec:5,jitterMeters:15,maxSpeedMps:22,
  jumpAllowanceMeters:20,minServiceDays:3,minTrips:5,minTripsPerSegment:3,
  minGpsMatchRate:0.95,minN07MatchRate:0.95,minOfficialPairs:20,minOfficialAgreement:0.95
});
const finite=value=>Number.isFinite(value);
const percentile=(values,p)=>{if(!values.length)return null;const rows=[...values].sort((a,b)=>a-b);
  return rows[Math.min(rows.length-1,Math.floor((rows.length-1)*p))];};
const increment=(bag,key)=>{bag[key]=(bag[key]||0)+1;};
const pushPoint=(points,point)=>{if(!points.length||distanceMeters(points.at(-1),point)>0.1)points.push(point);};

export function stitchOsmRoute(osm,relationId) {
  const elements=osm?.elements;if(!Array.isArray(elements))throw Error('ROAD_OSM_INVALID');
  const relation=elements.find(value=>value.type==='relation'&&value.id===relationId);
  if(!relation||relation.tags?.type!=='route'||relation.tags?.route!=='bus')throw Error('ROAD_OSM_RELATION_INVALID');
  const nodes=new Map(elements.filter(value=>value.type==='node').map(value=>[value.id,value]));
  const ways=new Map(elements.filter(value=>value.type==='way').map(value=>[value.id,value]));
  const members=(relation.members||[]).filter(value=>value.type==='way').map(member=>{
    const way=ways.get(member.ref);if(!way||!Array.isArray(way.nodes)||way.nodes.length<2)throw Error('ROAD_OSM_WAY_MISSING');
    const points=way.nodes.map(nodeId=>{const node=nodes.get(nodeId);
      if(!node||!finite(node.lat)||!finite(node.lon))throw Error('ROAD_OSM_NODE_MISSING');
      return {nodeId,lat:node.lat,lon:node.lon};});
    return {id:member.ref,role:member.role||'',points};
  });
  if(!members.length)throw Error('ROAD_OSM_EMPTY');
  function build(reverseFirst) {
    const first=reverseFirst?[...members[0].points].reverse():members[0].points;
    const points=[...first],orientations=[reverseFirst?'reverse':'forward'];let gaps=0,gapMeters=0;
    for(const member of members.slice(1)) {
      const last=points.at(-1),forward=member.points,reverse=[...member.points].reverse();
      let next;
      if(last.nodeId===forward[0].nodeId)next=forward;
      else if(last.nodeId===reverse[0].nodeId)next=reverse;
      else {
        const forwardGap=distanceMeters(last,forward[0]),reverseGap=distanceMeters(last,reverse[0]);
        next=forwardGap<=reverseGap?forward:reverse;gaps++;gapMeters+=Math.min(forwardGap,reverseGap);
      }
      orientations.push(next===forward?'forward':'reverse');
      for(const point of next)pushPoint(points,point);
    }
    return {points,gaps,gapMeters,orientations};
  }
  const candidates=[build(false),build(true)].sort((a,b)=>a.gaps-b.gaps||a.gapMeters-b.gapMeters);
  const best=candidates[0];
  return {points:best.points.map(({lat,lon})=>({lat,lon})),relation:{id:relation.id,version:relation.version,
    timestamp:relation.timestamp,ref:relation.tags.ref||null,name:relation.tags.name||null},
    wayCount:members.length,gaps:best.gaps,gapMeters:best.gapMeters,orientations:best.orientations};
}

function projectOrderedStops(shape,chain,stops,policy,rejected) {
  let paths=[];
  for(const item of chain.stops) {
    const stop=stops[item.stopId];
    if(!validPoint(stop?.position)){increment(rejected,'stop_gps_missing');return [];}
    const candidates=snapCandidates(shape,stop.position,policy.stopRouteMeters,policy.candidateSlackMeters).slice(0,16);
    if(!candidates.length){increment(rejected,'stop_off_route_or_order');return [];}
    if(!paths.length)paths=candidates.map(value=>({rows:[{stopId:item.stopId,sequence:item.sequence,along:value.along,distance:value.distance}],score:value.distance}));
    else {
      const next=[];
      for(const path of paths)for(const value of candidates)if(value.along>path.rows.at(-1).along+1)
        next.push({rows:[...path.rows,{stopId:item.stopId,sequence:item.sequence,along:value.along,distance:value.distance}],score:path.score+value.distance});
      if(!next.length){increment(rejected,'stop_off_route_or_order');return [];}
      next.sort((a,b)=>a.score-b.score);paths=next.slice(0,256);
    }
  }
  paths.sort((a,b)=>a.score-b.score);const best=paths[0],competitive=paths.filter(value=>value.score<=best.score+policy.candidateSlackMeters);
  if(competitive.some(path=>path.rows.some((value,index)=>Math.abs(value.along-best.rows[index].along)>=policy.ambiguityMeters))) {
    // Keep the best diagnostic path so coverage can be measured, but never make this candidate eligible.
    increment(rejected,'stop_projection_ambiguous');
  }
  return best.rows;
}

export function projectRoadStops({points,chain,stops,policy:overrides={}}={}) {
  const policy={...ROAD_VALIDATION_POLICY,...overrides};
  if(!Array.isArray(points)||points.length<2||!chain?.stops?.length||!stops)
    throw Error('ROAD_STOP_PROJECTION_INPUT_INVALID');
  const rejected={},shape=prepareShape(points),rows=projectOrderedStops(shape,chain,stops,policy,rejected);
  const ambiguousStopIds=rows.filter((row)=>{
    const stop=stops[row.stopId],candidates=snapCandidates(shape,stop.position,policy.stopRouteMeters,policy.candidateSlackMeters);
    return candidates.some((candidate)=>Math.abs(candidate.along-candidates[0].along)>=policy.ambiguityMeters);
  }).map((row)=>row.stopId);
  return Object.freeze({
    rows:Object.freeze(rows.map((row,ordinal)=>Object.freeze({...row,ordinal}))),
    orderValid:rows.length===chain.stops.length&&rows.every((row,index)=>
      row.stopId===chain.stops[index].stopId&&row.sequence===chain.stops[index].sequence
      && (index===0||row.along>rows[index-1].along+1)),
    ambiguous:Boolean(rejected.stop_projection_ambiguous),
    ambiguousStopIds:Object.freeze(ambiguousStopIds),
    rejected:Object.freeze({...rejected}),
    routeLengthMeters:shape.total
  });
}

function nearestLineDistance(lines,point) {
  let best=Infinity;
  for(const line of lines)for(const segment of line.segments) {
    const projection=projectToSegment(line.points[segment.index],line.points[segment.index+1],point);
    if(projection&&projection.distance<best)best=projection.distance;
  }
  return best;
}

export function validateRoadGeometry({points,chain,stops,gpsSamples=[],corroboratingLines=[],officialVerification={pairs:0,correct:0},policy:overrides={}}) {
  const policy={...ROAD_VALIDATION_POLICY,...overrides};
  if(!Array.isArray(points)||points.length<2||!chain?.stops?.length||!stops)throw Error('ROAD_VALIDATION_INPUT_INVALID');
  const shape=prepareShape(points),rejected={},projectedStops=projectOrderedStops(shape,chain,stops,policy,rejected);
  const lines=corroboratingLines.filter(line=>Array.isArray(line)&&line.length>1).map(prepareShape);
  const roadDistances=lines.length?points.map(point=>nearestLineDistance(lines,point)):[];
  const n07Matched=roadDistances.filter(value=>value<=policy.n07ValidationMeters).length;
  const n07MatchRate=roadDistances.length?n07Matched/roadDistances.length:null;
  const traces=new Map(),serviceDays=new Set();let evaluatedGps=0,matchedGps=0;
  for(const sample of gpsSamples) {
    evaluatedGps++;
    if(!sample?.tripKey||!/^\d{8}$/.test(sample.serviceDay||'')||!finite(sample.timestamp)||!finite(sample.receivedAt)||!validPoint(sample)) {
      increment(rejected,'gps_invalid');continue;
    }
    const age=sample.receivedAt-sample.timestamp;
    if(age>policy.maxAgeSec||age< -policy.futureSec){increment(rejected,'gps_stale_or_future');continue;}
    const candidates=snapCandidates(shape,sample,policy.validationMeters,policy.candidateSlackMeters);
    if(!candidates.length){increment(rejected,'gps_off_route');continue;}
    if(candidates.some(value=>Math.abs(value.along-candidates[0].along)>=policy.ambiguityMeters)) {
      increment(rejected,'gps_projection_ambiguous');continue;
    }
    matchedGps++;serviceDays.add(sample.serviceDay);
    const trace=traces.get(sample.tripKey)||[];trace.push({...sample,...candidates[0]});traces.set(sample.tripKey,trace);
  }
  let monotonicTrips=0;
  const usableTraces=new Map();
  for(const [tripKey,values] of traces) {
    const byTimestamp=new Map(),conflicts=new Set();
    for(const value of values) {
      const previous=byTimestamp.get(value.timestamp);
      if(previous&&distanceMeters(previous,value)>1)conflicts.add(value.timestamp);else if(!previous)byTimestamp.set(value.timestamp,value);
    }
    const ordered=[...byTimestamp.values()].filter(value=>!conflicts.has(value.timestamp)).sort((a,b)=>a.timestamp-b.timestamp);
    let valid=true;
    for(let index=1;index<ordered.length;index++) {
      const previous=ordered[index-1],current=ordered[index],dt=current.timestamp-previous.timestamp,delta=current.along-previous.along;
      if(dt<=0||delta< -policy.jitterMeters||delta>dt*policy.maxSpeedMps+policy.jumpAllowanceMeters){valid=false;break;}
    }
    if(valid){monotonicTrips++;usableTraces.set(tripKey,ordered);}else increment(rejected,'reverse_or_jump_trace');
  }
  const segmentTrips=Array.from({length:Math.max(0,projectedStops.length-1)},()=>new Set());
  for(const [tripKey,trace] of usableTraces)for(const sample of trace) {
    const index=projectedStops.findIndex((stop,i)=>i<projectedStops.length-1&&sample.along>=stop.along&&sample.along<projectedStops[i+1].along);
    if(index>=0)segmentTrips[index].add(tripKey);
  }
  const distances=[...usableTraces.values()].flat().map(value=>value.distance);
  const gpsMatchRate=evaluatedGps?matchedGps/evaluatedGps:null;
  const monotonicRate=traces.size?monotonicTrips/traces.size:null;
  const agreement=officialVerification.pairs?officialVerification.correct/officialVerification.pairs:null;
  const reasons=[];
  if(projectedStops.length!==chain.stops.length)reasons.push('stop_projection_failed');
  if(rejected.stop_projection_ambiguous)reasons.push('stop_projection_ambiguous');
  if(lines.length===0)reasons.push('official_road_corroboration_missing');
  else if(n07MatchRate<policy.minN07MatchRate)reasons.push('official_road_corroboration_below_target');
  if(serviceDays.size<policy.minServiceDays)reasons.push('service_days_insufficient');
  if(usableTraces.size<policy.minTrips)reasons.push('independent_trips_insufficient');
  if(gpsMatchRate===null||gpsMatchRate<policy.minGpsMatchRate)reasons.push('gps_match_below_target');
  if(monotonicRate!==1)reasons.push('direction_validation_failed');
  if(segmentTrips.some(value=>value.size<policy.minTripsPerSegment))reasons.push('segment_coverage_insufficient');
  const geometryReady=reasons.length===0;
  if(officialVerification.pairs<policy.minOfficialPairs)reasons.push('official_reference_insufficient');
  else if(agreement<policy.minOfficialAgreement)reasons.push('official_agreement_below_target');
  return {geometryReady,eligible:geometryReady&&reasons.length===0,points,policy,reasons:[...new Set(reasons)],rejected,
    evidence:{lengthMeters:shape.total,stops:{total:chain.stops.length,projected:projectedStops.length,
      maxDistanceMeters:percentile(projectedStops.map(value=>value.distance),1)},
    officialRoad:{lines:lines.length,points:roadDistances.length,matchRate:n07MatchRate,p95DistanceMeters:percentile(roadDistances,0.95)},
    gps:{evaluated:evaluatedGps,matched:matchedGps,matchRate:gpsMatchRate,p95DistanceMeters:percentile(distances,0.95),
      maxDistanceMeters:percentile(distances,1),serviceDays:[...serviceDays].sort(),independentTrips:usableTraces.size,
      evaluatedTraces:traces.size,monotonicTrips,monotonicRate,
      segments:segmentTrips.map((value,index)=>({index,fromStopId:projectedStops[index]?.stopId||null,
        toStopId:projectedStops[index+1]?.stopId||null,independentTrips:value.size}))},
    officialReference:{pairs:officialVerification.pairs,correct:officialVerification.correct,agreement}}};
}

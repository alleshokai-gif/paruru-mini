import { prepareShape, snapCandidates, distanceToAlong, validPoint } from './geometry.js';
import { POSITION_POLICY } from './policy.js';
const fail=()=>{throw Error('POSITION_INDEX_INVALID');};
const geometryPriority=Object.freeze({gtfs_shape:0,official_odpt_geometry:1,validated_road_geometry:2,observed_corridor:3});
function validateGeometrySources(sources,source,provider) {
  for(const item of sources) {
    if(item?.schemaVersion!==1||item.provider!==provider||item.staticSourceHash!==source.sourceHash||!item.sourceVersion
      ||!Number.isFinite(Date.parse(item.generatedAt))||!Object.hasOwn(geometryPriority,item.sourceType)||!item.chains)fail();
    for(const value of Object.values(item.chains))if(value.eligible&&(!value.geometryId||!Array.isArray(value.points)||value.points.length<2||value.points.some(p=>!validPoint(p))))fail();
  }
}
export function validatePositionArtifact(source,index,provider) {
  if(source?.schemaVersion!==1 || source.provider!==provider || source.sourceVersion!==index.sourceVersion
    || source.sourceHash!==index.sourceHash || !Number.isFinite(Date.parse(source.generatedAt))) fail();
  const allRows=Object.values(index.directions||{}).flat(), selected=new Set(allRows.map(r=>r.tripId));
  if(!source.trips||!source.chains||!source.stops||!source.shapes||Object.keys(source.trips).length!==selected.size)fail();
  for(const row of allRows) {
    const t=source.trips[row.tripId],chain=source.chains[t?.chainId];
    if(!t||t.tripId!==row.tripId||t.routeId!==row.routeId||!chain||chain.shapeId!==t.shapeId||!Array.isArray(chain.stops)||chain.stops.length<2)fail();
    if(!chain.stops.some(s=>s.stopId===row.fromStopId&&s.sequence===row.stopSequence)
      ||!chain.stops.some(s=>s.stopId===row.toStopId&&s.sequence===row.alightSequence))fail();
  }
  if(Object.keys(source.directions||{}).sort().join()!==Object.keys(index.directions||{}).sort().join())fail();
  for(const [id,rows] of Object.entries(index.directions))if(JSON.stringify(source.directions[id])!==JSON.stringify(rows.map(r=>r.tripId)))fail();
  for(const [id,stop] of Object.entries(source.stops)) {
    if(stop.stopId!==id||!stop.name||!stop.position)fail();
    for(const [axis,bound] of [['lat',90],['lon',180]]) {
      const value=stop.position[axis];if(value!==null&&(!Number.isFinite(value)||Math.abs(value)>bound))fail();
    }
  }
  for(const chain of Object.values(source.chains)) {
    let previous=-1,dist=-1;
    for(const s of chain.stops) {
      if(!Number.isInteger(s.sequence)||s.sequence<=previous||!source.stops[s.stopId]?.name)fail();previous=s.sequence;
      if(s.shapeDistTraveled!==null) {if(!Number.isFinite(s.shapeDistTraveled)||s.shapeDistTraveled<0||s.shapeDistTraveled<dist)fail();dist=s.shapeDistTraveled;}
    }
  }
  for(const points of Object.values(source.shapes)) {
    let previous=-1,dist=-1;
    for(const p of points) {
      if(!Number.isInteger(p.sequence)||p.sequence<=previous||!validPoint(p))fail();previous=p.sequence;
      if(p.shapeDistTraveled!==null){if(!Number.isFinite(p.shapeDistTraveled)||p.shapeDistTraveled<0||p.shapeDistTraveled<dist)fail();dist=p.shapeDistTraveled;}
    }
  }
  return source;
}
export function createRouteIndex(source,index,provider,policy=POSITION_POLICY,geometrySources=[]) {
  validatePositionArtifact(source,index,provider);
  validateGeometrySources(geometrySources,source,provider);
  const shapes=new Map(),chains=new Map(),external=[...geometrySources].sort((a,b)=>geometryPriority[a.sourceType]-geometryPriority[b.sourceType]);
  for(const [id,points] of Object.entries(source.shapes)) {
    try {shapes.set(id,prepareShape(points));}catch {shapes.set(id,null);}
  }
  for(const [id,chain] of Object.entries(source.chains)) {
    let geometry=shapes.get(chain.shapeId),geometrySourceType='gtfs_shape',geometrySourceVersion=source.sourceVersion,geometryId=chain.shapeId;
    if(!geometry)for(const candidate of external) {
      const value=candidate.chains[id];if(!value?.eligible)continue;
      try {geometry=prepareShape(value.points);geometrySourceType=candidate.sourceType;geometrySourceVersion=candidate.sourceVersion;geometryId=value.geometryId;break;}catch {}
    }
    if(!geometry){chains.set(id,{supported:false,reason:'route_geometry_unavailable'});continue;}
    const stops=[];let reason=null;
    for(const s of chain.stops) {
      const stop=source.stops[s.stopId];
      if(!validPoint(stop.position)){reason='stop_gps_missing';break;}
      const candidates=snapCandidates(geometry,stop.position,policy.stopRouteMeters,policy.candidateSlackMeters);
      const explicit=geometrySourceType==='gtfs_shape'&&s.shapeDistTraveled!==null?distanceToAlong(geometry,s.shapeDistTraveled):null;
      let along;
      if(explicit!==null) {
        if(!candidates.some(c=>Math.abs(c.along-explicit)<=policy.stopRouteMeters)){reason='stop_shape_distance_conflict';break;} along=explicit;
      } else {
        if(geometrySourceType==='gtfs_shape'&&s.shapeDistTraveled!==null){reason='shape_distance_unusable';break;}
        if(!candidates.length){reason='stop_off_route';break;}
        if(candidates.some(c=>Math.abs(c.along-candidates[0].along)>=policy.ambiguityMeters)){reason='stop_projection_ambiguous';break;}
        along=candidates[0].along;
      }
      if(stops.length && along<=stops.at(-1).along+1){reason='stop_order_ambiguous';break;}
      stops.push({id:s.stopId,name:stop.name,sequence:s.sequence,ordinal:stops.length,along,position:stop.position});
    }
    chains.set(id,reason?{supported:false,reason}:{supported:true,geometry,geometrySourceType,geometrySourceVersion,geometryId,stops});
  }
  return { provider,sourceVersion:source.sourceVersion,sourceHash:source.sourceHash,
    stats:{trips:Object.keys(source.trips).length,shapes:shapes.size,geometrySources:external.map(s=>s.sourceType),chains:chains.size,supportedChains:[...chains.values()].filter(c=>c.supported).length},
    getTrip(tripId){const t=source.trips[tripId];return t?{...t,...chains.get(t.chainId)}:null;} };
}

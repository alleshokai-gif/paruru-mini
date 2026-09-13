// Build-time GTFS extraction only. No original ZIP or whole tables are persisted.
import { readZip } from '../providers/kawasaki/static.js';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { validatePositionArtifact } from '../position/route-index.js';
const hash=v=>createHash('sha256').update(v).digest('hex');
const nullable=v=>v===undefined||v===''?null:Number(v);
const object=(columns,values)=>Object.fromEntries(columns.map((k,i)=>[k,values[i]]));
export function buildPositionStatic(bytes, { index, provider, now=Date.now() }) {
  if (!provider || hash(bytes)!==index.sourceHash) throw Error('POSITION_SOURCE_MISMATCH');
  const wanted=new Map(Object.values(index.directions).flat().map(r=>[r.tripId,r]));
  const trips=Object.create(null), stops=Object.create(null), shapes=Object.create(null), times=new Map(), feed=[];
  const seen=readZip(bytes,new Set(['trips','feed_info']), (name,c,v)=>{
    const r=object(c,v); if(name==='feed_info') {feed.push(r);return;}
    if(!wanted.has(r.trip_id)) return;
    if(trips[r.trip_id] || r.route_id!==wanted.get(r.trip_id).routeId) throw Error('POSITION_TRIP_INVALID');
    trips[r.trip_id]={tripId:r.trip_id,routeId:r.route_id,shapeId:r.shape_id||null}; times.set(r.trip_id,[]);
    if(r.shape_id) shapes[r.shape_id] ??= [];
  });
  if(!seen.has('trips')||feed.length!==1||feed[0].feed_version!==index.sourceVersion||Object.keys(trips).length!==wanted.size) throw Error('POSITION_TRIPS_MISSING');
  const needed=new Set();
  const timeTables=readZip(bytes,new Set(['stop_times']),(_name,c,v)=>{
    const id=v[c.indexOf('trip_id')];if(!times.has(id))return;
    const r=object(c,v); needed.add(r.stop_id);
    times.get(id).push({stopId:r.stop_id,sequence:nullable(r.stop_sequence),shapeDistTraveled:nullable(r.shape_dist_traveled)});
  });
  if(!timeTables.has('stop_times'))throw Error('POSITION_TIMES_MISSING');
  const geometryTables=readZip(bytes,new Set(['stops','shapes']), (name,c,v)=>{
    const r=object(c,v);
    if(name==='stops' && needed.has(r.stop_id)) {
      if(stops[r.stop_id])throw Error('POSITION_STOP_DUPLICATE');
      stops[r.stop_id]={stopId:r.stop_id,name:r.stop_name,position:{lat:nullable(r.stop_lat),lon:nullable(r.stop_lon)}};
    } else if(name==='shapes' && shapes[r.shape_id]) shapes[r.shape_id].push({lat:nullable(r.shape_pt_lat),lon:nullable(r.shape_pt_lon),sequence:nullable(r.shape_pt_sequence),shapeDistTraveled:nullable(r.shape_dist_traveled)});
  });
  if(!geometryTables.has('stops')||Object.keys(stops).length!==needed.size)throw Error('POSITION_STOPS_MISSING');
  for(const points of Object.values(shapes))points.sort((a,b)=>a.sequence-b.sequence);
  const chains=Object.create(null);
  for(const [id,chain] of times) {
    chain.sort((a,b)=>a.sequence-b.sequence);
    const key=hash(JSON.stringify({shapeId:trips[id].shapeId,stops:chain})).slice(0,24);
    chains[key]??={shapeId:trips[id].shapeId,stops:chain}; trips[id].chainId=key;
  }
  const result={schemaVersion:1,provider,sourceVersion:index.sourceVersion,sourceHash:index.sourceHash,generatedAt:new Date(now).toISOString(),
    stops,shapes,chains,trips,directions:Object.fromEntries(Object.entries(index.directions).map(([id,rows])=>[id,rows.map(r=>r.tripId)])),
    sourceCoverage:{shapesTable:geometryTables.has('shapes'),selectedTrips:wanted.size,tripsWithShape:Object.values(trips).filter(t=>t.shapeId&&shapes[t.shapeId]?.length>1).length}};
  validatePositionArtifact(result,index,provider);return result;
}
export function publishPositionStatic(artifact,index,output,{beforeReplace=()=>{}}={}) {
  validatePositionArtifact(artifact,index,artifact.provider);
  const text=JSON.stringify(artifact)+'\n',folder=dirname(output),temp=join(folder,`${randomUUID()}.tmp`);
  mkdirSync(folder,{recursive:true});
  try {
    writeFileSync(temp,text,{flag:'wx',encoding:'utf8',flush:true});
    validatePositionArtifact(JSON.parse(readFileSync(temp,'utf8')),index,artifact.provider); beforeReplace();
    if(existsSync(output))copyFileSync(output,join(folder,`previous-position-${hash(readFileSync(output)).slice(0,16)}.json`));
    renameSync(temp,output);
  } finally {if(existsSync(temp))unlinkSync(temp);}
  return {bytes:Buffer.byteLength(text),sha256:hash(text)};
}

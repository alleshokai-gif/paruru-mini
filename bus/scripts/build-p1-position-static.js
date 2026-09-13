import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readLocalToken } from './local-secret.js';
import { fetchStatic } from '../providers/kawasaki/static-source.js';
import { PROVIDER_ID } from '../providers/kawasaki/config.js';
import { buildPositionStatic,publishPositionStatic } from './position-static.js';
try {
  const token=readLocalToken(),index=JSON.parse(readFileSync(new URL('../generated/p0-static.json',import.meta.url),'utf8'));
  const bytes=await fetchStatic(token,index.sourceDate);
  const artifact=buildPositionStatic(bytes,{index,provider:PROVIDER_ID});
  if([token,encodeURIComponent(token)].some(s=>JSON.stringify(artifact).includes(s)))throw Error('POSITION_SECRET_LEAK');
  const result=publishPositionStatic(artifact,index,fileURLToPath(new URL('../generated/p1-position-static.json',import.meta.url)));
  console.log(JSON.stringify({status:'POSITION_STATIC_BUILD_PASS',sourceVersion:artifact.sourceVersion,...result,coverage:artifact.sourceCoverage,
    stops:Object.keys(artifact.stops).length,chains:Object.keys(artifact.chains).length,
    directions:Object.fromEntries(Object.entries(artifact.directions).map(([id,trips])=>[id,{trips:trips.length,withShape:trips.filter(t=>artifact.trips[t].shapeId&&artifact.shapes[artifact.trips[t].shapeId]?.length>1).length}]))}));
}catch(error){console.log(JSON.stringify({status:'POSITION_STATIC_BUILD_FAILED',code:/^POSITION_[A-Z_]+$/.test(error?.message||'')?error.message:'SOURCE_OR_BUILD_UNAVAILABLE'}));process.exitCode=1;}

// Read-only official ODPT probe. Never writes or prints the token, URL, or response body.
import { readLocalToken } from './local-secret.js';
import { API_ROOT } from '../providers/kawasaki/config.js';

const MAX_BYTES=24*1024*1024;
let stage='operator';
const countCoordinates=value=>Array.isArray(value)
  ? (value.length>=2 && value.every(Number.isFinite) ? 1 : value.reduce((n,v)=>n+countCoordinates(v),0)) : 0;
async function get(type,params={}) {
  const url=new URL(API_ROOT);url.pathname+=type;url.searchParams.set('acl:consumerKey',readLocalToken());
  for(const [key,value] of Object.entries(params))url.searchParams.set(key,value);
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error(`HTTP_${response.status}`);
  if(!response.headers.get('content-type')?.includes('json'))throw Error('CONTENT_TYPE');
  if(Number(response.headers.get('content-length'))>MAX_BYTES)throw Error('SIZE');
  const reader=response.body.getReader(),chunks=[];let size=0;
  for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;
    if(size>MAX_BYTES){await reader.cancel();throw Error('SIZE');}chunks.push(part.value);}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

try {
  const operators=await get('odpt:Operator');
  const discovered=operators.filter(v=>/Kawasaki|川崎市交通局/i.test(JSON.stringify(v)))
    .map(v=>v['owl:sameAs']).filter(v=>typeof v==='string');
  const candidates=discovered.length?discovered:[
    'odpt.Operator:TransportationBureau_CityOfKawasaki','odpt.Operator:KawasakiCityBus'];
  stage='route_pattern';const patterns=[];
  for(const operator of candidates)patterns.push(...await get('odpt:BusroutePattern',{'odpt:operator':operator}));
  const geometries=patterns.map(v=>v['ug:region']).filter(Boolean);
  const summary={status:'POSITION_SOURCE_PROBE_PASS',operatorsReturned:operators.length,
    operatorDiscoveredInRdf:discovered.length>0,operatorCandidates:candidates,routePatterns:patterns.length,
    patternsWithRegion:geometries.length,geometryTypes:Object.fromEntries([...new Set(geometries.map(v=>v?.type??'missing'))]
      .map(type=>[type,geometries.filter(v=>(v?.type??'missing')===type).length])),
    coordinatePoints:geometries.reduce((n,v)=>n+countCoordinates(v?.coordinates),0),
    noborito05:patterns.filter(v=>/登.?05|登０５/.test(String(v['dc:title']||''))).map(v=>({
      id:v['owl:sameAs']??null,title:v['dc:title']??null,direction:v['odpt:direction']??null,
      stops:Array.isArray(v['odpt:busstopPoleOrder'])?v['odpt:busstopPoleOrder'].length:0,
      geometryType:v['ug:region']?.type??null,coordinatePoints:countCoordinates(v['ug:region']?.coordinates)}))};
  console.log(JSON.stringify(summary));
} catch (error) {
  const code=/^(?:HTTP_\d{3}|CONTENT_TYPE|SIZE|OPERATOR)$/.test(error?.message||'')?error.message:'UPSTREAM';
  console.log(JSON.stringify({status:'POSITION_SOURCE_PROBE_FAILED',stage,code}));process.exitCode=1;
}

// Build-time research probe only. Public services are never called from the Bus runtime.
import { unzipSync } from 'fflate';

const SOURCES=Object.freeze({
  n07:'https://nlftp.mlit.go.jp/ksj/gml/data/N07/N07-22/N07-22_14_SHP.zip',
  osm:'https://api.openstreetmap.org/api/0.6/relation/7109917/full.json'
});
async function bounded(url,maxBytes,contentTypes) {
  const response=await fetch(url,{redirect:'error',headers:{'user-agent':'PALURU-Bus-Research/1.0'},signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error(`HTTP_${response.status}`);
  const type=response.headers.get('content-type')||'';
  if(!contentTypes.some(value=>type.includes(value)))throw Error('CONTENT_TYPE');
  if(Number(response.headers.get('content-length'))>maxBytes)throw Error('SIZE');
  const reader=response.body.getReader(),chunks=[];let size=0;
  for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;
    if(size>maxBytes){await reader.cancel();throw Error('SIZE');}chunks.push(part.value);}
  return Buffer.concat(chunks);
}

try {
  const [n07Bytes,osmBytes]=await Promise.all([
    bounded(SOURCES.n07,16*1024*1024,['zip','octet-stream']),
    bounded(SOURCES.osm,8*1024*1024,['json'])
  ]);
  const files=unzipSync(n07Bytes),osm=JSON.parse(osmBytes.toString('utf8'));
  const relation=(osm.elements||[]).find(value=>value.type==='relation'&&value.id===7109917);
  if(!relation)throw Error('OSM_RELATION_MISSING');
  const ways=(osm.elements||[]).filter(value=>value.type==='way'),nodes=(osm.elements||[]).filter(value=>value.type==='node');
  const result={status:'ROAD_SOURCE_PROBE_PASS',n07:{bytes:n07Bytes.length,entries:Object.entries(files).map(([name,value])=>({name,bytes:value.length}))},
    osm:{bytes:osmBytes.length,relationId:relation.id,version:relation.version,timestamp:relation.timestamp,
      route:relation.tags?.route||null,ref:relation.tags?.ref||null,name:relation.tags?.name||null,
      members:relation.members?.length||0,wayMembers:relation.members?.filter(value=>value.type==='way').length||0,
      stopMembers:relation.members?.filter(value=>value.type==='node').length||0,ways:ways.length,nodes:nodes.length}};
  console.log(JSON.stringify(result));
} catch(error) {
  const code=/^(?:HTTP_\d{3}|CONTENT_TYPE|SIZE|OSM_RELATION_MISSING)$/.test(error?.message||'')?error.message:'ROAD_SOURCE_UNAVAILABLE';
  console.log(JSON.stringify({status:'ROAD_SOURCE_PROBE_FAILED',code}));process.exitCode=1;
}

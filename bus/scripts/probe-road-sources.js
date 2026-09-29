// Build-time research probe only. Public services are never called from the Bus runtime.
import { unzipSync } from 'fflate';

const SOURCES=Object.freeze({
  n07:'https://nlftp.mlit.go.jp/ksj/gml/data/N07/N07-22/N07-22_14_SHP.zip',
  osm:'https://api.openstreetmap.org/api/0.6/relation/7109917/full.json'
});
async function bounded(url,maxBytes,contentTypes) {
  let response;
  try {
    response=await fetch(url,{redirect:'error',headers:{'user-agent':'PALURU-Bus-Research/1.0'},signal:AbortSignal.timeout(30000)});
  } catch(error) {
    let cause=error,code;
    for(let depth=0;cause&&depth<5;depth++,cause=cause.cause) {
      if(typeof cause.code==='string'&&/^(?:EACCES|ENETUNREACH|ENOTFOUND|EAI_AGAIN|EAI_FAIL|ECONNREFUSED|ECONNRESET|ETIMEDOUT|CERT_[A-Z_]+|ERR_TLS_[A-Z_]+|ERR_SSL_[A-Z_]+|UNABLE_TO_VERIFY_LEAF_SIGNATURE|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UND_ERR_[A-Z_]+)$/.test(cause.code)) {
        code=cause.code;break;
      }
    }
    if(code)throw Error(`FETCH_${code}`);
    if(error?.name==='TimeoutError'||error?.name==='AbortError')throw Error('FETCH_TIMEOUT');
    throw Error('FETCH_FAILED');
  }
  if(!response.ok)throw Error(`HTTP_${response.status}`);
  const type=response.headers.get('content-type')||'';
  if(!contentTypes.some(value=>type.toLowerCase().includes(value)))throw Error(`CONTENT_TYPE_${type.split(';')[0].trim().toLowerCase().replace(/[^a-z0-9.+-]/g,'_').slice(0,48)||'MISSING'}`);
  if(Number(response.headers.get('content-length'))>maxBytes)throw Error('SIZE');
  const reader=response.body.getReader(),chunks=[];let size=0;
  for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;
    if(size>maxBytes){await reader.cancel();throw Error('SIZE');}chunks.push(part.value);}
  return Buffer.concat(chunks);
}

try {
  let n07Bytes,files,geojsonEntry,geojson,osmBytes,osm,relation;
  try { n07Bytes=await bounded(SOURCES.n07,16*1024*1024,['zip','octet-stream']); }
  catch(error) { throw Error(`N07_FETCH_${error.message}`); }
  try { files=unzipSync(n07Bytes); }
  catch { throw Error('N07_ZIP_PARSE_FAILED'); }
  geojsonEntry=Object.entries(files).find(([name])=>name.endsWith('.geojson'));
  if(!geojsonEntry)throw Error('N07_GEOJSON_MISSING');
  try { geojson=JSON.parse(Buffer.from(geojsonEntry[1]).toString('utf8')); }
  catch { throw Error('N07_GEOJSON_PARSE_FAILED'); }
  if(!Array.isArray(geojson?.features))throw Error('N07_GEOJSON_SCHEMA_INVALID');
  let n07Lines=0,n07KawasakiFeatures=0;
  for(const feature of geojson.features) {
    if(feature?.properties?.N07_001!=='川崎市')continue;
    n07KawasakiFeatures++;
    if(['LineString','MultiLineString'].includes(feature?.geometry?.type))n07Lines++;
  }
  try { osmBytes=await bounded(SOURCES.osm,8*1024*1024,['json']); }
  catch(error) { throw Error(`OSM_FETCH_${error.message}`); }
  try { osm=JSON.parse(osmBytes.toString('utf8')); }
  catch { throw Error('OSM_JSON_PARSE_FAILED'); }
  relation=(osm.elements||[]).find(value=>value.type==='relation'&&value.id===7109917);
  if(!relation)throw Error('OSM_RELATION_MISSING');
  const ways=(osm.elements||[]).filter(value=>value.type==='way'),nodes=(osm.elements||[]).filter(value=>value.type==='node');
  const result={status:'ROAD_SOURCE_PROBE_PASS',n07:{bytes:n07Bytes.length,entries:Object.entries(files).map(([name,value])=>({name,bytes:value.length})),
      geojsonFeatures:geojson.features.length,kawasakiFeatures:n07KawasakiFeatures,kawasakiLineFeatures:n07Lines},
    osm:{bytes:osmBytes.length,relationId:relation.id,version:relation.version,timestamp:relation.timestamp,
      route:relation.tags?.route||null,ref:relation.tags?.ref||null,name:relation.tags?.name||null,
      members:relation.members?.length||0,wayMembers:relation.members?.filter(value=>value.type==='way').length||0,
      stopMembers:relation.members?.filter(value=>value.type==='node').length||0,ways:ways.length,nodes:nodes.length}};
  console.log(JSON.stringify(result));
} catch(error) {
  const reason=/^(?:N07|OSM)_FETCH_(?:HTTP_\d{3}|FETCH_[A-Z0-9_]+|CONTENT_TYPE_[A-Z0-9_.+-]+|SIZE)$|^(?:N07_ZIP_PARSE_FAILED|N07_GEOJSON_MISSING|N07_GEOJSON_PARSE_FAILED|N07_GEOJSON_SCHEMA_INVALID|OSM_JSON_PARSE_FAILED|OSM_RELATION_MISSING)$/.test(error?.message||'')
    ?error.message:'ROAD_SOURCE_UNAVAILABLE';
  console.log(JSON.stringify({status:'ROAD_SOURCE_PROBE_FAILED',reason}));process.exitCode=1;
}

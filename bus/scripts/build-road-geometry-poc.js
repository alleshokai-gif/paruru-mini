// Offline/build-time PoC. Cloud Run never downloads OSM or MLIT geometry.
import { createHash,randomUUID } from 'node:crypto';
import { copyFileSync,existsSync,readFileSync,readdirSync,renameSync,unlinkSync,writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { stitchOsmRoute,validateRoadGeometry } from '../position/road-geometry.js';

const SOURCES=Object.freeze({
  n07:'https://nlftp.mlit.go.jp/ksj/gml/data/N07/N07-22/N07-22_14_SHP.zip',
  osm:'https://api.openstreetmap.org/api/0.6/relation/7109917/full.json'
});
const sha256=value=>createHash('sha256').update(value).digest('hex');
async function bounded(url,maxBytes,types) {
  const response=await fetch(url,{redirect:'error',headers:{'user-agent':'PALURU-Bus-Research/1.0'},signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error(`HTTP_${response.status}`);
  const type=response.headers.get('content-type')||'';if(!types.some(value=>type.includes(value)))throw Error('CONTENT_TYPE');
  if(Number(response.headers.get('content-length'))>maxBytes)throw Error('SIZE');
  const chunks=[];let size=0,reader=response.body.getReader();
  for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>maxBytes){await reader.cancel();throw Error('SIZE');}chunks.push(part.value);}
  return Buffer.concat(chunks);
}
function geojsonLines(data) {
  const lines=[];
  for(const feature of data.features||[]) {
    if(feature.properties?.N07_001!=='川崎市')continue;
    const geometry=feature.geometry;if(!geometry)continue;
    const sets=geometry.type==='LineString'?[geometry.coordinates]:geometry.type==='MultiLineString'?geometry.coordinates:[];
    for(const set of sets) {
      const line=set.map(value=>({lat:Number(value[1]),lon:Number(value[0])}));
      if(line.length>1&&line.every(value=>Number.isFinite(value.lat)&&Number.isFinite(value.lon)))lines.push(line);
    }
  }
  return lines;
}
function captures(positionStatic,chainId) {
  const folder=new URL('../generated/',import.meta.url),names=readdirSync(folder).filter(name=>/^position-p0-\d{8}T\d{6}\.json$/.test(name));
  const seen=new Set(),samples=[];
  for(const name of names) {
    const capture=JSON.parse(readFileSync(new URL(name,folder),'utf8'));
    if(capture.sourceVersion!==positionStatic.sourceVersion)continue;
    for(const sample of capture.samples||[]) {
      const receivedAt=Date.parse(sample.receivedAt)/1000,direction=(sample.directions||[]).find(value=>value.id==='home_to_noborito');
      for(const vehicle of direction?.vehicles||[]) {
        if(positionStatic.trips[vehicle.tripId]?.chainId!==chainId||vehicle.routeId!=='10044')continue;
        const key=`${vehicle.startDate}|${vehicle.tripId}|${vehicle.timestamp}|${vehicle.lat}|${vehicle.lon}`;if(seen.has(key))continue;seen.add(key);
        samples.push({tripKey:`${vehicle.startDate}:${vehicle.tripId}`,serviceDay:vehicle.startDate,timestamp:Number(vehicle.timestamp),
          receivedAt,lat:Number(vehicle.lat),lon:Number(vehicle.lon)});
      }
    }
  }
  return {files:names.length,samples};
}
function publish(value,target) {
  const text=JSON.stringify(value)+'\n',temporary=new URL(`${randomUUID()}.tmp`,new URL('./',target));
  try {
    writeFileSync(temporary,text,{flag:'wx',encoding:'utf8',flush:true});JSON.parse(readFileSync(temporary,'utf8'));
    if(existsSync(target))copyFileSync(target,new URL(`previous-road-${sha256(readFileSync(target)).slice(0,16)}.json`,new URL('./',target)));
    renameSync(temporary,target);
  } finally {if(existsSync(temporary))unlinkSync(temporary);}
  return {bytes:Buffer.byteLength(text),sha256:sha256(text)};
}

try {
  const index=JSON.parse(readFileSync(new URL('../generated/p0-static.json',import.meta.url),'utf8'));
  const positionStatic=JSON.parse(readFileSync(new URL('../generated/p1-position-static.json',import.meta.url),'utf8'));
  const chainIds=new Set(index.directions.home_to_noborito.filter(row=>row.routeId==='10044').map(row=>positionStatic.trips[row.tripId]?.chainId));
  const matches=[...chainIds].filter(id=>{const chain=positionStatic.chains[id];return chain?.stops[0]?.stopId==='234_1'&&chain.stops.at(-1)?.stopId==='362_1';});
  if(matches.length!==1)throw Error('ROAD_CHAIN_AMBIGUOUS');
  const chainId=matches[0],chain=positionStatic.chains[chainId];
  const [n07Bytes,osmBytes]=await Promise.all([
    bounded(SOURCES.n07,16*1024*1024,['zip','octet-stream']),bounded(SOURCES.osm,8*1024*1024,['json'])
  ]);
  const n07Files=unzipSync(n07Bytes),geojsonEntry=Object.entries(n07Files).find(([name])=>name.endsWith('.geojson'));
  if(!geojsonEntry)throw Error('ROAD_N07_GEOJSON_MISSING');
  const lines=geojsonLines(JSON.parse(Buffer.from(geojsonEntry[1]).toString('utf8')));
  if(!lines.length)throw Error('ROAD_N07_OPERATOR_MISSING');
  const stitched=stitchOsmRoute(JSON.parse(osmBytes.toString('utf8')),7109917);
  if(stitched.gaps!==0)throw Error('ROAD_OSM_DISCONNECTED');
  const observed=captures(positionStatic,chainId),referencePath=new URL('../generated/position-reference-phase2-summary.json',import.meta.url);
  const reference=existsSync(referencePath)?JSON.parse(readFileSync(referencePath,'utf8')):{};
  const validation=validateRoadGeometry({points:stitched.points,chain,stops:positionStatic.stops,gpsSamples:observed.samples,
    corroboratingLines:lines,officialVerification:{pairs:Number(reference.adjudicatedPairs)||0,
      correct:Number.isFinite(reference.agreementRate)?Math.round(reference.adjudicatedPairs*reference.agreementRate):0}});
  const artifact={schemaVersion:1,provider:'kawasaki',sourceType:'validated_road_geometry',
    sourceVersion:`osm:7109917:v${stitched.relation.version}+mlit:n07:2022`,staticSourceHash:positionStatic.sourceHash,
    generatedAt:new Date().toISOString(),directionId:'home_to_noborito',
    attribution:{osm:{text:'© OpenStreetMap contributors',url:'https://www.openstreetmap.org/copyright',license:'ODbL 1.0',
      relationId:stitched.relation.id,version:stitched.relation.version,timestamp:stitched.relation.timestamp},
      mlit:{text:'出典：国土数値情報（バスルートデータ）（国土交通省）を加工して作成',
        url:'https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N07-v2_0.html',year:2022,sourceSha256:sha256(n07Bytes)}},
    chains:{[chainId]:{geometryId:`osm:relation:${stitched.relation.id}:v${stitched.relation.version}`,
      eligible:validation.eligible,geometryReady:validation.geometryReady,points:stitched.points,
      route:{ref:stitched.relation.ref,name:stitched.relation.name,wayCount:stitched.wayCount,gaps:stitched.gaps,gapMeters:stitched.gapMeters},
      captures:{files:observed.files},evidence:validation.evidence,rejected:validation.rejected,reasons:validation.reasons}}};
  const output=new URL('../generated/road-geometry-home-to-noborito.json',import.meta.url),published=publish(artifact,output);
  console.log(JSON.stringify({status:'ROAD_GEOMETRY_POC_PASS',chainId,sourceVersion:artifact.sourceVersion,...published,
    geometryReady:validation.geometryReady,eligible:validation.eligible,points:stitched.points.length,n07Lines:lines.length,
    captureFiles:observed.files,gps:validation.evidence.gps,stops:validation.evidence.stops,
    officialRoad:validation.evidence.officialRoad,officialReference:validation.evidence.officialReference,reasons:validation.reasons}));
} catch(error) {
  const code=/^(?:HTTP_\d{3}|CONTENT_TYPE|SIZE|ROAD_[A-Z_]+)$/.test(error?.message||'')?error.message:'ROAD_BUILD_UNAVAILABLE';
  console.log(JSON.stringify({status:'ROAD_GEOMETRY_POC_FAILED',code}));process.exitCode=1;
}

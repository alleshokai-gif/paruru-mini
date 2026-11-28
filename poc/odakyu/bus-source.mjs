import {readFile} from 'node:fs/promises';
import {validateArtifact} from '../../bus/runtime/static-artifact.js';
import source from '../../bus/config/static-source.json' with {type:'json'};
import {P0_QUERIES} from '../../bus/config/queries.js';
import {KAWASAKI_JOURNEY_QUERIES} from '../../bus/providers/kawasaki/journey-config.js';
import {KAWASAKI_CONTEXT} from '../../bus/providers/kawasaki/context.js';
import {getFutureBuses} from '../../bus/journey/future-bus.js';
import {HOME_TRANSFER_MINUTES,HOME_RUSH_TRANSFER_MINUTES} from '../../bus/rail/home-route-service.js';
import {HOME_ROUTE_TEMPLATES} from '../../bus/journey/home-route.js';
import {NOBORITO_MUKOUGAOKA_JOURNEY} from '../../bus/journey/config.js';
import {LIMITS} from '../../bus/config/policy.js';
import {serviceEpoch} from './home-bus.mjs';
const root=new URL('../../',import.meta.url);
const stationNames={noborito:'Noborito',mukougaoka:'MukogaokaYuen'};
const fresh=(at,now,limit)=>Number.isFinite(at)&&at<=now+5&&now-at<=limit;
// Same public, read-only PALURU endpoint as its shipped UI. No new credential,
// deployment, GTFS merge across revisions, or production service modification.
export function createBoardBusSource({fetcher=fetch,clock=()=>Date.now()/1000}={}){
  let indexes,endpoint,cache,pending;
  const places=HOME_ROUTE_TEMPLATES.university.map(p=>({id:p.placeId,station:stationNames[p.stationId],label:p.label,
    sourceIds:[...p.sourceIds],walkMinutes:HOME_TRANSFER_MINUTES[p.placeId],rushMinutes:HOME_RUSH_TRANSFER_MINUTES[p.placeId]??HOME_TRANSFER_MINUTES[p.placeId]}));
  async function init(){
    if(indexes)return;
    const [p0,journey,config]=await Promise.all(['bus/generated/p0-static.json','bus/generated/kawasaki-p2-5-static.json','features/bus/config.js'].map(p=>readFile(new URL(p,root),'utf8')));
    const primary=validateArtifact(JSON.parse(p0),source.sourceDate),extension=JSON.parse(journey);
    indexes=[{index:primary,queries:P0_QUERIES},{index:extension,queries:KAWASAKI_JOURNEY_QUERIES}];
    const match=/globalThis\.PALURU_BUS_API_URL\s*=\s*['"](https:\/\/[^'"]+)['"]/.exec(config);
    if(!match)throw Error('BUS_ENDPOINT_UNCONFIGURED');
    endpoint=new URL('/api/bus/journey',match[1]);endpoint.searchParams.set('id',NOBORITO_MUKOUGAOKA_JOURNEY.id);
  }
  async function live(){
    const now=clock();if(cache&&fresh(cache.fetchedAt,now,LIMITS.rtCacheSec))return cache;
    if(pending)return pending;
    pending=(async()=>{
      try{
        const r=await fetcher(endpoint,{signal:AbortSignal.timeout(LIMITS.requestTimeoutMs),redirect:'error'});
        if(!r.ok)throw Error('BUS_HTTP_FAILED');
        const body=await r.json();
        if(body.success!==true||!Array.isArray(body.children)||!fresh(body.generatedAt,clock(),LIMITS.feedMaxAgeSec))throw Error('BUS_RESPONSE_STALE');
        return cache={state:'available',fetchedAt:clock(),generatedAt:body.generatedAt,rows:body.children.flatMap(c=>(c.decisionGroup?.arrivals||[]).map(row=>({...row,station:stationNames[c.id],sourceUpdatedAt:row.position?.observedAt??c.providers?.find(p=>p.provider===row.provider)?.sourceUpdatedAt??null})))};
      }catch{return cache={state:'unavailable',fetchedAt:clock(),rows:[]};}
      finally{pending=null;}
    })();return pending;
  }
  return async function load({serviceDate,minute}){
    const simulatedNow=serviceEpoch(serviceDate,minute);await init();
    const fetchedAt=clock(),buses=[],unavailableSources=[];
    const wanted=new Set(places.flatMap(p=>p.sourceIds));
    // Older local artifacts need not share a feed revision. Query each source
    // separately; never merge their GTFS tables or relabel a missing branch.
    for(const {index,queries} of indexes)for(const query of queries){
      const id=`kawasaki:${query.id}`;if(!wanted.has(id))continue;
      if(!index.directions?.[query.id]){unavailableSources.push(id);continue;}
      try{buses.push(...getFutureBuses({index,queries:[query],providerContext:KAWASAKI_CONTEXT,
        now:simulatedNow,boardingAt:simulatedNow,limit:100}).results[0].arrivals.map(b=>({...b,sourceVersion:index.sourceVersion,observedAt:null})));}
      catch{unavailableSources.push(id);}
    }
    const allIds=new Set(indexes.flatMap(x=>x.queries).map(q=>`kawasaki:${q.id}`));
    for(const id of wanted)if(!allIds.has(id))unavailableSources.push(id);
    const liveResult=Math.abs(simulatedNow-fetchedAt)<=LIMITS.feedMaxAgeSec?await live():{state:'simulation',rows:[]};
    let matched=0;
    for(const bus of buses){
      const matches=liveResult.rows.filter(r=>r.provider===bus.provider&&r.sourceId===bus.queryId
        &&r.id===`${bus.provider}:${bus.tripId}`&&r.routeId===bus.routeId&&r.originStop?.id===bus.fromStopId
        &&r.scheduledDeparture===bus.scheduledDeparture);
      if(matches.length!==1)continue;
      const row=matches[0];
      if(!fresh(row.sourceUpdatedAt,fetchedAt,LIMITS.feedMaxAgeSec))continue;
      if(['departure_pending','departure_overdue','departure_uncertain','unknown','departed','cancelled'].includes(row.departureState)){
        bus.departureState=row.departureState;continue;
      }
      if(row.realtimeState!=='realtime'||!Number.isFinite(row.estimatedDeparture))continue;
      bus.departureAt=bus.estimatedDeparture=row.estimatedDeparture;
      bus.departureState='realtime';bus.timingQuality='departure_delay_projection';bus.observedAt=row.sourceUpdatedAt;
      if(Number.isFinite(bus.scheduledArrival))bus.estimatedArrival=bus.scheduledArrival+bus.departureAt-bus.scheduledDeparture;
      matched++;
    }
    return {serviceDate,minute,fetchedAt:clock(),maxAgeSec:LIMITS.feedMaxAgeSec,bufferMinutes:1,
      places,buses,unavailableSources:[...new Set(unavailableSources)],live:{state:liveResult.state,matched,source: endpoint.href},
      attribution:'川崎市交通局・東急バス / 公共交通オープンデータセンター'};
  };
}

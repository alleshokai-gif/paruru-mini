// Read-only evidence probe. It prints aggregate field coverage, never source rows, URLs, tokens or vehicle IDs.
import { readFileSync } from 'node:fs';
import bindings from 'gtfs-realtime-bindings';
import { readLocalToken } from './local-secret.js';
import { fetchStatic } from '../providers/kawasaki/static-source.js';
import { fetchRealtime } from '../providers/kawasaki/adapter.js';
import { readZip } from '../providers/kawasaki/static.js';

const own=(value,key)=>value&&Object.hasOwn(value,key);
const id=value=>typeof value==='string'&&value.length?value:null;
const row=(columns,values)=>Object.fromEntries(columns.map((name,index)=>[name,values[index]]));
const increment=(target,key)=>{target[key]=(target[key]||0)+1;};

try {
  const token=readLocalToken();
  const index=JSON.parse(readFileSync(new URL('../generated/p0-static.json',import.meta.url),'utf8'));
  const selected=new Map();
  for(const [directionId,rows] of Object.entries(index.directions))for(const value of rows) {
    const current=selected.get(value.tripId)||{directions:new Set(),row:value};
    current.directions.add(directionId);selected.set(value.tripId,current);
  }

  const bytes=await fetchStatic(token,index.sourceDate);
  const trips=new Map(),bounds=new Map(),headers={};
  readZip(bytes,new Set(['trips','stop_times']), (name,columns,values)=>{
    headers[name]??=columns;
    const value=row(columns,values),tripId=value.trip_id;
    if(!selected.has(tripId))return;
    if(name==='trips')trips.set(tripId,{blockId:value.block_id||null,shapeId:value.shape_id||null});
    else {
      const sequence=Number(value.stop_sequence);
      if(!Number.isInteger(sequence))return;
      const point={stopId:value.stop_id,sequence,arrival:value.arrival_time||null,departure:value.departure_time||null};
      const current=bounds.get(tripId)||{first:point,last:point};
      if(sequence<current.first.sequence)current.first=point;
      if(sequence>current.last.sequence)current.last=point;
      bounds.set(tripId,current);
    }
  });

  const directions={};
  for(const [directionId,rows] of Object.entries(index.directions)) {
    const summary={trips:rows.length,fromIsOrigin:0,fromNotOrigin:0,blockIdPresent:0,blockIdMissing:0,
      distinctBlocks:new Set(),fromStops:{},routes:{},originStops:{},terminalStops:{}};
    for(const value of rows) {
      const trip=trips.get(value.tripId),bound=bounds.get(value.tripId);
      const isOrigin=!!bound&&bound.first.stopId===value.fromStopId&&bound.first.sequence===value.stopSequence;
      increment(summary,isOrigin?'fromIsOrigin':'fromNotOrigin');
      increment(summary.fromStops,value.fromStopId);increment(summary.routes,value.routeId);
      if(bound){increment(summary.originStops,bound.first.stopId);increment(summary.terminalStops,bound.last.stopId);}
      if(trip?.blockId){summary.blockIdPresent++;summary.distinctBlocks.add(trip.blockId);}else summary.blockIdMissing++;
    }
    directions[directionId]={...summary,distinctBlocks:summary.distinctBlocks.size};
  }

  const raw=await fetchRealtime(token),feed=bindings.transit_realtime.FeedMessage.decode(raw);
  const vehiclePositions=[],tripUpdates=[];
  for(const entity of feed.entity||[]) {
    if(entity.vehicle)vehiclePositions.push(entity.vehicle);
    if(entity.tripUpdate)tripUpdates.push(entity.tripUpdate);
  }
  const vehicleDescriptor=v=>({id:id(v?.vehicle?.id),label:id(v?.vehicle?.label),licensePlate:id(v?.vehicle?.licensePlate)});
  const coverage=list=>({entities:list.length,vehicleId:list.filter(v=>vehicleDescriptor(v).id).length,
    vehicleLabel:list.filter(v=>vehicleDescriptor(v).label).length,licensePlate:list.filter(v=>vehicleDescriptor(v).licensePlate).length});
  const vpByTrip=new Map();
  for(const value of vehiclePositions) {
    const key=`${value.trip?.tripId||''}|${value.trip?.startDate||''}`;
    const vehicle=vehicleDescriptor(value).id;if(key!=='|'&&vehicle)vpByTrip.set(key,vehicle);
  }
  let exactSameTripVehicleAgreement=0,exactSameTripVehicleConflict=0;
  for(const value of tripUpdates) {
    const key=`${value.trip?.tripId||''}|${value.trip?.startDate||''}`,vehicle=vehicleDescriptor(value).id,other=vpByTrip.get(key);
    if(vehicle&&other){if(vehicle===other)exactSameTripVehicleAgreement++;else exactSameTripVehicleConflict++;}
  }
  const activeSelected=new Set([...vehiclePositions,...tripUpdates].map(v=>v.trip?.tripId).filter(v=>selected.has(v)));
  const result={status:'DEPARTURE_EVIDENCE_PROBE_PASS',sourceVersion:index.sourceVersion,
    static:{headers:{trips:headers.trips||[],stopTimes:headers.stop_times||[]},selectedTrips:selected.size,
      tripsParsed:trips.size,stopChainsParsed:bounds.size,directions},
    realtime:{feedTimestamp:Number(feed.header?.timestamp)||null,vehiclePositions:coverage(vehiclePositions),tripUpdates:coverage(tripUpdates),
      activeSelectedTrips:activeSelected.size,exactSameTripVehicleAgreement,exactSameTripVehicleConflict},
    conclusions:{blockLinkPossible:[...trips.values()].some(v=>v.blockId),vehicleLinkObservable:
      vehiclePositions.some(v=>vehicleDescriptor(v).id)||tripUpdates.some(v=>vehicleDescriptor(v).id)}};
  const encoded=JSON.stringify(result);
  if(encoded.includes(token)||encoded.includes(encodeURIComponent(token)))throw Error('SECRET_LEAK');
  console.log(encoded);
} catch(error) {
  const code=/^(?:BUS|STATIC|DEPARTURE|SECRET)_[A-Z_]+$/.test(error?.message||'')?error.message:'SOURCE_OR_PROBE_UNAVAILABLE';
  console.log(JSON.stringify({status:'DEPARTURE_EVIDENCE_PROBE_FAILED',code}));process.exitCode=1;
}

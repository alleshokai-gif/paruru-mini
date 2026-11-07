// Input service dates/minutes are Asia/Tokyo. BUS timestamps and freshness use
// UTC epoch seconds; conversion is confined to serviceEpoch / busClock.
const DAY=86400,JST=9*3600;
export function serviceEpoch(date,minute){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||new Date(`${date}T00:00:00Z`).toISOString().slice(0,10)!==date||!Number.isInteger(minute)||minute<0||minute>=2880)throw Error('BUS_DATE_INVALID');
  return Date.parse(`${date}T00:00:00+09:00`)/1000+minute*60;
}
export function busClock(epoch){const v=((epoch+JST)%DAY+DAY)%DAY;return `${String(Math.floor(v/3600)).padStart(2,'0')}:${String(Math.floor(v%3600/60)).padStart(2,'0')}`;}
export function busConnections(snapshot,station,arrival,{wallNow=Date.now()/1000}={}){
  if(!Number.isInteger(arrival))return {status:'rail_arrival_missing',options:[]};
  if(!snapshot||snapshot.error)return {status:'unavailable',options:[]};
  if(wallNow-snapshot.fetchedAt>snapshot.maxAgeSec||snapshot.fetchedAt>wallNow+5)return {status:'stale',options:[]};
  const railAt=serviceEpoch(snapshot.serviceDate,arrival),now=serviceEpoch(snapshot.serviceDate,snapshot.minute);
  if(railAt<now)return {status:'rail_arrived',options:[]};
  const options=[];
  for(const place of snapshot.places.filter(p=>p.station===station)){
    for(const bus of snapshot.buses.filter(b=>place.sourceIds.includes(`${b.provider}:${b.queryId}`))){
      if(bus.departureState==='realtime'&&(!Number.isFinite(bus.observedAt)||wallNow-bus.observedAt>snapshot.maxAgeSec||bus.observedAt>wallNow+5))continue;
      if(!['scheduled','realtime'].includes(bus.departureState)||!Number.isFinite(bus.departureAt))continue;
      const gap=bus.departureAt-railAt;
      if(gap<place.rushMinutes*60||bus.departureAt<now)continue;
      const likely=gap>=(place.walkMinutes+snapshot.bufferMinutes)*60;
      options.push({...bus,placeId:place.id,placeLabel:place.label,walkMinutes:place.walkMinutes,walkMeasured:false,
        connection:likely?'likely':'tight',guaranteed:false,waitMinutes:Math.max(0,Math.round(gap/60-place.walkMinutes)),
        railArrivalAt:railAt,slackMinutes:Math.round(gap/60-place.walkMinutes),
        homeArrivalAt:Number.isFinite(bus.estimatedArrival)?bus.estimatedArrival:null});
    }
  }
  options.sort((a,b)=>a.departureAt-b.departureAt||a.placeId.localeCompare(b.placeId));
  return {status:options.length?'available':'no_connection',options,partial:snapshot.unavailableSources.length>0};
}

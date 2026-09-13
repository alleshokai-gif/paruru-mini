import { distanceMeters, prepareShape, projectToSegment, snapCandidates, validPoint } from './geometry.js';

export const OBSERVED_CORRIDOR_POLICY=Object.freeze({
  maxAgeSec:120,futureSec:5,maxSpeedMps:22,jumpAllowanceMeters:20,maxGapSec:180,
  anchorDistanceMeters:220,anchorAmbiguityMeters:20,reverseFractionTolerance:0.25,
  binsPerSegment:6,minServiceDays:3,minTrips:5,minTripsPerSegment:3,
  validationMeters:60,minLeaveOneOutRate:0.95,minReferencePairs:20,minOfficialAgreement:0.95
});

const increment=(bag,key)=>{bag[key]=(bag[key]||0)+1;};
const median=values=>{const a=[...values].sort((x,y)=>x-y),n=a.length;return n%2?a[(n-1)/2]:(a[n/2-1]+a[n/2])/2;};
const medianPoint=points=>({lat:median(points.map(p=>p.lat)),lon:median(points.map(p=>p.lon))});
const percentile=(values,p)=>{if(!values.length)return null;const a=[...values].sort((x,y)=>x-y);return a[Math.min(a.length-1,Math.floor((a.length-1)*p))];};
const serviceDay=date=>/^\d{8}$/.test(date||'')?Date.parse(`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6)}T00:00:00+09:00`)/1000:NaN;
const pushUnique=(points,point)=>{if(!points.length||distanceMeters(points.at(-1),point)>1)points.push(point);};

function representativeSegment(stopA,stopB,byTrip,policy,excluded=null) {
  const bins=Array.from({length:policy.binsPerSegment},()=>[]);
  for(const [tripKey,points] of byTrip) {
    if(tripKey===excluded)continue;
    const own=Array.from({length:policy.binsPerSegment},()=>[]);
    for(const p of points)own[Math.min(policy.binsPerSegment-1,Math.floor(p.fraction*policy.binsPerSegment))].push(p);
    for(let i=0;i<own.length;i++)if(own[i].length)bins[i].push(medianPoint(own[i]));
  }
  const points=[stopA];
  for(const group of bins)if(group.length>=Math.max(2,policy.minTripsPerSegment-(excluded?1:0)))pushUnique(points,medianPoint(group));
  pushUnique(points,stopB);
  return points;
}

function classifyInterval(chain,stops,point,policy) {
  const candidates=[];
  for(let i=0;i<chain.stops.length-1;i++) {
    const a=stops[chain.stops[i].stopId]?.position,b=stops[chain.stops[i+1].stopId]?.position;
    const projection=projectToSegment(a,b,point);if(projection)candidates.push({...projection,interval:i});
  }
  candidates.sort((a,b)=>a.distance-b.distance);
  if(!candidates.length||candidates[0].distance>policy.anchorDistanceMeters)return {reason:'outside_stop_corridor'};
  if(candidates[1]&&candidates[1].distance-candidates[0].distance<policy.anchorAmbiguityMeters)return {reason:'stop_interval_ambiguous'};
  return candidates[0];
}

function cleanTrace(trace,policy,rejected) {
  const timestamps=new Map(),conflicts=new Set();
  for(const point of trace.points) {
    const previous=timestamps.get(point.timestamp);
    if(previous&&distanceMeters(previous,point)>1){conflicts.add(point.timestamp);increment(rejected,'timestamp_conflict');}
    else if(!previous)timestamps.set(point.timestamp,point);
  }
  let last=null;const accepted=[];
  for(const point of [...timestamps.values()].filter(p=>!conflicts.has(p.timestamp)).sort((a,b)=>a.timestamp-b.timestamp)) {
    if(last) {
      const dt=point.timestamp-last.timestamp;
      if(dt<=0)continue;
      if(dt>policy.maxGapSec){last=null;increment(rejected,'trace_gap');}
      else if(distanceMeters(last,point)>dt*policy.maxSpeedMps+policy.jumpAllowanceMeters){increment(rejected,'abnormal_jump');continue;}
    }
    accepted.push(point);last=point;
  }
  return accepted;
}

function leaveOneTripOut(segments,policy) {
  let points=0,matched=0,monotonicTrips=0,evaluatedTrips=0;
  const tripKeys=new Set(segments.flatMap(s=>[...s.byTrip.keys()]));
  for(const tripKey of tripKeys) {
    let monotonic=true,seen=false,lastAlong=-Infinity,offset=0;
    for(const segment of segments) {
      const holdout=segment.byTrip.get(tripKey)||[];
      if(!holdout.length){offset+=segment.length;continue;}
      const training=representativeSegment(segment.stopA,segment.stopB,segment.byTrip,policy,tripKey);
      if(training.length<2){monotonic=false;continue;}
      const shape=prepareShape(training);
      for(const p of [...holdout].sort((a,b)=>a.timestamp-b.timestamp)) {
        points++;seen=true;const snap=snapCandidates(shape,p,policy.validationMeters,policy.anchorAmbiguityMeters)[0];
        if(!snap){monotonic=false;continue;}matched++;
        const along=offset+snap.along;if(along+15<lastAlong)monotonic=false;lastAlong=Math.max(lastAlong,along);
      }
      offset+=shape.total;
    }
    if(seen){evaluatedTrips++;if(monotonic)monotonicTrips++;}
  }
  return {points,matched,matchRate:points?matched/points:null,evaluatedTrips,monotonicTrips,
    monotonicRate:evaluatedTrips?monotonicTrips/evaluatedTrips:null};
}

function leaveOneSegmentOut(segment,policy) {
  let points=0,matched=0,monotonicTrips=0,evaluatedTrips=0;
  for(const [tripKey,holdout] of segment.byTrip) {
    const training=representativeSegment(segment.stopA,segment.stopB,segment.byTrip,policy,tripKey);
    if(training.length<2)continue;
    const shape=prepareShape(training);let lastAlong=-Infinity,monotonic=true;evaluatedTrips++;
    for(const point of [...holdout].sort((a,b)=>a.timestamp-b.timestamp)) {
      points++;const snap=snapCandidates(shape,point,policy.validationMeters,policy.anchorAmbiguityMeters)[0];
      if(!snap){monotonic=false;continue;}matched++;if(snap.along+15<lastAlong)monotonic=false;lastAlong=Math.max(lastAlong,snap.along);
    }
    if(monotonic)monotonicTrips++;
  }
  return {points,matched,matchRate:points?matched/points:null,evaluatedTrips,monotonicTrips,
    monotonicRate:evaluatedTrips?monotonicTrips/evaluatedTrips:null};
}

export function buildObservedCorridorPoc({provider,directionId,routeIds,index,positionStatic,captures,
  generatedAt=new Date().toISOString(),officialVerification={},policy:overrides={}}) {
  const policy={...OBSERVED_CORRIDOR_POLICY,...overrides};
  if(!provider||!directionId||!Array.isArray(captures)||positionStatic?.provider!==provider
    ||positionStatic.sourceHash!==index?.sourceHash||!index.directions?.[directionId])throw Error('OBSERVED_CORRIDOR_INPUT_INVALID');
  const allowedRoutes=new Set(routeIds||[]),rows=index.directions[directionId].filter(r=>!allowedRoutes.size||allowedRoutes.has(r.routeId));
  const rowByTrip=new Map(rows.map(r=>[r.tripId,r])),patterns=new Map(),globalRejected={};
  for(const row of rows) {
    const trip=positionStatic.trips[row.tripId],chain=positionStatic.chains[trip?.chainId];
    if(!trip||!chain)throw Error('OBSERVED_CORRIDOR_STATIC_INVALID');
    if(chain.stops.some((s,i)=>!positionStatic.stops[s.stopId]||!Number.isInteger(s.sequence)||(i&&s.sequence<=chain.stops[i-1].sequence)))
      throw Error('OBSERVED_CORRIDOR_STATIC_INVALID');
    if(!chain.stops.some(s=>s.stopId===row.fromStopId&&s.sequence===row.stopSequence)
      ||!chain.stops.some(s=>s.stopId===row.toStopId&&s.sequence===row.alightSequence))throw Error('OBSERVED_CORRIDOR_STATIC_INVALID');
    const key=`${provider}:${row.routeId}:${trip.chainId}`;
    const targetOrdinal=chain.stops.findIndex(s=>s.stopId===row.fromStopId&&s.sequence===row.stopSequence);
    if(!patterns.has(key))patterns.set(key,{patternKey:key,routeId:row.routeId,chainId:trip.chainId,chain,targetOrdinals:new Set(),traces:new Map(),rejected:{}});
    patterns.get(key).targetOrdinals.add(targetOrdinal);
  }
  for(const capture of captures) {
    if(capture?.sourceVersion!==positionStatic.sourceVersion){increment(globalRejected,'source_version_mismatch');continue;}
    for(const sample of capture.samples||[]) {
      const receivedAt=Date.parse(sample.receivedAt)/1000,direction=(sample.directions||[]).find(d=>d.id===directionId);
      if(!Number.isFinite(receivedAt)||!direction){increment(globalRejected,'sample_invalid');continue;}
      for(const vehicle of direction.vehicles||[]) {
        const row=rowByTrip.get(vehicle.tripId);if(!row){increment(globalRejected,'trip_outside_query');continue;}
        const trip=positionStatic.trips[vehicle.tripId],pattern=patterns.get(`${provider}:${row.routeId}:${trip.chainId}`);
        const reject=reason=>increment(pattern.rejected,reason);
        if(vehicle.routeId!==row.routeId||vehicle.vehicleRouteId&&vehicle.vehicleRouteId!==row.routeId){reject('route_mismatch');continue;}
        if(vehicle.startTime&&vehicle.startTime!==row.startTime){reject('start_time_mismatch');continue;}
        if(Object.hasOwn(vehicle,'relationship')&&vehicle.relationship!==null&&vehicle.relationship!==0){reject('schedule_relationship');continue;}
        const day=serviceDay(vehicle.startDate);if(!Number.isFinite(day)){reject('service_day_invalid');continue;}
        const point={lat:Number(vehicle.lat),lon:Number(vehicle.lon),timestamp:Number(vehicle.timestamp),receivedAt,
          tripId:vehicle.tripId,startDate:vehicle.startDate};
        if(!validPoint(point)||!Number.isFinite(point.timestamp)){reject('gps_missing');continue;}
        const age=receivedAt-point.timestamp;if(age>policy.maxAgeSec||age< -policy.futureSec){reject('gps_stale_or_future');continue;}
        const tripKey=`${vehicle.startDate}:${vehicle.tripId}`,trace=pattern.traces.get(tripKey)||{tripKey,serviceDay:vehicle.startDate,points:[]};
        trace.points.push(point);pattern.traces.set(tripKey,trace);
      }
    }
  }
  const chains={};
  for(const pattern of patterns.values()) {
    const intervalTrips=Array.from({length:pattern.chain.stops.length-1},()=>new Map()),serviceDays=new Set(),acceptedTrips=new Set();
    let acceptedGpsPoints=0;
    for(const trace of pattern.traces.values()) {
      const clean=cleanTrace(trace,policy,pattern.rejected),ownIntervals=new Map();
      for(const point of clean) {
        const classified=classifyInterval(pattern.chain,positionStatic.stops,point,policy);
        if(classified.reason){increment(pattern.rejected,classified.reason);continue;}
        const rows=ownIntervals.get(classified.interval)||[];rows.push({...point,fraction:classified.fraction});ownIntervals.set(classified.interval,rows);
      }
      let contributed=false;
      for(const [interval,points] of ownIntervals) {
        points.sort((a,b)=>a.timestamp-b.timestamp);
        if(points.some((p,i)=>i&&p.fraction+policy.reverseFractionTolerance<points[i-1].fraction)){
          increment(pattern.rejected,'reverse_interval');continue;
        }
        intervalTrips[interval].set(trace.tripKey,points);acceptedGpsPoints+=points.length;contributed=true;
      }
      if(contributed){acceptedTrips.add(trace.tripKey);serviceDays.add(trace.serviceDay);}
    }
    if(pattern.targetOrdinals.size!==1)throw Error('OBSERVED_CORRIDOR_TARGET_AMBIGUOUS');
    const targetOrdinal=[...pattern.targetOrdinals][0],segments=intervalTrips.map((byTrip,i)=>{
      const a=positionStatic.stops[pattern.chain.stops[i].stopId],b=positionStatic.stops[pattern.chain.stops[i+1].stopId];
      const points=representativeSegment(a.position,b.position,byTrip,policy),eligible=byTrip.size>=policy.minTripsPerSegment&&points.length>2;
      const shape=points.length>1?prepareShape(points):null,distances=shape?[...byTrip.values()].flat().map(p=>snapCandidates(shape,p,Infinity,0)[0]?.distance).filter(Number.isFinite):[];
      const segment={index:i,fromStopId:a.stopId,toStopId:b.stopId,fromStopName:a.name,toStopName:b.name,
        tripCount:byTrip.size,gpsPoints:[...byTrip.values()].reduce((n,v)=>n+v.length,0),
        representativePointCount:points.length,coverageEligible:eligible,points,byTrip,stopA:a.position,stopB:b.position,
        p95DistanceMeters:percentile(distances,0.95),maxDistanceMeters:percentile(distances,1),
        length:eligible?shape.total:distanceMeters(a.position,b.position)};
      segment.leaveOneTripOut=eligible?leaveOneSegmentOut(segment,policy):null;
      segment.validated=Boolean(eligible&&segment.leaveOneTripOut.matchRate>=policy.minLeaveOneOutRate&&segment.leaveOneTripOut.monotonicRate===1);
      segment.stopsAway=segment.validated&&targetOrdinal>=i+1?targetOrdinal-(i+1):null;return segment;
    });
    const eligibleSegments=segments.filter(s=>s.coverageEligible).length,validatedSegments=segments.filter(s=>s.validated).length,allSegments=segments.length;
    const candidatePoints=[];
    if(validatedSegments===allSegments)for(const segment of segments)for(const p of segment.points)pushUnique(candidatePoints,p);
    const loo=validatedSegments===allSegments?leaveOneTripOut(segments,policy):{points:0,matched:0,matchRate:null,evaluatedTrips:0,monotonicTrips:0,monotonicRate:null};
    const verification=officialVerification[pattern.patternKey]||{pairs:0,correct:0},agreement=verification.pairs?verification.correct/verification.pairs:null;
    const geometryReady=serviceDays.size>=policy.minServiceDays&&acceptedTrips.size>=policy.minTrips&&validatedSegments===allSegments
      &&loo.matchRate!==null&&loo.matchRate>=policy.minLeaveOneOutRate&&loo.monotonicRate===1;
    const eligible=geometryReady&&verification.pairs>=policy.minReferencePairs&&agreement>=policy.minOfficialAgreement,reasons=[];
    if(serviceDays.size<policy.minServiceDays)reasons.push('service_days_insufficient');
    if(acceptedTrips.size<policy.minTrips)reasons.push('independent_trips_insufficient');
    if(eligibleSegments<allSegments)reasons.push('segment_coverage_insufficient');
    if(validatedSegments<eligibleSegments)reasons.push('segment_holdout_failed');
    if(validatedSegments===allSegments&&(loo.matchRate<policy.minLeaveOneOutRate||loo.monotonicRate!==1))reasons.push('leave_one_trip_out_failed');
    if(verification.pairs<policy.minReferencePairs)reasons.push('official_reference_insufficient');
    else if(agreement<policy.minOfficialAgreement)reasons.push('official_agreement_below_target');
    chains[pattern.chainId]={chainId:pattern.chainId,geometryId:`observed:${pattern.patternKey}`,patternKey:pattern.patternKey,routeId:pattern.routeId,
      eligible,geometryReady,points:candidatePoints,segments:segments.filter(s=>s.coverageEligible).map(s=>({index:s.index,fromStopId:s.fromStopId,
        fromStopName:s.fromStopName,toStopId:s.toStopId,toStopName:s.toStopName,stopsAway:s.stopsAway,points:s.points,
        p95DistanceMeters:s.p95DistanceMeters,maxDistanceMeters:s.maxDistanceMeters,validated:s.validated,leaveOneTripOut:s.leaveOneTripOut})),
      evidence:{serviceDays:[...serviceDays].sort(),independentTrips:acceptedTrips.size,
        acceptedGpsPoints,allSegments,eligibleSegments,validatedSegments,segmentCoverage:segments.map(s=>({index:s.index,fromStopId:s.fromStopId,toStopId:s.toStopId,
          independentTrips:s.tripCount,gpsPoints:s.gpsPoints,representativePointCount:s.representativePointCount,
          p95DistanceMeters:s.p95DistanceMeters,maxDistanceMeters:s.maxDistanceMeters,leaveOneTripOut:s.leaveOneTripOut,
          coverageEligible:s.coverageEligible,validated:s.validated})),
        leaveOneTripOut:loo,official:{pairs:verification.pairs,correct:verification.correct,agreement},rejected:pattern.rejected,reasons}};
  }
  return {schemaVersion:1,provider,sourceType:'observed_corridor',sourceVersion:`${positionStatic.sourceVersion}:phase2-poc`,
    staticSourceHash:positionStatic.sourceHash,generatedAt,directionId,policy,globalRejected,chains};
}

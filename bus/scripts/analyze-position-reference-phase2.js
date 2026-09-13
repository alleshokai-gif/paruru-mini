// Research-only comparison. Bus Navi is a teacher candidate and never a runtime input.
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { distanceMeters, validPoint } from '../position/geometry.js';

try {
  const generated=new URL('../generated/',import.meta.url),read=name=>JSON.parse(readFileSync(new URL(name,generated),'utf8'));
  const names=readdirSync(generated).filter(name=>/^position-p0-\d{8}T\d{6}\.json$/.test(name));
  const positionStatic=read('p1-position-static.json'),rows=[];
  for(const name of names) {
    const capture=read(name);
    for(const sample of capture.samples||[]) {
      const direction=(sample.directions||[]).find(d=>d.id==='home_to_noborito');if(!direction)continue;
      const vehicles=(direction.vehicles||[]).filter(v=>v.routeId==='10044'&&validPoint({lat:Number(v.lat),lon:Number(v.lon)}));
      for(const marker of direction.navi?.markers||[]) {
        const point={lat:Number(marker.lat),lon:Number(marker.lon)};if(marker.route!=='登０５'||!validPoint(point))continue;
        const candidates=vehicles.map(v=>({tripId:v.tripId,scheduled:v.scheduled,gpsAgeSec:Date.parse(sample.receivedAt)/1000-v.timestamp,
          distanceMeters:distanceMeters(point,{lat:Number(v.lat),lon:Number(v.lon)})})).sort((a,b)=>a.distanceMeters-b.distanceMeters);
        const stops=Object.values(positionStatic.stops).filter(s=>validPoint(s.position)).map(s=>({id:s.stopId,name:s.name,
          distanceMeters:distanceMeters(point,s.position)})).sort((a,b)=>a.distanceMeters-b.distanceMeters);
        const nearest=candidates[0]||null,second=candidates[1]||null,margin=nearest&&second?second.distanceMeters-nearest.distanceMeters:null;
        // A marker can be snapped to a schematic stop/segment. Do not create a trip label unless the spatial candidate is both close and unique.
        const exactCandidate=Boolean(nearest&&nearest.distanceMeters<=50&&nearest.gpsAgeSec>=-5&&nearest.gpsAgeSec<=120&&margin>=50);
        rows.push({capture:name,sample:sample.sample,observedAt:sample.receivedAt,content:marker.content,
          nearestVehicleMeters:nearest?nearest.distanceMeters:null,secondVehicleMeters:second?second.distanceMeters:null,
          vehicleMarginMeters:margin,nearestVehicleGpsAgeSec:nearest?nearest.gpsAgeSec:null,exactTripCandidate:exactCandidate,
          nearestStop:stops[0]?{id:stops[0].id,name:stops[0].name,distanceMeters:stops[0].distanceMeters}:null});
      }
    }
  }
  const exact=rows.filter(r=>r.exactTripCandidate),distances=rows.map(r=>r.nearestVehicleMeters).filter(Number.isFinite).sort((a,b)=>a-b);
  const percentile=p=>distances.length?distances[Math.min(distances.length-1,Math.floor((distances.length-1)*p))]:null;
  const summary={researchOnly:true,productionInput:false,generatedAt:new Date().toISOString(),captures:names.length,comparisons:rows.length,
    exactTripCandidates:exact.length,adjudicatedPairs:0,agreementRate:null,
    nearestVehicleMeters:{min:percentile(0),median:percentile(0.5),p95:percentile(0.95),max:percentile(1)},
    contentTransitions:rows.map(r=>({capture:r.capture,sample:r.sample,content:r.content,nearestVehicleMeters:r.nearestVehicleMeters,
      vehicleMarginMeters:r.vehicleMarginMeters,gpsAgeSec:r.nearestVehicleGpsAgeSec,nearestStop:r.nearestStop?.name||null})),
    reason:'A spatially unique candidate is not an adjudicated same-trip label. No Bus Navi identifier has been proven equal to an ODPT trip_id.'};
  const target=new URL('position-reference-phase2-summary.json',generated),temp=new URL(`${target.href}.${process.pid}.tmp`);
  if(existsSync(temp))throw Error();writeFileSync(temp,JSON.stringify(summary,null,2)+'\n',{encoding:'utf8',flush:true});renameSync(temp,target);
  console.log(JSON.stringify({status:'POSITION_REFERENCE_PHASE2_PASS',captures:summary.captures,comparisons:summary.comparisons,
    exactTripCandidates:summary.exactTripCandidates,adjudicatedPairs:0,agreementRate:null,nearestVehicleMeters:summary.nearestVehicleMeters}));
} catch {console.log('{"status":"POSITION_REFERENCE_PHASE2_FAILED"}');process.exitCode=1;}

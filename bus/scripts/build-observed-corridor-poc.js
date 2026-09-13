// Research-only. Produces aggregate evidence; raw GPS and Navi data never enter runtime output.
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { buildObservedCorridorPoc } from '../position/observed-corridor.js';

try {
  const generated=new URL('../generated/',import.meta.url),read=name=>JSON.parse(readFileSync(new URL(name,generated),'utf8'));
  const names=readdirSync(generated).filter(name=>/^position-p0-\d{8}T\d{6}\.json$/.test(name));
  const index=read('p0-static.json'),positionStatic=read('p1-position-static.json'),captures=names.map(read);
  const result=buildObservedCorridorPoc({provider:'kawasaki',directionId:'home_to_noborito',routeIds:['10044'],index,positionStatic,captures});
  const target=new URL('observed-corridor-home-to-noborito.json',generated),temp=new URL(`${target.href}.${process.pid}.tmp`);
  if(existsSync(temp))throw Error('TEMP_EXISTS');
  writeFileSync(temp,JSON.stringify(result,null,2)+'\n',{encoding:'utf8',flush:true});
  renameSync(temp,target);
  console.log(JSON.stringify({status:'OBSERVED_CORRIDOR_POC_PASS',captures:names.length,directionId:result.directionId,
    patterns:Object.values(result.chains).map(v=>({patternKey:v.patternKey,chainId:v.chainId,routeId:v.routeId,
      serviceDays:v.evidence.serviceDays.length,independentTrips:v.evidence.independentTrips,gpsPoints:v.evidence.acceptedGpsPoints,
      eligibleSegments:v.evidence.eligibleSegments,validatedSegments:v.evidence.validatedSegments,allSegments:v.evidence.allSegments,leaveOneTripOut:v.evidence.leaveOneTripOut,
      geometryReady:v.geometryReady,eligible:v.eligible,reasons:v.evidence.reasons}))}));
} catch(error) {
  console.log(JSON.stringify({status:'OBSERVED_CORRIDOR_POC_FAILED',reason:'validation_or_publish_failed'}));
  process.exitCode=1;
}

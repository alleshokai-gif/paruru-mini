// One bounded real-ODPT sample through the production collector. No Sheets write and no row payload output.
import { readFileSync } from 'node:fs';
import source from '../config/static-source.json' with { type:'json' };
import { validateArtifact } from '../runtime/static-artifact.js';
import { createKawasakiAdapter } from '../providers/kawasaki/adapter.js';
import { readLocalToken } from './local-secret.js';
import { createObservationCollector } from '../observation/collector.js';
import { runBoundedObservation } from '../observation/runner.js';

try {
  const token=readLocalToken(),now=()=>Date.now()/1000;
  const index=validateArtifact(JSON.parse(readFileSync(new URL('../generated/p0-static.json',import.meta.url),'utf8')),source.sourceDate);
  const positionStatic=JSON.parse(readFileSync(new URL('../generated/p1-position-static.json',import.meta.url),'utf8'));
  const collector=createObservationCollector({index,positionStatic,hashKey:'local-observation-check-key-only-0001'});
  const adapter=createKawasakiAdapter({token,now}),captured=[];
  const result=await runBoundedObservation({config:{runId:'local-observation-check',sampleCount:1,intervalSec:32,maxRunSec:60,timeBands:[]},
    getRealtime:()=>adapter.getRealtime(),collector,store:{async append(rows){captured.push(...rows);return {attempted:rows.length,inserted:rows.length,duplicates:0};}},
    clock:now,log:()=>{}});
  const kinds=Object.fromEntries([...new Set(captured.map(row=>row.observation_kind))].map(kind=>[kind,captured.filter(row=>row.observation_kind===kind).length]));
  const encoded=JSON.stringify({status:'OBSERVATION_LOCAL_LIVE_PASS',samples:result.samples,feedFetches:result.fetched,
    rows:captured.length,kinds,departedEvidence:captured.filter(row=>row.departure_state==='departed').length,
    censored:captured.filter(row=>row.censored).length,positionGps:captured.filter(row=>row.position_lat!==null&&row.position_lon!==null).length,
    positionSupported:captured.filter(row=>row.position_state&&row.position_state!=='unknown').length});
  if(encoded.includes(token)||encoded.includes(encodeURIComponent(token)))throw Error('SECRET_LEAK');
  console.log(encoded);
} catch {
  console.log('{"status":"OBSERVATION_LOCAL_LIVE_FAILED"}');process.exitCode=1;
}

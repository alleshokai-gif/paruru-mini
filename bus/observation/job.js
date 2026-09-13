import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import source from '../config/static-source.json' with { type:'json' };
import { validateArtifact } from '../runtime/static-artifact.js';
import { createKawasakiAdapter } from '../providers/kawasaki/adapter.js';
import { observationConfig } from './config.js';
import { createObservationCollector } from './collector.js';
import { createSheetsStore } from './sheets.js';
import { runBoundedObservation } from './runner.js';

const safeCode=error=>/^OBSERVATION_[A-Z_]+$/.test(error?.message||'')?error.message:'OBSERVATION_FAILED';
export async function startObservationJob({env=process.env,log=value=>console.log(JSON.stringify(value)),
  adapterFactory=createKawasakiAdapter,storeFactory=createSheetsStore,clock=()=>Date.now()/1000,sleep}={}) {
  const config=observationConfig(env);
  const runConfig=Object.freeze({...config,runId:config.runId||randomUUID()});
  const index=validateArtifact(JSON.parse(readFileSync(new URL('../generated/p0-static.json',import.meta.url),'utf8')),source.sourceDate);
  const positionStatic=JSON.parse(readFileSync(new URL('../generated/p1-position-static.json',import.meta.url),'utf8'));
  const collector=createObservationCollector({index,positionStatic,hashKey:config.hashKey});
  const adapter=adapterFactory({token:config.token,now:clock});
  const store=storeFactory({spreadsheetId:config.spreadsheetId});
  log({event:'observation_start',runId:runConfig.runId,sampleCount:runConfig.sampleCount,
    intervalSec:config.intervalSec,maxRunSec:config.maxRunSec});
  return runBoundedObservation({config:runConfig,getRealtime:()=>adapter.getRealtime(),collector,store,clock,sleep,log});
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {await startObservationJob();}
  catch(error){console.error(JSON.stringify({event:'observation_failed',code:safeCode(error)}));process.exitCode=1;}
}

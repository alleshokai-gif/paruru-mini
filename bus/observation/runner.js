import { randomUUID } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';
import { withinTimeBands } from './config.js';

export async function runBoundedObservation({config,getRealtime,collector,store,clock=()=>Date.now()/1000,
  sleep=seconds=>wait(seconds*1000),log=()=>{}}={}) {
  if(!config||typeof getRealtime!=='function'||typeof collector?.collect!=='function'||typeof store?.append!=='function')
    throw Error('OBSERVATION_RUNNER_CONFIG_INVALID');
  const startedAt=clock(),runId=config.runId||randomUUID();
  if(!withinTimeBands(startedAt,config.timeBands)) {
    const result={status:'skipped',reason:'outside_time_band',samples:0,fetched:0,rows:0,inserted:0,duplicates:0};
    log({event:'observation_skipped',runId,samples:0,reason:result.reason});return result;
  }
  const totals={status:'success',reason:null,samples:0,fetched:0,rows:0,inserted:0,duplicates:0};
  for(let sampleIndex=0;sampleIndex<config.sampleCount;sampleIndex++) {
    const elapsed=clock()-startedAt;
    if(elapsed>=config.maxRunSec){totals.status='bounded';totals.reason='max_run_reached';break;}
    const fetchStarted=performance.now(),realtime=await getRealtime();
    const fetchMs=performance.now()-fetchStarted;totals.fetched++;
    const observedAt=clock(),collectStarted=performance.now();
    const rows=collector.collect({realtime,now:observedAt,runId,sampleIndex});
    const collectMs=performance.now()-collectStarted,writeStarted=performance.now(),write=await store.append(rows);
    const writeMs=performance.now()-writeStarted;
    totals.samples++;totals.rows+=rows.length;totals.inserted+=write.inserted;totals.duplicates+=write.duplicates;
    log({event:'observation_sample',runId,sampleIndex,rows:rows.length,inserted:write.inserted,duplicates:write.duplicates,
      fetchMs:Number(fetchMs.toFixed(3)),collectMs:Number(collectMs.toFixed(3)),writeMs:Number(writeMs.toFixed(3))});
    if(sampleIndex===config.sampleCount-1)break;
    const nextAt=startedAt+(sampleIndex+1)*config.intervalSec,delay=Math.max(0,nextAt-clock());
    if(clock()-startedAt+delay>=config.maxRunSec){totals.status='bounded';totals.reason='max_run_reached';break;}
    await sleep(delay);
  }
  log({event:'observation_complete',runId,samples:totals.samples,fetched:totals.fetched,rows:totals.rows,
    inserted:totals.inserted,duplicates:totals.duplicates,status:totals.status});
  return totals;
}

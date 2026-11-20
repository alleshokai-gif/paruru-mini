// Opt-in runner for an already authorized Cloud Run Jobs identity. No key files.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { collect, collectIy, collectYaoko, collectTokubai, openDb, snapshot, portableResult } from './collector.mjs';
import { extractOkFront } from './ok-ocr.mjs';
import { extractIyFront } from './iy-ocr.mjs';
import { extractYaokoFront } from './yaoko-ocr.mjs';
import {extractTokubaiFront} from './tokubai-ocr.mjs';
import poc from '../../features/shopping/supermarket-poc.js';

const prefix = 'family-supermarket/v1';
const dbKey = prefix+'/collector-state.sqlite';
const latestKey = prefix+'/latest.json';
const limit = 16 * 1024 * 1024;
const sha = b => createHash('sha256').update(b).digest('hex');

async function boundedBody(res,max) {
  let size = 0;
  const blocks = [];
  for await (const block of res.body) {
    size += block.length;
    if (size > max) throw new Error('GCS_BODY_LIMIT');
    blocks.push(Buffer.from(block));
  }
  return Buffer.concat(blocks);
}
function stateGen(entry) {
  if (entry === null) return '0';
  if (!/^\d+$/.test(entry?.generation ?? '')) throw new Error('GCS_GENERATION_INVALID');
  return entry.generation;
}

export async function makeGcs(bucket, fetcher = fetch) {
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error('GCS_BUCKET_INVALID');
  const tokenURL = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';
  const access = await fetcher(tokenURL,{headers:{'Metadata-Flavor':'Google'},redirect:'error',signal:AbortSignal.timeout(5000)});
  if (!access.ok || access.headers.get('metadata-flavor') !== 'Google') throw new Error('IDENTITY_TOKEN_UNAVAILABLE');
  const {access_token:token} = JSON.parse(await boundedBody(access,8192));
  if (typeof token !== 'string' || !token || token.length > 8192) throw new Error('IDENTITY_TOKEN_UNAVAILABLE');
  const storage = 'https://storage.googleapis.com';
  const meta = '/storage/v1/b/' + bucket;
  const scUrl = key => {
    if (!/^family-supermarket\/v1\/(?:collector-state\.sqlite|latest\.json|claims\/\d{4}-\d{2}-\d{2}(?:-(?:iy|yaoko|maruetsu|life))?\.json)$/.test(key)) {
      throw new Error('GCS_OBJECT_OUT_OF_SCOPE');
    }
    return meta + '/o/' + encodeURIComponent(key);
  };
  async function get(path) {
    return fetcher(storage+path,{headers:{Authorization:'Bearer '+token},
      redirect:'error',signal:AbortSignal.timeout(12000)});
  }
  const b = await get(meta+'?fields=iamConfiguration');
  if (!b.ok) throw new Error('GCS_BUCKET_POLICY_' + b.status);
  const iam = JSON.parse(await boundedBody(b,65536))?.iamConfiguration;
  if (iam?.publicAccessPrevention !== 'enforced' || iam?.uniformBucketLevelAccess?.enabled !== true) {
    throw new Error('GCS_PRIVATE_BUCKET_UNVERIFIED');
  }
  return {
    async describe(key) {
      const r = await get(scUrl(key)+'?fields=generation,size');
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('GCS_DESCRIBE_'+r.status);
      const o = JSON.parse(await boundedBody(r,65536));
      stateGen(o);
      if (!/^\d+$/.test(o.size ?? '') || +o.size > limit) throw new Error('GCS_BODY_LIMIT');
      return o;
    },
    async read(key,entry) {
      const r = await get(scUrl(key)+'?alt=media&ifGenerationMatch='+stateGen(entry));
      if (!r.ok) throw new Error('GCS_READ_'+r.status);
      const bytes = await boundedBody(r,limit);
      if (bytes.length !== Number(entry.size)) throw new Error('GCS_READ_SIZE_MISMATCH');
      return bytes;
    },
    async put(key,bytes,type,generation) {
      scUrl(key);
      if (!/^\d+$/.test(generation) || bytes.length > limit) throw new Error('GCS_WRITE_INVALID');
      const uri = new URL(storage+'/upload'+meta+'/o');
      for (const [k,v] of Object.entries({uploadType:'media',name:key,ifGenerationMatch:generation,fields:'generation,size'})) {
        uri.searchParams.set(k,v);
      }
      const r = await fetcher(uri,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':type},
        redirect:'error',signal:AbortSignal.timeout(15000),body:bytes});
      if (r.status === 412) {
        if (r.body) await r.body.cancel();
        return null;
      }
      if (!r.ok) throw new Error('GCS_WRITE_'+r.status);
      const o = JSON.parse(await boundedBody(r,65536));
      stateGen(o);
      if (+o.size !== bytes.length) throw new Error('GCS_WRITE_SIZE_MISMATCH');
      return o;
    }
  };
}

async function createWorkspace() {
  const tmp = await mkdtemp(join(tmpdir(),'paluru-flyer-daily-'));
  const dbFile = join(tmp,'state.sqlite');
  return {
    async open(bytes) {
      if (bytes) await writeFile(dbFile,bytes,{mode:0o600});
      return openDb(dbFile);
    },
    async finish(db) { db.close(); return readFile(dbFile); },
    async dispose() { await rm(tmp,{recursive:true,force:true}); }
  };
}

export async function runDaily(store,date,{collector,ocr,sourceFetch,workspaceFactory=createWorkspace,
  enableIy=false,iyCollector=collectIy,iyOcr=extractIyFront,
  enableYaoko=false,yaokoCollector=collectYaoko,yaokoOcr=extractYaokoFront,
  enableMaruetsu=false,enableLife=false,
  maruetsuCollector=(...a)=>collectTokubai('maruetsu',...a),maruetsuOcr=(...a)=>extractTokubaiFront('maruetsu',...a),
  lifeCollector=(...a)=>collectTokubai('life',...a),lifeOcr=(...a)=>extractTokubaiFront('life',...a)} = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0,10) !== date) throw new Error('INVALID_RUN_DAY');
  const leaseKey = prefix+'/claims/'+date+'.json';
  const ws = await workspaceFactory();
  try {
    const lease = await store.put(leaseKey,Buffer.from(JSON.stringify({schema:1,date})),'application/json','0');
    // Pin the publication generation BEFORE loading the DB. A duplicate using
    // an older DB must not adopt an activation's newer latest generation as its
    // replacement precondition (including an enableIy=false invocation).
    const latestAtStart=await store.describe(latestKey);
    const oldDb = await store.describe(dbKey);
    const db = await ws.open(oldDb ? await store.read(dbKey,oldDb) : null);
    let result, requests = 0, elapsed, dbBytes, storeLease=null,activatedStore=null;
    const fetcher=(...args)=>{requests++;return (sourceFetch||fetch)(...args);};
    try {
      if (!lease) {
        result = snapshot(db,date);
        // A second invocation may finish publication after a durable SQLite write,
        // but will never contact stores. No arbitrary retry of ambiguous writes.
        if (!result.states.ok) return {date, disposition:'already_claimed',requests};
        // A newly enabled store previously marked held made no source attempt.
        // Its separate create-only daily claim permits activation without
        // deleting/replacing the original day claim or ever re-fetching OK.
        // Activate at most one previously unattempted store per invocation.
        // Claim before source I/O; an uncertain second claim cannot discard
        // an earlier store's in-memory changes or cause a source replay.
        const activation=[...(enableIy?[['iy',iyCollector,iyOcr]]:[]),
          ...(enableYaoko?[['yaoko',yaokoCollector,yaokoOcr]]:[]),
          ...(enableMaruetsu?[['maruetsu',maruetsuCollector,maruetsuOcr]]:[]),
          ...(enableLife?[['life',lifeCollector,lifeOcr]]:[])].find(([id])=>result.states[id]==='held');
        if(activation) {
          const [id,run,scan]=activation;activatedStore=id;
          storeLease=await store.put(prefix+'/claims/'+date+'-'+id+'.json',
            Buffer.from(JSON.stringify({schema:1,date,store:id})),'application/json','0');
          // Another activation may be publishing newer DB/latest bytes now.
          // Do not recover publication from this stale pre-claim snapshot.
          if(!storeLease) return {date,disposition:'store_already_claimed',requests};
          if(storeLease) {
            const start=performance.now();
            result=await run(db,date,fetcher,{ocr:scan});
            elapsed=Math.round(performance.now()-start);
          }
        }
      } else {
        const start = performance.now();
        result = await (collector || collect)(db,date,fetcher,{daily:true,ocr:ocr || extractOkFront});
        if(enableIy) result=await iyCollector(db,date,fetcher,{ocr:iyOcr});
        if(enableYaoko) result=await yaokoCollector(db,date,fetcher,{ocr:yaokoOcr});
        if(enableMaruetsu) result=await maruetsuCollector(db,date,fetcher,{ocr:maruetsuOcr});
        if(enableLife) result=await lifeCollector(db,date,fetcher,{ocr:lifeOcr});
        elapsed = Math.round(performance.now()-start);
        if (!result.states.ok) throw new Error('COLLECTOR_DAY_NOT_WRITTEN');
      }
    } finally {
      if ((lease||storeLease) && result?.states?.ok) dbBytes = await ws.finish(db);
      else db.close();
    }
    if (lease||storeLease) {
      const dbMeta = await store.put(dbKey,dbBytes,'application/vnd.sqlite3',stateGen(oldDb));
      if (!dbMeta) throw new Error('GCS_STATE_WRITE_CONFLICT');
    }
    const bytes = Buffer.from(JSON.stringify(portableResult(result)));
    const oldLatest = await store.describe(latestKey);
    if (oldLatest) {
      const oldBytes = await store.read(latestKey,oldLatest);
      const oldDate = JSON.parse(oldBytes).date;
      if (typeof oldDate !== 'string' || oldDate > date) throw new Error('GCS_LATEST_DATE_INVALID');
      if (sha(oldBytes) === sha(bytes)) return {date,disposition:'already_published',requests,elapsed,
        status:result.states,offers:result.offers.length,generation:stateGen(oldLatest)};
    }
    if(stateGen(oldLatest)!==stateGen(latestAtStart)) throw new Error('GCS_LATEST_WRITE_CONFLICT');
    const published = await store.put(latestKey,bytes,'application/json',stateGen(latestAtStart));
    if (!published) throw new Error('GCS_LATEST_WRITE_CONFLICT');
    if (sha(await store.read(latestKey,published)) !== sha(bytes)) throw new Error('GCS_LATEST_READBACK_MISMATCH');
    return {date,disposition:lease?'published':storeLease?'store_activated':'recovered_publication',requests,elapsed,activatedStore,status:result.states,
      offers:result.offers.length,generation:stateGen(published)};
  } finally { await ws.dispose(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.umask(0o077);
  try {
    if (process.env.PALURU_SUPERMARKET_ENABLE_GCS !== '1' || !process.env.CLOUD_RUN_JOB) {
      throw new Error('GCS_RUNNER_NOT_ENABLED');
    }
    const result = await runDaily(await makeGcs(process.env.PALURU_SUPERMARKET_BUCKET || ''),poc.dayTokyo(),
      {enableIy:process.env.PALURU_SUPERMARKET_IY==='1',enableYaoko:process.env.PALURU_SUPERMARKET_YAOKO==='1',
        enableMaruetsu:process.env.PALURU_SUPERMARKET_MARUETSU==='1',enableLife:process.env.PALURU_SUPERMARKET_LIFE==='1'});
    console.log(JSON.stringify(result));
    if (result.status?.ok === 'failed') process.exitCode = 2;
  } catch (e) {
    // Fixed error metadata only. Do not print response bodies, tokens, paths or stack traces.
    const code = /^(GCS|IDENTITY|COLLECTOR|INVALID)_[A-Z0-9_]+$/.test(e.message) ? e.message : 'RUN_FAILED';
    console.error(JSON.stringify({code})); process.exitCode = 1;
  }
}

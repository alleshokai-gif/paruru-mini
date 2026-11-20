// REP controls public browser requests; never treats REP as authentication.
// RFC9309 2.3.1.3: 4xx robots is unavailable, 5xx/network is disallow.
const ORIGIN='https://rosen.mikke-sales.com';
export const ROSEN_AGENT='PALURU-Supermarket-PoC/1.0';
export function repAllows(text,path){
 const groups=[];let agents=[],rules=[],hadRules=false;
 const flush=()=>{if(agents.length)groups.push({agents,rules});agents=[];rules=[];hadRules=false;};
 for(const raw of text.split(/\r?\n/)){const line=raw.split('#')[0].trim();if(!line)continue;
  const m=line.match(/^([a-z-]+)\s*:\s*(.*)$/i);if(!m)throw Error('ROSEN_ROBOTS_FORMAT');
  const key=m[1].toLowerCase(),value=m[2].trim();
  if(key==='user-agent'){if(hadRules)flush();agents.push(value.toLowerCase());}
  else if(key==='allow'||key==='disallow'){if(!agents.length)throw Error('ROSEN_ROBOTS_FORMAT');hadRules=true;if(value)rules.push({allow:key==='allow',path:value});}
  else if(key!=='sitemap')throw Error('ROSEN_ROBOTS_FORMAT');
 }flush();
 const own='paluru-supermarket-poc';let selected=groups.filter(g=>g.agents.includes(own));if(!selected.length)selected=groups.filter(g=>g.agents.includes('*'));
 const matching=selected.flatMap(g=>g.rules).filter(rule=>{
  const end=rule.path.endsWith('$'),prefix=end?rule.path.slice(0,-1):rule.path;
  return new RegExp('^'+prefix.split('*').map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*')+(end?'$':'')).test(path);
 }).sort((a,b)=>b.path.replace(/[*$]/g,'').length-a.path.replace(/[*$]/g,'').length||Number(b.allow)-Number(a.allow));
 return !matching.length||matching[0].allow;
}
export async function rosenPolicy(db,{fetcher=fetch,now=Date.now(),refresh=false}={}){
 db.exec('CREATE TABLE IF NOT EXISTS collector_source_policy (store TEXT PRIMARY KEY, observed_at TEXT NOT NULL, status INTEGER NOT NULL, body TEXT NOT NULL)');
 let entry=db.prepare('SELECT * FROM collector_source_policy WHERE store=?').get('rosen');
 const age=entry?now-Date.parse(entry.observed_at):Infinity;
 if(!(age>=-300000&&age<86400000)){
  // A past HTTP denial is not a mandate to retry through another client.
  // Production uses a provenance-backed observation; expiry closes with zero I/O.
  if(!refresh||entry?.status===401||entry?.status===403||entry?.status===429)throw Error('ROSEN_ROBOTS_OBSERVATION_REQUIRED');
  const r=await fetcher(ORIGIN+'/robots.txt',{redirect:'error',headers:{'User-Agent':ROSEN_AGENT},signal:AbortSignal.timeout(12000)});
  if(r.status===429||r.status>=500)throw Error('ROSEN_ROBOTS_UNREACHABLE');
  const chunks=[];let count=0;
  for await(const part of r.body){count+=part.length;if(count>512*1024)throw Error('ROSEN_ROBOTS_SIZE');chunks.push(Buffer.from(part));}
  entry={store:'rosen',observed_at:new Date(now).toISOString(),status:r.status,body:r.status===200?Buffer.concat(chunks).toString('utf8'):''};
  if(entry.status!==200&&!(entry.status>=400&&entry.status<500))throw Error('ROSEN_ROBOTS_RESPONSE');
  if(entry.status===200&&entry.body.trim()&&!/user-agent\s*:/i.test(entry.body))throw Error('ROSEN_ROBOTS_FORMAT');
  db.prepare('INSERT OR REPLACE INTO collector_source_policy VALUES (?,?,?,?)').run(entry.store,entry.observed_at,entry.status,entry.body);
 }
 if(entry.status!==200&&!(entry.status>=400&&entry.status<500&&entry.status!==429))throw Error('ROSEN_ROBOTS_RESPONSE');
 if(typeof entry.body!=='string'||Buffer.byteLength(entry.body)>512*1024||entry.status===200&&entry.body.trim()&&!/user-agent\s*:/i.test(entry.body))throw Error('ROSEN_ROBOTS_FORMAT');
 return {status:entry.status,observed_at:entry.observed_at,allows:path=>entry.status!==200||repAllows(entry.body,path)};
}

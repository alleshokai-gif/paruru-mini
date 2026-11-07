import {mkdir,writeFile,rename,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {readChallengeToken} from '../../bus/rail/challenge-client.js';
const root=new URL('./data/',import.meta.url),MAX_BYTES=20000000,LICENSE_END=Date.parse('2027-03-13T00:00:00+09:00');
async function main(){
 if(Date.now()>=LICENSE_END)throw Error('LICENSE_EXPIRED');
 const token=await readChallengeToken();if(!token)throw Error('CREDENTIAL_UNAVAILABLE');
 await mkdir(root,{recursive:true});
 // No retry or automatic polling. After two observed empty Train/TrainTimetable responses,
 // default updates fetch supported static sources only. --probe-unavailable is explicit.
 const types=process.argv.includes('--probe-unavailable')?['Train','TrainTimetable','StationTimetable','Railway','Station']:['StationTimetable','Railway','Station'];
 let failed=false;
 for(const type of types){
  const url=new URL(`https://api-challenge.odpt.org/api/v4/odpt:${type}`);url.searchParams.set('odpt:operator','odpt.Operator:Odakyu');url.searchParams.set('acl:consumerKey',token);
  const fetchedAt=new Date().toISOString();
  try{
   const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(20000)});
   if(!response.ok)throw Error(`HTTP_${response.status}`);
   const reader=response.body.getReader(),chunks=[];let size=0;
   for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_BYTES){await reader.cancel();throw Error('SIZE_LIMIT');}chunks.push(value);}
   const body=Buffer.concat(chunks),rows=JSON.parse(body.toString('utf8'));if(!Array.isArray(rows)||rows.length>20000)throw Error('SCHEMA_INVALID');
   const sha256=createHash('sha256').update(body).digest('hex'),rowsSha256=createHash('sha256').update(JSON.stringify(rows)).digest('hex');
   const record={fetchedAt,endpoint:url.origin+url.pathname,sha256,rowsSha256,rows};
   const name=`${type}-${fetchedAt.replace(/[:.]/g,'-')}.json`,tmp=new URL(name+'.tmp',root),final=new URL(name,root);
   await writeFile(tmp,JSON.stringify(record,null,2),{flag:'wx'});await rename(tmp,final);
   const reread=JSON.parse(await readFile(final,'utf8'));if(createHash('sha256').update(JSON.stringify(reread.rows)).digest('hex')!==rowsSha256)throw Error('READBACK_FAILED');
   console.log(JSON.stringify({type,count:rows.length,fetchedAt,readback:true}));
  }catch(e){failed=true;console.log(JSON.stringify({type,error:/^(HTTP_\d+|SIZE_LIMIT|SCHEMA_INVALID|READBACK_FAILED)$/.test(e.message)?e.message:'FETCH_OR_SAVE_FAILED'}));}
 }
 if(failed)process.exitCode=1;
}
try{await main();}catch{console.log('{"error":"COLLECTOR_CONFIGURATION_FAILED"}');process.exitCode=1;}

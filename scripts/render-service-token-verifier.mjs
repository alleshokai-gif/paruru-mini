import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Run against a preserved, reviewed deployment directory outside the checkout.
// Only a non-reversible verifier is rendered; the cloud payload stays in memory.
const directory=path.resolve(process.argv[2] || '');
const checkout=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const relative=path.relative(checkout,directory);
if(!process.argv[2] || (!relative.startsWith('..'+path.sep) && !path.isAbsolute(relative)))
  throw Error('Render only into a deployment directory outside the checkout');
const filename=path.join(directory,'ServiceTokenVerifier.js');
const source=await fs.readFile(filename,'utf8');
if(source.split('__SERVICE_TOKEN_SHA256__').length!==2)throw Error('Verifier template is missing or already rendered');
const context=vm.createContext({});
vm.runInContext(source,context,{timeout:1000});
const config=vm.runInContext('SERVICE_TOKEN_VERIFIER_CONFIG',context);
if(!/^[a-z][a-z0-9-]{4,61}$/.test(config.projectId)
  || !['FAMILY_INBOX_SERVICE_TOKEN','HEALTH_SERVICE_TOKEN'].includes(config.secretName)
  || !/^[1-9][0-9]*$/.test(config.version))throw Error('Invalid secret reference');
let token;
try {
  // Arguments contain validated public reference metadata only, never a secret.
  const command=`gcloud secrets versions access ${config.version} --secret=${config.secretName} --project=${config.projectId}`;
  token=execFileSync('cmd.exe',['/d','/s','/c',command],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']});
} catch (_) { throw Error('Secret Manager read failed; no deployment file changed'); }
if(!/^[A-Za-z0-9_-]{43,256}$/.test(token))throw Error('Invalid cloud credential; no deployment file changed');
const digest=crypto.createHash('sha256').update(token,'utf8').digest('hex');
token='';
await fs.writeFile(filename,source.replace('__SERVICE_TOKEN_SHA256__',digest));
console.log(JSON.stringify({service:config.secretName,version:config.version,verifierRendered:true}));

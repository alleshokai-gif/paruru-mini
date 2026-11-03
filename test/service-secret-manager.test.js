'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const synthetic='synthetic-token-012345678901234567890123456789';
const source=fs.readFileSync('gas/ServiceSecretManager.js','utf8');
let status=200,text=JSON.stringify({payload:{data:Buffer.from(synthetic).toString('base64')}}),reads=0;
const properties={FAMILY_INBOX_SERVICE_TOKEN:'legacy-synthetic',HEALTH_SERVICE_TOKEN:'legacy-other',UNRELATED:'preserve'};
const ctx={PropertiesService:{getScriptProperties:()=>({getProperty:key=>{reads++;return properties[key]??null;},deleteProperty:key=>{delete properties[key];}})},
  ScriptApp:{getOAuthToken:()=> 'synthetic-owner-oauth'},Utilities:{base64Decode:x=>Buffer.from(x,'base64'),newBlob:x=>({getDataAsString:()=>x.toString('utf8')})},
  UrlFetchApp:{fetch:(url,opts)=>{assert.match(url,/\/projects\/paluru-bus\/secrets\/(FAMILY_INBOX_SERVICE_TOKEN|HEALTH_SERVICE_TOKEN)\/versions\/1:access$/);assert.equal(opts.headers.Authorization,'Bearer synthetic-owner-oauth');assert.equal(opts.followRedirects,false);assert.equal(opts.validateHttpsCertificates,true);return {getResponseCode:()=>status,getContentText:()=>text};}}};
vm.createContext(ctx);vm.runInContext(source,ctx);
assert.equal(ctx.getServiceSecret_('FAMILY_INBOX_SERVICE_TOKEN'),synthetic);assert.equal(reads,0,'Cloud reader cannot fall back to properties');
assert.equal(properties.FAMILY_INBOX_SERVICE_TOKEN,'legacy-synthetic','Preflight cannot retire old caller before deployment');
for(const code of [401,403,404,429,500]){status=code;assert.throws(()=>ctx.getServiceSecret_('FAMILY_INBOX_SERVICE_TOKEN'),e=>e.code==='CONFIGURATION_ERROR');}
status=200;for(const invalid of ['{}','not-json',JSON.stringify({payload:{data:Buffer.from('too-short').toString('base64')}})]){text=invalid;assert.throws(()=>ctx.getServiceSecret_('HEALTH_SERVICE_TOKEN'),e=>e.code==='CONFIGURATION_ERROR');}
assert.throws(()=>ctx.getServiceSecret_('UNRELATED'),e=>e.code==='CONFIGURATION_ERROR');assert.equal(reads,0);
ctx.retireLegacyServiceSecret_('FAMILY_INBOX_SERVICE_TOKEN');assert.equal(properties.FAMILY_INBOX_SERVICE_TOKEN,undefined);assert.equal(properties.HEALTH_SERVICE_TOKEN,'legacy-other');assert.equal(properties.UNRELATED,'preserve');
assert.throws(()=>ctx.retireLegacyServiceSecret_('UNRELATED'),e=>e.code==='CONFIGURATION_ERROR');
for(const directory of ['gas-family-inbox','gas-health']){
 const api=vm.createContext({});vm.runInContext(fs.readFileSync(directory+'/ServiceTokenVerifier.js','utf8'),api);
 assert.throws(()=>api.serviceTokenMatches_(synthetic),e=>e.code==='CONFIGURATION_ERROR');
 const manifest=JSON.parse(fs.readFileSync(directory+'/appsscript.json','utf8'));
 assert(!manifest.oauthScopes.includes('https://www.googleapis.com/auth/cloud-platform'),'Receiver must not gain Cloud access');
 assert.deepEqual(manifest.webapp,{executeAs:'USER_DEPLOYING',access:'ANYONE_ANONYMOUS'});
}
console.log('PASS pinned cloud reads, no property fallback, selective cleanup and no new receiver scopes');

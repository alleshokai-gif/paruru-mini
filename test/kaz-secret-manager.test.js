'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=process.env.PALURU_TEST_ROOT||path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'gas/KazOsSecretManager.js'),'utf8');
const token='synthetic-reader-token-01234567890123456789';
let calls=0;
const ctx={
  Object,String,JSON,Error,encodeURIComponent,
  ScriptApp:{getOAuthToken:()=> 'synthetic-google-oauth'},
  Utilities:{
    base64Decode:value=>Buffer.from(value,'base64'),
    newBlob:value=>({getDataAsString:()=>Buffer.from(value).toString('utf8')})
  },
  UrlFetchApp:{fetch:(url,options)=>{
    calls++;
    assert.equal(url,'https://secretmanager.googleapis.com/v1/projects/paluru-bus/secrets/KAZ_OS_GATEWAY_READ_TOKEN/versions/latest:access');
    assert.equal(options.method,'get');
    assert.equal(options.headers.Authorization,'Bearer synthetic-google-oauth');
    assert.equal(options.followRedirects,false);
    assert.equal(options.validateHttpsCertificates,true);
    return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({payload:{data:Buffer.from(token).toString('base64')}})};
  }},
  homeMembershipError_:code=>{const error=new Error(code);error.code=code;return error;}
};
vm.createContext(ctx);vm.runInContext(source,ctx,{filename:'gas/KazOsSecretManager.js'});
assert.equal(ctx.getKazOsProgressReadToken_(),token);
assert.equal(calls,1);
assert.equal(Object.hasOwn(ctx,'PropertiesService'),false,'Secret helper must not depend on Script Properties');

ctx.UrlFetchApp.fetch=()=>({getResponseCode:()=>403,getContentText:()=>''});
assert.throws(()=>ctx.getKazOsProgressReadToken_(),error=>error&&error.code==='KAZ_NOT_CONNECTED');

const manifest=JSON.parse(fs.readFileSync(path.join(root,'gas/appsscript.json'),'utf8'));
assert(manifest.oauthScopes.includes('https://www.googleapis.com/auth/cloud-platform'));
for(const file of ['KazOsProgress.js','KazOsProjects.js','KazOsWork.js','KazOsCapa.js','KazOsToday.js','KazOsInbox.js']){
  const text=fs.readFileSync(path.join(root,'gas',file),'utf8');
  assert(!text.includes("getProperty('KAZ_OS_PROGRESS_READ_TOKEN')"),file+' still reads gateway token from Script Properties');
  assert(text.includes('getKazOsProgressReadToken_()'),file+' does not use centralized secret helper');
}
console.log('kaz-secret-manager: PASS');

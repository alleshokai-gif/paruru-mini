'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const path=require('node:path');
test('unknown or extra run arguments stop before normal collection',()=>{
 const script=path.resolve(__dirname,'../scripts/supermarket/run-daily-gcs.mjs');
 for(const args of [['--unknown'],['--browser-probe','extra']]) {
  const r=spawnSync(process.execPath,[script,...args],{encoding:'utf8',env:{PATH:process.env.PATH},timeout:5000});
  assert.equal(r.status,1);assert.equal(r.stdout,'');assert.match(r.stderr,/"code":"INVALID_RUN_MODE"/);
 }
});

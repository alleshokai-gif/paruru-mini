'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {test} = require('node:test');
const source=fs.readFileSync(require('node:path').join(__dirname,'../gas/Code.js'),'utf8');
function scene(error){
  let stores=0;const logs=[];
  const ctx={ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({text,setMimeType(){return this;}})},
    resolveMemoActor_:()=>{throw error;},listInboxItems_:()=>{stores++;return [];},
    createMiniTransportTrace_:()=>({}),recordMiniTransportTrace_:(_trace,_stage,value)=>logs.push(value),
    getAction_:()=>{throw error;}};
  vm.createContext(ctx);vm.runInContext(source,ctx);
  ctx.resolveMemoActor_=()=>{throw error;};
  ctx.listInboxItems_=()=>{stores++;return [];};
  ctx.getAction_=()=>{throw error;};
  return {ctx,logs,stores:()=>stores};
}
test('unknown internal errors stay fixed and do not reach the store',()=>{
  const error=Object.assign(new Error('synthetic internal detail'),{code:'SYNTHETIC_PRIVATE_DETAIL'});
  const {ctx,logs,stores}=scene(error);
  for(const response of [ctx.doGet({}),ctx.doPost({postData:{contents:JSON.stringify({action:'list'})}})]){
    const body=JSON.parse(response.text);
    assert.equal(body.success,false);assert.equal(body.error.code,'INTERNAL_ERROR');
    assert.equal(body.message,'INTERNAL_ERROR');assert.deepEqual(body.data,{});
  }
  assert.equal(stores(),0);assert.doesNotMatch(JSON.stringify(logs),/synthetic internal detail|SYNTHETIC_PRIVATE_DETAIL/);
});
test('known authentication and permission failures retain safe codes without reads',()=>{
  for(const code of ['AUTH_TOKEN_INVALID','AUTH_TOKEN_EXPIRED','AUTH_SESSION_REVOKED','FORBIDDEN','MEMBERSHIP_NOT_FOUND']){
    const {ctx,stores}=scene(Object.assign(new Error('synthetic internal detail'),{code}));
    const body=JSON.parse(ctx.doPost({postData:{contents:JSON.stringify({action:'list'})}}).text);
    assert.equal(body.success,false);assert.equal(body.error.code,code);assert.equal(body.message,code);
    assert.equal(stores(),0);assert.doesNotMatch(JSON.stringify(body),/synthetic internal detail/);
  }
});

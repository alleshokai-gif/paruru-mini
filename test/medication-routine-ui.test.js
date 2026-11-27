'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const source=fs.readFileSync('features/medication-routine/medication-routine.js','utf8');
class Element {
  constructor(tag,doc){this.tagName=tag;this.ownerDocument=doc;this.children=[];this.attrs={};this.events={};this._text='';}
  set textContent(value){this._text=String(value);this.children=[];} get textContent(){return this._text+this.children.map(e=>e.textContent).join('');}
  appendChild(el){el.parentNode=this;this.children.push(el);return el;}
  removeChild(el){this.children=this.children.filter(e=>e!==el);el.parentNode=null;}
  setAttribute(k,v){this.attrs[k]=v;}getAttribute(k){return this.attrs[k];}
  addEventListener(k,fn){this.events[k]=fn;}click(){return this.events.click?.();}
  querySelectorAll(selector){return this.children.flatMap(e=>[...((selector[0]==='.'?String(e.className).split(' ').includes(selector.slice(1)):selector[0]==='['?e.attrs[selector.slice(1,-1)]!==undefined:e.tagName===selector)?[e]:[]),...e.querySelectorAll(selector)]);}
}
function ui(api){const doc={createElement:tag=>new Element(tag,doc)},root=new Element('main',doc);let elapsed=0,tick;const scope={module:{exports:{}},crypto,console,Date,performance:{now:()=>elapsed},setInterval:fn=>(tick=fn,1),clearInterval:()=>{},Uint8Array};vm.runInNewContext(source,scope);const view=scope.module.exports.mount({homeMount:root,api,context:{memberUserId:'synthetic-self'}});return {root,view,util:scope.module.exports._util,advance:ms=>{elapsed+=ms;tick();}};}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function data(){return {configured:true,canRecord:true,canConfigure:false,localDate:'2030-04-03',serverNow:'2030-04-03T14:59:00Z',targets:[],plans:[],occurrences:['a','b'].map(planId=>({planId,planRevision:1,slot:'evening',status:'unrecorded',eventId:'',label:'Synthetic '+planId,scheduledAt:'2030-04-03T20:00:00+09:00',timers:[]}))};}
test('JST conversion is independent of device timezone and rejects normalized dates',()=>{const u=ui(()=>data());assert.equal(u.util.localDate(new Date('2030-04-03T15:01:00Z')),'2030-04-04');assert.equal(u.util.fmtTime('2030-04-03T15:01:00Z'),'00:01');assert.equal(u.util.fromLocalInput('2030-04-04T00:01'),'2030-04-03T15:01:00.000Z');assert.equal(u.util.fromLocalInput('2030-02-30T00:01'),'');u.view.clear();});
test('initial load is one authenticated read; each plan has independent lost-response recovery',async()=>{
  const calls=[],u=ui((action,body)=>{calls.push({action,body});if(action==='health.medication.get')return data();throw {code:'HEALTH_UNAVAILABLE'};});await flush();assert.equal(calls.length,1);assert.equal(calls[0].body.localDate,undefined);
  const buttons=u.root.querySelectorAll('button').filter(e=>e.className.includes('mr-primary'));buttons[0].click();await flush();buttons[1].click();await flush();buttons[0].click();await flush();
  const writes=calls.filter(c=>c.action==='health.medication.record');assert.equal(writes.length,3);assert.equal(writes[0].body.payload.planId,'a');assert.equal(writes[1].body.payload.planId,'b');assert.notEqual(writes[0].body.clientRequestId,writes[1].body.clientRequestId);assert.equal(writes[0].body.clientRequestId,writes[2].body.clientRequestId);assert.equal(writes[0].body.payload.occurredAt,'2030-04-03T14:59:00.000Z');u.view.clear();
});
test('JST midnight reload uses server clock; clear blocks late read and leaves no health DOM',async()=>{
  const calls=[],u=ui((action,body)=>{calls.push(body);return {...data(),localDate:body.localDate||data().localDate,serverNow:body.localDate?'2030-04-03T15:01:00Z':data().serverNow};});await flush();u.advance(120000);await flush();assert.equal(calls.length,2);assert.equal(calls[1].localDate,'2030-04-04');u.view.clear();assert.equal(u.root.textContent,'');
  let resolve;const delayed=ui(()=>new Promise(r=>resolve=r));await flush();delayed.view.clear();resolve(data());await flush();assert.equal(delayed.root.textContent,'');
});
test('new UI has no storage, logging, notification or network bypass',()=>{assert(!/console\.|localStorage|sessionStorage|indexedDB|Notification\(|speechSynthesis|fetch\(/.test(source));assert(!/innerHTML\s*=/.test(source));});

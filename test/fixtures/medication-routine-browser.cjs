// Synthetic-only local acceptance entry. No production URL, credentials or data.
'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {fixture}=require('./medication-routine-fixture');
const root=path.resolve(__dirname,'../..'),f=fixture();f.setup();
f.api('health.medication.plan.put',{clientRequestId:f.uuid(),payload:{planId:f.planId,expectedRevision:0,plan:f.plan}});
const origin=Date.now(),start=Date.parse('2030-04-03T11:00:00Z');
const allowed={
  '/': ['test/fixtures/medication-routine.html','text/html; charset=utf-8'],
  '/routine.js':['features/medication-routine/medication-routine.js','text/javascript; charset=utf-8'],
  '/entry.js':['features/medication-routine/entry.js','text/javascript; charset=utf-8'],
  '/view.css':['features/medication-routine/view.css','text/css; charset=utf-8']
};
http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(req.method==='GET'&&allowed[req.url]){const [file,type]=allowed[req.url];res.setHeader('Content-Type',type);return res.end(fs.readFileSync(path.join(root,file)));}
  if(req.method==='POST'&&req.url==='/synthetic-api'){
    let bytes='';for await(const chunk of req){bytes+=chunk;if(bytes.length>16384){res.writeHead(413);return res.end();}}
    try{const input=JSON.parse(bytes);f.setNow(new Date(start+Date.now()-origin).toISOString());const result=f.api(input.action,input.body,input.actor);res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(result));}catch(_){res.writeHead(400);return res.end('{"success":false,"error":{"code":"INVALID_INPUT"}}');}
  }
  res.writeHead(404);res.end();
}).listen(8791,'127.0.0.1',()=>console.log('SYNTHETIC_ROUTINE_READY 8791'));

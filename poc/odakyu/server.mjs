import{createServer}from'node:http';import{readFile}from'node:fs/promises';import{normalize}from'./core.mjs';import{listSnapshots,readSnapshot,latest}from'./storage.mjs';
const root=new URL('./',import.meta.url);const port=Number(process.env.ODAKYU_POC_PORT||8767);
const assets=new Map([['/',['index.html','text/html']],['/style.css',['style.css','text/css']],['/app.mjs',['app.mjs','text/javascript']],['/core.mjs',['core.mjs','text/javascript']]]);
const server=createServer(async(req,res)=>{res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'");
 try{
  if(!['127.0.0.1:'+port,'localhost:'+port].includes(req.headers.host)){res.writeHead(403).end();return;}
  if(req.method!=='GET'){res.writeHead(405).end();return;}
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  const asset=assets.get(url.pathname);if(asset){res.setHeader('Content-Type',asset[1]+'; charset=utf-8');res.end(await readFile(new URL(asset[0],root)));return;}
  if(url.pathname==='/api/snapshots'){res.setHeader('Content-Type','application/json');const result=await Promise.all((await listSnapshots()).map(async id=>({id,fetchedAt:(await readSnapshot(id)).fetchedAt})));res.end(JSON.stringify(result));return;}
  if(url.pathname==='/api/model'){
   const names=await listSnapshots();const id=url.searchParams.get('snapshot')||names[0];if(!names.includes(id)){res.writeHead(400).end('SNAPSHOT_INVALID');return;}
   const [source,rail,stations]=await Promise.all([readSnapshot(id),latest('Railway'),latest('Station')]);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(normalize(source.rows,rail.rows,stations.rows,source.fetchedAt)));return;
  }
  res.writeHead(404).end('NOT_FOUND');
 }catch{res.writeHead(503).end('LOCAL_DATA_UNAVAILABLE');}
});server.listen(port,'127.0.0.1',()=>console.log(`ODAKYU_POC_READY http://127.0.0.1:${port}`));

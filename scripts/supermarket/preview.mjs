import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { openDb, snapshot } from './collector.mjs';
import poc from '../../features/shopping/supermarket-poc.js';

const relative = path => new URL(path, import.meta.url);
export async function preview(db, port = 0) {
  const index = await readFile(relative('../../index.html'), 'utf8');
  const view = index.match(/<section id="shoppingView"[\s\S]*?<\/section>/)?.[0];
  if (!view) throw new Error('SHOPPING_VIEW_NOT_FOUND');
  const assets = new Map(await Promise.all([
    ['/shopping.js', '../../features/shopping/page.js', 'text/javascript'],
    ['/supermarket.js', '../../features/shopping/supermarket-poc.js', 'text/javascript'],
    ['/shopping.css', '../../features/shopping/view.css', 'text/css'],
    ['/bootstrap.js', './preview-bootstrap.js', 'text/javascript'],
  ].map(async ([url,path,mime]) => [url,{mime,body:await readFile(relative(path))}])));
  const server = createServer((req,res) => {
    const currentPort = server.address().port;
    if (req.method !== 'GET' || !['127.0.0.1:' + currentPort, 'localhost:' + currentPort].includes(req.headers.host)
      || ['cross-site','same-site'].includes(req.headers['sec-fetch-site'])) { res.writeHead(403).end(); return; }
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    if (req.url === '/') {
      res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'}).end(
        '<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<title>PALURU 買い物 PoC</title><link rel="stylesheet" href="/shopping.css"><body>' +
        '<p>ローカル試作。買い物リストの例はテスト用、チラシ価格は照合済み実データ。</p>' +
        view.replace('data-view="shopping" hidden','data-view="shopping"') +
        '<button id="previewLock" type="button">ロックを試す</button>' +
        '<script src="/supermarket.js"></script><script src="/shopping.js"></script><script src="/bootstrap.js"></script></body></html>');
      return;
    }
    if (req.url === '/snapshot') {
      res.writeHead(200, {'Content-Type': 'application/json'}).end(JSON.stringify(snapshot(db,poc.dayTokyo())));
      return;
    }
    const asset = assets.get(req.url);
    if (!asset) { res.writeHead(404).end(); return; }
    res.writeHead(200, {'Content-Type': asset.mime + '; charset=utf-8'}).end(asset.body);
  });
  await new Promise((resolve,reject) => { server.once('error',reject); server.listen(port,'127.0.0.1',resolve); });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) throw new Error('Usage: node preview.mjs <db> [port]');
  const db = openDb(process.argv[2]);
  const server = await preview(db,Number(process.argv[3] || '8765'));
  console.log('http://127.0.0.1:' + server.address().port);
}

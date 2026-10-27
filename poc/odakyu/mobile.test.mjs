import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { renderMobile } from './build-mobile.mjs';
const root = new URL('./', import.meta.url);
const inputs = Object.fromEntries(await Promise.all([['html','index.html'],['css','style.css'],['core','core.mjs'],['navigation','navigation.mjs'],['app','app.mjs']].map(async ([key,name])=>[key,await readFile(new URL(name,root),'utf8')])));
const base = () => ({...inputs,real:{dataset:{kind:'real'},trips:[],fetchedAt:'2026-10-27T00:00:00Z'},demo:{dataset:{kind:'demo'}},snapshot:'local-test',createdAt:'2026-10-27T00:00:00Z'});
test('1枚HTMLに既存エンジンと画面を同梱し、外部接続と外部scriptを要求しない',async()=>{
 const html=renderMobile(base());assert.ok(html.includes('data-offline="true"'));assert.ok(html.includes("connect-src 'none'"));
 assert.ok(!html.includes('src="/app.mjs"'));assert.ok(!html.includes('href="/style.css"'));
 const script=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
 assert.ok(!/^\s*(import|export)\s/m.test(script));
 const path=new URL('./data/mobile-syntax-check.mjs',root);await writeFile(path,script);execFileSync(process.execPath,['--check',fileURLToPath(path)],{stdio:'pipe'});
});
test('埋込データにscript終了文字やドル置換文字があってもコードへ展開しない',()=>{
 const input=base();input.real.trips=[{destination:'</script><script>alert(1)</script>$&'}];const html=renderMobile(input);
 const json=html.match(/<script id="offline-data" type="application\/json">([\s\S]*?)<\/script>/)[1];
 assert.ok(json.includes('\\u003c/script>'));assert.equal(JSON.parse(json).models.real.trips[0].destination,input.real.trips[0].destination);
 assert.equal((html.match(/<script/g)||[]).length,2);
});
test('不正モデルと未知のテンプレートを成功した保存版へ変換しない',()=>{
 const input=base();input.real.dataset.kind='demo';assert.throws(()=>renderMobile(input));
 assert.throws(()=>renderMobile({...base(),html:'invalid'}));
});

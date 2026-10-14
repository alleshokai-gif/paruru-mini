'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const component = require('../features/kaz-os/v3-component-data');
const personal = require('../features/kaz-os/personal');
const {create} = require('./fixtures/kaz-v3-component-parity');

const at = Date.parse('2026-10-09T14:30:00+09:00');
function fakeDom() {
  const document = {
    createElement(tag) {
      let own = '';
      return {
        tagName: tag.toUpperCase(), children: [], dataset: {}, className:'',
        classList: {add() {}},
        get textContent() {return own + this.children.map(c => c.textContent).join(' ');},
        set textContent(value) {own = String(value);this.children=[];},
        append(...nodes) {this.children.push(...nodes);},
        replaceChildren(...nodes) {this.children=[...nodes];},
        querySelectorAll() {return [];},
        setAttribute() {},
        addEventListener() {},
      };
    }
  };
  const host = document.createElement('main');
  host.ownerDocument = document;
  return host;
}
const childrenByTag = (node, tag) =>
  (node.tagName === tag.toUpperCase() ? [node] : []).concat(
    (node.children||[]).flatMap(c => childrenByTag(c,tag)));
function render(snapshot, time=at) {
  const data = component.dashboard(snapshot, 'today');
  const host = fakeDom();
  personal.render(host,{page:'today',id:null},data,time);
  return {data,host,headings:childrenByTag(host,'h2').map(n=>n.textContent)};
}
function staleOnly(snapshot,key){
  const value = structuredClone(snapshot);
  value.sources[key].status = 'stale';
  return value;
}
function degrade(result, message) {
  assert(result.headings.includes('TODAY'),message);
  assert(result.headings.some(h=>h.startsWith('Work情報（最終保存値')),message);
  assert(!result.headings.includes('NOW')&&!result.headings.includes('NEXT'),message);
  assert(!result.headings.some(h=>h.includes('空き時間')),message);
  assert(!result.headings.includes('SCHEDULED'),message);
  assert(!result.headings.includes('確認'),message);
  assert.match(result.host.textContent,/TODAY未確定/);
  assert.doesNotMatch(result.host.textContent,/16:00–17:00/);
  assert.match(result.host.textContent,/現在とは限りません/);
}
const base=create().dashboard;
const normal=render(base);
assert(normal.headings.includes('NOW') && normal.headings.includes('NEXT'));
assert(normal.headings.some(h=>h.includes('空き時間')),'valid current snapshot retains live plan');
assert(!normal.headings.some(h=>h.startsWith('Work情報（最終保存値')));
assert.equal(personal.health(normal.data.sources.today,at),'ok');
assert.equal(personal.health(normal.data.sources.work_items,at),'ok');

const staleToday=render(staleOnly(base,'today'));
assert.equal(personal.health(staleToday.data.sources.work_items,at),'ok',
  'TODAY stale must not falsely label Work stale');
assert.equal(personal.health(staleToday.data.sources.today,at),'stale');
degrade(staleToday,'stale projection');
assert.match(staleToday.host.textContent,/表示契約を確認/,'historical Work remains visible');
assert.match(staleToday.host.textContent,/TODAY STALE · Work OK/);

for(const name of ['work','calendar','work_busy']) {
  degrade(render(staleOnly(base,name)),name+' source stale');
}
const old=structuredClone(base);
old.generated_at='2026-10-08T20:30:00+09:00';
degrade(render(old),'old-day snapshot even when backend status CURRENT');

const failed=structuredClone(base);
failed.status='DEGRADED';
degrade(render(failed),'overall degraded');

const noWork=staleOnly(base,'today');
noWork.component_data.work.work_items=[];
const empty=render(noWork);
degrade(empty,'empty historical catalog');
assert.match(empty.host.textContent,/表示できる最終保存Work情報はありません/);
assert(!empty.host.textContent.includes('表示契約を確認'));

const incomplete=staleOnly(base,'work');
incomplete.sources.work.status='failed';
const missing=render(incomplete);
degrade(missing,'failed Work');
assert.equal(missing.data.last_known_work.total,null);
assert.equal(missing.data.last_known_work.items.length,0);
assert(!missing.host.textContent.includes('表示契約を確認'),'untrusted failed Work data must be suppressed');

const source=fs.readFileSync(path.resolve(__dirname,'../features/kaz-os/v3-component-data.js'),'utf8');
assert.match(source,/sources\.work_items = source\(sources\.work_items, snapshot\.sources\?\.work\)/);
assert.match(source,/sources\.today = source\(sources\.work_items, snapshot\.sources\?\.today\)/);
console.log('PASS WI-60 v3 TODAY: isolated Work status, safe historical fallback, unchanged fresh UI, no stale NOW/NEXT/free windows');

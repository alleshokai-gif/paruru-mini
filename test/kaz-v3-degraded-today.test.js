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
  assert(result.headings.some(h=>h.startsWith('Projects情報（最終保存値')),message);
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
for (const status of ['failed', 'not_connected']) {
  const unverified = structuredClone(base);
  unverified.sources.work_busy.status = status;
  degrade(render(unverified), 'WorkBusy ' + status);
}
const expiredBusy = structuredClone(base);
expiredBusy.sources.work_busy.valid_until = '2026-10-09T14:29:00+09:00';
degrade(render(expiredBusy), 'CURRENT flag with expired WorkBusy validity');
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

const noProjects=staleOnly(base,'today');
noProjects.sources.projects.status='failed';
const withoutProjects=render(noProjects);
assert.equal(withoutProjects.data.last_known_projects.items.length,0,
  'untrusted Projects history must be suppressed');
assert.match(withoutProjects.host.textContent,/表示できる最終保存Projects情報はありません/);
const historical=render(staleOnly(base,'today'));
assert.match(historical.host.textContent,/Kaz OS 保存時状態: ACTIVE/);
assert.doesNotMatch(historical.host.textContent,/UI比較/,
  'historical Projects must not expose actionable next action');
assert.doesNotMatch(historical.host.textContent,/Snapshot整合を確認/,
  'historical Work must not expose actionable next action');
const olderSources=staleOnly(base,'today');
olderSources.sources.work.updated_at='2026-10-08T09:00:00+09:00';
olderSources.sources.projects.updated_at='2026-10-07T10:00:00+09:00';
const datedHistory=render(olderSources);
assert.equal(datedHistory.data.last_known_work.generated_at,olderSources.sources.work.updated_at);
assert.equal(datedHistory.data.last_known_projects.generated_at,olderSources.sources.projects.updated_at);
assert.match(datedHistory.host.textContent,/Work source更新 10\/8 09:00 JST/);
assert.match(datedHistory.host.textContent,/Projects source更新 10\/7 10:00 JST/);

const authFailureHost=fakeDom();
personal.render(authFailureHost,{page:'today',id:null},
  {sources:{work_items:{status:'failed'}}},at);
assert.doesNotMatch(authFailureHost.textContent,/ワイの空き時間|Work情報（最終保存値）|Projects情報（最終保存値）|NOW|NEXT/);

const source=fs.readFileSync(path.resolve(__dirname,'../features/kaz-os/v3-component-data.js'),'utf8');
assert.match(source,/sources\.work_items = source\(sources\.work_items, snapshot\.sources\?\.work\)/);
assert.match(source,/sources\.today = source\(sources\.work_items, snapshot\.sources\?\.today\)/);

// WI-60 05:48 contract: a verified same-day capture may show planning;
// missing WorkBusy proof keeps historical Work/Projects visible without advice.
const morningAt = Date.parse('2026-10-15T05:48:00+09:00');
const morning = structuredClone(base);
morning.generated_at = '2026-10-15T05:47:00+09:00';
for (const entry of Object.values(morning.sources)) {
  if (entry.status !== 'current') continue;
  entry.updated_at = morning.generated_at;
  entry.valid_until = '2026-10-15T06:30:00+09:00';
}
const verifiedMorning = render(morning, morningAt);
assert(verifiedMorning.headings.includes('NOW'));
assert(verifiedMorning.headings.includes('NEXT'));
assert(verifiedMorning.headings.some(h => h.includes('空き時間')));

const missingBusy = structuredClone(morning);
missingBusy.sources.work_busy.status = 'stale';
missingBusy.sources.work_busy.valid_until = '2026-10-15T00:00:00+09:00';
const unverifiedMorning = render(missingBusy, morningAt);
degrade(unverifiedMorning, '05:48 missing complete WorkBusy capture');
assert.match(unverifiedMorning.host.textContent, /表示契約を確認/);
const projectsData = component.dashboard(missingBusy, 'projects');
const projectHost = fakeDom();
personal.render(projectHost, {page:'projects',id:null}, projectsData, morningAt);
assert.match(projectHost.textContent, /Kaz OS/);
console.log('PASS WI-60 v3 TODAY: isolated Work status, safe historical fallback, unchanged fresh UI, no stale NOW/NEXT/free windows');

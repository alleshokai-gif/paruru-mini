'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const view = require('../features/kaz-os/personal');
const { fixture } = require('./fixtures/kaz-personal-view');
const d = fixture(), now = Date.parse(d.as_of);
const cases = [];
function test(name, fn) { fn(); cases.push(name); }
test('10 projects / 100 work items / 15 calendar / 8 inbox / 5 Runs', () => assert.deepEqual([d.projects.length,d.work_items.length,d.calendar_events.length,d.inbox_items.length,d.active_runs.length], [10,100,15,8,5]));
test('20 and 30 project scaling keeps distinct identities', () => { for (const n of [20,30]) assert.equal(new Set(fixture(n).projects.map(p=>p.id)).size,n); });
test('known status counts, not derived from Work Item counts', () => assert.deepEqual(view.projectSummary(d,now), {ACTIVE:5,REVIEW:3,BLOCKED:2}));
test('fresh empty project list is zero', () => assert.deepEqual(view.projectSummary({...d,projects:[]},now),{ACTIVE:0,REVIEW:0,BLOCKED:0}));
test('failed partial and stale do not produce KPI zero', () => { for (const status of ['failed','partial','stale','not_connected']) { const x=structuredClone(d);x.sources.projects.status=status;assert.equal(view.projectSummary(x,now),null); } });
test('duplicates and unknown project statuses suppress summary', () => { const x=structuredClone(d);x.projects.push(x.projects[0]);assert.equal(view.projectSummary(x,now),null); x.projects=d.projects.map(p=>({...p,status:'UNKNOWN'}));assert.equal(view.projectSummary(x,now),null); });
test('progress counts accepted evidence and explicit denominator', () => assert.deepEqual(view.milestones(d.projects[0],d.evidence,true),{known:true,label:'2 / 4 milestones',accepted:2,total:4}));
test('undefined milestones show literal message', () => assert.equal(view.milestones(d.projects[2],d.evidence,true).label,'milestone未定義'));
test('missing evidence cannot create progress', () => assert.equal(view.milestones(d.projects[0],{},true).known,false));
test('wrong Project or Milestone evidence cannot count', () => { for (const key of ['project_id','milestone_id']) { const x=structuredClone(d);x.evidence[x.projects[0].milestones[0].evidence_ref][key]='wrong';assert.equal(view.milestones(x.projects[0],x.evidence,true).known,false); } });
test('unaccepted evidence and incomplete definitions cannot count', () => { const x=structuredClone(d);x.evidence[x.projects[0].milestones[0].evidence_ref].decision='PENDING';assert.equal(view.milestones(x.projects[0],x.evidence,true).known,false);assert.equal(view.milestones({...d.projects[0],milestones_complete:false},d.evidence,true).known,false); });
test('duplicate milestone ID invalidates bar', () => { const p=structuredClone(d.projects[0]);p.milestones.push(p.milestones[0]);assert.equal(view.milestones(p,d.evidence,true).known,false); });
test('stale milestones cannot retain a normal progress bar', () => assert.equal(view.milestones(d.projects[0],d.evidence,false).known,false));
test('moved this week absent without complete operational history', () => assert.equal(view.projectSummary(d,now).MOVED,undefined));
test('JST week boundary and distinct project moves', () => {
  assert.equal(new Date(view.weekStart(now)).toISOString(),'2026-09-13T15:00:00.000Z');
  const x=structuredClone(d);x.project_history={source:x.sources.projects,coverage_from:'2026-09-13T15:00:00Z',events:[
    {project_id:'fx-p01',kind:'state_transition',from_state:'ACTIVE',to_state:'REVIEW',occurred_at:d.as_of},
    {project_id:'fx-p01',kind:'milestone_acceptance',occurred_at:d.as_of},
    {project_id:'fx-p02',kind:'state_transition',from_state:'ACTIVE',to_state:'REVIEW',occurred_at:'2026-09-13T14:59:00Z'},
    {project_id:'fx-p03',kind:'updated',occurred_at:d.as_of}
  ]};assert.equal(view.projectSummary(x,now).MOVED,1);
  x.project_history.coverage_from=d.as_of;assert.equal(view.projectSummary(x,now).MOVED,undefined);
});
test('fetched freshness rejects future, expired and missing metadata', () => {
  assert.equal(view.health(d.sources.tasks,now),'ok');
  assert.equal(view.health(d.sources.tasks,Date.parse('2026-09-14T09:46:00+09:00')),'stale');
  assert.equal(view.health(d.sources.tasks,now-1000),'stale');
  assert.equal(view.health({...d.sources.tasks,complete:false},now),'partial');
  assert.equal(view.health({...d.sources.tasks,scope:null},now),'partial');
  assert.equal(view.health(null,now),'not_connected');
});
test('routes preserve project IDs and unknown routes default safely', () => {
  assert.deepEqual(view.route('#kaz-os/projects/fx-p01'),{page:'projects',id:'fx-p01'});
  assert.equal(view.route('#kaz-os').page,'projects');assert.equal(view.route('#kaz-os/diagnostics').page,'projects');
  assert.equal(view.route('#kaz-os/projects/%ZZ').id,null);
});
test('fixture never linked from public shell or production fallback', () => {
  const root=path.resolve(__dirname,'..');
  for(const file of ['index.html','sw.js','features/kaz-os/navigation.js']) assert(!fs.readFileSync(path.join(root,file),'utf8').includes('kaz-personal-scale'));
  const source=fs.readFileSync(path.join(root,'features/kaz-os/navigation.js'),'utf8');assert(source.includes("selection, null"));
});
console.log(`kaz-personal: ${cases.length}/${cases.length} PASS`);

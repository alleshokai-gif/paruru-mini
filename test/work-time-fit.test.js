'use strict';
const assert=require('node:assert/strict');
const api=require('../features/kaz-os/time-fit');
const now=Date.parse('2026-11-02T09:00:00+09:00');
const work={id:'synthetic-1',work_id:'WI-1',project_id:'p',state:'DOING',priority:'HIGH',estimate_min:120,next_action:'全項目を確認する'};
const proposal={first_step:'最初の項目の不明点を一覧にする',action_origin:'ai_generated',reason:'記録された確認作業の一部から開始。',
  estimate_min:120,estimate_origin:'work_record',estimate_reason:'最初の1項目の確認とメモに区切る。',step_estimate_min:30,step_kind:'substep',step_estimate_origin:'ai_estimated'};
const record={as_of:'2026-11-02T08:00:00+09:00',confidence:0.9,recommendation:proposal};
const snapshot={status:'CURRENT',generated_at:'2026-11-02T08:50:00+09:00',projects:[{id:'p',area:'WORK'}],
  sources:Object.fromEntries(['work','today','calendar','work_busy'].map(k=>[k,{status:'current',valid_until:'2026-11-02T10:00:00+09:00'}])),
  today:{company_free_windows:[{start:'2026-11-02T09:00:00+09:00',end:'2026-11-02T09:30:00+09:00'}],kaz_free_windows:[]}};
const fit=api.fit(work,record,snapshot,null,now);
assert.equal(fit.parent_work_id,work.id);assert.equal(fit.domain,'company');
assert.equal(Date.parse(fit.end)-Date.parse(fit.start),30*60000);assert.equal(work.estimate_min,120);
assert.equal(api.fit(work,record,snapshot,null,now+1),null,'29m59s does not fit 30 minutes');
assert.equal(api.fit(work,record,{...snapshot,today:{...snapshot.today,company_free_windows:[]}},null,now),null);
assert.equal(api.fit(work,record,{...snapshot,sources:{...snapshot.sources,work_busy:{status:'failed'}}},null,now),null);
assert.equal(api.fit({...work,state:'BLOCKED'},record,snapshot,null,now),null);
assert.equal(api.fit({...work,blocker:'Review required'},record,snapshot,null,now),null);
assert.equal(api.fit({...work,project_id:'unknown'},record,snapshot,null,now),null);
assert.equal(api.fit(work,{...record,as_of:'2026-11-01T08:00:00+09:00'},snapshot,null,now),null);
assert.equal(api.fit({...work,estimate_min:60},record,snapshot,null,now),null);
assert.equal(api.fit(work,{...record,confidence:0.5},snapshot,null,now),null);
assert.equal(api.fit(work,{...record,recommendation:{...proposal,step_estimate_min:null,step_estimate_origin:'unknown',step_kind:'recorded_action'}},snapshot,null,now),null);
assert.equal(api.precedes({...work,state:'READY',priority:'CRITICAL'},{...work,id:'another',state:'DOING',priority:'LOW'},now),false);
assert.equal(api.precedes({...work,planning_preference:'today'},{...work,id:'another'},now),true);
assert.equal(api.precedes(work,{...work,id:'adopted',placement:'ADOPTED_SCHEDULE'},now),false);
assert.equal(api.precedes({...work,deadline:{start:'2026-11-02T10:00:00+09:00'}},{...work,id:'later',deadline:{start:'2026-11-02'}},now),true);
assert.match(api.reason({...work,deadline:{start:'2026-11-02'}}),/時刻未設定/);
assert.match(api.reason(work),/着手済み.*優先度高/);
assert.equal(api.validateProposal({...proposal,step_estimate_min:121}),false);
assert.equal(api.validateProposal({first_step:'作業を確認する',action_origin:'work_record',reason:'既存形式',estimate_min:null}),true);
const unknown={...work,estimate_min:null};
const estimated={...record,recommendation:{...proposal,estimate_min:60,estimate_origin:'ai_estimated'}};
assert.equal(api.fit(unknown,estimated,snapshot,null,now).proposal.estimate_origin,'ai_estimated');
console.log('PASS time-fit: 120m parent / 30m step, domains, freshness, unknown, priority, unchanged canonical estimate');

'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../features/kaz-os/navigation.js'), 'utf8');
const code = source.slice(source.indexOf('  function todaySummaryCard()'), source.indexOf('  async function appendAiJudgments('))
  + source.slice(source.indexOf('  function observationCandidates('), source.indexOf('  function jstParts('));
class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.dataset = {}; this.listeners = {}; this.own = ''; }
  get textContent() { return this.own + this.children.map(n => n.textContent).join(' '); }
  set textContent(value) { this.own = value; this.children = []; }
  appendChild(node) { node.remove(); node.parent = this; this.children.push(node); return node; }
  append(...nodes) { nodes.forEach(n => this.appendChild(n)); }
  prepend(node) { node.remove(); node.parent = this; this.children.unshift(node); }
  remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
  replaceChildren(...nodes) { this.children.forEach(n => { n.parent = null; }); this.children = []; this.append(...nodes); }
  addEventListener(name, handler) { this.listeners[name] = handler; }
  querySelectorAll() { return []; }
  setAttribute() {}
}
const all = n => [n, ...n.children.flatMap(all)];
const now = Date.now(), iso = delta => new Date(now + delta).toISOString();
function setup(status = 'not_saved') {
  const sandbox = { document: {createElement: tag => new Node(tag)}, Date, Intl,
    sameJstDay: instant => new Date(instant).toLocaleDateString('en-CA', {timeZone:'Asia/Tokyo'})
      === new Date().toLocaleDateString('en-CA', {timeZone:'Asia/Tokyo'}),
    observedAtJst: () => iso(0), aiProgressStatusApi: async () => ({status}),
    KazWorkTimeFit: {reason: () => 'Recorded priority', availability: () => ({confirmed:false,windows:[]})},
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(code + '\nglobalThis.create = createTodayActionBrief;', sandbox);
  const work = {id:'synthetic-now', title:'Synthetic confirmed NOW', state:'DOING', next_action:'Read the synthetic report.\nRecord a decision.', estimate_min:15};
  const snapshot = {status:'CURRENT', generated_at:iso(0), sources:Object.fromEntries(['work','today','calendar'].map(k=>[k,{status:'current',valid_until:iso(3600000)}])),
    work:[work], today:{now:[{id:work.id,plan_start:iso(-60000),plan_end:iso(3600000)}],next:[],scheduled:[]}};
  const host = new Node('main');
  return {sandbox, snapshot, host, work};
}
async function render(value) {
  const brief = value.sandbox.create(value.host, value.snapshot, null, () => true);
  await brief.update([], 'ready');
  return {brief, summary:value.host.children[0]};
}
(async () => {
  const value = setup(); const {brief, summary} = await render(value);
  assert.equal(summary.dataset.summaryState, 'selected');
  assert.deepEqual(all(summary).filter(n=>n.tag==='dt').map(n=>n.textContent), ['今やること','理由','最初の一手']);
  assert.match(summary.textContent,/Synthetic confirmed NOW.*Recorded priority.*Read the synthetic report/s);
  assert.equal(all(summary).find(n=>n.tag==='a').href,'#kaz-os/work/synthetic-now');
  brief.onProgress(value.work.id, 'done'); await brief.update([], 'ready');
  assert.equal(summary.dataset.summaryState, 'none', 'recorded completion cannot remain the top action');
  const blocked = setup('unknown'); const unknown = await render(blocked);
  assert.equal(unknown.summary.dataset.summaryState, 'unavailable', 'unread progress is not a true empty result');
  assert.doesNotMatch(unknown.summary.textContent,/Synthetic confirmed NOW/);
  const stale = setup(); stale.snapshot.sources.work.status='stale';
  assert.equal((await render(stale)).summary.dataset.summaryState,'unavailable');
  const empty = setup(); empty.snapshot.today.now=[];
  empty.snapshot.today.next=[{id:empty.work.id}];
  assert.equal((await render(empty)).summary.dataset.summaryState,'none', 'NEXT must never become NOW for the summary');
  const noStep = setup(); noStep.work.next_action='';
  assert.match((await render(noStep)).summary.textContent,/未記録/);
  const ai = setup();
  ai.sandbox.workForEvidence = async () => ({item:ai.work});
  ai.sandbox.KazWorkTimeFit.fit = () => ({domain:'personal',start:iso(0),end:iso(600000)});
  ai.sandbox.KazWorkTimeFit.precedes = () => true;
  const aiBrief = ai.sandbox.create(ai.host,ai.snapshot,null,()=>true);
  await aiBrief.update([{feature:'daily_planner',as_of:iso(0),status:'review_pending',evidence:{},
    recommendation:{first_step:'Synthetic proposed step',reason:'Synthetic observed reason',action_origin:'ai_generated'}}], 'ready');
  assert.match(ai.host.children[0].textContent,/Synthetic observed reason.*AI提案・未確定.*Synthetic proposed step.*AI具体化・未確定/s);
  console.log('PASS TODAY summary: same NOW, recorded reason/step, completion, unread progress, stale, empty/NEXT, missing step');
})().catch(error=>{console.error(error);process.exitCode=1;});

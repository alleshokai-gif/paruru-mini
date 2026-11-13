'use strict';
const assert = require('node:assert/strict');
const component = require('../features/kaz-os/v3-component-data');
const personal = require('../features/kaz-os/personal');
const { create } = require('./fixtures/kaz-v3-component-parity');

function fakeHost() {
  const document = {
    createElement(tag) {
      let own = '';
      return {
        tagName: tag.toUpperCase(), children: [], dataset: {}, className: '',
        listeners: {},
        get options() { return this.children; },
        classList: { add() {} },
        get textContent() { return own + this.children.map(child => child.textContent).join(' '); },
        set textContent(value) { own = String(value); this.children = []; },
        append(...nodes) { this.children.push(...nodes); },
        prepend(...nodes) { this.children.unshift(...nodes); },
        replaceChildren(...nodes) { this.children = [...nodes]; },
        querySelectorAll() { return []; },
        setAttribute() {},
        addEventListener(type, handler) { this.listeners[type] = handler; },
      };
    },
  };
  const host = document.createElement('main');
  host.ownerDocument = document;
  return host;
}
function all(node, predicate) {
  return (predicate(node) ? [node] : []).concat((node.children || []).flatMap(child => all(child, predicate)));
}
function render(snapshot, page, id = null) {
  const host = fakeHost();
  personal.render(host, { page, id }, component.dashboard(snapshot, page),
    Date.parse('2026-11-13T14:30:00+09:00'));
  return host;
}

const snapshot = create().dashboard;
const p1 = snapshot.projects[0];
const p2 = { ...p1, id: 'fx-project-2', title: 'Second Project', milestones_done: 1,
  milestones_total: 2, source_revision: '2026-10-09T05:00:00Z' };
snapshot.projects = [p1, p2];
snapshot.component_data.projects.projects = snapshot.projects;
const w1 = snapshot.work[0], w2 = snapshot.work[1], w3 = snapshot.work[2];
const w4 = { ...w1, id: 'fx-work-4', work_id: 'FX-4', title: 'Second Priority Work',
  priority: 'CRITICAL', project_id: p2.id, project_name: p2.title,
  source_revision: '2026-10-09T05:00:00Z' };
const w5 = { ...w1, id: 'fx-work-5', work_id: 'FX-5', title: 'Completed Work',
  state: 'DONE', priority: 'LOW', project_id: p2.id, project_name: p2.title };
snapshot.work = [w1, w2, w3, w4, w5];
snapshot.component_data.work.work_items = snapshot.work;
snapshot.component_data.work.projects = snapshot.projects;
snapshot.component_data.work.sources.projects = snapshot.component_data.projects.sources.projects;
snapshot.component_data.projects.page_details = { [p2.id]: {
  status: 'current', purpose: 'Recorded project purpose',
  description: 'Recorded project description', completed: 'Recorded project completion',
  remaining: 'Recorded project remaining',
} };
snapshot.component_data.work.page_details = { [w4.id]: {
  status: 'current', purpose: 'Recorded work purpose',
  completed: 'Recorded work done', remaining: 'Recorded work remaining',
} };
snapshot.component_data.projects.work_items = snapshot.work;
snapshot.component_data.projects.progress_ui = {
  schema_version: 'kaz-project-work-progress-v1',
  project_order: [p2.id, p1.id],
  work_order: [w4.id, w1.id, w2.id, w3.id, w5.id],
  projects: {
    [p1.id]: { priority: 'HIGH', remaining_work_count: 3,
      completed_work_ids: [], work_ids: [w1.id, w2.id, w3.id] },
    [p2.id]: { priority: 'CRITICAL', remaining_work_count: 1,
      state_counts: { DOING: 1, DONE: 1 },
      completed_work_ids: [w5.id], work_ids: [w4.id, w5.id] },
  },
};
snapshot.component_data.work.progress_ui = {
  schema_version: 'kaz-project-work-progress-v1',
  work_order: snapshot.component_data.projects.progress_ui.work_order,
};
snapshot.component_data.work.wi53_progress = {
  schema_version: 'wi53-progress-summary-v1', as_of: '2026-10-15',
  totals: { all_registry_entries: 114, credential_and_legacy_entries: 25 },
  statuses: { migrated: 0, in_progress: 5, not_migrated: 16, human_decision: 3, deferred: 1 },
  human_decisions: 3, secret_value: 'MUST_NOT_RENDER',
};

const projects = render(snapshot, 'projects');
const projectLinks = all(projects, node => node.className === 'kp-project-row');
assert.deepEqual(projectLinks.map(node => node.dataset.projectId), [p2.id, p1.id]);
assert.equal(projectLinks[0].href, `#kaz-os/projects/${p2.id}`);
assert.match(projectLinks[0].textContent, /Second Project.*1\/2.*CRITICAL.*残Work 1件/);

const projectDetail = render(snapshot, 'projects', p2.id);
assert.match(projectDetail.textContent, /目的: Recorded project purpose/);
assert.match(projectDetail.textContent, /説明: Recorded project description/);
assert.match(projectDetail.textContent, /完了事項: Recorded project completion/);
assert.match(projectDetail.textContent, /NotionでDONEのWork: Completed Work/);
assert.match(projectDetail.textContent, /残件: 1 Work/);
assert.match(projectDetail.textContent, /Work状態: DOING 1 · DONE 1/);
assert.match(projectDetail.textContent, /残作業の記録: Recorded project remaining/);
const memberLinks = all(projectDetail, node => node.className === 'kp-work-row kp-work-link');
assert.deepEqual(memberLinks.map(node => node.dataset.workItem), [w4.id, w5.id]);
assert.equal(memberLinks[0].href, `#kaz-os/work/${w4.id}`);

const works = render(snapshot, 'work');
const workLinks = all(works, node => node.className === 'kp-work-row kp-work-link');
assert.deepEqual(workLinks.map(node => node.dataset.workItem),
  [w4.id, w1.id, w2.id, w3.id, w5.id]);
assert.match(workLinks[0].textContent, /FX-4 Second Priority Work.*作業中.*登録状態.*CRITICAL/);
assert.doesNotMatch(workLinks[0].textContent, /Second Project|次の行動|Recorded work/);

// Sort the two visible groups independently, keeping priority ties numeric in either direction.
const sortFixture = create().dashboard;
const sample = (id, priority, state = 'READY') =>
  ({ id: `sort-${id}`, work_id: `WI-${id}`, title: `Work ${id}`, state, priority });
const sourceWork = [
  sample(66, 'HIGH'), sample(10, 'HIGH'), sample(2, 'HIGH'), sample(19, null),
  sample(8, 'LOW'), sample(12, 'MEDIUM'), sample(6, 'CRITICAL'),
  sample(23, 'LOW', 'CANCELLED'), sample(3, null, 'DONE'), sample(20, 'LOW', 'DONE'),
];
sortFixture.component_data.work.work_items = sourceWork;
sortFixture.component_data.work.progress_ui = { schema_version: 'kaz-project-work-progress-v1',
  work_order: sourceWork.map(w => w.id) };
const sorted = render(sortFixture, 'work');
const [key, direction] = all(sorted, node => node.tagName === 'SELECT');
const [openRows, closedRows] = all(sorted, node => node.className === 'kp-work-list');
const [closed] = all(sorted, node => node.tagName === 'DETAILS');
const numbers = rows => rows.children.map(row => Number(row.dataset.workItem.split('-').pop()));
const change = (input, value) => { input.value = value; input.listeners.change(); };
assert.deepEqual(numbers(openRows), [6, 2, 10, 66, 12, 8, 19]);
assert.deepEqual(numbers(closedRows), [20, 23, 3]);
assert.match(sorted.textContent, /重要度：高い順/);
for (const row of [...openRows.children, ...closedRows.children]) {
  const id = row.dataset.workItem.split('-').pop();
  assert.equal(all(row, node => node.tagName === 'STRONG')[0].textContent, `WI-${id} Work ${id}`);
}
change(direction, 'asc');
assert.deepEqual(numbers(openRows), [19, 8, 12, 2, 10, 66, 6]);
assert.deepEqual(numbers(closedRows), [3, 20, 23]);
closed.open = true;
change(key, 'number');
assert.match(sorted.textContent, /WI番号：昇順/);
assert.deepEqual(numbers(openRows), [2, 6, 8, 10, 12, 19, 66]);
assert.deepEqual(numbers(closedRows), [3, 20, 23]);
change(direction, 'desc');
assert.deepEqual(numbers(openRows), [66, 19, 12, 10, 8, 6, 2]);
assert.deepEqual(numbers(closedRows), [23, 20, 3]);
assert.equal(closed.open, true);
change(key, 'priority');
assert.deepEqual(numbers(openRows), [6, 2, 10, 66, 12, 8, 19]);
assert.deepEqual(sourceWork.map(w => w.work_id), [66, 10, 2, 19, 8, 12, 6, 23, 3, 20].map(n => `WI-${n}`));

const workDetail = render(snapshot, 'work', w4.id);
assert.match(workDetail.textContent, /作業の目的: Recorded work purpose/);
assert.match(workDetail.textContent, /実施済み: Recorded work done/);
assert.match(workDetail.textContent, /残作業: Recorded work remaining/);
assert.match(workDetail.textContent, /次の行動: Snapshot整合を確認/);
assert.match(workDetail.textContent, /更新日時: 2026/);
const backToProject = all(workDetail, node => node.tagName === 'A' && node.href === `#kaz-os/projects/${p2.id}`);
assert.equal(backToProject.length, 1);
assert.match(backToProject[0].textContent, /所属Project: Second Project/);
const wi53 = render(snapshot, 'work', w2.id);
assert.doesNotMatch(wi53.textContent, /WI-53 台帳/);
assert.match(wi53.textContent, /作業の目的: 未記録/);
assert.match(wi53.textContent, /ブロッカー: 未記録/);
w2.work_id = 'WI-53';
assert.match(render(snapshot, 'work', w2.id).textContent, /全114項目 · Secret関連25項目/);
assert.doesNotMatch(render(snapshot, 'work', w2.id).textContent, /MUST_NOT_RENDER/);
const outcome = {
  schema_version: 'kaz-outcome-contract-v1', kind: 'work', goal: 'Independent outcome',
  why: 'Need an observable result', current_state: 'Merged only', scope: { in: 'Target', out: 'Other' },
  depends_on: null, remaining_gap: [
    { id: 'AC-2', result: 'unmet', gap: 'Repair live behavior' },
    { id: 'AC-3', result: 'unverified', gap: 'Need actual use observation' },
  ], criteria: [
    { id: 'AC-1', condition: 'Change is merged', result: 'achieved', requires: 'merge',
      method: 'Read merge record', evidence: [{ kind: 'merge', observed_on: '2026-11-13',
        ref: 'https://github.com/example/repo/pull/12', effect: 'supports', observation: 'Verified merge' }] },
    { id: 'AC-2', condition: 'Target behavior works', result: 'unmet', requires: 'runtime',
      method: 'Read live output', gap: 'Repair live behavior',
      evidence: [{ kind: 'runtime', observed_on: '2026-11-13', ref: 'javascript:alert(1)', observation: 'Failed' }] },
    { id: 'AC-3', condition: 'User receives result', result: 'unverified', requires: 'use',
      method: 'Observe actual use', gap: 'Need actual use observation', evidence: [] },
  ],
};
snapshot.component_data.work.page_details[w4.id].outcome = outcome;
snapshot.component_data.projects.page_details[p2.id].outcome = {
  ...outcome, kind: 'project', mode: 'ongoing', integration_work: [w4.work_id],
};
snapshot.component_data.projects.outcome_integration = { [p2.id]: { status: 'unmet', members: { [w4.work_id]: 'unmet' } } };
const workOutcome = render(snapshot, 'work', w4.id);
assert.match(workOutcome.textContent, /ゴール: Independent outcome.*達成 1件 · 未達 1件 · 未確認 1件/);
assert.match(workOutcome.textContent, /残り: Need actual use observation/);
assert.match(workOutcome.textContent, /前提Work: 未確認/);
assert.ok(all(workOutcome, node => node.tagName === 'A' && node.href === 'https://github.com/example/repo/pull/12').length >= 1);
assert.doesNotMatch(JSON.stringify(workOutcome), /javascript:alert/);
const projectOutcome = render(snapshot, 'projects', p2.id);
assert.match(projectOutcome.textContent, /継続運用.*ゴール: Independent outcome/);
assert.match(projectOutcome.textContent, /統合判定: 未達/);
assert.equal(all(projectOutcome, node => node.tagName === 'A' && /Second Priority Work · 未達/.test(node.textContent)).length, 1);
assert.doesNotMatch(render(snapshot, 'today').textContent, /Independent outcome/);
const workProgress = render(snapshot, 'work');
const outcomeRow = all(workProgress, node => node.dataset.workItem === w4.id)[0];
assert.match(outcomeRow.textContent, /マージ確認.*11\/13/);
assert.doesNotMatch(outcomeRow.textContent, /Merged only|Repair live behavior|完成条件/);
assert.match(workOutcome.textContent, /進捗評価.*マージ確認.*評価根拠.*AC-1の証拠/);
assert.doesNotMatch(outcomeRow.textContent, /要レビュー|要対応|\d+%/);
outcome.criteria[1].evidence[0] = { ...outcome.criteria[1].evidence[0], effect: 'contradicts',
  ref: 'https://github.com/example/repo/issues/13' };
assert.match(render(snapshot, 'work').textContent, /AC未達を確認/);
snapshot.sources.work.status = 'failed';
assert.doesNotMatch(render(snapshot, 'work', w4.id).textContent, /Independent outcome/);
snapshot.sources.work.status = 'current';

// A concrete, newer, unresolved owner request appears on the exact Work detail.
const reviewHost = fakeHost();
const reviewedAt = Date.now();
personal.render(reviewHost, { page: 'work', id: w4.id }, component.dashboard(snapshot, 'work'),
  reviewedAt, {
    current: () => true,
    readWorkHistory: async () => ({
      partials: new Map(),
      decisions: new Map([[w4.id, { at: reviewedAt, expires: reviewedAt + 60000,
        question: '公開範囲を決めてください', owner_reason: '本人が公開範囲を決めます',
        recommended_option: '対象者だけ', alternative_option: '全体へ公開' }]]),
    }),
  });
setImmediate(() => {
  assert.match(reviewHost.textContent, /要レビュー.*公開範囲を決めてください.*本人が公開範囲を決めます.*対象者だけ.*全体へ公開/);
});
console.log('PASS Project and Work priority lists, detail links, recorded progress and missing-value boundaries');

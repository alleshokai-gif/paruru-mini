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
        classList: { add() {} },
        get textContent() { return own + this.children.map(child => child.textContent).join(' '); },
        set textContent(value) { own = String(value); this.children = []; },
        append(...nodes) { this.children.push(...nodes); },
        prepend(...nodes) { this.children.unshift(...nodes); },
        replaceChildren(...nodes) { this.children = [...nodes]; },
        querySelectorAll() { return []; },
        setAttribute() {},
        addEventListener() {},
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
    Date.parse('2026-10-09T14:30:00+09:00'));
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
assert.match(projectDetail.textContent, /完了Work: Completed Work/);
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
assert.match(workLinks[0].textContent, /Second Priority Work.*DOING.*CRITICAL.*Second Project.*進捗率: 未記録/);

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
console.log('PASS Project and Work priority lists, detail links, recorded progress and missing-value boundaries');

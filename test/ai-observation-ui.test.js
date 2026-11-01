'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createHash, webcrypto } = require('node:crypto');

class Node {
  constructor(tag = 'div') {
    this.tag = tag; this.children = []; this.listeners = {}; this.dataset = {};
    this.classList = { contains: name => name === 'is-active' };
    this.value = ''; this.hidden = false;
  }
  set textContent(value) { this._text = value; this.children = []; }
  get textContent() { return this._text || ''; }
  append(...items) { for (const item of items) { item.parent = this; this.children.push(item); } }
  appendChild(item) { this.append(item); }
  prepend(item) { item.parent = this; this.children.unshift(item); }
  after(item) {
    item.parent = this.parent;
    this.parent.children.splice(this.parent.children.indexOf(this) + 1, 0, item);
  }
  before(item) {
    item.parent = this.parent;
    this.parent.children.splice(this.parent.children.indexOf(this), 0, item);
  }
  replaceChildren() { this.children = []; }
  remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); }
  querySelector(selector) {
    if (selector === '[data-progress-status-check]')
      return descendants(this).find(node => node.dataset.progressStatusCheck === 'true') || null;
    if (selector === '[data-progress-explicit-retry]')
      return descendants(this).find(node => node.dataset.progressExplicitRetry === 'true') || null;
    if (selector === '[data-today-overview]')
      return descendants(this).find(node => node.dataset.todayOverview === 'true') || null;
    if (selector === '.kai-action-brief')
      return descendants(this).find(node => node.dataset.aiActionBrief === 'true') || null;
    if (selector === '.kai-observation-review')
      return descendants(this).find(node => String(node.className).split(' ').includes('kai-observation-review')) || null;
    const feature = /data-ai-observation-feature="([a-z_]+)"/.exec(selector)?.[1];
    if (!feature) return null;
    return descendants(this).find(node => node.dataset.aiObservationFeature === feature) || null;
  }
  querySelectorAll(selector) {
    if (selector === '.kai-observation-work')
      return descendants(this).filter(node => String(node.className).split(' ').includes('kai-observation-work'));
    return descendants(this).filter(node => selector === '.kai-observation-send'
      && String(node.className || '').split(' ').includes('kai-observation-send'));
  }
  scrollIntoView() {}
  setAttribute() {}
  addEventListener(name, handler) { this.listeners[name] = handler; }
}
function descendants(node) {
  return [node, ...node.children.flatMap(descendants)];
}

async function run(hourJst, slowShadow = false, claimed = false, targeted = false,
  actionChoice = '継続中', planCalendarStatus = 'ok', recovery = null,
  sourcePicker = false, emptyPlan = false, initialStatus = 'not_recorded') {
  const handlers = {};
  const host = new Node();
  const view = new Node();
  const nodes = { kazOsView: view, kazPersonalContent: host };
  const DateAt = class extends Date {
    constructor(...args) { super(...(args.length ? args : [`2026-10-21T${String(hourJst - 9).padStart(2, '0')}:00:00Z`])); }
    static now() { return new DateAt().getTime(); }
  };
  const document = {
    hidden: false, createElement: tag => new Node(tag),
    getElementById: id => nodes[id] || null,
    querySelectorAll: () => [],
    addEventListener: (name, handler) => { handlers[name] = handler; },
  };
  const sandbox = { document, window: { addEventListener() {}, scrollTo() {} },
    location: { hash: '#kaz-os/today' }, Date: DateAt, Intl, setTimeout, clearTimeout,
    crypto: webcrypto, TextEncoder };
  sandbox.globalThis = sandbox;
  sandbox.KazV3ComponentData = { dashboard: () => ({}) };
  sandbox.KazPersonalView = { render: target => target.replaceChildren() };
  const source = fs.readFileSync(path.join(__dirname, '../features/kaz-os/navigation.js'), 'utf8');
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../features/kaz-os/time-fit.js'),'utf8'),sandbox);
  vm.runInNewContext(source, sandbox);
  const sent = [];
  let planningReads = 0, dashboardReads = 0, statusReads = 0;
  const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const evidence = id => {
    const text = id === 'work-1' ? '架空の作業 · DOING · 資料を確認する。残りの説明はWork詳細で確認する'
      : '次の作業 · READY · 次の資料を用意する';
    const quote = id === 'work-1' ? '資料を確認する' : '次の資料を用意する';
    const start = Array.from(text.slice(0, text.indexOf(quote))).length;
    return { source: 'work', source_ref_hash: digest({ original_ref: id, source: 'work' }),
      source_revision: digest({ original_ref: id, revision: null, source: 'work', text }),
      quote_hash: digest(quote), start, end: start + Array.from(quote).length };
  };
  const selectedEvidence = id => targeted === 'invalid'
    ? { ...evidence(id), quote_hash: '0'.repeat(64) } : evidence(id);
  const snapshot = { schema_version: 'kaz-os-dashboard-v3', status: 'CURRENT',
    generated_at: '2026-10-21T12:00:00+09:00',
    sources: Object.fromEntries(['projects', 'work', 'today', 'calendar'].map(name => [name, { status: 'current' }])),
    projects: [{ id: 'project-personal', area: 'PERSONAL' },
      { id: 'project-company', area: targeted === 'company' ? 'WORK' : 'PERSONAL' }],
    work: [{ id: 'work-1', title: '架空の作業', state: actionChoice === '完了' ? 'ACCEPTANCE' : 'DOING', project_id: 'project-personal', estimate_min: 30, priority: 'HIGH',
      next_action: '資料を確認する。残りの説明はWork詳細で確認する' },
      { id: 'work-2', title: '取消済み', state: 'CANCELLED', project_id: 'project-personal' },
      { id: 'work-3', title: '次の作業', state: 'READY', project_id: targeted === 'company' ? 'project-company' : 'project-personal',
        next_action: '次の資料を用意する' },
      { id: 'work-4', title: '計画対象外の確認作業', state: 'HUMAN_REVIEW', project_id: 'project-personal' }],
    today: { now: emptyPlan ? [] : [{ id: 'work-1',
      plan_start: '2026-10-21T00:00:00+09:00', plan_end: '2026-10-22T00:00:00+09:00' }],
      next: emptyPlan ? [] : [{ id: 'work-2' }, { id: 'work-3' }],
      scheduled: [], kaz_free_windows: [{ start: '2026-10-21T22:00:00+09:00',
        end: '2026-10-21T23:00:00+09:00' }] } };
  const timeFitMode=typeof targeted==='string'&&targeted.startsWith('step_');
  if(timeFitMode){
    snapshot.today.now=[];snapshot.today.next=[{id:'work-3'}];
    snapshot.work[2].estimate_min=120;
    snapshot.projects[1].area=targeted==='step_company'?'WORK':'PERSONAL';
    snapshot.work[2].project_id='project-company';
    for(const key of ['work','today','calendar','work_busy'])snapshot.sources[key]={status:'current',valid_until:'2026-10-21T23:59:59+09:00'};
    snapshot.today.kaz_free_windows=targeted==='step_no_window'?[]:[{start:'2026-10-21T18:00:00+09:00',end:'2026-10-21T18:30:00+09:00'}];
    snapshot.today.company_free_windows=targeted==='step_company'?[...snapshot.today.kaz_free_windows]:[];
  }
  handlers['paruru:authenticated']({ detail: {
    context: { role: 'admin', allowedViews: ['kaz-os'] },
    kazOsV3DashboardApi: async () => { dashboardReads++; return snapshot; },
    kazOsTodayApi: async () => {
      planningReads += 1;
      return { schema_version: 'kaz-today-plan-v2', origin: 'real_operational_sources',
        mode: 'read_only', fixture_only: false, sources: { work_items: { status: 'ok' },
          calendar: { status: planCalendarStatus, complete: true,
          valid_until: '2026-10-21T23:59:59+09:00' } },
        today: { now: { kind: 'items', items: [] }, next: { kind: 'items', items: [] },
          scheduled: [], waiting: [], not_fit_today: [], availability: [],
          calendar_free_windows: [{ start: '2026-10-21T22:00:00+09:00',
            end: '2026-10-21T23:00:00+09:00', duration_min: 60 }],
          writes: { notion: 0, calendar: 0, context: 0 } } };
    },
    kazOsAiEngineApi: slowShadow ? () => new Promise(() => {})
      : async () => ({ judgments: targeted ? [{ feature: 'check_in',
        judgment: 'REPLAN_REVIEW', status: 'review_pending', as_of: '2026-10-21T18:00:00+09:00',
        evidence: selectedEvidence('work-1') }, { feature: 'daily_planner',
        judgment: 'FOCUS_REVIEW', status: 'review_pending',
        as_of: timeFitMode?'2026-10-21T17:00:00+09:00':['generated', 'company'].includes(targeted)
          ? '2026-10-21T18:30:00+09:00' : '2026-10-21T18:00:00+09:00',
        ...(targeted === 'generated' ? { recommendation: { first_step: 'Work内容を開いて確認する',
          action_origin: 'ai_generated', reason: '確認作業がWorkに記録されています。', estimate_min: null } } : {}),
        ...(timeFitMode?{recommendation:{first_step:'資料の最初の項目の不明点を一覧にする',action_origin:'ai_generated',
          reason:'記録された資料準備を小さく区切る。',estimate_min:120,estimate_origin:'work_record',estimate_reason:'最初の項目の確認とメモに区切る。',
          step_estimate_min:30,step_kind:'substep',step_estimate_origin:'ai_estimated'},confidence:0.9}:{}),
        evidence: selectedEvidence('work-3') }, { feature: 'night_review',
        judgment: 'CARRY_FORWARD_REVIEW', status: 'review_pending', as_of: '2026-10-21T21:00:00+09:00',
        evidence: selectedEvidence('work-3') }]
        : claimed ? [{ feature: 'check_in', judgment: 'NEEDS_INPUT', status: 'no_advice' }] : [] }),
    kazOsAiObservationApi: async payload => {
      sent.push(payload);
      if (recovery && sent.length === 1) { const error = Error('uncertain'); error.code = 'AI_PROGRESS_RESULT_UNKNOWN'; throw error; }
      return { schema_version: 'kaz-ai-engine-progress-receipt-v1', status: 'saved',
        feature: payload.feature, action: payload.action,
        work_updated: ['done', 'carry_forward'].includes(payload.action), provider_calls: 0,
        raw_payload_stored: false };
    },
    kazOsAiProgressStatusApi: async payload => {
      assert.deepEqual(Object.keys(payload).sort(), ['action', 'feature', 'observed_at', 'work_id']);
      statusReads++;
      if (statusReads === 1) return { status: initialStatus, work_updated: false };
      return { status: recovery === 'not_recorded' ? 'not_recorded' : 'unknown', work_updated: false };
    },
  } });
  await new Promise(resolve => setImmediate(resolve));
  if (targeted) await new Promise(resolve => setTimeout(resolve, 60));
  const all = descendants(host);
  if(timeFitMode){
    assert.equal(all.some(n=>n.textContent.includes('元Work全体: 120分（Work正本） · 今回の一手: 30分（AI推定・未確定）')),true);
    assert.equal(all.some(n=>n.textContent.includes('一手の実施は元Work全体の完了ではありません')),true);
    assert.equal(all.some(n=>n.textContent.includes('確認済み空き枠に適合')),targeted!=='step_no_window');
    assert.equal(all.some(n=>n.textContent.includes('現在時刻に実行可能と確認できたWorkはありません。')),targeted==='step_no_window');
    assert.equal(snapshot.work[2].estimate_min,120);
    assert.equal(sent.length,0,'rendering a substep never updates canonical progress');
    return;
  }
  if (targeted && targeted !== 'invalid') {
    if (targeted !== 'generated') {
      assert.equal(all.some(node => node.textContent.includes('再計画を確認')), true);
      assert.equal(all.some(node => node.textContent.includes('対象Work: 架空の作業')), true);
    }
    assert.equal(all.some(node => node.textContent.includes('NOW · 今やること')), true);
    if (targeted === 'generated' || targeted === 'company') {
      assert.equal(all.some(node => node.textContent.includes('AI Planner（18:30 JST）は別のWorkを推薦しています。NOWは「架空の作業」です。')), true);
    }
    const progressButtons = all.filter(node => node.tag === 'button'
      && node.textContent === 'このWorkの進捗操作を開く');
    progressButtons[targeted === 'generated' || targeted === 'company' ? 1 : 0].listeners.click();
    assert.equal(descendants(host).find(node => node.className === 'kai-observation-review').open, true);
    assert.equal(descendants(host).find(node => node.dataset.workItem
      === (targeted === 'generated' || targeted === 'company' ? 'work-3' : 'work-1')).open, true);
  }
  assert.equal(all.some(node => node.textContent === `PlannerのWork候補（AI判断とは別） · ${emptyPlan ? 0 : 2}件`), true);
  if (targeted && targeted !== 'invalid') {
    if (targeted === true)
      assert.equal(all.some(node => node.textContent.includes('AI Plannerの対象はNOW候補と一致しています。')), true);
    else assert.equal(all.some(node => node.textContent.includes('AI判断が参照したWork')), true);
    if (targeted === 'generated') {
      assert.equal(all.some(node => node.textContent.includes(
        '最初の一手（AI生成（根拠はWork記録））: Work内容を開いて確認する')), true);
      assert.equal(all.some(node => node.textContent.includes('確認作業がWorkに記録されています。')), true);
    } else {
      assert.equal(all.some(node => node.textContent.includes('最初の一手（Work記録）: 資料を確認する')), true);
      assert.equal(all.some(node => node.textContent.includes('空き時間の目安')
        && node.textContent.includes('Work見積り30分（予定への割当なし）')), true);
    assert.equal(all.some(node => node.textContent.includes('次の確認済み空き時間 22:00–23:00')), true);
    }
    assert.equal(all.some(node => node.textContent === 'AIが参照した根拠（Work記録）'), true);
  }
  if (targeted === 'invalid') {
    assert.equal(all.some(node => node.textContent.includes('このAI判断を、今日のWork候補に結び付ける証拠は確認できません')), true);
  }
  const buttons = all.filter(node => node.tag === 'button');
  assert.equal(all.some(node => node.textContent === '今日の進み具合'), true);
  assert.equal(all.some(node => node.textContent === '状態変更が必要な項目だけ確認する'), true);
  const openedRows = all.filter(node => node.tag === 'details' && node.open === true);
  assert.equal(openedRows.length, targeted && targeted !== 'invalid' ? 2 : 0);
  if (openedRows.length) {
    assert.equal(openedRows.find(node => node.className === 'kai-observation-review').open, true);
    assert.equal(openedRows.find(node => node.dataset.workItem
      === (targeted === 'generated' || targeted === 'company' ? 'work-3' : 'work-1')).open, true);
  }
  assert.equal(buttons.filter(node => node.textContent === '完了').length,
    !emptyPlan && actionChoice === '完了' ? 1 : 0,
    'canonical completion is shown only for ACCEPTANCE Work');
  assert.equal(buttons.filter(node => node.textContent === '継続中').length, emptyPlan ? 0 : 2);
  assert.equal(buttons.filter(node => node.textContent === '延期').length, emptyPlan ? 0 : 2);
  assert.equal(buttons.filter(node => node.textContent === 'ブロック').length, emptyPlan ? 0 : 2);
  assert.equal(all.some(node => node.textContent === '対象Workを選択'), false);
  assert.equal(all.some(node => node.tag === 'textarea' && node.required), false);
  const night = buttons.find(node => node.textContent === '明日へ持ち越し');
  assert.equal(Boolean(night), hourJst >= 20);
  if (claimed) {
    assert.equal(Boolean(buttons.find(node => node.textContent === actionChoice).disabled), false);
    assert.equal(Boolean(night?.disabled), false);
  }
  let selectedActionButton = null;
  if (sourcePicker) {
    assert.equal(all.some(node => node.textContent.includes('ほかのWorkの進み具合を記録')), true);
    const select = all.find(node => node.tag === 'select');
    assert.ok(select);
    select.value = 'work-4';
    select.listeners.change();
    const selectedHost = descendants(host).find(node => node.className === 'kai-observation-selected-work');
    const selectedButtons = descendants(selectedHost).filter(node => node.tag === 'button'
      && ['継続中', '延期', 'ブロック', '完了'].includes(node.textContent));
    assert.equal(selectedButtons.some(node => node.textContent === '完了'), false,
      'HUMAN_REVIEW permits pace observations but not canonical completion');
    selectedActionButton = selectedButtons.find(node => node.textContent === actionChoice);
    assert.ok(selectedActionButton);
  }
  (selectedActionButton || buttons.find(node => node.textContent === actionChoice)).listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setTimeout(resolve, 60));
  if (initialStatus === 'unknown') {
    assert.equal(sent.length, 0, 'unknown preflight status never sends the progress mutation');
    assert.equal(statusReads, 1);
    assert.ok(descendants(host).some(node => node.textContent.includes('送信していません')));
    return;
  }
  if (initialStatus === 'saved') {
    assert.equal(sent.length, 0, 'a saved operation is refreshed without another POST');
    assert.equal(statusReads, 1);
    assert.ok(descendants(host).some(node => node.textContent.includes('同じ選択は記録済みです')));
    assert.equal(planningReads, 2);
    return;
  }
  if (recovery) {
    assert.equal(sent.length, 1, 'uncertain operation is never retried automatically');
    const statusCheck = descendants(host).find(node => node.dataset.progressStatusCheck === 'true');
    assert.ok(statusCheck, 'a read-only status check is offered');
    if (recovery === 'not_recorded') {
      assert.ok(descendants(host).some(node => node.textContent.includes('この操作は保存されていません')));
      const retry = descendants(host).find(node => node.dataset.progressExplicitRetry === 'true');
      assert.ok(retry, 'retry appears only after not_recorded confirmation');
      retry.listeners.click();
      await new Promise(resolve => setImmediate(resolve));
      await new Promise(resolve => setTimeout(resolve, 60));
      assert.equal(sent.length, 2, 'same payload is sent again only after explicit tap');
      assert.deepEqual(sent[0], sent[1], 'explicit retry preserves the original action payload');
      assert.equal(planningReads, 2);
    } else {
      assert.ok(descendants(host).some(node => node.textContent.includes('保存状態をまだ確定できません')));
      assert.equal(descendants(host).some(node => node.dataset.progressExplicitRetry === 'true'), false);
      statusCheck.listeners.click();
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(sent.length, 1, 'unknown status permits read-only checks but no resend');
      assert.ok(buttons.find(node => node.textContent === actionChoice).disabled);
    }
    return;
  }
  assert.equal(sent.length, 1);
  assert.equal(statusReads, 1, 'status is read before every progress mutation');
  assert.equal(sent[0].feature, actionChoice === '明日へ持ち越し' ? 'night_review' : 'check_in');
  assert.equal(sent[0].work_id, sourcePicker ? 'work-4' : 'work-1');
  assert.equal(sent[0].action, ({ '完了': 'done', '継続中': 'on_track', '延期': 'delayed',
    'ブロック': 'blocked', '明日へ持ち越し': 'carry_forward' })[actionChoice]);
  assert.match(sent[0].observed_at, /^2026-10-21T\d\d:\d\d:\d\d\+09:00$/);
  assert.equal(sent[0].note, '');
  assert.equal(descendants(host).some(node => node.textContent.includes(
    ['完了', '明日へ持ち越し'].includes(actionChoice)
      ? actionChoice === '完了' ? '完了を反映しました' : '明日へ持ち越しました'
      : `${actionChoice}を記録しました`)), true);
  assert.equal(planningReads, 2, 'TODAY plan is read once on entry and again after progress is saved');
  assert.equal(dashboardReads, 2, 'Work and TODAY candidate sources are read back after progress is saved');
  assert.equal(descendants(host).some(node => node.textContent.includes('今日の計画を読み直しました')), true);
  if (!emptyPlan && targeted !== 'generated' && targeted !== 'company')
    assert.equal(descendants(host).some(node => node.textContent.includes('NEXT · 次に取り組む候補（Workの優先順）')), true);
  if (planCalendarStatus !== 'ok')
    assert.equal(descendants(host).some(node => node.textContent.includes('利用できる時間は未確認です。')), true);
  if (night && actionChoice === '明日へ持ち越し') {
    assert.equal(Boolean(night.disabled), true);
    night.listeners.click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(sent.length, 1);
  }
}

Promise.all([run(18,false,false,'step_company'),run(18,false,false,'step_personal'),run(18,false,false,'step_no_window'),run(18), run(21), run(18, false, false, false, 'ブロック'),
  run(18, false, false, false, '継続中'),
  run(18, false, false, false, '延期', 'failed'), run(18, true), run(21, false, true),
  run(21, false, false, false, '明日へ持ち越し'),
  run(18, false, false, true), run(21, false, false, true),
  run(21, false, false, 'invalid'), run(18, false, false, 'generated'),
  run(18, false, false, 'company'), run(18, false, false, false, '完了', 'ok', 'not_recorded'),
  run(18, false, false, false, '完了', 'ok', 'unknown'),
  run(18, false, false, false, '継続中', 'ok', null, true),
  run(18, false, false, false, '継続中', 'ok', null, true, true),
  run(18, false, false, false, '継続中', 'ok', null, false, false, 'saved'),
  run(18, false, false, false, '継続中', 'ok', null, false, false, 'unknown')]).then(() => {
  process.stdout.write('PASS progress actions after AI claim and explicit Work readback receipt\n');
}).catch(error => { process.stderr.write(String(error.stack || error) + '\n'); process.exitCode = 1; });


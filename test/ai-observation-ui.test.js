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
  querySelector(selector) {
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

async function run(hourJst, slowShadow = false, claimed = false, targeted = false) {
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
  vm.runInNewContext(source, sandbox);
  const sent = [];
  let planningReads = 0;
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
    work: [{ id: 'work-1', title: '架空の作業', state: 'DOING', estimate_min: 30, priority: 'HIGH',
      next_action: '資料を確認する。残りの説明はWork詳細で確認する' },
      { id: 'work-2', title: '取消済み', state: 'CANCELLED' },
      { id: 'work-3', title: '次の作業', state: 'READY', next_action: '次の資料を用意する' }],
    today: { now: [{ id: 'work-1' }], next: [{ id: 'work-2' }, { id: 'work-3' }],
      scheduled: [], kaz_free_windows: [{ start: '2026-10-21T22:00:00+09:00',
        end: '2026-10-21T23:00:00+09:00' }] } };
  handlers['paruru:authenticated']({ detail: {
    context: { role: 'admin', allowedViews: ['kaz-os'] },
    kazOsV3DashboardApi: async () => snapshot,
    kazOsTodayApi: async () => {
      planningReads += 1;
      return { schema_version: 'kaz-today-plan-v2', origin: 'real_operational_sources',
        mode: 'read_only', fixture_only: false, sources: { work_items: { status: 'ok' } },
        today: { now: { kind: 'items', items: [] }, next: { kind: 'items', items: [] },
          scheduled: [], waiting: [], not_fit_today: [], availability: [],
          writes: { notion: 0, calendar: 0, context: 0 } } };
    },
    kazOsAiEngineApi: slowShadow ? () => new Promise(() => {})
      : async () => ({ judgments: targeted ? [{ feature: 'check_in',
        judgment: 'REPLAN_REVIEW', status: 'review_pending', as_of: '2026-10-21T18:00:00+09:00',
        evidence: selectedEvidence('work-1') }, { feature: 'daily_planner',
        judgment: 'FOCUS_REVIEW', status: 'review_pending',
        as_of: targeted === 'generated' ? '2026-10-21T18:30:00+09:00' : '2026-10-21T18:00:00+09:00',
        ...(targeted === 'generated' ? { recommendation: { first_step: 'Work内容を開いて確認する',
          action_origin: 'ai_generated', reason: '確認作業がWorkに記録されています。', estimate_min: null } } : {}),
        evidence: selectedEvidence('work-3') }, { feature: 'night_review',
        judgment: 'CARRY_FORWARD_REVIEW', status: 'review_pending', as_of: '2026-10-21T21:00:00+09:00',
        evidence: selectedEvidence('work-3') }]
        : claimed ? [{ feature: 'check_in', judgment: 'NEEDS_INPUT', status: 'no_advice' }] : [] }),
    kazOsAiObservationApi: async payload => { sent.push(payload); return {
      schema_version: 'kaz-ai-engine-progress-receipt-v1', status: 'saved',
      work_updated: ['done', 'carry_forward'].includes(payload.action), provider_calls: 0 }; },
  } });
  await new Promise(resolve => setImmediate(resolve));
  if (targeted) await new Promise(resolve => setTimeout(resolve, 60));
  const all = descendants(host);
  if (targeted && targeted !== 'invalid') {
    if (targeted !== 'generated') {
      assert.equal(all.some(node => node.textContent.includes('再計画を確認')), true);
      assert.equal(all.some(node => node.textContent.includes('対象Work: 架空の作業')), true);
    }
    all.find(node => node.tag === 'button' && node.textContent === 'このWorkの進捗操作を開く').listeners.click();
    assert.equal(descendants(host).find(node => node.className === 'kai-observation-review').open, true);
    assert.equal(descendants(host).find(node => node.dataset.workItem
      === (targeted === 'generated' ? 'work-3' : 'work-1')).open, true);
  }
  assert.equal(all.some(node => node.textContent === 'PlannerのWork候補（AI判断とは別） · 2件'), true);
  if (targeted && targeted !== 'invalid') {
    assert.equal(all.some(node => node.textContent.includes('AI判断が参照したWork')), true);
    if (targeted === 'generated') {
      assert.equal(all.some(node => node.textContent.includes(
        '最初の一手（AI生成（根拠はWork記録））: Work内容を開いて確認する')), true);
      assert.equal(all.some(node => node.textContent.includes('確認作業がWorkに記録されています。')), true);
    } else {
      assert.equal(all.some(node => node.textContent.includes('最初の一手（Work記録）: 資料を確認する')), true);
      assert.equal(all.some(node => node.textContent.includes('空き時間の目安')
        && node.textContent.includes('Work見積り30分（予定への割当なし）')), true);
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
      === (targeted === 'generated' ? 'work-3' : 'work-1')).open, true);
  }
  assert.equal(buttons.filter(node => node.textContent === '完了').length, 2);
  assert.equal(buttons.filter(node => node.textContent === '予定どおり').length, 2);
  assert.equal(buttons.filter(node => node.textContent === '遅れている').length, 2);
  assert.equal(all.some(node => node.textContent === '対象Workを選択'), false);
  assert.equal(all.some(node => node.tag === 'textarea' && node.required), false);
  const night = buttons.find(node => node.textContent === '明日へ持ち越し');
  assert.equal(Boolean(night), hourJst >= 20);
  if (claimed) {
    assert.equal(Boolean(buttons.find(node => node.textContent === '完了').disabled), false);
    assert.equal(Boolean(night?.disabled), false);
  }
  buttons.find(node => node.textContent === '完了').listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].feature, 'check_in');
  assert.equal(sent[0].work_id, 'work-1');
  assert.equal(sent[0].action, 'done');
  assert.match(sent[0].observed_at, /^2026-10-21T\d\d:\d\d:\d\d\+09:00$/);
  assert.equal(sent[0].note, '');
  assert.equal(all.some(node => node.textContent.includes('完了を反映しました')), true);
  assert.equal(planningReads, 2, 'TODAY plan is read once on entry and again after progress is saved');
  assert.equal(all.some(node => node.textContent.includes('今日の計画を読み直しました')), true);
  if (night) {
    assert.equal(Boolean(night.disabled), true);
    night.listeners.click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(sent.length, 1);
  }
}

Promise.all([run(18), run(21), run(18, true), run(21, false, true),
  run(18, false, false, true), run(21, false, false, true),
  run(21, false, false, 'invalid'), run(18, false, false, 'generated')]).then(() => {
  process.stdout.write('PASS progress actions after AI claim and explicit Work readback receipt\n');
}).catch(error => { process.stderr.write(String(error.stack || error) + '\n'); process.exitCode = 1; });

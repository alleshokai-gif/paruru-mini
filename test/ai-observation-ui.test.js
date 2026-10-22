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
  replaceChildren() { this.children = []; }
  querySelector(selector) {
    const feature = /data-ai-observation-feature="([a-z_]+)"/.exec(selector)?.[1];
    return descendants(this).find(node => node.dataset.aiObservationFeature === feature) || null;
  }
  querySelectorAll(selector) {
    return descendants(this).filter(node => selector === '.kai-observation-send'
      && String(node.className || '').split(' ').includes('kai-observation-send'));
  }
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
  const snapshot = { schema_version: 'kaz-os-dashboard-v3', status: 'CURRENT',
    generated_at: '2026-10-21T12:00:00+09:00',
    sources: Object.fromEntries(['projects', 'work', 'today', 'calendar'].map(name => [name, { status: 'current' }])),
    work: [{ id: 'work-1', title: '架空の作業', state: 'DOING', next_action: '資料を確認する' },
      { id: 'work-2', title: '取消済み', state: 'CANCELLED' }],
    today: { now: [{ id: 'work-1' }], next: [{ id: 'work-2' }], scheduled: [] } };
  handlers['paruru:authenticated']({ detail: {
    context: { role: 'admin', allowedViews: ['kaz-os'] },
    kazOsV3DashboardApi: async () => snapshot,
    kazOsAiEngineApi: slowShadow ? () => new Promise(() => {})
      : async () => ({ judgments: targeted ? [{ feature: 'check_in',
        judgment: 'REPLAN_REVIEW', status: 'review_pending',
        evidence: { source: 'work', source_ref_hash: createHash('sha256')
          .update(JSON.stringify({ original_ref: 'work-1', source: 'work' })).digest('hex') } }]
        : claimed ? [{ feature: 'check_in', judgment: 'NEEDS_INPUT', status: 'no_advice' }] : [] }),
    kazOsAiObservationApi: async payload => { sent.push(payload); return {
      schema_version: 'kaz-ai-engine-progress-receipt-v1', status: 'saved',
      work_updated: ['done', 'carry_forward'].includes(payload.action), provider_calls: 0 }; },
  } });
  await new Promise(resolve => setImmediate(resolve));
  if (targeted) await new Promise(resolve => setTimeout(resolve, 30));
  const all = descendants(host);
  if (targeted) assert.equal(all.some(node =>
    node.textContent.includes('再計画を確認') && node.textContent.includes('資料を確認する')), true);
  const buttons = all.filter(node => node.tag === 'button');
  assert.equal(all.some(node => node.textContent === '今日の進み具合'), true);
  assert.equal(buttons.filter(node => node.textContent === '完了').length, 1);
  assert.equal(buttons.filter(node => node.textContent === '予定どおり').length, 1);
  assert.equal(buttons.filter(node => node.textContent === '遅れている').length, 1);
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
  if (night) {
    assert.equal(Boolean(night.disabled), true);
    night.listeners.click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(sent.length, 1);
  }
}

Promise.all([run(18), run(21), run(18, true), run(21, false, true),
  run(18, false, false, true)]).then(() => {
  process.stdout.write('PASS progress actions after AI claim and explicit Work readback receipt\n');
}).catch(error => { process.stderr.write(String(error) + '\n'); process.exitCode = 1; });

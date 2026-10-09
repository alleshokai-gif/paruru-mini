const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Element {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.ownText = '';
  }

  set textContent(value) {
    this.ownText = String(value);
    this.children = [];
  }

  get textContent() {
    return this.ownText + this.children.map(child => child.textContent).join('');
  }

  append(child) { this.children.push(child); }
  replaceChildren(...children) { this.ownText = ''; this.children = children; }
  setAttribute(name, value) { this.attributes[name] = value; }
}

async function main() {
  const context = {
    document: { createElement: tag => new Element(tag) },
    performance: { now: () => 0 },
    PALURU_KAZ_OS_V3_PREVIEW_ENABLED: true,
    BUILD_ID: 'focused-test',
  };
  vm.runInNewContext(fs.readFileSync('features/kaz-os/v3-preview.js', 'utf8'), context);
  const host = new Element('div');
  const snapshot = {
    schema_version: 'kaz-os-dashboard-v3', generated_at: '2026-10-09T12:00:00+09:00',
    status: 'CURRENT', sources: {},
    today: { kaz_free_windows: [], company_free_windows: [], personal_free_windows: [],
      confirmations: [{ kind: 'human_review', decision_status: 'pending', question: '確認対象' }],
      now: [], next: [], scheduled: [], waiting: [] },
    work: [], projects: [], capa: [],
  };
  await context.KazV3Preview.render(host, 'today', async () => snapshot,
    async () => { throw Error('standalone INBOX read must not run'); }, () => true);

  const nav = host.children.find(child => child.tagName === 'nav');
  assert.deepEqual(nav.children.map(child => child.textContent),
    ['TODAY', 'WORK', 'PROJECTS', 'CAPA']);
  assert.deepEqual(nav.children.map(child => child.href),
    ['#kaz-os/v3', '#kaz-os/v3/work', '#kaz-os/v3/projects', '#kaz-os/v3/capa']);
  const body = host.children.find(child => child.tagName === 'main');
  assert.match(body.textContent, /確認確認対象/);
  assert.match(body.textContent, /NOW/);
  console.log('PASS v3 TODAY inline confirmations and four-tab navigation');
}

main().catch(error => { console.error(error); process.exitCode = 1; });

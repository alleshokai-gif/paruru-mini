'use strict';
const assert = require('node:assert/strict');
const personal = require('../features/kaz-os/personal');
const component = require('../features/kaz-os/v3-component-data');
const { create } = require('./fixtures/kaz-v3-component-parity');

function fakeDom() {
  const document = {
    createElement(tag) {
      let own = '';
      return {
        tagName: tag.toUpperCase(), children: [], dataset: {}, className: '',
        classList: { add() {} },
        get textContent() { return own + this.children.map(child => child.textContent).join(' '); },
        set textContent(value) { own = String(value); this.children = []; },
        append(...nodes) { this.children.push(...nodes); },
        appendChild(node) { this.children.push(node); },
        replaceChildren(...nodes) { this.children = [...nodes]; },
        querySelectorAll() { return []; }, setAttribute() {}, addEventListener() {},
      };
    },
  };
  const host = document.createElement('main');
  host.ownerDocument = document;
  return host;
}

const data = create();
data.dashboard.today.unassigned = [{
  id: 'fixture-company-work', title: 'Company Work fixture', work_id: 'FX-COMPANY',
  planning_domain: 'company', planning_reason: 'WORKING_HOURS_UNAVAILABLE',
}];
const view = component.dashboard(data.dashboard, 'today');
const host = fakeDom();
personal.render(host, { page: 'today', id: null }, view,
  Date.parse(data.dashboard.generated_at));
const text = host.textContent;
assert.match(text, /会社の空き時間/);
assert.match(text, /勤務時間が設定されていないため、会社の空き時間は表示していません/);
assert.match(text, /家庭・個人の作業候補時間/);
assert.match(text, /16:00–17:00/);
assert.match(text, /時間帯を確認できないWork/);
assert.match(text, /Company Work fixture · 会社の勤務時間が未設定です/);
assert.doesNotMatch(text, /18:09–00:00/);
console.log('PASS TODAY separates company hours, personal windows, and unassigned Work');

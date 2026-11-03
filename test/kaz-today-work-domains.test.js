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

const sunday = create();
const plan = sunday.dashboard.component_data.today.today;
plan.now = {kind:'none',items:[]};
plan.next.items[0] = {...plan.next.items[0],estimate_min:null,plan_start:null,plan_end:null,
  placement:'ESTIMATE_REQUIRED',next_policy_window:{start:'2026-11-02T09:00:00+09:00',
    end:'2026-11-02T11:45:00+09:00',availability_confirmed:false}};
plan.work_time = {company_hours_configured:true,company_day_kind:'non_working_day',
  company_hours:[{start:'09:00',end:'11:45'},{start:'12:30',end:'17:30'}],
  next_company_window:plan.next.items[0].next_policy_window};
plan.candidate_diagnostics = {total_count:66,eligible_count:16,placed_count:0,
  terminal_count:35,waiting_state_count:2,not_actionable_state_count:13,
  deferred_preference_count:0,adopted_schedule_count:0,estimate_required_count:8,no_slot_count:8,unassigned_count:0};
sunday.dashboard.today.now=[];
sunday.dashboard.today.next=plan.next.items;
const sundayHost=fakeDom();
personal.render(sundayHost,{page:'today',id:null},sunday.dashboard.component_data.today,
  Date.parse(sunday.dashboard.generated_at));
assert.match(sundayHost.textContent,/今日は勤務対象曜日ではありません/);
assert.doesNotMatch(sundayHost.textContent,/勤務時間が設定されていない/);
assert.match(sundayHost.textContent,/月〜金 09:00–11:45、12:30–17:30/);
assert.match(sundayHost.textContent,/NEXT/);
assert.match(sundayHost.textContent,/現行画面を比較/);
assert.match(sundayHost.textContent,/予定・BUSY確認前/);
assert.match(sundayHost.textContent,/Work 66件 · 優先候補 16件 · 今日配置 0件/);
console.log('PASS configured non-working day retains NEXT without fabricating execution times');

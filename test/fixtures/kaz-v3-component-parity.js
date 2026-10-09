/* Synthetic data shared by old-read and Snapshot-read screenshot checks. */
(function (root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.KazV3ParityFixture = value;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function create() {
    const observed = new Date('2026-10-09T14:30:00+09:00');
    const fetched = new Date(observed.getTime() - 60_000).toISOString();
    const valid = new Date(observed.getTime() + 15 * 60_000).toISOString();
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(observed);
    const at = time => `${date}T${time}:00+09:00`;
    const source = revision => ({ status: 'ok', complete: true, fetched_at: fetched,
      valid_until: valid, source_revision: revision, scope: 'same-condition fixture', fetch_status: 'ok' });
    const w1 = { id: 'fx-work-1', work_id: 'FX-1', title: '表示契約を確認', state: 'DOING',
      priority: 'HIGH', project_name: 'Kaz OS', project_id: 'fx-project-1', estimate_min: 30,
      next_action: 'Snapshot整合を確認', action_type: 'review', planning_preference: 'today' };
    const w2 = { id: 'fx-work-2', work_id: 'FX-2', title: '現行画面を比較', state: 'READY',
      priority: 'MEDIUM', project_name: 'Kaz OS', project_id: 'fx-project-1', estimate_min: 20,
      next_action: '同一条件で撮影', action_type: 'review' };
    const w3 = { id: 'fx-work-3', work_id: 'FX-3', title: '確認待ちを整理', state: 'WAITING',
      project_name: 'Kaz OS', project_id: 'fx-project-1', estimate_min: null, waiting_reason: 'Human回答待ち' };
    const project = { id: 'fx-project-1', title: 'Kaz OS', status: 'ACTIVE', current_focus: 'Snapshot read',
      next_action: 'UI比較', milestones_done: null, milestones_total: null, source_revision: 'fixture:project' };
    const capa = { id: 'fx-capa-1', title: '表示差分を確認', status: 'Open', project: 'Kaz OS',
      created: date, effectiveness: '未確認' };
    const suggestion = { id: w2.id, title: w2.title, estimate_min: 20, priority: w2.priority, action_type: 'review' };
    const personal = [{ start: at('16:00'), end: at('17:00'), duration_min: 60, suggestions: [suggestion] }];
    const kaz = personal.map(window => ({ ...window, constraints: {
      company_busy: 'WorkBusy', personal_busy: 'Family Calendar timed (父)/（父） only' } }));
    const plan = {
      now: { kind: 'single', items: [w1] }, next: { kind: 'multiple', items: [w2] },
      scheduled: [w1, w2], waiting: [w3], waiting_count: 1,
      not_fit_today: [], not_fit_today_count: 0,
      company_free_windows: [], calendar_free_windows: personal, kaz_free_windows: kaz,
      calendar_state: { unknown_count: 0, unknown: [] }, availability: personal,
      preference_count: 1, daily_estimate_count: 0, missing_estimate_count: 1,
      active_count: 3, done_count: 0, cancelled_count: 0,
    };
    const component = {
      today: { schema_version: 'kaz-today-plan-v2', origin: 'real_operational_sources',
        fixture_only: true, sources: { work_items: source('fixture:work'),
          calendar: source('fixture:calendar'), work_busy: source('fixture:busy') }, today: plan },
      work: { origin: 'notion_official_api', fixture_only: true,
        sources: { work_items: source('fixture:work') }, work_items: [w1, w2, w3] },
      projects: { origin: 'notion_official_api', fixture_only: true,
        sources: { projects: source('fixture:projects'), tasks: source('fixture:work') },
        projects: [project], work_items: [w1, w2, w3] },
      capa: { origin: 'notion_official_api', fixture_only: true,
        sources: { capa: source('fixture:capa') }, capa_items: [capa] },
    };
    const v3Source = revision => ({ status: 'current', updated_at: fetched, valid_until: valid, revision });
    const sources = { projects: v3Source('fixture:projects'), work: v3Source('fixture:work'),
      capa: v3Source('fixture:capa'), calendar: v3Source('fixture:calendar'),
      work_busy: v3Source('fixture:busy'), decision_ledger: v3Source('fixture:ledger'),
      gardener: { status: 'not_connected', updated_at: null, valid_until: null, revision: null },
      today: v3Source('fixture:work'), inbox: v3Source('fixture:inbox') };
    const dashboard = { schema_version: 'kaz-os-dashboard-v3', generated_at: fetched, status: 'CURRENT',
      sources, today: { now: plan.now.items, next: plan.next.items, scheduled: plan.scheduled,
        waiting: plan.waiting, kaz_free_windows: kaz, company_free_windows: [],
        personal_free_windows: personal, confirmations: [] },
      work: component.work.work_items, projects: component.projects.projects,
      capa: component.capa.capa_items, component_data: component };
    const inboxView = { origin: 'real_operational_sources', mode: 'read_only_display', fixture_only: true,
      sources: { inbox: source('fixture:inbox') }, inbox_items: [],
      persistence: { status: 'disabled' }, writes: { notion: 0, calendar: 0, context: 0 } };
    const inbox = { schema_version: 'kaz-os-inbox-v3', generated_at: fetched, status: 'CURRENT',
      sources, inbox_items: [], component_data: inboxView };
    return { dashboard, inbox };
  }
  return { create };
});

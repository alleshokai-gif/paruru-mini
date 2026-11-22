/* Issue #240 UI harness fixtures. ALL VALUES ARE FICTIONAL (架空). No real IDs, people or data.
   Built relative to `now` so freshness / same-day checks pass whenever the harness is opened. */
(function (root) {
  'use strict';
  const HEX = c => c.repeat(64).slice(0, 64);
  const SHA = '0'.repeat(40);
  const REF = name => `https://github.com/alleshokai-gif/paruru-mini/blob/${SHA}/docs/${name}.md`;

  function jstDay(ms) { return new Date(ms + 9 * 3600000).toISOString().slice(0, 10); }
  function jstHour(ms) { return new Date(ms + 9 * 3600000).getUTCHours(); }
  // Same rule as autonomous-work.js nightDay(): 18:00 JST starts a night; before 18:00 → previous night.
  function nightDayOf(ms) {
    if (jstHour(ms) >= 18) return jstDay(ms);
    return jstDay(ms - 86400000);
  }

  function build(scenario, now) {
    const iso = min => new Date(now + min * 60000).toISOString();
    const day = jstDay(now);
    const okSource = (extra = {}) => ({ status: 'ok', complete: true, source_revision: 'fixture-rev-1',
      scope: '架空fixture範囲', fetched_at: iso(-10), valid_until: iso(180), fetch_status: 'ok',
      snapshot_ref: 'fixture://snapshot', ...extra });
    const current = (extra = {}) => ({ status: 'current', updated_at: iso(-10), valid_until: iso(180),
      revision: 'fixture-rev-1', ...extra });

    // ---------- Work / Projects / CAPA (fictional) ----------
    const projects = [
      { id: 'proj-a', title: '架空Project A：家計の見える化', status: 'ACTIVE', area: 'PALURU',
        milestones_done: 2, milestones_total: 5, source_revision: iso(-600),
        current_focus: '月次集計の自動化', next_action: '集計表のテストを追加', next_actor: '本人' },
      { id: 'proj-b', title: '架空Project B：とても長いプロジェクト名で折り返しと横はみ出しが起きないことを確認するための名前', status: 'BLOCKED', area: 'WORK',
        milestones_done: null, milestones_total: null, source_revision: iso(-900),
        current_focus: '外部APIの仕様確認', blocker: '架空: 外部仕様の回答待ち', next_action: null },
      { id: 'proj-c', title: '架空Project C：記録整理', status: 'REVIEW', area: 'PERSONAL',
        milestones_done: 4, milestones_total: 4, source_revision: iso(-1200), next_action: 'レビュー結果を確認' },
    ];
    const W = (n, extra) => ({ id: `0000000${n}-aaaa-bbbb-cccc-00000000000${n}`.slice(0, 36), work_id: `WI-${100 + n}`,
      project_id: 'proj-a', project_name: '架空Project A：家計の見える化', priority: 'MEDIUM', estimate_min: 30,
      source_revision: iso(-120 - n), next_actor: '本人', ...extra });
    const work = [
      W(1, { title: '架空Work：集計スクリプトのテスト追加', state: 'DOING', priority: 'HIGH', next_action: 'テストケースを3件書く。境界値も含める。' }),
      W(2, { title: '架空Work：カテゴリ定義の見直し', state: 'READY', next_action: '定義表を確認' }),
      W(3, { title: '架空Work：外部API連携', state: 'BLOCKED', project_id: 'proj-b', project_name: '架空Project B', blocker: '架空: 仕様回答待ち', priority: 'CRITICAL' }),
      W(4, { title: '架空Work：レビュー待ちのドキュメント', state: 'HUMAN_REVIEW', project_id: 'proj-c', project_name: '架空Project C：記録整理' }),
      W(5, { title: '架空Work：AI実行登録のみ（実行IDなし）', state: 'CODEX_RUNNING', next_actor: 'AI' }),
      W(6, { title: '架空Work：受入確認が必要な画面調整。タイトルが非常に長い場合でも二行で収まりつつ詳細で全文を読めることを確認する', state: 'ACCEPTANCE', priority: 'HIGH' }),
      W(7, { title: '架空Work：完了済み', state: 'DONE', priority: 'LOW' }),
      W(8, { title: '架空Work：取消済み', state: 'CANCELLED', priority: 'LOW' }),
    ];
    const pageDetails = {
      [work[0].id]: { status: 'current', purpose: '架空: 集計の誤りを防ぐ', completed: '架空: 雛形作成',
        remaining: '架空: 境界値テスト', work_evidence: { schema_version: 'kaz-notion-work-evidence-v1',
          observations: [{ kind: 'test', observed_on: jstDay(now - 86400000) }], pull_requests: [], refs: [] } },
    };
    const capaItems = [
      { id: 'capa-1', title: '架空CAPA：手順漏れの再発', status: 'Reopen', project: '架空Project A', created: '2026-11-01',
        effectiveness: '未達', trigger: '架空: 同じ手順漏れが2回', corrective_action: '架空: チェックリスト追加',
        preventive_action: '架空: 自動検査', context_path: 'capa/fixture-1.md', failure_classes: ['手順漏れ'] },
      { id: 'capa-2', title: '架空CAPA：効果確認中', status: 'Monitoring', project: '架空Project C', created: '2026-10-20',
        effectiveness: '確認中', corrective_action: '架空: 入力検証', context_path: 'capa/fixture-2.md' },
      { id: 'capa-3', title: '架空CAPA：効果項目が未記録', status: 'Corrective Action', created: '2026-11-15' },
      { id: 'capa-4', title: '架空CAPA：有効確認済み', status: 'Effective', project: '架空Project A', created: '2026-09-01',
        effectiveness: '有効', context_path: 'capa/fixture-4.md' },
    ];

    const empty = scenario === 'empty';
    const workList = empty ? [] : work;
    const projectList = empty ? [] : projects;
    const capaList = empty ? [] : capaItems;
    const degraded = scenario === 'degraded';

    const snapshot = {
      schema_version: 'kaz-os-dashboard-v3', status: degraded ? 'DEGRADED' : 'CURRENT', generated_at: iso(-5),
      sources: {
        work: current(), today: current({ valid_until: null }), projects: current({ status: degraded ? 'stale' : 'current' }),
        calendar: current({ status: degraded ? 'stale' : 'current' }), capa: current({ status: degraded ? 'failed' : 'current' }),
        work_busy: current({ status: degraded ? 'stale' : 'current' }),
      },
      projects: projectList, work: workList,
      today: {
        now: empty ? [] : [{ id: work[0].id, plan_start: iso(-20), plan_end: iso(40) }],
        next: empty ? [] : [{ id: work[1].id }], scheduled: [],
        company_free_windows: [{ start: iso(60), end: iso(120) }],
        personal_free_windows: [{ start: iso(200), end: iso(260) }],
        kaz_free_windows: [{ start: iso(200), end: iso(260) }, { start: iso(300), end: iso(330) }],
        confirmations: empty ? [] : [{ id: 'conf-1', short_title: '架空: 期限の確認', kind: '確認' }],
        unassigned: [],
      },
      component_data: {
        work: { origin: 'notion_official_api', mode: 'read_only', fixture_only: true,
          sources: { work_items: okSource({ complete: !degraded }), projects: okSource() },
          work_items: workList, page_details: pageDetails, active_runs: [] },
        projects: { origin: 'notion_official_api', mode: 'read_only', fixture_only: true,
          sources: { projects: okSource(), tasks: okSource() }, projects: projectList, work_items: workList,
          page_details: {}, progress_ui: { schema_version: 'kaz-project-work-progress-v1',
            project_order: projectList.map(p => p.id), work_order: workList.map(w => w.id),
            projects: Object.fromEntries(projectList.map((p, i) => [p.id, { priority: ['HIGH', 'CRITICAL', 'MEDIUM'][i],
              remaining_work_count: [4, 1, 0][i], completed_work_ids: i === 0 ? [work[6].id] : [],
              work_ids: workList.filter(w => w.project_id === p.id).map(w => w.id),
              state_counts: { DOING: i === 0 ? 1 : 0 } }])) } },
        capa: { origin: 'notion_official_api', mode: 'read_only', fixture_only: true,
          sources: { capa: okSource() }, capa_items: capaList },
        today: { fixture_only: true, sources: { work_items: okSource(), calendar: okSource(), work_busy: okSource() },
          today: { now: { kind: 'none', items: [] }, next: { kind: 'none', items: [] }, scheduled: [], waiting: [], waiting_count: 0 } },
      },
    };

    const planWork = w => ({ ...w, plan_start: iso(-20), plan_end: iso(40), placement: 'ADOPTED_SCHEDULE' });
    const plan = {
      schema_version: 'kaz-today-plan-v2', origin: 'real_operational_sources', mode: 'read_only', fixture_only: true,
      planning_date: day,
      sources: { work_items: okSource(), calendar: okSource(), work_busy: okSource() },
      writes: { notion: 0, calendar: 0, context: 0 },
      today: {
        now: empty ? { kind: 'none', items: [] } : { kind: 'single', items: [planWork(work[0])] },
        next: empty ? { kind: 'none', items: [] } : { kind: 'single', items: [work[1]] },
        scheduled: [], waiting: empty ? [] : [work[2]], waiting_count: empty ? 0 : 1,
        not_fit_today: [], not_fit_today_count: 0, availability: [],
        calendar_state: { unknown_count: empty ? 0 : 1 },
        company_free_windows: [{ start: iso(60), end: iso(120), duration_min: 60, suggestions: [] }],
        calendar_free_windows: [{ start: iso(200), end: iso(260), duration_min: 60, suggestions: [] }],
        unassigned: [], preference_count: 0, daily_estimate_count: 0, missing_estimate_count: empty ? 0 : 2,
        active_count: 6, done_count: 1, cancelled_count: 1,
        work_time: { company_hours_configured: true, company_hours: [{ start: '09:00', end: '18:00' }] },
        candidate_diagnostics: { total_count: workList.length, eligible_count: empty ? 0 : 2, placed_count: empty ? 0 : 1,
          terminal_count: empty ? 0 : 2, waiting_state_count: empty ? 0 : 2, not_actionable_state_count: 0,
          deferred_preference_count: 0, adopted_schedule_count: 0, estimate_required_count: 0, no_slot_count: 0, unassigned_count: 0 },
      },
    };

    // ---------- Autonomous (TODAY "AIが進めた仕事") ----------
    const night = nightDayOf(now);
    let start = Date.parse(night + 'T23:00:00+09:00');
    if (start > now - 60 * 60000) start = Math.min(Date.parse(night + 'T18:05:00+09:00'), now - 40 * 60000);
    const at = min => new Date(start + min * 60000).toISOString();
    const decision = { kind: 'priority_tradeoff', background: '架空: 2つの作業が同じ時間帯を取り合っています。',
      cause: '架空: 期限が近い作業が追加されたため。', verified_facts: '架空: テスト3件が通過しました。',
      remaining: '架空: 画面表示の確認が残っています。', recommended_option: '架空: 期限の近い作業を先に進める',
      alternative_option: '架空: 現在の作業を最後まで終える', recommendation_reason: '架空: 期限超過の影響が大きいため。',
      owner_reason: '架空: 優先順の入れ替えは本人の判断が必要です。' };
    const runItem = (extra) => ({ work_id: work[0].id, title: '架空Work', summary: '架空: 要約', review_question: '',
      review_estimate_min: null, substep_completed: false, review_read_status: 'current', pr_url: null, review: null, ...extra });
    const nightRun = {
      schema_version: 'kaz-autonomous-run-v1', run_id: HEX('a1b2c3d4'), status: 'review_pending',
      canonical_writes: 0, provider_api_calls: 0, auto_apply_allowed: false, raw_payload_stored: false,
      finished_at: at(30), night_day: night, codex_cli_attempts: 1,
      metrics: { usage: { input_tokens: 12000, cached_input_tokens: 3000, output_tokens: 2100 } },
      items: [
        runItem({ title: '架空Work：集計スクリプトのテスト追加', status: 'review_pending', review_state: 'owner_decision',
          substep_completed: true, validation: 'observed_git_facts', review_question: '架空: どちらを先に進めますか？',
          owner_decision: decision }),
        runItem({ work_id: work[1].id, title: '架空Work：カテゴリ定義の見直し', status: 'failed',
          summary: '架空: テスト実行が時間内に終わりませんでした。', error_code: 'TEST_TIMEOUT' }),
      ],
    };
    const pastRun = {
      schema_version: 'kaz-autonomous-run-v1', run_id: HEX('9f8e7d6c'), status: 'complete',
      canonical_writes: 0, provider_api_calls: 0, auto_apply_allowed: false, raw_payload_stored: false,
      finished_at: new Date(start - 3 * 86400000 + 30 * 60000).toISOString(),
      night_day: nightDayOf(start - 3 * 86400000), codex_cli_attempts: 1,
      items: [runItem({ title: '架空Work：以前の部分成果', status: 'complete', substep_completed: true,
        validation: 'observed_git_facts', pr_url: 'https://github.com/example-owner/example-repo/pull/1' })],
    };
    const usage = { input_tokens: 8000, cached_input_tokens: 1000, output_tokens: 900 };
    const partial = (label, extra) => ({ work_label: label, status: 'partial_completed', work_done: false,
      decision_required: false, title: `架空${label}の成果`, summary: '架空: 一手を進めました。',
      next_action: '架空: 次の一手を進める', evidence_refs: [REF('fixture-note')], ...extra });
    const daysAgo = (d, h = 2) => new Date(start - d * 86400000 + h * 3600000).toISOString();
    const autonomous = empty ? {
      schema_version: 'kaz-autonomous-view-v1', raw_payload_stored: false, status: 'no_results', run: null,
      as_of: new Date(now).toISOString(), partial_progress: [], night_runs: [], night_attempts: [],
      night_execution: { day: night, status: 'skipped', reason: 'no_eligible_work', inventory_count: 5,
        exclusions: { CANONICAL_CLOSED: 2, OWNER_BLOCKED: 1, HUMAN_GATE: 2 } },
    } : {
      schema_version: 'kaz-autonomous-view-v1', raw_payload_stored: false, status: 'current', run: pastRun,
      as_of: new Date(now).toISOString(),
      night_runs: [nightRun],
      night_execution: degraded ? { day: night, status: 'failed', reason: 'preflight_failed' } : { day: night, status: 'completed' },
      night_attempts: [{ work_label: 'WI-106', started_at: at(5), status: 'unknown' }],
      partial_progress: [
        partial('WI-101', { origin: 'night_artifact', started_at: at(2), completed_at: at(20), usage }),
        partial('WI-102', { origin: 'manual', completed_at: daysAgo(1), decision_required: true }),
        partial('WI-105', { origin: 'night_evidence', completed_at: daysAgo(3) }),
        partial('WI-103', { origin: 'night_evidence', completed_at: daysAgo(3, 1) }),
        partial('WI-104', { origin: 'night_evidence', completed_at: daysAgo(5) }),
      ],
    };

    // ---------- CONTEXT ----------
    const context = {
      schema_version: 'kaz-context-observatory-v1', mode: 'read_only', generated_at: iso(-30),
      source: { status: degraded ? 'stale' : 'ok', complete: true },
      totals: empty
        ? { raw: 0, saved_context: 0, raw_hold: 0, decision_candidate: 0, pain_point: 0, lesson: 0 }
        : { raw: 412, saved_context: 57, raw_hold: 3, decision_candidate: 21, pain_point: 9, lesson: 14 },
      pipeline: { sources: { gmail: { federated: 120 }, line: { federated: 33 }, calendar: { federated: 48 } },
        dispositions: { save: 12, aggregate: 150 }, disposition_sources: { save: { gmail: 8, google_calendar: 4 } },
        recent: empty ? [] : [{ source: 'gmail', disposition: 'SAVE', summary: '架空: 予定変更の連絡', observed_at: iso(-90) }] },
      semantic_profile: { counts: { career_market: 4, services_spending: 7, active_topics: 3 } },
      advisory: { available: true, candidate_count: 2, items: [{ title: '架空: 朝の作業時間', status: 'observe_only', summary: '架空: 観測継続中' }] },
      feedback: { available: true, event_count: 6, assessment_counts: { success: 4 }, items: [] },
      by_topic: empty ? [] : [{ topic: '架空:家計', count: 12 }, { topic: '架空:学校', count: 8 }],
      attention: { raw_hold_count: empty ? 0 : 3, high_importance_recent_count: 1 },
      recent: empty ? [] : [{ text: '架空: 明示保存したメモ', route: 'SAVED', captured_at: iso(-200), topics: ['家計'] }],
      writes: { raw: 0, intermediate: 0, canonical: 0, notion: 0, calendar: 0 },
    };

    // ---------- 開発実績 ----------
    const stat = (value, known, total) => ({ value, known, total });
    const period = (works, known, value) => ({
      sessions: works * 3, linked_sessions: works * 2, latest_session_at: iso(-300),
      summary: { works, completion_rate: stat(known ? value : null, known, works), one_shot_rate: stat(known ? value : null, known, works),
        elapsed_ms: stat(known ? 1800000 : null, known, works), human_interventions: stat(known ? 2 : null, known, works),
        rework_rate: stat(known ? 0 : null, known, works), coverage: stat(works ? known / works : null, works, works),
        outcomes: { complete: known, in_progress: Math.max(0, works - known - 1), unknown: works ? 1 : 0 },
        execution_ms: stat(known ? 900000 : null, known, works) },
      session_scope: { unregistered_development: 2, non_development: 1 },
      works: Array.from({ length: Math.min(works, 3) }, (_, i) => ({ work_id: `WI-${101 + i}`, outcome: i < known ? 'complete' : 'in_progress',
        evidence: i < known ? 'acceptance' : 'test_ci', model: 'fixture-model', reasoning_level: 'high',
        attempt_count: 1, session_count: 2, elapsed_ms: 1800000, execution_ms: 900000, github_links: [] })),
      models: works ? [{ model: 'fixture-model', reasoning_level: 'high', works, completion_rate: stat(value, known, works),
        one_shot_rate: stat(value, known, works), elapsed_ms: stat(1800000, known, works), human_interventions: stat(2, known, works),
        rework_rate: stat(0, known, works), input_tokens: stat(50000, works, works), output_tokens: stat(9000, works, works),
        cached_input_tokens: stat(12000, works, works), api_cost_usd: stat(null, 0, works) }] : [],
      trend: { day: [], week: works ? [{ period: '架空W1', works, completion_rate: stat(value, known, works),
        human_interventions: stat(2, known, works), elapsed_ms: stat(1800000, known, works) }] : [], month: [] },
    });
    const metrics = {
      schema_version: 'kaz-development-metrics-view-0.4', generated_at: iso(-60),
      source: { status: 'partial', unreadable_count: 2 },
      totals: { sessions: 42, input_tokens: 900000, output_tokens: 120000, cached_input_tokens: 300000, observed_span_ms: 36000000,
        github_linked_sessions: 20, github_linked_rate: 20 / 42, github_outcomes: { complete: 9, incomplete: 6, unknown: 5 },
        tasks: 9, task_outcomes: { complete: 4, incomplete: 3, unknown: 2 }, task_self_reports: { complete: 6, unknown: 3 } },
      tasks: empty ? [] : [{ reference: {kind:'pull_request',repository:'fixture/only',number:1}, session_count:2,
        github_outcome:'incomplete',github_status:'success',self_reported_outcome:'unknown',model:'synthetic-model-long-label-for-wrapping',input_tokens:100,output_tokens:20 }],
      models: [], context_comparison: [], availability: {}, sessions: [],
      productivity: { schema_version: 'kaz-development-productivity-v1', periods: {
        7: period(0, 0, null), 30: period(7, 1, 1), 90: period(12, 9, 0.78), all: period(20, 20, 0.85) } },
    };

    // ---------- Progress diagnostics (progress.js) ----------
    const progress = {
      source: { status: degraded ? 'partial' : 'ok', complete: !degraded, fetched_at: iso(-1) },
      generated_at: iso(-1), overview: { stage: 'BUILDING', scope: '架空fixture範囲' },
      achievements: [{ label: '架空の到達点', occurred_at: iso(-1440), evidence_ref: 'fixture://evidence', target_kind: 'work_item', target_id: 'wi-x' }],
      recent_wins: [{ work_item_id: 'wi-x', title: '架空Work', state: 'DONE', updated_at: iso(-1440), evidence_count: 1, revision: 'r1', history: [{ state: 'DOING' }, { state: 'DONE' }] }],
      waiting_for_review: [],
      recent_runs: [{ run_id: 'fixture-run-1', work_item: '架空Work', project: '架空Project', execution_status: 'failed',
        capture_status: 'partial', started_at: iso(-200), finished_at: iso(-150), tests: { passed: 3, total: 5 },
        human_review: 'pending', acceptance: 'pending' }],
      system_status: [{ id: 'context', label: '架空Context', state: 'FAILED', basis: '架空: 最終取得が失敗' },
        { id: 'calendar', label: '架空Calendar', state: 'LIVE', basis: '架空: 正常' }],
      source_health: [{ name: 'GitHub Context', status: 'failed', fetched_at: iso(-300), scope: '架空' },
        { name: 'Calendar', status: 'ok', fetched_at: iso(-5), scope: '架空' }],
      roadmap: null, next: { status: 'DRAFT' },
    };

    const failure = code => ({ __error: code });
    if (scenario === 'failed') {
      return { snapshot: failure('KAZ_READ_FAILED'), plan: failure('DIRECT_READ_FAILED'), autonomous: failure('AUTONOMOUS_READ_FAILED'),
        context: failure('KAZ_READ_FAILED'), metrics: failure('DEVELOPMENT_METRICS_UNAVAILABLE'), progress: failure('KAZ_READ_FAILED') };
    }
    return { snapshot, plan: degraded ? failure('DIRECT_READ_FAILED') : plan, autonomous, context, metrics, progress };
  }
  root.KazUi240Fixtures = Object.freeze({ build, nightDayOf, scenarios: ['normal', 'degraded', 'empty', 'failed', 'loading'] });
})(globalThis);

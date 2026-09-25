/* Read-only presentation functions. No transport, persistence, planner or mutation. */
(function (root, factory) {
  const view = factory(typeof module === 'object' && module.exports ? require('./today') : root.KazTodayView, typeof module === 'object' && module.exports ? require('./inbox') : root.KazInboxView);
  if (typeof module === 'object' && module.exports) module.exports = view;
  else root.KazPersonalView = view;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (todayView, inboxView) {
  'use strict';
  const PROJECT_STATES = ['ACTIVE', 'REVIEW', 'BLOCKED', 'BACKLOG', 'DONE'];
  const WORK_STATES = ['IDEA','BACKLOG','READY','SCHEDULED','DOING','WAITING','BLOCKED','CODEX_RUNNING','HUMAN_REVIEW','ACCEPTANCE','DONE','CANCELLED'];
  const INBOX_KINDS = { human_review: 'Human Review', acceptance: 'Acceptance', blocked: 'Blocked解除', idea: 'Idea', context_candidate: 'Context candidate' };
  const laneLimits = { now: 1, next: 2, quick_wins: 2, waiting_preview: 2 };
  const MAX_SOURCE_CLOCK_SKEW_MS = 60_000;
  const stamp = value => Date.parse(value);
  const list = value => Array.isArray(value) && value.every(v => v && typeof v.id === 'string' && v.id) && new Set(value.map(v => v.id)).size === value.length ? value : null;
  function health(source, now = Date.now()) {
    if (!source) return 'not_connected';
    if (['failed', 'not_connected', 'stale'].includes(source.status)) return source.status;
    if (!['ok', 'partial'].includes(source.status)) return 'failed';
    if (!Number.isFinite(stamp(source.fetched_at)) || !Number.isFinite(stamp(source.valid_until)) || stamp(source.fetched_at) > now + MAX_SOURCE_CLOCK_SKEW_MS || stamp(source.valid_until) <= now) return 'stale';
    if (!source.source_revision || !source.scope) return 'partial';
    return source.status === 'ok' && source.complete === true ? 'ok' : 'partial';
  }
  function milestones(project, evidence, trustworthy) {
    if (!trustworthy) return { label: '進捗は確認待ち', known: false };
    if (Object.hasOwn(project, 'milestones_done') || Object.hasOwn(project, 'milestones_total')) {
      const done = project.milestones_done, total = project.milestones_total;
      if (done === null && total === null) return { label: 'milestone未定義', known: false };
      if (!Number.isInteger(done) || !Number.isInteger(total) || done < 0 || done > total || total <= 0 || !project.source_revision) return { label: 'milestone定義を確認できません', known: false };
      return { label: `Notion定義 ${done} / ${total} milestones`, known: true, accepted: done, total };
    }
    if (project.milestones === null || Array.isArray(project.milestones) && !project.milestones.length) return { label: 'milestone未定義', known: false };
    const values = list(project.milestones);
    if (!values || project.milestones_complete !== true) return { label: 'milestone定義を確認できません', known: false };
    let accepted = 0;
    for (const m of values) {
      if (m.accepted === false) continue;
      const proof = evidence?.[m.evidence_ref];
      if (m.accepted !== true || !proof || proof.project_id !== project.id || proof.milestone_id !== m.id || proof.decision !== 'ACCEPTED') return { label: 'Acceptance Evidence確認待ち', known: false };
      accepted++;
    }
    return { label: `${accepted} / ${values.length} milestones`, known: true, accepted, total: values.length };
  }
  function weekStart(now) {
    const day = new Date(now + 9 * 3600000);
    day.setUTCHours(0, 0, 0, 0);
    day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
    return day.getTime() - 9 * 3600000;
  }
  function projectSummary(data, now = Date.now()) {
    const projects = list(data?.projects);
    if (!projects || health(data?.sources?.projects, now) !== 'ok' || projects.some(p => !PROJECT_STATES.includes(p.status))) return null;
    const result = Object.fromEntries(['ACTIVE', 'REVIEW', 'BLOCKED'].map(state => [state, projects.filter(p => p.status === state).length]));
    const history = data.project_history, ids = new Set(projects.map(p => p.id)), start = weekStart(now);
    if (health(history?.source, now) === 'ok' && stamp(history.coverage_from) <= start && Array.isArray(history.events)) {
      result.MOVED = new Set(history.events.filter(e => ids.has(e.project_id) && stamp(e.occurred_at) >= start && stamp(e.occurred_at) <= now &&
        (e.kind === 'milestone_acceptance' || e.kind === 'state_transition' && e.from_state !== e.to_state)).map(e => e.project_id)).size;
    }
    return result;
  }
  function route(hash) {
    const match = /^#kaz-os(?:\/(today|work|projects|inbox)(?:\/([^/]+))?)?$/.exec(hash || '');
    if (!match) return { page: 'today', id: null };
    const page = match[1] || 'today';
    let id = null;
    try { if (match[2]) id = decodeURIComponent(match[2]); } catch { /* Invalid URL is not an entity ID. */ }
    return { page, id };
  }
  function render(host, selection, data, now = Date.now(), options = {}) {
    if (!selection || !['today', 'work', 'projects', 'inbox'].includes(selection.page)) selection = { page: 'today', id: null };
    todayView?.dispose(host);
    inboxView?.dispose(host);
    host.replaceChildren();
    const doc = host.ownerDocument;
    const el = (tag, text = '', cls = '') => { const n = doc.createElement(tag); n.textContent = text; if (cls) n.className = cls; return n; };
    const add = (tag, text, cls, parent = host) => { const n = el(tag, text, cls); parent.append(n); return n; };
    const part = title => { const s = add('section', '', 'kp-section'); add('h2', title, '', s); return s; };
    const link = (text, page, id, cls = '') => { const a = el('a', text, cls); a.href = `#kaz-os/${page}${id ? '/' + encodeURIComponent(id) : ''}`; return a; };
    const fold = (text, parent = host) => { const d = add('details', '', 'kp-detail', parent); add('summary', text, '', d); return d; };
    const fmt = value => Number.isFinite(stamp(value)) ? new Date(value).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' }) : '時刻未確認';
    const estimate = value => Number.isFinite(value) && value >= 0 ? `${value}m` : '時間未確認';
    const state = value => PROJECT_STATES.includes(value) ? value : 'STATUS未確認';
    const badge = value => el('span', value, 'kp-badge kp-' + (PROJECT_STATES.includes(value) ? value.toLowerCase() : 'unknown'));
    const sourceState = name => health(data?.sources?.[name], now);
    function notice(name, parent = host) {
      const status = sourceState(name);
      if (status !== 'ok') add('p', `${status.toUpperCase().replace('_', ' ')} · ${status === 'partial' ? '一部情報を取得できていません。表示は取得済み範囲です。' : status === 'not_connected' ? '実データsourceは未接続です。0件ではありません。' : status === 'stale' ? '情報が古いため現況を確定できません。' : name === 'projects' ? 'Projectsを取得できません。0件ではありません。' : '取得できませんでした。0件ではありません。'}`, 'kp-notice', parent);
      return status;
    }
    const projects = list(data?.projects), work = list(data?.work_items);
    const project = id => projects?.find(p => p.id === id);
    const wi = id => work?.find(w => w.id === id);
    function workDetail(w, parent) {
      const d = fold(`${w.title} · ${w.state} · ${estimate(w.estimate_min)}`, parent);
      d.dataset.workItem = w.id;
      add('p', `担当 ${w.next_actor || '未確認'} · ${w.action_instruction || w.next_action || w.title}`, '', d);
      add('p', `Dependency: ${Array.isArray(w.dependencies) ? w.dependencies.length ? w.dependencies.join(' / ') : 'なし（取得範囲内）' : '未確認'}`, 'kp-muted', d);
      add('p', `Blocker: ${w.blocker || (w.state === 'BLOCKED' ? '理由の確認が必要' : '未記載')}`, 'kp-muted', d);
      const evidence = fold('Run / tests / Evidence', d), proof = data?.evidence?.[w.evidence_ref];
      add('p', `Work Item ${w.work_id || w.id} · revision ${w.revision ?? w.source_revision ?? '未確認'}`, 'kp-muted', evidence);
      add('p', w.evidence_ref ? `Evidence ref: ${w.evidence_ref}` : 'Evidenceは未取得', 'kp-muted', evidence);
      if (proof) for (const key of ['run_id', 'execution_status', 'tests_summary', 'human_review_status', 'acceptance_status', 'git_diff_ref']) if (proof[key] != null) add('p', `${key}: ${proof[key]}`, 'kp-muted', evidence);
      const runs = sourceState('runs') === 'ok' && list(data?.active_runs);
      if (runs) for (const run of runs.filter(r => r.work_item_id === w.id)) add('p', `Run ${run.id} · ${run.execution_status} · Human Review ${run.human_review_status}`, 'kp-muted', evidence);
      add('p', '閲覧のみ。Human ReviewとAcceptanceは別の判断です。', 'kp-muted', d);
      return d;
    }
    function progressRow(p, parent, trusted, compact = false) {
      const notion = data?.origin === 'notion_official_api';
      const metric = milestones(p, data?.evidence, trusted && sourceState(notion ? 'projects' : 'milestones') === 'ok');
      const row = add('div', '', 'kp-milestones', parent);
      if (metric.known) { const bar = el('progress'); bar.max = metric.total; bar.value = metric.accepted; bar.setAttribute('aria-label', `${p.title} ${notion ? 'Notion定義' : 'accepted'} milestones ${metric.accepted} / ${metric.total}`); row.append(bar); }
      row.append(el('span', compact && metric.known ? `${metric.accepted}/${metric.total}` : metric.label));
      row.title = metric.label;
    }
    if (data?.fixture_only === true) add('p', '検証用fixture · 全件架空・実データではありません', 'kp-fixture');
    if (selection.page === 'today') {
      const head = part('TODAY');
      add('p', '実Work ItemsとFamily Calendarから、いま使える時間に合わせて候補を整理', 'kp-subtitle', head);
      const workHealth = notice('work_items', head);
      if (data?.origin === 'notion_official_api' && data?.sources?.work_items) {
        const source = data.sources.work_items;
        const fetched = Number.isFinite(stamp(source.fetched_at)) ? new Date(source.fetched_at).toLocaleString('ja-JP', {timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) + ' JST' : '取得時刻未確認';
        add('p', `実データ · Notion / READ-ONLY · ${source.fetch_status} · ${fetched}`, 'kp-muted', head);
      }
      if (workHealth !== 'ok' || !data?.today) return;

      const t = data.today, v2 = data.schema_version === 'kaz-today-plan-v2';
      const renderCandidate = (w, parent, label) => {
        const row = add('article', '', 'kp-work-row kp-today-row', parent);
        row.dataset.workItem = w.id;
        const top = add('div', '', 'kp-project-head', row);
        top.append(el('strong', w.title));
        top.append(el('span', w.state, 'kp-badge kp-' + String(w.state || '').toLowerCase()));
        if (w.priority) top.append(el('span', w.priority, 'kp-badge kp-priority'));
        if (w.planning_preference) top.append(el('span', w.planning_preference, 'kp-badge kp-planning-preference'));
        add('p', `${w.project_name} · ${w.work_id} · ${estimate(w.estimate_min)}`, 'kp-muted', row);
        if (w.plan_start && w.plan_end) add('p', `${fmt(w.plan_start)}–${fmt(w.plan_end)} · ${w.placement || '配置済み'}`, 'kp-muted', row);
        else if (w.placement === 'ESTIMATE_REQUIRED') add('p', '所要時間未設定。INBOXで分数を答えると配置できます。', 'kp-notice', row);
        else if (w.placement === 'NO_AVAILABLE_SLOT') add('p', '今日は確定している空き時間に収まりません。', 'kp-notice', row);
        else if (w.waiting_reason) add('p', `待ち理由: ${w.waiting_reason}`, 'kp-muted', row);
        if (w.next_action) add('p', `${label} ${w.next_action}`, 'kp-next', row);
        if (w.blocker) add('p', `BLOCKER ${w.blocker}`, 'kp-blocker', row);
      };

      const focusCount=(t.now?.items?.length||0)+(t.next?.items?.length||0);
      if(v2)add('p', `今日の3つ · ${focusCount}/3`, 'kp-muted', head);

      const nowSection = part('NOW');
      if (t.now?.kind === 'none') add('p', v2 ? 'いま着手する項目はありません。' : 'DOINGのWork Itemはありません。', 'kp-muted', nowSection);
      else (t.now?.items || []).forEach(w => renderCandidate(w, nowSection, 'NOW'));

      const nextSection = part('NEXT');
      if (t.next?.kind === 'none') add('p', '次候補はありません。', 'kp-muted', nextSection);
      else (t.next?.items || []).forEach(w => renderCandidate(w, nextSection, 'NEXT'));

      if (v2) {
        const scheduled = part('SCHEDULED');
        if (!(t.scheduled || []).length) add('p', '今日の時間付き配置はありません。', 'kp-muted', scheduled);
        else (t.scheduled || []).forEach(w => renderCandidate(w, scheduled, 'SCHEDULED'));

        const waiting = part('WAITING');
        add('p', `${t.waiting_count}件 · Human/state/Estimate待ち`, 'kp-muted', waiting);
        if (!(t.waiting || []).length) add('p', '待ち項目はありません。', 'kp-muted', waiting);
        else (t.waiting || []).forEach(w => renderCandidate(w, waiting, 'WAITING'));

        const notFit = part('NOT FIT TODAY');
        add('p', `${t.not_fit_today_count}件 · 所要時間は分かっているが今日の確定枠には入らない候補`, 'kp-muted', notFit);
        if (!(t.not_fit_today || []).length) add('p', '入らなかった候補はありません。', 'kp-muted', notFit);
        else (t.not_fit_today || []).forEach(w => renderCandidate(w, notFit, 'LATER'));

        const availability = fold('AVAILABLE / Calendar');
        if (t.calendar_state?.unknown_count) add('p', `未分類/不明のCalendar予定 ${t.calendar_state.unknown_count}件は空き時間扱いしていません。`, 'kp-notice', availability);
        if (!t.availability?.length) add('p', '現在、安全に確定できる空き時間はありません。', 'kp-muted', availability);
        else t.availability.forEach(slot => add('p', `${fmt(slot.start)}–${fmt(slot.end)}`, 'kp-muted', availability));

        const meta = fold('Dynamic Daily Planning v2の判定範囲');
        add('p', 'Notion Work ItemのOperational state / Priority / Deadline / Scheduledと、Humanの当日意向・Human Estimate・確認済みCalendar拘束を使用。AI duration推定・Energy・UI scoreは使っていません。', 'kp-muted', meta);
        add('p', `Human preference ${t.preference_count}件 · Daily Estimate ${t.daily_estimate_count}件 · Estimate確認待ち ${t.missing_estimate_count}件`, 'kp-muted', meta);
        add('p', `Active ${t.active_count} · Done ${t.done_count} · Cancelled ${t.cancelled_count}`, 'kp-muted', meta);
      } else {
        const availability = part('AVAILABLE');
        if (t.calendar_state?.unknown_count) add('p', `未分類/不明のCalendar予定 ${t.calendar_state.unknown_count}件は空き時間扱いしていません。`, 'kp-notice', availability);
        if (!t.availability?.length) add('p', '現在、安全に確定できる空き時間はありません。', 'kp-muted', availability);
        else t.availability.forEach(slot => add('p', `${fmt(slot.start)}–${fmt(slot.end)}`, 'kp-muted', availability));

        const waiting = part('WAITING');
        add('p', `${t.waiting_count}件 · WAITING / BLOCKED / CODEX_RUNNING`, 'kp-muted', waiting);
        (t.waiting || []).forEach(w => renderCandidate(w, waiting, 'NEXT'));

        const meta = fold('Dynamic Daily Planning v1の判定範囲');
        add('p', 'Work Itemsの明示Status / Deadline / Priority / Estimateと、Human確認済みCalendar拘束・未分類Calendarを使用。Energy・AI推定時間・UI scoreは使っていません。', 'kp-muted', meta);
        add('p', `Estimate未設定 ${t.missing_estimate_count}件 · 明示Estimateあり未配置 ${t.unplaced_explicit_estimate_count}件`, 'kp-muted', meta);
        add('p', `Active ${t.active_count} · Done ${t.done_count} · Cancelled ${t.cancelled_count}`, 'kp-muted', meta);
      }
      return;
    }
    if (selection.page === 'work') {
      const head = part('WORK');
      add('p', '全Project横断のWork Items', 'kp-subtitle', head);
      const workHealth = notice('work_items', head);
      if (data?.origin === 'notion_official_api' && data?.sources?.work_items) {
        const source = data.sources.work_items;
        const fetched = Number.isFinite(stamp(source.fetched_at)) ? new Date(source.fetched_at).toLocaleString('ja-JP', {timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) + ' JST' : '取得時刻未確認';
        add('p', `実データ · Notion / READ-ONLY · ${source.fetch_status} · ${fetched}`, 'kp-muted', head);
        head.dataset.snapshotRef = source.snapshot_ref || '';
      }
      if (!['ok', 'partial'].includes(workHealth)) return;
      if (!work) { add('p', 'Work Items一覧を確認できません。重複・欠落を解消してください。', 'kp-notice'); return; }
      add('p', `${work.length} Work Items · 表示順はOperational state順。UIで独自priority scoreは付けません。`, 'kp-muted', head);
      if (!work.length) { add('p', 'この取得範囲のWork Itemは0件です。'); return; }
      const rows = add('div', '', 'kp-work-list');
      const terminal = [];
      work.forEach(w => {
        if (!WORK_STATES.includes(w.state)) return;
        if (['DONE','CANCELLED'].includes(w.state)) { terminal.push(w); return; }
        const row = add('article', '', 'kp-work-row', rows); row.dataset.workItem = w.id;
        const top = add('div', '', 'kp-project-head', row);
        top.append(el('strong', w.title));
        top.append(el('span', w.state, 'kp-badge kp-' + w.state.toLowerCase()));
        if (w.priority) top.append(el('span', w.priority, 'kp-badge kp-priority'));
        add('p', `${w.project_name} · ${w.work_id} · ${estimate(w.estimate_min)}`, 'kp-muted', row);
        if (w.next_action) add('p', `NEXT ${w.next_action}`, 'kp-next', row);
        if (w.blocker || w.state === 'BLOCKED') add('p', `BLOCKER ${w.blocker || '理由は未確認'}`, 'kp-blocker', row);
      });
      if (terminal.length) {
        const closed = fold(`終了した項目 ${terminal.length}件`);
        terminal.forEach(w => {
          const row = add('div', '', 'kp-work-row', closed); row.dataset.workItem = w.id;
          add('strong', w.title, '', row);
          add('p', `${w.project_name} · ${w.work_id} · ${w.state}`, 'kp-muted', row);
        });
      }
      return;
    }

    if (selection.page === 'projects') {
      const head = part(selection.id ? 'PROJECT DETAIL' : 'PROJECTS');
      add('p', 'Kazの全活動を眺める', 'kp-subtitle', head);
      const healthState = notice('projects', head);
      if (data?.origin === 'notion_official_api') {
        const source = data.sources.projects;
        const fetched = Number.isFinite(stamp(source.fetched_at)) ? new Date(source.fetched_at).toLocaleString('ja-JP', {timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) + ' JST' : '取得時刻未確認';
        add('p', `実データ · Notion / READ-ONLY · ${source.fetch_status} · ${fetched}`, 'kp-muted', head);
        head.dataset.snapshotRef = source.snapshot_ref || '';
      }
      if (!['ok', 'partial'].includes(healthState)) return;
      if (!projects) { add('p', 'Project一覧を確認できません。重複・欠落を解消してください。', 'kp-notice'); return; }
      const current = healthState === 'ok';
      if (selection.id) {
        head.prepend(link('← PROJECTS', 'projects', null, 'kp-back'));
        const p = project(selection.id);
        if (!p) { add('p', 'この取得範囲にProjectが見つかりません。'); return; }
        add('h3', p.title, 'kp-project-title'); host.append(badge(state(p.status)));
        add('p', `FOCUS ${p.current_focus || '未設定'}`);
        progressRow(p, host, current);
        add('p', `NEXT ${p.next_action || '未設定'}`);
        if (p.blocker || p.status === 'BLOCKED') add('p', `BLOCKER ${p.blocker || '未確認'}`);
        const proof = fold('Milestoneの定義とAcceptance');
        if (Array.isArray(p.milestones)) p.milestones.forEach(m => add('p', `${m.id} · ${m.accepted ? 'Acceptance参照 ' + (m.evidence_ref || '未取得') : '未完了'}`, 'kp-muted', proof));
        else add('p', p.milestones_done != null ? 'NotionのDone / Total集計値。個別MilestoneのAcceptance Evidenceは未取得。' : 'milestone未定義', 'kp-muted', proof);
        if (data?.origin === 'notion_official_api') {
          const reference = fold('取得元 / snapshot参照');
          add('p', `Notion Project ${p.id} · revision ${p.source_revision}`, 'kp-muted', reference);
          add('p', data.sources.projects.snapshot_ref || '参照未取得', 'kp-muted', reference);
        }
        const items = part('Work Items'); const h = notice('tasks', items);
        if (!work || !['ok', 'partial'].includes(h)) return;
        const members = work.filter(w => w.project_id === p.id);
        add('p', `${members.length}件 · 取得範囲内`, 'kp-muted', items);
        const terminal = members.filter(w => ['DONE', 'CANCELLED'].includes(w.state));
        members.filter(w => !terminal.includes(w)).forEach(w => workDetail(w, items));
        if (terminal.length) { const closed = fold(`終了した項目 ${terminal.length}件`, items); terminal.forEach(w => workDetail(w, closed)); }
        return;
      }
      const summary = projectSummary(data, now);
      if (summary) {
        const kpis = add('div', '', 'kp-kpis', head);
        Object.entries(summary).forEach(([key, count]) => { const n = add('div', '', '', kpis); n.dataset.projectKpi = key; add('strong', String(count), '', n); add('span', key === 'MOVED' ? 'moved this week' : key, '', n); });
      }
      add('p', `${projects.length} Projects · ${current ? data.sources.projects.scope : '部分取得'}`, 'kp-muted', head);
      if (!projects.length) { add('p', 'この取得範囲のProjectは0件です。'); return; }
      const rows = add('div', '', 'kp-projects');
      projects.forEach(p => {
        const row = link('', 'projects', p.id, 'kp-project-row'); row.dataset.projectId = p.id;
        const title = el('div', '', 'kp-project-head'); title.append(el('strong', p.title), badge(state(p.status))); title.title = p.title; row.append(title);
        const focus = add('div', p.current_focus || '未設定', 'kp-focus', row); focus.title = p.current_focus || '未設定';
        const footer = add('div', '', 'kp-project-footer', row);
        progressRow(p, footer, current, true);
        const blocked = p.status === 'BLOCKED' || Boolean(p.blocker);
        const action = blocked ? p.blocker || '理由は未確認' : p.next_action || '未設定';
        const next = add('div', '', blocked ? 'kp-blocker' : 'kp-next', footer);
        next.title = `${blocked ? 'Blocker' : '次の行動'}: ${action}`; next.setAttribute('aria-label', next.title);
        const icon = el('span', blocked ? '⚠' : '⏭'); icon.setAttribute('aria-hidden', 'true');
        next.append(icon, el('span', action, 'kp-project-action-text'));
        rows.append(row);
      });
      return;
    }
    if (selection.page === 'inbox') {
      if (inboxView) inboxView.render(host, selection, data, now, { ...options, health, workDetail });
      else host.textContent = 'INBOXの表示moduleを再取得してください。';
      return;
    }
  }
  return { render, health, milestones, projectSummary, route, weekStart };
});

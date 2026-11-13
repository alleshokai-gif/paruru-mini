/* Read-only presentation functions. No transport, persistence, planner or mutation. */
(function (root, factory) {
  const view = factory(typeof module === 'object' && module.exports ? require('./today') : root.KazTodayView, typeof module === 'object' && module.exports ? require('./inbox') : root.KazInboxView);
  if (typeof module === 'object' && module.exports) module.exports = view;
  else root.KazPersonalView = view;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (todayView, inboxView) {
  'use strict';
  const PROJECT_STATES = ['ACTIVE', 'REVIEW', 'BLOCKED', 'BACKLOG', 'DONE'];
  const WORK_STATES = ['IDEA','BACKLOG','READY','SCHEDULED','DOING','WAITING','BLOCKED','CODEX_RUNNING','HUMAN_REVIEW','ACCEPTANCE','DONE','CANCELLED'];
  const WORK_PRIORITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
  const WORK_STAGES = { IDEA: '構想', BACKLOG: '着手待ち', READY: '着手可能', SCHEDULED: '着手予定',
    DOING: '作業中', CODEX_RUNNING: 'AI実行中', WAITING: '待機中', BLOCKED: '停止中',
    HUMAN_REVIEW: 'レビュー段階', ACCEPTANCE: '受入段階', DONE: '完了登録', CANCELLED: '取消済み' };
  const isClosedWork = work => ['DONE', 'CANCELLED'].includes(work.state);
  const priorityRank = value => {
    const index = WORK_PRIORITIES.indexOf(value);
    return index < 0 ? WORK_PRIORITIES.length : index;
  };
  const workNumber = value => {
    const match = typeof value === 'string' && /^WI-([0-9]+)$/.exec(value);
    const number = match ? Number(match[1]) : NaN;
    return Number.isSafeInteger(number) ? number : null;
  };
  function compareWorkNumbers(a, b, direction) {
    const left = workNumber(a.work_id), right = workNumber(b.work_id);
    if (left === null || right === null) return Number(left === null) - Number(right === null);
    return direction === 'desc' ? right - left : left - right;
  }
  const OUTCOME_SCHEMA = 'kaz-outcome-contract-v1';
  const OUTCOME_LABEL = { achieved: '達成', unmet: '未達', unverified: '未確認' };
  const EVIDENCE_LABEL = { record: '記録', test: 'テスト', pr: 'PR作成', merge: 'マージ',
    deploy: '本番反映', runtime: '本番動作', use: '実利用', reference: '参考' };
  const EVIDENCE_URL = /^https:\/\/(?:github\.com\/[\w.-]+\/[\w.-]+\/(?:(?:pull|issues|actions\/runs)\/[1-9][0-9]*|commit\/[0-9a-f]{40})|(?:app\.)?notion\.com\/(?:p\/)?[0-9a-f]{32}|www\.notion\.so\/[0-9a-f]{32})$/;
  const CHECKPOINTS = {
    record: ['記録確認', 0], research: ['仕様調査の実績', 0], decision: ['方針承認の記録', 0],
    partial: ['部分成果あり', 1], test: ['テスト確認', 2], pr_draft: ['PR下書き', 3], pr: ['PR作成', 3],
    merge: ['マージ確認', 4], deploy: ['本番反映の実績', 5], runtime: ['本番動作の実績', 6], use: ['実利用の実績', 7],
  };
  const jst = value => new Date(value).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo',
    year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' JST';
  const evidenceDay = value => new Date(value + 9 * 3600000).toISOString().slice(0, 10);

  function assessWork(w, { trusted, detail, outcome, history, pullRequest, at }) {
    if (!trusted) return { label: '取得未確認', reason: '最新のWorkデータを確認できません。' };
    if (w.state === 'CANCELLED') return { label: WORK_STAGES.CANCELLED, reason: 'Notionで取消と登録されています。' };
    const checkpoints = [];
    function observe(kind, day, source, ref, effect = 'supports') {
      if (Object.hasOwn(CHECKPOINTS, kind) && /^\d{4}-\d{2}-\d{2}$/.test(day || '') && day <= evidenceDay(at))
        checkpoints.push({ kind, day, source, ref, effect });
    }
    const records = detail?.work_evidence;
    if (records?.schema_version === 'kaz-notion-work-evidence-v1') {
      for (const observation of records.observations || [])
        observe(observation.kind, observation.observed_on, 'Notionの実績記録');
      for (const pr of records.pull_requests || []) {
        const occurred = stamp(pr.occurred_at);
        if (['merge', 'pr', 'pr_draft'].includes(pr.kind) && Number.isFinite(occurred) && occurred <= at
          && EVIDENCE_URL.test(pr.ref)) observe(pr.kind, evidenceDay(occurred), 'Notionに紐づくPR（GitHub確認）', pr.ref);
      }
    }
    for (const ac of outcome?.criteria || []) {
      for (const proof of ac.evidence || []) {
        if (proof.effect === 'supports') observe(proof.kind, proof.observed_on, `${ac.id}の証拠`, proof.ref);
        if (proof.effect === 'contradicts' && proof.kind === ac.requires && ac.result === 'unmet')
          observe(proof.kind, proof.observed_on, `${ac.id}の未達を示す証拠`, proof.ref, proof.effect);
      }
    }
    if (history && Number.isFinite(stamp(history.completed_at)) && stamp(history.completed_at) <= at)
      observe('partial', evidenceDay(stamp(history.completed_at)), '実行履歴', history.evidence_refs[0]);
    if (pullRequest && Number.isFinite(pullRequest.at) && pullRequest.at <= at)
      observe('pr', evidenceDay(pullRequest.at), '実行履歴', pullRequest.ref);
    checkpoints.sort((a, b) => b.day.localeCompare(a.day)
      || Number(b.effect === 'contradicts') - Number(a.effect === 'contradicts')
      || CHECKPOINTS[b.kind][1] - CHECKPOINTS[a.kind][1]);
    const observed = checkpoints[0];
    if (outcome?.criteria.every(ac => ac.result === 'achieved'))
      return { label: 'AC達成', observed, tone: 'verified', reason: '登録されている完成条件の達成を確認しました。' };
    if (observed?.effect === 'contradicts')
      return { label: 'AC未達を確認', observed, tone: 'gap', reason: '直近の証拠で未達だった条件と残りを、下の成果条件で確認できます。' };
    if (observed) {
      const label = observed.source === 'Notionに紐づくPR（GitHub確認）'
        ? `関連${observed.kind === 'merge' ? 'PRマージ' : CHECKPOINTS[observed.kind][0]}` : CHECKPOINTS[observed.kind][0];
      return { label, observed, tone: 'evidence',
        reason: '日付と証拠を確認できた直近の実績です。Work全体の完成判定は下の成果条件を参照してください。' };
    }
    const reason = detail?.status === 'unavailable' ? 'Notion本文を取得できません。' :
      outcome ? '成果条件に到達を確認できる証拠がありません。' :
      '日付付きの実績または関連する実行履歴を確認できません。';
    return { label: WORK_STAGES[w.state] || '段階未確認', reason: `${reason} Notionの登録状態を表示しています。` };
  }
  const INBOX_KINDS = { human_review: 'Human Review', acceptance: 'Acceptance', blocked: 'Blocked解除', idea: 'Idea', context_candidate: 'Context candidate' };
  const laneLimits = { now: 1, next: 2, quick_wins: 2, waiting_preview: 2 };
  const MAX_SOURCE_CLOCK_SKEW_MS = 60_000;
  const stamp = value => Date.parse(value);
  const list = value => Array.isArray(value) && value.every(v => v && typeof v.id === 'string' && v.id) && new Set(value.map(v => v.id)).size === value.length ? value : null;
  function health(source, now = Date.now()) {
    if (!source) return 'not_connected';
    if (source.snapshot_status) {
      if (source.snapshot_status !== 'current')
        return ['stale', 'failed', 'not_connected'].includes(source.snapshot_status) ? source.snapshot_status : 'failed';
      return source.complete === true && source.source_revision && source.scope ? 'ok' : 'partial';
    }
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
    const match = /^#kaz-os(?:\/(today|work|projects|capa|context|inbox)(?:\/([^/]+))?)?$/.exec(hash || '');
    if (!match) return { page: 'today', id: null };
    const page = match[1] || 'today';
    let id = null;
    try { if (match[2]) id = decodeURIComponent(match[2]); } catch { /* Invalid URL is not an entity ID. */ }
    return { page, id };
  }
  function render(host, selection, data, now = Date.now(), options = {}) {
    if (!selection || !['today', 'work', 'projects', 'capa', 'context', 'inbox'].includes(selection.page)) selection = { page: 'today', id: null };
    todayView?.dispose(host);
    inboxView?.dispose(host);
    host.replaceChildren();
    const doc = host.ownerDocument;
    const el = (tag, text = '', cls = '') => { const n = doc.createElement(tag); n.textContent = text; if (cls) n.className = cls; return n; };
    const add = (tag, text, cls, parent = host) => { const n = el(tag, text, cls); parent.append(n); return n; };
    const part = (title, parent = host) => { const s = add('section', '', 'kp-section', parent); add('h2', title, '', s); return s; };
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
    const projects = list(data?.projects), work = list(data?.work_items), capa = list(data?.capa_items);
    const progressUi = data?.progress_ui?.schema_version === 'kaz-project-work-progress-v1' ? data.progress_ui : null;
    const inRecordedOrder = (rows, ids) => {
      if (!rows || !Array.isArray(ids) || ids.length !== rows.length) return rows;
      const byId = new Map(rows.map(row => [row.id, row]));
      return new Set(ids).size === rows.length && ids.every(id => byId.has(id))
        ? ids.map(id => byId.get(id)) : rows;
    };
    const project = id => projects?.find(p => p.id === id);
    const wi = id => work?.find(w => w.id === id);
    const detailOf = row => data?.page_details?.[row?.id];
    const detailText = (row, key) => detailOf(row)?.status === 'current'
      ? detailOf(row)[key] || '未記録'
      : detailOf(row)?.status === 'unavailable' ? '本文を取得できません' : '未記録';
    function outcomeOf(row, kind, source) {
      const detail = detailOf(row), contract = detail?.outcome;
      return sourceState(source) === 'ok' && detail?.status === 'current'
        && contract?.schema_version === OUTCOME_SCHEMA && contract.kind === kind
        && Array.isArray(contract.criteria) && contract.criteria.length ? contract : null;
    }
    function outcomeCounts(contract) {
      return Object.entries(OUTCOME_LABEL).map(([result, label]) =>
        `${label} ${contract.criteria.filter(row => row.result === result).length}件`).join(' · ');
    }
    function showOutcome(row, kind, source) {
      const contract = outcomeOf(row, kind, source);
      if (!contract) {
        const detail = detailOf(row);
        if (detail?.outcome_status === 'invalid' || detail?.status === 'unavailable'
            || (detail?.outcome && sourceState(source) !== 'ok'))
          add('p', '成果条件を確認できません。達成状況は未確認です。', 'kp-notice');
        else if (data?.origin === 'notion_official_api')
          add('p', '成果条件: 未定義。記録上の状態を表示しています。', 'kp-muted');
        return null;
      }
      const group = part(kind === 'project' ? 'Projectの成果目標' : 'Workの完成条件');
      group.classList.add('kp-outcome');
      if (kind === 'project')
        add('p', contract.mode === 'ongoing' ? '継続運用 · 下の判定は目標の達成状況です。' : '完了型Project', 'kp-muted', group);
      const integration = kind === 'project' && sourceState('tasks') === 'ok'
        ? data.outcome_integration?.[row.id] : null;
      add('p', `目的: ${contract.why}`, '', group);
      add('p', `ゴール: ${contract.goal}`, 'kp-outcome-goal', group);
      add('p', `現在地: ${contract.current_state}`, '', group);
      add('p', outcomeCounts(contract), 'kp-outcome-counts', group);
      if (kind === 'project') add('p', `統合判定: ${OUTCOME_LABEL[integration?.status] || '未確認'}`, 'kp-muted', group);
      const scope = fold('対象範囲', group);
      add('p', `対象: ${contract.scope?.in}`, '', scope);
      add('p', `対象外: ${contract.scope?.out}`, '', scope);
      for (const ac of contract.criteria) {
        const card = fold(`${ac.id} · ${OUTCOME_LABEL[ac.result] || '未確認'} · ${ac.condition}`, group);
        add('p', `判定方法: ${ac.method}（${EVIDENCE_LABEL[ac.requires] || '未確認'}）`, '', card);
        if (ac.gap) add('p', `残り: ${ac.gap}`, 'kp-outcome-gap', card);
        if (!ac.evidence?.length) add('p', '判定の証拠は未記録です。', 'kp-muted', card);
        for (const proof of ac.evidence || []) {
          const label = `${EVIDENCE_LABEL[proof.kind] || '参考'} · ${proof.observed_on} JST`;
          add('p', proof.observation, '', card);
          if (typeof proof.ref === 'string' && EVIDENCE_URL.test(proof.ref)) {
            const a = add('a', label + 'の根拠を開く', 'kp-back kp-outcome-ref', card);
            a.href = proof.ref; a.target = '_blank'; a.rel = 'noopener noreferrer';
          }
        }
      }
      const ids = kind === 'project' ? contract.integration_work : contract.depends_on;
      const label = kind === 'project' ? '統合判定に使うWork' : '前提Work';
      if (!ids?.length) add('p', `${label}: ${Array.isArray(ids) ? 'なし' : '未確認'}`, 'kp-muted', group);
      else {
        const related = fold(label, group);
        const canRead = kind === 'project' && sourceState('tasks') === 'ok' ? work : null;
        for (const id of ids) {
          const member = canRead?.find(w => w.work_id === id && w.project_id === row.id);
          if (member) related.append(link(`${id} · ${member.title} · ${OUTCOME_LABEL[integration?.members?.[id]] || '未確認'}`,
            'work', member.id, 'kp-back'));
          else add('p', id, 'kp-muted', related);
        }
      }
      return contract;
    }
    function workLink(w, parent, showNumber = false) {
      const row = link('', 'work', w.id, 'kp-work-row kp-work-link');
      row.dataset.workItem = w.id;
      if (showNumber) {
        row.dataset.workCompact = 'true';
        const title = add('strong', w.work_id ? `${w.work_id} ${w.title}` : w.title, 'kp-work-title', row);
        title.title = title.textContent;
        const summary = add('div', '', 'kp-work-summary', row);
        renderWorkSummary(w, summary, workHistory ? Date.now() : now);
        parent.append(row);
        return row;
      }
      const top = el('div', '', 'kp-project-head');
      top.append(el('strong', w.title), el('span', w.state, 'kp-badge kp-' + String(w.state).toLowerCase()));
      if (w.priority) top.append(el('span', w.priority, 'kp-badge kp-priority'));
      const projectName = w.project_name || 'Project未確認';
      row.append(top, el('span', `${projectName} · ${w.work_id || 'ID未確認'}`, 'kp-muted'));
      const outcome = outcomeOf(w, 'work', 'work_items');
      row.append(el('span', outcome ? outcomeCounts(outcome) :
        w.state === 'DONE' ? 'Notion記録: DONE · 成果未確認' :
        detailOf(w)?.status === 'unavailable' || detailOf(w)?.outcome_status === 'invalid' || detailOf(w)?.outcome
          ? '成果条件: 未確認' : '成果条件: 未定義', 'kp-muted'));
      parent.append(row);
      return row;
    }
    let workHistory = null;
    function workAssessment(w, at) {
      const trusted = sourceState('work_items') === 'ok';
      const detail = trusted ? detailOf(w) : null;
      const outcome = outcomeOf(w, 'work', 'work_items');
      const history = trusted ? workHistory?.partials.get(w.work_id) : null;
      const pullRequest = trusted ? workHistory?.pullRequests?.get(w.id) : null;
      const decision = trusted && !isClosedWork(w) ? workHistory?.decisions.get(w.id) : null;
      const revision = stamp(w.source_revision);
      const owner = decision && decision.at <= at && at < decision.expires ? decision : null;
      return { owner, history, pullRequest, detail, outcome, revision,
        assessment: assessWork(w, { trusted, detail, outcome, history, pullRequest, at }) };
    }
    function renderWorkSummary(w, panel, at) {
      panel.replaceChildren();
      const { assessment, owner } = workAssessment(w, at);
      const stage = add('span', assessment.label, `kp-work-stage ${assessment.tone || 'registered'}`, panel);
      if (assessment.observed) {
        const day = assessment.observed.day.slice(5).replace('-', '/');
        add('span', day, 'kp-work-day', panel).title = `${assessment.observed.source} · ${assessment.observed.day} JST`;
      } else if (assessment.label !== '取得未確認') {
        add('span', '登録状態', 'kp-work-day', panel);
      }
      stage.title = assessment.reason;
      if (w.priority) add('span', w.priority, 'kp-work-rank', panel);
      if (owner) add('span', '要対応', 'kp-work-owner', panel);
    }
    function renderWorkProgress(w, panel, at = now) {
      panel.replaceChildren();
      const { assessment, owner, history, pullRequest, detail, outcome, revision } = workAssessment(w, at);
      const historyIsNew = history && Number.isFinite(revision) && stamp(history.completed_at) >= revision;
      const line = (label, value) => {
        const p = add('p', '', '', panel);
        p.append(el('b', label + '　'), el('span', value));
      };
      function evidenceLink(ref, label) {
        const url = typeof ref === 'string' && (EVIDENCE_URL.test(ref) || ref.startsWith('https://github.com/')
          && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/blob\/[a-f0-9]{40}\/[\w./-]+$/.test(ref));
        if (!url) return;
        const a = add('a', label, 'kp-back kp-outcome-ref', panel);
        a.href = ref; a.target = '_blank'; a.rel = 'noopener noreferrer';
      }
      line('進捗評価', assessment.label);
      if (assessment.observed) {
        line('評価根拠', `${assessment.observed.source} · ${assessment.observed.day} JST`);
        evidenceLink(assessment.observed.ref, '評価根拠を開く');
      }
      add('p', assessment.reason, 'kp-muted', panel);
      if (w.work_id && Number.isFinite(revision)) line('登録状態', `${WORK_STAGES[w.state] || w.state} · ${jst(revision)}`);
      if (outcome) line('完成条件', outcomeCounts(outcome));
      if (detail?.work_evidence?.schema_version === 'kaz-notion-work-evidence-v1') {
        if (detail.work_evidence.pull_requests_unconfirmed > 0)
          line('GitHubの状態未確認', `関連PR ${detail.work_evidence.pull_requests_unconfirmed}件`);
        for (const proof of detail.work_evidence.observations || [])
          if (Object.hasOwn(CHECKPOINTS, proof.kind) && /^\d{4}-\d{2}-\d{2}$/.test(proof.observed_on) && proof.observed_on <= evidenceDay(at))
            line('Notionの実績記録', `${CHECKPOINTS[proof.kind][0]} · ${proof.observed_on} JST`);
        for (const ref of detail.work_evidence.refs || []) evidenceLink(ref, 'Notion本文の関連リンクを開く');
        if (/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(w.id))
          evidenceLink(`https://app.notion.com/p/${w.id.replaceAll('-', '')}`, 'NotionのWork本文を開く');
      }
      if (history) {
        line(`部分成果（${jst(stamp(history.completed_at))}）`, history.summary);
        for (const ref of history.evidence_refs) evidenceLink(ref, '実行結果の証拠を開く');
      }
      if (pullRequest) evidenceLink(pullRequest.ref, '実行履歴に記録されたPRを開く');
      if (owner) add('p', '要レビュー', 'kp-work-owner', panel);
      if (owner) {
        line('本人への依頼', owner.question?.trim() || owner.owner_reason);
        if (owner.question?.trim() && owner.question.trim() !== owner.owner_reason.trim())
          line('本人の判断が必要な理由', owner.owner_reason);
        if (owner.remaining) line('依頼に関する残作業', owner.remaining);
        line('推奨案', owner.recommended_option);
        line('別案', owner.alternative_option);
        const today = link('TODAYの夜間実行記録を開く', 'today', null, 'kp-back');
        panel.append(today);
      }
      const canAdvance = ['READY', 'DOING', 'BACKLOG', 'SCHEDULED'].includes(w.state) && !w.blocker?.trim();
      const next = !owner && canAdvance && historyIsNew && !history.decision_required ? history.next_action : null;
      if (next) line('AIの次の行動（実行記録）', next);
      else if (history && !owner && !isClosedWork(w) && !history.decision_required)
        line('実行時に記録した次の候補', history.next_action);
    }
    function loadWorkHistory(update) {
      if (!options.readWorkHistory || sourceState('work_items') !== 'ok') return;
      const status = add('p', '実行履歴・本人依頼を確認中…', 'kp-muted');
      status.setAttribute('role', 'status');
      void options.readWorkHistory().then(history => {
        if (!options.current?.()) return;
        workHistory = history;
        status.textContent = [
          history.partialsUnavailable ? '一部の実行履歴を取得できません。' : '',
          history.decisionsUnavailable ? '一部の本人依頼の状態を確認できません。' : '',
        ].filter(Boolean).join(' ');
        status.hidden = !status.textContent;
        update();
        for (const expires of new Set([...history.decisions.values()].map(item => item.expires))) {
          const delay = expires - Date.now();
          if (delay > 0) {
            const timer = setTimeout(() => { if (options.current?.()) update(); }, delay + 1);
            timer?.unref?.();
          }
        }
      }).catch(() => {
        if (options.current?.()) status.textContent = '実行履歴・本人依頼を取得できません。';
      });
    }
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
      const v3 = data?.schema_version === 'kaz-os-dashboard-v3-component';
      if (!v3) add('p', 'WorkBusyとFamily Calendarの空き時間を別々に表示。枠に収まるWork候補を確認できます。', 'kp-subtitle', head);
      const workHealth = notice('work_items', head);
      if (data?.origin === 'notion_official_api' && data?.sources?.work_items) {
        const source = data.sources.work_items;
        const fetched = Number.isFinite(stamp(source.fetched_at)) ? new Date(source.fetched_at).toLocaleString('ja-JP', {timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) + ' JST' : '取得時刻未確認';
        add('p', `実データ · Notion / READ-ONLY · ${source.fetch_status} · ${fetched}`, 'kp-muted', head);
      }
      // Keep a previous-day projection out of today's plan. WorkBusy freshness
      // is advisory: the server already generated the windows from known BUSY.
      if (v3) {
        const dayJst = value => {
          const ms = typeof value === 'number' ? value : stamp(value);
          return Number.isFinite(ms) ? new Date(ms + 9 * 3600000).toISOString().slice(0, 10) : null;
        };
        const todayHealth = health(data.sources?.today, now);
        const calendarHealth = health(data.sources?.calendar, now);
        const busySource = data.sources?.work_busy;
        const reportedBusyHealth = busySource?.snapshot_status === 'current' ? 'ok'
          : ['stale', 'failed', 'not_connected'].includes(busySource?.snapshot_status)
            ? busySource.snapshot_status : 'not_connected';
        const busyDeadline = stamp(busySource?.snapshot_valid_until);
        const busyHealth = reportedBusyHealth === 'ok'
          && (!Number.isFinite(busyDeadline) || busyDeadline <= now)
          ? 'stale' : reportedBusyHealth;
        const snapshotDay = dayJst(data.v3_snapshot?.generated_at);
        const safeToday = (data.v3_snapshot?.status === 'CURRENT'
            || (data.v3_snapshot?.status === 'DEGRADED' && busyHealth !== 'ok'))
          && todayHealth === 'ok' && workHealth === 'ok'
          && calendarHealth === 'ok'
          && snapshotDay !== null && snapshotDay === dayJst(now) && !!data.today;
        if (safeToday && busyHealth !== 'ok') {
          const observedAt = stamp(busySource?.snapshot_updated_at);
          const observed = Number.isFinite(observedAt)
            ? new Date(observedAt).toLocaleString('ja-JP', {timeZone:'Asia/Tokyo',
                month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) + ' JST'
            : '時刻未確認';
          add('p', `WorkBusy ${busyHealth.toUpperCase()} · 会社のBUSYは最終取得 ${observed} 時点の情報です。空き時間は予定上の目安です。`, 'kp-notice', head);
        }
        if (!safeToday) {
          add('p', 'TODAY未確定 · 更新結果が揃っていないため、現在の空き時間・NOW・NEXT・時間付き配置は表示しません。', 'kp-notice', head);
          add('p', `保存Snapshot: ${Number.isFinite(stamp(data.v3_snapshot?.generated_at)) ? fmt(data.v3_snapshot.generated_at) + ' JST / ' + snapshotDay : '時刻未確認'} · TODAY ${todayHealth.toUpperCase()} · Work ${workHealth.toUpperCase()} · Calendar ${calendarHealth.toUpperCase()} · WorkBusy ${busyHealth.toUpperCase()}`, 'kp-muted', head);
          const saved = part('Work情報（最終保存値・現在とは限りません）');
          const catalog = data.last_known_work;
          const recordedAt = Number.isFinite(stamp(catalog?.generated_at))
            ? new Date(catalog.generated_at).toLocaleString('ja-JP', {timeZone: 'Asia/Tokyo', month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit'}) + ' JST'
            : '時刻未確認';
          add('p', `Work source更新 ${recordedAt} · 読み取り専用 · Work状態も変わっている可能性があります。`, 'kp-muted', saved);
          if (!Array.isArray(catalog?.items) || !catalog.items.length) {
            add('p', '表示できる最終保存Work情報はありません。', 'kp-muted', saved);
          } else {
            catalog.items.forEach(item => {
              const row = add('article', '', 'kp-work-row', saved);
              add('strong', String(item.title || 'タイトル未確認'), '', row);
              add('p', `${item.work_id || 'ID未確認'} · ${item.project_name || 'Project未確認'} · 保存時状態: ${item.state || '不明'}`, 'kp-muted', row);
            });
            if (Number.isInteger(catalog.total) && catalog.total > catalog.items.length) {
              add('p', `保存Work ${catalog.total}件のうち${catalog.items.length}件を表示。最新情報はWORKタブで確認してください。`, 'kp-muted', saved);
            }
          }
          const savedProjects = part('Projects情報（最終保存値・現在とは限りません）');
          const projectsCatalog = data.last_known_projects;
          const projectsAt = Number.isFinite(stamp(projectsCatalog?.generated_at))
            ? new Date(projectsCatalog.generated_at).toLocaleString('ja-JP', {timeZone: 'Asia/Tokyo', month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit'}) + ' JST'
            : '時刻未確認';
          add('p', `Projects source更新 ${projectsAt} · 読み取り専用 · Project状態も変わっている可能性があります。`, 'kp-muted', savedProjects);
          if (!Array.isArray(projectsCatalog?.items) || !projectsCatalog.items.length) {
            add('p', '表示できる最終保存Projects情報はありません。', 'kp-muted', savedProjects);
          } else {
            projectsCatalog.items.forEach(item => {
              const row = add('article', '', 'kp-work-row', savedProjects);
              add('strong', String(item.title || 'タイトル未確認'), '', row);
              add('p', `保存時状態: ${item.status || '不明'}`, 'kp-muted', row);
            });
            if (Number.isInteger(projectsCatalog.total) && projectsCatalog.total > projectsCatalog.items.length) {
              add('p', `保存Projects ${projectsCatalog.total}件のうち${projectsCatalog.items.length}件を表示。最新情報はPROJECTSタブで確認してください。`, 'kp-muted', savedProjects);
            }
          }
          return;
        }
      }
      if (workHealth !== 'ok' || !data?.today) return;

      const t = data.today, v2 = data.schema_version === 'kaz-today-plan-v2';
      const renderCandidate = (w, parent, label) => {
        const row = add('article', '', 'kp-work-row kp-today-row', parent);
        row.dataset.workItem = w.id;
        const top = add('div', '', 'kp-project-head', row);
        const title = String(w.title || '名称未設定のWork');
        top.append(el('strong', title));
        top.append(el('span', w.state, 'kp-badge kp-' + String(w.state || '').toLowerCase()));
        if (w.priority) top.append(el('span', w.priority, 'kp-badge kp-priority'));
        if (w.planning_preference) top.append(el('span', w.planning_preference, 'kp-badge kp-planning-preference'));
        if (Array.from(title).length > 72) {
          const titleDetail = fold('タイトル全文', row);
          add('p', title, 'kp-muted', titleDetail);
        }
        add('p', `${w.project_name} · ${w.work_id} · ${estimate(w.estimate_min)}`, 'kp-muted', row);
        if (w.plan_start && w.plan_end && (!v3 || label === 'SCHEDULED'))
          add('p', `${fmt(w.plan_start)}–${fmt(w.plan_end)} · ${w.placement || '配置候補'}`, 'kp-muted', row);
        else if (w.placement === 'ESTIMATE_REQUIRED') add('p', '所要時間未設定。INBOXで分数を答えると配置できます。', 'kp-notice', row);
        else if (w.placement === 'NO_AVAILABLE_SLOT') add('p', label === 'NEXT'
          ? '今日の時間配置とは独立した優先候補です。' : '今日は確定している空き時間に収まりません。', 'kp-notice', row);
        else if (w.waiting_reason) add('p', w.waiting_reason === 'BLOCKER_RECORDED'
          ? '妨げる要因が記録されています。着手前にWorkの内容を確認してください。'
          : `待ち理由: ${w.waiting_reason}`, 'kp-muted', row);
        if (label === 'NEXT' && w.next_policy_window?.availability_confirmed === false) {
          const window = w.next_policy_window;
          const date = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', weekday: 'short' }).format(new Date(window.start));
          add('p', `次の作業時間候補: ${date} ${fmt(window.start)}–${fmt(window.end)} JST（設定と既知の拘束から算出。予定・BUSYの確認前）`, 'kp-notice', row);
        }
        if (w.next_action) {
          const sentence = w.next_action.split(/[。\n]/, 1)[0];
          const excerpt = Array.from(sentence).slice(0, 72).join('');
          const action = fold(`${label} · ${excerpt}${excerpt.length < sentence.length || sentence.length < w.next_action.length ? '… 詳細' : ''}`, row);
          add('p', w.next_action, 'kp-next', action);
        }
        if (w.blocker) {
          const blocker = fold('Blockerを確認', row);
          add('p', w.blocker, 'kp-blocker', blocker);
        }
      };

      const focusCount=(t.now?.items?.length||0)+(t.next?.items?.length||0);
      const renderFreeWindows = (title, windows, emptyMessage, parent = host, includeSuggestions = true, compact = false) => {
        const section = part(title, parent);
        section.classList.add('kp-free-section');
        const visible = (windows || []).map(window => {
          if (!v3) return window;
          const startMs = Math.max(stamp(window.start), now);
          const endMs = stamp(window.end);
          if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) return null;
          const durationMin = Math.floor((endMs - startMs) / 60000);
          return {
            ...window,
            start: new Date(startMs).toISOString(),
            duration_min: durationMin,
            suggestions: includeSuggestions ? (window.suggestions || []).filter(w =>
              Number.isFinite(w.estimate_min) && w.estimate_min <= durationMin
            ) : [],
          };
        }).filter(Boolean);
        if (!visible.length) { add('p', emptyMessage, 'kp-muted', section); return; }
        if (compact) {
          visible.forEach(window => add('p', `${fmt(window.start)}–${fmt(window.end)} · ${window.duration_min}分`, 'kp-calendar-compact', section));
          return;
        }
        visible.forEach(window => {
          const slot = add('article', '', 'kp-free-window', section);
          add('h3', `${fmt(window.start)}–${fmt(window.end)}　${window.duration_min}分`, 'kp-free-time', slot);
          if (!window.suggestions?.length) add('p', 'この枠に収まるEstimate付きWorkはありません。', 'kp-muted', slot);
          (window.suggestions || []).forEach(w => {
            const candidate = add('div', '', 'kp-free-suggestion', slot);
            candidate.dataset.workItem = w.id || w.work_id || '';
            candidate.append(link(w.title, 'work', w.id || w.work_id, 'kp-free-work-title'));
            add('span', `${w.estimate_min}分 · ${w.priority || 'Priority未設定'} · ${w.action_type || 'ACTION'}`, 'kp-free-work-meta', candidate);
          });
        });
      };
      const companyState = t.work_time;
      const companyEmptyMessage = companyState?.company_day_kind === 'non_working_day'
        ? '会社の勤務時間は設定済みですが、今日は勤務対象曜日ではありません。'
        : companyState?.company_hours_configured === false || t.limitations?.includes('company_work_hours_unconfigured')
          || t.unassigned?.some(row => row.planning_reason === 'WORKING_HOURS_UNAVAILABLE')
          ? '会社の勤務時間が設定されていないため、会社の空き時間は表示していません。'
          : data.sources?.work_busy?.status !== 'ok'
            ? `${companyState?.company_hours_configured === true ? '会社の勤務時間は設定済みですが、' : ''}BUSY予定を確認できないため会社の空き枠は未確認です。`
            : companyState?.company_hours_configured === true
              ? '会社の勤務時間は設定済みです。今日の確認済み空き枠はありません。'
              : '今日の会社の確認済み空き枠はありません。';
      if (companyState?.company_hours_configured) {
        add('p', `会社勤務時間: 月〜金 ${companyState.company_hours.map(r => `${r.start}–${r.end}`).join('、')} · JST`, 'kp-muted');
        const window = companyState.next_company_window;
        if (window) {
          const day = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', weekday: 'short' }).format(new Date(window.start));
          add('p', `次の会社作業時間候補: ${day} ${fmt(window.start)}–${fmt(window.end)} JST（予定・BUSY確認前）`, 'kp-muted');
        }
      }
      const diagnostics = t.candidate_diagnostics;
      if (diagnostics) {
        add('p', `Work ${diagnostics.total_count}件 · 優先候補 ${diagnostics.eligible_count}件 · 今日配置 ${diagnostics.placed_count}件`, 'kp-muted');
        const detail = fold('候補の選定・除外理由');
        add('p', `完了・取消 ${diagnostics.terminal_count}件、状態待ち ${diagnostics.waiting_state_count}件、未着手対象外 ${diagnostics.not_actionable_state_count}件、意向による保留 ${diagnostics.deferred_preference_count}件、確定配置 ${diagnostics.adopted_schedule_count}件。`, 'kp-muted', detail);
        add('p', `候補のうち所要時間未設定 ${diagnostics.estimate_required_count}件、今日の空き枠なし ${diagnostics.no_slot_count}件、時間帯未確認 ${diagnostics.unassigned_count}件。依存関係はこのWork投影に含まれず、未解決の状態やBlocker記録を別途確認します。`, 'kp-muted', detail);
      }
      if (v3) {
        const overview = part('今日の予定・空き時間');
        overview.dataset.todayOverview = 'true';
        add('p', '既存Calendarと個人作業時間の設定を重ねた候補です。会社の作業時間とは分けて表示します。 · JST', 'kp-muted', overview);
        renderFreeWindows('🏢 会社の空き時間', t.company_free_windows,
          companyEmptyMessage, overview, false, true);
        const currentWindows = (t.kaz_free_windows || []).filter(window =>
          Number.isFinite(stamp(window.start)) && Number.isFinite(stamp(window.end))
          && stamp(window.end) > now && stamp(window.start) < stamp(window.end));
        renderFreeWindows('🏠 家庭・個人の作業候補時間', currentWindows.slice(0, 2),
          '設定済みの個人作業時間と予定が重なる空き枠はありません。', overview, false, true);
        if (currentWindows.length > 2) {
          const remainingWindows = fold(`ほかの空き時間 ${currentWindows.length - 2}件`, overview);
          renderFreeWindows('追加の家庭・個人の作業時間', currentWindows.slice(2),
            '追加の空き時間はありません。', remainingWindows, false, true);
        }
        if (t.unassigned?.length) {
          const unassigned = fold('時間帯を確認できないWork', overview);
          t.unassigned.slice(0, 20).forEach(item => {
            const reason = item.planning_reason === 'WORKING_HOURS_UNAVAILABLE'
              ? '会社の勤務時間が未設定です。'
              : item.planning_reason === 'COMPANY_BUSY_UNCONFIRMED'
                ? '会社のBUSY予定を確認できません。' : 'ProjectのAreaが未分類です。';
            add('p', `${item.title || item.work_id} · ${reason}`, 'kp-muted', unassigned);
          });
        }
        if (t.calendar_state?.unknown_count)
          add('p', `未分類/不明のCalendar予定 ${t.calendar_state.unknown_count}件は空き時間扱いしていません。`, 'kp-notice', overview);
        const confirmations = fold('確認待ち');
        if (!(t.confirmations || []).length) add('p', '確認待ちはありません。', 'kp-muted', confirmations);
        else (t.confirmations || []).forEach(item => {
          const row = add('article', '', 'kp-work-row', confirmations);
          add('strong', item.short_title || item.title || item.question || item.id || '確認事項', '', row);
          if (item.kind) add('p', item.kind, 'kp-muted', row);
          if (item.contract === 'gardener-phase-review-1' && typeof options.answerApi === 'function'
              && Array.isArray(item.answer_contract?.choices) && item.answer_contract.choices.length) {
            const actions = add('div', '', 'kp-confirm-actions', row);
            const status = add('p', '', 'kp-muted', row);
            item.answer_contract.choices.forEach(choice => {
              const button = add('button', choice.label || choice.value, 'kp-confirm-button', actions);
              button.type = 'button';
              button.addEventListener('click', async () => {
                actions.querySelectorAll('button').forEach(value => { value.disabled = true; });
                status.textContent = '保存中…';
                try {
                  const key = 'gardener-' + (globalThis.crypto?.randomUUID?.() || String(Date.now()));
                  const result = await options.answerApi({
                    decision_id: item.id,
                    question_revision: item.question_revision,
                    source_revision_references: item.source_revision_references,
                    selected_option: choice.value,
                    reason: null,
                    idempotency_key: key,
                  });
                  if (!result?.answer || result.answer.persistence_status !== 'DURABLE_PERSISTED') throw Error('KAZ_PERSISTENCE_FAILED');
                  status.textContent = '✓ 保存済み';
                  actions.hidden = true;
                } catch (error) {
                  status.textContent = '保存できませんでした。再取得して確認してください。';
                  actions.querySelectorAll('button').forEach(value => { value.disabled = false; });
                }
              });
            });
          }
        });
        add('p', `今日の3つ · ${focusCount}/3`, 'kp-muted');
      } else if (v2) {
        add('p', '確認済みの予定と、設定済みの作業可能時間を重ねて表示 · JST', 'kp-muted', head);
        renderFreeWindows('🏢 会社の空き時間', t.company_free_windows,
          companyEmptyMessage);
        renderFreeWindows('🏠 家庭・個人の作業候補時間', t.calendar_free_windows,
          t.calendar_state?.unknown?.some(value => value.reason === 'TIME_UNRESOLVED')
            ? '時刻不明の予定があるため空き枠を確定できません。'
            : '設定済みの作業可能時間と予定が重なる空き枠はありません。');
        if (t.unassigned?.length) {
          const unassigned = part('時間帯を確認できないWork');
          (t.unassigned || []).slice(0, 20).forEach(item => {
            const reason = item.planning_reason === 'WORKING_HOURS_UNAVAILABLE'
              ? '会社の勤務時間が未設定です。'
              : item.planning_reason === 'COMPANY_BUSY_UNCONFIRMED'
                ? '会社のBUSY予定を確認できません。'
              : 'ProjectのAreaが未分類です。';
            const row = document.createElement('p');
            row.textContent = `${item.title || item.work_id} · ${reason}`;
            unassigned.appendChild(row);
          });
        }
        add('p', `今日の3つ · ${focusCount}/3`, 'kp-muted');
      }

      if (!v3) {
        const nowSection = part('NOW');
        if (t.now?.kind === 'none') add('p', v2 ? 'いま着手する項目はありません。' : 'DOINGのWork Itemはありません。', 'kp-muted', nowSection);
        else (t.now?.items || []).forEach(w => renderCandidate(w, nowSection, 'NOW'));

        const nextSection = part('NEXT');
        add('p', '次に優先するWorkです。現在実行できるNOWや、確定した実行予定とは別です。', 'kp-muted', nextSection);
        if (t.next?.kind === 'none') add('p', '次候補はありません。', 'kp-muted', nextSection);
        else (t.next?.items || []).forEach(w => renderCandidate(w, nextSection, 'NEXT'));
      }

      if (v2 || v3) {
        const scheduled = v3 ? fold('Work配置案 · Calendarの確定予定とは別') : part('SCHEDULED');
        if (v3) add('p', 'Workの優先順から作られた配置候補です。Calendar上の実行予定としては扱いません。', 'kp-muted', scheduled);
        if (!(t.scheduled || []).length) add('p', '今日の時間付き配置はありません。', 'kp-muted', scheduled);
        else (t.scheduled || []).forEach(w => renderCandidate(w, scheduled, 'SCHEDULED'));

        const waiting = v3 ? fold('WAITING · 状態待ち') : part('WAITING');
        add('p', `${t.waiting_count}件 · Human/state/Estimate待ち`, 'kp-muted', waiting);
        if (!(t.waiting || []).length) add('p', '待ち項目はありません。', 'kp-muted', waiting);
        else (t.waiting || []).forEach(w => renderCandidate(w, waiting, 'WAITING'));

        if (v2) {
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
          const meta = fold('Kaz OS v3の判定範囲');
          add('p', 'WorkBusyのBUSYとFamily Calendarの（父）timed予定だけを拘束として統合。all-day、他家族タグ、無タグ予定はワイの空き時間を潰しません。', 'kp-muted', meta);
        }
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
      const workHealth = notice('work_items', head);
      if (selection.id && data?.origin === 'notion_official_api' && data?.sources?.work_items) {
        const source = data.sources.work_items;
        const fetched = Number.isFinite(stamp(source.fetched_at)) ? new Date(source.fetched_at).toLocaleString('ja-JP', {timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) + ' JST' : '取得時刻未確認';
        add('p', `実データ · Notion / READ-ONLY · ${source.fetch_status} · ${fetched}`, 'kp-muted', head);
        head.dataset.snapshotRef = source.snapshot_ref || '';
      }
      if (!['ok', 'partial'].includes(workHealth)) return;
      if (!work) { add('p', 'Work Items一覧を確認できません。重複・欠落を解消してください。', 'kp-notice'); return; }
      if (selection.id) {
        head.prepend(link('← WORK', 'work', null, 'kp-back'));
        const w = wi(selection.id);
        if (!w) { add('p', 'この取得範囲にWorkが見つかりません。'); return; }
        add('h3', w.work_id ? `${w.work_id} ${w.title}` : w.title, 'kp-project-title');
        add('p', `${w.state} · ${w.priority || 'Priority未設定'} · ${w.work_id || 'ID未確認'}`, 'kp-muted');
        const panel = add('div', '', 'kp-work-progress');
        renderWorkProgress(w, panel);
        loadWorkHistory(() => renderWorkProgress(w, panel, Date.now()));
        const outcome = showOutcome(w, 'work', 'work_items');
        add('p', `作業の目的: ${detailText(w, 'purpose')}`);
        for (const [key, label] of [['description', '説明'], ['notes', 'メモ'], ['progress', 'Notionの進捗メモ']])
          if (detailOf(w)?.status === 'current' && detailOf(w)[key]) add('p', `${label}: ${detailOf(w)[key]}`);
        if (!outcome && w.state === 'DONE') add('p', 'NotionでDONEと記録済み。成果の証拠は別途確認が必要です。', 'kp-muted');
        add('p', `実施済み: ${detailText(w, 'completed')}`);
        add('p', `残作業: ${detailText(w, 'remaining')}`);
        add('p', `次の行動: ${w.next_action || '未記録'}`);
        add('p', `ブロッカー: ${w.blocker || '未記録'}`);
        const updated = Number.isFinite(stamp(w.source_revision))
          ? new Date(w.source_revision).toLocaleString('ja-JP', {timeZone:'Asia/Tokyo',year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) + ' JST'
          : '未確認';
        add('p', `更新日時: ${updated}`, 'kp-muted');
        if (w.project_id && project(w.project_id)) host.append(link(`所属Project: ${w.project_name}`, 'projects', w.project_id, 'kp-back'));
        else add('p', `所属Project: ${w.project_name || '未確認'}`, 'kp-muted');
        if (w.work_id === 'WI-53' && data.wi53_progress?.schema_version === 'wi53-progress-summary-v1') {
          const summary = data.wi53_progress, totals = summary.totals, statuses = summary.statuses;
          const ledger = part('WI-53 台帳');
          add('p', `全${totals.all_registry_entries}項目 · Secret関連${totals.credential_and_legacy_entries}項目`, '', ledger);
          add('p', `移行済み ${statuses.migrated} · 作業中 ${statuses.in_progress} · 未移行 ${statuses.not_migrated} · 人間判断待ち ${statuses.human_decision} · 保留 ${statuses.deferred}`, '', ledger);
          add('p', `兄弟の判断待ち: ${summary.human_decisions}件 · 台帳時点 ${summary.as_of}`, 'kp-muted', ledger);
          add('p', '台帳上の進捗です。Secret値や認証情報は表示しません。', 'kp-muted', ledger);
        }
        return;
      }
      if (!work.length) { add('p', 'この取得範囲のWork Itemは0件です。'); return; }
      head.classList.add('kp-work-list-head');
      const controls = add('div', '', 'kp-work-sort', head);
      function sortSelect(label, choices, value) {
        const field = add('label', label, '', controls);
        const input = add('select', '', '', field);
        for (const [key, name] of choices) add('option', name, '', input).value = key;
        input.value = value;
        return input;
      }
      const sortKey = sortSelect('並び替え', [['priority', '重要度'], ['number', 'WI番号']], 'priority');
      const direction = sortSelect('順序', [['desc', '高い順'], ['asc', '低い順']], 'desc');
      const orderNote = add('p', '', 'kp-work-list-note kp-muted', head);
      orderNote.setAttribute('role', 'status');
      const active = [], terminal = [];
      for (const w of inRecordedOrder(work, progressUi?.work_order)) {
        if (WORK_STATES.includes(w.state))
          (isClosedWork(w) ? terminal : active).push(w);
      }
      const rows = add('div', '', 'kp-work-list');
      const closedRows = terminal.length ? add('div', '', 'kp-work-list',
        fold(`終了した項目 ${terminal.length}件`)) : null;
      function refreshOrder() {
        const byPriority = sortKey.value === 'priority';
        const descending = direction.value === 'desc';
        direction.options[0].textContent = byPriority ? '高い順' : '降順（大きい順）';
        direction.options[1].textContent = byPriority ? '低い順' : '昇順（小さい順）';
        orderNote.textContent = `${work.length}件 · ${byPriority ? '重要度' : 'WI番号'}：${direction.options[descending ? 0 : 1].textContent}`;
        const compare = (a, b) => {
          if (!byPriority) return compareWorkNumbers(a, b, direction.value);
          const rank = priorityRank(a.priority) - priorityRank(b.priority);
          return (descending ? rank : -rank) || compareWorkNumbers(a, b, 'asc');
        };
        for (const [container, items] of [[rows, active], [closedRows, terminal]]) {
          if (!container) continue;
          container.replaceChildren();
          [...items].sort(compare).forEach(w => workLink(w, container, true));
        }
      }
      sortKey.addEventListener('change', refreshOrder);
      direction.addEventListener('change', refreshOrder);
      refreshOrder();
      loadWorkHistory(() => {
        const byId = new Map(work.map(w => [w.id, w]));
        for (const row of host.querySelectorAll('a[data-work-item]')) {
          const panel = row.querySelector('.kp-work-summary');
          if (panel && byId.has(row.dataset.workItem))
            renderWorkSummary(byId.get(row.dataset.workItem), panel, Date.now());
        }
      });
      return;
    }

    if (selection.page === 'capa') {
      const head = part('CAPA');
      add('p', '不適合・是正・予防・効果確認を眺める', 'kp-subtitle', head);
      const capaHealth = notice('capa', head);
      if (data?.origin === 'notion_official_api' && data?.sources?.capa) {
        const source = data.sources.capa;
        const fetched = Number.isFinite(stamp(source.fetched_at)) ? new Date(source.fetched_at).toLocaleString('ja-JP', {timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) + ' JST' : '取得時刻未確認';
        add('p', `実データ · Notion / READ-ONLY · ${source.fetch_status} · ${fetched}`, 'kp-muted', head);
        head.dataset.snapshotRef = source.snapshot_ref || '';
      }
      if (!['ok', 'partial'].includes(capaHealth)) return;
      if (!capa) { add('p', 'CAPA一覧を確認できません。重複・欠落を解消してください。', 'kp-notice'); return; }
      const activeItems = capa.filter(item => item.status !== 'Effective');
      const effectiveItems = capa.filter(item => item.status === 'Effective');
      add('p', `${capa.length} CAPA · Open ${activeItems.length} · Effective ${effectiveItems.length}`, 'kp-muted', head);
      if (!capa.length) { add('p', 'この取得範囲のCAPAは0件です。'); return; }
      const rows = add('div', '', 'kp-work-list');
      const renderCapa = (item, parent) => {
        const row = add('article', '', 'kp-work-row', parent); row.dataset.capaItem = item.id;
        const top = add('div', '', 'kp-project-head', row);
        top.append(el('strong', item.title));
        top.append(el('span', item.status, 'kp-badge kp-' + String(item.status || '').toLowerCase().replaceAll(' ', '-')));
        add('p', `${item.project} · ${item.created} · Effectiveness: ${item.effectiveness}`, 'kp-muted', row);
        if (Array.isArray(item.failure_classes) && item.failure_classes.length)
          add('p', item.failure_classes.join(' / '), 'kp-muted', row);
        if (item.trigger) add('p', `TRIGGER ${item.trigger}`, 'kp-blocker', row);
        if (item.corrective_action) add('p', `CA ${item.corrective_action}`, 'kp-next', row);
        if (item.preventive_action) add('p', `PA ${item.preventive_action}`, 'kp-muted', row);
        const detail = fold('Context / Source', row);
        add('p', item.context_path || 'Context path未確認', 'kp-muted', detail);
        if (item.source_url) {
          const a = el('a', 'Sourceを開く', 'kp-back'); a.href = item.source_url; a.target = '_blank'; a.rel = 'noopener noreferrer';
          detail.append(a);
        }
      };
      activeItems.forEach(item => renderCapa(item, rows));
      if (effectiveItems.length) {
        const closed = fold(`Effective ${effectiveItems.length}件`);
        effectiveItems.forEach(item => renderCapa(item, closed));
      }
      add('p', '閲覧のみ。CAPAの正本・AI実行規則はContext Hub、進捗と効果確認はNotion CAPAで管理します。', 'kp-muted');
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
        const outcome = showOutcome(p, 'project', 'projects');
        add('p', `目的: ${detailText(p, 'purpose')}`);
        for (const [key, label] of [['description', '説明'], ['notes', 'メモ'], ['progress', '進捗記録']])
          if (detailOf(p)?.status === 'current' && detailOf(p)[key]) add('p', `${label}: ${detailOf(p)[key]}`);
        add('p', `現在の焦点: ${p.current_focus || '未記録'}`);
        if (!outcome) progressRow(p, host, current);
        const projectProgress = progressUi?.projects?.[p.id];
        const completed = projectProgress?.completed_work_ids?.map(id => wi(id)?.title).filter(Boolean);
        add('p', `完了事項: ${detailText(p, 'completed')}`);
        add('p', `NotionでDONEのWork: ${completed ? completed.length ? completed.join(' / ') : '該当Workなし' : '取得範囲では未確認'}`);
        add('p', `残件: ${Number.isInteger(projectProgress?.remaining_work_count) ? `${projectProgress.remaining_work_count} Work` : '未確認'}`);
        if (projectProgress?.state_counts) add('p', `Work状態: ${Object.entries(projectProgress.state_counts).map(([name, count]) => `${name} ${count}`).join(' · ')}`, 'kp-muted');
        add('p', `残作業の記録: ${detailText(p, 'remaining')}`);
        add('p', `次の行動: ${p.next_action || '未記録'}`);
        add('p', `ブロッカー: ${p.blocker || '未記録'}`);
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
        const members = inRecordedOrder(work.filter(w => w.project_id === p.id), projectProgress?.work_ids);
        add('p', `${members.length}件 · 取得範囲内`, 'kp-muted', items);
        const terminal = members.filter(w => ['DONE', 'CANCELLED'].includes(w.state));
        const activeRows = add('div', '', 'kp-work-list', items);
        members.filter(w => !terminal.includes(w)).forEach(w => workLink(w, activeRows));
        if (terminal.length) { const closed = fold(`終了した項目 ${terminal.length}件`, items); terminal.forEach(w => workLink(w, closed)); }
        return;
      }
      const summary = projectSummary(data, now);
      if (summary) {
        const kpis = add('div', '', 'kp-kpis', head);
        Object.entries(summary).forEach(([key, count]) => { const n = add('div', '', '', kpis); n.dataset.projectKpi = key; add('strong', String(count), '', n); add('span', key === 'MOVED' ? 'moved this week' : key, '', n); });
      }
      add('p', `${projects.length} Projects · ${progressUi ? '残Workの優先度順' : '取得順'} · ${current ? data.sources.projects.scope : '部分取得'}`, 'kp-muted', head);
      if (!projects.length) { add('p', 'この取得範囲のProjectは0件です。'); return; }
      const rows = add('div', '', 'kp-projects');
      inRecordedOrder(projects, progressUi?.project_order).forEach(p => {
        const row = link('', 'projects', p.id, 'kp-project-row'); row.dataset.projectId = p.id;
        const title = el('div', '', 'kp-project-head'); title.append(el('strong', p.title), badge(state(p.status))); title.title = p.title; row.append(title);
        const footer = add('div', '', 'kp-project-footer', row);
        const outcome = outcomeOf(p, 'project', 'projects');
        if (outcome) add('span', outcomeCounts(outcome), 'kp-muted', footer);
        else progressRow(p, footer, current, true);
        const priority = progressUi?.projects?.[p.id]?.priority;
        if (priority) add('span', priority, 'kp-badge kp-priority', footer);
        const remaining = progressUi?.projects?.[p.id]?.remaining_work_count;
        add('span', `残Work ${Number.isInteger(remaining) ? `${remaining}件` : '未確認'}`, 'kp-muted', footer);
        rows.append(row);
      });
      return;
    }
    if (selection.page === 'context') {
      const head = part('CONTEXT');
      add('p', 'Context Hubの育ち方を眺める。表示専用。', 'kp-subtitle', head);
      const source = data?.source || data?.sources?.context_observatory || null;
      if (!data || data.schema_version !== 'kaz-context-observatory-v1' || data.mode !== 'read_only'
          || !data.totals || !source || source.status !== 'ok' || source.complete !== true) {
        add('p', 'Context Observatoryを取得できません。0件ではありません。', 'kp-notice', head);
        return;
      }
      const totals = data.totals;
      const kpis = add('div', '', 'kp-kpis kc-kpis', head);
      [
        ['RAW', totals.raw],
        ['SAVED', totals.saved_context],
        ['HOLD', totals.raw_hold],
        ['DECISION', totals.decision_candidate],
        ['PAIN', totals.pain_point],
        ['LESSON', totals.lesson],
      ].forEach(([label, count]) => {
        const box = add('div', '', '', kpis);
        add('strong', String(count ?? 0), '', box);
        add('span', label, '', box);
      });
      const generated = Number.isFinite(stamp(data.generated_at))
        ? new Date(data.generated_at).toLocaleString('ja-JP', {timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) + ' JST'
        : '生成時刻未確認';
      add('p', `実データ · GitHub / READ-ONLY · ${generated}`, 'kp-muted', head);

      const pipeline = data.pipeline || {};
      const sources = pipeline.sources || {};
      const dispositions = pipeline.dispositions || {};
      const profileCounts = data.semantic_profile?.counts || {};

      const flow = part('Context Flow');
      add('p', '入力 → 分類 → Saved / Aggregate → Profile。押すと内訳を表示。', 'kp-muted', flow);
      const flowGrid = add('div', '', 'kc-flow-grid', flow);
      const detail = add('div', '', 'kc-flow-detail', flow);
      const detailTitle = add('strong', 'Context pipeline', '', detail);
      const detailText = add('p', '各カードを押すと、現在の件数と役割を確認できます。', 'kp-muted', detail);
      const showDetail = (titleText, bodyText) => {
        detailTitle.textContent = titleText;
        detailText.textContent = bodyText;
      };
      [
        ['ChatGPT', sources.chatgpt?.saved_context ?? totals.saved_context ?? 0, '会話から意味単位をSaved Contextへ自動保存。'],
        ['Gmail', sources.gmail?.federated ?? 0, '日次取得。重要メール粒度でSAVE / AGGREGATE / IGNOREへ分類。'],
        ['LINE', sources.line?.federated ?? 0, '月次export。行動・生活Contextを日単位AGGREGATEへ。'],
        ['Calendar', sources.calendar?.federated ?? 0, '日次取得。予定をSAVE / AGGREGATE / IGNOREへ分類。'],
      ].forEach(([label, count, bodyText]) => {
        const button = add('button', '', 'kc-flow-node', flowGrid);
        button.type = 'button';
        add('span', label, '', button);
        add('strong', String(count), '', button);
        button.addEventListener('click', () => showDetail(label, `${bodyText} 現在 ${count}件。`));
      });

      const arrow = add('div', '↓', 'kc-flow-arrow', flow);
      arrow.setAttribute('aria-hidden', 'true');

      const classGrid = add('div', '', 'kc-flow-grid kc-flow-grid-classify', flow);
      const dispositionSources = pipeline.disposition_sources || {};
      const sourceLabel = source => ({gmail:'Gmail',line_export:'LINE',google_calendar:'Calendar',chatgpt:'ChatGPT'}[source] || source);
      [
        ['SAVE', 'save', dispositions.save ?? 0, 'Saved Contextへ昇格する外部signal。'],
        ['AGGREGATE', 'aggregate', dispositions.aggregate ?? 0, '傾向・パターン分析の材料として保持。'],
        ['IGNORE', 'ignore', dispositions.ignore ?? 0, '低価値ノイズとして上位Contextへは送らない。'],
      ].forEach(([label, key, count, bodyText]) => {
        const button = add('button', '', 'kc-flow-node kc-flow-node-compact', classGrid);
        button.type = 'button';
        add('span', label, '', button);
        add('strong', String(count), '', button);
        button.addEventListener('click', () => {
          const sourceCounts = dispositionSources[key] || {};
          const breakdown = Object.entries(sourceCounts)
            .filter(([, value]) => Number(value) > 0)
            .sort((a,b) => Number(b[1]) - Number(a[1]))
            .map(([source, value]) => `${sourceLabel(source)} ${value}件`)
            .join(' / ') || 'source内訳なし';
          showDetail(label, `${bodyText} 現在 ${count}件。内訳: ${breakdown}`);
          const matching = (pipeline.recent || []).filter(item => String(item.disposition || '').toUpperCase() === label);
          if (matching.length) {
            const list = matching.slice(0, 8).map(item => `${sourceLabel(item.source)}: ${item.summary || 'summaryなし'}`).join('｜');
            detailText.textContent += ` 直近: ${list}`;
          }
        });
      });

      const profile = part('Semantic Profile');
      add('p', 'Phase 2で育てる4カテゴリ。バブルを押すと件数を確認。', 'kp-muted', profile);
      const bubbles = add('div', '', 'kc-profile-bubbles', profile);
      [
        ['Career / Market', profileCounts.career_market ?? 0],
        ['Services', profileCounts.services_spending ?? 0],
        ['Family / Behavior', profileCounts.family_behavior ?? 0],
        ['Active Topics', profileCounts.active_topics ?? 0],
      ].forEach(([label, count]) => {
        const button = add('button', '', 'kc-profile-bubble', bubbles);
        button.type = 'button';
        add('strong', String(count), '', button);
        add('span', label, '', button);
        button.addEventListener('click', () => {
          if (label === 'Services' && data.services_profile?.available) {
            const services = (data.services_profile.active_services || [])
              .map(item => `${item.service} ${item.count}件`).join(' / ') || 'service未確認';
            const weekly = data.services_profile.weekly_trend?.status || 'insufficient';
            showDetail(label, `観測 ${data.services_profile.observation_count ?? count}件。利用: ${services}。週次Trend: ${weekly}。支出総額はまだ計算していません。`);
            return;
          }
          if (label === 'Family / Behavior' && data.family_behavior_profile?.available) {
            const family = data.family_behavior_profile;
            const trend = family.weekly_behavior?.status || 'insufficient';
            const sports = family.sports_signal_count || 0;
            const sportsDays = family.sports_observation_days || 0;
            const attendance = family.school_attendance_signal_count || 0;
            const attendanceDays = family.school_attendance_observation_days || 0;
            showDetail(label, `観測 ${family.observation_days}件。LINE/学校実行動 ${family.message_count} observations / 行動signal ${family.behavior_signal_count} / 生活Context ${family.context_signal_count} / sports-team ${sports}（${sportsDays}日） / 学童入退室 ${attendance}（${attendanceDays}日）。週次Trend: ${trend}。Plan vs Actualは次段階。`);
            return;
          }
          if (label === 'Active Topics' && data.active_topics_profile?.available) {
            const active = data.active_topics_profile;
            const themes = (active.theme_counts || []).map(item => `${item.theme} ${item.count}件`).join(' / ') || 'theme未確認';
            const trend = active.weekly_trend?.status || 'insufficient';
            showDetail(label, `観測 ${active.observation_count}件。テーマ: ${themes}。週次Trend: ${trend}。`);
            return;
          }
          showDetail(label, `Semantic Profileの観測数は ${count}件。Phase 2で時系列・傾向・フィードバックを追加予定。`);
        });
      });

      const advisory = part('Advisory');
      const adv = data.advisory || {};
      if (!adv.available) {
        add('p', 'Advisory projectionはまだありません。', 'kp-muted', advisory);
      } else {
        const summary = add('div', '', 'kp-kpis kc-kpis', advisory);
        [
          ['候補', adv.candidate_count ?? 0],
          ['観測継続', adv.observe_only_count ?? 0],
        ].forEach(([label, count]) => {
          const box = add('div', '', '', summary);
          add('strong', String(count), '', box);
          add('span', label, '', box);
        });
        add('p', 'READ-ONLY · Derived Context · 自動反映なし', 'kp-muted', advisory);
        (adv.items || []).forEach(item => {
          const row = add('button', '', 'kc-feedback-row', advisory);
          row.type = 'button';
          const top = add('div', '', 'kp-project-head', row);
          top.append(el('strong', item.title || item.kind || 'Advisory'));
          top.append(el('span', item.status || 'observe_only', 'kp-badge kp-unknown'));
          add('p', item.summary || '', 'kp-muted', row);
          row.addEventListener('click', () => showDetail(
            item.title || item.kind || 'Advisory',
            `${item.summary || ''} / proposed use: ${item.proposed_use || '未設定'} / confidence: ${item.confidence || 'unknown'}`
          ));
        });
      }

      const feedback = part('Feedback');
      const fb = data.feedback || {};
      if (!fb.available) {
        add('p', 'Outcome Feedbackはまだありません。', 'kp-muted', feedback);
      } else {
        const summary = add('div', '', 'kp-kpis kc-kpis', feedback);
        [
          ['Events', fb.event_count ?? 0],
          ['Success', fb.assessment_counts?.success ?? 0],
          ['Failure', fb.assessment_counts?.failure ?? 0],
        ].forEach(([label, count]) => {
          const box = add('div', '', '', summary);
          add('strong', String(count), '', box);
          add('span', label, '', box);
        });
        add('p', 'REAL OUTCOME · READ-ONLY · Human Review', 'kp-muted', feedback);
        (fb.items || []).forEach(item => {
          const row = add('button', '', 'kc-feedback-row', feedback);
          row.type = 'button';
          const top = add('div', '', 'kp-project-head', row);
          top.append(el('strong', item.feedback_type || 'Feedback'));
          top.append(el('span', item.assessment || 'unknown', 'kp-badge kp-unknown'));
          add('p', item.outcome || '', 'kp-muted', row);
          row.addEventListener('click', () => showDetail(
            item.feedback_type || 'Feedback',
            `action: ${item.action || ''} / outcome: ${item.outcome || ''} / proposed: ${item.proposed_action || '未設定'}`
          ));
        });
      }

      const recentSignals = part('最近のExternal signal');
      if (!(pipeline.recent || []).length) add('p', 'External signalはまだありません。', 'kp-muted', recentSignals);
      else (pipeline.recent || []).slice(0, 8).forEach(item => {
        const row = add('article', '', 'kp-work-row kc-context-row', recentSignals);
        const top = add('div', '', 'kp-project-head', row);
        top.append(el('strong', item.summary || item.source || 'External signal'));
        top.append(el('span', item.disposition || 'UNKNOWN', 'kp-badge kp-unknown'));
        const when = Number.isFinite(stamp(item.observed_at))
          ? new Date(item.observed_at).toLocaleString('ja-JP', {timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})
          : String(item.observed_at || '時刻未確認');
        add('p', `${item.source || 'other'} · ${when}`, 'kp-muted', row);
      });

      const topics = part('Topic');
      if (!(data.by_topic || []).length) add('p', 'Topic集計はまだありません。', 'kp-muted', topics);
      else {
        const rows = add('div', '', 'kc-topic-list', topics);
        (data.by_topic || []).forEach(item => {
          const row = add('div', '', 'kc-topic-row', rows);
          add('span', item.topic || 'other', '', row);
          add('strong', String(item.count ?? 0), '', row);
        });
      }

      const attention = part('要確認');
      const hold = data.attention?.raw_hold_count ?? totals.raw_hold ?? 0;
      const high = data.attention?.high_importance_recent_count ?? 0;
      add('p', hold ? `RAW HOLD ${hold}件` : 'RAW HOLDなし', hold ? 'kp-notice' : 'kp-muted', attention);
      if (high) add('p', `最近のHigh importance ${high}件`, 'kp-muted', attention);

      const recent = part('最近のContext');
      if (!(data.recent || []).length) add('p', '最近のContextはありません。', 'kp-muted', recent);
      else (data.recent || []).forEach(item => {
        const row = add('article', '', 'kp-work-row kc-context-row', recent);
        const top = add('div', '', 'kp-project-head', row);
        top.append(el('strong', item.text || 'Context'));
        top.append(el('span', item.route || 'UNKNOWN', 'kp-badge kp-unknown'));
        const when = Number.isFinite(stamp(item.captured_at))
          ? new Date(item.captured_at).toLocaleString('ja-JP', {timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})
          : '時刻未確認';
        add('p', `${when} · ${(item.topics || []).join(' / ') || 'other'}`, 'kp-muted', row);
      });
      add('p', 'Saved Contextは明示保存した即時参照Context。Raw/Intermediateは自動整理用。Gardenerが重複・統合・成熟を進め、Canonical/Core変更だけHuman Reviewを通します。', 'kp-muted');
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

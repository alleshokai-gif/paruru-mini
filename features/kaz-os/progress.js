/* PALURU Kaz OS summary view: no mutation API, local storage or raw evidence. */
(() => {
  'use strict';
  let api = null, context = null, epoch = 0, pending = null, expiry = null;
  const byId = id => document.getElementById(id);
  const allowed = () => context?.role === 'admin' && context.allowedViews?.includes('kaz-os');
  const node = (tag, text, className) => { const e = document.createElement(tag); e.textContent = text; if (className) e.className = className; return e; };
  const clear = () => { epoch += 1; pending = null; clearTimeout(expiry); byId('kazOsContent')?.replaceChildren(); byId('kazOsDiagnosticsStatus').textContent = 'Progressを確認'; };
  const time = value => value ? new Date(value).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '不明';
  const tests = value => value ? `Tests ${value.passed}/${value.total}` : 'Tests 不明';
  function section(title) { const e = node('section', '', 'kaz-section'); e.append(node('h2', title)); byId('kazOsContent').append(e); return e; }
  function pill(label) {
    const tone = ['LIVE','GO','DONE','ACCEPTED','OK'].includes(label) ? 'good'
      : ['BUILDING','PoC','DRAFT','STALE','PARTIAL','RUNNING'].includes(label) ? 'warm'
      : label === 'READ-ONLY' ? 'read' : ['BLOCKED','FAILED','REJECTED'].includes(label) ? 'stop' : 'quiet';
    return node('span', label, `kaz-status kaz-${tone}`);
  }
  const uniqueCount = (values, key) => Array.isArray(values) ? new Set(values.map(v => v[key])).size : null;
  const planLabel = label => ({
    'Kaz OS lifecycle / Progress integration': 'Lifecycle / Progress連携',
    'Notion connection': 'Notion接続', 'Obsidian connection': 'Obsidian接続'
  })[label] || label;
  function disclosure(title, className = 'kaz-detail') {
    const e = node('details', '', className); e.append(node('summary', title)); return e;
  }
  function reveal(target) {
    if (!target) return;
    for (let e = target; e; e = e.parentElement) if (e.tagName === 'DETAILS') e.open = true;
    target.scrollIntoView({ block: 'start' });
    target.querySelector('summary')?.focus({ preventScroll: true });
  }
  function evidenceButton(label, target) {
    const b = node('button', label, 'secondary-button'); b.type = 'button'; b.addEventListener('click', () => reveal(target)); return b;
  }
  function showError(code) {
    clear();
    const notConnected = code === 'KAZ_NOT_CONNECTED', stale = code === 'KAZ_STALE';
    byId('kazOsDiagnosticsStatus').textContent = notConnected ? 'NOT CONNECTED' : stale ? 'STALE / 再確認が必要' : '取得できませんでした';
    const host = section(notConnected ? 'NOT CONNECTED' : stale ? 'STALE / 再確認が必要' : '取得できませんでした');
    host.append(node('p', notConnected ? 'Kaz OSの読取先は未接続です。' : '0件ではありません。古い結果は表示していません。'));
  }
  function render(data) {
    clearTimeout(expiry);
    byId('kazOsContent').replaceChildren();
    const current = data.source.status === 'ok' && data.source.complete;
    const achievements = current ? data.achievements : null;
    const latest = achievements?.[0];
    byId('kazOsDiagnosticsStatus').textContent = current
      ? latest?.label || data.overview?.stage || 'Overviewを確認'
      : `Source ${data.source.status.toUpperCase()}`;
    const status = section('Progress'); status.classList.add('kaz-overview');
    status.append(pill(data.overview?.stage || 'STAGE UNDEFINED'));
    const reviewItems = current && Array.isArray(data.waiting_for_review) ? data.waiting_for_review : null;
    const kpis = node('div', '', 'kaz-kpis');
    if (current) [
      ['DONE', uniqueCount(data.recent_wins, 'work_item_id')],
      ['NEEDS REVIEW', uniqueCount(reviewItems, 'work_item_id')],
      ['RECENT RUNS', uniqueCount(data.recent_runs, 'run_id')]
    ].forEach(([label, value]) => {
      if (value === null) return;
      const kpi = node('div', '', 'kaz-kpi'); kpi.dataset.kpi = label;
      kpi.append(node('strong', String(value)), node('span', label)); kpis.append(kpi);
    });
    if (kpis.childElementCount) status.append(kpis, node('p', '取得範囲内 · DONE / Runsは直近最大5件', 'kaz-kpi-scope'));
    else status.append(node('p', 'KPIを取得できていません。0件とは扱いません。', 'kaz-kpi-scope'));
    const arrival = node('div', '', 'kaz-progress-arrival');
    arrival.append(node('small', 'LATEST ACHIEVEMENT'), node('p', latest?.label || (current && Array.isArray(achievements) ? '確認できた成果はまだありません。' : '現在の到達点は再確認が必要です。'), 'kaz-arrival'));
    status.append(arrival, node('p', data.overview?.scope || data.scope_label, 'kaz-muted'));
    if (!current) status.append(node('p', `一部情報を取得できていない、または古い状態です：${data.source.status.toUpperCase()}`, 'kaz-warning'));
    const active = section('Active Work'); active.classList.add('kaz-active');
    const draftPlan = data.roadmap?.status === 'draft' && data.roadmap.source === 'user' ? data.roadmap : null;
    const laneItems = phase => draftPlan?.lanes.find(l => l.phase === phase)?.items || [];
    const running = current ? (data.recent_runs || []).filter(r => r.execution_status === 'running') : [];
    function activeRow(phase, title, caption, draft) {
      const row = node('div', '', 'kaz-active-row'); row.dataset.phase = phase;
      const label = node('div', '', 'kaz-active-label'); label.append(node('strong', phase));
      if (draft) label.append(pill('DRAFT'));
      const body = node('div'); body.append(node('p', title, 'kaz-active-title'), node('small', caption, 'kaz-muted'));
      row.append(label, body); active.append(row);
    }
    activeRow('NOW', running.length ? running[0].work_item : laneItems('NOW').map(planLabel).join(' / ') || '実行状況は未取得',
      running.length ? 'RUNNING · 実Runの取得記録' : laneItems('NOW').length ? '開発候補 · 着手は未確認' : '全Work Itemの実行状況は未取得', !running.length && laneItems('NOW').length > 0);
    activeRow('NEXT', laneItems('NEXT').map(planLabel).join(' / ') || 'NEXT UNDEFINED',
      laneItems('NEXT').length ? '開発候補 · Operational Nextは未確定' : '確定した次のTaskは未取得', laneItems('NEXT').length > 0);
    const attention = node('div', '', 'kaz-attention');
    const waiting = node('div', '', 'kaz-waiting'); waiting.append(node('h3', 'WAITING FOR YOU'));
    waiting.append(node('p', reviewItems === null ? '確認待ちは未取得' : reviewItems.length ? `${uniqueCount(reviewItems, 'work_item_id')}件の確認待ち` : '確認待ちなし'));
    waiting.append(node('small', reviewItems?.length ? reviewItems[0].title : reviewItems === null ? '0件とは扱いません' : 'この取得範囲では0件', 'kaz-muted'));
    const stopped = current ? data.system_status.filter(s => ['BLOCKED','FAILED'].includes(s.state)) : [];
    const blocked = node('div', '', 'kaz-blocked'); blocked.append(node('h3', 'BLOCKED'));
    blocked.append(node('p', stopped.length ? stopped.map(s => s.label).join(' / ') : 'Task状況は未取得'));
    blocked.append(node('small', stopped.length ? 'Component停止 · Task件数は未取得' : '停止0件とは扱いません', 'kaz-muted'));
    if (stopped.length) blocked.classList.add('kaz-has-blocker');
    if (reviewItems?.length) waiting.classList.add('kaz-has-review');
    attention.append(waiting, blocked); active.append(attention);
    const map = section('System Map');
    const grid = node('div', '', 'kaz-systems');
    const systemTargets = new Map();
    data.system_status.forEach(s => {
      const row = node('details', '', 'kaz-system'), summary = node('summary');
      summary.append(node('strong', s.label), pill(s.state)); row.append(summary, node('p', s.basis, 'kaz-muted'));
      const healthName = s.id === 'context' ? 'GitHub Context' : s.id === 'calendar' ? 'Calendar' : null;
      const health = data.source_health.find(h => h.name === healthName);
      if (health) { summary.append(node('small', `記録 ${health.status.toUpperCase()}`)); row.append(node('p', `${time(health.fetched_at)} JST · ${health.scope}`, 'kaz-muted')); }
      grid.append(row); systemTargets.set(s.id, row);
    });
    map.append(grid);
    const wins = section('Recent Wins'); wins.classList.add('kaz-achievements');
    const achievementTargets = [];
    if (achievements == null) wins.append(node('p', '成果の取得が未確定です。0件とは扱いません。'));
    else if (!achievements.length) wins.append(node('p', 'この取得範囲で確認できた成果は0件です。'));
    else achievements.forEach(a => {
      const card = disclosure(a.label, 'kaz-achievement');
      card.querySelector('summary').append(node('time', new Date(a.occurred_at).toLocaleDateString('ja-JP', {timeZone:'Asia/Tokyo',month:'numeric',day:'numeric'})));
      card.append(node('p', `確認した到達点 · ${time(a.occurred_at)} JST`, 'kaz-muted'), node('small', a.evidence_ref, 'kaz-muted'));
      if (a.target_kind === 'source') card.append(node('p', '過去の読取成功です。現在の鮮度はSystem Mapで確認してください。', 'kaz-muted'));
      wins.append(card); achievementTargets.push({ card, achievement: a });
    });
    const roadmap = section('Development Roadmap');
    if (!data.roadmap) roadmap.append(node('p', '開発計画は未設定です。'));
    else {
      const plan = disclosure('NOW / NEXT / LATER', 'kaz-detail kaz-plan');
      plan.querySelector('summary').append(pill('DRAFT'));
      plan.append(node('p', '本人が示した開発候補 · 未承認', 'kaz-muted')); roadmap.append(plan);
      const lanes = node('div', '', 'kaz-roadmap');
      data.roadmap.lanes.forEach(lane => {
        const row = node('div', '', 'kaz-roadmap-lane'); row.append(node('strong', lane.phase));
        const items = node('ul'); lane.items.forEach(label => items.append(node('li', label))); row.append(items); lanes.append(row);
      });
      plan.append(lanes);
      const basis = disclosure('計画の出典'); basis.append(node('p', data.roadmap.source_ref, 'kaz-muted'), node('p', '開発の方向を示す候補です。今日のTaskや着手指示とは別です。', 'kaz-muted')); plan.append(basis);
    }
    const runs = section('最近のCodex Run');
    const runTargets = new Map();
    if (data.recent_runs === null) runs.append(node('p', 'Run取得失敗。0件として扱いません。'));
    else if (!data.recent_runs.length) runs.append(node('p', 'この取得範囲のRunは0件です。'));
    else data.recent_runs.forEach(r => {
      const card = disclosure(`Codex Run ${r.execution_status === 'completed' ? '✓' : ''} · ${r.execution_status}`, 'kaz-run');
      const summary = card.querySelector('summary'); summary.append(node('small', r.project, 'kaz-muted'));
      card.append(node('h3', r.work_item), node('p', `${r.execution_status} / capture ${r.capture_status}`),
        node('p', `${time(r.started_at)} → ${time(r.finished_at)} JST`), node('p', `${tests(r.tests)} · Human Review ${r.human_review} · Acceptance ${r.acceptance}`), node('small', `Run ${r.run_id}`));
      runs.append(card); runTargets.set(r.run_id, card);
    });
    const details = section('記録とEvidence');
    const workItems = disclosure('Work Item詳細'); details.append(workItems);
    const workTargets = new Map();
    if (data.recent_wins === null) workItems.append(node('p', '取得できていないため、完了件数は不明です。'));
    else if (!data.recent_wins.length) workItems.append(node('p', 'この取得範囲の完了は0件です。'));
    else data.recent_wins.forEach(w => {
      const card = node('article', '', 'kaz-win');
      card.append(node('h3', w.title), pill(w.state), node('p', `${time(w.updated_at)} JST · Evidence ${w.evidence_count}点`));
      const history = node('ol', '', 'kaz-history'); w.history.forEach(h => history.append(node('li', h.state))); card.append(history);
      if (w.run) card.append(node('p', `Codex ${w.run.execution_status} · Capture ${w.run.capture_status} · ${tests(w.run.tests)}`),
        node('p', `Human Review ${w.run.human_review} / Acceptance ${w.run.acceptance}`));
      if (w.run) card.append(evidenceButton('Run詳細を見る', runTargets.get(w.run.run_id)));
      card.append(node('small', `Work Item ${w.work_item_id} · revision ${w.revision}`, 'kaz-muted'));
      workItems.append(card); workTargets.set(w.work_item_id, workItems);
    });
    achievementTargets.forEach(({card, achievement: a}) => {
      const target = a.target_kind === 'work_item' ? workTargets.get(a.target_id) : systemTargets.get('calendar');
      if (target) card.append(evidenceButton('元の記録を見る', target));
    });
    data.recent_wins?.forEach(w => { const run = runTargets.get(w.run?.run_id); if (run) run.append(evidenceButton('Work Item・Lifecycleを見る', workItems)); });
    const next = disclosure('Operational Task / Review状況'); details.append(next);
    next.append(pill(data.next.status), node('p', 'Operational TaskのNextは未確定。開発Roadmapとは別です。'));
    next.append(node('p', data.waiting_for_review === null ? 'Review待ち：取得未確定' : `Review / Acceptance待ち ${data.waiting_for_review.length}件（このPoC範囲）`));
    (data.waiting_for_review || []).forEach(w => next.append(node('p', `${w.title} · ${w.state}`)));
    const sources = disclosure('Source health'); details.append(sources);
    data.source_health.forEach(s => { const row = node('div', '', 'kaz-source'); row.append(node('strong', s.name), pill(s.status.toUpperCase().replace('_',' ')),
      node('small', `${s.fetched_at ? time(s.fetched_at) + ' JST · ' : ''}${s.scope}`)); sources.append(row); });
    sources.append(node('p', `表示取得 ${time(data.generated_at)} JST · READ-ONLY`, 'kaz-muted'));
    if (current) expiry = setTimeout(() => showError('KAZ_STALE'), Math.max(1, 900000 - (Date.now() - Date.parse(data.source.fetched_at))));
  }
  async function refresh() {
    if (!allowed() || !api) { clear(); return; }
    if (pending) return pending;
    const requestEpoch = ++epoch;
    byId('kazOsDiagnosticsStatus').textContent = '確認中…';
    byId('kazOsContent').replaceChildren(node('p', '実記録を確認中…'));
    pending = (async () => {
      try { const data = await api(); if (requestEpoch === epoch && allowed()) render(data); }
      catch (error) { if (requestEpoch === epoch) showError(error?.code); }
      finally { if (requestEpoch === epoch) pending = null; }
    })();
    return pending;
  }
  document.addEventListener('paruru:authenticated', event => {
    clear(); context = event.detail?.context || null; api = event.detail?.kazOsProgressApi || null;

  });
  document.addEventListener('kaz-os:locked', () => { context = null; api = null; clear();  });
  document.addEventListener('kaz-os:diagnostics-opened', () => { if (allowed()) void refresh(); });
  byId('kazOsRefresh')?.addEventListener('click', refresh);
  document.addEventListener('kaz-os:diagnostics-closed', clear);
  window.addEventListener('pagehide', clear);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clear(); else if (allowed() && !byId('kazOsContent').hidden && byId('kazOsView').classList.contains('is-active')) void refresh();
  });
})();

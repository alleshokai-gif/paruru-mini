/* Hidden, read-only Phase 3 preview. All planning arrives in a server snapshot. */
(() => {
  'use strict';
  const text = (parent, tag, value, className) => {
    const node = document.createElement(tag);
    node.textContent = String(value ?? '');
    if (className) node.className = className;
    parent.append(node);
    return node;
  };
  const rows = value => Array.isArray(value) ? value : [];
  const label = item => item?.title || item?.short_title || item?.question || item?.next_action || item?.work_id || item?.id || '内容未取得';
  const time = value => {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
    }).format(parsed) : '時刻未取得';
  };
  const sourceNames = {
    projects: 'Projects', work: 'Work', capa: 'CAPA', calendar: 'Calendar',
    work_busy: 'WorkBusy', decision_ledger: 'Decision Ledger', gardener: 'Gardener',
    today: 'Today', inbox: 'INBOX'
  };

  function renderItems(host, title, items, empty) {
    const section = text(host, 'section', '', 'kv3-section');
    text(section, 'h3', title);
    if (!rows(items).length) {
      text(section, 'p', empty || '該当なし', 'kv3-muted');
      return;
    }
    const list = text(section, 'ul', '', 'kv3-list');
    rows(items).slice(0, 100).forEach(item => {
      const row = text(list, 'li', '', 'kv3-item');
      text(row, 'strong', label(item));
      const details = [item?.state, item?.priority,
        Number.isInteger(item?.estimate_min) ? `${item.estimate_min}分` : null].filter(Boolean);
      if (details.length) text(row, 'small', details.join(' · '));
    });
  }

  function renderWindows(host, title, windows, empty = '利用可能な時間枠は未取得') {
    const section = text(host, 'section', '', 'kv3-section');
    text(section, 'h3', title);
    if (!rows(windows).length) {
      text(section, 'p', empty, 'kv3-muted');
      return;
    }
    rows(windows).slice(0, 30).forEach(window => {
      const card = text(section, 'article', '', 'kv3-window');
      text(card, 'strong', `${time(window.start)} – ${time(window.end)} · ${window.duration_min ?? '?'}分`);
      if (window.constraints) {
        text(card, 'small', Object.values(window.constraints).join(' · '), 'kv3-muted');
      }
      if (rows(window.suggestions).length) renderItems(card, 'この枠でできる候補', window.suggestions);
      else text(card, 'p', '条件に合うWorkはなし', 'kv3-muted');
    });
  }

  function renderSources(host, sources) {
    const details = text(host, 'details', '', 'kv3-sources');
    text(details, 'summary', 'Source freshness');
    const list = text(details, 'ul', '', 'kv3-source-list');
    Object.keys(sourceNames).forEach(key => {
      const info = sources?.[key];
      text(list, 'li', `${sourceNames[key]}: ${info?.status || 'unknown'} · ${time(info?.updated_at)}`);
    });
  }

  function renderShell(host, page) {
    host.replaceChildren();
    const header = text(host, 'header', '', 'kv3-header');
    text(header, 'h2', 'Kaz OS v3 Snapshot Preview');
    text(header, 'p', `Build ${globalThis.BUILD_ID || 'unknown'} · Human Review前の検証画面`, 'kv3-muted');
    const nav = text(host, 'nav', '', 'kv3-nav');
    for (const [key, name] of [['today', 'TODAY'], ['work', 'WORK'], ['projects', 'PROJECTS'], ['capa', 'CAPA']]) {
      const anchor = text(nav, 'a', name);
      anchor.href = key === 'today' ? '#kaz-os/v3' : `#kaz-os/v3/${key}`;
      if (page === key) anchor.setAttribute('aria-current', 'page');
    }
    return text(host, 'main', '', 'kv3-body');
  }

  async function render(host, page, dashboardApi, inboxApi, current) {
    if (!host || !globalThis.PALURU_KAZ_OS_V3_PREVIEW_ENABLED) return;
    const body = renderShell(host, page);
    text(body, 'p', 'Snapshotを読込中…', 'kv3-loading');
    const started = performance.now();
    try {
      const snapshot = await dashboardApi();
      if (!current()) return;
      body.replaceChildren();
      const elapsed = Math.round(performance.now() - started);
      const state = text(body, 'p', `${snapshot.status} · 生成 ${time(snapshot.generated_at)} · GET ${elapsed}ms`, 'kv3-state');
      state.dataset.snapshotStatus = snapshot.status;
      renderSources(body, snapshot.sources);
      if (page === 'work') {
        renderItems(body, 'Work', snapshot.work, 'Workはありません');
      } else if (page === 'projects') {
        renderItems(body, 'Projects', snapshot.projects, 'Projectはありません');
      } else if (page === 'capa') {
        renderItems(body, 'CAPA', snapshot.capa, 'CAPAはありません');
      } else {
        renderWindows(body, '🟢 ワイの空き時間', snapshot.today.kaz_free_windows);
        renderItems(body, '確認', snapshot.today.confirmations, '判断待ちはありません');
        renderItems(body, 'NOW', snapshot.today.now, '今すぐの候補なし');
        renderItems(body, 'NEXT', snapshot.today.next, '次の候補なし');
        renderItems(body, '今日の予定', snapshot.today.scheduled, '予定なし');
        renderItems(body, 'WAITING', snapshot.today.waiting, '待機中のWorkなし');
        const details = text(body, 'details', '', 'kv3-breakdown');
        text(details, 'summary', '内訳');
        renderWindows(details, '会社の空き時間', snapshot.today.company_free_windows,
          '勤務window未定義のため算出なし');
        renderWindows(details, '予定の空き時間', snapshot.today.personal_free_windows);
      }
    } catch (error) {
      if (!current()) return;
      body.replaceChildren();
      text(body, 'p', `Snapshotを表示できません: ${String(error?.code || 'READ_FAILED')}`, 'kv3-error');
    }
  }

  globalThis.KazV3Preview = Object.freeze({ render });
})();

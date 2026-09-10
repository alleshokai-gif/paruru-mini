(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PALURUBus = api;
  if (typeof document !== 'undefined') api.install(document, root);
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const BUS_POSITION_UI_ENABLED = false;
  const POLL_MS = 30000;
  const IDS = ['home_to_noborito', 'home_to_mizonokuchi', 'noborito_to_home', 'mizonokuchi_to_home'];
  let controller, requestedActive = false;
  const tokyo = (value) => Number.isFinite(Date.parse(value)) ? new Date(Date.parse(value) + 9 * 3600000).toISOString().slice(0, 19) : '';
  function validate(data) {
    if (!data || data.success !== true || !Number.isFinite(Date.parse(data.generatedAt))
      || !Array.isArray(data.directions) || data.directions.length !== 4) throw Error('BUS_RESPONSE_INVALID');
    if (new Set(data.directions.map((d) => d.id)).size !== 4) throw Error('BUS_RESPONSE_INVALID');
    for (const d of data.directions) {
      if (!IDS.includes(d.id) || !['outbound', 'inbound'].includes(d.group) || typeof d.from !== 'string' || typeof d.to !== 'string'
        || !Array.isArray(d.arrivals) || d.arrivals.length > 3) throw Error('BUS_RESPONSE_INVALID');
      for (const row of d.arrivals) {
        if (!Number.isFinite(Date.parse(row.scheduledAt)) || !/^\d{2}:\d{2}$/.test(row.scheduledTime || '')
          || typeof row.realtime !== 'boolean' || (row.realtime && (!Number.isFinite(Date.parse(row.estimatedAt))
          || !Number.isFinite(row.delayMinutes)))) throw Error('BUS_RESPONSE_INVALID');
      }
    }
    return data;
  }
  function displayRow(row, direction, data, elapsedMs, error) {
    const now = Date.parse(data.generatedAt) + elapsedMs;
    const etaMs = row.estimatedAt ? Date.parse(row.estimatedAt) - now : null;
    const stale = error || data.fetchError || direction.state === 'realtime_stale'
      || (direction.dataAgeSec != null && direction.dataAgeSec + elapsedMs / 1000 > 120)
      || (row.realtime && row.dataAgeSec != null && row.dataAgeSec + elapsedMs / 1000 > 180);
    const live = row.realtime && !stale && etaMs !== null && etaMs >= 0;
    const expired = row.realtime ? etaMs !== null && etaMs < 0 : Date.parse(row.scheduledAt) < now && row.state !== 'prediction_pending';
    const eta = live ? Math.ceil(etaMs / 60000) : null;
    let note = live ? `あと${eta}分` : row.state === 'prediction_pending' || expired ? '予測更新待ち'
      : stale ? '前回の情報・予測更新待ち' : 'リアルタイム予測なし';
    let delay = '';
    if (live) delay = row.delayMinutes > 0 ? `+${row.delayMinutes}分遅れ` : row.delayMinutes < 0 ? `${Math.abs(row.delayMinutes)}分早い予測` : row.delaySeconds === 0 ? '遅れなし' : '1分未満の差';
    const date = tokyo(row.scheduledAt).slice(0, 10), today = tokyo(data.generatedAt).slice(0, 10);
    return { ...row, live, eta, note, delay, timeLabel: `${date !== today ? `${date.slice(5).replace('-', '/')} ` : ''}${row.scheduledTime}${live ? '便' : '予定'}` };
  }
  function createController({ fetchData, render, hidden, now = () => performance.now(), timers = globalThis }) {
    let active = false, data = null, error = false, pending = null, generation = 0, pollTimer, paintTimer, receivedAt = 0;
    const paint = () => render({ data, error, loading: !!pending, elapsedMs: data ? Math.max(0, now() - receivedAt) : 0 });
    function stop() {
      generation++; timers.clearTimeout(pollTimer); timers.clearTimeout(paintTimer);
      pending?.abort(); pending = null;
    }
    function schedulePaint() {
      timers.clearTimeout(paintTimer);
      if (active && !hidden()) paintTimer = timers.setTimeout(() => { paint(); schedulePaint(); }, 1000);
    }
    async function refresh() {
      if (!active || hidden() || pending) return;
      timers.clearTimeout(pollTimer);
      const request = new AbortController(), current = generation;
      pending = request; paint();
      const timeout = timers.setTimeout(() => request.abort(), 20000);
      try {
        const next = validate(await fetchData(request.signal));
        if (current !== generation) return;
        data = next; receivedAt = now(); error = false;
      } catch {
        if (current === generation) error = true;
      } finally {
        timers.clearTimeout(timeout);
        if (current === generation) {
          pending = null; paint();
          if (active && !hidden()) pollTimer = timers.setTimeout(refresh, POLL_MS);
        }
      }
    }
    function resume() { stop(); if (active && !hidden()) { void refresh(); schedulePaint(); } }
    return { refresh, setActive(value) { if (active === !!value) return; active = !!value; resume(); }, visibilityChanged: resume,
      destroy() { active = false; stop(); } };
  }
  function element(doc, tag, className, text) {
    const node = doc.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node;
  }
  function install(doc, root) {
    function mount() {
      const mount = doc.querySelector('#busMount'); if (!mount || controller) return;
      mount.classList.add('paluru-bus');
      const header = element(doc, 'header', 'bus-header');
      const title = element(doc, 'div'); title.append(element(doc, 'p', 'bus-eyebrow', 'いつものバス'), element(doc, 'h1', '', 'Bus'));
      const refresh = element(doc, 'button', 'bus-refresh', '更新'); refresh.type = 'button'; header.append(title, refresh);
      const status = element(doc, 'p', 'bus-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
      const cards = element(doc, 'div', 'bus-groups');
      const footer = element(doc, 'footer', 'bus-footer');
      footer.append(element(doc, 'p', '', '出典：川崎市交通局／公共交通オープンデータセンター'));
      const source = element(doc, 'a', '', '公式バス情報'); source.href = 'https://www.city.kawasaki.jp/820/'; source.target = '_blank'; source.rel = 'noopener noreferrer';
      footer.append(source, element(doc, 'p', '', '時刻は目安です。道路状況などにより変わります。'));
      const staticTime = element(doc, 'p'); footer.append(staticTime);
      mount.replaceChildren(header, status, cards, footer);
      controller = createController({ hidden: () => doc.hidden, fetchData: async (signal) => {
        const configured = root.PALURU_BUS_API_URL;
        if (!configured) throw Error('BUS_NOT_CONFIGURED');
        const url = new URL(configured, root.location.href);
        if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw Error('BUS_URL_INVALID');
        if (url.username || url.password || url.search || url.hash) throw Error('BUS_URL_INVALID');
        const response = await root.fetch(url.href, { method: 'GET', signal, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
        if (!response.ok) throw Error('BUS_FETCH_ERROR');
        return response.json();
      }, render: ({ data, error, loading, elapsedMs }) => {
        refresh.disabled = loading;
        const failed = error || data?.fetchError;
        status.textContent = !root.PALURU_BUS_API_URL ? 'Bus APIの接続先は設定待ちです' : failed
          ? `バス情報を更新できませんでした${data ? ` · 前回更新 ${data.directions.map((d) => tokyo(d.updatedAt)).sort()[0]?.slice(11, 16) || '--:--'}` : ''}`
          : !data ? 'バス情報を読み込み中…' : loading ? '更新中…' : `30秒ごとに更新 · 取得 ${tokyo(data.generatedAt).slice(11, 16)}`;
        status.classList.toggle('is-stale', !!failed);
        staticTime.textContent = data?.staticUpdatedAt ? `時刻表取得 ${tokyo(data.staticUpdatedAt).slice(0, 16).replace('T', ' ')}${data.staticStale ? '（前回の時刻表）' : ''}` : '';
        if (!data) { cards.replaceChildren(element(doc, 'p', 'bus-empty', error ? '更新ボタンでもう一度お試しください' : 'いつもの4方向を確認しています')); return; }
        const groups = [];
        for (const [key, label] of [['outbound', '行き'], ['inbound', '帰り']]) {
          const group = element(doc, 'section', 'bus-group'); group.append(element(doc, 'h2', 'bus-group-title', label));
          for (const direction of data.directions.filter((d) => d.group === key)) {
            const card = element(doc, 'article', 'bus-card'); card.dataset.busDirection = direction.id;
            card.append(element(doc, 'h3', 'bus-direction', `${direction.from} → ${direction.to}`));
            const board = element(doc, 'ol', 'bus-board');
            direction.arrivals.forEach((arrival, index) => {
              const row = displayRow(arrival, direction, data, elapsedMs, error);
              const line = element(doc, 'li', 'bus-row');
              const top = element(doc, 'div', 'bus-row-top');
              top.append(element(doc, 'span', 'bus-rank', ['先発', '次便', '次々便'][index]), element(doc, 'span', 'bus-route', row.routeLabel || '系統情報なし'),
                element(doc, 'span', 'bus-platform', row.platform || 'のりば情報なし'));
              line.append(top, element(doc, 'p', 'bus-headsign', row.headsign ? `${row.headsign} 行き` : '行先情報なし'));
              const timing = element(doc, 'div', 'bus-timing');
              timing.append(element(doc, 'time', 'bus-scheduled', row.timeLabel), element(doc, 'span', row.live ? 'bus-eta' : 'bus-no-realtime', row.note));
              line.append(timing); if (row.delay) line.append(element(doc, 'p', 'bus-delay', row.delay));
              board.append(line);
            });
            if (!direction.arrivals.length) board.append(element(doc, 'li', 'bus-empty', '検索範囲内の便がありません'));
            card.append(board);
            card.append(element(doc, 'p', 'bus-data-time', `データ更新 ${tokyo(direction.updatedAt).slice(11, 19) || '--:--'}${direction.state === 'realtime_stale' ? ' · 古い情報' : ''}`));
            // Gate stays OFF; unsupported adapter positions never produce a location DOM.
            if (BUS_POSITION_UI_ENABLED && data.positionUiEnabled && direction.arrivals[0]?.position?.supported) {
              card.append(element(doc, 'p', 'bus-position', '位置情報を確認中'));
            }
            group.append(card);
          }
          groups.push(group);
        }
        cards.replaceChildren(...groups);
      } });
      refresh.addEventListener('click', () => { void controller.refresh(); });
      controller.setActive(requestedActive);
      doc.addEventListener('visibilitychange', () => controller.visibilityChanged());
      root.addEventListener('pagehide', () => controller.setActive(false));
      root.addEventListener('pageshow', () => {
        const view = doc.querySelector('[data-view="bus"]');
        if (view && !view.hidden && view.classList.contains('is-active')) controller.setActive(true);
      });
    }
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', mount); else mount();
  }
  return { install, validate, displayRow, createController, setActive(value) { requestedActive = !!value; controller?.setActive(value); }, BUS_POSITION_UI_ENABLED, POLL_MS };
}));

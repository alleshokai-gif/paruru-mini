(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PALURUBusHub = api;
  if (typeof document !== 'undefined') api.install(document, root);
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const HUB_UI_DEFAULT_ENABLED = false;
  const STATES = new Set(['realtime', 'stale', 'realtime_stale', 'static_fallback', 'static_only']);
  let controller, requestedActive = false;
  const text = (value) => typeof value === 'string' && value.length > 0;
  const clock = (epoch) => new Date((epoch + 9 * 3600) * 1000).toISOString().slice(11, 16);
  const dateClock = (epoch) => new Date((epoch + 9 * 3600) * 1000).toISOString().slice(0, 16).replace('T', ' ');

  function validate(data) {
    if (!data || data.success !== true || data.hubId !== 'kibukihoncho' || !text(data.hubLabel)
      || !Number.isFinite(data.generatedAt) || !Array.isArray(data.providers)
      || !Array.isArray(data.decisionGroups) || !Array.isArray(data.attributions))
      throw Error('BUS_HUB_RESPONSE_INVALID');
    for (const provider of data.providers) {
      if (!text(provider?.provider) || !text(provider?.state)
        || provider.retrievedAt != null && !Number.isFinite(provider.retrievedAt)
        || provider.sourceUpdatedAt != null && !Number.isFinite(provider.sourceUpdatedAt))
        throw Error('BUS_HUB_RESPONSE_INVALID');
    }
    for (const attribution of data.attributions) {
      if (!text(attribution?.provider) || !text(attribution?.providerName)
        || !text(attribution?.distributor) || !text(attribution?.url)) throw Error('BUS_HUB_RESPONSE_INVALID');
    }
    for (const group of data.decisionGroups) {
      if (!text(group.id) || group.hubId !== data.hubId || !text(group.label)
        || !Array.isArray(group.destinations) || !Array.isArray(group.providers)
        || !Array.isArray(group.arrivals)) throw Error('BUS_HUB_RESPONSE_INVALID');
      for (const row of group.arrivals) {
        if (!text(row.id) || !text(row.provider) || !text(row.routeLabel) || !text(row.destination)
          || !Number.isFinite(row.scheduledDeparture) || !STATES.has(row.realtimeState)
          || row.etaMinutes != null && !Number.isFinite(row.etaMinutes)
          || row.delayMinutes != null && !Number.isFinite(row.delayMinutes)) throw Error('BUS_HUB_RESPONSE_INVALID');
        if (row.realtimeState === 'static_only' && (row.estimatedDeparture != null || row.etaMinutes != null || row.delayMinutes != null))
          throw Error('BUS_HUB_STATIC_AS_REALTIME');
      }
    }
    return data;
  }

  function displayArrival(row) {
    const scheduled = clock(row.scheduledDeparture);
    if (row.departureState === 'departure_pending') return { time: `${scheduled}便`, note: '発車待ち', kind: 'stale', delay: '' };
    if (row.departureState === 'departure_overdue') return { time: `${scheduled}便`, note: '遅延中・発車未確認', kind: 'stale', delay: '' };
    if (row.departureState === 'departure_uncertain' || row.departureState === 'unknown')
      return { time: `${scheduled}便`, note: '発車済みの可能性あり・間に合う保証なし', kind: 'stale', delay: '' };
    if (['stale', 'realtime_stale'].includes(row.realtimeState))
      return { time: `${scheduled}便`, note: '前回情報・更新待ち', kind: 'stale', delay: '' };
    if (row.realtimeState === 'static_only') return { time: `${scheduled}予定`, note: '時刻表のみ', kind: 'static', delay: '' };
    if (row.realtimeState === 'static_fallback')
      return { time: `${scheduled}予定`, note: 'リアルタイム予測なし', kind: 'fallback', delay: '' };
    const delay = row.delayMinutes > 0 ? `+${row.delayMinutes}分遅れ`
      : row.delayMinutes < 0 ? `${Math.abs(row.delayMinutes)}分早い予測` : '';
    return { time: `${scheduled}便`, note: Number.isFinite(row.etaMinutes) ? `あと${row.etaMinutes}分` : '予測更新待ち',
      kind: 'live', delay };
  }

  function sourceSummary(data) {
    const tokyu = data.providers.find((value) => value.provider === 'tokyu' && Number.isFinite(value.retrievedAt));
    return `${tokyu ? `東急時刻表取得 ${dateClock(tokyu.retrievedAt)} / ` : ''}出典: ${data.attributions
      .map((value) => value.providerName).join('・')}（${[...new Set(data.attributions.map((value) => value.distributor))].join('・')}）`;
  }

  function element(doc, tag, className, value) {
    const node = doc.createElement(tag); if (className) node.className = className; if (value != null) node.textContent = value; return node;
  }

  function apiUrl(root) {
    const url = new URL(root.PALURU_BUS_API_URL, root.location.href);
    url.pathname = '/api/bus/hub'; url.search = '?id=kibukihoncho'; url.hash = '';
    return url;
  }

  function install(doc, root) {
    function mount() {
      if (root.PALURU_BUS_HUB_UI_ENABLED !== true || controller) return;
      const mountPoint = doc.querySelector('#busHubMount');
      if (!mountPoint || !root.PALURUBus?.createController) return;
      const heading = element(doc, 'header', 'bus-hub-header');
      heading.append(element(doc, 'p', 'bus-hub-eyebrow', 'いつもの場所'),
        element(doc, 'h2', 'bus-hub-title', '神木本町'));
      const status = element(doc, 'p', 'bus-hub-status', 'Hubを読み込み中…');
      const groups = element(doc, 'div', 'bus-hub-groups');
      const sources = element(doc, 'p', 'bus-hub-sources');
      mountPoint.replaceChildren(heading, status, groups, sources);
      controller = root.PALURUBus.createController({ hidden: () => doc.hidden, validateData: validate,
        fetchData: async (signal) => {
          const response = await root.fetch(apiUrl(root), { method: 'GET', signal, credentials: 'omit',
            cache: 'no-store', referrerPolicy: 'no-referrer' });
          if (!response.ok) throw Error('BUS_HUB_FETCH_ERROR');
          return validate(await response.json());
        },
        render: ({ data, error, loading }) => {
          status.textContent = error ? 'Hub情報を更新できませんでした' : !data ? 'Hubを読み込み中…'
            : loading ? 'Hub更新中…' : '川崎Realtime＋東急時刻表';
          status.classList.toggle('is-stale', !!error);
          if (!data) return;
          sources.textContent = sourceSummary(data);
          groups.replaceChildren(...data.decisionGroups.filter((group) => group.arrivals.length).map((group) => {
            const section = element(doc, 'section', 'bus-hub-group'); section.dataset.decisionGroup = group.id;
            section.append(element(doc, 'h3', 'bus-hub-purpose', group.label));
            const list = element(doc, 'ol', 'bus-hub-board');
            group.arrivals.slice(0, 3).forEach((row) => {
              const shown = displayArrival(row), recommended = row.id === group.recommendedArrivalId;
              const item = element(doc, 'li', `bus-hub-row is-${shown.kind}${recommended ? ' is-recommended' : ''}`);
              const heading = element(doc, 'div', 'bus-hub-row-heading');
              heading.append(element(doc, 'span', 'bus-hub-provider', row.provider === 'kawasaki' ? '川崎市バス' : '東急バス'),
                element(doc, 'span', 'bus-hub-route', row.routeLabel));
              if (recommended) heading.append(element(doc, 'span', 'bus-hub-recommendation', '最速候補'));
              heading.append(element(doc, 'span', 'bus-hub-platform', row.platform ? `${row.platform}のりば` : 'のりば未確認'));
              const timing = element(doc, 'div', 'bus-hub-timing');
              timing.append(element(doc, 'time', 'bus-hub-time', shown.time), element(doc, 'span', 'bus-hub-quality', shown.note));
              if (shown.delay) timing.append(element(doc, 'span', 'bus-hub-delay', shown.delay));
              item.append(heading, element(doc, 'p', 'bus-hub-destination', `${row.destination} 行き`), timing); list.append(item);
            });
            section.append(list); return section;
          }));
        } });
      controller.setActive(requestedActive);
      doc.addEventListener('visibilitychange', () => controller.visibilityChanged());
    }
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', mount); else mount();
  }
  return { install, validate, displayArrival, sourceSummary, HUB_UI_DEFAULT_ENABLED,
    setActive(value) { requestedActive = !!value; controller?.setActive(value); } };
}));

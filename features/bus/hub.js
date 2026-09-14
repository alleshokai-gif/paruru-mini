(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PALURUBusHub = api;
  if (typeof document !== 'undefined') api.install(document, root);
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const HUB_UI_DEFAULT_ENABLED = false;
  const HUB_SELECTION_STORAGE_KEY = 'paluru.bus.hub.selected.v1';
  const STATES = new Set(['realtime', 'stale', 'realtime_stale', 'static_fallback', 'static_only']);
  const PROVIDER_LABELS = Object.freeze({ kawasaki: '川崎市バス', tokyu: '東急バス', seibu: '西武バス' });
  const controllers = new Map();
  const selectorButtons = new Map(), locationPanels = new Map();
  let requestedActive = false, installed = false, selection;
  const text = (value) => typeof value === 'string' && value.length > 0;
  const clock = (epoch) => new Date((epoch + 9 * 3600) * 1000).toISOString().slice(11, 16);
  const dateClock = (epoch) => new Date((epoch + 9 * 3600) * 1000).toISOString().slice(0, 16).replace('T', ' ');

  function validate(data, expectedHubId) {
    if (!data || data.success !== true || !text(data.hubId) || expectedHubId && data.hubId !== expectedHubId
      || !text(data.hubLabel)
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
    if (row.departureState === 'departure_pending') return { time: scheduled, timeSuffix: '便', note: '発車待ち', kind: 'stale', delay: '' };
    if (row.departureState === 'departure_overdue') return { time: scheduled, timeSuffix: '便', note: '遅延中・発車未確認', kind: 'stale', delay: '' };
    if (row.departureState === 'departure_uncertain' || row.departureState === 'unknown')
      return { time: scheduled, timeSuffix: '便', note: '発車済みの可能性あり', kind: 'stale', delay: '' };
    if (['stale', 'realtime_stale'].includes(row.realtimeState))
      return { time: scheduled, timeSuffix: '便', note: '前回情報・更新待ち', kind: 'stale', delay: '' };
    if (row.realtimeState === 'static_only') return { time: scheduled, timeSuffix: '予定', note: '時刻表のみ', kind: 'static', delay: '' };
    if (row.realtimeState === 'static_fallback')
      return { time: scheduled, timeSuffix: '予定', note: 'リアルタイム予測なし', kind: 'fallback', delay: '' };
    const delay = row.delayMinutes > 0 ? `+${row.delayMinutes}分遅れ`
      : row.delayMinutes < 0 ? `${Math.abs(row.delayMinutes)}分早い予測` : '';
    return { time: scheduled, timeSuffix: '便', note: Number.isFinite(row.etaMinutes) ? `あと${row.etaMinutes}分` : '予測更新待ち',
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

  function providerLabel(doc, provider) {
    const knownProvider = Object.hasOwn(PROVIDER_LABELS, provider);
    const label = element(doc, 'span', `bus-hub-provider${knownProvider ? ` is-${provider}` : ''}`);
    const icon = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.classList.add('bus-hub-provider-icon'); icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('fill', 'none'); icon.setAttribute('stroke', 'currentColor');
    icon.setAttribute('aria-hidden', 'true'); icon.setAttribute('focusable', 'false');
    const body = doc.createElementNS('http://www.w3.org/2000/svg', 'rect');
    body.setAttribute('x', '4'); body.setAttribute('y', '2'); body.setAttribute('width', '16'); body.setAttribute('height', '18'); body.setAttribute('rx', '3');
    const details = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
    details.setAttribute('d', 'M6 11h12M8 16h.01M16 16h.01M7 20v2M17 20v2');
    icon.append(body, details);
    label.append(icon, element(doc, 'span', 'bus-hub-provider-name', PROVIDER_LABELS[provider] || provider));
    return label;
  }

  function configuredHubs(root) {
    const values = root.PALURU_BUS_HUBS;
    if (!Array.isArray(values) || !values.length) throw Error('BUS_HUB_CONFIG_INVALID');
    const ids = new Set();
    return values.map((value) => {
      if (!text(value?.id) || !text(value?.label) || ids.has(value.id)) throw Error('BUS_HUB_CONFIG_INVALID');
      const kind = value.kind == null ? 'hub' : value.kind;
      if (!['hub', 'journey'].includes(kind)) throw Error('BUS_HUB_CONFIG_INVALID');
      ids.add(value.id); return { id: value.id, label: value.label, kind,
        selectorLabel: text(value.selectorLabel) ? value.selectorLabel : value.label };
    });
  }

  function resolveSelectedHubId(specs, storedHubId) {
    return specs.some((spec) => spec.id === storedHubId) ? storedHubId : specs[0].id;
  }

  function readStoredHubId(root) {
    try { return root.sessionStorage?.getItem(HUB_SELECTION_STORAGE_KEY) || null; } catch { return null; }
  }

  function writeStoredHubId(root, hubId) {
    try { root.sessionStorage?.setItem(HUB_SELECTION_STORAGE_KEY, hubId); } catch { /* Storage failure must not block Bus. */ }
  }

  function createSelection({ specs, initialHubId, activate, persist = () => {} }) {
    const ids = new Set(specs.map((spec) => spec.id));
    let selectedHubId = resolveSelectedHubId(specs, initialHubId), active = false;
    function sync() {
      for (const spec of specs) if (spec.id !== selectedHubId) activate(spec.id, false);
      activate(selectedHubId, active);
    }
    return {
      get selectedHubId() { return selectedHubId; },
      select(hubId) {
        if (!ids.has(hubId)) throw Error('BUS_HUB_SELECTION_INVALID');
        if (hubId === selectedHubId) return false;
        selectedHubId = hubId; persist(hubId); sync(); return true;
      },
      setActive(value) { active = !!value; sync(); }
    };
  }

  function apiUrl(root, hubId) {
    const url = new URL(root.PALURU_BUS_API_URL, root.location.href);
    url.pathname = '/api/bus/hub'; url.search = new URLSearchParams({ id: hubId }).toString(); url.hash = '';
    return url;
  }

  function providerSummary(data) {
    const values = data.providers.filter((value) => value.state !== 'unavailable').map((value) => {
      if (value.provider === 'kawasaki') return '川崎Realtime';
      if (value.provider === 'tokyu') return '東急時刻表';
      if (value.provider === 'seibu') return '西武運行情報';
      return value.provider;
    });
    return values.length ? values.join('＋') : '運行情報を確認できません';
  }

  function renderArrivalList(doc, group) {
    const list = element(doc, 'ol', 'bus-hub-board');
    group.arrivals.slice(0, 3).forEach((row) => {
        const shown = displayArrival(row), recommended = row.id === group.recommendedArrivalId;
        const item = element(doc, 'li', `bus-hub-row is-${shown.kind}${recommended ? ' is-recommended' : ''}`);
        const heading = element(doc, 'div', 'bus-hub-row-heading');
        heading.append(providerLabel(doc, row.provider), element(doc, 'span', 'bus-hub-route', row.routeLabel));
        if (recommended) heading.append(element(doc, 'span', 'bus-hub-recommendation', '最速候補'));
        heading.append(element(doc, 'span', 'bus-hub-platform', row.platform
          ? /のりば$/.test(row.platform) ? row.platform : `${row.platform}のりば`
          : text(row.originStop?.name) ? row.originStop.name : 'のりば未確認'));
        const timing = element(doc, 'div', 'bus-hub-timing');
        const departureTime = element(doc, 'time', 'bus-hub-time');
        departureTime.append(element(doc, 'span', 'bus-hub-time-value', shown.time), ' ',
          element(doc, 'span', 'bus-hub-time-suffix', shown.timeSuffix));
        timing.append(departureTime, element(doc, 'span', 'bus-hub-quality', shown.note));
        if (shown.delay) timing.append(element(doc, 'span', 'bus-hub-delay', shown.delay));
      item.append(heading, element(doc, 'p', 'bus-hub-destination', `${row.destination} 行き`), timing); list.append(item);
    });
    return list;
  }

  function renderGroups(doc, groups, data) {
    groups.replaceChildren(...data.decisionGroups.filter((group) => group.arrivals.length).map((group) => {
      const section = element(doc, 'section', 'bus-hub-group'); section.dataset.decisionGroup = group.id;
      section.append(element(doc, 'h3', 'bus-hub-purpose', group.label), renderArrivalList(doc, group));
      return section;
    }));
  }

  function createHubController(doc, root, spec, location) {
    const status = element(doc, 'p', 'bus-hub-status', 'Hubを読み込み中…');
    const groups = element(doc, 'div', 'bus-hub-groups');
    const sources = element(doc, 'p', 'bus-hub-sources');
    const heading = element(doc, 'header', 'bus-hub-header');
    heading.append(element(doc, 'h2', 'bus-hub-title', spec.label));
    location.append(heading, status, groups, sources);
    return root.PALURUBus.createController({ hidden: () => doc.hidden,
      validateData: (data) => validate(data, spec.id),
      fetchData: async (signal) => {
        const response = await root.fetch(apiUrl(root, spec.id), { method: 'GET', signal, credentials: 'omit',
          cache: 'no-store', referrerPolicy: 'no-referrer' });
        if (!response.ok) throw Error('BUS_HUB_FETCH_ERROR');
        return validate(await response.json(), spec.id);
      },
      render: ({ data, error, loading }) => {
        status.textContent = error ? 'Hub情報を更新できませんでした' : !data ? 'Hubを読み込み中…'
          : loading ? 'Hub更新中…' : providerSummary(data);
        status.classList.toggle('is-stale', !!error);
        if (!data) return;
        sources.textContent = sourceSummary(data);
        renderGroups(doc, groups, data);
      } });
  }

  function install(doc, root) {
    function mount() {
      if (root.PALURU_BUS_HUB_UI_ENABLED !== true || installed) return;
      const mountPoint = doc.querySelector('#busHubMount');
      if (!mountPoint || !root.PALURUBus?.createController) return;
      let specs;
      try { specs = configuredHubs(root); } catch {
        mountPoint.textContent = 'Hub設定を読み込めませんでした'; return;
      }
      const rootHeading = element(doc, 'header', 'bus-hub-root-header');
      const selector = element(doc, 'div', 'bus-hub-selector');
      selector.classList.toggle('has-five', specs.length === 5);
      selector.setAttribute('role', 'tablist'); selector.setAttribute('aria-label', '表示する地点');
      rootHeading.append(element(doc, 'p', 'bus-hub-eyebrow', 'いつもの場所'), selector);
      const locations = element(doc, 'div', 'bus-hub-locations');
      const selectHub = (hubId) => {
        if (!selection.select(hubId)) return;
        for (const [id, button] of selectorButtons) {
          const selected = id === hubId;
          button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
          locationPanels.get(id).hidden = !selected;
        }
      };
      specs.forEach((spec, index) => {
        const tabId = `busHubTab-${spec.id}`, panelId = `busHubPanel-${spec.id}`;
        const button = element(doc, 'button', 'bus-hub-selector-button', spec.selectorLabel);
        button.type = 'button'; button.id = tabId; button.setAttribute('role', 'tab');
        button.setAttribute('aria-controls', panelId); button.setAttribute('aria-label', `${spec.label}を表示`);
        button.addEventListener('click', () => selectHub(spec.id));
        button.addEventListener('keydown', (event) => {
          let nextIndex = null;
          if (['ArrowRight', 'ArrowDown'].includes(event.key)) nextIndex = (index + 1) % specs.length;
          if (['ArrowLeft', 'ArrowUp'].includes(event.key)) nextIndex = (index - 1 + specs.length) % specs.length;
          if (event.key === 'Home') nextIndex = 0;
          if (event.key === 'End') nextIndex = specs.length - 1;
          if (nextIndex == null) return;
          event.preventDefault(); selectHub(specs[nextIndex].id); selectorButtons.get(specs[nextIndex].id).focus();
        });
        selectorButtons.set(spec.id, button); selector.append(button);
        const location = element(doc, 'section', 'bus-hub-location');
        location.id = panelId; location.dataset.hubId = spec.id; location.setAttribute('role', 'tabpanel');
        location.setAttribute('aria-labelledby', tabId);
        const instance = spec.kind === 'journey'
          ? root.PALURUBusJourney?.createJourneyController?.(doc, root, spec, location)
          : createHubController(doc, root, spec, location);
        if (!instance) { mountPoint.textContent = '地点設定を読み込めませんでした'; return; }
        controllers.set(spec.id, instance); locationPanels.set(spec.id, location); locations.append(location);
      });
      selection = createSelection({ specs, initialHubId: readStoredHubId(root),
        activate: (hubId, value) => controllers.get(hubId).setActive(value),
        persist: (hubId) => writeStoredHubId(root, hubId) });
      const initialHubId = selection.selectedHubId;
      for (const [id, button] of selectorButtons) {
        const selected = id === initialHubId;
        button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
        locationPanels.get(id).hidden = !selected;
      }
      mountPoint.replaceChildren(rootHeading, locations); installed = true;
      selection.setActive(requestedActive);
      doc.addEventListener('visibilitychange', () => controllers.forEach((value) => value.visibilityChanged()));
    }
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', mount); else mount();
  }
  return { install, validate, displayArrival, sourceSummary, renderArrivalList, configuredHubs, apiUrl,
    resolveSelectedHubId, createSelection,
    HUB_UI_DEFAULT_ENABLED, HUB_SELECTION_STORAGE_KEY,
    setActive(value) { requestedActive = !!value; selection?.setActive(value); } };
}));

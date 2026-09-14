(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.PALURUBusJourney = api; api.install(document, root); }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (globalRoot) {
  'use strict';
  const JOURNEY_UI_DEFAULT_ENABLED = false;
  let installed = false, requestedActive = false, selection = null;
  const text = (value) => typeof value === 'string' && value.length > 0;
  const finiteOrNull = (value) => value === null || Number.isFinite(value);
  const element = (doc, tag, className, value) => {
    const node = doc.createElement(tag); if (className) node.className = className;
    if (value != null) node.textContent = value; return node;
  };

  function configuredJourneys(root) {
    const rows = root.PALURU_BUS_JOURNEYS;
    if (!Array.isArray(rows) || rows.length !== 1) throw Error('BUS_JOURNEY_CONFIG_INVALID');
    const row = rows[0];
    if (!text(row?.id) || !text(row?.label)) throw Error('BUS_JOURNEY_CONFIG_INVALID');
    return { id: row.id, label: row.label };
  }

  function validate(data, expectedId = null) {
    if (data?.success !== true || !text(data.journeyGroupId) || !text(data.journeyGroupLabel)
      || expectedId && data.journeyGroupId !== expectedId || !Number.isFinite(data.generatedAt)
      || !Array.isArray(data.children) || data.children.length !== 2 || !Array.isArray(data.attributions))
      throw Error('BUS_JOURNEY_RESPONSE_INVALID');
    const ids = new Set();
    for (const child of data.children) {
      if (!text(child?.id) || ids.has(child.id) || !text(child.hubId) || !text(child.label)
        || !text(child.purposeLabel) || !['available', 'empty', 'unavailable'].includes(child.state)
        || !Array.isArray(child.providers)) throw Error('BUS_JOURNEY_RESPONSE_INVALID');
      ids.add(child.id);
      if (child.state === 'unavailable' && child.decisionGroup !== null) throw Error('BUS_JOURNEY_RESPONSE_INVALID');
      if (child.state !== 'unavailable') {
        const group = child.decisionGroup;
        if (!group || !text(group.id) || !Array.isArray(group.arrivals) || group.arrivals.length > 3)
          throw Error('BUS_JOURNEY_RESPONSE_INVALID');
        for (const row of group.arrivals) {
          if (!text(row?.id) || !text(row.provider) || !text(row.routeLabel) || !text(row.destination)
            || !finiteOrNull(row.scheduledDeparture) || !finiteOrNull(row.estimatedDeparture)
            || !finiteOrNull(row.etaMinutes) || !finiteOrNull(row.delayMinutes))
            throw Error('BUS_JOURNEY_RESPONSE_INVALID');
        }
      }
    }
    return data;
  }

  function apiUrl(root, journeyId) {
    const url = new URL(root.PALURU_BUS_API_URL, root.location.href);
    url.pathname = '/api/bus/journey'; url.search = new URLSearchParams({ id: journeyId }).toString(); url.hash = '';
    return url;
  }

  function renderChildren(doc, mount, data, hubUi) {
    mount.replaceChildren(...data.children.map((child) => {
      const card = element(doc, 'section', `bus-journey-child is-${child.state}`); card.dataset.journeyChild = child.id;
      const header = element(doc, 'header', 'bus-journey-child-header');
      header.append(element(doc, 'h3', 'bus-journey-child-title', child.label),
        element(doc, 'p', 'bus-journey-child-purpose', child.purposeLabel));
      card.append(header);
      if (child.state === 'unavailable') card.append(element(doc, 'p', 'bus-journey-child-message', '運行情報を確認できません'));
      else if (child.state === 'empty') card.append(element(doc, 'p', 'bus-journey-child-message', 'この先の便はありません'));
      else card.append(hubUi.renderArrivalList(doc, child.decisionGroup));
      return card;
    }));
  }

  function createJourneyController(doc, root, spec, mountPoint) {
    if (root.PALURU_BUS_JOURNEY_UI_ENABLED !== true || !root.PALURUBus?.createController
      || !root.PALURUBusHub?.renderArrivalList) return null;
    let journeySpec;
    try { journeySpec = configuredJourneys(root); } catch { return null; }
    if (journeySpec.id !== spec.id || journeySpec.label !== spec.label) return null;
    const status = element(doc, 'p', 'bus-journey-status', '情報を読み込み中…');
    const children = element(doc, 'div', 'bus-journey-children');
    const heading = element(doc, 'header', 'bus-hub-header');
    heading.append(element(doc, 'h2', 'bus-hub-title', spec.label));
    mountPoint.append(heading, status, children);
    const controller = root.PALURUBus.createController({ hidden: () => doc.hidden,
        validateData: (data) => validate(data, spec.id),
        fetchData: async (signal) => {
          const response = await root.fetch(apiUrl(root, spec.id), { method: 'GET', signal, credentials: 'omit',
            cache: 'no-store', referrerPolicy: 'no-referrer' });
          if (!response.ok) throw Error('BUS_JOURNEY_FETCH_ERROR');
          return validate(await response.json(), spec.id);
        },
        render: ({ data, error, loading }) => {
          status.textContent = error ? '情報を更新できませんでした' : !data ? '情報を読み込み中…'
            : loading ? '更新中…' : '各駅の次3便';
          status.classList.toggle('is-stale', !!error);
          if (data) renderChildren(doc, children, data, root.PALURUBusHub);
        } });
    return controller;
  }

  function install(doc, root) {
    function mount() {
      if (root.PALURU_BUS_JOURNEY_UI_ENABLED !== true || installed) return;
      const integrated = Array.isArray(root.PALURU_BUS_HUBS)
        && root.PALURU_BUS_HUBS.some((value) => value?.kind === 'journey');
      if (integrated) { installed = true; return; }
      const mountPoint = doc.querySelector('#busJourneyMount');
      if (!mountPoint) return;
      let spec;
      try { spec = configuredJourneys(root); } catch { mountPoint.textContent = 'Journey設定を読み込めませんでした'; return; }
      selection = createJourneyController(doc, root, spec, mountPoint);
      if (!selection) { mountPoint.textContent = 'Journey設定を読み込めませんでした'; return; }
      selection.setActive(requestedActive); installed = true;
      doc.addEventListener('visibilitychange', () => selection.visibilityChanged());
    }
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', mount); else mount();
  }

  return { install, validate, configuredJourneys, apiUrl, createJourneyController, JOURNEY_UI_DEFAULT_ENABLED,
    setActive(value) { requestedActive = !!value; selection?.setActive(value); } };
}));

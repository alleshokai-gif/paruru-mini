(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PALURUBusHomeRoute = api;
  if (typeof document !== 'undefined') api.install(document, root);
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const providerName = Object.freeze({ kawasaki: '川崎市バス', tokyu: '東急バス' });
  let active = false, expanded = false, generation = 0, mounted = false, activate = null;
  const clock = (epoch) => new Date((epoch + 9 * 3600) * 1000).toISOString().slice(11, 16);
  const node = (doc, tag, className, value) => {
    const result = doc.createElement(tag); result.className = className; result.textContent = value;
    return result;
  };
  function hubForJourney(journeyId, decision) {
    if (journeyId === 'university') return 'noborito-mukougaoka';
    if (journeyId !== 'high_school') return null;
    if (decision?.fastest?.stationId === 'musashi_mizonokuchi') return 'mizonokuchi-minamiguchi';
    if (decision?.fastest?.stationId === 'noborito') return 'noborito-mukougaoka';
    return null;
  }
  function renderOption(doc, option, primary) {
    const section = node(doc, 'section', `bus-home-route-option${primary ? ' is-primary' : ''}`, '');
    const quality = option.timingQuality === 'static_only' ? '時刻表上の到着' :
      option.timingQuality === 'departure_delay_projection' ? '発車遅延からの推定' : '到着予測';
    section.append(node(doc, 'h3', 'bus-home-route-station', option.stationLabel),
      node(doc, 'p', 'bus-home-route-rail', `列車 ${clock(option.stationArrivalAt)}着`),
      node(doc, 'p', 'bus-home-route-bus',
        `${clock(option.departureAt)} ${providerName[option.provider] || option.provider} ${option.routeLabel}`),
      node(doc, 'p', 'bus-home-route-arrival', `神木本町 ${clock(option.homeArrivalAt)}着`),
      node(doc, 'p', 'bus-home-route-quality', quality));
    return section;
  }
  function renderDecision(doc, mount, result) {
    if (!mount || !result || !['available', 'partial', 'insufficient_data'].includes(result.status))
      throw Error('BUS_HOME_ROUTE_RESULT_INVALID');
    const nodes = [];
    if (result.fastest) {
      const staticFirst = result.fastest.timingQuality === 'static_only';
      nodes.push(node(doc, 'h2', 'bus-home-route-title', staticFirst ? '時刻表上の最速候補' : '最速候補'),
        renderOption(doc, result.fastest, true));
      if (result.alternate) nodes.push(renderOption(doc, result.alternate, false));
      if (Number.isFinite(result.differenceMinutes)) nodes.push(node(doc, 'p', 'bus-home-route-difference',
        `${result.differenceMinutes}分差`));
    } else nodes.push(node(doc, 'p', 'bus-home-route-unavailable', '帰宅時刻を比較できません'));
    if (result.unavailablePlaces?.length || result.unavailableSources?.length)
      nodes.push(node(doc, 'p', 'bus-home-route-partial',
      '一部の経路情報を取得できませんでした'));
    mount.replaceChildren(...nodes);
  }
  function renderTrainChoices(doc, mount, trains, onSelect, options = {}) {
    if (!mount || !Array.isArray(trains) || typeof onSelect !== 'function'
      || trains.some((train) => !train?.id || !train.label)) throw Error('BUS_TRAIN_CHOICES_INVALID');
    const nodes = [];
    if (options.sample === true)
      nodes.push(node(doc, 'p', 'bus-home-route-sample',
        '開発用の架空列車時刻です。実際のダイヤではありません。'));
    const label = node(doc, 'label', 'bus-home-route-train-label', '乗車する列車');
    const select = node(doc, 'select', 'bus-home-route-train-choice', '');
    const placeholder = node(doc, 'option', '', trains.length ? '列車を選択' : '列車候補がありません');
    placeholder.value = ''; select.append(placeholder);
    for (const train of trains) {
      const option = node(doc, 'option', '', train.label);
      option.value = train.id; select.append(option);
    }
    select.disabled = trains.length === 0;
    const details = node(doc, 'div', 'bus-home-route-train-details', '');
    select.addEventListener('change', () => {
      const train = trains.find((row) => row.id === select.value);
      if (!train) return;
      details.replaceChildren();
      if (train.sourceDeparture && train.sourceStation)
        details.append(node(doc, 'p', '', `${train.sourceStation} ${train.sourceDeparture}発・${train.trainType}`));
      if (Array.isArray(train.candidateStations))
        for (const station of train.candidateStations)
          details.append(node(doc, 'p', '', `${station.label} ${station.arrival}着`));
      onSelect(train.id);
    });
    label.append(select);
    nodes.push(label, details);
    if (typeof options.onPage === 'function' && (options.hasPrevious || options.hasNext)) {
      const navigation = node(doc, 'div', 'bus-home-route-train-pages', '');
      for (const [text, enabled, delta] of [
        ['前の列車', options.hasPrevious, -1], ['次の列車', options.hasNext, 1]
      ]) {
        const button = node(doc, 'button', 'bus-home-route-train-page', text);
        button.type = 'button'; button.disabled = !enabled;
        button.addEventListener('click', () => { if (enabled) options.onPage(delta); });
        navigation.append(button);
      }
      nodes.push(navigation);
    }
    mount.replaceChildren(...nodes);
  }
  function install(doc, root) {
    function mount() {
      if (mounted || root.PALURU_BUS_HOME_ROUTE_ENABLED !== true) return;
      const target = doc.querySelector('#busHomeRouteMount');
      if (!target) return;
      mounted = true;
      const source = root.PALURU_BUS_HOME_ROUTE_SOURCE;
      const toggle = node(doc, 'button', 'bus-home-route-toggle', '最速帰宅モード');
      toggle.type = 'button'; toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-controls', 'busHomeRouteContent');
      const content = node(doc, 'div', 'bus-home-route-content', '');
      content.id = 'busHomeRouteContent'; content.hidden = true;
      const journeys = node(doc, 'div', 'bus-home-route-journeys', '');
      const choices = node(doc, 'div', 'bus-home-route-choices', '');
      const result = node(doc, 'div', 'bus-home-route-result', '');
      const status = node(doc, 'p', 'bus-home-route-status', '');
      content.append(journeys, choices, status, result);
      target.append(toggle, content);
      toggle.addEventListener('click', () => {
        expanded = !expanded; content.hidden = !expanded;
        toggle.setAttribute('aria-expanded', String(expanded));
        if (expanded && active) activate?.();
        if (!expanded) generation++;
      });
      if (typeof source?.getTrainChoices !== 'function' || typeof source?.evaluate !== 'function') {
        status.textContent = '列車候補を読み込めません'; return;
      }
      let selectedJourneyId = 'university', selectedPage = 0;
      const selectJourney = (journeyId, page = 0) => {
        selectedJourneyId = journeyId; selectedPage = page;
        const defaultHubId = hubForJourney(journeyId);
        if (defaultHubId) root.PALURUBusHub?.selectHub?.(defaultHubId);
        const request = ++generation;
        choices.replaceChildren(); result.replaceChildren(); status.textContent = '列車候補を読み込み中…';
        for (const button of journeys.children) button.setAttribute('aria-pressed', String(button.dataset.journeyId === journeyId));
        Promise.resolve().then(() => source.getTrainChoices(journeyId, page)).then((response) => {
          if (!active || request !== generation) return;
          const choicesData = Array.isArray(response) ? { trains: response } : response;
          if (!Array.isArray(choicesData?.trains)) throw Error('BUS_TRAIN_CHOICES_INVALID');
          renderTrainChoices(doc, choices, choicesData.trains, (trainId) => {
            const evaluation = ++generation;
            result.replaceChildren(); status.textContent = '帰宅経路を比較中…';
            Promise.resolve().then(() => source.evaluate({ journeyId, trainId, page })).then((decision) => {
              if (!active || evaluation !== generation) return;
              renderDecision(doc, result, decision); status.textContent = '';
              const hubId = hubForJourney(journeyId, decision);
              if (hubId) root.PALURUBusHub?.selectHub?.(hubId);
            }).catch(() => { if (active && evaluation === generation) status.textContent = '帰宅経路を比較できません'; });
          }, { sample: choicesData.sample, hasPrevious: choicesData.hasPrevious,
            hasNext: choicesData.hasNext, onPage: (delta) => selectJourney(journeyId, page + delta) });
          status.textContent = choicesData.trains.length
            ? '乗車する列車を選んでください' : '列車候補がありません';
        }).catch(() => { if (active && request === generation) status.textContent = '列車候補を読み込めません'; });
      };
      for (const [id, label] of [['university', '大学から'], ['high_school', '高校から']]) {
        const button = node(doc, 'button', 'bus-home-route-journey-choice', label);
        button.type = 'button'; button.dataset.journeyId = id;
        button.addEventListener('click', () => selectJourney(id, 0)); journeys.append(button);
      }
      target.hidden = false;
      activate = () => { if (expanded) selectJourney(selectedJourneyId, selectedPage); };
      if (active && expanded) activate();
    }
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', mount); else mount();
  }
  return { renderDecision, renderTrainChoices, hubForJourney, install,
    setActive(value) {
      active = !!value; if (!active) generation++;
      if (active && expanded) activate?.();
    } };
}));

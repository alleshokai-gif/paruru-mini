(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PALURUBusHomeRoute = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const providerName = Object.freeze({ kawasaki: '川崎市バス', tokyu: '東急バス' });
  const clock = (epoch) => new Date((epoch + 9 * 3600) * 1000).toISOString().slice(11, 16);
  const node = (doc, tag, className, value) => {
    const result = doc.createElement(tag); result.className = className; result.textContent = value;
    return result;
  };
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
    if (result.unavailablePlaces?.length) nodes.push(node(doc, 'p', 'bus-home-route-partial',
      '一部の経路情報を取得できませんでした'));
    mount.replaceChildren(...nodes);
  }
  function renderTrainChoices(doc, mount, trains, onSelect) {
    if (!mount || !Array.isArray(trains) || typeof onSelect !== 'function'
      || trains.some((train) => !train?.id || !train.label)) throw Error('BUS_TRAIN_CHOICES_INVALID');
    const choices = trains.map((train) => {
      const button = node(doc, 'button', 'bus-home-route-train-choice', train.label);
      button.type = 'button'; button.addEventListener('click', () => onSelect(train.id));
      return button;
    });
    mount.replaceChildren(...choices);
  }
  return { renderDecision, renderTrainChoices };
}));

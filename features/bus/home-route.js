(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PALURUBusHomeRoute = api;
  if (typeof document !== 'undefined') api.install(document, root);
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const providerName = Object.freeze({ kawasaki: '川崎市バス', tokyu: '東急バス' });
  const railStationName = Object.freeze({ noborito: '登戸', mukougaoka: '向ヶ丘遊園',
    musashi_mizonokuchi: '武蔵溝ノ口' });
  const DISPLAY_ONLY_LIMIT = 5;
  const railClock = minute => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
  const signed = value => value === 0 ? '±0分' : `${value > 0 ? '+' : '−'}${Math.abs(value)}分`;
  const ONBOARD_TARGETS = Object.freeze({ home: { label: '自宅', arrivalLabel: '神木本町', destination: null },
    noborito: { label: '登戸', arrivalLabel: '登戸', destination: 'Noborito' },
    mukougaoka: { label: '向ヶ丘遊園', arrivalLabel: '向ヶ丘遊園', destination: 'MukogaokaYuen' } });
  // Goal-specific projection of the same calculated paths. Never mutate or discard source routes.
  function projectOnboardComparison(response, target = 'home') {
    const goal = Object.hasOwn(ONBOARD_TARGETS, target) ? ONBOARD_TARGETS[target] : null;
    if (!goal) throw Error('BUS_ONBOARD_TARGET_INVALID');
    const home = target === 'home';
    const results = response.results.filter(r => home || r.destination === goal.destination);
    const entries = [], seen = new Set();
    for (const result of results) for (const route of result.routes) {
      const key = JSON.stringify([result.destination, response.selectedTrain.id,
        route.legs.map(l => [l.station, l.train.id, l.departure]), route.continuations || [], route.arrivalAt,
        home ? [route.buses[0]?.provider, route.buses[0]?.tripId, route.buses[0]?.departureAt] : null]);
      if (seen.has(key)) continue;
      seen.add(key);
      const value = home ? route.buses[0]?.homeArrivalAt : route.arrivalAt;
      entries.push({ key, result, route, arrivalAt: Number.isFinite(value) ? value : null,
        conditional: route.connection === 'tight' || home && (route.buses[0]?.connection === 'tight' || route.buses[0]?.transferMode === 'rush') });
    }
    const references = entries.filter(e => e.route.id === e.result.referenceRouteId);
    const reference = (home ? references.find(e => e.route.transfers === 0 && e.arrivalAt !== null)
      || references.find(e => e.arrivalAt !== null) : null) || references[0] || null;
    const bus = reference?.route.buses[0];
    for (const entry of entries) {
      entry.isReference = entry === reference;
      entry.differenceMinutes = entry.arrivalAt !== null && reference && reference.arrivalAt !== null
        ? Math.round((entry.arrivalAt - reference.arrivalAt) / 60) : null;
      const candidateBus = entry.route.buses[0];
      entry.sameBus = Boolean(home && bus?.tripId && candidateBus?.tripId && bus.provider === candidateBus.provider
        && bus.tripId === candidateBus.tripId && bus.departureAt === candidateBus.departureAt);
    }
    const byArrival = (a, b) => Number(a.conditional) - Number(b.conditional)
      || Number(a.arrivalAt === null) - Number(b.arrivalAt === null)
      || (a.arrivalAt !== null && b.arrivalAt !== null ? a.arrivalAt - b.arrivalAt : 0)
      || a.route.transfers - b.route.transfers;
    const ordered = [...entries].sort(byArrival);
    const likely = ordered.filter(e => !e.conditional && e.arrivalAt !== null);
    const fewTransfers = [...likely].sort((a, b) => a.route.transfers - b.route.transfers || byArrival(a, b));
    const priorities = [reference, likely[0], fewTransfers[0],
      fewTransfers.find(e => !e.route.usesRapidExpress && !e.isReference),
      likely.find(e => e.route.transfers > 1 || e.route.legs.some(l => l.station !== response.decisionStation.id))];
    const representatives = [], chosen = new Set();
    const add = entry => { if (entry && !chosen.has(entry.key) && representatives.length < 5) { representatives.push(entry); chosen.add(entry.key); } };
    priorities.forEach(add);
    if (!representatives.some(e => e.differenceMinutes > 0)) add(likely.find(e => e.differenceMinutes > 0));
    add(ordered.find(e => e.conditional));
    for (const entry of ordered) { if (representatives.length >= 3) break; add(entry); }
    const displayOrder = (a, b) => Number(b.isReference) - Number(a.isReference) || byArrival(a, b);
    representatives.sort(displayOrder);
    return { target, goal, home, entries, reference, representatives,
      remaining: ordered.filter(e => !chosen.has(e.key)),
      missing: results.filter(r => !r.routes.length).map(r => `${r.name}：保存ダイヤの着時刻未収録`),
      totalCalculated: results.reduce((sum, r) => sum + r.routes.length, 0) };
  }
  function renderOnboard(doc, mount, response, target = 'home') {
    const view = projectOnboardComparison(response, target);
    mount.replaceChildren();
    const sourceDetails = node(doc, 'details', 'bus-home-route-source-detail', '');
    sourceDetails.append(node(doc, 'summary', '', `保存ダイヤ ${response.referenceDate || '適用日不明'}・現行未照合`),
      node(doc, 'p', 'bus-home-route-quality', `列車は定刻。${response.selectedTrain.onwardIdentity === 'unknown' ? '上原の直通継続は未照合。' : ''}`));
    mount.append(sourceDetails);
    const section = node(doc, 'section', 'bus-home-route-onboard-group', '');
    section.append(node(doc, 'h3', 'bus-home-route-onboard-heading', view.home ? '自宅へ（神木本町）' : `${view.goal.label}へ`));
    const renderRoute = entry => {
      const { route, result } = entry;
      const item = node(doc, 'article', 'bus-home-route-rail-alternative', '');
      const isReference = entry.isReference, bus = view.home ? route.buses[0] : null;
      const arrivalKnown = entry.arrivalAt !== null;
      const differenceKnown = Number.isFinite(entry.differenceMinutes);
      const header = node(doc, 'div', 'bus-home-route-choice-header', '');
      header.append(node(doc, 'span', '', route.transfers === 0 ? 'このまま乗車'
        : route.legs.map(l => `${l.stationName}で乗換`).join(' → ')));
      if (isReference) header.append(node(doc, 'span', 'bus-home-route-choice-tag', '基準'));
      item.append(header);
      const trains = route.legs.length ? route.legs.map(l => ({ type: l.train.type, departure: railClock(l.departure) }))
        : [{ type: response.selectedTrain.type, departure: response.selectedTrain.departure }];
      for (const train of trains) {
        const trainLine = node(doc, 'div', 'bus-home-route-choice-train', '');
        trainLine.append(node(doc, 'strong', '', train.type),
          node(doc, 'strong', '', train.departure ? `${train.departure}発` : '発時刻未取得'));
        item.append(trainLine);
      }
      const home = node(doc, 'div', 'bus-home-route-choice-home', '');
      const time = node(doc, 'div', '', '');
      time.append(node(doc, 'span', 'bus-home-route-choice-home-label', `${view.goal.arrivalLabel}着`),
        node(doc, 'strong', `bus-home-route-choice-home-time${arrivalKnown ? '' : ' is-unknown'}`,
          arrivalKnown ? clock(entry.arrivalAt) : '着時刻未取得'));
      home.append(time);
      if (differenceKnown) {
        const difference = node(doc, 'div', `bus-home-route-choice-difference${entry.differenceMinutes < 0 ? ' is-earlier' : ''}`, '');
        difference.append(node(doc, 'span', '', '基準との差'), node(doc, 'strong', '', signed(entry.differenceMinutes)));
        home.append(difference);
      }
      item.append(home);
      const busLine = node(doc, 'div', 'bus-home-route-choice-bus', '');
      busLine.append(node(doc, 'span', '', bus ? `🚌 ${clock(bus.departureAt)}発` : '🚌 未取得'));
      if (entry.sameBus && !isReference) busLine.append(node(doc, 'span', 'bus-home-route-choice-tag', '同じバス'));
      if (view.home) item.append(busLine);
      const tags = node(doc, 'div', 'bus-home-route-choice-tags', '');
      if (!route.usesRapidExpress) tags.append(node(doc, 'span', '', '快速急行なし'));
      if (route.connection === 'tight') tags.append(node(doc, 'span', 'bus-home-route-choice-caution', '電車接続注意'));
      if (bus?.connection === 'tight' || bus?.transferMode === 'rush') tags.append(node(doc, 'span', 'bus-home-route-choice-caution', 'バス接続注意'));
      if (bus) tags.append(node(doc, 'span', '', bus.timingQuality === 'realtime_arrival' ? 'バス到着予測'
        : bus.timingQuality === 'departure_delay_projection' ? 'バス推定' : 'バス定刻'));
      if (bus && Number.isFinite(bus.waitMinutes)) tags.append(node(doc, 'span', '', `${bus.transferMode === 'rush' ? '急ぎ・' : ''}徒歩後${bus.waitMinutes}分`));
      item.append(tags);
      const details = node(doc, 'details', 'bus-home-route-connection-detail', '');
      const summary = node(doc, 'summary', '', '');
      summary.append(node(doc, 'span', '', view.home ? (Number.isFinite(route.arrival) ? `${result.name} ${railClock(route.arrival)}着` : `${result.name}着未取得`) : `乗換${route.transfers}回`),
        node(doc, 'span', '', '接続詳細'));
      details.append(summary);
      for (const leg of route.legs) details.append(node(doc, 'p', '',
        `${leg.stationName} ${railClock(leg.alightTime)}着 → ${railClock(leg.departure)}発 ${leg.train.destination}行き／${leg.remaining ? '残り' : ''}${leg.connection.gapMinutes}分・${leg.connection.label}`));
      for (const [i, connectionBus] of (view.home ? route.buses : []).entries()) details.append(node(doc, 'p', '',
        `${i ? '次便 ' : ''}🚌 ${clock(connectionBus.departureAt)}発 ${connectionBus.routeLabel} ${connectionBus.platform || ''}／徒歩${connectionBus.walkMinutes}分＋待ち${connectionBus.waitMinutes}分`
        + (connectionBus.transferMode === 'rush' ? '・急ぎの接続' : connectionBus.connection === 'tight' ? '・余裕なし' : '')
        + (Number.isFinite(connectionBus.homeArrivalAt) ? `／神木本町${clock(connectionBus.homeArrivalAt)}着` : '／神木本町着未取得')));
      if (view.home && !bus) details.append(node(doc, 'p', '', result.busStatus === 'unavailable' ? 'バス取得失敗・鉄道のみ比較' : '接続バス未取得'));
      if (view.home && result.busUnavailableSources?.length) details.append(node(doc, 'p', '', '一部のバス乗り場はデータ未取得'));
      item.append(details);
      return item;
    };
    for (const entry of view.representatives) section.append(renderRoute(entry));
    const remaining = view.remaining;
    if (remaining.length) {
      const details = node(doc, 'details', '', ''), summary = node(doc, 'summary', '', `他の乗換案 ${remaining.length}件（早着・遅着）`);
      const list = node(doc, 'div', '', ''), more = node(doc, 'button', 'bus-home-route-page', '次の10件'); more.type = 'button';
      let count = 0;
      const showMore = () => { for (const route of remaining.slice(count, count + 10)) list.append(renderRoute(route)); count += 10; more.hidden = count >= remaining.length; };
      details.addEventListener('toggle', () => { if (details.open && count === 0) showMore(); });
      more.addEventListener('click', showMore); details.append(summary, list, more); section.append(details);
    }
    for (const message of view.missing) section.append(node(doc, 'p', 'bus-home-route-quality', `${message}・比較保留`));
    mount.append(section);
  }
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
    const stationTime = option.stationTimeAt ?? option.stationArrivalAt;
    const station = railStationName[option.stationId] ?? option.stationLabel;
    const stationClock = Number.isFinite(stationTime) && stationTime >= 0 ? clock(stationTime) : null;
    const departureClock = Number.isFinite(option.departureAt) && option.departureAt >= 0
      ? clock(option.departureAt) : null;
    const arrivalClock = Number.isFinite(option.homeArrivalAt) && option.homeArrivalAt >= 0
      ? clock(option.homeArrivalAt) : null;
    const railQuality = option.railTimingQuality === 'delay_projection'
      ? '・遅延に基づく見込み' : '';
    const header = node(doc, 'div', 'bus-home-route-option-header', '');
    header.append(node(doc, 'h3', 'bus-home-route-station', `${station}で下車`));
    const transferLabel = option.placeId === 'noborito-tamagawa' ? '多摩川口側へ移動'
      : option.placeId === 'mizonokuchi' ? '溝の口駅南口へ移動' : null;
    if (option.placeId === 'noborito-tamagawa')
      header.append(node(doc, 'span', 'bus-home-route-area', '多摩川口'));
    section.append(header,
      node(doc, 'p', 'bus-home-route-rail', `🚃 ${station}${stationClock ? ` ${stationClock}着` : ''}${railQuality}`),
      node(doc, 'p', 'bus-home-route-arrow', '↓'));
    if (transferLabel) section.append(node(doc, 'p', 'bus-home-route-walk', `🚶 ${transferLabel}`),
      node(doc, 'p', 'bus-home-route-arrow', '↓'));
    if (option.transferMode === 'rush')
      section.append(node(doc, 'p', 'bus-home-route-rush', '🏃 急げば間に合う'));
    section.append(
      node(doc, 'p', 'bus-home-route-bus',
        `🚌 ${departureClock || '時刻不明'} ${providerName[option.provider] || option.provider} ${option.routeLabel}`),
      node(doc, 'p', 'bus-home-route-board', `乗り場：${option.stationLabel}`),
      node(doc, 'p', 'bus-home-route-arrow', '↓'));
    if (arrivalClock) section.append(node(doc, 'p', 'bus-home-route-arrival',
      `🏠 神木本町 ${arrivalClock}着`));
    section.append(node(doc, 'p', 'bus-home-route-quality', quality));
    return section;
  }
  function displayOnlyOptions(options) {
    if (!Array.isArray(options)) return [];
    const candidates = options.filter((option) => option && Number.isFinite(option.departureAt)
      && option.departureAt >= 0 && Number.isFinite(option.boardingAt)
      && option.departureAt >= option.boardingAt && option.homeArrivalAt === null
      && option.timingQuality === 'arrival_unknown' && option.recommendable === false);
    candidates.sort((a, b) => a.departureAt - b.departureAt
      || String(a.tripId || '').localeCompare(String(b.tripId || ''))
      || String(a.placeId || '').localeCompare(String(b.placeId || '')));
    const seen = new Set();
    return candidates.filter((option) => {
      const key = option.tripId
        ? `${option.provider || ''}:${option.tripId}`
        : JSON.stringify([option.provider, option.queryId, option.routeLabel,
          option.departureAt, option.stationLabel, option.platform]);
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
  }
  function renderDisplayOnlyOption(doc, option) {
    const section = node(doc, 'section', 'bus-home-route-option bus-home-route-display-only', '');
    const station = railStationName[option.stationId] ?? option.stationLabel ?? '乗換駅';
    const header = node(doc, 'div', 'bus-home-route-option-header', '');
    header.append(node(doc, 'h3', 'bus-home-route-station', `${station}で下車`));
    section.append(header);
    if (Number.isFinite(option.stationTimeAt) && option.stationTimeAt >= 0)
      section.append(node(doc, 'p', 'bus-home-route-rail',
        `🚃 ${station} ${clock(option.stationTimeAt)}着`));
    if (option.transferMode === 'rush')
      section.append(node(doc, 'p', 'bus-home-route-rush', '🏃 急げば間に合う'));
    section.append(
      node(doc, 'p', 'bus-home-route-bus',
        `🚌 ${clock(option.departureAt)} ${providerName[option.provider] || option.provider || 'バス'} ${option.routeLabel || '路線名不明'}`),
      node(doc, 'p', 'bus-home-route-board', `乗り場：${option.stationLabel || '不明'}`),
      node(doc, 'p', 'bus-home-route-arrival', '🏠 到着時刻は不明'),
      node(doc, 'p', 'bus-home-route-quality', '最速比較・推薦の対象外'));
    return section;
  }
  function trainChoiceLabel(train) {
    if (!train.sourceStation || !train.sourceDeparture || !train.trainType
      || !Array.isArray(train.candidateStations)
      || train.candidateStations.some((station) => !station.label || !station.stationTime))
      return train.label;
    return `${train.sourceStation} ${train.sourceDeparture}発・${train.trainType}・${train.candidateStations
      .map((station) => `${station.label} ${station.stationTime}着`).join('／')}`;
  }
  function renderDecision(doc, mount, result) {
    if (!mount || !result || !['available', 'partial', 'insufficient_data'].includes(result.status))
      throw Error('BUS_HOME_ROUTE_RESULT_INVALID');
    const nodes = [], displayOnly = displayOnlyOptions(result.options);
    if (result.fastest) {
      const staticFirst = result.fastest.timingQuality === 'static_only';
      const title = staticFirst ? '時刻表上の最速候補' : '最速候補';
      nodes.push(node(doc, 'h2', 'bus-home-route-title',
        displayOnly.length ? `${title}（到着時刻判明分）` : title),
        renderOption(doc, result.fastest, true));
      if (result.alternate) nodes.push(renderOption(doc, result.alternate, false));
      if (Number.isFinite(result.differenceMinutes)) nodes.push(node(doc, 'p', 'bus-home-route-difference',
        `${result.differenceMinutes}分差`));
    } else nodes.push(node(doc, 'p', 'bus-home-route-unavailable', '帰宅時刻を比較できません'));
    if (displayOnly.length) {
      nodes.push(node(doc, 'h2', 'bus-home-route-display-only-title',
        '到着時刻不明の乗車候補'));
      nodes.push(node(doc, 'p', 'bus-home-route-display-only-note',
        '出発時刻が分かる便です。帰宅時刻の比較・推薦には含めていません。'));
      nodes.push(...displayOnly.slice(0, DISPLAY_ONLY_LIMIT)
        .map((option) => renderDisplayOnlyOption(doc, option)));
      if (displayOnly.length > DISPLAY_ONLY_LIMIT)
        nodes.push(node(doc, 'p', 'bus-home-route-display-only-more',
          `ほか ${displayOnly.length - DISPLAY_ONLY_LIMIT} 件は省略しています`));
    }
    if (result.unavailablePlaces?.length || result.unavailableSources?.length)
      nodes.push(node(doc, 'p', 'bus-home-route-partial',
      '一部の経路情報を取得できませんでした'));
    mount.replaceChildren(...nodes);
  }
  function renderCommute(doc, mount, response) {
    if (!response || !['hibiya', 'tamachi', 'pharmacy'].includes(response.mode)
      || !Array.isArray(response.routes)) throw Error('BUS_COMMUTE_RESULT_INVALID');
    const nodes = [];
    if (response.firstAction) nodes.push(node(doc, 'h2', 'bus-home-route-commute-head',
      `いま向かうなら：${response.firstAction.replace(/へ$/, '')}`));
    for (const route of response.routes) {
      const card = node(doc, 'section', `bus-home-route-commute-card${route.rank === 1 ? ' is-primary' : ''}`, '');
      const heading = node(doc, 'div', 'bus-home-route-commute-card-head', '');
      heading.append(node(doc, 'h3', '', route.firstAction || '経路'));
      if (Number.isFinite(route.durationMinutes)) heading.append(node(doc, 'strong', '',
        `${response.mode === 'pharmacy' ? '登戸まで' : '神木本町まで'} ${route.durationMinutes}分`));
      if (route.differenceMinutes > 0) heading.append(node(doc, 'span', '', `+${route.differenceMinutes}分`));
      card.append(heading);
      if (!route.steps?.length) {
        card.append(node(doc, 'p', 'bus-home-route-commute-quality', 'この経路の時刻を取得できません'));
      } else {
        let firstStep = true;
        for (const step of route.steps) {
          const value = step.type === 'train'
            ? `🚃 ${clock(step.departureAt)} ${step.from}発　${step.line} ${step.trainType} ${step.destination}行 → ${clock(step.stationTimeAt)} ${step.to}着`
            : step.type === 'transfer'
              ? `🚶 ${step.station}で${step.nextLine} ${step.nextTrainType} ${step.nextDestination}行へ乗換`
              : step.type === 'through'
                ? `🚃 ${step.station}から${step.nextLine}へ直通（乗換なし）`
              : step.type === 'walk'
                ? `🚶 ${step.to}へ移動（約${step.minutes}分）`
              : step.type === 'bus'
                ? `🚌 ${clock(step.departureAt)} ${providerName[step.provider] || step.provider} ${step.routeLabel}${step.platform ? `・${step.platform}` : ''}`
                : null;
          if (!value) throw Error('BUS_COMMUTE_STEP_INVALID');
          if (!firstStep) card.append(node(doc, 'p', 'bus-home-route-commute-arrow', '↓'));
          card.append(node(doc, 'p', `bus-home-route-commute-step is-${step.type}`, value));
          firstStep = false;
        }
        if (Number.isFinite(route.homeArrivalAt)) card.append(node(doc, 'p',
          'bus-home-route-commute-arrow', '↓'), node(doc, 'p',
          'bus-home-route-commute-home', `🏠 ${clock(route.homeArrivalAt)} 神木本町着`));
        else if (response.mode !== 'pharmacy') card.append(node(doc, 'p', 'bus-home-route-commute-quality',
          'バス到着情報が不足しています。鉄道時刻を確認してください'));
        if (route.quality === 'bus_static') card.append(node(doc, 'p',
          'bus-home-route-commute-quality', 'バスは時刻表に基づく見込み'));
      }
      nodes.push(card);
    }
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
      const option = node(doc, 'option', '', trainChoiceLabel(train));
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
          details.append(node(doc, 'p', '', `${station.label} ${station.stationTime}着`));
      if (train.railRealtimeState === 'confirmed_delay' && train.delaySeconds > 0)
        details.append(node(doc, 'p', '', `列車遅延 +${Math.ceil(train.delaySeconds / 60)}分・遅延に基づく見込み`));
      onSelect(train.id);
    });
    label.append(select);
    nodes.push(label, details);
    if (typeof options.onPage === 'function') {
      const navigation = node(doc, 'div', 'bus-home-route-train-pages', '');
      for (const [text, enabled, delta] of [
        ['前の5本', options.hasPrevious, -1], ['次の5本', options.hasNext, 1]
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
      const commutes = node(doc, 'div', 'bus-home-route-commutes', '');
      const choices = node(doc, 'div', 'bus-home-route-choices', '');
      const result = node(doc, 'div', 'bus-home-route-result', '');
      const status = node(doc, 'p', 'bus-home-route-status', '');
      content.append(journeys, commutes, choices, status, result);
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
      let selectedJourneyId = 'university', selectedPage = 0, selectedCommute = null;
      const selectOnboard = () => {
        root.PALURUBusHub?.selectHub?.('noborito-mukougaoka');
        const request = ++generation;
        choices.replaceChildren(); result.replaceChildren(); status.textContent = '乗車便を読み込み中…';
        Promise.resolve().then(() => source.getCommuteTrains()).then(response => {
          if (!active || request !== generation) return;
          let selectedTarget = 'home';
          const targets = node(doc, 'div', 'bus-home-route-targets', '');
          targets.setAttribute('role', 'group'); targets.setAttribute('aria-label', '到着目標');
          for (const [id, label] of [['home', '🏠 自宅'], ['noborito', '🚉 登戸'], ['mukougaoka', '🚉 向ヶ丘遊園']]) {
            const button = node(doc, 'button', 'bus-home-route-target', label);
            button.type = 'button'; button.dataset.target = id; button.setAttribute('aria-pressed', String(id === selectedTarget));
            button.addEventListener('click', () => {
              selectedTarget = id;
              for (const child of targets.children) child.setAttribute('aria-pressed', String(child.dataset.target === id));
              evaluate();
            });
            targets.append(button);
          }
          const trainLabel = node(doc, 'label', 'bus-home-route-train-label', '乗車中・これから乗る列車');
          const trainSelect = node(doc, 'select', 'bus-home-route-train-choice', '');
          trainSelect.setAttribute('aria-label', '乗車列車');
          const placeholder = node(doc, 'option', '', '列車を選択'); placeholder.value = ''; trainSelect.append(placeholder);
          for (const train of response.trains) {
            const option = node(doc, 'option', '', `${train.origin} ${train.departure} ${train.type} ${train.destination}行き${train.boarded ? '' : '（次便）'}`);
            option.value = train.id; trainSelect.append(option);
          }
          trainLabel.append(trainSelect);
          const stationLabel = node(doc, 'label', 'bus-home-route-train-label', '乗換を判断する駅');
          const stationSelect = node(doc, 'select', 'bus-home-route-train-choice', '');
          stationSelect.setAttribute('aria-label', '乗換判断駅'); stationSelect.disabled = true; stationLabel.append(stationSelect);
          choices.append(targets, trainLabel, stationLabel);
          status.textContent = response.trains.length ? '停車駅の着時刻がある列車だけ表示' : '比較できる列車がありません';
          const evaluate = () => {
            const evaluation = ++generation; result.replaceChildren();
            if (!trainSelect.value || !stationSelect.value) { status.textContent = '列車を選んでください'; return; }
            status.textContent = selectedTarget === 'home' ? 'この駅からの乗換・バスを比較中…' : 'この駅からの乗換を比較中…';
            const input = { trainId: trainSelect.value, stationId: stationSelect.value, target: selectedTarget };
            Promise.resolve().then(() => source.evaluateOnboard(input))
              .then(value => { if (!active || evaluation !== generation) return;
                renderOnboard(doc, result, value, input.target); status.textContent = ''; })
              .catch(() => { if (active && evaluation === generation) { result.replaceChildren(); status.textContent = '比較できません。通過済みの場合は列車を選び直してください'; } });
          };
          trainSelect.addEventListener('change', () => {
            const previous = stationSelect.value;
            stationSelect.replaceChildren();
            const train = response.trains.find(t => t.id === trainSelect.value);
            for (const station of train?.decisionStations || []) {
              const option = node(doc, 'option', '', `${station.name} ${station.arrival}着`); option.value = station.id; stationSelect.append(option);
            }
            if (train?.decisionStations.some(s => s.id === previous)) stationSelect.value = previous;
            stationSelect.disabled = !train; evaluate();
          });
          stationSelect.addEventListener('change', evaluate);
        }).catch(() => { if (active && request === generation) status.textContent = '乗車便を読み込めません'; });
      };
      const selectJourney = (journeyId, page = 0) => {
        selectedCommute = null;
        selectedJourneyId = journeyId; selectedPage = page;
        const defaultHubId = hubForJourney(journeyId);
        if (defaultHubId) root.PALURUBusHub?.selectHub?.(defaultHubId);
        const request = ++generation;
        choices.replaceChildren(); result.replaceChildren(); status.textContent = '列車候補を読み込み中…';
        for (const button of journeys.children) button.setAttribute('aria-pressed', String(button.dataset.journeyId === journeyId));
        for (const button of commutes.children) button.setAttribute('aria-pressed', 'false');
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
      const selectCommute = (mode) => {
        selectedCommute = mode;
        const request = ++generation;
        for (const button of journeys.children) button.setAttribute('aria-pressed', 'false');
        for (const button of commutes.children) button.setAttribute('aria-pressed',
          String(button.dataset.commuteMode === mode));
        choices.replaceChildren(); result.replaceChildren(); status.textContent = '帰宅経路を比較中…';
        Promise.resolve().then(() => source.evaluateCommute(mode)).then((response) => {
          if (!active || request !== generation) return;
          renderCommute(doc, result, response); status.textContent = '';
          if (mode === 'hibiya' && typeof source.getCommuteTrains === 'function' && typeof source.evaluateOnboard === 'function') {
            const onboard = node(doc, 'button', 'bus-home-route-page', '乗車中の電車・判断駅で比較'); onboard.type = 'button';
            onboard.addEventListener('click', selectOnboard); choices.append(onboard);
          }
          if (mode !== 'pharmacy') {
            const terminal = response.routes?.find((route) => route.rank === 1)?.station;
            root.PALURUBusHub?.selectHub?.(terminal === '溝の口'
              ? 'mizonokuchi-minamiguchi' : 'noborito-mukougaoka');
          }
        }).catch(() => { if (active && request === generation) status.textContent = '帰宅経路を比較できません'; });
      };
      for (const [id, label] of [['university', '大学から'], ['high_school', '高校から']]) {
        const button = node(doc, 'button', 'bus-home-route-journey-choice', label);
        button.type = 'button'; button.dataset.journeyId = id;
        button.addEventListener('click', () => selectJourney(id, 0)); journeys.append(button);
      }
      for (const [id, label] of [['hibiya', '日比谷から'], ['tamachi', '田町から'],
        ['pharmacy', '薬局経由']]) {
        const button = node(doc, 'button', 'bus-home-route-commute-choice', label);
        button.type = 'button'; button.dataset.commuteMode = id;
        button.addEventListener('click', () => selectCommute(id)); commutes.append(button);
      }
      target.hidden = false;
      activate = () => { if (expanded) {
        if (selectedCommute && typeof source.evaluateCommute === 'function') selectCommute(selectedCommute);
        else selectJourney(selectedJourneyId, selectedPage);
      } };
      if (active && expanded) activate();
    }
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', mount); else mount();
  }
  return { renderDecision, renderTrainChoices, renderCommute, renderOnboard, projectOnboardComparison, hubForJourney, install,
    setActive(value) {
      active = !!value; if (!active) generation++;
      if (active && expanded) activate?.();
    } };
}));

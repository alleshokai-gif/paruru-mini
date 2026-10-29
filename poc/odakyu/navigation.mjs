// Times in a minute-resolution timetable are intervals, not exact seconds.
export const CONNECTION_LABELS = Object.freeze({ likely: '接続見込み', tight: 'ギリギリ', difficult: '接続困難' });
export const MOVEMENT = Object.freeze({
  unknown: [60, 300], same_platform: [30, 120], change_level: [150, 420], elevator: [180, 600]
});
const EXCHANGE = new Set(['YoyogiUehara', 'ShimoKitazawa', 'Kyodo', 'SeijogakuenMae', 'Noborito']);
const identified = t => ['provider_id', 'explicit_trip'].includes(t.identityBasis);
const minute = value => Number.isInteger(value) && value >= 0 && value < 2880;

export function assessConnection({ station, arrival, departure, now, condition = 'unknown', mobility = 'normal', extraMinutes = 0 }) {
  if (!minute(arrival) || !minute(departure) || !minute(now) || !MOVEMENT[condition]
      || !['normal', 'slow', 'step_free'].includes(mobility)
      || !Number.isInteger(extraMinutes) || extraMinutes < 0 || extraMinutes > 10) throw Error('CONNECTION_INPUT_INVALID');
  let [walkMin, walkMax] = MOVEMENT[condition];
  const reasons = [];
  if (condition === 'unknown') {
    reasons.push('番線・ホーム間の経路は未確認');
    if (station === 'ShimoKitazawa') { walkMin = 150; walkMax = 480; reasons.push('下北沢の階層移動を見込む'); }
  } else reasons.push('移動条件は利用者の選択。実際の番線は未取得');
  if (mobility === 'slow') { walkMin = Math.ceil(walkMin * 1.5); walkMax = Math.ceil(walkMax * 1.5); }
  if (mobility === 'step_free') { walkMin = Math.max(walkMin, 180); walkMax = Math.max(walkMax, 600); reasons.push('エレベーター迂回・待ち時間の仮レンジを含む'); }
  walkMin += extraMinutes * 60; walkMax += extraMinutes * 60;
  const gap = departure - arrival;
  const availableSeconds = { min: gap * 60 - 59, max: gap * 60 + 59 };
  let status;
  if (departure * 60 + 59 < now * 60) { status = 'difficult'; reasons.push('選択時刻では発車済み'); }
  else if (gap === 0) { status = 'tight'; reasons.push('0分接続。分表示では秒の発着順・接続待ちを確定できない'); }
  else if (availableSeconds.max < walkMin) { status = 'difficult'; reasons.push('利用可能時間の上限が移動時間の下限を下回る'); }
  else if (availableSeconds.min >= walkMax) { status = 'likely'; reasons.push('分精度の不確実性を含めても移動レンジ分の余裕がある'); }
  else { status = 'tight'; reasons.push('時刻の秒差と移動所要時間により接続結果が変わる'); }
  reasons.push('移動時間は未実測の設定レンジ。接続を保証しない');
  return { status, label: CONNECTION_LABELS[status], gapMinutes: gap, availableSeconds,
    movementSeconds: { min: walkMin, max: walkMax }, condition, guaranteed: false, reasons };
}

export function scheduledPosition(trip, now) {
  if (!minute(now)) throw Error('TIME_INVALID');
  const dwell = trip.stops.find(s => s.stop === true && minute(s.arrival) && minute(s.departure) && now >= s.arrival && now <= s.departure);
  if (dwell) return { index: dwell.index, from: dwell.station, to: dwell.station, observed: false, kind: 'scheduled_dwell' };
  for (let i = 1; i < trip.stops.length; i++) {
    const from = trip.stops[i - 1], to = trip.stops[i];
    if (from.stop === true && to.stop === true && minute(from.departure) && minute(to.arrival) && now >= from.departure && now < to.arrival) {
      return { index: from.index + (to.index - from.index) * (now - from.departure) / (to.arrival - from.departure),
        from: from.station, to: to.station, observed: false, kind: 'schedule_interpolation' };
    }
  }
  return null;
}

export function arrivalOrderReversals(a, b) {
  const common = a.stops.map(s => ({ a: s, b: b.stops.find(t => t.station === s.station) }))
    .filter(x => x.b && x.a.stop === true && x.b.stop === true && minute(x.a.arrival ?? x.a.departure) && minute(x.b.arrival ?? x.b.departure));
  const result = [];
  for (let i = 1; i < common.length; i++) {
    const before = common[i - 1], after = common[i];
    const d1 = (before.a.departure ?? before.a.arrival) - (before.b.departure ?? before.b.arrival);
    const d2 = (after.a.arrival ?? after.a.departure) - (after.b.arrival ?? after.b.departure);
    if (d1 * d2 < 0) result.push({ from: before.a.station, to: after.a.station,
      kind: 'scheduled_order_reversal', location: 'unknown', trainIds: [a.id, b.id],
      explanation: '明示された着発の順序が逆転。追越しの正確な地点・番線は未取得' });
  }
  return result;
}

// Continuity is accepted only from an explicit same-train link, never time proximity.
function continuationOf(train, pool) {
  const link = train.continuation;
  if (!link || link.evidence !== 'explicit_same_train' || train.boundary?.identity === 'unknown') return null;
  const next = pool.find(t => t.id === link.nextTripId), end = train.stops.at(-1), begin = next?.stops[0];
  if (!next || next.calendar !== train.calendar || next.id === train.id || !end?.stop || !begin?.stop
      || end.station !== link.station || begin.station !== link.station
      || !minute(end.arrival) || !minute(begin.departure) || begin.departure < end.arrival) return null;
  return { next, station: link.station, index: begin.index, departure: begin.departure,
    fromTrainId: train.id, trainId: next.id, evidence: link.evidence };
}
function rideFacts(selected, destination, pool) {
  const seen = new Set(), continuations = []; let train = selected, destinationPassed = false;
  while (train && !seen.has(train.id)) {
    seen.add(train.id);
    if (train.knownPasses?.includes(destination) || train.stops.some(s => s.station === destination && s.stop === false)) destinationPassed = true;
    const end = train.stops.find(s => s.stop === true && s.station === destination && minute(s.arrival));
    if (end) return { arrival: end.arrival, continuations, destinationPassed: false };
    const link = continuationOf(train, pool); if (!link) break;
    continuations.push({ ...link, next: undefined }); train = link.next;
  }
  return { arrival: null, continuations, destinationPassed };
}

export function planNavigation(trips, selectedId, destination, now, options = {}) {
  if (!['Noborito', 'MukogaokaYuen'].includes(destination) || !minute(now)) throw Error('NAVIGATION_INPUT_INVALID');
  const extra = options.extraMinutes ?? 0;
  if (!Number.isInteger(extra) || extra < 0 || extra > 10
      || !['normal', 'slow', 'step_free'].includes(options.mobility || 'normal')
      || Object.values(options.stationConditions || {}).some(value => !MOVEMENT[value])) throw Error('MOVEMENT_INPUT_INVALID');
  const selected = trips.find(t => t.id === selectedId);
  if (!selected || !identified(selected)) throw Error('PROVIDER_TRAIN_REQUIRED');
  const pool = trips.filter(t => t.calendar === selected.calendar && identified(t) && t.datasetId === selected.datasetId && t.dataKind === selected.dataKind);
  const candidateId = options.candidateId;
  if (candidateId !== undefined && (candidateId === selectedId || !pool.some(t => t.id === candidateId))) throw Error('CANDIDATE_INVALID');
  const ride = rideFacts(selected, destination, pool);
  const destinationPassed = ride.destinationPassed;
  const baseline = minute(ride.arrival) ? ride : null;
  if (baseline && baseline.arrival < now) return { status: 'SCHEDULED_ARRIVED', baseline: { arrival: baseline.arrival, transfers: 0 }, recommendation: null, alternatives: [], difficult: [], scope: '定刻ダイヤ上の到着済み。実際の遅延・位置は未取得' };
  const target = pool.flatMap(t => t.stops).find(s => s.stop === true && s.station === destination);
  const alternatives = [], assessments = [];
  const horizon = now + 120, maxTransfers = 2;
  const stations = new Map();
  for (const train of pool) for (const stop of train.stops) {
    if (stop.stop !== true || !EXCHANGE.has(stop.station) || !minute(stop.departure) || stop.departure > horizon || stop.departure < now - 1) continue;
    if (!stations.has(stop.station)) stations.set(stop.station, []);
    stations.get(stop.station).push({ train, stop });
  }
  function visit(train, boardedIndex, earliest, legs, visited, continuations = []) {
    const end = train.stops.find(s => s.stop === true && s.station === destination && minute(s.arrival) && s.arrival >= earliest && s.arrival <= horizon);
    if (end && (legs.length || continuations.length)
        && (candidateId === undefined || legs.some(l => l.trainId === candidateId) || continuations.some(l => l.trainId === candidateId))) alternatives.push({ id: legs.map(l => l.trainId).join('>'), arrival: end.arrival,
      transfers: legs.length, legs, continuations, connection: legs.some(l => l.connection.status === 'tight') ? 'tight' : 'likely',
      saving: baseline ? baseline.arrival - end.arrival : null, guaranteed: false });
    const link = continuationOf(train, pool);
    if (link && !visited.has(link.next.id) && link.departure <= horizon) {
      visit(link.next, link.index - 1, Math.max(earliest, link.departure), legs, new Set([...visited, link.next.id]), [...continuations, { ...link, next: undefined }]);
    }
    if (legs.length === maxTransfers || !target) return;
    for (const stop of train.stops) {
      if (stop.stop !== true || stop.index <= boardedIndex || stop.index >= target.index || !EXCHANGE.has(stop.station)) continue;
      let arrival = stop.arrival, timingBasis = 'arrival';
      // For an already selected origin train only, its published departure is a conservative
      // upper bound on alighting. It is never stored or presented as an observed arrival.
      if (!minute(arrival) && train.id === selected.id && stop === train.stops[0] && minute(stop.departure)) {
        arrival = stop.departure; timingBasis = 'departure_upper_bound';
      }
      if (!minute(arrival) || arrival > horizon) continue;
      if (arrival < earliest && (!minute(stop.departure) || stop.departure < earliest)) continue;
      const ready = Math.max(arrival, earliest);
      for (const next of stations.get(stop.station) || []) {
        if (visited.has(next.train.id)) continue;
        const connection = assessConnection({ station: stop.station, arrival: ready, departure: next.stop.departure, now,
          condition: options.stationConditions?.[stop.station] || 'unknown', mobility: options.mobility || 'normal',
          extraMinutes: options.extraMinutes ?? 0 });
        if (ready > arrival) connection.reasons.push('停車中の現在時刻から残り時間を評価');
        if (timingBasis === 'departure_upper_bound') connection.reasons.push('乗車列車の起点着時刻なし。発時刻を保守的な下車時刻上限として使用');
        const leg = { station: stop.station, fromTrainId: train.id, trainId: next.train.id,
          departure: next.stop.departure, alightTime: arrival, timingBasis, connection,
          reversals: arrivalOrderReversals(train, next.train) };
        if (connection.status === 'difficult') { assessments.push(leg); continue; }
        visit(next.train, stop.index, next.stop.departure, [...legs, leg], new Set([...visited, next.train.id]), continuations);
      }
    }
  }
  visit(selected, -1, now, [], new Set([selected.id]));
  alternatives.sort((a, b) => a.arrival - b.arrival || a.transfers - b.transfers || Number(a.connection === 'tight') - Number(b.connection === 'tight'));
  const stay = baseline ? { id: 'stay', arrival: baseline.arrival, transfers: 0, legs: [], continuations: baseline.continuations, connection: 'none', saving: 0 } : null;
  const eligible = [...(stay ? [stay] : []), ...alternatives.filter(a => a.connection === 'likely')]
    .sort((a, b) => a.arrival - b.arrival || a.transfers - b.transfers || Number(a.connection === 'tight') - Number(b.connection === 'tight'));
  const recommendation = baseline ? eligible[0] || stay : destinationPassed ? eligible[0] || null : null;
  return { status: baseline ? 'PARTIAL_STATIC_ARRIVAL_COMPARISON' : destinationPassed ? 'TRANSFER_REQUIRED' : 'ARRIVAL_UNAVAILABLE',
    destinationPassed: Boolean(destinationPassed), rideContinuations: ride.continuations,
    baseline: stay, recommendation, alternatives: alternatives.slice(0, 8), difficult: assessments.filter(l => candidateId === undefined || l.trainId === candidateId).slice(0, 4),
    bestConditional: alternatives[0] || null, maxTransfers, guaranteed: false,
    missing: ['全駅の着発・運転列車番号・直通継続ID・番線・実測移動時間',
      'データセットの未収録駅・便、着時刻の独立した資料との照合・リアルタイム遅延'],
    scope: '明示された列車ID・同一列車リンク・着発がある範囲内。全線・全乗換駅での最適性を保証しない' };
}

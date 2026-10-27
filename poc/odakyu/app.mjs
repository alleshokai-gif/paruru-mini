import { BUILD, TYPES, minutes, clock } from './core.mjs';
import { planNavigation, scheduledPosition, CONNECTION_LABELS } from './navigation.mjs';

const $ = id => document.getElementById(id);
$('build').textContent = `Build ${BUILD}`;
let model, trips = [], generation = 0;
const name = id => model.stations.find(s => s.id === id)?.name || id;
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function option(value, text) { const node = element('option', text); node.value = value; return node; }
const anchorTime = trip => trip.stops[0].departure ?? trip.stops[0].arrival;
function label(trip) { return `${trip.serviceName ? trip.serviceName + ' / ' : ''}${clock(anchorTime(trip))} ${name(trip.origin)} ${TYPES[trip.type]} ${trip.destination}行`; }
let offlineData;
const offlineMode = document.body.dataset.offline === 'true';
function offlineExpired(kind) {
  if (kind === 'demo') return false;
  const end = kind === 'real' ? offlineData.realUseEndsAt : offlineData.models[kind]?.dataset.rights?.validUntil;
  return !Number.isFinite(Date.parse(end)) || Date.now() >= Date.parse(end);
}
async function get(url) {
  if (offlineMode) {
    if (!offlineData) {
      try { offlineData = JSON.parse($('offline-data').textContent); }
      catch { throw Error('端末内の保存データを読み込めません。元のHTMLを再作成してください'); }
      if (offlineData.format !== 'odakyu-private-offline-v1') throw Error('端末内保存データの形式が違います');
    }
    const parsed = new URL(url, 'https://offline.invalid');
    if (parsed.pathname === '/api/datasets') return offlineData.datasets.map(d => d.available && offlineExpired(d.id) ? { ...d, available: false, title: `${d.title}（利用期限終了）`, unavailableReason: '保存データの利用期限が終了しました。利用を終了してください。デモは明示選択できます。' } : d);
    if (parsed.pathname === '/api/snapshots') return offlineData.snapshots;
    if (parsed.pathname === '/api/model') {
      const kind = parsed.searchParams.get('dataset');
      if (!Object.hasOwn(offlineData.models, kind)) throw Error('この保存版には選択したデータがありません');
      if (offlineExpired(kind)) throw Error('保存データの利用期限が終了しました');
      return offlineData.models[kind];
    }
    throw Error('端末内保存版では利用できない操作です');
  }
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw Error(`データを読み込めません (${response.status})`);
  return response.json();
}
async function load() {
  const version = ++generation;
  $('example').disabled = true; $('train').disabled = true;
  $('mode-banner').textContent = '選択したデータを読み込み中…';
  model = undefined;
  $('source').textContent = '保存データを読み込み中…';
  $('result').replaceChildren(element('p', '保存データを読み込み中…'));
  for (const id of ['diagram', 'connections', 'evidence']) $(id).replaceChildren();
  if (!$('dataset').value) { $('mode-banner').textContent = '使用データ未選択'; $('source').textContent = ''; $('result').replaceChildren(element('p', '使用データを選択してください。')); return; }
  let loaded;
  try { loaded = await get(`/api/model?snapshot=${encodeURIComponent($('snapshot').value)}&dataset=${encodeURIComponent($('dataset').value)}`); }
  catch (error) { if (version === generation) throw error; return; }
  if (version !== generation) return;
  if (!Array.isArray(loaded.trips) || !loaded.reconstruction || !loaded.dataset) throw Error('列車単位データがありません');
  model = loaded;
  $('snapshot').disabled = model.dataset.kind !== 'real';
  $('example').textContent = model.dataset.kind === 'demo' ? 'デモの比較例を再生' : '実ダイヤの比較例を再生';
  setTrains(); render();
  $('example').disabled = !model.example; $('train').disabled = false;
}
function setTrains() {
  if (!model) return;
  const previous = $('train').value, now = minutes($('time').value);
  trips = model.trips.filter(t => t.calendar === $('calendar').value);
  const visible = trips.filter(t => anchorTime(t) >= now - 60 && anchorTime(t) <= now + 30);
  $('train').replaceChildren(option('', '乗車列車を選択してください'), ...visible.map(t => option(t.id, label(t))));
  if (visible.some(t => t.id === previous)) $('train').value = previous;
}
function connectionNode(leg) {
  const train = trips.find(t => t.id === leg.trainId);
  const box = element('div', undefined, `connection ${leg.connection.status}`);
  box.append(element('strong', leg.connection.label),
    element('p', `${name(leg.station)} ${clock(leg.departure)}発 ${TYPES[train.type]} ${train.destination}行`),
    element('p', `時刻表の間隔 ${leg.connection.gapMinutes}分 / 移動の仮レンジ ${Math.ceil(leg.connection.movementSeconds.min / 60)}〜${Math.ceil(leg.connection.movementSeconds.max / 60)}分`, 'muted'));
  const details = element('details'), summary = element('summary', '接続の根拠');
  const list = element('ul');
  for (const reason of leg.connection.reasons) list.append(element('li', reason));
  list.append(element('li', `分精度による時間差 ${leg.connection.availableSeconds.min}〜${leg.connection.availableSeconds.max}秒。実際の発着秒・乗降時間は未取得`));
  details.append(summary, list); box.append(details);
  return box;
}
function renderResult(plan, selected) {
  const nodes = [element('p', model.dataset.kind === 'demo' ? 'デモ・架空ダイヤ（実運行案内不可）' : '保存定刻ダイヤ・取得区間内の比較', 'result-title'), element('p', `${label(selected)} → ${name($('destination').value)}`, 'riding-summary')];
  const recommendation = plan.recommendation;
  if (plan.status === 'SCHEDULED_ARRIVED') {
    nodes.push(element('div', '定刻では到着済み', 'big'), element('p', `目的駅 ${clock(plan.baseline.arrival)}着。実際の遅延・現在位置は未取得です。`));
  } else if (plan.status === 'TRANSFER_REQUIRED') {
    nodes.push(element('div', 'この列車は目的駅を通過します', 'big'));
    if (recommendation) nodes.push(element('p', `${recommendation.legs.map(l => name(l.station)).join('・')}で乗換する案は ${clock(recommendation.arrival)}着。乗り続ける案は到着不可のため短縮分は算出しません。`));
    else nodes.push(element('p', '取得範囲に接続見込みのある到着経路がありません。途中で停車列車への乗換が必要ですが、未取得の着発を補って推奨しません。'));
  } else if (!plan.baseline) {
    nodes.push(element('div', '目的駅の着時刻がありません', 'big'), element('p', 'この列車の目的駅着、または同一列車の継続情報が不足しています。発時刻から着時刻を作らず、短縮時間の推奨を保留します。着時刻が明示された別の候補は下の詳細で確認できます。'));
  } else if (recommendation.transfers === 0) {
    nodes.push(element('div', `このまま${name($('destination').value)}へ`, 'big'),
      element('p', '取得範囲では、接続見込みのある乗換で短縮なし。同着なら乗換なしを優先します。'));
  } else {
    nodes.push(element('div', `ダイヤ上 ${recommendation.saving}分早着`, 'big'),
      element('p', `${recommendation.legs.map(l => name(l.station)).join('・')}で乗換 / ${CONNECTION_LABELS[recommendation.connection]}`),
      element('p', '番線・移動時間は未確認のため、接続を保証する案内ではありません。'));
  }
  if (recommendation) nodes.push(element('p', `乗換${recommendation.transfers}回 / ${recommendation.transfers === 0 ? '継続乗車' : CONNECTION_LABELS[recommendation.connection]}`, 'connection-summary'));
  if (plan.baseline?.continuations?.length) nodes.push(element('p', '明示された同一列車リンクあり。直通境界での乗換は不要です。'));
  const grid = element('div', undefined, 'grid');
  for (const [title, time] of [['乗り続ける：着', plan.baseline?.arrival], [recommendation?.transfers === 0 ? '乗換なしを優先：着' : '乗換案：着', recommendation?.arrival]]) {
    const metric = element('div', undefined, 'metric'); metric.append(element('small', title), element('strong', title === '乗り続ける：着' && plan.destinationPassed ? '通過' : clock(time))); grid.append(metric);
  }
  nodes.push(grid);
  if (plan.bestConditional?.connection === 'tight' && plan.bestConditional.saving > 0) {
    nodes.push(element('p', `ギリギリの候補は ${clock(plan.bestConditional.arrival)}着 / 乗換${plan.bestConditional.transfers}回 / ${plan.bestConditional.saving}分早着。接続できない可能性があるため別枠にしています。`, 'tight-note'));
  }
  $('result').replaceChildren(...nodes);
  const connections = [];
  for (const candidate of plan.alternatives.slice(0, 4)) {
    const card = element('div', undefined, 'candidate');
    card.append(element('p', `${clock(candidate.arrival)}着 / 乗換${candidate.transfers}回${candidate.saving === null ? '' : candidate.saving > 0 ? ` / ${candidate.saving}分早着` : candidate.saving === 0 ? ' / 同着' : ` / ${Math.abs(candidate.saving)}分遅着`}`));
    for (const leg of candidate.legs) card.append(connectionNode(leg));
    connections.push(card);
  }
  if (plan.difficult[0]) connections.push(connectionNode(plan.difficult[0]));
  if (!connections.length) connections.push(element('p', '明示着発による比較候補がありません。'));
  $('connections').replaceChildren(...connections);
}
function renderDiagram(selected, now, plan) {
  const rideTrips = [selected, ...(plan.rideContinuations || plan.baseline?.continuations || []).map(c => trips.find(t => t.id === c.trainId)).filter(Boolean)];
  const diagram = $('diagram'); diagram.replaceChildren();
  for (const station of model.stations) {
    const matching = rideTrips.flatMap(t => t.stops).filter(s => s.station === station.id);
    const stop = matching.length ? { ...matching[0], arrival: matching.find(s => s.arrival !== null)?.arrival ?? null, departure: matching.findLast(s => s.departure !== null)?.departure ?? null } : null;
    const transfer = plan.recommendation?.legs?.some(l => l.station === station.id);
    const row = element('div', undefined, `station${station.id === 'MukogaokaYuen' ? ' beyond' : ''}${transfer ? ' transfer' : ''}`);
    const title = element('div', station.name, 'station-name');
    let text = rideTrips.some(t => t.knownPasses.includes(station.id)) ? '通過（通常種別の停車規則）' : 'この駅の着発は未取得';
    if (stop?.stop === false) text = '通過（入力データ）';
    else if (stop) text = `${stop.arrival !== null ? clock(stop.arrival) + '着 ' : ''}${stop.departure !== null ? clock(stop.departure) + '発' : ''}`;
    title.append(element('small', text));
    if (station.id === $('destination').value && plan.recommendation?.saving > 0) title.append(element('small', `乗換案 ${clock(plan.recommendation.arrival)}着`, 'early-note'));
    row.append(title, element('div', undefined, 'track'), element('div', undefined, 'track')); diagram.append(row);
  }
  const rideIds = new Set([selected.id, ...(plan.rideContinuations || plan.baseline?.continuations || []).map(c => c.trainId)]);
  const selectedPosition = [...rideIds].map(id => trips.find(t => t.id === id)).filter(Boolean).map(t => scheduledPosition(t, now)).find(Boolean) || null;
  const selectedBanner = element('p', `★ 自分：${label(selected)} / ${selectedPosition ? '保存ダイヤによる推定位置' : 'この時刻の位置は未確定'}`, 'selected-banner');
  diagram.prepend(selectedBanner);
  const positions = trips.map(trip => ({ trip, point: scheduledPosition(trip, now) })).filter(x => x.point);
  const ahead = selectedPosition ? positions.filter(x => !rideIds.has(x.trip.id) && x.point.index > selectedPosition.index).sort((a, b) => a.point.index - b.point.index)[0]?.trip.id : null;
  const behind = selectedPosition ? positions.filter(x => !rideIds.has(x.trip.id) && x.point.index < selectedPosition.index).sort((a, b) => b.point.index - a.point.index)[0]?.trip.id : null;
  const placed = new Map();
  for (const { trip, point } of positions) {
    const fast = ['RapidExpress', 'Express'].includes(trip.type);
    const key = `${fast}:${Math.floor(point.index)}`, offset = placed.get(key) || 0; placed.set(key, offset + 1);
    const marker = element('div', `${rideIds.has(trip.id) ? '★ 自分 ' : trip.id === ahead ? '前方 ' : trip.id === behind ? '後方 ' : ''}🚆 ${TYPES[trip.type]}\n${trip.destination}行`,
      `marker ${trip.type}${fast ? ' fast' : ''}${rideIds.has(trip.id) ? ' selected' : ''}${trip.id === ahead ? ' ahead' : ''}${trip.id === behind ? ' behind' : ''}`);
    marker.style.whiteSpace = 'pre-line'; marker.style.top = `${selectedBanner.getBoundingClientRect().height + 16 + point.index * 92 + 24 + offset * 27}px`;
    marker.title = `${label(trip)} / ${name(point.from)}〜${name(point.to)}（保存定刻ダイヤによる推定）`; diagram.append(marker);
  }
}
function renderEvidence(selected, plan) {
  const nodes = [element('p', `選択：${label(selected)}`), element('p', `${model.dataset.kind === 'demo' ? 'デモID' : '提供元便ID'}：${selected.sourceTrainId || '未提供'}。運転列車番号ではありません。`),
    element('p', `千代田線から同じ列車で継続：${selected.throughChiyoda === false ? '直通の記録なし。始発駅は入力データを参照' : selected.continuation ? '明示された同一列車リンクあり（乗換不要）' : '未確定。直通先IDを推測で結合しない'}`),
    element('p', plan.scope)];
  if (selected.boundary) nodes.push(element('p', `直通境界：${name(selected.boundary.station)} / 同一便 ${selected.boundary.identity === 'explicit' ? '明示' : '不明'}${selected.boundary.typeAfter ? ' / 種別変更 ' + TYPES[selected.boundary.typeBefore] + ' → ' + TYPES[selected.boundary.typeAfter] : ''}`));
  const table = element('table'), heading = element('tr');
  for (const title of ['駅', '着', '発']) heading.append(element('th', title)); table.append(heading);
  const rideTrips = [selected, ...(plan.rideContinuations || plan.baseline?.continuations || []).map(c => trips.find(t => t.id === c.trainId)).filter(Boolean)];
  for (const [index, train] of rideTrips.entries()) for (const stop of train.stops) {
    const row = element('tr'); for (const cell of [name(stop.station) + (index ? '（同一列車の継続先）' : ''), stop.stop ? clock(stop.arrival) : '通過', stop.stop ? clock(stop.departure) : '通過']) row.append(element('td', cell)); table.append(row);
  }
  nodes.push(table);
  for (const leg of plan.recommendation?.legs || plan.bestConditional?.legs || []) for (const reversal of leg.reversals) {
    const pair = reversal.trainIds.map(id => trips.find(t => t.id === id)).filter(Boolean).map(label).join(' と ');
    nodes.push(element('p', `${pair}：${name(reversal.from)}〜${name(reversal.to)}で着発順序が逆転（保存ダイヤの先着関係）。追越し地点・番線は未取得。`));
  }
  nodes.push(element('p', model.dataset.kind === 'demo' ? '人工IDと明示継続リンクのみを使用。実ダイヤ・ODPTの照合結果ではありません。' : model.dataset.kind === 'additional' ? '追加データの明示IDと継続リンクのみを使用。利用条件の確認記録と独立した時刻照合は別途必要です。' : `同一便は提供元IDで結合。途中駅の欠測を補完しません。ODPT発時刻と公式画面${model.arrivalVerification?.matched || 0}件の着時刻を照合。別提供者の着時刻照合・実際の遅延は未確認。`));
  $('evidence').replaceChildren(...nodes);
}
function render() {
  if (!model) return;
  if (offlineMode && offlineExpired(model.dataset.kind)) throw Error('保存データの利用期限が終了しました。利用を終了してください');
  $('result').className = '';
  const now = minutes($('time').value), selected = trips.find(t => t.id === $('train').value);
  if (model.dataset.kind === 'real') {
    $('source').textContent = `提供元ID付き ${model.reconstruction.accepted}便（平土休日計）。独立照合：発時刻 ${model.reconstruction.departureChecks}件一致 / 不一致 ${model.reconstruction.departureMismatches}件。元データ確認 ${new Date(model.reconstruction.sourceCheckedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} JST。着時刻の別取得経路照合 ${model.arrivalVerification?.matched || 0}件一致 / 不一致 ${model.arrivalVerification?.mismatched || 0}件（同じ提供元の公式画面、別提供者の資料照合は未実施）。ODPT取得 ${new Date(model.fetchedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} JST。`;
    $('verification').textContent = model.arrivalVerification?.status === 'not_checked' ? '着時刻の別取得経路による照合記録がありません。' : `公式画面での再取得照合：${model.arrivalVerification?.matched || 0}件一致、${model.arrivalVerification?.mismatched || 0}件不一致。確認日 ${model.arrivalVerification?.checkedAt ? new Date(model.arrivalVerification.checkedAt).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '未確認'}。対象は平日の個別例であり、全便・土休日・改正後の有効性を保証しません。不一致の便は案内対象から外します。`;
  }
  const demo = model.dataset.kind === 'demo';
  document.body.classList.toggle('demo-mode', demo);
  $('timing-badge').textContent = demo ? 'デモ / 架空ダイヤ・位置は推定' : '保存定刻ダイヤ / 位置は推定';
  $('mode-banner').textContent = demo ? 'デモ：すべて架空の時刻・列車です。実際の乗換には使えません。' : `${model.dataset.title} / Daily Ready：未達`;
  if (model.dataset.kind !== 'real') {
    $('source').textContent = `${model.dataset.title} / ${model.dataset.coverage} / ${model.trips.length}列車区間レコード / データ対象日 ${model.dataset.serviceDates.join('・') || (demo ? 'デモのため適用日なし' : '対象日未指定')} / 実測位置なし`;
    $('verification').textContent = demo ? 'デモダイヤは実際の鉄道時刻表とは照合しません。実便対応件数には含めません。' : '追加データはローカルの利用条件確認記録に基づき読込。独立した着時刻照合は別途必要です。';
  }
  const departures = model.departures.filter(d => d.calendar === $('calendar').value && d.station === $('destination').value && d.time >= now).sort((a, b) => a.time - b.time).slice(0, 8);
  $('departures').replaceChildren(...departures.map(d => element('p', `${clock(d.time)}発 ${TYPES[d.type]} ${d.destinationName}行（着時刻ではありません）`)));
  if (!selected) {
    $('result').replaceChildren(element('p', '乗車列車を手動選択してください。')); $('diagram').replaceChildren(); $('connections').replaceChildren(); $('evidence').replaceChildren(); return;
  }
  if ($('buffer').value === '') throw Error('追加の余裕は0〜10の整数で指定してください');
  const plan = planNavigation(trips, selected.id, $('destination').value, now, {
    stationConditions: { YoyogiUehara: $('uehara-condition').value, SeijogakuenMae: $('seijo-condition').value, Noborito: $('noborito-condition').value },
    mobility: $('mobility').value, extraMinutes: Number($('buffer').value)
  });
  $('result').className = ''; renderResult(plan, selected); renderDiagram(selected, now, plan); renderEvidence(selected, plan);
}
function safe(action) {
  return async () => { try { await action(); } catch (error) {
    $('result').className = 'error'; $('result').replaceChildren(element('p', error.message));
    $('diagram').replaceChildren(); $('connections').replaceChildren(); $('evidence').replaceChildren();
  } };
}
$('snapshot').addEventListener('change', safe(load));
$('dataset').addEventListener('change', safe(load));
$('diagram').closest('details').addEventListener('toggle', safe(() => { if ($('diagram').closest('details').open) render(); }));
window.addEventListener('resize', safe(render));
$('calendar').addEventListener('change', safe(() => { setTrains(); render(); }));
$('time').addEventListener('change', safe(() => { setTrains(); render(); }));
for (const id of ['train', 'destination', 'uehara-condition', 'seijo-condition', 'noborito-condition', 'mobility', 'buffer']) $(id).addEventListener('change', safe(() => { render(); if (['train', 'destination'].includes(id) && $('train').value) $('result').scrollIntoView({ block: 'start' }); }));
$('example').addEventListener('click', safe(() => {
  if (!model) throw Error('データ読込が完了していません');
  const example = model.example; if (!example) throw Error('この保存データに比較例がありません');
  const selected = model.trips.find(t => t.id === example.selectedId);
  $('calendar').value = selected.calendar; $('time').value = clock(example.compareAt); $('destination').value = example.destination || 'Noborito';
  // Preserve the user's home/platform and mobility conditions when replaying a train example.
  setTrains(); const train = trips.find(t => t.id === example.selectedId);
  if (!train) throw Error('このデータに比較例がありません'); $('train').value = train.id; render(); $('result').scrollIntoView({ block: 'start' });
}));
$('now').addEventListener('click', safe(() => {
  $('time').value = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()); setTrains(); render();
}));
await safe(async () => {
  if (offlineMode) { $('mobile-export').hidden = true; $('offline-notice').hidden = false; }
  const datasets = await get('/api/datasets');
  $('dataset').replaceChildren(option('', '使用データを選択してください'), ...datasets.map(d => { const node = option(d.id, d.title); node.disabled = !d.available; return node; }));
  const initialDataset = offlineMode ? offlineData.defaultDataset || 'real' : 'real';
  if (!datasets.find(d => d.id === initialDataset)?.available) {
    $('source').textContent = '保存実データは未配置';
    $('result').replaceChildren(element('p', datasets.find(d => d.id === initialDataset)?.unavailableReason || '保存実データは未配置です。使用データから利用可能なデータを明示的に選択してください。')); return;
  }
  $('dataset').value = initialDataset;
  const snapshots = await get('/api/snapshots');
  $('snapshot').replaceChildren(...snapshots.map(s => option(s.id, `${new Date(s.fetchedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} JST`))); await load();
})();

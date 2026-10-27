import { BUILD, TYPES, minutes, clock } from './core.mjs';
import { planNavigation, scheduledPosition, CONNECTION_LABELS } from './navigation.mjs';

const $ = id => document.getElementById(id);
let model, trips = [], generation = 0;
const name = id => model.stations.find(s => s.id === id)?.name || id;
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function option(value, text) { const node = element('option', text); node.value = value; return node; }
function label(trip) { return `${clock(trip.stops[0].departure)} ${name(trip.origin)} ${TYPES[trip.type]} ${trip.destination}行`; }
async function get(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw Error(`データを読み込めません (${response.status})`);
  return response.json();
}
async function load() {
  const version = ++generation;
  $('example').disabled = true; $('train').disabled = true;
  model = undefined;
  $('source').textContent = '保存データを読み込み中…';
  $('result').replaceChildren(element('p', '保存データを読み込み中…'));
  for (const id of ['diagram', 'connections', 'evidence']) $(id).replaceChildren();
  const loaded = await get(`/api/model?snapshot=${encodeURIComponent($('snapshot').value)}`);
  if (version !== generation) return;
  model = loaded;
  if (!Array.isArray(model.trips) || !model.reconstruction) throw Error('列車ID付きデータがありません');
  setTrains(); render();
  $('example').disabled = !model.example; $('train').disabled = false;
}
function setTrains() {
  const previous = $('train').value, now = minutes($('time').value);
  trips = model.trips.filter(t => t.calendar === $('calendar').value);
  const visible = trips.filter(t => t.stops[0].departure >= now - 60 && t.stops[0].departure <= now + 30);
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
function renderResult(plan) {
  const nodes = [element('p', '保存定刻ダイヤ・取得区間内の比較', 'result-title')];
  const recommendation = plan.recommendation;
  if (plan.status === 'SCHEDULED_ARRIVED') {
    nodes.push(element('div', '定刻では到着済み', 'big'), element('p', `目的駅 ${clock(plan.baseline.arrival)}着。実際の遅延・現在位置は未取得です。`));
  } else if (plan.status === 'TRANSFER_REQUIRED') {
    nodes.push(element('div', 'この列車は目的駅を通過します', 'big'));
    if (recommendation) nodes.push(element('p', `${name(recommendation.legs[0].station)}で乗換する案は ${clock(recommendation.arrival)}着。乗り続ける案は到着不可のため短縮分は算出しません。`));
    else nodes.push(element('p', '取得範囲に接続見込みのある到着経路がありません。途中で停車列車への乗換が必要ですが、未取得の着発を補って推奨しません。'));
  } else if (!plan.baseline) {
    nodes.push(element('div', '目的駅の着時刻がありません', 'big'), element('p', '向ヶ丘遊園着や、この列車の目的駅着は未取得です。発時刻から着時刻を作らず、乗換推奨を保留します。登戸までの比較は目的地を切り替えて確認できます。'));
  } else if (recommendation.transfers === 0) {
    nodes.push(element('div', `このまま${name($('destination').value)}へ`, 'big'),
      element('p', '取得範囲では、接続見込みのある乗換で短縮なし。同着なら乗換なしを優先します。'));
  } else {
    nodes.push(element('div', `ダイヤ上 ${recommendation.saving}分早着`, 'big'),
      element('p', `${name(recommendation.legs[0].station)}で乗換 / ${CONNECTION_LABELS[recommendation.connection]}`),
      element('p', '番線・移動時間は未確認のため、接続を保証する案内ではありません。'));
  }
  const grid = element('div', undefined, 'grid');
  for (const [title, time] of [['乗り続ける：着', plan.baseline?.arrival], [recommendation?.transfers === 0 ? '乗換なしを優先：着' : '乗換案：着', recommendation?.arrival]]) {
    const metric = element('div', undefined, 'metric'); metric.append(element('small', title), element('strong', title === '乗り続ける：着' && plan.destinationPassed ? '通過' : clock(time))); grid.append(metric);
  }
  nodes.push(grid);
  if (plan.bestConditional?.connection === 'tight' && plan.bestConditional.saving > 0) {
    nodes.push(element('p', `ギリギリの候補は ${clock(plan.bestConditional.arrival)}着 / ${plan.bestConditional.saving}分早着。接続できない可能性があるため別枠にしています。`, 'tight-note'));
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
  const diagram = $('diagram'); diagram.replaceChildren();
  for (const station of model.stations) {
    const stop = selected.stops.find(s => s.station === station.id);
    const transfer = plan.recommendation?.legs?.some(l => l.station === station.id);
    const row = element('div', undefined, `station${station.id === 'MukogaokaYuen' ? ' beyond' : ''}${transfer ? ' transfer' : ''}`);
    const title = element('div', station.name, 'station-name');
    let text = selected.knownPasses.includes(station.id) ? '通過（通常種別の停車規則）' : 'この駅の着発は未取得';
    if (stop) text = `${stop.arrival !== null ? clock(stop.arrival) + '着 ' : ''}${stop.departure !== null ? clock(stop.departure) + '発' : ''}`;
    title.append(element('small', text));
    if (station.id === $('destination').value && plan.recommendation?.saving > 0) title.append(element('small', `乗換案 ${clock(plan.recommendation.arrival)}着`, 'early-note'));
    row.append(title, element('div', undefined, 'track'), element('div', undefined, 'track')); diagram.append(row);
  }
  const selectedPosition = scheduledPosition(selected, now);
  const selectedBanner = element('p', `★ 自分：${label(selected)} / ${selectedPosition ? '保存ダイヤによる推定位置' : 'この時刻の位置は未確定'}`, 'selected-banner');
  diagram.prepend(selectedBanner);
  const positions = trips.map(trip => ({ trip, point: scheduledPosition(trip, now) })).filter(x => x.point);
  const ahead = selectedPosition ? positions.filter(x => x.trip.id !== selected.id && x.point.index > selectedPosition.index).sort((a, b) => a.point.index - b.point.index)[0]?.trip.id : null;
  const behind = selectedPosition ? positions.filter(x => x.trip.id !== selected.id && x.point.index < selectedPosition.index).sort((a, b) => b.point.index - a.point.index)[0]?.trip.id : null;
  const placed = new Map();
  for (const { trip, point } of positions) {
    const fast = ['RapidExpress', 'Express'].includes(trip.type);
    const key = `${fast}:${Math.floor(point.index)}`, offset = placed.get(key) || 0; placed.set(key, offset + 1);
    const marker = element('div', `${trip.id === selected.id ? '★ 自分 ' : trip.id === ahead ? '前方 ' : trip.id === behind ? '後方 ' : ''}🚆 ${TYPES[trip.type]}\n${trip.destination}行`,
      `marker ${trip.type}${fast ? ' fast' : ''}${trip.id === selected.id ? ' selected' : ''}${trip.id === ahead ? ' ahead' : ''}${trip.id === behind ? ' behind' : ''}`);
    marker.style.whiteSpace = 'pre-line'; marker.style.top = `${selectedBanner.getBoundingClientRect().height + 16 + point.index * 92 + 24 + offset * 27}px`;
    marker.title = `${label(trip)} / ${name(point.from)}〜${name(point.to)}（保存定刻ダイヤによる推定）`; diagram.append(marker);
  }
}
function renderEvidence(selected, plan) {
  const nodes = [element('p', `選択：${label(selected)}`), element('p', `提供元便ID：${selected.sourceTrainId}。運転列車番号ではありません。`),
    element('p', `千代田線から同じ列車で継続：${selected.throughChiyoda === false ? '代々木上原始発の記録あり' : '未確定。直通先IDの対応は未取得'}`),
    element('p', plan.scope)];
  const table = element('table'), heading = element('tr');
  for (const title of ['駅', '着', '発']) heading.append(element('th', title)); table.append(heading);
  for (const stop of selected.stops) {
    const row = element('tr'); for (const cell of [name(stop.station), clock(stop.arrival), clock(stop.departure)]) row.append(element('td', cell)); table.append(row);
  }
  nodes.push(table);
  for (const leg of plan.recommendation?.legs || []) for (const reversal of leg.reversals) {
    nodes.push(element('p', `${name(reversal.from)}〜${name(reversal.to)}：着発順序が逆転（保存ダイヤの先着関係）。追越し地点・番線は未取得。`));
  }
  nodes.push(element('p', '同一便は提供元IDでのみ結合。途中駅の欠測を補完しません。独立照合できたのはODPTの発時刻です。着時刻の別資料照合・実際の遅延は未確認。'));
  $('evidence').replaceChildren(...nodes);
}
function render() {
  if (!model) return;
  const now = minutes($('time').value), selected = trips.find(t => t.id === $('train').value);
  $('source').textContent = `提供元ID付き ${model.reconstruction.accepted}便（平土休日計）。独立照合：発時刻 ${model.reconstruction.departureChecks}件一致 / 不一致 ${model.reconstruction.departureMismatches}件。元データ確認 ${new Date(model.reconstruction.sourceCheckedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} JST。着時刻の別取得経路照合 ${model.arrivalVerification?.matched || 0}件一致 / 不一致 ${model.arrivalVerification?.mismatched || 0}件（同じ提供元の公式画面、別提供者の資料照合は未実施）。ODPT取得 ${new Date(model.fetchedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} JST。`;
  $('build').textContent = `Build ${BUILD}`;
  $('verification').textContent = model.arrivalVerification?.status === 'not_checked' ? '着時刻の別取得経路による照合記録がありません。' : `公式画面での再取得照合：${model.arrivalVerification?.matched || 0}件一致、${model.arrivalVerification?.mismatched || 0}件不一致。確認日 ${model.arrivalVerification?.checkedAt ? new Date(model.arrivalVerification.checkedAt).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '未確認'}。対象は平日の個別例であり、全便・土休日・改正後の有効性を保証しません。不一致の便は案内対象から外します。`;
  const departures = model.departures.filter(d => d.calendar === $('calendar').value && d.station === $('destination').value && d.time >= now).sort((a, b) => a.time - b.time).slice(0, 8);
  $('departures').replaceChildren(...departures.map(d => element('p', `${clock(d.time)}発 ${TYPES[d.type]} ${d.destinationName}行（着時刻ではありません）`)));
  if (!selected) {
    $('result').replaceChildren(element('p', '乗車列車を手動選択してください。')); $('diagram').replaceChildren(); $('connections').replaceChildren(); $('evidence').replaceChildren(); return;
  }
  if ($('buffer').value === '') throw Error('追加の余裕は0〜10の整数で指定してください');
  const plan = planNavigation(trips, selected.id, $('destination').value, now, {
    stationConditions: { YoyogiUehara: $('uehara-condition').value, SeijogakuenMae: $('seijo-condition').value },
    mobility: $('mobility').value, extraMinutes: Number($('buffer').value)
  });
  $('result').className = ''; renderResult(plan); renderDiagram(selected, now, plan); renderEvidence(selected, plan);
}
function safe(action) {
  return async () => { try { await action(); } catch (error) {
    $('result').className = 'error'; $('result').replaceChildren(element('p', error.message));
    $('diagram').replaceChildren(); $('connections').replaceChildren(); $('evidence').replaceChildren();
  } };
}
$('snapshot').addEventListener('change', safe(load));
$('calendar').addEventListener('change', safe(() => { setTrains(); render(); }));
$('time').addEventListener('change', safe(() => { setTrains(); render(); }));
for (const id of ['train', 'destination', 'uehara-condition', 'seijo-condition', 'mobility', 'buffer']) $(id).addEventListener('change', safe(render));
$('example').addEventListener('click', safe(() => {
  if (!model) throw Error('データ読込が完了していません');
  const example = model.example; if (!example) throw Error('この保存データに比較例がありません');
  const selected = model.trips.find(t => t.id === example.selectedId);
  $('calendar').value = selected.calendar; $('time').value = clock(example.compareAt); $('destination').value = 'Noborito';
  // Preserve the user's home/platform and mobility conditions when replaying a train example.
  setTrains(); const train = trips.find(t => t.id === example.selectedId);
  if (!train) throw Error('このデータに比較例がありません'); $('train').value = train.id; render();
}));
$('now').addEventListener('click', safe(() => {
  $('time').value = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()); setTrains(); render();
}));
await safe(async () => {
  const snapshots = await get('/api/snapshots');
  $('snapshot').replaceChildren(...snapshots.map(s => option(s.id, `${new Date(s.fetchedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} JST`))); await load();
})();

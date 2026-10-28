import { TYPES, clock } from './core.mjs';
import { scheduledPosition, arrivalOrderReversals } from './navigation.mjs';
import { stationLayout } from './route-layout.mjs';

const TARGETS = ['Noborito', 'MukogaokaYuen'];
const MAJOR = ['YoyogiUehara', 'ShimoKitazawa', 'Kyodo', 'SeijogakuenMae', ...TARGETS];
const departure = t => t.stops[0].departure ?? t.stops[0].arrival;
const type = t => t.type === 'Local' ? '各停' : TYPES[t.type];
const arrival = (t, id) => t.stops.find(s => s.station === id && s.stop)?.arrival;
const validTime = Number.isInteger;
const order = (a, b) => departure(a) - departure(b) || a.id.localeCompare(b.id);
function el(tag, text, cls, parent) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (cls) n.className = cls;
  parent?.append(n);
  return n;
}
function at(n, top, left) { n.style.top = `${top}px`; if (left !== undefined) n.style.left = `${left}px`; return n; }
function button(parent, label, action, cls = '') {
  const n = el('button', label, cls, parent); n.type = 'button'; n.onclick = action; return n;
}

// Physical order is used only when both timetable positions are available.
// With no selected position, navigate departures at the SAME recorded origin.
export function mobileNeighbors(pool, selected, now) {
  const point = scheduledPosition(selected, now);
  const queue = pool.filter(t => t.stops[0].station === selected.stops[0].station).sort(order);
  const i = queue.findIndex(t => t.id === selected.id);
  if (point) {
    const others = pool.filter(t => t.id !== selected.id).map(train => ({ train, point: scheduledPosition(train, now) })).filter(t => t.point);
    const closest = side => others.filter(t => side * (t.point.index - point.index) > 0)
      .sort((a, b) => Math.abs(a.point.index - point.index) - Math.abs(b.point.index - point.index) || order(a.train, b.train))[0]?.train;
    const front = closest(1), rear = closest(-1);
    const before = front || (queue[i - 1]?.id !== rear?.id ? queue[i - 1] : undefined);
    const after = rear || (queue[i + 1]?.id !== before?.id ? queue[i + 1] : undefined);
    return { before, after, mode:'position', beforeKind:front ? 'position' : 'departure', afterKind:rear ? 'position' : 'departure' };
  }
  return { before:queue[i - 1], after:queue[i + 1], mode:'departure', beforeKind:'departure', afterKind:'departure' };
}

function official(parent, model, train) {
  const ref = model.tCodeReferences?.find(r => r.tripId === train.id && r.status === 'unique_reference');
  const a = el('a', ref ? '公式の列車詳細 ↗' : '公式時刻表 ↗', 'm-official', parent);
  a.href = ref?.url || 'https://www.odakyu.jp'; a.target = '_blank'; a.rel = 'noreferrer';
  a.title = ref ? `${ref.serviceDate}の参照・当日の運行は未確認` : '小田急公式サイト';
}

export function renderMobileRoute({ root, model, pool, selected, now, plans, onSelect }) {
  const name = id => model.stations.find(s => s.id === id)?.name || id;
  const shell = el('section', undefined, 'm-route');
  if (!selected) {
    el('h2', '乗っている電車を選ぶ', 'm-pick-title', shell);
    el('p', '代々木上原の発車時刻で選択', 'm-muted', shell);
    const list = el('div', undefined, 'm-pick-list', shell);
    pool.filter(t => t.stops[0].station === 'YoyogiUehara' && departure(t) >= now - 5 && departure(t) <= now + 15)
      .sort(order).forEach(t => button(list, `${clock(departure(t))}　${type(t)}　${t.destination}行`, () => onSelect(t.id), `m-pick ${t.type}`));
    if (!list.childElementCount) el('p', 'この時刻付近の収録便はありません。上の時刻を変更してください。', 'm-muted', shell);
    root.replaceChildren(shell); return;
  }

  const neighbors = mobileNeighbors(pool, selected, now);
  const transfers = plans.filter(p => p.recommendation?.transfers && p.recommendation.connection === 'likely'
    && (p.baseline || p.destinationPassed));
  const legs = new Map();
  for (const p of transfers) for (const leg of p.recommendation.legs) {
    const key = `${leg.fromTrainId}:${leg.trainId}:${leg.station}`;
    if (!legs.has(key)) legs.set(key, { leg, plan: p });
  }
  const partnerIds = [...new Set([...legs.values()].map(({ leg }) => leg.trainId))];
  const partners = partnerIds.map(id => pool.find(t => t.id === id)).filter(Boolean);
  const left = partners[1] || (neighbors.before?.id !== partners[0]?.id ? neighbors.before : neighbors.after);
  const right = partners[0] || (neighbors.after?.id !== left?.id ? neighbors.after : null);
  const slots = [left || null, selected, right || null];
  const point = scheduledPosition(selected, now);

  const selector = el('div', undefined, 'm-selector', shell);
  const current = el('div', undefined, `m-current ${selected.type}`, selector);
  el('span', '★ 今の列車 · 手動選択', 'm-eyebrow', current);
  el('strong', `${clock(departure(selected))} ${type(selected)}　${selected.destination}行`, undefined, current);
  el('span', point ? `${name(point.from)}${point.from === point.to ? '付近' : ` → ${name(point.to)}`} · 定刻推定` : '現在位置は未取得 · 定刻ダイヤで比較', 'm-location', current);
  const nav = el('nav', undefined, 'm-neighbors', selector); nav.setAttribute('aria-label', '前後の列車を選択');
  for (const [train, label, direction] of [[neighbors.before, neighbors.beforeKind === 'position' ? '前方の電車' : '前の発車', '前'], [neighbors.after, neighbors.afterKind === 'position' ? '後方の電車' : '次の発車', '次']]) {
    const b = button(nav, undefined, () => onSelect(train.id), 'm-neighbor'); b.disabled = !train;
    el('span', `${direction === '前' ? '‹ ' : ''}${label}${direction === '次' ? ' ›' : ''}`, undefined, b);
    el('strong', train ? `${clock(departure(train))} ${type(train)}` : '収録なし', undefined, b);
    if (train) el('span', `${train.destination}行`, undefined, b);
    b.setAttribute('aria-label', train ? `${label} ${clock(departure(train))} ${type(train)} ${train.destination}行を選択` : `${label}なし`);
  }
  el('p', neighbors.mode === 'departure' ? `${name(selected.stops[0].station)}の発車順 · 実際の前後位置は未確認` : '前後は定刻推定 · 位置不明の便は発車順で切替', 'm-order-note', selector);

  const transferStations = new Set([...legs.values()].map(({ leg }) => leg.station));
  const majors = new Set([...MAJOR, ...transferStations]);
  // Runs of minor stations share one small band; all original indices remain.
  const ordered = [...model.stations].sort((a, b) => a.index - b.index), runs = [], runSizes = new Map();
  let run = [];
  for (const s of [...ordered, null]) {
    if (s && !majors.has(s.id)) run.push(s);
    else if (run.length) { runs.push(run); for (const item of run) runSizes.set(item.id, run.length); run = []; }
  }
  const layout = stationLayout(model.stations, majors, transferStations, true, 116, (s, { major, transfer }) =>
    ({ height: transfer ? 218 : TARGETS.includes(s.id) ? 186 : major ? 88 : 38 / runSizes.get(s.id), centerOffset: major ? 32 : undefined }));
  const map = el('div', undefined, 'm-map', shell); map.style.height = `${layout.height + 38}px`;
  map.setAttribute('aria-label', '選択列車を中央にした縦型路線図');
  const width = root.clientWidth, labelWidth = 104, laneWidth = (width - labelWidth) / 3;
  const x = i => labelWidth + laneWidth * (i + .5);
  for (const item of layout.rows) {
    const { station: s, top, height, center, major } = item;
    const row = at(el('div', undefined, `m-row${major ? ' m-major' : ' m-minor'}${TARGETS.includes(s.id) ? ' m-target' : ''}`, map), top);
    row.dataset.station = s.id; row.style.height = `${height}px`;
    if (major) at(el('strong', s.name, 'm-station', row), center - top - 11, 8);
    else row.setAttribute('aria-label', s.name);
  }
  for (const group of runs) {
    const first = layout.rows.find(r => r.station.id === group[0].id);
    const text = group.length === 1 ? group[0].name : `${group[0].name} … ${group.at(-1).name}`;
    const n = at(el('span', text, 'm-compressed', map), first.top + 8, 8);
    n.title = group.map(s => s.name).join(' → ');
  }
  const positions = new Map();
  slots.forEach((train, i) => {
    if (!train) return;
    const own = train.id === selected.id, target = partnerIds.includes(train.id);
    const otherPoint = scheduledPosition(train, now);
    const relation = point && otherPoint
      ? (otherPoint?.index > point.index ? '前方の電車' : '後方の電車')
      : (order(train, selected) < 0 ? '前の発車' : '次の発車');
    const role = own ? '今の列車' : target ? '乗換先' : relation;
    const lane = at(el('div', undefined, `m-lane ${train.type}${own ? ' m-own' : ''}${target ? ' m-partner' : ''}`, map), 0, x(i));
    lane.dataset.train = train.id; positions.set(train.id, x(i));
    const heading = button(lane, undefined, () => onSelect(train.id), 'm-lane-head');
    el('span', role, 'm-role', heading); el('strong', clock(departure(train)), undefined, heading); el('span', type(train), undefined, heading);
    heading.setAttribute('aria-label', `${role} ${clock(departure(train))} ${type(train)}を選択`);
    const indices = train.stops.filter(s => s.stop).map(s => s.index);
    if (indices.length) {
      const line = at(el('div', undefined, 'm-track', lane), layout.y(Math.min(...indices)));
      line.style.height = `${layout.y(Math.max(...indices)) - layout.y(Math.min(...indices))}px`;
    }
    for (const stop of train.stops.filter(s => s.stop)) {
      const dot = at(el('span', '●', 'm-stop', lane), layout.y(stop.index)); dot.title = `${name(stop.station)} 停車`;
    }
    for (const id of train.knownPasses.filter(id => !train.stops.some(s => s.station === id && s.stop))) {
      const s = ordered.find(s => s.id === id); if (s) at(el('span', '×', 'm-pass', lane), layout.y(s.index)).title = `${s.name} 通過`;
    }
    const position = otherPoint;
    const icon = at(button(lane, '🚆', () => onSelect(train.id), 'm-train'), position ? layout.y(position.index) - 24 : 73);
    icon.setAttribute('aria-label', `${role} ${clock(departure(train))} ${type(train)} ${position ? '定刻推定位置' : '位置未取得'}`);
    if (!position) el('span', '位置未取得', 'm-undocked', icon);
    for (const d of TARGETS) {
      const time = arrival(train, d), s = ordered.find(s => s.id === d);
      const cell = at(el('span', validTime(time) ? clock(time) : train.knownPasses.includes(d) ? '通過' : '未取得', `m-arrival${validTime(time) ? '' : ' m-missing'}`, lane), layout.y(s.index) + 13);
      el('small', own ? '今の列車' : target ? '乗換先' : relation, undefined, cell);
      el('small', `${clock(departure(train))}発`, undefined, cell);
    }
  });
  for (const { leg, plan } of legs.values()) {
    const from = pool.find(t => t.id === leg.fromTrainId), to = pool.find(t => t.id === leg.trainId);
    const row = layout.rows.find(r => r.station.id === leg.station);
    const card = at(el('div', undefined, 'm-transfer', map), row.top + 83, 8);
    card.dataset.from = from.id; card.dataset.to = to.id; card.dataset.station = leg.station;
    el('strong', `↔ ${name(leg.station)}で ${type(from)} → ${type(to)}`, undefined, card);
    el('div', `${clock(leg.departure)}発 ${to.destination}行`, undefined, card);
    el('b', `${name(plan.destination)} ${clock(plan.recommendation.arrival)}着${plan.recommendation.saving > 0 ? ` · ${plan.recommendation.saving}分早着` : ''}`, undefined, card);
    el('small', '接続見込み · 番線未確認、保証なし', undefined, card);
    for (const [id, text] of [[from.id, '元'], [to.id, '先']]) if (positions.has(id)) {
      at(el('span', text, `m-connect ${text === '先' ? 'm-to' : ''}`, map), row.center - 13, positions.get(id) - 13);
    }
  }
  for (const p of plans) {
    const row = layout.rows.find(r => r.station.id === p.destination);
    const summary = at(el('div', undefined, 'm-result', map), row.top + 118, 8);
    summary.dataset.destination = p.destination;
    const rec = p.recommendation;
    if (rec?.transfers && rec.connection === 'likely') {
      el('strong', `${clock(rec.arrival)}着の乗換案が先着${p.baseline ? ` · ${rec.saving}分短縮` : ''}`, undefined, summary);
    } else if (rec?.transfers === 0) el('strong', `${clock(rec.arrival)}着 · そのまま`, undefined, summary);
    else if (p.status === 'SCHEDULED_ARRIVED' && p.baseline) el('span', `定刻 ${clock(p.baseline.arrival)}着 · 到着済み`, undefined, summary);
    else {
      el('span', p.destinationPassed ? 'この列車は通過 · 到着比較は未判定' : '着時刻未取得 · 到着比較は未判定', undefined, summary);
      official(summary, model, selected);
    }
  }
  const reversals = slots.filter(t => t && t.id !== selected.id).flatMap(other => arrivalOrderReversals(selected, other).map(r => ({ other, r })));
  if (reversals.length) {
    const evidence = el('details', undefined, 'm-evidence', shell);
    el('summary', '先着順が逆転する区間', undefined, evidence);
    for (const { other, r } of reversals) {
      const endpoint = t => { const s = t.stops.find(s => s.station === r.to); return s.arrival ?? s.departure; };
      const winner = endpoint(other) < endpoint(selected) ? other : selected;
      el('p', `${name(r.from)} → ${name(r.to)}：${clock(departure(winner))} ${type(winner)}が先着。追越し地点は未確認。`, undefined, evidence);
    }
  }
  const dates = [...new Set(pool.map(t => t.sourceServiceDate))];
  el('p', `● 停車　× 通過　無印は不明 · 番線図ではありません\n${dates.join('・')} 平日保存ダイヤ / 位置は定刻推定`, 'm-footnote', shell);
  root.replaceChildren(shell);
}

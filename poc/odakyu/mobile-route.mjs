import { TYPES, clock } from './core.mjs';
import { scheduledPosition, arrivalOrderReversals } from './navigation.mjs';
import { stationLayout } from './route-layout.mjs';

const TARGETS = ['Noborito', 'MukogaokaYuen'];
const MAJOR = ['YoyogiUehara', 'ShimoKitazawa', 'Kyodo', 'SeijogakuenMae', ...TARGETS];
const departure = t => t.stops[0].departure ?? t.stops[0].arrival;
const type = t => t.type === 'Local' ? '各停' : TYPES[t.type];
const arrival = (t, id) => t.stops.find(s => s.station === id && s.stop)?.arrival;
const order = (a, b) => departure(a) - departure(b) || a.id.localeCompare(b.id);
function el(tag, text, cls, parent) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (cls) n.className = cls;
  parent?.append(n);
  return n;
}
function at(n, top, left) { n.style.top = `${top}px`; if (left !== undefined) n.style.left = `${left}px`; return n; }

// A departure-order neighbor is never labelled as a known physical position.
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
    return { before, after, beforeKind:front ? 'position' : 'departure', afterKind:rear ? 'position' : 'departure' };
  }
  return { before:queue[i - 1], after:queue[i + 1], beforeKind:'departure', afterKind:'departure' };
}

// Both widths use the same diagram and interaction. Only density changes.
export function renderRouteMap({ root, model, pool, selected, now, plans, onSelect, compact }) {
  const name = id => model.stations.find(s => s.id === id)?.name || id;
  const legs = new Map();
  for (const plan of plans.filter(p => p.recommendation?.transfers && p.recommendation.connection === 'likely' && (p.baseline || p.destinationPassed))) {
    for (const leg of plan.recommendation.legs) {
      const key = `${leg.fromTrainId}:${leg.trainId}:${leg.station}`;
      if (!legs.has(key)) legs.set(key, { leg, plan });
    }
  }
  const partnerIds = [...new Set([...legs.values()].map(({ leg }) => leg.trainId))];
  const partners = partnerIds.map(id => pool.find(t => t.id === id)).filter(Boolean);
  const nearby = pool.filter(t => scheduledPosition(t, now) || (departure(t) >= now && departure(t) <= now + 15))
    .sort((a, b) => Math.abs(departure(a) - now) - Math.abs(departure(b) - now) || order(a, b));
  let slots;
  if (selected) {
    const neighbors = mobileNeighbors(pool, selected, now);
    const left = partners[1] || (neighbors.before?.id !== partners[0]?.id ? neighbors.before : neighbors.after);
    const right = partners[0] || (neighbors.after?.id !== left?.id ? neighbors.after : null);
    slots = [left || null, selected, right || null];
    if (!compact) {
      const extras = nearby.filter(t => !slots.some(s => s?.id === t.id)).slice(0, 4).sort(order);
      slots = [extras[0] || null, extras[1] || null, ...slots, extras[2] || null, extras[3] || null];
    }
  } else slots = nearby.slice(0, compact ? 3 : 7).sort(order);

  const transferStations = new Set([...legs.values()].map(({ leg }) => leg.station));
  const majors = new Set([...MAJOR, ...transferStations]);
  const ordered = [...model.stations].sort((a, b) => a.index - b.index), runs = [], runSizes = new Map();
  let run = [];
  for (const s of [...ordered, null]) {
    if (s && !majors.has(s.id)) run.push(s);
    else if (run.length) { runs.push(run); for (const item of run) runSizes.set(item.id, run.length); run = []; }
  }
  const unknown = slots.some(t => t && !scheduledPosition(t, now));
  const layout = stationLayout(model.stations, majors, transferStations, compact, unknown ? 126 : 14, (s, { major, transfer }) =>
    ({ height:transfer ? 156 : TARGETS.includes(s.id) ? 148 : major ? 88 : 38 / runSizes.get(s.id), centerOffset:major ? 32 : undefined }));
  const map = el('div', undefined, 'm-map'); map.style.height = `${layout.height + 12}px`;
  map.setAttribute('aria-label', '電車を直接選択する縦型路線図');
  const labelWidth = compact ? 100 : 150, laneWidth = (root.clientWidth - labelWidth) / Math.max(slots.length, 1);
  const x = i => labelWidth + laneWidth * (i + .5);
  if (unknown) at(el('span', '位置未取得', 'm-dock-label', map), 28, 8);
  for (const item of layout.rows) {
    const { station:s, top, height, center, major } = item;
    const row = at(el('div', undefined, `m-row${major ? ' m-major' : ' m-minor'}${TARGETS.includes(s.id) ? ' m-target' : ''}`, map), top);
    row.dataset.station = s.id; row.style.height = `${height}px`;
    if (major) at(el('strong', s.name, 'm-station', row), center - top - 11, 8);
    else row.setAttribute('aria-label', s.name);
  }
  for (const group of runs) {
    const first = layout.rows.find(r => r.station.id === group[0].id);
    const text = group.length === 1 ? group[0].name : `${group[0].name} … ${group.at(-1).name}`;
    at(el('span', text, 'm-compressed', map), first.top + 8, 8).title = group.map(s => s.name).join(' → ');
  }
  const positions = new Map(), selectedPoint = selected && scheduledPosition(selected, now);
  slots.forEach((train, i) => {
    if (!train) return;
    const own = train.id === selected?.id, target = partnerIds.includes(train.id), point = scheduledPosition(train, now);
    const role = own ? '選択' : target ? '乗換先' : selectedPoint && point ? (point.index > selectedPoint.index ? '前方' : '後方') : '列車';
    const lane = at(el('div', undefined, `m-lane ${train.type}${own ? ' m-own' : ''}${target ? ' m-partner' : ''}`, map), 0, x(i));
    lane.dataset.train = train.id; positions.set(train.id, x(i));
    const indices = train.stops.filter(s => s.stop).map(s => s.index);
    if (indices.length) {
      const line = at(el('div', undefined, 'm-track', lane), layout.y(Math.min(...indices)));
      line.style.height = `${layout.y(Math.max(...indices)) - layout.y(Math.min(...indices))}px`;
    }
    for (const stop of train.stops.filter(s => s.stop)) at(el('span', '●', 'm-stop', lane), layout.y(stop.index)).title = `${name(stop.station)} 停車`;
    for (const id of train.knownPasses.filter(id => !train.stops.some(s => s.station === id && s.stop))) {
      const s = ordered.find(s => s.id === id); if (s) at(el('span', '×', 'm-pass', lane), layout.y(s.index)).title = `${s.name} 通過`;
    }
    const icon = at(el('button', undefined, 'm-train', lane), point ? layout.y(point.index) - 24 : 0);
    icon.type = 'button'; icon.onclick = () => onSelect(train.id); icon.setAttribute('aria-pressed', String(own));
    icon.setAttribute('aria-label', `${clock(departure(train))} ${type(train)} ${train.destination}行を選択`);
    icon.title = `${role} / ${point ? '定刻推定' : '位置未取得'}`;
    el('span', '🚆', 'm-icon', icon);
    el('strong', `${own ? '★ ' : target ? '↔ ' : ''}${clock(departure(train))}`, undefined, icon);
    el('span', type(train), undefined, icon);
    el('span', `${train.destination}行`, 'm-destination', icon);
    for (const d of TARGETS) {
      const time = arrival(train, d), s = ordered.find(s => s.id === d), p = plans.find(p => p.destination === d);
      const cell = at(el('span', Number.isInteger(time) ? clock(time) : train.knownPasses.includes(d) ? '通過' : '未取得', `m-arrival${Number.isInteger(time) ? '' : ' m-missing'}`, lane), layout.y(s.index) + 13);
      cell.dataset.destination = d;
      el('small', `${own ? '★' : target ? '↔' : ''}${clock(departure(train))}発`, undefined, cell);
      if (own && p?.recommendation?.transfers === 0) el('b', 'そのまま', 'm-verdict', cell);
      if (target && p?.recommendation?.legs.at(-1)?.trainId === train.id) el('b', `先着${p.recommendation.saving > 0 ? ` −${p.recommendation.saving}分` : ''}`, 'm-verdict', cell);
      if (own && !Number.isInteger(time)) {
        const ref = model.tCodeReferences?.find(r => r.tripId === train.id && r.status === 'unique_reference');
        const a = el('a', '公式 ↗', 'm-official', cell);
        a.href = ref?.url || 'https://www.odakyu.jp'; a.target = '_blank'; a.rel = 'noreferrer';
        a.title = ref ? `${ref.serviceDate}の参照` : '小田急公式';
      }
    }
  });
  for (const { leg, plan } of legs.values()) {
    const from = pool.find(t => t.id === leg.fromTrainId), to = pool.find(t => t.id === leg.trainId);
    const row = layout.rows.find(r => r.station.id === leg.station);
    const note = at(el('div', undefined, 'm-transfer', map), row.top + 64, 104);
    note.dataset.from = from.id; note.dataset.to = to.id; note.dataset.station = leg.station;
    el('strong', `↔ ${type(from)} → ${type(to)}`, undefined, note);
    el('span', `${clock(leg.departure)}発 · ${name(plan.destination)} ${clock(plan.recommendation.arrival)}着${plan.recommendation.saving > 0 ? ` −${plan.recommendation.saving}分` : ''}`, undefined, note);
    el('small', '接続見込み・未保証', undefined, note);
    for (const [id, text] of [[from.id, '元'], [to.id, '先']]) if (positions.has(id)) at(el('span', text, `m-connect ${text === '先' ? 'm-to' : ''}`, map), row.center - 13, positions.get(id) - 13);
  }
  if (selected) {
    const reversals = slots.filter(t => t && t.id !== selected.id).flatMap(other => arrivalOrderReversals(selected, other));
    for (const id of new Set(reversals.map(r => r.to))) {
      const row = layout.rows.find(r => r.station.id === id);
      const n = at(el('small', '先着順逆転', 'm-reversal', map), row.top + 61, 8);
      n.title = '区間の着発順序が逆転。追越し地点は未確認';
    }
  }
  if (!slots.length) at(el('span', '未取得', 'm-dock-label', map), 24, 110);
  root.replaceChildren(map);
}
